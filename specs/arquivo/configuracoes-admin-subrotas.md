# Spec: Configurações do Hub Admin em sub-rotas próprias (paridade total com o painel do lojista)

**Versão:** 0.1.0 | **Atualizado:** 2026-07-10

## Visão Geral

O hub do dono do SaaS que edita a loja de um assinante (`/admin/assinantes/[lojaId]/...`) hoje diverge do painel do lojista em dois pontos deliberados (herdados de `specs/paridade-hub-admin-painel.md`, que os deixou explicitamente **fora de escopo**):

1. **Configurações consolidada:** o item Configurações no admin não tem sub-itens — leva a UMA página única (`.../configuracoes/page.tsx`, `ConfiguracaoAdminClient`) que empilha perfil, horários, entregas, pagamentos e tema, com o card admin-only `ModulosImpressaoAdmin` acima.
2. **Assinatura oculta:** o sub-item Assinatura é escondido no contexto admin (`ocultarAssinatura: true`).

Esta feature **reverte as duas decisões** por escolha autoritativa do usuário: o comportamento do admin passa a ser **idêntico** ao do lojista. Configurações vira um item com os mesmos 6 sub-itens — **Perfil, Horários, Entregas, Pagamentos, Tema e Assinatura** — cada um levando a uma **página própria** (`/admin/assinantes/[lojaId]/configuracoes/perfil`, etc.), reusando ao máximo os clients do painel já existentes. Assinatura **não fica solta nem oculta**: entra como sub-item de Configurações, igual ao lojista.

**Mundo:** painel administrativo (`/admin/*`), auth obrigatória com guard de admin do SaaS (`verificarAdminSaaS()`). Não é a vitrine pública nem o painel do lojista, embora **reuse os componentes client do painel** por parametrização (`architecture.md` §8). O modelo continua "admin agindo sobre a loja-alvo via `service_role` escopado por `lojaId`", **nunca** "logado como o lojista" (sem impersonation de sessão).

Esta feature é uma **continuação direta** de `specs/paridade-hub-admin-painel.md` — reaproveita toda a fiação já entregue (issues 091–097 = actions admin + clients parametrizados; 096 = `carregarLojaAdmin`; 145 = shell parametrizado por `ContextoNav`).

## Atores Envolvidos

- **iRango (SaaS / admin):** único ator que age aqui. Opera as configurações e a assinatura de qualquer loja assinante em nome do lojista, via `service_role` escopado por `lojaId`, após `verificarAdminSaaS()`. Vê configuração comercial da loja (chave Pix, taxas), status/faturas de assinatura e as flags de módulo pago.
- **Lojista:** não age aqui. É afetado — toda escrita do admin altera a loja dele (a faixa âmbar persistente do layout lembra o admin disso). Continua com seu próprio painel `/painel/*` inalterado.
- **Cliente final:** não age nem é diretamente afetado por esta feature (config/assinatura não mudam o preço de um pedido em curso).

## Princípio arquitetural herdado: o painel do lojista é a fonte única do front

**O front do lojista é o padrão; o hub admin o consome por parametrização — nunca por cópia.** Cada sub-página admin renderiza o **mesmo client do lojista** (`PerfilClient`, `HorariosClient`, `EntregasClient`, `PagamentosClient`, `TemaClient`, `GerenciarAssinaturaClient` e os cartões de assinatura) com as Server Actions admin injetadas via closures que fixam o `lojaId`. Duplicar JSX/markup de área entre painel e admin é regressão. Qualquer mudança futura nesses clients reflete automaticamente nos dois mundos.

---

## Páginas e Rotas

Todas as rotas abaixo vivem sob `/admin/assinantes/[lojaId]/*`. O guard autoritativo de admin está em `src/app/admin/assinantes/layout.tsx` (`verificarAdminSaaS()` fail-closed → redirect `/painel`); ele envolve **todas** as sub-rotas novas. O `[lojaId]/layout.tsx` re-prova admin ao carregar o cabeçalho, e cada loader de sub-rota re-prova admin **antes** de elevar a `service_role` (padrão da issue 096, `carga.ts`).

### 1. Shell de navegação — parametrização do `ContextoNav` — infra

**Mundo:** painel admin (auth admin).
**Descrição:** o contexto admin do shell (`SidebarPainel`/`TopbarPainel`) passa a expandir **os mesmos sub-itens do lojista**, com hrefs prefixados por `/admin/assinantes/${lojaId}`. Concretamente:

- Em `src/app/admin/assinantes/[lojaId]/layout.tsx`, o objeto `contexto` deixa de setar `ocultarAssinatura: true` e `configConsolidada: true` — passa a ser **apenas** `{ basePath: '/admin/assinantes/${lojaId}' }`. Assim o admin herda o comportamento do lojista byte-a-byte (Configurações com 6 sub-itens, Assinatura visível), divergindo só na base das rotas.
- Em `src/components/painel/NavPainel.tsx`, as flags `configConsolidada` e `ocultarAssinatura` de `ContextoNav` e o ramo consolidado de `construirItens()` viram **dead code** (nenhum outro caller — confirmado por grep: só o layout admin e o teste os usavam). **Recomendação:** remover as duas flags de `ContextoNav` e simplificar `construirItens()` para o único ramo com sub-itens (o do lojista). DRY, sem dead code (`architecture.md` §9).
- O helper `estaAtivo`/`ListaNav` já suporta pai-com-subitens e ativação por prefixo — **nenhuma mudança de lógica de destaque** é necessária; os sub-itens de Configurações passam a acender exatamente como os do lojista.

**Componentes:**
- `SidebarPainel` / `TopbarPainel` (reuso — `components/painel/NavPainel.tsx`) — sem mudança de markup; só some o ramo consolidado.
- `construirItens()` / `ContextoNav` (modificar — remoção das flags mortas).

**Behaviors:**
- [x] Ver, no menu admin, Configurações expandida com os 6 sub-itens (Perfil, Horários, Entregas, Pagamentos, Tema, Assinatura), hrefs sob a base admin. Garantido em: cliente (UX de navegação).
- [x] Ver o sub-item Assinatura presente (não oculto). Garantido em: cliente (UX). A barreira real de escrita é `verificarAdminSaaS()` + a action admin de assinatura no servidor, não a presença/ausência do link.
- [x] Clicar num sub-item e navegar para a sub-rota própria correspondente, com o item ativo derivado de `usePathname` sobre o `basePath` admin. Garantido em: cliente (UX).

---

### 2. Configurações (índice) — `/admin/assinantes/[lojaId]/configuracoes` — redirect

**Mundo:** painel admin (auth admin).
**Descrição:** a página consolidada atual (`ConfiguracaoAdminClient` empilhando as 5 seções + `ModulosImpressaoAdmin`) é **desmontada**. O conteúdo migra para as 6 sub-rotas próprias (seções 3–8). O `.../configuracoes/page.tsx` passa a ser um **redirect** para `.../configuracoes/perfil` (a primeira aba), preservando compat de bookmark: quem tem a URL consolidada salva cai numa página válida.

**Proposta e justificativa (o que acontece com a página consolidada):**
- **Vira redirect** (`redirect()` para `.../configuracoes/perfil`), **não** some. Justificativa: (a) nenhum conteúdo é perdido — as 5 seções viram páginas próprias e o `ModulosImpressaoAdmin` migra para a aba Assinatura (seção 8); (b) mantém o padrão de compat de bookmark da issue 144 (o singular `.../configuracao` já é 308 para `.../configuracoes`); (c) o item-pai "Configurações" do menu aponta para `.../configuracoes` — o redirect garante que clicá-lo leve a uma página real (Perfil) em vez de 404.
- **Tipo do redirect:** `redirect()` (307/302 — pai→aba-default), **não** `permanentRedirect` (308). O namespace `.../configuracoes/*` continua vivo (é o pai das sub-rotas); só a *renderização* do índice delega à primeira aba. Diferente do caso 144, que foi um rename real (308).
- **Compat singular (issue 144):** o `.../configuracao/page.tsx` (308 → `.../configuracoes`) pode ser mantido como está (dois hops: singular → índice → perfil, inofensivo) ou apontado direto para `.../configuracoes/perfil` para colapsar a cadeia. **Recomendação:** apontar direto para `.../configuracoes/perfil` (um hop só).

**Componentes:**
- `ConfiguracaoAdminClient` (retirar) — decomposto em wrappers admin por seção (ver seções 3–7). Sem dead code residual.

