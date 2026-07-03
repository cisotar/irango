# [137] Wrapper `OpcionaisAdminClient` (injeta as 8 actions admin com `lojaId` fixado)

**crítica:** NÃO
**Mundo:** painel admin (auth admin)
**Depende de:** 128, 135
**Spec:** specs/paridade-hub-admin-painel.md (rota 6)

## Objetivo
Client wrapper que injeta as 8 variantes `*Admin` (com `lojaId` fixado em closure) no `OpcionaisClient` compartilhado.

## Escopo
- [ ] Criar `src/app/admin/assinantes/[lojaId]/produtos/opcionais/OpcionaisAdminClient.tsx` (`'use client'`) que recebe `lojaId` + dados agregados e renderiza `<OpcionaisClient acoes={{ ...8 actions }} />` com as actions admin em closure.

## Fora de escopo
Actions admin (135). Page/loader (142). Nenhum markup próprio (usa `OpcionaisClient`).

## Reuso esperado
- `OpcionaisClient` parametrizado (128).
- Actions de `admin-opcionais.ts` (135).

## Segurança
- `lojaId` fixado em closure é só o 1º argumento; autoridade é a Server Action. Wrapper não é barreira.

## Critério de aceite
- [ ] Nenhum markup copiado de `OpcionaisClient` — componente compartilhado único.
- [ ] As 8 operações chamam as variantes `*Admin` com o `lojaId` correto.
