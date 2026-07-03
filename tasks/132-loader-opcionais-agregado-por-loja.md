# [132] Loader agregado de opcionais + `opcionaisPorCategoria` escopado por `lojaId`

**crítica:** SIM (TDD red-first)
**Mundo:** infra (query server-only)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rotas 6 e 7 e §Modelos)

## Objetivo
Criar a leitura escopada por `lojaId` sob `service_role` de: categorias de opcional, opcionais, categorias de produto, associações e `opcionaisPorCategoria`. Fonte de dados compartilhada pelas rotas Opcionais (6) e Cardápio (7) do admin — um loader, sem duplicação.

## Escopo
- [ ] Criar variantes `(svc, lojaId)` das queries de opcionais em `lib/supabase/queries/opcionais.ts` (categorias de opcional, opcionais, associações) com `.eq("loja_id", lojaId)` explícito.
- [ ] Montar/estender o loader do hub admin (`[lojaId]/carga.ts` ou módulo dedicado) para expor o agregado de opcionais + `opcionaisPorCategoria`, reusando `buscarCategorias`/`buscarProdutosDoLojista` onde já aceitam `(client, lojaId)`.

## Fora de escopo
Pages (142/143). Actions admin (135). Wrappers (137).

## Reuso esperado
- Queries de opcionais existentes como referência de projeção.
- Queries que já aceitam `(client, lojaId)` — reusar, não recriar.
- Client `service_role` de `lib/supabase/service.ts`.

## Segurança
- Cross-tenant: `service_role` bypassa RLS — isolação só pelo `.eq("loja_id", lojaId)` em cada ponta. Preço de opcional é dado autoritativo do servidor; a leitura não pode misturar biblioteca de outra loja.

## Critério de aceite
- [ ] (RED-first) Teste de isolamento: agregado de opcionais/`opcionaisPorCategoria` de loja A nunca contém item/associação da loja B.
- [ ] Agregado de loja A é idêntico ao que o dono de A vê no painel de opcionais.
