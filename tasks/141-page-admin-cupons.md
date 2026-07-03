# [141] Page admin: Cupons — `/admin/assinantes/[lojaId]/cupons`

**crítica:** NÃO
**Mundo:** painel admin (auth admin)
**Depende de:** 131, 136
**Spec:** specs/paridade-hub-admin-painel.md (rota 5)

## Objetivo
Página de cupons da loja-alvo, consumindo o `CuponsClient` compartilhado via `CuponsAdminClient`.

## Escopo
- [ ] Criar `src/app/admin/assinantes/[lojaId]/cupons/page.tsx` (Server Component) que carrega via `listarCuponsDaLoja(svc, lojaId)` e renderiza `<CuponsAdminClient lojaId={lojaId} cupons={...} />`.

## Fora de escopo
Actions (134). Wrapper (136). Loader (131). Shell/nav (145).

## Reuso esperado
- `CuponsAdminClient` (136), `listarCuponsDaLoja` (131).

## Segurança
- Leitura escopada por `lojaId`; cupom nunca tem SELECT público. Escrita e validação vivem nas actions admin (134).

## Critério de aceite
- [ ] Lista/CRUD de cupons escopados à loja-alvo funcionam via wrapper admin.
- [ ] Nenhum markup copiado do painel — usa `CuponsClient`. Zero regressão no painel do lojista.
