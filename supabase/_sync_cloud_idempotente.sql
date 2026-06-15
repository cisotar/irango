-- ═══════════════════════════════════════════════════════════════════════════
-- SYNC CLOUD IDEMPOTENTE — migrations 003000 → 008000
-- ═══════════════════════════════════════════════════════════════════════════
-- Cole este arquivo INTEIRO no SQL Editor do Supabase cloud e rode UMA vez.
-- É 100% idempotente: pode ser re-executado em qualquer estado (de 002500 até
-- 008000 já aplicado) sem erro e sem duplicata.
--
-- Recriações colapsadas para a VERSÃO FINAL (não rodam versões intermediárias):
--   - public.criar_pedido → apenas a definição de 008000 (tipo_entrega/troco/opcionais).
--     Um DROP cobre AS DUAS assinaturas antigas (13 args e 15 args) antes do CREATE.
--   - public.vitrine_lojas → apenas a definição de 006000
--     (assinatura_status + assinatura_fim_periodo + taxa_entrega_fora_zona).
--
-- Ordem dos blocos respeita dependências: colunas de pedidos/lojas antes da RPC
-- final; tabelas de opcionais antes da RPC que as referencia; helpers antes das
-- policies que os usam.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 003500 — unique index: uma loja por dono (lojas_dono_unico)
create unique index if not exists lojas_dono_unico on public.lojas (dono_id);


-- ═══ 004000 — fn_loja_por_email_dono (webhook Hotmart: comprador→loja)
create or replace function public.loja_por_email_dono(p_email text)
  returns setof public.lojas
  language sql
  stable
  security definer
  set search_path = public
as $$
  select l.*
  from public.lojas l
  join auth.users u on u.id = l.dono_id
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

revoke all on function public.loja_por_email_dono(text) from public, anon, authenticated;
grant execute on function public.loja_por_email_dono(text) to service_role;


-- ═══ 004500 — lojas_protege_billing (trigger BEFORE UPDATE protege billing/identidade)
create or replace function public.lojas_protege_billing()
returns trigger
language plpgsql
as $$
begin
  -- Autor é o sistema (webhook Hotmart via service_role, ou migrations/backfill).
  if current_user = 'service_role'
     or current_user = 'postgres'
     or current_user = 'supabase_admin' then
    return new;
  end if;

  -- Demais autores (dono autenticado etc.) não podem tocar billing/identidade.
  if new.assinatura_status        is distinct from old.assinatura_status
     or new.assinatura_inicio         is distinct from old.assinatura_inicio
     or new.assinatura_fim_periodo    is distinct from old.assinatura_fim_periodo
     or new.assinatura_atualizada_em  is distinct from old.assinatura_atualizada_em
     or new.hotmart_subscriber_code   is distinct from old.hotmart_subscriber_code
     or new.hotmart_plano             is distinct from old.hotmart_plano
     or new.dono_id                   is distinct from old.dono_id then
    raise exception 'colunas de billing/identidade são somente-servidor (use o webhook Hotmart)';
  end if;

  return new;
end;
$$;

drop trigger if exists lojas_protege_billing_trg on public.lojas;
create trigger lojas_protege_billing_trg
  before update on public.lojas
  for each row
  execute function public.lojas_protege_billing();


-- ═══ 005500 — pedidos.tipo_entrega + pedidos.troco_para
-- (ADD COLUMN IF NOT EXISTS; CHECK adicionado via guard em pg_constraint)
alter table public.pedidos
  add column if not exists tipo_entrega text not null default 'entrega';

alter table public.pedidos
  add column if not exists troco_para numeric(10, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pedidos_tipo_entrega_check'
  ) then
    alter table public.pedidos
      add constraint pedidos_tipo_entrega_check
      check (tipo_entrega in ('retirada', 'entrega'));
  end if;
end $$;


-- ═══ 006000 — lojas.taxa_entrega_fora_zona
alter table public.lojas
  add column if not exists taxa_entrega_fora_zona numeric(10, 2);


-- ═══ 005000+006000 — vitrine_lojas (VERSÃO FINAL de 006000: assinatura + taxa fora zona)
-- create or replace view não permite mudar a lista de colunas → drop + create.
drop view if exists public.vitrine_lojas;

create view public.vitrine_lojas
  with (security_invoker = false)
as
  select
    id,
    slug,
    nome,
    telefone,
    whatsapp,
    ativo,
    endereco_rua,
    endereco_numero,
    endereco_bairro,
    endereco_cidade,
    endereco_estado,
    endereco_cep,
    tema,
    horarios,
    timezone,
    assinatura_status,
    assinatura_fim_periodo,
    taxa_entrega_fora_zona
  from public.lojas
  where ativo = true;

