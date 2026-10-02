-- Issue 332 / ADR plan/tecnico-identidade-cliente.md §3 "Banco".
-- Papel explícito por conta (lojista | cliente). L1 = (A): conta só-cliente
-- nunca vira dona de loja por nenhum caminho (trigger em lojas, qualquer role).
-- Idempotente: pode ser reexecutada sem erro nem efeito duplicado.
--
-- Rollback (antes de qualquer conta 'cliente' existir em prod, sem perda):
--   drop trigger if exists lojas_exige_dono_lojista_trg on public.lojas;
--   drop function if exists public.lojas_exige_dono_lojista();
--   drop function if exists public.atribuir_papel_inicial(uuid, text);
--   drop table if exists public.papeis_usuario;

create table if not exists public.papeis_usuario (
  usuario_id uuid not null references auth.users (id) on delete cascade,
  papel text not null check (papel in ('lojista', 'cliente')),
  criado_em timestamptz not null default now(),
  primary key (usuario_id, papel)
);

alter table public.papeis_usuario enable row level security;

drop policy if exists "papeis_usuario_leitura_propria" on public.papeis_usuario;
create policy "papeis_usuario_leitura_propria" on public.papeis_usuario
  for select to authenticated
  using (usuario_id = (select auth.uid()));

revoke all on public.papeis_usuario from public, anon, authenticated;
grant select on public.papeis_usuario to authenticated;
grant all on public.papeis_usuario to service_role;

-- Grava o papel só se a conta ainda não tem nenhum; devolve os papéis atuais.
create or replace function public.atribuir_papel_inicial(p_usuario_id uuid, p_papel text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('papeis_usuario'),
    pg_catalog.hashtext(p_usuario_id::text)
  );
  if not exists (select 1 from public.papeis_usuario where usuario_id = p_usuario_id) then
    insert into public.papeis_usuario (usuario_id, papel) values (p_usuario_id, p_papel);
  end if;
  return coalesce(
    (select pg_catalog.array_agg(papel order by papel)
       from public.papeis_usuario where usuario_id = p_usuario_id),
    '{}'::text[]
  );
end
$$;

revoke all on function public.atribuir_papel_inicial(uuid, text) from public, anon, authenticated;
grant execute on function public.atribuir_papel_inicial(uuid, text) to service_role;

-- I2: dono de loja precisa ter (ou receber, se sem papel) o papel lojista.
create or replace function public.lojas_exige_dono_lojista()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Usuário final pedindo loja de OUTRO dono: a policy recusa (42501);
  -- não ler nem gravar papel alheio aqui.
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and new.dono_id is distinct from auth.uid() then
    return new;
  end if;
  if not ('lojista' = any (public.atribuir_papel_inicial(new.dono_id, 'lojista'))) then
    raise exception 'loja: conta de cliente não pode ser dona de loja';
  end if;
  return new;
end
$$;

revoke all on function public.lojas_exige_dono_lojista() from public, anon, authenticated;

drop trigger if exists lojas_exige_dono_lojista_trg on public.lojas;
create trigger lojas_exige_dono_lojista_trg
  before insert or update of dono_id on public.lojas
  for each row execute function public.lojas_exige_dono_lojista();

-- Backfill (decisão 14): toda conta pré-existente sem papel vira lojista.
insert into public.papeis_usuario (usuario_id, papel)
select u.id, 'lojista'
  from auth.users u
 where not exists (select 1 from public.papeis_usuario p where p.usuario_id = u.id)
on conflict do nothing;
