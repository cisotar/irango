-- Issue 335 / spec specs/cliente-identidade.md §Modelos de Dados (Marco B, P12).
-- Perfil de cliente final: public.clientes + public.clientes_enderecos, RLS,
-- grants por coluna, triggers de idade/teto/padrão/mínimo e as funções
-- SECURITY DEFINER de perfil e anonimização (EXECUTE só service_role).
-- Idempotente: pode ser reexecutada sem erro nem efeito duplicado.
--
-- Rollback (seguro enquanto não houver perfil de cliente em prod; depois disso
-- perde os perfis criados — exportar antes):
--   drop function if exists public.anonimizar_clientes_inativos();
--   drop function if exists public.anonimizar_cliente(uuid);
--   drop function if exists public.criar_perfil_cliente(uuid, text, text, date, boolean, text, jsonb);
--   drop function if exists public.adicionar_papel_cliente(uuid);
--   drop table if exists public.clientes_enderecos;   -- leva triggers/policies/índices
--   drop table if exists public.clientes;
--   drop function if exists public.clientes_valida_idade();
--   drop function if exists public.clientes_enderecos_teto();
--   drop function if exists public.clientes_enderecos_minimo();
-- (papeis_usuario fica: linhas 'cliente' já gravadas são do Marco A.)

-- ── clientes ────────────────────────────────────────────────────────────────
create table if not exists public.clientes (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 120),
  telefone text not null check (telefone ~ '^\+?[\d\s()-]{8,20}$'),
  data_nascimento date not null,
  aceita_marketing boolean not null default false,
  consentimento_em timestamptz not null,
  consentimento_versao text not null check (char_length(consentimento_versao) between 1 and 50),
  criado_em timestamptz not null default now(),
  ultimo_acesso_em timestamptz not null default now()
);

create index if not exists clientes_ultimo_acesso_em_idx on public.clientes (ultimo_acesso_em);

alter table public.clientes enable row level security;

drop policy if exists "clientes_select_proprio" on public.clientes;
create policy "clientes_select_proprio" on public.clientes
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "clientes_update_proprio" on public.clientes;
create policy "clientes_update_proprio" on public.clientes
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- INSERT/DELETE só via criar_perfil_cliente / anonimizar_cliente (service_role).
revoke all on public.clientes from public, anon, authenticated;
grant select on public.clientes to authenticated;
grant update (nome, telefone, data_nascimento, aceita_marketing) on public.clientes to authenticated;
grant all on public.clientes to service_role;

-- Idade (decisão 17): CHECK não pode usar current_date (não imutável) → trigger.
create or replace function public.clientes_valida_idade()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.data_nascimento > current_date then
    raise exception 'Data de nascimento não pode ser futura.' using errcode = '23514';
  end if;
  if new.data_nascimento > (current_date - interval '18 years')::date then
    raise exception 'Você precisa ter 18 anos ou mais para criar uma conta.'
      using errcode = '23514';
  end if;
  if new.data_nascimento < (current_date - interval '120 years')::date then
    raise exception 'Data de nascimento inválida.' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function public.clientes_valida_idade() from public, anon, authenticated;

drop trigger if exists clientes_valida_idade_trg on public.clientes;
create trigger clientes_valida_idade_trg
  before insert or update of data_nascimento on public.clientes
  for each row execute function public.clientes_valida_idade();

-- ── clientes_enderecos ──────────────────────────────────────────────────────
create table if not exists public.clientes_enderecos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  rotulo text not null check (char_length(rotulo) between 1 and 30 and rotulo !~ '[\n\r]'),
  cep text not null check (cep ~ '^\d{5}-?\d{3}$'),
  rua text not null check (char_length(rua) between 1 and 200),
  numero text not null check (char_length(numero) between 1 and 20),
  bairro text not null check (char_length(bairro) between 1 and 100),
  cidade text not null check (char_length(cidade) between 1 and 100),
  uf text not null check (char_length(uf) = 2),
  complemento text check (complemento is null or char_length(complemento) <= 100),
  padrao boolean not null default false,
  criado_em timestamptz not null default now()
);

create index if not exists clientes_enderecos_cliente_id_idx on public.clientes_enderecos (cliente_id);
create unique index if not exists clientes_enderecos_um_padrao_idx
  on public.clientes_enderecos (cliente_id) where padrao;

alter table public.clientes_enderecos enable row level security;

drop policy if exists "clientes_enderecos_select_proprio" on public.clientes_enderecos;
create policy "clientes_enderecos_select_proprio" on public.clientes_enderecos
  for select to authenticated
  using (cliente_id = (select auth.uid()));

drop policy if exists "clientes_enderecos_insert_proprio" on public.clientes_enderecos;
create policy "clientes_enderecos_insert_proprio" on public.clientes_enderecos
  for insert to authenticated
  with check (cliente_id = (select auth.uid()));

drop policy if exists "clientes_enderecos_update_proprio" on public.clientes_enderecos;
create policy "clientes_enderecos_update_proprio" on public.clientes_enderecos
  for update to authenticated
  using (cliente_id = (select auth.uid()))
  with check (cliente_id = (select auth.uid()));

drop policy if exists "clientes_enderecos_delete_proprio" on public.clientes_enderecos;
create policy "clientes_enderecos_delete_proprio" on public.clientes_enderecos
  for delete to authenticated
  using (cliente_id = (select auth.uid()));

revoke all on public.clientes_enderecos from public, anon, authenticated;
grant select, insert, update, delete on public.clientes_enderecos to authenticated;
grant all on public.clientes_enderecos to service_role;

