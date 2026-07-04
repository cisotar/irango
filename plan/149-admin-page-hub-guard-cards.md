## Plano Técnico

### Análise do Codebase

O que já existe e será reusado (nenhum arquivo novo de lógica — só a page e seu teste):

- `src/lib/auth/admin.ts` → `verificarAdminSaaS()` — guard fail-closed, `async`, lança `"acesso negado"` quando `user.id !== SAAS_ADMIN_USER_ID` ou env ausente. **Reusar exatamente**, sem reimplementar identidade. Não usar `ehAdminSaaS()` aqui (é o helper síncrono/fail-safe do callback 148, sem `getUser()` — impróprio para gate de página).
- `src/app/admin/assinantes/layout.tsx` — **modelo canônico** do padrão a copiar: `try { await verificarAdminSaaS(); } catch { redirect("/painel"); }`, `metadata` com `robots: { index: false, follow: false }`, e a decisão deliberada (issue 145) de **não** envolver conteúdo em `<main>`. Seguir estrutura, comentários e tratamento fail-closed idênticos.
- `src/components/ui/card.tsx` — `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` (shadcn; `components/ui/` não se edita à mão). Tokens já embutidos (`bg-card`, `ring-foreground/10`, `font-heading`).
- `next/link` (`Link`), `next/navigation` (`redirect`), `lucide-react` (`Store`, `Users`) — já no projeto (usados em `assinantes/page.tsx` e `[lojaId]/layout.tsx`).
- Padrão de container de página: `assinantes/page.tsx` usa `<main className="mx-auto w-full max-w-6xl ... px-4 py-8">` com `<header>` (`font-heading text-2xl`) — reusar como referência de shell da nova page.
- Padrão de teste de page Server Component: `assinantes/[lojaId]/pedidos/[id]/page.test.tsx` (invoca o default export como função `async` e inspeciona o elemento retornado) + mock de guard como em `isolamento-admin.test.ts` (`vi.mock("@/lib/auth/admin", ...)`) + mock de `next/navigation` que faz `redirect` lançar (como `notFound` em `isolamento-admin.test.ts`).

O que precisa ser criado:

- `src/app/admin/page.tsx` — Server Component (a rota `/admin` hoje é 404; esta issue fecha o gap deixado pelo callback 148 que já manda o dono para `/admin`). Justificativa: não há page raiz de `/admin` hoje; o guard vive em `assinantes/layout.tsx` e não cobre `/admin` (opção A do spec, escolhida — não elevar para `admin/layout.tsx`).
- `src/app/admin/page.test.tsx` — teste do guard + fiação dos cards.

### Cenários

**Caminho Feliz:**
1. Dono do SaaS (sessão cujo `user.id === SAAS_ADMIN_USER_ID`) navega para `/admin`.
2. `await verificarAdminSaaS()` resolve sem lançar.
3. Page renderiza `<main>` com dois cards em grid: "Minha loja" (ícone `Store`) → `<Link href="/painel">` e "Clientes" (ícone `Users`) → `<Link href="/admin/assinantes">`.
4. Cliente clica num card → navegação client-side padrão do Next; a autoridade do destino é reavaliada no servidor lá (guard de sessão em `/painel`; `verificarAdminSaaS` em `assinantes/layout.tsx`).

**Casos de Borda:**
- **Não-admin (lojista comum autenticado):** `verificarAdminSaaS()` lança → `catch` → `redirect("/painel")`. Nenhum card renderizado.
- **Sessão inválida / anônimo:** idem — `getUser()` retorna `null` → lança → redirect.
- **`SAAS_ADMIN_USER_ID` ausente/vazia:** `obterAdminUserId()` lança dentro de `verificarAdminSaaS()` (fail-closed, D-5) → catch → redirect. (Contraste intencional com o callback 148, que é fail-safe — aqui é gate de rota, portanto fail-closed.)
- **Falha de rede no `getUser()`:** o erro cai no mesmo `catch` genérico → redirect fail-closed. Nada admin renderiza.

**Tratamento de Erros:** o usuário nunca vê mensagem de erro — apenas o redirect silencioso para `/painel`. O detalhe (`user?.id ?? "anon"`) já é logado por `console.error` dentro de `verificarAdminSaaS()` (`seguranca.md` §14). A page **não** adiciona log próprio nem repassa o motivo ao cliente.

### `redirect()` dentro de `try/catch` (ponto de atenção)

