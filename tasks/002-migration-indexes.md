# [002] Migration de indexes

**crítica:** NÃO
**Mundo:** infra
**Depende de:** 001
**Spec:** specs/spec_irango_mvp.md

## Objetivo
Criar os indexes de performance definidos em `references/schema.md` §3.

## Escopo
- [ ] Criar `supabase/migrations/0002_indexes.sql`
- [ ] `UNIQUE INDEX ON lojas(slug)` (se não coberto pelo `UNIQUE` da coluna)
- [ ] `INDEX ON produtos(loja_id, disponivel, ordem)`
- [ ] `INDEX ON categorias(loja_id, ordem)`
- [ ] `INDEX ON pedidos(loja_id, criado_em DESC)`
- [ ] `UNIQUE INDEX ON cupons(loja_id, codigo)` (se não coberto pelo `UNIQUE` da tabela)
- [ ] `INDEX ON zonas_entrega(loja_id)`
- [ ] `INDEX ON bairros_zona(zona_id)`

## Fora de escopo
RLS, tabelas (001).

## Reuso esperado
- `references/schema.md` §3 — DDL literal

## Segurança
- Nenhuma — apenas performance.

## Critério de aceite
- [ ] `supabase db push` aplica sem erro
- [ ] Indexes existem (`\di` ou query em `pg_indexes`)
