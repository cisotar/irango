# [142] Page admin: Opcionais — `/admin/assinantes/[lojaId]/produtos/opcionais`

**crítica:** NÃO
**Mundo:** painel admin (auth admin)
**Depende de:** 132, 137
**Spec:** specs/paridade-hub-admin-painel.md (rota 6)

## Objetivo
Biblioteca de opcionais + associação da loja-alvo, consumindo o `OpcionaisClient` compartilhado via `OpcionaisAdminClient`.

## Escopo
- [ ] Criar `src/app/admin/assinantes/[lojaId]/produtos/opcionais/page.tsx` (Server Component) que carrega o agregado via loader de opcionais escopado (132) e renderiza `<OpcionaisAdminClient lojaId={lojaId} ...dados />`.

## Fora de escopo
Actions (135). Wrapper (137). Loader (132). Cardápio/fiação (143). Shell/nav (145).

## Reuso esperado
- `OpcionaisAdminClient` (137), loader de opcionais escopado (132).

## Segurança
- Leitura escopada por `lojaId`. Preço/posse validados nas actions admin (135).

## Critério de aceite
- [ ] Biblioteca + associação escopadas à loja-alvo funcionam via wrapper admin.
- [ ] Nenhum markup copiado do painel — usa `OpcionaisClient`. Zero regressão no painel do lojista.
