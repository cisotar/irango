# Spec: Paridade completa entre o Hub Admin e o Painel do Lojista

**Versão:** 0.1.0 | **Atualizado:** 2026-07-03

## Visão Geral

Hoje o dono do SaaS gerencia uma loja de terceiro em `/admin/assinantes/[lojaId]` por um shell ad-hoc (um `<main>` nu com cabeçalho manual, aviso amber e `AbasLoja` de apenas duas abas: Cardápio e Configuração). O lojista, por sua vez, opera o `/painel` com sidebar/topbar completos e seis áreas (Dashboard, Pedidos, Produtos + Opcionais, Cupons, Configurações, Assinatura).

Esta feature fecha o gap: ao clicar em "Gerenciar" numa loja, o admin passa a ver e operar **o mesmo front** que o lojista vê no painel — mesma sidebar/topbar, mesmas áreas — com **escrita completa** (decisão já tomada). Áreas que hoje faltam no hub admin (Dashboard, Pedidos, Cupons, Opcionais) são adicionadas; o shell visual passa a reusar `SidebarPainel`/`TopbarPainel` parametrizados.

**Mundo:** painel administrativo (`/admin/*`), auth obrigatória com guard de admin do SaaS (`verificarAdminSaaS()`). Não é a vitrine pública nem o painel do lojista, embora **reuse os componentes client do painel** por parametrização (padrão `architecture.md` §8). O modelo continua "admin agindo sobre a loja X via `service_role` escopado", **nunca** "logado como X" (sem impersonation de sessão).

## Atores Envolvidos

- **iRango (SaaS / admin):** único ator desta feature. Opera qualquer loja assinante em nome do lojista, via `service_role` escopado por `lojaId`, após `verificarAdminSaaS()`. Vê PII do cliente final (pedidos) e a configuração comercial da loja.
- **Lojista:** não age aqui. É afetado — toda escrita do admin altera a loja dele. O aviso amber persistente existe para lembrar o admin disso.
- **Cliente final:** não age aqui. É afetado indiretamente: cupom e status de pedido que o admin altera influenciam quanto o cliente paga e o andamento do pedido dele.

## Princípio arquitetural: o painel do lojista é a fonte única do front

**O front do lojista é o padrão; o hub admin o consome por parametrização — nunca por cópia.** Cada área é UM componente compartilhado (o mesmo arquivo, em `components/painel/` ou no módulo do painel) parametrizado por contexto (`acoes?`, `basePath`, `contexto`), com default = comportamento do lojista. Consequência garantida por construção: **qualquer mudança futura no painel do lojista reflete automaticamente no hub admin**, sem passo extra de sincronização. Duplicar JSX/markup de área entre painel e admin é regressão deste spec — se uma rota admin precisa de UI que hoje vive inline numa page do painel, o passo obrigatório é extrair essa UI para um componente compartilhado e fazer as duas pages consumirem o mesmo componente.

## Pré-requisito bloqueante

**`tasks/115-harden-atualizar-loja-omit-billing.md` deve ser fechada ANTES de criar as novas Server Actions admin desta feature** (blindar `escopo.atualizarLoja` por tipo, `Omit` de colunas de billing/dono). Prioridade elevada em 2026-07-03. Embora as actions novas aqui escrevam majoritariamente em tabelas próprias (`cupons`, `opcionais*`, `pedidos`) e não em `lojas`, o mandato é fechar 115 antes de qualquer action admin nova, por disciplina estrutural.

---

## Páginas e Rotas

Todas as rotas abaixo vivem sob `/admin/assinantes/[lojaId]/*`. O guard autoritativo de admin já está em `src/app/admin/assinantes/layout.tsx` (`verificarAdminSaaS()` fail-closed → redirect `/painel`); ele envolve tudo. O `[lojaId]/layout.tsx` re-prova admin ao carregar o cabeçalho (`carregarCabecalhoLojaAdmin`).

### 1. Shell parametrizado (Sidebar + Topbar + Banner) — infra de layout

**Mundo:** painel admin (auth admin).
**Descrição:** o `[lojaId]/layout.tsx` deixa de renderizar cabeçalho ad-hoc + `AbasLoja` e passa a montar `SidebarPainel` + `TopbarPainel` (de `src/components/painel/NavPainel.tsx`) parametrizados para o contexto admin: hrefs com base `/admin/assinantes/[lojaId]`, item **Assinatura oculto**, e um **banner persistente e visualmente distinto** ("Você está editando a loja de outro lojista — {nome}") sempre visível (preservando/estendendo o aviso amber atual). `AbasLoja.tsx` é removido.

