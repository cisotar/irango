# Arquitetura — iRango

**Versão:** 0.2.16 | **Atualizado:** 2026-07-08

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
│   │   │       ├── layout.tsx            # guard de sessão/email/loja (decidirAcessoBase) + chrome
│   │   │       ├── assinatura-bloqueada/ # paywall — FORA do route group (bloqueavel), nunca gated (anti-loop)
│   │   │       ├── manifest.webmanifest/
│   │   │       │   └── route.ts          # manifest PWA do painel (auth obrigatório; force-dynamic; Cache-Control: private, no-store)
│   │   │       ├── configuracoes/
│   │   │       │   └── assinatura/       # gestão da própria assinatura — FORA do (bloqueavel), nunca gated (anti-loop)
│   │   │       └── (bloqueavel)/         # route group: layout aninhado aplica só decidirAssinatura (issue 142)
│   │   │           ├── layout.tsx        # guard de assinatura (decidirAssinatura) — sem chrome, sem sessão
│   │   │           ├── page.tsx          # dashboard
│   │   │           ├── produtos/
│   │   │           ├── cupons/
│   │   │           ├── pedidos/
│   │   │           └── configuracoes/
│   │   │               ├── perfil/       # nome, slug, telefone, whatsapp
│   │   │               ├── horarios/
│   │   │               ├── entregas/     # zonas e taxas
│   │   │               ├── pagamentos/   # formas aceitas
│   │   │               └── tema/         # cores da vitrine
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
│   │       ├── manifestPainel.ts         # montarManifestPainel(loja|null) → ManifestPainel; puro (sem I/O)
│   │       ├── fotoSegura.ts             # fotoSegura(url?): string|null — fonte única da invariante anti-XSS §15 (só https vira src)
│   │       └── metricasPedidos.ts        # calcularMetricasDoDia(pedidos) + chaveDia(data); puro; extraído do Dashboard do lojista, reuso previsto pelo Dashboard admin (issues 122/138)
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
- **Guard de painel:** dois layouts em camada, posicionais. `app/(painel)/painel/layout.tsx` decide sessão/email/loja (`decidirAcessoBase`) e monta o chrome; o route group aninhado `app/(painel)/painel/(bloqueavel)/layout.tsx` decide só a assinatura (`decidirAssinatura`) sobre as rotas que estão posicionalmente dentro dele. Telas isentas do paywall (`assinatura-bloqueada/`, `configuracoes/assinatura/`) ficam fora do grupo por estrutura de pastas — isenção não depende de header de rota (achado #3B do pentest 2026-07-08, ver `seguranca.md` §4)
- **Vitrine pública:** sem auth — `app/(publica)` usa `supabase/server.ts` sem verificar sessão
- **Guard admin do SaaS:** `verificarAdminSaaS()` (`src/lib/auth/admin.ts`) — fail-closed, compara `user.id` contra `SAAS_ADMIN_USER_ID` server-only. Usado em `admin/assinantes/layout.tsx` (guard de subárvore) e direto em `admin/page.tsx` (guard de page isolada, opção A — ver `seguranca.md` §7)

### Fluxo de login

```
/login → supabase.auth.signInWithPassword() → cookie setado → redirect /painel
```

O callback OAuth (`app/(auth)/auth/callback/route.ts`) bifurca o destino pós-login pela identidade: sem `next` explícito, dono do SaaS (`user.id === SAAS_ADMIN_USER_ID`, via `ehAdminSaaS()`) → `/admin` (hub de seleção); qualquer outro usuário → `/painel`, como hoje. `next` explícito sanitizado sempre tem prioridade sobre esse destino padrão.

### Fluxo de proteção do painel

```
middleware.ts → só refresh de sessão/cookie — não decide acesso, não propaga header de rota
painel/layout.tsx → decidirAcessoBase(user, loja)
    → sem sessão → redirect /login
    → email não confirmado → redirect /confirmar-email
    → sem loja (user órfão) → auto-cura + redirect /painel
    → ok → chrome (Sidebar/Topbar) + children
(bloqueavel)/layout.tsx (aninhado, só sob esse route group) → decidirAssinatura(loja, agora)
    → bloqueada → redirect /painel/assinatura-bloqueada
    → ok → children (herda o chrome do layout pai)
```

A isenção do paywall é **posicional** — `assinatura-bloqueada/` e `configuracoes/assinatura/` vivem fora de `(bloqueavel)/`, então nunca passam por `decidirAssinatura` (anti-loop). Detalhe da migração em `seguranca.md` §4.

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

### Entitlement de módulo pago (por feature)

```ts
// lib/utils/variantesHabilitadas.ts — única fonte de verdade do mapa módulo→feature
// Pura, sem I/O; recebe a loja (flags já lidas sob RLS/loader). Mesmo caminho
// para o painel do lojista e o hub admin — nenhum dos dois reimplementa o mapa
variantesHabilitadas(loja: Pick<LojaCompleta, "modulo_impressao_a4" | "modulo_impressao_termica"> | null): VarianteImpressao[]
```

Primeiro primitivo do projeto de **entitlement por feature** (até então o gate de acesso era só global — `assinatura_status` via `decidirAssinatura`/`assinaturaPermiteAcesso`, `lib/utils/acessoPainel.ts`). Padrão: flag booleana por módulo pago em `lojas` (billing-controlled, ver `seguranca.md` §2), decidida por um util puro server-autoritativo e fail-closed (dúvida sobre a flag → não habilita), consumido igualmente por painel e admin. O Server Component só recebe a lista já decidida e renderiza — ou **não renderiza** — o bloco correspondente; nunca esconde por CSS uma variante não habilitada. Próximo módulo pago que precisar de gate por-feature segue o mesmo desenho: coluna booleana em `lojas` + util puro em `lib/utils/` + trigger `lojas_protege_billing()` estendido.

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
- `components/painel/` → exclusivos do dashboard do lojista; parametrizados com action por prop (default = action do lojista), permitindo reuso no contexto admin sem duplicar componente. O shell de navegação segue o mesmo princípio: `NavPainel.tsx` (`SidebarPainel`/`TopbarPainel`) recebe um `contexto?` opcional (`basePath`/`título`/flags de menu; default = comportamento do painel do lojista) — o painel do lojista é a fonte única do front, o hub admin (`/admin/assinantes/[lojaId]`) reusa o mesmo shell por parametrização, nunca por cópia de markup

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
| Painel admin do SaaS (`/admin/assinantes`) | implementado (issues 083–102): criação de loja e gestão completa em nome do lojista via service_role + verificarAdminSaaS() | — |
| Idempotência em `criarPedido` | `idempotency_key uuid` em `pedidos` + índice UNIQUE PARCIAL; client gera via `crypto.randomUUID()` por carrinho/sessão; RPC faz dedupe antes da trava de cupom | implementado (issue 063) |
| Reconciliação CEP↔bairro no frete | bairro vem do form; não validado contra CEP real — cliente pode forçar zona mais barata | issue 064 |
| Guard `email_confirmed_at` no painel | loja nasce `ativo=false`; acesso ao painel deve checar confirmação de email antes de liberar operações | issue 016 |
| Reconciliação de user órfão | signUp pode criar `auth.user` sem loja se a action falhar após o signUp; limpeza não implementada | issue 065 |
| Log de auditoria de acesso admin a PII | implementado (issues 146/147): tabela `admin_acessos` (RLS deny-all, só `service_role` — migration `20260707122000`) + `registrarAcessoAdmin` (`admin-loja.ts`) faz INSERT best-effort fire-and-forget; log quebrado nunca derruba a action chamadora — ver `seguranca.md` §Padrão admin | resíduo — fase futura: policy de SELECT admin + retenção/consulta do log |
| TOCTOU sem lock otimista em `atualizarStatusPedidoAdmin` | UPDATE filtra só por `loja_id`+`id`, sem condicionar pelo status lido; dois admins concorrentes podem gerar last-write-wins silencioso. Prioridade baixa — herdado do padrão do lojista | issue 133 |
| `isolamento-admin.test.ts` sem `atualizarStatusPedidoAdmin` na lista manual de imports | cobertura por invocação já existe em arquivo dedicado; falta paridade de auto-cobertura | issue 133 |
| `token_acesso` incluído no `select("*")` das listagens de pedido admin | capability tipo-senha do checkout público trafega em loaders admin que não precisam dela; pré-existente, não regressão desta feature | issue 130 |
| `pertenceALoja` triplicada | mesma fórmula de prova de posse (`escopo.buscarPorId(tabela, id, "id")` + `data != null`) reimplementada em `admin-produtos.ts` e 2x em `admin-opcionais.ts` | issue 135 |
| Tipo `Resultado` duplicado (`admin-opcionais.ts`/`admin-produtos.ts`) | mesmo shape `{ok:true}\|{ok:false;erro}` sem módulo neutro compartilhado (ao contrário de `cupom-erros.ts`/`status.ts`) | issue 135 |
| DELETE+INSERT não transacional em `salvarAssociacaoOpcionaisAdmin` | falha de INSERT após DELETE commitado deixa associação parcialmente removida; não é vetor cross-tenant, mesmo padrão do CRUD do lojista | issue 135 |
