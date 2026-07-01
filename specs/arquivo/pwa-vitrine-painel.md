# Spec: PWA — Vitrine e Painel instaláveis

**Versão:** 0.1.0 | **Atualizado:** 2026-06-19

## Visão Geral

Tornar o iRango instalável como Progressive Web App (PWA) em **dois contextos distintos e independentes**, cada um com nome e ícone próprios:

1. **Vitrine por loja** (`/loja/[slug]`) — cada loja é instalável como um app separado, com o nome e a logo da própria loja. O cliente final "adiciona à tela inicial" a Pizzaria da Vovó como se fosse o app da pizzaria.
2. **Painel do lojista** (`/painel`) — o dono instala o painel da sua loja como app de gestão, identificado como "[nome da loja] · Painel".

Acrescenta também um Service Worker que cacheia assets estáticos (JS, CSS, imagens da vitrine) para resiliência básica e carregamento mais rápido em revisitas.

**Problema que resolve:** acesso recorrente. Cliente fiel reabre a loja com um toque na home screen (sem digitar URL); lojista abre o painel como app dedicado. É um item explícito do roadmap (`modelo-negocio.md` §8, Fase 2 — "App mobile PWA instalável").

**Mundos:**
- Manifest da vitrine → **vitrine pública** (sem auth, anon key + view `vitrine_lojas`).
- Manifest do painel → **painel** (auth obrigatório, cookies server-side, RLS `lojas_leitura_propria`).
- Service Worker → infra global (registrado no client, sem dado sensível).

> Esta feature **não** toca em valor monetário, pedido, cupom ou pagamento. O risco de segurança aqui é de **isolamento de tenant** (um manifest não pode vazar dados de outra loja) e de **cache** (não cachear resposta autenticada/personalizada).

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (SaaS)** | Fornece os ícones genéricos de fallback (vitrine e painel), configura o Service Worker e os route handlers de manifest. Não opera nada em runtime. |
| **Lojista** | Beneficiário do manifest do painel (nome + logo da própria loja). Indiretamente define o manifest da vitrine ao configurar `nome` e `logo_url` da loja. Instala o painel como app. |
| **Cliente** | Instala a vitrine da loja como PWA na tela inicial; navega offline-resiliente nos assets já cacheados. |

## Páginas e Rotas

> PWA não cria "telas" no sentido visual — entrega **route handlers de manifest**, **ícones estáticos** e **wiring de metadata** nos layouts existentes. As "páginas" abaixo são os pontos de integração; os behaviors são as ações de instalação/uso disparadas pelo navegador/usuário.

### Manifest da Vitrine — `/loja/[slug]/manifest.webmanifest`

**Mundo:** vitrine pública (sem auth)
**Arquivo:** `src/app/(publica)/loja/[slug]/manifest.webmanifest/route.ts` (Route Handler GET, runtime `nodejs`)
**Descrição:** Gera dinamicamente o Web App Manifest da loja `[slug]`. O navegador o requisita ao avaliar instalabilidade.

**Conteúdo gerado:**
- `name` / `short_name` = `loja.nome` (truncado para `short_name` se > 12 chars)
- `start_url` = `/loja/[slug]`
- `scope` = `/loja/[slug]`
- `display` = `standalone`
- `id` = `/loja/[slug]` (identidade estável da PWA por loja)
- `theme_color` / `background_color` = `loja.tema.primaria` / `loja.tema.fundo` (já existem no schema)
- `icons` = `loja.logo_url` (192 e 512) quando presente; senão fallback genérico iRango vitrine
- `Content-Type: application/manifest+json`

**Fonte de dados:** `buscarLojaPorSlug(client, slug)` (já existe, lê a **view `vitrine_lojas`** com anon key — nunca a tabela `lojas`). Loja inexistente/inativa → `notFound()` (404).

