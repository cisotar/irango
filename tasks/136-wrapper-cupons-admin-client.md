# [136] Wrapper `CuponsAdminClient` (injeta actions admin com `lojaId` fixado)

**crítica:** NÃO
**Mundo:** painel admin (auth admin)
**Depende de:** 127, 134
**Spec:** specs/paridade-hub-admin-painel.md (rota 5)

## Objetivo
Client wrapper que injeta `criarCupomAdmin`/`atualizarCupomAdmin`/`removerCupomAdmin` (com `lojaId` fixado em closure) no `CuponsClient` compartilhado.

## Escopo
- [ ] Criar `src/app/admin/assinantes/[lojaId]/cupons/CuponsAdminClient.tsx` (`'use client'`) que recebe `lojaId` + `cupons` e renderiza `<CuponsClient acoes={{ criar, atualizar, remover }} />` com as actions admin em closure sobre `lojaId`.

## Fora de escopo
Actions admin (134). Page/loader (141). Nenhum markup de cupom próprio (usa `CuponsClient`).

## Reuso esperado
- `CuponsClient` parametrizado (127).
- Actions de `admin-cupom.ts` (134).

## Segurança
- `lojaId` fixado em closure vai como 1º argumento das actions; a autoridade real é a Server Action (revalida `lojaId`, prova admin, escopo). O wrapper não é barreira.

## Critério de aceite
- [ ] Nenhum markup copiado de `CuponsClient` — componente compartilhado único.
- [ ] Cada operação chama a variante `*Admin` com o `lojaId` correto.