**Componentes:**
- `SidebarPainel` / `TopbarPainel` (reuso — `components/painel/NavPainel.tsx`) — parametrizar via um `contexto` (título, `basePath`, itens computados, flag de ocultar Assinatura, slot para o banner). Default mantém o comportamento atual do lojista (`basePath="/painel"`, Assinatura visível, sem banner).
- Banner de contexto admin — reuso do bloco amber `role="note"` já existente no layout, elevado para faixa persistente do shell (visível em todas as áreas, não só no topo de uma aba).
- `Badge` de status (Publicada / Não publicada) — reuso shadcn/ui.
- Link "Voltar para assinantes" — reuso.

**Itens de nav no contexto admin** (mesma ordem/ícones do painel, leaf names espelhados para paridade real de URL):
- Dashboard → `/admin/assinantes/[lojaId]`
- Pedidos → `/admin/assinantes/[lojaId]/pedidos`
- Produtos → `/admin/assinantes/[lojaId]/produtos` (subitem Opcionais → `.../produtos/opcionais`)
- Cupons → `/admin/assinantes/[lojaId]/cupons`
- Configurações → `/admin/assinantes/[lojaId]/configuracoes` (sem subitens no admin — página consolidada única, ver Fora de Escopo)
- ~~Assinatura~~ (oculto — autogestão do lojista, fora de escopo)

**Behaviors:**
- [ ] Ver a sidebar/topbar idênticas ao painel, com o item ativo derivado de `usePathname` sobre o `basePath` admin. Garantido em: cliente (UX de navegação).
- [ ] Ver o banner amber persistente de "editando loja de terceiro" em todas as áreas. Garantido em: cliente (UX) — o dado de posse/permissão real é o guard `verificarAdminSaaS()` no servidor.
- [ ] Não ver o item Assinatura no menu admin. Garantido em: cliente (UX); a ausência de rota `.../assinatura` é a barreira real.
- [ ] Navegar entre áreas sem recarregar contexto de admin (o guard roda por request no layout). Garantido em: Server Component (guard) + RLS-equivalente (escopo por `lojaId`).

---

### 2. Dashboard da loja-alvo — `/admin/assinantes/[lojaId]`

**Mundo:** painel admin (auth admin).
**Descrição:** repurposar o `[lojaId]/page.tsx` atual (que hoje só redireciona para `cardapio`) como o Dashboard equivalente ao `/painel` (page.tsx do painel): três cards de métrica (Pedidos hoje, Pendentes, Total do dia) + tabela de pedidos recentes com link "Ver todos". Server Component, dados via `service_role` escopados por `lojaId`.

**Componentes:**
- `DashboardLoja` (novo componente compartilhado, extraído da UI inline de `painel/page.tsx`) — recebe os dados (pedidos do dia/recentes) + `basePedidos` e renderiza métricas + tabela. `painel/page.tsx` e a page admin consomem **o mesmo componente**; nenhuma cópia de markup no admin (ver Princípio arquitetural). Extrair também `calcularMetricasDoDia` + `chaveDia` para `lib/utils/metricasPedidos.ts`.
- `TabelaPedidos` (reuso — `components/painel/TabelaPedidos.tsx`) — **parametrizar com `basePedidos`** para os links apontarem a `/admin/assinantes/[lojaId]/pedidos/[id]` (hoje o link é fixo em `/painel/pedidos/[id]`). Default mantém `/painel`.

**Behaviors:**
- [ ] Ver métricas do dia (pedidos hoje, pendentes, total do dia). Garantido em: Server Action/Component — `total` é o valor autoritativo já gravado no pedido; a métrica só soma valores persistidos, sem recálculo de preço. Escopo por `lojaId` via loader admin (`service_role`).
- [ ] Ver os 20 pedidos recentes e clicar em "Ver todos". Garantido em: Server Component (leitura escopada por `lojaId`); navegação no cliente.

---

### 3. Pedidos — lista — `/admin/assinantes/[lojaId]/pedidos`

**Mundo:** painel admin (auth admin).
**Descrição:** equivalente a `/painel/pedidos`: lista de pedidos com filtro por status (client-side, só UX). Server Component carrega os pedidos por `service_role` escopados por `lojaId` e passa ao `PedidosClient`.