grant select on public.vitrine_lojas to anon, authenticated;


-- ═══ 006500 — storage bucket `pix-qr` + policies RLS
-- No cloud o schema `storage` existe; guard mantido por segurança (no-op se ausente).
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice '[074] storage.objects não existe — bloco storage pix-qr ignorado.';
    return;
  end if;

  -- Bucket público (CDN serve QR Pix sem token na vitrine).
  insert into storage.buckets (id, name, public)
  values ('pix-qr', 'pix-qr', true)
  on conflict (id) do nothing;
end $$;

-- Policies de storage.objects: DROP + CREATE (policy não tem OR REPLACE).
-- Guardadas por DO porque storage.objects pode não existir (ambiente sem storage).
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists "storage_pix_qr_leitura_publica" on storage.objects;
  create policy "storage_pix_qr_leitura_publica"
    on storage.objects for select
    using (bucket_id = 'pix-qr');

  drop policy if exists "storage_pix_qr_insert_propria" on storage.objects;
  create policy "storage_pix_qr_insert_propria"
    on storage.objects for insert
    with check (
      bucket_id = 'pix-qr'
      and (storage.foldername(name))[1] in (
        select id::text from public.lojas where dono_id = auth.uid()
      )
    );

  drop policy if exists "storage_pix_qr_update_propria" on storage.objects;
  create policy "storage_pix_qr_update_propria"
    on storage.objects for update
    using (
      bucket_id = 'pix-qr'
      and (storage.foldername(name))[1] in (
        select id::text from public.lojas where dono_id = auth.uid()
      )
    )
    with check (
      bucket_id = 'pix-qr'
      and (storage.foldername(name))[1] in (
        select id::text from public.lojas where dono_id = auth.uid()
      )
    );

  drop policy if exists "storage_pix_qr_delete_propria" on storage.objects;
  create policy "storage_pix_qr_delete_propria"
    on storage.objects for delete
    using (
      bucket_id = 'pix-qr'
      and (storage.foldername(name))[1] in (
        select id::text from public.lojas where dono_id = auth.uid()
      )
    );
end $$;


-- ═══ 007500 — tabelas de OPCIONAIS (4) + índices + RLS + helper
-- Pré-requisito p/ FK composta: UNIQUE (id, loja_id) em categorias.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'categorias_id_loja_unique'
  ) then
    alter table public.categorias
      add constraint categorias_id_loja_unique unique (id, loja_id);
  end if;
end $$;

-- opcionais_categorias
create table if not exists public.opcionais_categorias (
  id        uuid primary key default gen_random_uuid(),
  loja_id   uuid not null references public.lojas (id) on delete cascade,
  nome      text not null,
  ordem     int not null default 0,
  criado_em timestamptz not null default now(),
  unique (id, loja_id)
);
create index if not exists opcionais_categorias_loja_id_ordem_idx
  on public.opcionais_categorias (loja_id, ordem);