**Behaviors:**
- [x] Acessar `.../configuracoes` (link do item-pai ou bookmark antigo) e ser redirecionado para `.../configuracoes/perfil`. Garantido em: Server Component (redirect); guard admin herdado do layout.

---

### 3. Perfil — `/admin/assinantes/[lojaId]/configuracoes/perfil`

**Mundo:** painel admin (auth admin).
**Descrição:** espelho da `/painel/(bloqueavel)/configuracoes/perfil` do lojista. Edita nome, slug, telefone, WhatsApp, endereço; upload/remoção de logo; publicar/despublicar a loja. Server Component carrega os dados da loja-alvo; renderiza `PerfilClient` (reuso) com as actions admin injetadas.

**Componentes:**
- `PerfilClient` (reuso — client do lojista, já parametrizado por `onSalvar`/`onDefinirPublicacao`/`onSalvarLogo`/`onRemoverLogo`).
- `PerfilAdminClient` (novo wrapper "use client", extraído do trecho de `ConfiguracaoAdminClient`) — fixa o `lojaId` em closures e injeta `salvarPerfilAdmin` (091), `publicarLojaAdmin`, `salvarLogoAdmin`/`removerLogoAdmin` (adapters de FormData que setam `loja_id` server-side). Reuso literal da fiação já existente no `ConfiguracaoAdminClient`.

**Behaviors:**
- [x] Editar perfil (nome, slug, telefone, WhatsApp, endereço) e salvar. Garantido em: **Server Action + escopo (RLS-equivalente)** — `salvarPerfilAdmin(lojaId, payload)` revalida com o mesmo zod do lojista, escreve via `escopo` por `lojaId`; unicidade de slug checada no servidor. `lojaId` validado (`z.guid`) e admin provado antes de elevar `service_role`.
- [x] Publicar / despublicar a loja. Garantido em: **Server Action + escopo** — `publicarLojaAdmin(lojaId, publicar)`; o gate de "perfil mínimo para publicar" é revalidado no servidor (nome + WhatsApp), nunca decidido no cliente.
- [x] Enviar / remover logo. Garantido em: **Server Action + escopo** — `salvarLogoAdmin`/`removerLogoAdmin` validam admin, magic bytes e path server-side; o `loja_id` é fixado no adapter, mas a autoridade do escopo é da action.

---

### 4. Horários — `/admin/assinantes/[lojaId]/configuracoes/horarios`

**Mundo:** painel admin (auth admin).
**Descrição:** espelho da página de horários do lojista. Edita os horários de funcionamento; o preview "Aberta agora" usa `lojaAberta` (reuso — `lib/utils/lojaAberta.ts`).

**Componentes:**
- `HorariosClient` (reuso — aceita `onSalvar`).
- `HorariosAdminClient` (novo wrapper fino "use client") — injeta `salvarHorariosAdmin(lojaId, payload)` (093).

**Behaviors:**
- [x] Editar horários e salvar. Garantido em: **Server Action + escopo** — `salvarHorariosAdmin` revalida `abre < fecha` (RN-09) no servidor. Escopo por `lojaId` validado.
- [x] Ver o preview de "Aberta agora / Fechada". Garantido em: cliente (UX) — `lojaAberta` é estimativa estética; a autoridade de status vive no dado da loja + timezone.

---

### 5. Entregas — `/admin/assinantes/[lojaId]/configuracoes/entregas`

**Mundo:** painel admin (auth admin).
**Descrição:** espelho da página de zonas de entrega do lojista. CRUD de zonas (taxa 1:1, bairros 1:N). Server Component carrega as zonas escopadas por `lojaId`.

**Componentes:**
- `EntregasClient` (reuso — aceita `acoes`).
- `EntregasAdminClient` (novo wrapper fino "use client") — injeta `criarZonaAdmin`/`atualizarZonaAdmin`/`removerZonaAdmin` (094) com `lojaId` fixado.

**Behaviors:**
- [x] Criar / editar / remover zona de entrega com taxa e bairros. Garantido em: **Server Action + escopo** — as actions de entrega admin revalidam o payload no servidor e escrevem via `escopo` por `lojaId`. A **taxa de frete** é definição comercial gravada aqui; o valor autoritativo cobrado ao cliente permanece recalculado no checkout (`calcularFrete` + RPC `criar_pedido`, `seguranca.md` §10) — esta rota não introduz novo ponto de recálculo.

---

