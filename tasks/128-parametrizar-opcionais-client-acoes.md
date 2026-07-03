# [128] Parametrizar `OpcionaisClient` com `acoes?` (8 actions)

**crítica:** NÃO
**Mundo:** painel (componente compartilhado)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rota 6)

## Objetivo
Permitir injetar as 8 actions de opcionais (default = actions do lojista) para reuso admin, sem duplicar a biblioteca/associação de opcionais.

## Escopo
- [ ] `OpcionaisClient`: adicionar prop opcional `acoes?` cobrindo `criarCategoriaOpcional`, `atualizarCategoriaOpcional`, `removerCategoriaOpcional`, `criarOpcional`, `atualizarOpcional`, `alternarOpcionalAtivo`, `removerOpcional`, `salvarAssociacaoOpcionais`.
- [ ] Cada uso interno passa a `acoes?.X ?? Xlojista` (default = import atual de `lib/actions/opcional`).

## Fora de escopo
Actions admin (135). Wrapper `OpcionaisAdminClient` (137). Loader admin (132).

## Reuso esperado
- Actions do lojista em `lib/actions/opcional.ts` (defaults).
- `schemaOpcional`/`schemaCategoriaOpcional` de `lib/validacoes/opcional.ts`.

## Segurança
- Orquestração de UI. Preço do opcional é valor autoritativo do servidor (snapshot no checkout); este prop só troca a action de persistência, sem afrouxar validação zod/CHECK nem a prova de posse no servidor.

## Critério de aceite
- [ ] Sem `acoes`, comportamento idêntico ao atual (zero regressão no painel).
- [ ] Com `acoes` injetada, as 8 operações chamam as actions fornecidas.