**Componentes:**
- `PedidosClient` (reuso — sem mudança de lógica; é filtro puro de UI). Passa `basePedidos` adiante para `TabelaPedidos`.
- `TabelaPedidos` (reuso parametrizado, ver Dashboard).

**Behaviors:**
- [ ] Filtrar pedidos por status (Todos / Pendentes / …). Garantido em: cliente (UX) — filtro de apresentação, nunca barreira de segurança; a lista já chega escopada por `lojaId` do servidor.
- [ ] Abrir o detalhe de um pedido. Garantido em: cliente (navegação); a leitura do detalhe é escopada por `lojaId` no servidor.

---

### 4. Pedido — detalhe + mudança de status — `/admin/assinantes/[lojaId]/pedidos/[id]` — **CRÍTICO**

**Mundo:** painel admin (auth admin).
**Descrição:** equivalente a `/painel/pedidos/[id]`: dados do pedido (cliente, itens, endereço, totais) + botões de transição de status. Escrita completa: o admin muda o status do pedido em nome do lojista.

**Componentes:**
- Detalhe do pedido — se a UI hoje vive inline em `painel/pedidos/[id]/page.tsx`, **extrair para componente compartilhado** (ex.: `DetalhePedido`) consumido pelas duas pages (ver Princípio arquitetural); dados carregados por loader admin escopado por `lojaId` + `id`.
- `AcoesStatus` (reuso — `painel/pedidos/[id]/AcoesStatus.tsx`) — **parametrizar com `acao?`** (default = `atualizarStatusPedido` do lojista); o wrapper admin injeta `atualizarStatusPedidoAdmin(lojaId, id, novoStatus)`. Continua exibindo só transições permitidas via a função pura `transicaoPermitida` (mesma que o servidor).

**Behaviors:**
- [ ] Ver dados e itens do pedido, incluindo PII do cliente (nome, telefone, endereço). Garantido em: Server Component com leitura por `service_role` escopada por `lojaId` + `id` (nunca por token público; o admin já tem autoridade).
- [ ] Mudar o status do pedido (Confirmar / Iniciar preparo / Saiu / Entregue / Cancelar). **Garantido em: Server Action + escopo (RLS-equivalente).** A máquina de estados (`transicaoPermitida`) é revalidada no servidor; a UI é só conveniência. Salto/reversão de estado é rejeitado no servidor. Escopo cross-loja garantido pelo wrapper `escopo` (`.eq("loja_id", lojaId).eq("id", id)`) sob `service_role`.

---

### 5. Cupons — CRUD completo — `/admin/assinantes/[lojaId]/cupons` — **CRÍTICO**

**Mundo:** painel admin (auth admin).
**Descrição:** equivalente a `/painel/cupons`: listar, criar, editar e remover cupons. Cupom afeta **quanto o cliente paga**, portanto crítico.

**Componentes:**
- `CuponsClient` (reuso) — **parametrizar com `acoes?`** (`removerCupom`) + repassar actions de criação/edição ao `FormCupom`.
- `FormCupom` (reuso — `components/painel/FormCupom.tsx`) — **parametrizar com `acoes?`** (`criarCupom`, `atualizarCupom`); hoje importa as actions do lojista diretamente. Default = actions do lojista.
- `CuponsAdminClient.tsx` (novo wrapper admin) — injeta `criarCupomAdmin` / `atualizarCupomAdmin` / `removerCupomAdmin` com `lojaId` fixado em closure.

**Behaviors:**
- [ ] Listar cupons da loja-alvo (código, valor, usos, validade, status). Garantido em: Server Component, leitura por `service_role` escopada por `lojaId`. (Nunca há SELECT público de cupons — `seguranca.md` §cupons.)
- [ ] Criar cupom (código, tipo, valor, pedido mínimo, usos máximos, expiração, ativo). **Garantido em: Server Action + escopo.** `cupomSchema` revalidado no servidor; `loja_id` injetado por construção pelo wrapper (nunca do payload); código único por loja (violação `23505` → "Este código já existe"). O **valor** do cupom é definição comercial, não valor cobrado: a autoridade de quanto o cliente paga permanece em `validarCupom` + RPC `criar_pedido` no checkout (inalterado).
- [ ] Editar cupom. **Garantido em: Server Action + escopo** (`.eq("loja_id").eq("id")`), `patch` sem `loja_id`/`id` (Omit por tipo do wrapper).
- [ ] Remover cupom. **Garantido em: Server Action + escopo.**

