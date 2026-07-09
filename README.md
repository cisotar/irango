# iRango

Marketplace SaaS multitenant (modelo iFood) — lojistas cadastram loja, catálogo, frete e formas de pagamento; clientes compram na vitrine pública sem login. iRango não intermedia pagamento: lojista recebe direto (Pix, link, dinheiro).

## Stack

Next.js 16 (App Router) + TypeScript · Supabase (Postgres/Auth/Storage/RLS) · Tailwind v4 + shadcn/ui (primitivos `@base-ui`) · react-hook-form + zod · Upstash Redis (rate limit) · Serwist (PWA) · Sentry (observabilidade) · Vitest + pglite · Vercel

Detalhes e justificativas em [`references/architecture.md`](references/architecture.md).

## Rodar local

```bash
npm install
cp .env.example .env.local   # preencher com credenciais Supabase
npx supabase db push         # aplicar migrations no projeto cloud
npm run dev
```

Scripts: `npm run dev` · `npm run build` · `npm run lint` · `npm test` / `npm run test:watch`

> Sem instância Docker local — projeto usa Supabase **cloud**. Nunca alterar schema direto no painel; toda mudança é migration versionada em `supabase/migrations/`.

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`references/architecture.md`](references/architecture.md) | stack, estrutura de pastas, multitenancy, fluxos, convenções |
| [`references/schema.md`](references/schema.md) | schema Postgres detalhado |
| [`references/seguranca.md`](references/seguranca.md) | RLS, auth, isolamento multitenant |
| [`references/modelo-negocio.md`](references/modelo-negocio.md) | modelo comercial, relação SaaS↔lojista |
| [`references/design-system.md`](references/design-system.md) | tokens visuais, componentes |

## Fluxo de desenvolvimento

Specs em `specs/`, issues em `tasks/`, agentes especializados em `.claude/agents/` (ver [README dos agentes](.claude/agents/README.md)):

```
especificar → quebrar → planejar (ou arquitetar/migrar) → [tdd RED] → executar GREEN
                                                              └── só issue crítica ──┘
    → [revisar ‖ testar ‖ auditar] → [popular se schema] → verificar → documentar
```

Três mandatos válidos em todo o código:

1. **Nunca confiar no cliente** — valor monetário sempre recalculado no servidor; RLS é a última linha de defesa.
2. **Não reinventar a roda** — reusar `lib/utils/`, `lib/validacoes/`, `lib/supabase/queries/`, `components/` e libs maduras.
3. **TDD red-first** em issue crítica (dinheiro, RLS, cupom, token, autorização).