Decisão documentada: **o `try` envolve SOMENTE `await verificarAdminSaaS()`; o `redirect("/painel")` fica no bloco `catch`.** Como o `catch` não está aninhado em outro `try`, o `NEXT_REDIRECT` que `redirect()` lança **propaga para fora da função** (não é reengolido). É exatamente o padrão já em produção em `assinantes/layout.tsx` — não introduzir `catch` genérico em volta do corpo inteiro da page, e nunca colocar o `return` dos cards dentro do `try`. O comentário no código deve registrar que o try é estreito de propósito.

### Schema de Banco

Não se aplica — a issue não toca dados. Nenhuma tabela, coluna, migration ou RLS nova (identidade do dono é env `SAAS_ADMIN_USER_ID`, não registro). A defesa de `/admin/*` é o guard `verificarAdminSaaS()` no servidor, não RLS (`seguranca.md` §7).

### Validação (zod)

Não se aplica — sem entrada de usuário, sem form, sem Server Action.

### Recálculo no Servidor

Não se aplica — sem valor monetário, sem checkout/cupom/frete.

### Regra cliente ↔ servidor (mapa de enforcement)

| Invariante | Camada que garante |
|-----------|--------------------|
| `/admin` só renderiza para o dono do SaaS (`user.id === SAAS_ADMIN_USER_ID`) | **Servidor** — `verificarAdminSaaS()` no topo de `src/app/admin/page.tsx` (Server Component), fail-closed → `redirect("/painel")` |
| Não-admin/anon/env ausente não vê nada de admin | **Servidor** — mesmo guard; `return` dos cards só é alcançado após o guard resolver |
| Cards levam a `/painel` e `/admin/assinantes` | **Cliente** (navegação/UX pura) — não concedem autoridade; cada destino reavalia no servidor |
| `SAAS_ADMIN_USER_ID` server-only | Já garantido por `admin.ts` (`import "server-only"`, sem `NEXT_PUBLIC_`) — page não expõe a env |

Não há regra de valor/permissão delegada ao cliente: o único gate é 100% servidor.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/app/admin/page.tsx` — Server Component. Estrutura: `metadata` (noindex, copiando `assinantes/layout.tsx`); `export default async function AdminHubPage()`; `try { await verificarAdminSaaS(); } catch { redirect("/painel"); }`; `return` com `<main>` container + grid de 2 cards (`Card` > `CardHeader` > ícone + `CardTitle` + `CardDescription`), cada card dentro de `<Link>`. Visual guiado por `design-claude/` (grid responsivo `grid gap-4 sm:grid-cols-2`, tokens Tailwind v4 de `globals.css @theme`; sem `tailwind.config.ts`).
- `src/app/admin/page.test.tsx` — fase RED. Casos: (a) admin ok → default export resolve, retorna elemento, `redirect` NÃO chamado; (b) `verificarAdminSaaS` rejeita → `redirect("/painel")` chamado (mock de `redirect` lança sentinela `NEXT_REDIRECT` e o teste espera `rejects` + `redirect` chamado com `"/painel"`); (c) fiação dos dois `<Link>` (`href` `/painel` e `/admin/assinantes`).

**NÃO tocar:**
- `src/app/admin/assinantes/layout.tsx` — opção B (elevar guard para `admin/layout.tsx`) está fora de escopo; não duplicar nem mover guard (issue 145).
- `src/components/ui/card.tsx` e demais `components/ui/` — shadcn, não editar à mão.
- `src/lib/auth/admin.ts` — reusar como está; não adicionar helper novo.
- Suítes `enforcement-escopo-admin.test.ts` / `isolamento-admin.test.ts` — não devem regredir (não há Server Action nem `service_role` novos).

### Dependências Externas

Nenhuma nova. Tudo já em `package.json`: `next` (App Router, `redirect`/`Link`), `lucide-react`, shadcn `card`. Padrões: [Next.js App Router — `redirect`](https://nextjs.org/docs/app/api-reference/functions/redirect) (lança `NEXT_REDIRECT`, por isso o try deve ser estreito).

### Ordem de Implementação

Issue **crítica** → RED-first:
1. **`/tdd` (RED):** escrever `src/app/admin/page.test.tsx` com os 3 casos (admin renderiza / não-admin redireciona / fiação dos links) e confirmar falha real (page ainda não existe).
2. **`/execute` (GREEN):** criar `src/app/admin/page.tsx` (guard + cards) — mínimo para passar; depois ajustar visual conforme `design-claude/`.
3. Rodar `vitest` (verde) e **`next build`** (obrigatório — Server Component novo; e memória: Server Actions/consts exportadas só quebram no build; aqui não há action, mas o build valida a page).