-- opcionais
create table if not exists public.opcionais (
  id                    uuid primary key default gen_random_uuid(),
  loja_id               uuid not null references public.lojas (id) on delete cascade,
  categoria_opcional_id uuid not null references public.opcionais_categorias (id) on delete cascade,
  nome                  text not null,
  preco                 numeric(10, 2) not null check (preco >= 0),
  ativo                 boolean not null default true,
  ordem                 int not null default 0,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index if not exists opcionais_loja_id_categoria_opcional_id_ativo_ordem_idx
  on public.opcionais (loja_id, categoria_opcional_id, ativo, ordem);

-- categoria_produto_opcionais (FKs COMPOSTAS mesma-loja)
create table if not exists public.categoria_produto_opcionais (
  id                    uuid primary key default gen_random_uuid(),
  loja_id               uuid not null references public.lojas (id) on delete cascade,
  categoria_id          uuid not null,
  categoria_opcional_id uuid not null,
  unique (categoria_id, categoria_opcional_id),
  foreign key (categoria_id, loja_id)
    references public.categorias (id, loja_id) on delete cascade,
  foreign key (categoria_opcional_id, loja_id)
    references public.opcionais_categorias (id, loja_id) on delete cascade
);
create index if not exists categoria_produto_opcionais_loja_id_categoria_id_idx
  on public.categoria_produto_opcionais (loja_id, categoria_id);

-- itens_pedido_opcionais (snapshot por item do pedido)
create table if not exists public.itens_pedido_opcionais (
  id             uuid primary key default gen_random_uuid(),
  item_pedido_id uuid not null references public.itens_pedido (id) on delete cascade,
  opcional_id    uuid references public.opcionais (id) on delete set null,
  nome_snapshot  text not null,
  preco_snapshot numeric(10, 2) not null check (preco_snapshot >= 0),
  quantidade     int not null check (quantidade > 0)
);
create index if not exists itens_pedido_opcionais_item_pedido_id_idx
  on public.itens_pedido_opcionais (item_pedido_id);

-- RLS (idempotente: enable não falha se já habilitado)
alter table public.opcionais_categorias        enable row level security;
alter table public.opcionais                   enable row level security;
alter table public.categoria_produto_opcionais enable row level security;
alter table public.itens_pedido_opcionais      enable row level security;

-- opcionais_categorias — leitura pública (loja ativa) + escrita do dono
drop policy if exists "opc_cat_leitura_publica" on public.opcionais_categorias;
create policy "opc_cat_leitura_publica"
  on public.opcionais_categorias for select
  using (public.loja_esta_ativa(opcionais_categorias.loja_id));

drop policy if exists "opc_cat_escrita_propria" on public.opcionais_categorias;
create policy "opc_cat_escrita_propria"
  on public.opcionais_categorias for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = opcionais_categorias.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = opcionais_categorias.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- opcionais — leitura pública (ativo+loja ativa) + leitura própria + escrita do dono
drop policy if exists "opcionais_leitura_publica" on public.opcionais;
create policy "opcionais_leitura_publica"
  on public.opcionais for select
  using (
    ativo = true
    and public.loja_esta_ativa(opcionais.loja_id)
  );

drop policy if exists "opcionais_leitura_propria" on public.opcionais;
create policy "opcionais_leitura_propria"
  on public.opcionais for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = opcionais.loja_id and lojas.dono_id = auth.uid()
    )
  );

drop policy if exists "opcionais_escrita_propria" on public.opcionais;
create policy "opcionais_escrita_propria"
  on public.opcionais for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = opcionais.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = opcionais.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- categoria_produto_opcionais — leitura pública + escrita do dono (reforço cross-loja)
drop policy if exists "cat_prod_opc_leitura_publica" on public.categoria_produto_opcionais;
create policy "cat_prod_opc_leitura_publica"
  on public.categoria_produto_opcionais for select
  using (public.loja_esta_ativa(categoria_produto_opcionais.loja_id));

drop policy if exists "cat_prod_opc_escrita_propria" on public.categoria_produto_opcionais;
create policy "cat_prod_opc_escrita_propria"
  on public.categoria_produto_opcionais for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = categoria_produto_opcionais.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = categoria_produto_opcionais.loja_id and lojas.dono_id = auth.uid()
    )
    and exists (
      select 1 from public.categorias c
      where c.id = categoria_produto_opcionais.categoria_id
        and c.loja_id = categoria_produto_opcionais.loja_id
    )
    and exists (
      select 1 from public.opcionais_categorias oc
      where oc.id = categoria_produto_opcionais.categoria_opcional_id
        and oc.loja_id = categoria_produto_opcionais.loja_id
    )
  );

-- helper: item_pedido_aceita_opcionais (security definer — anti-enumeração)
create or replace function public.item_pedido_aceita_opcionais(p_item_pedido_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.itens_pedido ip
    join public.pedidos p on p.id = ip.pedido_id
    where ip.id = p_item_pedido_id
      and p.status = 'pendente'
      and public.loja_esta_ativa(p.loja_id)
  );
$$;

revoke all on function public.item_pedido_aceita_opcionais(uuid) from public;
grant execute on function public.item_pedido_aceita_opcionais(uuid) to anon, authenticated, service_role;

-- itens_pedido_opcionais — insert público via helper + leitura só do lojista dono
drop policy if exists "ipo_insert_publico" on public.itens_pedido_opcionais;
create policy "ipo_insert_publico"
  on public.itens_pedido_opcionais for insert
  with check (public.item_pedido_aceita_opcionais(itens_pedido_opcionais.item_pedido_id));

drop policy if exists "ipo_leitura_lojista" on public.itens_pedido_opcionais;
create policy "ipo_leitura_lojista"
  on public.itens_pedido_opcionais for select
  using (
    exists (
      select 1 from public.itens_pedido ip
      join public.pedidos p on p.id = ip.pedido_id
      join public.lojas l on l.id = p.loja_id
      where ip.id = itens_pedido_opcionais.item_pedido_id and l.dono_id = auth.uid()
    )
  );