**Behaviors:**
- [ ] Navegador requisita o manifest ao abrir `/loja/[slug]` — handler responde com JSON do manifest da loja. Garantido em: **Server (Route Handler) + RLS** (view `vitrine_lojas` filtra `ativo = true`).
- [ ] Loja com `logo_url` definida — manifest aponta os ícones para a `logo_url`. Garantido em: **Server (Route Handler)**; `logo_url` vem do banco (não do cliente), já validada `https://%` por CHECK.
- [ ] Loja sem `logo_url` (null) — manifest usa o ícone genérico `/icons/vitrine-{192,512}.png`. Garantido em: **Server (Route Handler)** (fallback no código).
- [ ] Slug inexistente ou loja inativa — handler retorna 404. Garantido em: **Server + RLS** (view só expõe loja ativa).

---

### Manifest do Painel — `/painel/manifest.webmanifest`

**Mundo:** painel (auth obrigatório)
**Arquivo:** `src/app/(painel)/painel/manifest.webmanifest/route.ts` (Route Handler GET, runtime `nodejs`)
**Descrição:** Gera o manifest do painel da loja do **lojista autenticado** (resolvido por cookie de sessão, server-side).

**Conteúdo gerado:**
- `name` = `"[loja.nome] · Painel"` / `short_name` = `"Painel"`
- `start_url` = `/painel`
- `scope` = `/painel`
- `display` = `standalone`
- `id` = `/painel`
- `icons` = `loja.logo_url` quando presente; senão fallback genérico `/icons/painel-{192,512}.png`
- `Content-Type: application/manifest+json`

**Fonte de dados:** sessão via `createClient()` (server, `@supabase/ssr`, cookies) → `buscarLojaDoDono(client)` (já existe, RLS `lojas_leitura_propria` escopa `auth.uid() = dono_id`). Sem sessão → `401`/redirect a `/login`. Dono sem loja → fallback genérico iRango Painel sem nome de loja.

**Behaviors:**
- [ ] Lojista autenticado requisita o manifest — handler responde com o manifest nomeado pela própria loja. Garantido em: **Server (Route Handler) + RLS** (`buscarLojaDoDono` só retorna a loja de `auth.uid()`).
- [ ] Requisição sem sessão — handler não vaza dados de loja; responde 401 (ou manifest genérico sem nome/ícone de loja). Garantido em: **Server + middleware/guard de auth**.
- [ ] Loja do dono com `logo_url` — ícones do painel usam a mesma `logo_url`. Garantido em: **Server (Route Handler) + RLS**.
- [ ] Loja do dono sem `logo_url` — fallback `/icons/painel-*.png`. Garantido em: **Server (Route Handler)**.

---

### Wiring de Metadata — layouts existentes (sem rota nova)

**Mundo:** vitrine pública e painel
**Arquivos:** layout da vitrine (sob `(publica)/loja/[slug]/`) e `(painel)/painel/layout.tsx`
**Descrição:** Injeta `<link rel="manifest">` apontando para o route handler correto de cada mundo, via `generateMetadata` do App Router. Também declara `apple-touch-icon` e `theme-color` para iOS/Android.

**Componentes:** nenhum componente visual novo — só metadata.

**Behaviors:**
- [ ] App Router renderiza `/loja/[slug]` — `generateMetadata` injeta `<link rel="manifest" href="/loja/[slug]/manifest.webmanifest">`. Garantido em: **Server Component** (metadata gerada no SSR).
- [ ] App Router renderiza `/painel` — metadata injeta `<link rel="manifest" href="/painel/manifest.webmanifest">`. Garantido em: **Server Component (layout do painel, já atrás do guard de auth)**.

---

### Service Worker — registro global

**Mundo:** infra (registrado no client, sem auth)
**Arquivos:** config em `next.config.ts` (via `@ducanh2912/next-pwa`); SW gerado em `/public` no build.
**Descrição:** Registra um Service Worker que cacheia assets estáticos (`_next/static/*`, fontes, imagens públicas da vitrine) com estratégia **cache-first para imutáveis** e **network-first/stale-while-revalidate para HTML**. O wrapper `withPWA` é aplicado **dentro** de `withSentryConfig` para não conflitar (ver Regras de Negócio).

**Componentes:** nenhum visual. (Opcional v1: nenhum botão "instalar" custom — usar o prompt nativo do navegador.)