---

### 6. Opcionais — biblioteca + associação — `/admin/assinantes/[lojaId]/produtos/opcionais` — **CRÍTICO (isolamento cross-tenant + preço autoritativo)**

**Mundo:** painel admin (auth admin).
**Descrição:** equivalente a `/painel/produtos/opcionais`: biblioteca de opcionais (categorias de opcional + itens com preço) e associação categoria-de-produto ⋈ categorias-de-opcional. Rota nova no admin. Cobre as 8 actions correspondentes.

**Componentes:**
- `OpcionaisClient` (reuso) — **parametrizar com `acoes?`** (8 actions: `criarCategoriaOpcional`, `atualizarCategoriaOpcional`, `removerCategoriaOpcional`, `criarOpcional`, `atualizarOpcional`, `alternarOpcionalAtivo`, `removerOpcional`, `salvarAssociacaoOpcionais`). Hoje importa todas diretamente. Default = actions do lojista.
- `OpcionaisAdminClient.tsx` (novo wrapper admin) — injeta as 8 variantes `*Admin` com `lojaId` fixado.
- Loader admin dos dados (categorias de opcional, opcionais, categorias de produto, associações) escopados por `lojaId` via `service_role`.

**Behaviors:**
- [ ] Listar/buscar biblioteca de opcionais da loja-alvo. Garantido em: Server Component, leitura escopada por `lojaId`.
- [ ] Criar/editar/remover categoria de opcional. **Garantido em: Server Action + escopo.**
- [ ] Criar/editar opcional com preço (acréscimo). **Garantido em: Server Action + escopo.** `schemaOpcional` revalidado no servidor (preço ≥ 0). O preço do opcional é **valor autoritativo do servidor** usado no checkout (snapshot em `itens_pedido_opcionais` via RPC `criar_pedido`); o admin o define aqui, mas o cliente nunca o influencia. Posse da `categoria_opcional_id` sob `lojaId` provada por `escopo.buscarPorId` antes de gravar (anti cross-tenant, já que `service_role` bypassa RLS).
- [ ] Alternar opcional ativo/inativo. **Garantido em: Server Action + escopo.**
- [ ] Remover opcional. **Garantido em: Server Action + escopo** (pedidos passados preservados por snapshot).
- [ ] Salvar associação categoria-de-produto ⋈ categorias-de-opcional. **Garantido em: Server Action + escopo.** Ambas as pontas (`categoria_id` de produto e cada `categoria_opcional_id`) revalidadas como da loja-alvo sob `lojaId` antes da escrita (RN-O8). O DELETE-por-`categoria_id` (substituição do conjunto) é escrita não-single: exceção documentada ao wrapper — `svc` cru com `.eq("loja_id", lojaId).eq("categoria_id", …)` explícitos (`seguranca.md` §EscopoLoja, "exceções legítimas").

---

### 7. Produtos (Cardápio) — fiação dos opcionais reais — `/admin/assinantes/[lojaId]/produtos` — **modificação**

**Mundo:** painel admin (auth admin).
**Descrição:** a aba/rota de cardápio existente (hoje `.../cardapio`, renomeada para `.../produtos` para paridade de URL) hoje passa `opcionaisPorCategoria={{}}` e `categoriasOpcional=[]` de propósito. Com a área de Opcionais no admin, plugar os dados reais: o rodapé de opcionais do produto e o seletor de categoria-opcional voltam a funcionar.

**Componentes:**
- `CardapioAdminClient.tsx` (modificar) — receber e repassar `opcionaisPorCategoria` e `categoriasOpcional` reais (carregados no loader admin), e injetar `salvarAssociacaoOpcionais` **admin** no `acoes` do `ProdutosClient` (hoje o `ProdutosClient` importa a variante do lojista direto na linha de import — adicionar `salvarAssociacaoOpcionais` ao contrato `acoes?`).
- `ProdutosClient` (reuso — já parametrizado por `acoes?`; adicionar `salvarAssociacaoOpcionais?` ao objeto `acoes`).

