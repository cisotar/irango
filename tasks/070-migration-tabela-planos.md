# [070] Migration: tabela `planos` + RLS

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Criar a tabela `planos` (catálogo de planos com preço autoritativo) com RLS, base para todo o fluxo de cobrança. `lojas.plano_id` referencia esta tabela, então ela vem primeiro.

## Escopo
- [ ] Migration `supabase/migrations/20260621090000_planos.sql` criando a tabela conforme o spec (Modelos de Dados → "Nova tabela `planos`").
- [ ] Colunas: `id`, `nome`, `preco numeric(10,2) NOT NULL CHECK (preco >= 0)`, `intervalo text CHECK IN ('mensal','anual') DEFAULT 'mensal'`, `provider_price_id text`, `ativo boolean DEFAULT true`, `criado_em timestamptz DEFAULT now()`.
- [ ] `ALTER TABLE planos ENABLE ROW LEVEL SECURITY;`
- [ ] Policy SELECT: `authenticated` apenas onde `ativo = true`.
- [ ] Escrita (INSERT/UPDATE/DELETE) deny-all para `anon` e `authenticated` — só `service_role`/migration. Sem policy de escrita = deny por padrão; garantir GRANTs coerentes com o padrão do projeto (`grants_roles_supabase`).
- [ ] Seed mínimo do plano único mensal (DA-3) via migration ou `seed.sql` (preço placeholder, `ativo = true`).

## Fora de escopo
Colunas de `lojas` (issue 073). Telas. Server Actions.

## Reuso esperado
- Padrão de RLS deny-all de `webhook_eventos_hotmart` (`schema.md` §4) como referência de escrita travada.
- Convenção `numeric(10,2)` para dinheiro (`schema.md` §6).
- Padrão de GRANTs de `20260614008500_grants_roles_supabase.sql`.

## Segurança
- `preco` é valor monetário AUTORITATIVO — única fonte do valor cobrado (RN-1). Lojista nunca escreve. RLS de escrita deny-all é invariante de segurança → crítica.
- Vazamento entre planos não se aplica (catálogo semipúblico), mas SELECT deve restringir a `ativo = true` para não expor planos retirados.

## Critério de aceite
- [ ] Teste RED (pglite) escrito antes: `authenticated` consegue `SELECT` plano `ativo=true`, NÃO consegue ler `ativo=false`, e qualquer `INSERT/UPDATE/DELETE` por `authenticated`/`anon` é rejeitado; `service_role` escreve.
- [ ] `CHECK (preco >= 0)` rejeita preço negativo.
- [ ] Tipos regenerados (`supabase gen types typescript`) incluem `planos`.
