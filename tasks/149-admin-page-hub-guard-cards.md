# [149] Hub `/admin`: guard fail-closed + dois cards de navegação

**crítica:** SIM (TDD red-first)
**Mundo:** painel (admin `/admin/*`)
**Depende de:** 148
**Spec:** specs/hub-selecao-admin-saas.md

## Objetivo
Criar `src/app/admin/page.tsx` (Server Component) como hub de seleção do dono do SaaS: prova a identidade no servidor com guard fail-closed e, só então, renderiza dois cards de navegação — "Minha loja" → `/painel` e "Clientes" → `/admin/assinantes`.

## Escopo
- [ ] Criar `src/app/admin/page.tsx` como Server Component (opção A do spec: guard direto na page, sem elevar para `layout.tsx`).
- [ ] No topo, `verificarAdminSaaS()` dentro de `try/catch`; no catch → `redirect("/painel")` (mesmo tratamento fail-closed das rotas `/admin/*`). Nenhum dado admin renderizado em falha.
- [ ] Renderizar dois cards com shadcn/ui (`Card`/`CardHeader`/`CardTitle`/`CardDescription`), cada um envolto por `<Link>`:
  - "Minha loja" → `/painel` (ícone de loja `lucide-react`).
  - "Clientes" → `/admin/assinantes` (ícone de usuários/grupo `lucide-react`).
- [ ] Visual guiado por `design-claude/` (fonte única); tokens de tema via classes Tailwind v4 (`globals.css @theme`, sem `tailwind.config.ts`).

## Fora de escopo
- Elevar guard para `src/app/admin/layout.tsx` (opção B) — não fazer; não tocar `assinantes/layout.tsx` (issue 145).
- Métricas/resumo no hub (nº assinantes, receita) — v1 é só seleção.
- Renomear a rota `/admin/assinantes` — o card só rotula "Clientes".
- Qualquer leitura de `lojas`/`pedidos` ou outra tabela.

## Reuso esperado
- `src/lib/auth/admin.ts` — `verificarAdminSaaS()` (fail-closed; **não** reimplementar checagem de identidade).
- `components/ui/` (shadcn) — `Card` e derivados.
- `next/link`, `lucide-react` — já no projeto.
- `redirect` de `next/navigation`.

## Segurança
- Gate 100% servidor: page só renderiza após `verificarAdminSaaS()` provar `user.id === SAAS_ADMIN_USER_ID`.
- **Fail-closed:** não-admin, sessão inválida ou env ausente → `redirect("/painel")`, sem vazar nada.
- Cards são navegação pura (preview de UX) — não concedem autoridade; cada destino reavalia no servidor.
- Nenhuma tabela nova → nenhuma RLS nova; não eleva a `service_role` → não regride `enforcement-escopo-admin.test.ts` / `isolamento-admin.test.ts`.
- `SAAS_ADMIN_USER_ID` permanece server-only.

## Critério de aceite
- [ ] Dono do SaaS acessa `/admin` e vê os dois cards.
- [ ] Não-admin / sessão inválida / env ausente acessa `/admin` → redirecionado a `/painel`, sem render de dado admin.
- [ ] Clicar "Minha loja" navega para `/painel`; clicar "Clientes" navega para `/admin/assinantes`.
- [ ] `next build` verde.
- [ ] (crítica) teste vermelho do guard (redirect em não-admin) escrito antes da implementação, depois verde.