**Behaviors:**
- [ ] Ver os opcionais associados no rodapé de cada produto. Garantido em: Server Component (leitura escopada por `lojaId`).
- [ ] Editar a associação de opcionais pela categoria no cardápio. **Garantido em: Server Action + escopo** (mesma action admin da rota 6).

---

### 8. Configurações — consolidação de rota — `/admin/assinantes/[lojaId]/configuracoes`

**Mundo:** painel admin (auth admin).
**Descrição:** a página de configuração admin existente (`ConfiguracaoAdminClient`: perfil, horários, entregas, pagamentos, tema, logo, publicar) é mantida como página **consolidada única**, apenas movida de `.../configuracao` para `.../configuracoes` para paridade de URL com o item de nav. Sem mudança de lógica de escrita — as actions admin (091–095) já existem e funcionam.

**Componentes:**
- `ConfiguracaoAdminClient` (reuso, sem mudança) — já injeta as actions admin de perfil/horários/tema/entregas/pagamentos/logo/publicar.

**Nota (Princípio arquitetural):** a reflexão automática já é garantida no nível dos componentes — `PerfilClient`, `HorariosClient`, `EntregasClient`, `PagamentosClient` e `TemaClient` são os mesmos arquivos consumidos pelo painel e pelo admin; mudança futura neles reflete nos dois. A única divergência intencional é de *organização de página* (consolidada no admin vs subpáginas no painel), não de conteúdo/UI.

**Behaviors:**
- [ ] Editar perfil, horários, entregas, pagamentos, tema, logo e publicar/despublicar. **Garantido em: Server Actions admin existentes + escopo** (inalterado; geocoding, taxa, chave Pix e `ativo` decididos no servidor). Nenhum recálculo novo introduzido nesta rota.

---

## Modelos de Dados

**Nenhuma tabela ou coluna nova.** Toda a feature opera sobre tabelas existentes (ver `schema.md`), todas já com `loja_id` e RLS:

- `pedidos`, `itens_pedido`, `itens_pedido_opcionais` — leitura + escrita de status (rota 3/4).
- `cupons` — CRUD (rota 5). `UNIQUE (loja_id, codigo)`.
- `opcionais_categorias`, `opcionais`, `categoria_produto_opcionais` — CRUD + associação (rota 6/7).
- `lojas`, `categorias`, `produtos`, `zonas_entrega`, `taxas_entrega`, `bairros_zona`, `formas_pagamento` — já cobertos pelas actions admin existentes (rotas 7/8).

Como não há tabela nova, **não há migration nem RLS nova**. A isolação das escritas admin **não vem de RLS** (o `service_role` a bypassa) — vem do wrapper `escopo` (injeta `.eq("loja_id", lojaId)` por construção) + `verificarAdminSaaS()` antes de elevar (`seguranca.md` §7).

