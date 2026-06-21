# Arquitetura — iRango

**Versão:** 0.2.7 | **Atualizado:** 2026-06-19

> Guia técnico de referência. Leia antes de abrir qualquer PR. Documenta decisões tomadas e o porquê delas.

---

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Stack Tecnológica](#2-stack-tecnológica)
3. [Estrutura de Pastas](#3-estrutura-de-pastas)
4. [Modelo Multitenant](#4-modelo-multitenant)
5. [Autenticação e Autorização](#5-autenticação-e-autorização)
6. [Fluxos Principais](#6-fluxos-principais)
7. [Libs e Ferramentas](#7-libs-e-ferramentas)
8. [Convenções de Código](#8-convenções-de-código)
9. [Princípios de Desenvolvimento](#9-princípios-de-desenvolvimento)
10. [Débitos Técnicos e Limitações Conhecidas](#10-débitos-técnicos-e-limitações-conhecidas)

---

## 1. Visão Geral

iRango é um **marketplace SaaS multitenant** no modelo iFood — lojistas cadastram suas lojas, configuram catálogo, frete e formas de pagamento. Clientes acessam a vitrine pública de cada loja e fazem pedidos. **O SaaS não intermedia pagamentos** — cada lojista recebe diretamente via Pix, link ou dinheiro.

### Dois mundos distintos

| Mundo | URL | Público | Auth |
|-------|-----|---------|------|
| Vitrine pública | `/loja/[slug]` | clientes finais | sem login |
| Painel do lojista | `/painel/*` | donos de loja | obrigatório |

---

## 2. Stack Tecnológica

| Camada | Tecnologia | Justificativa |
|--------|-----------|---------------|
| Framework | **Next.js 16 (App Router)** | SSR pra SEO do catálogo, Server Actions, Image optimization nativa |
| Linguagem | **TypeScript** | tipos gerados do schema Supabase — zero `any` manual |
| Backend | **Supabase** | Postgres + Auth + Storage + Realtime + RLS multitenant |
| Estilização | **Tailwind CSS v4** | utility-first; tokens CSS-first em `src/app/globals.css` (`@theme`), sem `tailwind.config.ts` |
| Componentes | **shadcn/ui** | Radix UI + Tailwind, sem dependência opaca |
| Forms | **react-hook-form** + **zod** | validação isomórfica (mesma regra no client e server action) |
| Toast | **sonner** | recomendado pelo shadcn |
| Ícones | **lucide-react** | usado pelo shadcn, consistência garantida |
| Color picker | **react-colorful** | 2kb, zero deps |
| Máscaras input | **react-imask** | CEP, telefone, WhatsApp |
| CEP | **ViaCEP** (API pública) | autocomplete de endereço, zero custo |
| PWA / Service Worker | **serwist** + **@serwist/turbopack** | SW compilado pelo Turbopack via esbuild, sem artefato em `public/`; runtimeCaching com exclusão explícita de `/painel/*` |
| Hosting | **Vercel** | feito pra Next.js, CI/CD automático via GitHub |
| Tipos DB | **supabase gen types typescript** | nunca escrever tipos manualmente |

### Por que Supabase e não Firebase

Firebase cobra por leitura/escrita — marketplace com vitrine pública (bots, indexadores, DDoS) gera leituras ilimitadas e contas imprevisíveis. Supabase Pro = $25/mês fixo independente de volume. DDoS derruba performance mas não gera cobrança extra.

---

## 3. Estrutura de Pastas

```
irango/
├── src/
│   ├── app/
│   │   ├── (publica)/                    # vitrine — sem auth
│   │   │   └── loja/
│   │   │       └── [slug]/
│   │   │           ├── page.tsx          # página da loja (SSR)
│   │   │           ├── manifest.webmanifest/
│   │   │           │   └── route.ts      # manifest PWA da loja (runtime nodejs; anon key + vitrine_lojas)
│   │   │           ├── pedido/
│   │   │           │   └── page.tsx      # checkout
│   │   │           └── confirmacao/
│   │   │               └── page.tsx      # confirmação — lida via id + token_acesso
│   │   │
│   │   ├── (painel)/                     # lojista logado
│   │   │   └── painel/
│   │   │       ├── layout.tsx            # guard de auth
│   │   │       ├── page.tsx              # dashboard
│   │   │       ├── manifest.webmanifest/
│   │   │       │   └── route.ts          # manifest PWA do painel (auth obrigatório; force-dynamic; Cache-Control: private, no-store)
│   │   │       ├── produtos/
│   │   │       ├── cupons/
│   │   │       ├── pedidos/
│   │   │       └── configuracoes/
│   │   │           ├── perfil/           # nome, slug, telefone, whatsapp
│   │   │           ├── horarios/
│   │   │           ├── entregas/         # zonas e taxas
│   │   │           ├── pagamentos/       # formas aceitas
│   │   │           └── tema/             # cores da vitrine
│   │   │
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   └── cadastro/
│   │   │
│   │   ├── serwist/
│   │   │   └── [path]/
│   │   │       └── route.ts              # Route Handler do Service Worker (compila src/app/sw.ts via @serwist/turbopack + esbuild; desligado em dev)
│   │   │
│   │   ├── layout.tsx                    # root layout
│   │   └── page.tsx                      # landing do SaaS
│   │
│   ├── components/
│   │   ├── ui/                           # shadcn/ui (gerado pelo CLI — não editar manualmente)
│   │   ├── vitrine/                      # componentes da loja pública
│   │   │   ├── CardProduto.tsx
│   │   │   ├── Carrinho.tsx
│   │   │   ├── HeaderLoja.tsx
│   │   │   └── BadgeStatus.tsx           # "Aberto agora" / "Fechado"
│   │   ├── painel/                       # componentes do dashboard
│   │   │   ├── TabelaProdutos.tsx
│   │   │   ├── FormProduto.tsx
│   │   │   └── FormCupom.tsx
│   │   └── pwa/                          # componentes de infra PWA (sem visual)
│   │       └── RegistrarSW.tsx           # Client Component que registra /serwist/sw.js; silencioso em dev e em erros
│   │
│   ├── lib/
│   │   ├── pwa/
│   │   │   └── runtimeCaching.ts         # regras de cache do SW em ordem; [0] NetworkOnly /painel* (nunca cacheia rota autenticada); módulo puro — testável no vitest sem globals de SW
│   │   ├── supabase/
│   │   │   ├── client.ts                 # browser client (@supabase/ssr)
│   │   │   ├── server.ts                 # server client (Server Components, Actions)
│   │   │   ├── service.ts                # service_role client (BYPASSRLS) — server-only; ver seguranca.md §7
│   │   │   └── queries/                  # funções de query reutilizáveis
│   │   │       ├── lojas.ts
│   │   │       ├── produtos.ts
│   │   │       └── pedidos.ts
│   │   ├── validacoes/                   # schemas zod — reutilizados no form e na action
│   │   │   ├── produto.ts
│   │   │   ├── cupom.ts
│   │   │   ├── loja.ts
│   │   │   └── pedido.ts
│   │   ├── actions/                      # helpers neutros sem 'use server' compartilhados por Server Actions
│   │   │   ├── upload-imagem.ts          # validarBlobImagem + tipoRealPorConteudo + EXTENSAO_POR_TIPO
│   │   │   │                             # reutilizado por upload.ts e logo.ts — ver §13 seguranca.md
│   │   │   └── distanciaFrete.ts         # distanciaDaLojaAoCep(svc, lojaId, cep) → km | undefined
│   │   │                                 # buscarCoordsLoja(svc) → geocodificarEndereco → haversine
│   │   │                                 # fail-closed: undefined em qualquer falha — ver §12-A seguranca.md
│   │   │                                 # reutilizado por criarPedido (006) e calcularFreteAction (007)
│   │   └── utils/
│   │       ├── formatarMoeda.ts
│   │       ├── calcularFrete.ts
│   │       ├── calcularDesconto.ts       # lógica reaproveitada do lojinhaonline (reescrita em TS)
│   │       ├── calcularTotal.ts
│   │       ├── lojaAberta.ts             # verifica horário de funcionamento
│   │       ├── manifest.ts               # montarIconesManifest + constantes de tema padrão (vitrine e painel)
│   │       └── manifestPainel.ts         # montarManifestPainel(loja|null) → ManifestPainel; puro (sem I/O)
│   │
│   ├── types/
│   │   ├── supabase.ts                   # gerado: pnpm supabase gen types typescript
│   │   └── dominio.ts                    # tipos de negócio extras (enums, unions)
│   │
│   └── hooks/
│       ├── useCarrinho.ts
│       └── useLojaAberta.ts
│
├── supabase/
│   ├── migrations/                       # SQL versionado — nunca editar DB manual
│   │   └── 20260614000129_schema_inicial.sql  # convenção: timestamp Supabase CLI
│   └── seed.sql                          # dados de teste
│
├── references/                           # documentação técnica
│   ├── architecture.md                   # este arquivo
│   ├── schema.md                         # schema Postgres detalhado
│   ├── seguranca.md                      # RLS, auth, isolamento multitenant
│   └── modelo-negocio.md                 # modelo comercial, relação SaaS↔lojista
│
├── middleware.ts                          # auth refresh — padrão @supabase/ssr
├── .env.local
└── package.json
```

---

## 4. Modelo Multitenant

Cada loja é um tenant isolado. O isolamento é garantido por **Row Level Security (RLS)** no Postgres — ver `references/seguranca.md`.

### Rota pública por slug

```
/loja/burger-do-ze   →  app/(publica)/loja/[slug]/page.tsx
```

`page.tsx` faz `SELECT * FROM lojas WHERE slug = $1` — se não existir, `notFound()`.

### Propriedade dos dados

Todo dado tem `loja_id`. RLS garante que lojista logado só acessa dados da própria loja. Ver schema completo em `references/schema.md`.

---

## 5. Autenticação e Autorização

- **Provider:** Supabase Auth (email/senha + Google OAuth)
- **Sessão:** gerenciada por `@supabase/ssr` via cookies HttpOnly
- **Middleware:** `middleware.ts` na raiz — refresha sessão em toda request
- **Guard de painel:** `app/(painel)/painel/layout.tsx` verifica sessão server-side; redireciona pra `/login` se ausente
- **Vitrine pública:** sem auth — `app/(publica)` usa `supabase/server.ts` sem verificar sessão

### Fluxo de login

```
/login → supabase.auth.signInWithPassword() → cookie setado → redirect /painel
```

### Fluxo de proteção do painel

```
middleware.ts → supabase.auth.getUser() → sem sessão → redirect /login
               → com sessão → passa pra route handler
```

---

## 6. Fluxos Principais

### Lojista cadastra produto

1. Painel `/painel/produtos` → clica "Novo Produto"
2. `FormProduto.tsx` com react-hook-form + zod (`lib/validacoes/produto.ts`)
3. Submit → Server Action → `supabase/server.ts` → INSERT em `produtos`
4. RLS verifica `auth.uid() = lojas.dono_id` antes de permitir

### Cliente faz pedido

1. Acessa `/loja/[slug]` → vitrine renderizada via SSR
2. Adiciona ao carrinho (estado local — `useCarrinho`)
3. Preenche endereço → ViaCEP autocomplete
4. Vitrine mostra **preview** de frete/desconto/total (só estimativa de UX)
5. Seleciona forma de pagamento (exibidas conforme config da loja)
6. Finaliza → Server Action:
   - **Ignora todo valor monetário enviado pelo client** — recalcula preço, frete, desconto e total a partir do banco (ver `seguranca.md` §10)
   - Valida cupom no servidor (ver `seguranca.md` §9)
   - INSERT em `pedidos` (com `token_acesso` gerado) + `itens_pedido` (snapshot de nome e preço)
   - Retorna `id` + `token_acesso` ao cliente
7. Redireciona pra `/loja/[slug]/confirmacao?pedido=<id>&token=<token>` — cliente lê a própria confirmação sem login, escopado por token
8. Lojista vê o pedido no painel (futuro: Realtime + push)

> ⚠️ O preview no client é só estética. O valor autoritativo é sempre o do servidor. O cliente nunca define quanto paga — ver `references/seguranca.md` §10.

### Cálculo de frete

```ts
// lib/utils/calcularFrete.ts — única fonte de verdade
// Reutilizado na vitrine (PREVIEW de UX) e na Server Action (valor AUTORITATIVO)
calcularFrete(zonas: ZonaEntrega[], endereco: Endereco): number
```

---

## 7. Libs e Ferramentas

### Regra: não reinventar a roda

Antes de escrever qualquer utilitário, verificar se existe lib consolidada. Consultar documentação oficial.

### Reaproveitamento do lojinhaonline — lógica, não código literal

O `lojinhaonline` é **JavaScript vanilla** (sem framework, sem tipos). O iRango é **TypeScript + React**. Reaproveitar dele significa **portar a lógica de negócio** (cálculo de carrinho, desconto, frete via ViaCEP, máscara de horário), **reescrevendo em TypeScript tipado** — nunca copiar e colar o JS literal. Usar o código antigo como referência de regra de negócio já validada, não como fonte a importar.

| Função | Lib escolhida | Docs |
|--------|--------------|------|
| Components | shadcn/ui | https://ui.shadcn.com |
| Forms | react-hook-form | https://react-hook-form.com |
| Validação | zod | https://zod.dev |
| Supabase SSR | @supabase/ssr | https://supabase.com/docs/guides/auth/server-side/nextjs |
| Tipos gerados | supabase CLI | https://supabase.com/docs/reference/cli/supabase-gen-types |
| Toast | sonner | https://sonner.emilkowal.ski |
| Testes de DB/RLS | @electric-sql/pglite | https://pglite.dev — Postgres in-process, sem Docker; emula `auth.uid()` e roles do Supabase; migrations aplicadas via `tests/helpers/pglite.ts`; testes rodam no vitest |
| Service Worker | serwist + @serwist/turbopack | https://serwist.pages.dev — SW compilado via esbuild, servido em `/serwist/sw.js` same-origin pelo Route Handler; runtimeCaching ordenada: [0] NetworkOnly `/painel*` (invariante de segurança — testável no vitest porque `lib/pwa/runtimeCaching.ts` é módulo puro sem globals de SW) |

---

## 8. Convenções de Código

### Idioma: português

Todo código de domínio em português. Termos técnicos universais mantidos em inglês.

```ts
// ✅ correto
const loja = await buscarLoja(slug)
const itens = pedido.itens_pedido

// ❌ errado
const store = await fetchStore(slug)
const items = order.order_items
```

**Exceções mantidas em inglês:** `id`, `slug`, `type`, `status`, `config`, `layout`, `props`, `ref`, `key`, `index`, `loading`, `error`, `data` — são termos técnicos sem tradução natural no contexto de código.

### DRY — não repetir lógica

- Lógica de negócio → `lib/utils/` — uma função, usada em qualquer lugar
- Validação → `lib/validacoes/` — mesmo schema no form e na Server Action
- Queries → `lib/supabase/queries/` — nunca escrever `.from('produtos').select(...)` inline
- Helper de I/O compartilhado entre actions → `lib/actions/` — módulo neutro (sem `'use server'`); exporta só funções puras de validação/transformação; o I/O em si (upload, DB) fica em cada action. Exemplo: `upload-imagem.ts` reutilizado por `upload.ts` e `logo.ts`

### Componentes

- Componente aparece em 2+ lugares → extrai pra `components/`
- `components/ui/` → shadcn gerado, não editar manualmente
- `components/vitrine/` → exclusivos da loja pública
- `components/painel/` → exclusivos do dashboard do lojista

### Server vs Client

- Default: **Server Component** (sem `'use client'`)
- `'use client'` apenas quando precisa: estado local, eventos DOM, hooks de browser
- Dados sensíveis (queries com RLS) → sempre no servidor

---

## 9. Princípios de Desenvolvimento

1. **Custo previsível** — Supabase Pro $25 fixo. Nenhuma decisão técnica pode introduzir custo variável sem análise.
2. **DRY rigoroso** — código repetido é bug em potencial. Extrair antes de copiar.
3. **Libs consolidadas** — não escrever o que já existe. Checar docs antes de implementar.
4. **Segurança no banco** — RLS é a última linha de defesa. Nunca confiar só no client.
5. **Português no domínio** — consistência com o schema do banco.

---

## 10. Débitos Técnicos e Limitações Conhecidas

| Item | Decisão | Quando revisar |
|------|---------|---------------|
| Notificação de pedido ao lojista | não implementado — fase 1 usa polling manual | fase 2 |
| Domínio próprio por loja | não implementado — fase 1 usa `/loja/[slug]` | fase 2 |
| Subdomínio por loja | não implementado | fase 2 |
| Integração Correios/frete calculado | não implementado — fase 1 só frete fixo | fase 2 |
| Painel super-admin do SaaS | não implementado | fase 2 |
| Idempotência em `criarPedido` | `idempotency_key uuid` em `pedidos` + índice UNIQUE PARCIAL; client gera via `crypto.randomUUID()` por carrinho/sessão; RPC faz dedupe antes da trava de cupom | implementado (issue 063) |
| Reconciliação CEP↔bairro no frete | bairro vem do form; não validado contra CEP real — cliente pode forçar zona mais barata | issue 064 |
| Guard `email_confirmed_at` no painel | loja nasce `ativo=false`; acesso ao painel deve checar confirmação de email antes de liberar operações | issue 016 |
| Reconciliação de user órfão | signUp pode criar `auth.user` sem loja se a action falhar após o signUp; limpeza não implementada | issue 065 |
