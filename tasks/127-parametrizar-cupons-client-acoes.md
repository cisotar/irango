# [127] Parametrizar `CuponsClient` com `acoes?` (remover + repassar ao FormCupom)

**crítica:** NÃO
**Mundo:** painel (componente compartilhado)
**Depende de:** 126
**Spec:** specs/paridade-hub-admin-painel.md (rota 5)

## Objetivo
Permitir injetar `removerCupom` (e repassar criar/atualizar ao `FormCupom`) para reuso admin, sem duplicar a listagem.

## Escopo
- [ ] `CuponsClient`: adicionar prop opcional `acoes?: { remover; criar; atualizar }`; usar `acoes?.remover ?? removerCupom` e repassar `{ criar, atualizar }` ao `FormCupom`.

## Fora de escopo
Actions admin (134). Wrapper `CuponsAdminClient` (136). Loader admin (131).

## Reuso esperado
- `FormCupom` parametrizado (126).
- `removerCupom` de `lib/actions/cupom.ts` (default).

## Segurança
- Apresentação/orquestração. Cupom nunca tem SELECT público; a lista chega do servidor escopada. Autoridade de valor cobrado inalterada.

## Critério de aceite
- [ ] Sem `acoes`, comportamento idêntico ao atual (zero regressão no painel).
- [ ] Com `acoes` injetada, listar/criar/editar/remover chamam as actions fornecidas.