Loaders de leitura novos (server-only, escopados por `lojaId` via `service_role`, seguindo `carga.ts`): pedidos da loja-alvo, cupons da loja-alvo, agregado de opcionais da loja-alvo, `opcionaisPorCategoria` da loja-alvo. Onde a query existente já aceita `(client, lojaId)` (ex.: `buscarCategorias`, `buscarProdutosDoLojista`, `listarZonasComTaxas`), reusar; onde a query deriva a loja de `auth` (ex.: `listarPedidosDoDono`), criar variante `(svc, lojaId)`.

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| Toda action admin nova prova admin **antes** de elevar a `service_role` (fail-closed). | Server Action — `prepararContextoAdmin(lojaId)` → `verificarAdminSaaS()` fora do `try`, propaga. |
| Toda escrita admin numa tabela com `loja_id` usa `escopo.inserir/atualizar/remover/buscarPorId` — nunca `svc.from().update()/.delete()/.insert()` cru. | Server Action — wrapper `EscopoLoja` (injeta `.eq` por construção). Exceção documentada: DELETE-por-`categoria_id` da associação de opcionais. |
| `lojaId` validado como UUID (`z.guid()`) antes de qualquer efeito. | Server Action — `validarLojaIdAdmin`. |
| Mudança de status de pedido respeita a máquina de estados (sem salto/reversão). | Server Action — `transicaoPermitida` revalidada no servidor; UI só exibe transições válidas (conveniência). |
| Código de cupom único por loja. | CHECK no banco (`UNIQUE (loja_id, codigo)`) + tratamento `23505` na action. |
| Preço de opcional ≥ 0; valor de cupom > 0; percentual coerente. | zod (`schemaOpcional`, `cupomSchema`) revalidado na Server Action + CHECK no banco. |
| Posse cross-tenant de referências (`categoria_id`, `categoria_opcional_id`) sob `lojaId`. | Server Action — `escopo.buscarPorId` antes de gravar (RLS não protege sob `service_role`). |
| Valor que o cliente paga (cupom/frete/opcional). | **Inalterado:** recálculo autoritativo permanece no checkout (`validarCupom` + RPC `criar_pedido`). O admin define definições comerciais, nunca o valor cobrado num pedido. |
| Item Assinatura ausente no contexto admin. | Cliente (nav) — reforçado pela ausência de rota `.../assinatura`. |
| Painel do lojista é a fonte única do front: admin consome os mesmos componentes por parametrização; cópia de markup é regressão. | Estrutura de componentes (revisão de código) — componente compartilhado único por área, defaults = lojista. |

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** PII do cliente final em pedidos (nome, telefone, endereço) — o admin a lê via `service_role` escopado por `lojaId` (autoridade legítima; é o modelo de gestão em nome do lojista). Chave Pix e config comercial via Configurações (já coberto). Cupons nunca têm SELECT público — leitura só server-side escopada.
- **Valores monetários:** cupom (rota 5) e preço de opcional (rota 6) são **definições comerciais** gravadas pelo admin, com validação zod + CHECK no servidor. **Não introduzem novo ponto de recálculo de valor cobrado** — a autoridade de quanto o cliente paga continua no checkout (`criar_pedido` recalcula do banco, `seguranca.md` §10). Status de pedido (rota 4) é permissão/estado, revalidado no servidor.
- **Tabela nova?** Não — nenhuma RLS nova. Isolação por `escopo` + `verificarAdminSaaS()`, não por RLS (service_role bypassa).
- **API externa com key?** Não introduzida por esta feature (geocoding/ViaCEP das Configurações já existem e são server-side).
- **Enforcement automático:** as actions novas em `src/app/admin/assinantes/actions/*.ts` (`admin-cupom.ts`, `admin-opcionais.ts`, `admin-status.ts`) são auto-descobertas por `enforcement-escopo-admin.test.ts` e `isolamento-admin.test.ts` — devem passar sem editar as suítes (camada 2: referência a `prepararContextoAdmin`/`verificarAdminSaaS`; camada 3: todo `.update()/.delete()` cru com `.eq(...)`).
- **TDD red-first (crítica: SIM):** rotas 4 (status de pedido), 5 (CRUD cupom) e 6 (CRUD opcionais — isolamento cross-tenant + preço autoritativo) exigem teste vermelho antes da implementação: isolamento cross-loja (admin de loja A não escreve em loja B), rejeição de transição de status inválida, unicidade de código de cupom, e posse de referências de opcional.
- **Auditoria/LGPD (débito):** `registrarAcessoAdmin` continua no-op — o acesso do admin a PII de cliente não é logado hoje. Registrar como débito; não bloqueia esta feature, mas o volume de PII exposta ao admin cresce (pedidos), então elevar prioridade do log de acesso.

## Fora de Escopo (v1)

- **Aba/rota Assinatura no admin** — autogestão do lojista; item oculto no nav.
- **Impersonation de sessão** — o modelo continua `service_role` escopado, nunca "logado como o lojista".
- **Split das Configurações admin em subpáginas** (perfil/horários/entregas/pagamentos/tema como rotas separadas, espelhando `/painel/configuracoes/*`) — o admin mantém a página consolidada única (`ConfiguracaoAdminClient`). Divergência intencional; subpáginas ficam para fase futura se necessário.
- **Mudanças no painel do lojista além da parametrização mínima** para reuso (`acoes?`/`basePath`/`contexto` com defaults = comportamento atual). Nenhuma regressão de comportamento do lojista.
- **Notificação em tempo real de pedido** (Realtime) — fase 2 (`modelo-negocio.md` §8).
- **Implementação do log de auditoria de acesso admin** — registrado como débito, não construído aqui.

---

**Próximo passo:** `/break` passando este spec (`specs/paridade-hub-admin-painel.md`) para gerar as issues acionáveis, respeitando a ordem de dependência (pré-req 115 → parametrização dos componentes do painel → actions admin com TDD red-first nas críticas → wrappers e rotas → shell parametrizado).
