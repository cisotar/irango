# [050] Layout e navegação do painel

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 016
**Spec:** specs/spec_irango_mvp.md (Painel)

## Objetivo
Shell de navegação do painel (sidebar/menu) ligando dashboard, pedidos, produtos, cupons e configurações, dentro do layout guard.

## Escopo
- [ ] Estender `src/app/(painel)/painel/layout.tsx` (guard já em 016) com navegação
- [ ] Links: Dashboard, Pedidos, Produtos, Cupons, Configurações (Perfil, Horários, Entregas, Pagamentos, Tema)
- [ ] Botão de logout (`supabase.auth.signOut()`)
- [ ] Indicar item ativo

## Fora de escopo
Guard de auth (16). Páginas individuais (já em suas issues).

## Reuso esperado
- `references/design-system.md`, shadcn/ui, lucide-react

## Segurança
- Navegação não expõe dado sensível; guard já protege o acesso (016).

## Critério de aceite
- [ ] Navegação acessível em todas as rotas do painel; logout encerra sessão e vai a `/login`
