# [126] Parametrizar `FormCupom` com `acoes?` (criar/atualizar)

**crítica:** NÃO
**Mundo:** painel (componente compartilhado)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rota 5)

## Objetivo
Permitir injetar as actions de criação/edição de cupom (default = actions do lojista) para reuso no contexto admin, sem duplicar o formulário nem a validação.

## Escopo
- [ ] `FormCupom`: adicionar prop opcional `acoes?: { criar; atualizar }`; usar `acoes?.criar ?? criarCupom` e `acoes?.atualizar ?? atualizarCupom`.
- [ ] Manter `cupomSchema` como validação isomórfica (inalterada).

## Fora de escopo
Actions admin (134). `CuponsClient` (127). Wrapper admin (136).

## Reuso esperado
- `cupomSchema` de `lib/validacoes/cupom.ts`.
- `criarCupom`/`atualizarCupom` de `lib/actions/cupom.ts` (default).

## Segurança
- O valor do cupom é definição comercial, não valor cobrado. A autoridade de quanto o cliente paga permanece no checkout (`validarCupom` + `criar_pedido`). Este prop só troca a action de persistência; a validação zod + CHECK do banco continuam.

## Critério de aceite
- [ ] Sem `acoes`, comportamento idêntico ao atual (zero regressão no painel).
- [ ] Com `acoes` injetada, o form chama as actions fornecidas.