### 6. Pagamentos — `/admin/assinantes/[lojaId]/configuracoes/pagamentos`

**Mundo:** painel admin (auth admin).
**Descrição:** espelho da página de formas de pagamento do lojista. CRUD de formas aceitas + upload de QR Pix. Trata chave Pix (dado sensível).

**Componentes:**
- `PagamentosClient` (reuso — aceita `acoes` + `lojaId`).
- `PagamentosAdminClient` (novo wrapper "use client", extraído de `ConfiguracaoAdminClient`) — injeta `salvarFormaPagamentoAdmin`/`atualizarFormaPagamentoAdmin`/`removerFormaPagamentoAdmin`/`salvarQrPixAdmin`/`enviarQrPixAdmin` (095), incluindo o adapter de FormData do QR Pix que fixa `loja_id` server-side.

**Behaviors:**
- [x] Criar / editar / remover forma de pagamento (Pix, dinheiro, cartão, link). Garantido em: **Server Action + escopo** — formato da chave Pix revalidado no servidor; escopo por `lojaId`.
- [x] Enviar QR Pix (imagem). Garantido em: **Server Action + escopo** — `enviarQrPixAdmin` valida admin, magic bytes e path; `loja_id` fixado no adapter, autoridade na action.

---

### 7. Tema — `/admin/assinantes/[lojaId]/configuracoes/tema`

**Mundo:** painel admin (auth admin).
**Descrição:** espelho da página de tema do lojista. Edita as cores da vitrine (primária, fundo, destaque) com preview.

**Componentes:**
- `TemaClient` (reuso — aceita `onSalvar` + `nomeLoja`).
- `TemaAdminClient` (novo wrapper fino "use client") — injeta `salvarTemaAdmin(lojaId, payload)` (093).

**Behaviors:**
- [x] Editar cores e salvar. Garantido em: **Server Action + escopo** — `salvarTemaAdmin` valida cada cor como hex `#RRGGBB` no servidor (anti-injeção CSS, `seguranca.md` §15). Escopo por `lojaId`.
- [x] Ver o preview do tema. Garantido em: cliente (UX) — estética; a cor persistida é o valor autoritativo.

---

### 8. Assinatura — `/admin/assinantes/[lojaId]/configuracoes/assinatura` — **CRÍTICO**

**Mundo:** painel admin (auth admin).
**Descrição:** espelho da central de assinatura do lojista (`/painel/configuracoes/assinatura`), operando sobre a **loja-alvo** (não a loja do admin). O dono do SaaS vê e gerencia a assinatura do assinante — **mesmo comportamento do lojista** — mais o card admin-only `ModulosImpressaoAdmin` (entitlement de módulos pagos), que migra para cá vindo da antiga página consolidada.

**O que o admin vê (leitura — Server Component, `service_role` escopado por `lojaId`):**
- Status da assinatura da loja-alvo (`assinatura_status`, `assinatura_inicio`, `assinatura_fim_periodo`), plano atual, aviso de estado bloqueado.
- Histórico de faturas (`pagamentos_assinatura` da loja-alvo) — o `valor` é **autoritativo do servidor** (gravado pelo webhook 077), a UI só formata.
- Catálogo de planos ativos (`planos`, global).
- Card `ModulosImpressaoAdmin`: flags `modulo_impressao_a4`/`modulo_impressao_termica` da loja-alvo (já em mãos do loader — zero query nova).

**O que o admin faz (escrita — Server Actions admin):**
- Iniciar / trocar plano / atualizar meio de pagamento / cancelar assinatura da loja-alvo.
- Alternar os módulos pagos (`ModulosImpressaoAdmin`).

**Onde encaixa o `ModulosImpressaoAdmin`:** renderizado como **card admin-only, IRMÃO e ACIMA** da view de assinatura reusada — exatamente o padrão que ele já tinha na página consolidada (billing/entitlement admin-only separado do espelho do lojista), apenas **relocado** de `.../configuracoes` para `.../configuracoes/assinatura`. Justificativa: o card não tem equivalente no painel do lojista (o lojista não pode auto-conceder módulo — é billing-controlled, `architecture.md` §6); Assinatura é a página onde já vive todo o resto do billing/entitlement da loja-alvo, então é o lar natural do único bloco admin-only. As 5 abas de config (Perfil…Tema) ficam byte-a-byte idênticas ao lojista; a divergência admin (card extra + actions escopadas por `lojaId`) concentra-se em Assinatura.

