# [038] Landing do SaaS `/`

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 016
**Spec:** specs/spec_irango_mvp.md (Landing)

## Objetivo
Landing estática (SSG) de apresentação do produto com CTAs para `/cadastro`. Usuário autenticado é redirecionado a `/painel`.

## Escopo
- [ ] Criar/ajustar `src/app/page.tsx` (SSG)
- [ ] HeroLanding (headline, subtítulo, "Crie sua loja grátis" → `/cadastro`)
- [ ] SecaoBeneficios, SecaoCTA
- [ ] Redirecionamento de autenticado → `/painel` (via middleware 016)

## Fora de escopo
Auth (015/016). Páginas legais (LGPD) ficam fora do MVP de funcionalidade.

## Reuso esperado
- `references/design-system.md`, shadcn/ui, lucide-react

## Segurança
- Página pública estática — sem dado sensível.

## Critério de aceite
- [ ] Landing renderiza estática; CTA leva a `/cadastro`
- [ ] Usuário logado em `/` é levado a `/painel`