-- Teto de 3 por cliente (vale para qualquer role). Advisory lock por cliente
-- serializa INSERTs concorrentes; o count roda depois do lock (molde
-- 20260927124000_modais_sazonais_teto_por_loja.sql).
create or replace function public.clientes_enderecos_teto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Usuário final gravando endereço de OUTRO cliente: a policy (WITH CHECK)
  -- recusa com 42501 depois deste trigger; não contar nem travar o alheio.
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and new.cliente_id is distinct from auth.uid() then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('clientes_enderecos'),
    pg_catalog.hashtext(new.cliente_id::text)
  );
  if (select count(*) from public.clientes_enderecos where cliente_id = new.cliente_id) >= 3 then
    raise exception 'clientes_enderecos: teto de endereços' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function public.clientes_enderecos_teto() from public, anon, authenticated;

drop trigger if exists clientes_enderecos_teto_trg on public.clientes_enderecos;
create trigger clientes_enderecos_teto_trg
  before insert or update of cliente_id on public.clientes_enderecos
  for each row execute function public.clientes_enderecos_teto();

-- Mínimo de 1 enquanto houver perfil: só para usuário final. Cascade de
-- anonimizar_cliente (service_role) e operação administrativa passam.
create or replace function public.clientes_enderecos_minimo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return old;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('clientes_enderecos'),
    pg_catalog.hashtext(old.cliente_id::text)
  );
  if (select count(*) from public.clientes_enderecos where cliente_id = old.cliente_id) <= 1 then
    raise exception 'clientes_enderecos: mínimo de 1 endereço' using errcode = '23514';
  end if;
  return old;
end
$$;

revoke all on function public.clientes_enderecos_minimo() from public, anon, authenticated;

drop trigger if exists clientes_enderecos_minimo_trg on public.clientes_enderecos;
create trigger clientes_enderecos_minimo_trg
  before delete on public.clientes_enderecos
  for each row execute function public.clientes_enderecos_minimo();

-- ── Funções de perfil / anonimização (EXECUTE só service_role) ──────────────

-- Acrescenta 'cliente' (nunca 'lojista'); mesmo lock de atribuir_papel_inicial.
create or replace function public.adicionar_papel_cliente(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_usuario is null then
    raise exception 'adicionar_papel_cliente: usuário obrigatório' using errcode = '22004';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('papeis_usuario'),
    pg_catalog.hashtext(p_usuario::text)
  );
  insert into public.papeis_usuario (usuario_id, papel)
  values (p_usuario, 'cliente')
  on conflict do nothing;
end
$$;

revoke all on function public.adicionar_papel_cliente(uuid) from public, anon, authenticated;
grant execute on function public.adicionar_papel_cliente(uuid) to service_role;

-- Papel + perfil + 1º endereço (padrão) numa transação (a da própria chamada).
create or replace function public.criar_perfil_cliente(
  p_usuario uuid,
  p_nome text,
  p_telefone text,
  p_data_nascimento date,
  p_aceita_marketing boolean,
  p_versao_termos text,
  p_endereco jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_usuario is null then
    raise exception 'criar_perfil_cliente: usuário obrigatório' using errcode = '22004';
  end if;
  if p_versao_termos is null or btrim(p_versao_termos) = '' then
    raise exception 'criar_perfil_cliente: aceite dos termos obrigatório' using errcode = '22004';
  end if;
  if p_endereco is null or pg_catalog.jsonb_typeof(p_endereco) <> 'object' then
    raise exception 'criar_perfil_cliente: endereço obrigatório' using errcode = '22004';
  end if;
  if exists (select 1 from public.clientes where id = p_usuario) then
    raise exception 'criar_perfil_cliente: perfil já existe' using errcode = '23505';
  end if;

  perform public.adicionar_papel_cliente(p_usuario);

  insert into public.clientes (
    id, nome, telefone, data_nascimento, aceita_marketing,
    consentimento_em, consentimento_versao
  ) values (
    p_usuario, p_nome, p_telefone, p_data_nascimento, coalesce(p_aceita_marketing, false),
    now(), p_versao_termos
  );

  insert into public.clientes_enderecos (
    cliente_id, rotulo, cep, rua, numero, bairro, cidade, uf, complemento, padrao
  ) values (
    p_usuario,
    p_endereco ->> 'rotulo',
    p_endereco ->> 'cep',
    p_endereco ->> 'rua',
    p_endereco ->> 'numero',
    p_endereco ->> 'bairro',
    p_endereco ->> 'cidade',
    p_endereco ->> 'uf',
    nullif(p_endereco ->> 'complemento', ''),
    true
  );
end
$$;

revoke all on function public.criar_perfil_cliente(uuid, text, text, date, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.criar_perfil_cliente(uuid, text, text, date, boolean, text, jsonb)
  to service_role;

-- Marco B: apaga o perfil (cascade nos endereços). Não toca papeis_usuario,
-- lojas nem auth.users. Marco C estende para pedidos.
create or replace function public.anonimizar_cliente(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.clientes where id = p_usuario;
end
$$;

revoke all on function public.anonimizar_cliente(uuid) from public, anon, authenticated;
grant execute on function public.anonimizar_cliente(uuid) to service_role;

-- Retenção de 24 meses (decisão 4). Sem agendador nesta entrega.
create or replace function public.anonimizar_clientes_inativos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_total integer := 0;
begin
  for v_id in
    select id from public.clientes where ultimo_acesso_em < now() - interval '24 months'
  loop
    perform public.anonimizar_cliente(v_id);
    v_total := v_total + 1;
  end loop;
  return v_total;
end
$$;

revoke all on function public.anonimizar_clientes_inativos() from public, anon, authenticated;
grant execute on function public.anonimizar_clientes_inativos() to service_role;