**Componentes:**
- `CartaoStatusAssinatura`, `AvisoEstadoBloqueado`, `TabelaFaturas`, `temAssinaturaAtiva` (reuso — `components/painel/`, sem mudança).
- `GerenciarAssinaturaClient` (reuso — **parametrizar com `acoes?`** opcional; default = as 4 actions do lojista de `lib/actions/assinatura.ts`; segue o mesmo padrão de `PerfilClient` etc.). Hoje importa as 4 actions direto (linhas 22–27); passa a aceitá-las por prop.
- `ModulosImpressaoAdmin` (reuso — `admin/assinantes/[lojaId]/configuracoes/ModulosImpressaoAdmin.tsx`, sem mudança; só muda de página).
- `AssinaturaAdminClient` (novo wrapper "use client") — injeta as 4 actions admin de assinatura (novas — ver Modelos de Dados) com `lojaId` fixado.

**Behaviors:**
- [x] Ver status, plano e faturas da assinatura da loja-alvo. Garantido em: **Server Component** — leitura via `service_role` escopada por `lojaId`; `valor`/`status`/`preco` são valores autoritativos do banco (webhook/planos), nunca calculados no cliente.
- [x] Ver e alternar os módulos pagos (A4 / térmica) da loja-alvo. Garantido em: **Server Action + escopo (RLS-equivalente) + CHECK/trigger no banco** — `alternarModuloImpressaoAdmin` (existente) escreve as colunas billing-controlled via `service_role`; o trigger `lojas_protege_billing_trg` (v3+) é o gate primário no banco que impede qualquer role ≠ sistema de gravá-las. `verificarAdminSaaS()` antes de elevar.
- [x] Iniciar assinatura da loja-alvo. Garantido em: **Server Action + escopo** — `iniciarAssinaturaAdmin(lojaId, plano_id)` (nova); preço lido de `planos.preco` (RN-1), `.strict()` rejeita preço injetado; `assinatura_status` NUNCA escrito pela action (só o webhook 077 é autoridade, RN-2). Escopo por `lojaId` validado, não por `auth.uid()`.
- [x] Trocar plano / atualizar meio de pagamento / cancelar assinatura da loja-alvo. Garantido em: **Server Action + escopo** — variantes admin (`trocarPlanoAdmin`/`atualizarMeioPagamentoAssinaturaAdmin`/`cancelarAssinaturaAdmin`); dados de cartão nunca trafegam (só a URL do checkout hospedado do provider, RN-11); cancelamento não é otimista (status só muda no webhook, RN-7).

> **Divergência crítica de implementação (marcar no /plan):** as actions atuais de assinatura (078) derivam a loja de `buscarLojaDoDono(auth.uid())` e passam ao provider o **email do usuário autenticado**. No contexto admin, o usuário autenticado é o **dono do SaaS**, não o lojista — reusá-las direto operaria a loja errada e/ou com o email errado no provider. As variantes admin **devem** (a) escopar por `lojaId` validado (nunca `auth.uid()`), (b) resolver o email do **dono da loja-alvo** server-side (via `service_role`, a partir de `loja.dono_id`), nunca do admin logado, e (c) provar admin antes de elevar `service_role`. Esta é a **única superfície de servidor genuinamente nova** da feature — todo o resto (config) reusa actions admin já entregues (091–095).

---

## Modelos de Dados

**Nenhuma tabela ou coluna nova. Nenhuma migration. Nenhuma RLS nova.** A feature opera sobre tabelas existentes (`schema.md`), todas já com `loja_id` e RLS:

- `lojas` — leitura de `assinatura_*`, `plano_id`, `provider_subscription_id`, `modulo_impressao_a4`/`modulo_impressao_termica`, `dono_id`; escrita de billing-intent e módulos via `service_role` (colunas protegidas pelo trigger `lojas_protege_billing_trg`, `seguranca.md` §2).
- `pagamentos_assinatura` — leitura de faturas da loja-alvo.
- `planos` — catálogo global (leitura).
- `zonas_entrega`, `taxas_entrega`, `bairros_zona`, `formas_pagamento`, `categorias`, `produtos` — já cobertos pelas actions admin de config (091–095).

