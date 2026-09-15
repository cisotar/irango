# [204] Verificação em 360×640 e auditoria de performance da vitrine

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 202, 203
**Spec:** specs/busca-e-navegacao-categorias-vitrine.md

## Objetivo

Fechar a feature com o que não é testável automaticamente neste ambiente
(sem Playwright, sem MCP de browser) e com a auditoria de performance que o
spec exige por ser `'use client'` novo na vitrine mobile-first.

## Escopo

- [ ] Verificação a olho em 360×640, na vitrine real, de: sticky da barra, alvo de
      44px, `scroll-snap`, fade das bordas, scrollspy, foco visível, título de
      categoria visível após a âncora, ausência de scroll horizontal no catálogo.
- [ ] Rodar o agente `acelerar`: bundle da vitrine (orçamento: **zero lib nova, zero
      dependência nova**) e jank de scroll no mobile.
- [ ] Conferir `prefers-reduced-motion`: com movimento reduzido, nenhum scroll suave.
- [ ] Conferir que `ResizeObserver` e `IntersectionObserver` são desconectados no unmount
      (navegar para outra loja e voltar não acumula observers).
- [ ] Achado que exija código vira issue nova; esta issue não implementa feature.

## Fora de escopo

Qualquer behavior novo. Analytics de termo buscado (LGPD, fora da v1).

## Reuso esperado
- `mockups/vitrine-nav-categorias-e-busca.html` como referência visual de comparação.
- Agente `acelerar` (não `auditar`: não há superfície de segurança nova).

## Segurança
- Nada a verificar além do já auditado: zero migration, zero RLS, zero Server Action,
  zero valor monetário. Confirmar apenas que nenhum `dangerouslySetInnerHTML` entrou
  na vitrine e que o termo não é logado nem enviado a lugar nenhum.

## Critério de aceite
- [ ] Checklist de a11y do spec (2.5.5, 2.1.1, 2.4.7, 4.1.3, 3.3.2, 1.4.1, 1.4.3, 1.4.4, 1.4.10, 2.3.3) percorrido item a item com resultado registrado.
- [ ] Relatório do `acelerar` sem regressão de bundle atribuível à feature.
- [ ] Gate completo verde: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
