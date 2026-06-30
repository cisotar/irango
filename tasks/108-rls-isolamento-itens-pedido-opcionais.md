# 108 — Teste de isolamento RLS: itens_pedido_opcionais

crítica: SIM (RLS multitenant)
origem: débito da auditoria da issue 103

## Contexto

A issue 103 verificou a leitura própria do dono nas 3 tabelas de **biblioteca** de opcionais
(`opcionais`, `opcionais_categorias`, `categoria_produto_opcionais`) e confirmou no-op.

A auditoria apontou uma 4ª tabela **fora do escopo da 103**: `itens_pedido_opcionais`
(`supabase/migrations/20260614007500_opcionais.sql:207-222`), que guarda snapshot de
opcionais escolhidos num pedido (dado de cliente). Policies:
- `ipo_insert_publico` — INSERT anon via helper definer
- `ipo_leitura_lojista` — SELECT só do dono via `item → pedido → loja → dono`

Não há teste de isolamento provando que o dono A não lê os opcionais dos pedidos do dono B.

## Escopo

- Criar `tests/migrations/rls_itens_pedido_opcionais.test.ts` (espelha `rls_opcionais_leitura_propria.test.ts`).
- Casos: dono A lê opcionais dos próprios pedidos; dono A NÃO lê de pedidos da loja B (isolamento cross-loja); anon não lê (sem SELECT público).
- Provavelmente no-op de produção (policy já existe) — RED sintético pra comprovar poder de detecção.
- Sem migration nova esperada; se faltar policy, é migration aditiva (nunca service_role/using(true)).

## Critérios
- [ ] Teste de isolamento criado e verde
- [ ] RED sintético comprovado (derruba policy → vermelho → restaura)
- [ ] Veredito: no-op documentado OU migration de policy aditiva