-- ═══ 003000+007000+008000 — public.criar_pedido (VERSÃO FINAL de 008000)
-- Colapsado: NÃO recria as versões intermediárias. DROP cobre AS DUAS assinaturas
-- antigas (13 args de 003000 e 15 args de 007000) antes do CREATE final.
drop function if exists public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb
);
drop function if exists public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
);

create or replace function public.criar_pedido(
  p_loja_id          uuid,
  p_nome_cliente     text,
  p_telefone_cliente text,
  p_endereco_entrega jsonb,
  p_forma_pagamento  text,
  p_observacoes      text,
  p_subtotal         numeric,
  p_taxa_entrega     numeric,
  p_desconto         numeric,
  p_total            numeric,
  p_cupom_id         uuid,
  p_cupom_codigo     text,
  p_itens            jsonb,
  p_tipo_entrega     text,
  p_troco_para       numeric
)
  returns table (pedido_id uuid, token_acesso uuid)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_desconto     numeric := p_desconto;
  v_total        numeric := p_total;
  v_cupom_codigo text    := p_cupom_codigo;
  v_pedido_id    uuid;
  v_token        uuid;
  v_item         jsonb;
  v_item_id      uuid;
begin
  -- (1) defesa em profundidade: loja inativa abortada no banco, não só na action.
  if not public.loja_esta_ativa(p_loja_id) then
    raise exception 'loja_inativa';
  end if;

  -- (2) trava atômica de cupom (anti over-use / race). 0 linhas ⇒ esgotou na
  --     corrida ⇒ anula desconto, zera código e recomputa total (D5).
  if p_cupom_id is not null then
    update public.cupons
       set usos_contagem = usos_contagem + 1
     where id = p_cupom_id
       and (usos_maximos is null or usos_contagem < usos_maximos);
    if not found then
      v_desconto := 0;
      v_cupom_codigo := null;
      v_total := p_subtotal + p_taxa_entrega;
    end if;
  end if;

  -- (3) INSERT pedido (token_acesso via DEFAULT gen_random_uuid()).
  --     tipo_entrega/troco_para persistidos como recebidos da action (RN-C2/C3).
  insert into public.pedidos (
    loja_id, nome_cliente, telefone_cliente, endereco_entrega,
    subtotal, desconto, taxa_entrega, total, forma_pagamento,
    cupom_codigo, observacoes, status, tipo_entrega, troco_para
  )
  values (
    p_loja_id, p_nome_cliente, p_telefone_cliente, p_endereco_entrega,
    p_subtotal, v_desconto, p_taxa_entrega, v_total, p_forma_pagamento,
    v_cupom_codigo, p_observacoes, 'pendente', p_tipo_entrega, p_troco_para
  )
  returning id, public.pedidos.token_acesso into v_pedido_id, v_token;

  -- (4) INSERT itens com SNAPSHOT (nome/preco vêm do banco via action, não do
  --     cliente) + seus opcionais (RN-O6), na MESMA transação. Itera item a item
  --     para amarrar cada opcional ao id do `itens_pedido` recém-inserido.
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade)
    values (
      v_pedido_id,
      (v_item->>'produto_id')::uuid,
      v_item->>'nome',
      (v_item->>'preco')::numeric,
      (v_item->>'quantidade')::int
    )
    returning id into v_item_id;

    -- Opcionais do item (snapshot imutável). Ausente/[] ⇒ nada a inserir.
    if jsonb_typeof(v_item->'opcionais') = 'array' then
      insert into public.itens_pedido_opcionais (
        item_pedido_id, opcional_id, nome_snapshot, preco_snapshot, quantidade
      )
      select v_item_id,
             (o->>'opcional_id')::uuid,
             o->>'nome_snapshot',
             (o->>'preco_snapshot')::numeric,
             (o->>'quantidade')::int
      from jsonb_array_elements(v_item->'opcionais') as o;
    end if;
  end loop;

  return query select v_pedido_id, v_token;
end;
$$;

revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
) from public;
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
) from anon, authenticated;
grant execute on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIM. Após rodar no cloud, regenere os tipos locais:
--   pnpm supabase gen types typescript --local > src/types/supabase.ts
-- (ou --project-id gdlegxatwylhkjcrusyk para apontar ao cloud)
-- ═══════════════════════════════════════════════════════════════════════════