**Behaviors:**
- [ ] Cliente abre a vitrine — navegador registra o SW e cacheia assets estáticos. Garantido em: **cliente (browser)**; nenhum dado autoritativo envolvido.
- [ ] Cliente revisita offline — assets estáticos servidos do cache; conteúdo dinâmico (catálogo, preços) requer rede. Garantido em: **cliente (cache de assets)**. Preços/itens **não** são cacheados como verdade — sempre revalidados via rede (ver Segurança).
- [ ] Deploy novo publica assets com hash diferente — SW busca a versão nova (cache por URL com hash). Garantido em: **cliente (cache versionado por build)**.

## Modelos de Dados

**Nenhuma migration nova. Nenhuma tabela nova. Nenhuma coluna nova.**

A feature consome campos já existentes em `lojas` / `vitrine_lojas`:

| Campo | Tabela/View | Uso |
|-------|-------------|-----|
| `nome` | `vitrine_lojas` (público) / `lojas` (dono) | `name`/`short_name` do manifest |
| `slug` | `vitrine_lojas` | `start_url`/`scope`/`id` da vitrine |
| `logo_url` | `vitrine_lojas` (público) / `lojas` (dono) | `icons` do manifest; já restrita a `https://%` por CHECK |
| `tema` (`primaria`, `fundo`) | `vitrine_lojas` | `theme_color`/`background_color` do manifest da vitrine |

> Como nenhuma tabela é criada, **não há política RLS nova a escrever** (`seguranca.md` §2). O acesso reusa as policies/views já em produção: vitrine lê `vitrine_lojas` (anon); painel lê `lojas` via `lojas_leitura_propria` (auth).

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| **RN-1** — Manifest da vitrine só expõe dados públicos da loja. | **RLS / view** — `buscarLojaPorSlug` lê `vitrine_lojas`, que projeta só colunas públicas e filtra `ativo = true`. Nunca ler `lojas` direto como anon (`seguranca.md` §19). |
| **RN-2** — Manifest do painel só revela a loja do próprio dono. | **RLS** — `buscarLojaDoDono` escopa `auth.uid() = dono_id` (`lojas_leitura_propria`). O `slug`/`nome` de outra loja nunca aparece. |
| **RN-3** — `logo_url` usada como ícone deve ser `https://`. | **CHECK no banco** (`logo_url IS NULL OR logo_url LIKE 'https://%'`) + reuso do remotePattern já em `next.config.ts`. Defesa contra ícone `javascript:`/`http:` (`seguranca.md` §15). |
| **RN-4** — Fallback de ícone quando `logo_url` é null. | **Server (Route Handler)** — código escolhe `/icons/{vitrine,painel}-*.png`. |
| **RN-5** — `short_name` ≤ 12 chars (recomendação PWA). | **Server (Route Handler)** — truncar `nome` ao gerar o manifest. Reusar util existente se houver; senão truncamento trivial inline (não justifica util novo). |
| **RN-6** — Service Worker não cacheia respostas autenticadas nem HTML dinâmico como verdade. | **cliente (config do SW)** — runtimeCaching exclui `/painel/*` autenticado e trata HTML como network-first; só assets imutáveis (`_next/static`, fontes, imagens) vão a cache-first. |
| **RN-7** — `withPWA` não pode quebrar `withSentryConfig`. | **build** — compor `withSentryConfig(withPWA(nextConfig), sentryOpts)`; SW desabilitado em `dev` (`disable: process.env.NODE_ENV === 'development'`) para não conflitar com Turbopack. |
| **RN-8** — CSP não bloqueia o Service Worker. | **config** — a CSP atual é `report-only` e já inclui `script-src 'self'` + `worker-src` herda de `script-src`; validar que o SW (`/sw.js` same-origin) passa. Sem mudança de CSP necessária na v1 (report-only não bloqueia). |

## Segurança (obrigatório)

**Dado sensível que entra/sai:**
- **Vitrine:** apenas dados públicos da loja (nome, slug, logo, cores). Sem PII de cliente, sem chave Pix, sem cupom. Lido via `vitrine_lojas` (anon) — projeção pública por design.
- **Painel:** `nome` + `logo_url` da loja do **dono autenticado**. Resolvido por cookie de sessão server-side, escopado por RLS. **Risco de isolamento:** um manifest do painel jamais pode retornar dados de loja de outro `auth.uid()` → garantido por `buscarLojaDoDono` (RLS `lojas_leitura_propria`). Nunca aceitar `loja_id`/`slug` do query string para escolher a loja do painel — sempre derivar da sessão.

