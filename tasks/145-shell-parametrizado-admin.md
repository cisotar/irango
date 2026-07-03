# [145] Shell parametrizado admin: `SidebarPainel`/`TopbarPainel` + banner, remover `AbasLoja`

**crítica:** NÃO
**Mundo:** infra de layout (painel admin)
**Depende de:** 138, 139, 140, 141, 142, 143, 144
**Spec:** specs/paridade-hub-admin-painel.md (rota 1)

## Objetivo
Fechar a paridade visual: o `[lojaId]/layout.tsx` deixa de renderizar cabeçalho ad-hoc + `AbasLoja` e passa a montar `SidebarPainel`/`TopbarPainel` parametrizados para o contexto admin, com banner persistente. Feito por último, quando todas as rotas do nav já existem.

## Escopo
- [ ] Parametrizar `NavPainel.tsx` por um `contexto` (título, `basePath`, itens computados, flag de ocultar Assinatura, slot para banner); default = comportamento atual do lojista (`/painel`, Assinatura visível, sem banner).
- [ ] Itens admin: Dashboard/Pedidos/Produtos(+Opcionais)/Cupons/Configurações com base `/admin/assinantes/[lojaId]`, Assinatura oculto; ativo derivado de `usePathname` sobre o `basePath`.
- [ ] `[lojaId]/layout.tsx`: montar o shell parametrizado + banner amber persistente ("Você está editando a loja de outro lojista — {nome}") + `Badge` Publicada/Não publicada + link "Voltar para assinantes".
- [ ] Remover `AbasLoja.tsx` e suas referências.

## Fora de escopo
Rota/aba Assinatura no admin (Fora de Escopo v1). Mudança de conteúdo das áreas (já entregues em 138–144).

## Reuso esperado
- `SidebarPainel`/`TopbarPainel` de `components/painel/NavPainel.tsx` (parametrizar, não copiar).
- Bloco amber `role="note"` já existente no layout (elevar a faixa persistente).
- shadcn `Badge`.

## Segurança
- Nav/banner são UX. A barreira real é `verificarAdminSaaS()` no layout (por request) + ausência da rota `.../assinatura`. Ocultar Assinatura não é segurança, é organização.

## Critério de aceite
- [ ] Sidebar/topbar idênticas ao painel, item ativo correto sobre o `basePath` admin; banner visível em todas as áreas; Assinatura ausente.
- [ ] `NavPainel` sem `contexto` mantém o painel do lojista idêntico — zero regressão.
- [ ] `AbasLoja` removido; nenhum link 404 (todas as rotas do nav existem).