**Loaders de leitura novos** (server-only, escopados por `lojaId` via `service_role`, seguindo o padrão fail-closed de `carga.ts`: `validarLojaIdAdmin` → `verificarAdminSaaS()` → `createServiceClient()`):
- `carregarLojaAdminBase(lojaId) → LojaCompleta` — só a linha `lojas` (via `buscarLojaAdminPorId`). Serve Perfil, Horários, Tema e Assinatura (evita o over-fetch de `carregarLojaAdmin`, que traz categorias/produtos/zonas). Entregas e Pagamentos reusam `listarZonasComTaxas(svc, lojaId)` / `listarFormasPagamento(svc, lojaId)` (já aceitam `(client, lojaId)`).
- `listarFaturasDaLojaAdmin(svc, lojaId, limite?)` — variante admin de `listarFaturasDaLoja`. A original NÃO recebe `lojaId` (escopa por RLS sobre o client autenticado); a admin roda sob `service_role` (bypassa RLS), então **precisa** de `.eq("loja_id", lojaId)` explícito. `buscarPlanoAtivo`/`listarPlanosAtivos` já aceitam client → reusar com `svc`.

**Server Actions novas** (em `src/app/admin/assinantes/actions/admin-assinatura.ts`, seguindo o padrão das demais actions admin):
- `iniciarAssinaturaAdmin(lojaId, plano_id)`, `trocarPlanoAdmin(lojaId, plano_id)`, `atualizarMeioPagamentoAssinaturaAdmin(lojaId)`, `cancelarAssinaturaAdmin(lojaId)` — variantes escopadas por `lojaId` das 4 actions de billing-intent (078). Reusam o billing provider (`getBillingProvider`), `buscarPlanoAtivo`, `persistirAssinaturaLoja` — porém escopadas por `lojaId` validado e com o email do dono da loja-alvo resolvido server-side (ver divergência crítica na seção 8). `alternarModuloImpressaoAdmin` (existente) é reusado sem mudança.

