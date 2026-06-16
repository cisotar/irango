# [005] Query server-only: buscar coords da loja via service_role

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 001
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Criar uma query reutilizável que lê apenas `latitude`/`longitude` da tabela base `lojas` por `loja_id`, usando o client `service_role` — sem expor coords na `vitrine_lojas`. Consumida tanto pelo preview (`calcularFreteAction`) quanto pelo autoritativo (`criarPedido`).

## Escopo
- [ ] Função em `lib/supabase/queries/lojas.ts` (ex.: `buscarCoordsLoja(svc, lojaId): Promise<{ latitude: number; longitude: number } | null>`).
- [ ] `SELECT latitude, longitude FROM lojas WHERE id = $1` — apenas as duas colunas.
- [ ] Retorna `null` quando a loja não tem coords (`latitude`/`longitude` NULL) ou não existe.
- [ ] Recebe o client por parâmetro (service_role); a query NÃO instancia o client.

## Fora de escopo
- Geocoding do CEP do cliente (issues 006/007).
- Qualquer escrita de coords (issue 008).
- Adicionar coords à view `vitrine_lojas` — proibido por design.

## Reuso esperado
- `lib/supabase/queries/lojas.ts` existente — adicionar a função junto às demais (não criar `.from('lojas')` inline nas actions, conforme convenção DRY de queries).
- Padrão de isolamento de dado sensível via service_role já usado por `criarPedido`.

## Segurança
- RN-4 / spec §"Como o preview obtém as coords": coords são internas ao servidor; só acessíveis via service_role. Não regride a privacidade da view pública.
- Caller é responsável por escopar por `loja_id` correto.

## Critério de aceite
- [ ] (teste vermelho primeiro) Teste pglite/RLS: a função retorna o par quando a loja tem coords; `null` quando NULL; e confirma que `vitrine_lojas` NÃO contém as colunas de coords.
- [ ] `pnpm test` verde após implementação.
