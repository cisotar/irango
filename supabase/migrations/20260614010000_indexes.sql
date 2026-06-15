-- Indexes de performance (references/schema.md §3)
--
-- Cobre apenas os indexes ainda NÃO criados por migrations anteriores:
--   - lojas(slug) UNIQUE ............ já: coluna `slug ... unique` (schema_inicial)
--   - lojas(dono_id) UNIQUE ......... já: 20260614003500_unique_loja_por_dono.sql
--   - pedidos(loja_id, idempotency_key) WHERE ... já: 20260614009000
--   - cupons(loja_id, codigo) UNIQUE  já: constraint `unique (loja_id, codigo)` (schema_inicial)
--   - opcionais_*/categoria_produto_*/itens_pedido_* ... já: 20260614007500
--
-- Idempotente: CREATE INDEX IF NOT EXISTS.

-- Produtos por loja (listagem do painel e vitrine)
create index if not exists produtos_loja_disponivel_ordem
  on public.produtos (loja_id, disponivel, ordem);

-- Categorias por loja
create index if not exists categorias_loja_ordem
  on public.categorias (loja_id, ordem);

-- Pedidos por loja ordenados por data (dashboard)
create index if not exists pedidos_loja_criado_em
  on public.pedidos (loja_id, criado_em desc);

-- Zonas de entrega por loja
create index if not exists zonas_entrega_loja
  on public.zonas_entrega (loja_id);

-- Bairros por zona
create index if not exists bairros_zona_zona
  on public.bairros_zona (zona_id);
