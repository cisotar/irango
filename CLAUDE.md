# iRango — guia de sessão

Marketplace SaaS multitenant (modelo iFood) em Next.js 16 + TypeScript + Supabase + Tailwind v4 + shadcn/ui. Vitrine pública em `/loja/[slug]` (sem login), painel do lojista em `/painel/*`, hub admin em `/admin/*`. O SaaS não processa pagamento. Domínio em português.

## Realidade de ambiente — leia antes de qualquer comando

- **`npm`, nunca `pnpm`.** Lockfile é `package-lock.json`. Supabase CLI sempre via `npx supabase`.
- **`npm run dev` roda contra o Supabase cloud** (`.env.local`). Não existe Postgres local no runtime. Migration só em `supabase/migrations/` e não aplicada no cloud → `PGRST204` em runtime mesmo com build e testes verdes. Deploy de migration (`npx supabase db push`) é irreversível: pedir autorização.
- **Testes em Vitest + pglite**, `environment: node`, sem jsdom, sem Docker, sem `supabase start`. RLS e migrations são testadas em `tests/migrations/` via `createTestDb()` de `tests/helpers/pglite.ts` (`asAnon`/`asUser`/`asService`). Teste unitário fica ao lado do módulo.
- **Tipos gerados em `src/lib/database.types.ts`** (`npx supabase gen types typescript > src/lib/database.types.ts`). `src/types/supabase.ts` está morto: não importar, não regenerar.
- **Server Actions** em `src/lib/actions/` (lojista e público) e `src/app/admin/assinantes/actions/` (admin). Queries em `src/lib/supabase/queries/`. Schemas zod em `src/lib/validacoes/`.
- **Guard do painel é nos layouts**, não no middleware. `middleware.ts` só refresha sessão. Ver `references/architecture.md` §5.

## Comandos

```bash
npm run dev        # app local → cloud
npx tsc --noEmit   # 1º passo do CI
npm run lint       # 2º passo do CI — 0 erros. O CI roda tsc → lint → test → build; o gate local espelha os quatro
npm test           # suíte inteira (vitest run); com pouca memória: npx vitest run --maxWorkers=2
npm run build      # obrigatório antes de fechar: const exportada em 'use server' só quebra aqui
npx vitest run <arquivo>
npx supabase migration list   # coluna Remote vazia = migration só-local
gh pr checks <n>   # nada está "pronto" com check do CI vermelho
```

## Qual skill usar

| Mudança | Skill |
|---|---|
| Só visual: copy, cor, espaçamento, ícone, classe Tailwind | `/polir` |
| Correção pontual, ≤3 arquivos, sem RLS/migration/auth/valor monetário | `/fix` |
| Qualquer outra coisa: feature, schema, Server Action de valor, auth | `/fluxo` |

Cada skill tem critérios de escalonamento no próprio arquivo em `.claude/commands/`. Na dúvida, `/fluxo`.

Skills de manutenção (fora do ciclo de feature):

| Skill | Faz |
|---|---|
| `/pr` | gates finais + abre o PR para `main`; nunca faz merge |
| `/triar` | reconcilia `tasks/`, `specs/`, débitos do `architecture.md` §10 e GitHub com o código; só fecha com evidência |
| `/sincronizar-agentes` | verifica se `.claude/` ainda descreve o repo (caminhos, comandos, libs, seções) e corrige o drift |
| `/atualizar-deps` | `npm outdated` + `npm audit`, um bump por vez com build e suíte; major vira issue |

## Agentes

18 agentes em `.claude/agents/`, descritos em `.claude/agents/README.md`. Antes de disparar vários agentes para uma tarefa fora do `/fluxo`, use `orquestrar`: ele devolve o plano mais barato e seguro com reuso do que já existe. Ciclo por issue no `/fluxo`: planejar → `tdd` (só issue crítica) → `executar` → `revisar` ‖ `testar` ‖ `auditar` [‖ `acelerar`] → `verificar` → `escriba`. `pentester` é sob demanda.

## Referências — leia antes de propor escopo

| Arquivo | Quando |
|---|---|
| `references/architecture.md` | sempre: stack, pastas, auth, fluxos, convenções, débitos |
| `references/seguranca.md` | qualquer coisa com RLS, valor monetário, secret, upload, admin |
| `references/schema.md` | qualquer coisa que leia ou escreva no banco |
| `references/modelo-negocio.md` | escopo de produto, cobrança, LGPD, roadmap |
| `references/design-system.md` | qualquer componente ou tela |

Specs em `specs/` (concluídas em `specs/arquivo/`), issues em `tasks/`, planos em `plan/`, auditorias de performance em `performance/`.

## Três mandatos

1. **Nunca confiar no cliente.** Valor monetário é recalculado no servidor a partir do banco (`seguranca.md` §10). Permissão é RLS, não UI oculta. Cupom validado em Server Action escopada por `loja_id`.
2. **Não reinventar a roda.** Antes de criar: `grep` em `lib/utils/`, `lib/validacoes/`, `lib/supabase/queries/`, `components/`. Lib madura já em `package.json` vence código artesanal. `components/ui/` é gerado pelo shadcn CLI: não editar à mão.
3. **TDD red-first em código crítico.** Dinheiro, RLS, cupom, token de pedido, autorização: teste vermelho com output `FAIL` capturado antes de qualquer código de produção.

## Higiene

- Nunca `git add -A`. Nunca commitar `.env*`. Nenhum email, telefone, chave Pix ou CPF real em código, comentário ou seed.
- Erro interno não vaza pro cliente: mensagem genérica na UI, detalhe no log do servidor.
- Commits na branch ativa; nunca trocar de branch no meio de um fluxo.