**Valor monetário:** **nenhum.** Esta feature não calcula, exibe nem persiste frete, desconto, total, preço ou pagamento. Não há recálculo de servidor a especificar — o vetor §10 de `seguranca.md` não se aplica.

**Tabela nova:** nenhuma → **nenhuma RLS nova**. Reuso integral das policies/views existentes.

**API externa com key:** nenhuma. Os route handlers de manifest usam o cliente Supabase já configurado (anon na vitrine, sessão no painel). **Não usar `service_role`** em nenhum dos dois handlers — anon/sessão bastam e mantêm o menor privilégio.

**Cache do Service Worker (vetor próprio do PWA):**
- **Não cachear** respostas de `/painel/*` (autenticado/personalizado) nem nenhuma resposta com `Set-Cookie` ou `Authorization` — risco de servir dado de uma sessão a outra. SW só cacheia GET de assets estáticos e imagens públicas.
- **Não cachear** o catálogo/preço como fonte de verdade — preço autoritativo é sempre do servidor no checkout (`seguranca.md` §10); cache de UX nunca define quanto se paga. HTML = network-first.
- O `manifest.webmanifest` do painel deve responder com `Cache-Control: private, no-store` (ou equivalente) para não ser cacheado por proxies/SW compartilhado.

**XSS / injeção via manifest:** `name` e `logo_url` vêm do banco (preenchidos por lojista — não confiáveis, `seguranca.md` §15). Como o manifest é JSON (`application/manifest+json`), o `JSON.stringify` escapa o conteúdo; `logo_url` já é restrita a `https://` por CHECK. Validar protocolo antes de emitir como ícone (defesa em profundidade).

## Fora do Escopo (v1)

- **Push notifications** (Web Push / notificação de pedido ao lojista) — depende de Realtime, é débito técnico Fase 2 (`architecture.md` §10, `modelo-negocio.md` §8).
- **Botão "Instalar app" custom** (capturar `beforeinstallprompt` e UI própria) — v1 usa o prompt nativo do navegador.
- **Modo offline funcional** (criar pedido offline, fila de sincronização) — v1 só cacheia assets; pedido exige rede e recálculo no servidor.
- **Ícones maskable / splash screens iOS dedicadas por densidade** — v1 entrega 192 e 512 (obrigatórios) + `apple-touch-icon`; refinamento de telas de splash é follow-up.
- **Manifest por subdomínio/domínio próprio da loja** — Fase 2/3 (`modelo-negocio.md` §8). v1 só `/loja/[slug]`.
- **Geração automática de ícone a partir da `logo_url`** (redimensionar/normalizar para 192/512 maskable no servidor) — v1 usa a `logo_url` como está; se a logo não tiver tamanho ideal, o navegador escala.
- **Endurecer a CSP para bloquear** (sair de report-only) — fora do escopo desta feature; só garantir que report-only não impede o SW.

---

## Resumo para handoff

- **Páginas/pontos de integração:** 4 (manifest vitrine, manifest painel, wiring de metadata nos 2 layouts, Service Worker).
- **Total de behaviors:** 13.
- **Pontos de segurança críticos:**
  - **Isolamento de tenant no manifest do painel** — deriva a loja da **sessão** (`buscarLojaDoDono` + RLS), nunca de query string. (RN-2)
  - **Manifest da vitrine só lê `vitrine_lojas`** (anon, projeção pública), nunca `lojas`. (RN-1)
  - **Service Worker não cacheia `/painel/*` nem respostas autenticadas**; HTML network-first; preço nunca é verdade do cache. (RN-6, §10)
  - **Sem `service_role`** em nenhum handler de manifest (menor privilégio).
  - **Nenhuma RLS nova, nenhuma migration** — reuso integral. **Sem valor monetário** → sem recálculo de servidor.
- **Próximo passo:** `/break` passando `specs/pwa-vitrine-painel.md`.
</content>
</invoke>