A isolação das escritas admin **não vem de RLS** (o `service_role` a bypassa) — vem de `verificarAdminSaaS()` antes de elevar + `lojaId` validado (`z.guid`) + escopo explícito por `lojaId` (`seguranca.md` §7 / §padrão admin).

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| Comportamento admin = comportamento lojista em Configurações (mesmos 6 sub-itens, cada um página própria). | Cliente (nav — `ContextoNav` só troca `basePath`) + reuso dos mesmos clients do lojista por parametrização. |
| Assinatura é sub-item de Configurações (não solta, não oculta). | Cliente (nav) — remoção das flags `ocultarAssinatura`/`configConsolidada`. |
| Toda sub-rota admin prova admin **antes** de elevar `service_role` (fail-closed). | Server Component/Action — `verificarAdminSaaS()` fora do `try`, propaga; guard do layout `admin/assinantes/layout.tsx` envolve tudo. |
| `lojaId` validado como UUID (`z.guid`) antes de qualquer efeito/leitura. | Server — `validarLojaIdAdmin` no loader e em cada action. |
| Preço da assinatura lido de `planos.preco`; cliente manda só `plano_id`. | Server Action — `.strict()` rejeita preço injetado (RN-1). |
| `assinatura_status`/`valor` de fatura só mudam via webhook (077); actions de billing-intent nunca os escrevem; cancelar não é otimista. | Server Action (não escreve) + webhook (autoridade) — RN-2/RN-7. |
| Colunas billing-controlled (`assinatura_*`, `plano_id`, `provider_subscription_id`, `modulo_impressao_*`) só graváveis por `service_role`/sistema. | **Trigger `lojas_protege_billing_trg` no banco** (gate primário) + `service_role` nas actions admin. |
| Email enviado ao provider é o do **dono da loja-alvo**, resolvido server-side — nunca o do admin logado. | Server Action admin (resolve via `loja.dono_id` sob `service_role`). |
| Chave Pix / taxa de frete / cor de tema revalidadas no servidor. | Server Action admin (zod) + CHECK no banco. |
| Valor que o cliente paga num pedido (cupom/frete/opcional). | **Inalterado** — recálculo autoritativo permanece no checkout (`criar_pedido`, `seguranca.md` §10). Esta feature não toca o checkout. |
| Painel do lojista é fonte única do front; admin consome os mesmos clients por parametrização. | Estrutura de componentes (revisão) — cópia de markup é regressão. |

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** chave Pix (Pagamentos — já coberto pelas actions 095); status/faturas de assinatura e catálogo de planos (Assinatura — leitura `service_role` escopada por `lojaId`); flags de módulo pago (billing-controlled). Nenhum SELECT público envolvido — toda leitura admin é server-side escopada.
- **Valores monetários:** preço de assinatura → lido de `planos.preco` no servidor, `.strict()` barra injeção (RN-1); `valor` de fatura → autoritativo do webhook (077), UI só formata; `assinatura_status` → só o webhook escreve (RN-2/7). Módulos pagos → colunas protegidas pelo trigger `lojas_protege_billing_trg` no banco (gate primário) + escrita via `service_role` na action admin. Taxa de frete/valor de cupom → definições comerciais; **o valor cobrado ao cliente continua recalculado no checkout**, não aqui.
- **Tabela nova?** Não — **nenhuma RLS nova**. Isolação por `verificarAdminSaaS()` + `lojaId` validado + escopo explícito por `lojaId` (service_role bypassa RLS).
- **API externa com key?** O billing provider (Asaas, via `getBillingProvider`) — server-only, já existente. As actions admin de assinatura o chamam server-side; o email do dono-alvo é resolvido server-side (`service_role`), nunca vindo do cliente. Chave do provider nunca vaza ao cliente.
- **Superfície nova crítica:** as 4 actions admin de billing-intent (`admin-assinatura.ts`) são a única superfície de servidor nova. Devem ser auto-descobertas pelas suítes de enforcement admin existentes (`enforcement-escopo-admin.test.ts`, `isolamento-admin.test.ts`) sem editar as suítes (referência a `verificarAdminSaaS`/`prepararContextoAdmin`; escrita escopada por `lojaId`).
- **TDD red-first (crítica: SIM):** a rota Assinatura (seção 8) exige teste vermelho antes da implementação: (a) isolamento cross-loja — admin operando a loja A nunca inicia/troca/cancela a assinatura da loja B; (b) preço lido do banco, nunca do payload (`.strict()`); (c) `assinatura_status` nunca escrito pela action; (d) email passado ao provider é o do dono-alvo, não o do admin. As sub-rotas de config (3–7) são fiação sobre actions admin já testadas (091–095) — não-críticas, cobertas por testes de rota (fiação).
- **Auditoria/LGPD (débito herdado):** `registrarAcessoAdmin` continua no-op; o acesso do admin a dados de billing/assinatura da loja-alvo não é logado hoje. Registrar como débito; não bloqueia a feature.

## Fora de Escopo (v1)

- **Impersonation de sessão** — o modelo continua `service_role` escopado por `lojaId`, nunca "logado como o lojista".
- **Novas colunas/planos de billing** — nenhuma mudança de schema; reusa `planos`/`lojas`/`pagamentos_assinatura` existentes.
- **Mudanças no painel do lojista além da parametrização mínima** — `GerenciarAssinaturaClient` ganha `acoes?` opcional com default = comportamento atual; nenhuma regressão do lojista. As 5 páginas de config do lojista permanecem inalteradas.
- **Espelhar no painel do lojista o redirect do índice `/configuracoes` → `/perfil`** — o item-pai "Configurações" do lojista aponta para `/painel/configuracoes` (sem página índice hoje); alinhar esse comportamento é concern separado do painel do lojista, não desta feature admin.
- **Alteração do webhook de billing (077) ou do provider** — inalterados; as actions admin apenas os consomem.
- **Notificação em tempo real / Realtime** — fase 2 (`modelo-negocio.md` §8).
- **Implementação do log de auditoria de acesso admin** — débito registrado, não construído aqui.

---

**Próximo passo:** `/break` passando este spec (`specs/configuracoes-admin-subrotas.md`) para gerar as issues acionáveis, respeitando a ordem de dependência: (1) parametrizar `GerenciarAssinaturaClient` com `acoes?` + limpar as flags de `ContextoNav`/`construirItens`; (2) loaders admin novos (`carregarLojaAdminBase`, `listarFaturasDaLojaAdmin`); (3) actions admin de assinatura com **TDD red-first** (crítica); (4) wrappers admin por seção + as 6 sub-rotas próprias + redirect do índice; (5) mudar o `contexto` do layout admin e atualizar `NavPainel.test.tsx` + testes de rota.
