-- Issue 080 — tabelas de OPCIONAIS (4) + índices + RLS por loja + helper
--
-- Migration ADITIVA. Cria a feature de opcionais (biblioteca por loja):
--   opcionais_categorias        — agrupador de opcionais (Laticínios, Doces…)
--   opcionais                   — item da biblioteca (preço autoritativo do servidor)
--   categoria_produto_opcionais — associação categoria de produto ⋈ categoria de opcional
--   itens_pedido_opcionais      — snapshot dos opcionais escolhidos por item do pedido
--
-- Convenções herdadas do schema_inicial / rls_catalogo / rls_cupons_pedidos:
--  - id uuid pk default gen_random_uuid(); timestamptz default now().
--  - CHECK inline para valores autoritativos (preco/preco_snapshot >= 0; quantidade > 0).
--  - `loja_id` redundante em todas as tabelas escopadas para RLS DIRETA por loja.
--  - Leitura pública SEMPRE via `public.loja_esta_ativa()` (nunca EXISTS direto em
--    lojas — seguranca.md §2), espelhando produtos/categorias.
--  - Escrita do dono via `EXISTS (SELECT 1 FROM lojas WHERE id = X.loja_id AND
--    dono_id = auth.uid())`, FOR ALL com USING + WITH CHECK (barra forjar loja_id alheio).
--  - itens_pedido_opcionais espelha itens_pedido: INSERT público via helper
--    security definer (não vaza pedidos ao anon), SELECT só do lojista dono.

-- ═══════════════════════ pré-requisito p/ FK composta (defesa anti cross-loja)
-- categoria_produto_opcionais referencia categorias e opcionais_categorias por
-- (id, loja_id) — FK COMPOSTA — para o banco GARANTIR que ambas as pontas são da
-- MESMA loja da linha (a policy WITH CHECK reforça, mas a FK é à prova de bug de
-- action). FK composta exige um UNIQUE no alvo cobrindo exatamente (id, loja_id).
-- `id` já é PK em categorias; este UNIQUE composto é só o que habilita a FK.
alter table public.categorias
  add constraint categorias_id_loja_unique unique (id, loja_id);

-- ═════════════════════════════════════════════════════════ opcionais_categorias
create table public.opcionais_categorias (
  id        uuid primary key default gen_random_uuid(),
  loja_id   uuid not null references public.lojas (id) on delete cascade,
  nome      text not null,
  ordem     int not null default 0,
  criado_em timestamptz not null default now(),
  -- habilita a FK composta de categoria_produto_opcionais (mesma-loja)
  unique (id, loja_id)
);
create index on public.opcionais_categorias (loja_id, ordem);

-- ════════════════════════════════════════════════════════════════════ opcionais
create table public.opcionais (
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
create index on public.opcionais (loja_id, categoria_opcional_id, ativo, ordem);

-- ════════════════════════════════════════════════ categoria_produto_opcionais
create table public.categoria_produto_opcionais (
  id                    uuid primary key default gen_random_uuid(),
  loja_id               uuid not null references public.lojas (id) on delete cascade,
  categoria_id          uuid not null,
  categoria_opcional_id uuid not null,
  unique (categoria_id, categoria_opcional_id),
  -- FKs COMPOSTAS: forçam que categoria_id e categoria_opcional_id sejam ambos da
  -- MESMA loja_id da linha — barra associação CROSS-LOJA no nível do banco.
  foreign key (categoria_id, loja_id)
    references public.categorias (id, loja_id) on delete cascade,
  foreign key (categoria_opcional_id, loja_id)
    references public.opcionais_categorias (id, loja_id) on delete cascade
);
create index on public.categoria_produto_opcionais (loja_id, categoria_id);

-- ═══════════════════════════════════════════════════════ itens_pedido_opcionais
create table public.itens_pedido_opcionais (
  id             uuid primary key default gen_random_uuid(),
  item_pedido_id uuid not null references public.itens_pedido (id) on delete cascade,
  opcional_id    uuid references public.opcionais (id) on delete set null,
  nome_snapshot  text not null,
  preco_snapshot numeric(10, 2) not null check (preco_snapshot >= 0),
  quantidade     int not null check (quantidade > 0)
);
create index on public.itens_pedido_opcionais (item_pedido_id);

-- ═══════════════════════════════════════════════════════════════════════════ RLS
alter table public.opcionais_categorias        enable row level security;
alter table public.opcionais                   enable row level security;
alter table public.categoria_produto_opcionais enable row level security;
alter table public.itens_pedido_opcionais      enable row level security;

-- ─────────────────────────────────────────────────────── opcionais_categorias
-- Vitrine monta a seção: leitura pública se a loja está ativa. Escrita só do dono.
create policy "opc_cat_leitura_publica"
  on public.opcionais_categorias for select
  using (public.loja_esta_ativa(opcionais_categorias.loja_id));

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

-- ───────────────────────────────────────────────────────────────── opcionais
-- Leitura pública só de ATIVO em loja ativa (espelha produtos_leitura_publica);
-- leitura própria do dono inclui inativos; escrita só do dono.
create policy "opcionais_leitura_publica"
  on public.opcionais for select
  using (
    ativo = true
    and public.loja_esta_ativa(opcionais.loja_id)
  );

create policy "opcionais_leitura_propria"
  on public.opcionais for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = opcionais.loja_id and lojas.dono_id = auth.uid()
    )
  );

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

-- ─────────────────────────────────────────────── categoria_produto_opcionais
create policy "cat_prod_opc_leitura_publica"
  on public.categoria_produto_opcionais for select
  using (public.loja_esta_ativa(categoria_produto_opcionais.loja_id));

-- Escrita do dono. Além do escopo do dono (lojas.dono_id = auth.uid()), o WITH
-- CHECK confirma que categoria_id e categoria_opcional_id são da MESMA loja da
-- linha — reforço da FK composta (defesa em profundidade contra associação
-- cross-loja). USING coerente: dono opera só nas próprias linhas.
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

-- ──────────────────────────────────────────────────── itens_pedido_opcionais
-- Helper security definer: "este item de pedido aceita opcionais?" (o item
-- pertence a um pedido 'pendente' de loja ATIVA). Definer porque o anon NÃO tem
-- SELECT em pedidos/itens_pedido (anti-enumeração) — o EXISTS direto rodaria sob
-- a RLS do anon e retornaria false sempre. Retorna só boolean, não vaza linhas.
-- Mesmo padrão de public.pedido_aceita_itens (reusa loja_esta_ativa).
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

-- Cliente sem login insere os opcionais escolhidos junto com o item do pedido.
-- Amarrado a item de pedido 'pendente' de loja ativa via helper — pedido_id/
-- item_pedido_id não são segredo (vão na URL de confirmação), então o helper
-- impede anexar opcional a item alheio fora do fluxo de checkout legítimo.
create policy "ipo_insert_publico"
  on public.itens_pedido_opcionais for insert
  with check (public.item_pedido_aceita_opcionais(itens_pedido_opcionais.item_pedido_id));

-- Dono vê os opcionais só dos itens dos próprios pedidos, via item → pedido →
-- loja → dono. NENHUMA policy de SELECT para anon.
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
