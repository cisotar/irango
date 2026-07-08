# Spec: Imprimir pedido a partir do painel do lojista (3 variantes + gating por módulo)

**Versão:** 0.6.0 | **Atualizado:** 2026-07-07

> **Changelog 0.6.0 (IMPLEMENTADO via /fluxo, 2026-07-07):** issues 127–139 entregues
> (TDD red-first em todas as críticas). Migrations `20260707120000` (colunas de
> módulo) e `20260707121000` (trigger v3) **aplicadas no cloud** + tipos canônicos
> regenerados. Suíte **2371 verde**, `next build` verde. Auditorias: 1 CRÍTICA
> encontrada+corrigida no mesmo ciclo (trigger v1/v2 era só `BEFORE UPDATE` →
> INSERT self-service auto-provisionava módulo pago / assinatura ativa; corrigido
> para `BEFORE INSERT OR UPDATE` default-aware). Débitos abertos: 140 (gate `ativo`
> em `definirPublicacao`), 141 (`formatarNumeroPedido`), + nota de log de acesso
> admin (LGPD, pré-existente). **Pendente:** confirmação visual manual do
> print-preview das 3 variantes (👁️ nos behaviors).
>
> **Changelog 0.5.0 (auditoria contra o codebase, 2026-07-07):** todas as
> afirmações do levantamento foram validadas contra o código real (caminhos e
> nomes conferidos e corrigidos abaixo). Decisões abertas resolvidas com
> recomendação firme: **DA-M1 → Opção A** (duas colunas booleanas em `lojas`);
> **RN-M2 (admin) → espelhar o entitlement da loja**. Correções estruturais:
> (a) `ListaOpcionaisItem` **sempre** renderiza preço hoje — ocultar preço exige
> **prop nova aditiva**, não é reuso as-is; (b) o guard `painel/layout.tsx` lê a
> loja mas **não** a propaga para a page — a page precisa chamar
> `buscarLojaDoDono` (reuso da query, não `.from('lojas')` inline); (c) o loader
> admin `carregarPedidoDetalheAdmin` só carrega o pedido — o entitlement da loja
> exige leitura extra escopada; (d) o componente shadcn `dropdown-menu` **não
> existe** em `components/ui/` — precisa `npx shadcn add dropdown-menu`.

## Visão Geral

Hoje o lojista abre um pedido em `/painel/pedidos/[id]` (componente
`DetalhePedido.tsx`) e vê todos os dados na tela — cliente, endereço, itens com
opcionais, subtotal, desconto/cupom, taxa, total, pagamento e observações — mas
**não tem como imprimir**. Não existe nenhuma funcionalidade de impressão/PDF no
projeto (busca por `print|impress|pdf|recibo` só achou falsos positivos) e
nenhuma lib de PDF no `package.json`. É greenfield.

Esta feature adiciona um **seletor "Imprimir"** no detalhe do pedido, deixando o
lojista **escolher entre três variantes de impressão**, todas acionadas pelo mesmo
mecanismo nativo (`window.print()`), cada uma com sua **folha de estilo `@media
print`** e seu bloco de conteúdo dedicado:

1. **Comum (A4)** — detalhe completo: itens + opcionais + preços + cupom + total +
   dados do cliente/entrega. Comprovante completo para arquivo/atendimento.
2. **Via da cozinha (térmica 80mm)** — **resumo de preparo**: itens, quantidades,
   opcionais e observações. **Sem preços, sem totais, sem pagamento.**
3. **Recibo do cliente (térmica 80mm) — NÃO-FISCAL** — via de cortesia: itens +
   preços + total + dados básicos. **NÃO é documento fiscal** (ver aviso abaixo).

Além disso, as variantes podem ser **vendidas/liberadas como módulos** (ver
"Gating por módulo"): o SaaS controla, por loja, quais variantes de impressão
estão habilitadas. **Esse controle é comercial/permissão — logo é
server-autoritativo** (`seguranca.md` §10: cliente nunca decide o que pode).

> ⚠️ **"Recibo/cupom" aqui = comprovante NÃO-FISCAL de apresentação, nunca
> documento tributário.** O iRango **não** emite NFC-e / SAT / ECF, **não** integra
> com a SEFAZ, **não** usa certificado digital e **não** calcula valor tributário
> (`modelo-negocio.md`). O usuário confirmou que "cupom fiscal", neste pedido,
> significa **recibo não-fiscal**. A variante 3 imprime "Documento sem valor
> fiscal" (RN-P6).

**Mundo:** painel do lojista (`/painel/pedidos/[id]`) — auth obrigatório.
`DetalhePedido` é componente compartilhado; a página espelho do admin
(`/admin/assinantes/[lojaId]/pedidos/[id]`) herda o seletor (mesmo markup, sem
cópia).

---

### Decisão técnica: `window.print()` nativo, não lib de PDF

**Mantida a decisão anterior:** `window.print()` + CSS `@media print`, sem
dependência nova. As **três variantes convivem** com esse mecanismo — cada uma é
apenas um **bloco de conteúdo + regras `@media print` distintas**, selecionado
antes de disparar a impressão (ver RN-P3). Alternativas descartadas:

| Critério | (a) `window.print()` + `@media print` | (b) `react-to-print` | (b') `@react-pdf/renderer` |
|---|---|---|---|
| Dependência nova | **Nenhuma** | +1 (wrapper de `window.print`) | +1 (pesada, renderer próprio) |
| Suporta 3 variantes | **Sim** (classe por variante + `@media print`) | Sim, com mais cerimônia | Só reescrevendo 3 layouts |
| Reusa `DetalhePedido` (A4) | **Sim** (imprime o DOM já renderizado) | Sim (via ref) | **Não** — reescrever em primitivas |
| Escolha A4 × 80mm no papel | **No diálogo do navegador** | idem (mesmo motor) | fixa no código |
| Custo / bundle | Zero | Pequeno | Grande |
| Atrito Next 16 / RSC | Nenhum (1 Client Component seletor) | Baixo | SSR friction histórico |

Justificativa alinhada a `architecture.md` §7/§9 ("não reinventar a roda", "custo
previsível"): `react-to-print` é só um wrapper sobre `window.print()`;
`@react-pdf/renderer` duplicaria três layouts em primitivas próprias (viola DRY) e
traz bundle grande para o que o "Salvar como PDF" nativo já cobre.
`window.print()` imprime o snapshot autoritativo já renderizado sob RLS — nenhum
valor recalculado no cliente, nenhum dado novo trafega.

> **Nota de reuso (corrigida na 0.5.0):** o **único** primitivo shadcn novo é o
> menu do seletor. `src/components/ui/` hoje tem `badge, button, card, checkbox,
> dialog, input, label, radio-group, separator, sheet, switch, textarea` —
> **`dropdown-menu` NÃO está presente.** Não hand-rollar um menu: gerar via
> `npx shadcn add dropdown-menu` (Radix, mesmo padrão de `dialog`/`sheet` já
> presentes). Se o time preferir zero novo primitivo, o seletor degrada para um
> `Button` por variante habilitada (2–3 botões no cabeçalho) — mas o
> `DropdownMenu` é a UX recomendada.

**Papel:** A4 é o padrão do navegador para a variante 1; para as 2 e 3 o lojista
escolhe **térmica 80mm** no diálogo. O CSS das variantes térmicas usa coluna
única, largura fluida (`width:auto`, sem `max-width` em px de tela) e fonte
compacta — cabe em 80mm **sem hardcodar largura** e ainda sai legível em A4.

---

### Gating por módulo (controle comercial server-autoritativo)

**O que existe hoje no codebase (levantamento — VALIDADO em 2026-07-07):**

| Afirmação do spec | Status | Caminho/detalhe real conferido |
|---|---|---|
| `lojas.assinatura_status` gate global do painel | ✅ confere | Enum **6 valores**: `trial, ativa, inadimplente, cancelada, suspensa, cortesia` (migration `20260621093000_lojas_expand_billing.sql`). **`schema.md` está desatualizado** (lista só 4) — dívida de doc, não do código. |
| `acessoPainel.ts` + `assinaturaPermiteAcesso` + guard `painel/layout.tsx` | ✅ confere | `src/lib/utils/acessoPainel.ts` (`decidirAcessoPainel`, reusa `assinaturaPermiteAcesso` de `src/lib/utils/assinatura.ts`); guard em `src/app/(painel)/painel/layout.tsx`. Fail-closed. |
| `lojas.plano_id` → `planos(id)`; `planos` catálogo | ✅ confere | FK `plano_id uuid references planos(id)` (migration `20260621093000`); tabela `planos` (migration `20260621090000_planos.sql`) com `preco` (autoritativo), `provider_price_id`, `ativo`, `intervalo`. **Sem coluna de capabilities/features** — confere. `plano_id` **não** afeta acesso hoje. |
| `CAMPOS_LOJA_SOMENTE_SERVIDOR` em `lib/actions/admin-loja.ts` | ✅ confere | `src/lib/actions/admin-loja.ts` linha 50 — **13 colunas** hoje (`id, dono_id, assinatura_*×4, hotmart_*×2, billing_provider, provider_subscription_id, plano_id, consentimento_versao, consentimento_em`). Fonte única do guard de tipo + filtro de runtime de `atualizarLoja`. |
| Trigger `lojas_protege_billing_trg` | ✅ confere | Função `public.lojas_protege_billing()` (migration `20260621094000_lojas_protege_billing_v2.sql`, issue 074) protege **10 colunas** (assinatura_*×4, hotmart_*×2, `dono_id`, `billing_provider`, `provider_subscription_id`, `plano_id`); bypass só `service_role`/`postgres`/`supabase_admin`. |
| `buscarPedidoDoDono`, `buscarLojaDoDono` | ✅ confere | `src/lib/supabase/queries/pedidos.ts` (`buscarPedidoDoDono`, linha 86); `src/lib/supabase/queries/lojas.ts` (`buscarLojaDoDono`, linha 62, `select("*")` → `LojaCompleta = Tables<"lojas">`). |
| `DetalhePedido.tsx` | ✅ confere | `src/components/painel/DetalhePedido.tsx` — Server Component **puro** (sem `'use client'`, sem I/O). Props atuais: `{ pedido, basePedidos?, acaoStatus? }`. **Não** renderiza `token_acesso`. |
| `ListaOpcionaisItem` | ⚠️ **corrigir** | `src/components/**vitrine**/ListaOpcionaisItem.tsx` (não `painel/`). Props hoje: `{ opcionais, className? }` — **sempre renderiza `formatarMoeda(...)`**. **Não existe** opção de ocultar preço. Ver correção na variante 2. |
| `formatarMoeda` | ✅ confere | `src/lib/utils/formatarMoeda.ts`. |
| RLS `pedidos_acesso_lojista` | ✅ confere | migration `20260614002500_rls_cupons_pedidos.sql` (`FOR ALL USING/ WITH CHECK` por `dono_id`). |
| Página espelho admin `/admin/assinantes/[lojaId]/pedidos/[id]` | ✅ confere | `src/app/admin/assinantes/[lojaId]/pedidos/[id]/page.tsx` — reusa `DetalhePedido`; carrega via `carregarPedidoDetalheAdmin(lojaId, id)` (`.../[lojaId]/carga-pedido-detalhe.ts`, loader `service_role` fail-closed escopado por `loja_id`+`id`). **Só carrega o pedido, não a loja** (ver RN-M2). |

**O que NÃO existe hoje:** **nenhum primitivo de entitlement por-feature / add-on.**
Não há tabela de módulos, coluna de capabilities em `planos`, nem feature-flag. O
gating atual é global (painel on/off via `assinatura_status`) + um único
`plano_id` que nem afeta acesso. `modelo-negocio.md` também não descreve
add-ons/módulos pagos (mensalidade fixa única). Liberar variantes de impressão por
loja **exige um primitivo novo**.

> **Recorte comercial DEFINIDO (confirmado pelo dono do SaaS):** **dois módulos
> pagos independentes** —
> - **Módulo A — "Impressão PDF/A4"**: variante 1 (comum A4 + Salvar como PDF).
> - **Módulo B — "Impressão Térmica"**: variantes 2 e 3 (via cozinha + recibo).
>
> A loja pode contratar um, outro, ambos ou nenhum. Sem nenhum módulo → sem
> seletor "Imprimir" (v1: silencioso; CTA de upgrade é fora de escopo). O mapa
> módulo→variantes vive num único ponto (`variantesHabilitadas`, RN-M2).
>
> ⚠️ **Limite físico do Módulo A (deixar claro na venda):** a variante A4 é o
> próprio `DetalhePedido` visível na tela — impossível "não renderizar". Um
> lojista sem o Módulo A ainda consegue `Ctrl/Cmd+P` e imprimir a **tela crua**
> (com chrome, sem formatação). O que o Módulo A vende é o **layout formatado de
> comprovante** (CSS print limpo): sem o módulo, o bloco `@media print` da
> variante A4 **não é servido** e o impresso sai como página comum de navegador.
> Não é bypass de dado (o lojista já vê tudo na tela) — é limite inerente ao
> navegador, documentado para não prometer bloqueio impossível (RN-M1).

#### DA-M1 — RESOLVIDA: **Opção A (duas colunas booleanas em `lojas`)** para v1

Recomendação firme (recorte técnico, pronto para `/break`):

- **Opção A (ESCOLHIDA v1):** migration adicionando a `lojas`
  `modulo_impressao_a4 boolean not null default false` e
  `modulo_impressao_termica boolean not null default false`. Lidas
  automaticamente na `LojaCompleta` (`= Tables<"lojas">`, `buscarLojaDoDono` faz
  `select("*")`) — **zero query nova, zero política RLS nova** (`lojas` já tem
  RLS).
- **Opção B (adiada):** tabela `loja_modulos (loja_id, modulo, ativo)` ou
  `planos.recursos jsonb` — só se um marketplace real de add-ons surgir.

**Justificativa da escolha A:**
1. **Grão correto = por loja, não por plano.** O recorte comercial diz módulos
   **independentes, contratáveis em qualquer combinação** — duas lojas no mesmo
   `plano_id` podem ter módulos diferentes. Isso **descarta** `planos.recursos
   jsonb` (capability de bundle) como grão. O entitlement é por-tenant → coluna
   em `lojas` é o grão natural.
2. **Reuso máximo da infra existente.** As colunas fluem por `LojaCompleta` sem
   nova query; e a proteção billing é estendida pelo **mesmo padrão já provado**
   da migration 074 (`CREATE OR REPLACE FUNCTION lojas_protege_billing()`
   aditivo). Nenhuma superfície RLS nova para revisar.
3. **YAGNI.** Catálogo de exatamente 2 módulos, mensalidade única no
   `modelo-negocio.md`. A escalabilidade da Opção B é especulativa.
4. **Migração A→B é limpa depois** (backfill de 2 booleans → linhas) — escolher A
   agora **não tranca** a evolução para B.

**Pendente de aval do dono do SaaS (não bloqueia o `/break` técnico):** apenas o
**empacotamento comercial/nomes de venda** (rótulo dos módulos, preço, bundle) —
a decisão de arquitetura (colunas por loja) está firme.

Independente da opção, valem as **invariantes de segurança**:
1. O gate é **server-autoritativo**: o Server Component decide renderizar (ou não)
   cada variante a partir do banco. **Não** basta esconder via CSS — bloco não
   habilitado **não é renderizado no DOM** (RN-M1).
2. A flag é **billing-controlled**: setada por admin/`service_role`/webhook,
   **nunca** editável pelo lojista. Precisa (Opção A):
   - entrar em `CAMPOS_LOJA_SOMENTE_SERVIDOR` (`admin-loja.ts` — 13 → 15 colunas);
   - ser adicionada às checagens `is distinct from` de `lojas_protege_billing()`
     via **nova migration** `CREATE OR REPLACE FUNCTION` (10 → 12 colunas
     protegidas), espelhando a issue 074 (o trigger aponta por nome — não recriar);
   - default `false` (fail-closed: loja nasce sem o módulo pago).
   - As actions de update do lojista (`salvarPerfil`/`salvarHorarios`/`salvarTema`
     em `src/lib/actions/loja.ts`) montam **patch explícito** (allowlist por
     construção) — as colunas de módulo já ficam de fora por não serem incluídas.
     O hardening de `atualizarLoja` (admin, issue 115) **já está implementado** e
     exclui automaticamente tudo em `CAMPOS_LOJA_SOMENTE_SERVIDOR`.

---

## Atores Envolvidos

- **iRango (SaaS):** decide server-side quais variantes a loja pode imprimir
  (entitlement), renderiza só os blocos habilitados a partir do snapshot
  autoritativo (RLS), e fornece o seletor + regras `@media print`. Controla a flag
  de módulo via admin/webhook. Não gera arquivo, não expõe endpoint novo.
- **Lojista:** vê no seletor apenas as variantes que sua loja tem habilitadas,
  escolhe uma, escolhe impressora/papel no diálogo e imprime. Não pode
  auto-habilitar módulo pago.
- **Cliente:** não opera nada — apenas **recebe fisicamente** o recibo (variante
  3), se o lojista optar por imprimi-lo.

---

## Páginas e Rotas

### Detalhe do pedido — `/painel/pedidos/[id]`

**Mundo:** painel (auth obrigatório) — leitura escopada pela RLS
`pedidos_acesso_lojista` via `buscarPedidoDoDono`. Pedido de outra loja → `null` →
`notFound()`.

**Descrição:** página já existente (Server Component fino: I/O + delega a
apresentação a `DetalhePedido`). Passa a: (i) resolver o **entitlement de
impressão da loja** e repassá-lo a `DetalhePedido`; (ii) exibir o **seletor
"Imprimir"** com **apenas** as variantes habilitadas.

> **Correção 0.5.0 — como a page obtém o entitlement.** O guard
> `painel/layout.tsx` **lê** a loja (`buscarLojaDoDono` → `LojaCompleta`), mas
> **não propaga** esse objeto para a page (layout e page são fronteiras de render
> distintas no App Router — layout não passa props para `children`). Logo, a page
> `/painel/pedidos/[id]/page.tsx` **precisa chamar `buscarLojaDoDono(supabase)`
> ela mesma** (uma 2ª leitura de `lojas`, sob RLS) — reusando a **query
> existente**, nunca `.from('lojas')` inline (`architecture.md` §8). Como
> `LojaCompleta = Tables<"lojas">` e a query faz `select("*")`, as colunas de
> módulo (Opção A) chegam automaticamente. A page passa a
> `variantesHabilitadas(loja)` e repassa o resultado a `DetalhePedido`.

**Componentes:**
- `DetalhePedido` (`components/painel/DetalhePedido.tsx`) — **reuso, sem
  duplicar**. Continua Server Component puro. Ganha: prop nova
  `modulosImpressao` (lista de variantes habilitadas, já decidida no servidor); o
  seletor no bloco do título; `className` marcando o detalhe atual como conteúdo
  da variante A4 e o chrome como `no-print`; e a renderização **condicional** dos
  blocos das variantes habilitadas. Assinatura atual `{ pedido, basePedidos?,
  acaoStatus? }` → passa a `{ pedido, basePedidos?, acaoStatus?, modulosImpressao }`.
- `SeletorImprimirPedido` (`components/painel/SeletorImprimirPedido.tsx`) —
  **componente novo, Client Component** (`'use client'` — handler DOM). Recebe
  como prop a lista de variantes habilitadas (decidida no servidor). É um
  `DropdownMenu` (shadcn/ui — **gerar via `npx shadcn add dropdown-menu`, não
  presente hoje**) com trigger `Button variant="outline" size="sm"` + ícone
  `Printer` (lucide-react) e um item por variante habilitada. Ao selecionar,
  aplica a variante e dispara `window.print()` (RN-P3). Marcado `no-print`. Sem
  I/O, sem estado persistente. Se só uma variante estiver habilitada, degrada para
  botão simples.
- `ComandaCozinha` (`components/painel/ComandaCozinha.tsx`) — **novo Server
  Component puro**. Bloco de preparo **sem preços** (variante 2). Reusa
  `ListaOpcionaisItem` **com a prop nova `ocultarPreco`** (ver correção abaixo).
  Print-only; **só renderizado se a loja tem a variante habilitada**.
- `ReciboCliente` (`components/painel/ReciboCliente.tsx`) — **novo Server
  Component puro**. Cupom do cliente **com preços + aviso não-fiscal** (variante
  3). Reusa `formatarMoeda` e `ListaOpcionaisItem` (com preço, comportamento
  atual). Print-only; **só renderizado se habilitado**.
- `ListaOpcionaisItem` (`components/vitrine/ListaOpcionaisItem.tsx`) — **reuso COM
  extensão aditiva.** Hoje **sempre** renderiza `formatarMoeda(op.preco * op.quantidade)`.
  A variante 2 (cozinha) precisa dos opcionais **sem preço** → adicionar prop
  opcional `ocultarPreco?: boolean` (default `false`, mantém todos os callers
  atuais — carrinho/confirmação — intactos): quando `true`, não renderiza o
  `<span>` do valor. Mudança pequena e retrocompatível; **não** duplicar o
  componente.
- `Button` / `DropdownMenu` / `Card` / `Badge` / `Separator` — shadcn/ui
  (`DropdownMenu` a gerar); demais já presentes, sem mudança de contrato.
- `AcoesStatus` (card "Ações") — não muda; ocultado em todas as variantes (RN-P2).
- `NavPainel` (`SidebarPainel`/`TopbarPainel`) — chrome; ocultado (RN-P2).
- `variantesHabilitadas(loja)` — **util puro novo** (`lib/utils/`), fonte única do
  mapa módulo→variantes (RN-M2). Recebe a loja/flags e devolve a lista de variantes
  liberadas. Testável sem I/O.
- `globals.css` — bloco `@media print` (fonte única, sub-regras por variante).

**Behaviors:** _(✅ = implementado + coberto por teste; 👁️ = requer confirmação visual
manual no print-preview do navegador — issue 139, não automatizada nesta rodada)_
- [x] Ver o seletor "Imprimir" no cabeçalho do detalhe **somente se a loja tem
  ao menos um módulo**; sem módulo, sem seletor (v1: silencioso; CTA de upgrade
  fora de escopo). Garantido em: **Server (SSR) + entitlement**. ✅ (136/135)
- [x] Abrir o seletor e ver **apenas** as variantes habilitadas para a loja.
  Garantido em: **Server (SSR) + entitlement** — a lista de opções é decidida no
  servidor a partir da flag de módulo; variante não habilitada nem chega ao
  cliente (RN-M1). ✅ (130/135/136)
- [x] Escolher **"Comum (A4)"** → imprime o detalhe completo. Garantido em:
  cliente (variante A4 + `window.print()`); valores em **Server (SSR) + RLS**;
  disponibilidade em **Server (entitlement)**. ✅ handler/gate + 👁️ print-preview
- [x] Escolher **"Via da cozinha"** → imprime resumo de preparo **sem
  preços/totais/pagamento**. Garantido em: cliente (`window.print()`); conteúdo em
  **Server (SSR) + RLS**; disponibilidade em **Server (entitlement)**. ✅ (133, zero-financeiro provado por mutação) + 👁️
- [x] Escolher **"Recibo do cliente"** → imprime cupom não-fiscal (itens + preços
  + total + básicos + aviso). Garantido em: cliente (`window.print()`); valores em
  **Server (SSR) + RLS**; disponibilidade em **Server (entitlement)**. ✅ (134, aviso RN-P6 + não-recálculo provados) + 👁️
- [x] **Não** ver (nem conseguir imprimir) uma variante que a loja não tem no
  plano. Garantido em: **Server (entitlement) + RLS/allowlist** — bloco não
  renderizado no DOM; o lojista não pode auto-habilitar o módulo (RN-M1/RN-M3). ✅ (135/128/129, isolamento 139)
- [x] Em qualquer variante, ver **apenas o conteúdo daquela variante** — sem
  chrome, sem "Voltar", sem "Ações", sem seletor, sem os blocos das outras.
  Garantido em: cliente (CSS `@media print` por variante). ✅ CSS fail-closed revisado + 👁️
- [x] Escolher impressora e papel (A4 ou térmica 80mm) e/ou "Salvar como PDF".
  Garantido em: cliente (diálogo nativo do navegador). ✅ nativo (sem código) + 👁️

---

### Detalhe do pedido (espelho admin) — `/admin/assinantes/[lojaId]/pedidos/[id]`

**Mundo:** painel admin do SaaS (auth admin — `verificarAdminSaaS()`; leitura via
loader `service_role` escopado por `loja_id`).

**Descrição:** herda o seletor e as variantes por compartilhar `DetalhePedido`.

> **Correção 0.5.0 — entitlement no caller admin.** O loader
> `carregarPedidoDetalheAdmin(lojaId, id)` (`.../[lojaId]/carga-pedido-detalhe.ts`)
> hoje carrega **só o pedido** — não a loja. Para o admin resolver o entitlement
> ele precisa de uma **leitura extra escopada da loja-alvo** (flags de módulo) via
> `service_role`, seguindo o padrão dos loaders `carga*.ts` do hub admin
> (`validarLojaIdAdmin(lojaId)` → `.eq("id"/"loja_id", lojaId)`), e então
> computar `variantesHabilitadas(loja)` — o **mesmo util** do painel (uma fonte,
> um caminho de código).

**Decisão RN-M2 (admin) — RESOLVIDA: espelhar o entitlement da loja.** O admin, ao
operar em nome da loja, vê **exatamente** as variantes que o lojista veria —
mesma chamada `variantesHabilitadas(loja-alvo)`. Justificativa: fidelidade de
suporte (o admin reproduz o que o lojista relata) + consistência com o princípio
"o hub admin reusa o painel por parametrização" (`architecture.md` §8) + DRY (um
único caminho de entitlement). "Ver tudo no admin" seria um **override explícito**
de mais poder de impressão — **fora de escopo v1**. **Pendente de aval do dono
(não bloqueia v1):** se algum fluxo de suporte exigir imprimir uma variante que a
loja não contratou, isso vira um override deliberado numa spec futura.

**Behaviors:**
- [x] Admin imprime as variantes habilitadas de um pedido de loja assinante.
  Garantido em: cliente (UX) + loader `service_role` escopado + entitlement
  server-side (autoridade do dado e do módulo no servidor). ✅ (137, isolamento
  cross-tenant provado por mutação) + 👁️ print-preview manual pendente.

---

## Modelos de Dados

**A parte de impressão em si é 100% apresentação** (sem migration): as tabelas
`pedidos` + `itens_pedido` + `itens_pedido_opcionais` (ver `schema.md`) continuam
lidas pela via atual (`buscarPedidoDoDono` sob RLS no painel; loader
`service_role` escopado no admin). Nenhum campo de pedido novo; `token_acesso`
**não** entra em nenhuma variante.

**A parte de gating por módulo EXIGE primitivo novo (pré-requisito, DA-M1 →
Opção A escolhida):**
- **Migration 1 — colunas em `lojas`:** `modulo_impressao_a4 boolean not null
  default false`, `modulo_impressao_termica boolean not null default false`.
  `lojas` já tem RLS/políticas — **nenhuma política nova**. `default false` =
  fail-closed. `select("*")` de `buscarLojaDoDono` já as traz para `LojaCompleta`
  após regenerar os tipos (`npx supabase gen types typescript`).
- **Migration 2 — estender a proteção billing:** `CREATE OR REPLACE FUNCTION
  public.lojas_protege_billing()` adicionando `modulo_impressao_a4` e
  `modulo_impressao_termica` às checagens `is distinct from` (10 → 12 colunas
  protegidas). O trigger `lojas_protege_billing_trg` aponta por nome — **não
  recriar**. Espelha exatamente a migration `20260621094000` (issue 074).
- **Código — `CAMPOS_LOJA_SOMENTE_SERVIDOR`** (`admin-loja.ts`): adicionar as duas
  colunas (13 → 15). Guard de tipo + filtro de runtime de `atualizarLoja` já
  consomem essa lista única.

> **Se um dia migrar para Opção B** (`loja_modulos`): tabela nova **exige política
> RLS própria antes de produção** (`seguranca.md` §2) — SELECT escopado por
> `loja_id = lojas.dono_id`; INSERT/UPDATE/DELETE **negados** ao lojista (só
> `service_role`/admin). Fora de escopo v1.

Seja qual for a opção, **nenhuma tabela/coluna de módulo é editável pelo
lojista**.

---

## Regras de Negócio

**RN-P1 — Conteúdo de cada variante (todo do snapshot autoritativo).** Camada
comum: **Server (SSR) + RLS** — todo valor é o snapshot gravado; a impressão nunca
recalcula (invariante do cabeçalho de `DetalhePedido`).

| Campo | 1. Comum A4 | 2. Via cozinha | 3. Recibo cliente |
|---|:---:|:---:|:---:|
| Nº do pedido (`id[0:8]` maiúsculo) | ✅ | ✅ | ✅ |
| Data/hora do pedido | ✅ | ✅ | ✅ |
| Status | ✅ | opcional | — |
| Nome do cliente | ✅ | ✅ (identificação) | ✅ |
| Telefone do cliente | ✅ | — | ✅ |
| Tipo de entrega (retirada/entrega) | ✅ | ✅ | ✅ |
| Endereço de entrega | ✅ | resumido (bairro) | ✅ |
| Itens (qtd × nome) | ✅ | ✅ (qtd em destaque) | ✅ |
| Opcionais por item | ✅ (com preço) | ✅ (**sem preço** → `ocultarPreco`) | ✅ (com preço) |
| Observações | ✅ | ✅ (**destaque**) | opcional |
| Preço unitário/linha | ✅ | ❌ | ✅ |
| Subtotal | ✅ | ❌ | ✅ |
| Desconto + código do cupom | ✅ (se `desconto>0`) | ❌ | ✅ (se `desconto>0`) |
| Taxa de entrega | ✅ | ❌ | ✅ |
| **Total** | ✅ | ❌ | ✅ |
| Forma de pagamento / troco | ✅ | ❌ | ✅ |
| Nome da loja (cabeçalho) | opcional | opcional | ✅ |
| Aviso "Documento sem valor fiscal" | — | — | ✅ (RN-P6) |
| `token_acesso` | ❌ nunca | ❌ nunca | ❌ nunca |

- **Variante 2 (cozinha):** foco em preparo, **zero informação financeira**;
  opcionais renderizados com `ListaOpcionaisItem ocultarPreco`; observações em
  destaque ("sem cebola", "bem passado").
- **Variante 3 (recibo):** financeiro completo, **não-fiscal** (RN-P6);
  opcionais com preço (comportamento atual de `ListaOpcionaisItem`).

> **Coerência (verificada 0.5.0):** a coluna "2. Via cozinha" da tabela nega todo
> campo financeiro (preço, subtotal, desconto, taxa, total, pagamento) — bate 1:1
> com a descrição de `ComandaCozinha` ("sem preços"). A coluna "3. Recibo" inclui
> todo o financeiro + aviso não-fiscal — bate com `ReciboCliente`. O único ponto
> que dependia de infra inexistente (opcionais sem preço na cozinha) foi resolvido
> com a prop `ocultarPreco`.

**RN-P2 — O que NUNCA sai no impresso (marcado `no-print`).** Em todas as
variantes: chrome (`NavPainel`), link "Voltar aos pedidos", card "Ações"
(`AcoesStatus`), o `SeletorImprimirPedido`, e os blocos das outras variantes.
Camada: cliente (CSS `@media print`). Regra estética — nada disso é dado.

**RN-P3 — Seleção da variante + disparo (fonte única em `globals.css`).**
Sem round-trip de rota:
1. Os conteúdos habilitados coexistem no DOM. O detalhe visível é fonte da
   variante A4; `ComandaCozinha`/`ReciboCliente` são print-only.
2. Ao escolher, o `SeletorImprimirPedido` grava a variante ativa em
   `document.documentElement.dataset.printVariant = "a4" | "cozinha" | "recibo"` e
   chama `window.print()`.
3. `@media print` mostra só a variante ativa e oculta o resto + tudo `no-print`
   (ex. `html[data-print-variant="cozinha"] .print-a4, …{display:none}`).
4. Limpa o atributo no evento `afterprint`.
Alternativa descartada: rota/param dedicada (`?imprimir=cozinha`) — recarrega e
complica o gesto. Camada: cliente. Papel escolhido no diálogo (não hardcodar 80mm).

**RN-P4 — O disparo nunca falha por dado.** `window.print()` é síncrono e nativo.
Cancelar no diálogo não faz nada. Sem caminho de erro no código. Camada: cliente.

**RN-P5 — Sem gesto automático.** Impressão só pela escolha do lojista. Proibido
`window.print()` em `useEffect`/no carregamento. Camada: cliente (por design).

**RN-P6 — Aviso não-fiscal obrigatório na variante 3.** `ReciboCliente` imprime,
em rodapé visível, texto fixo como **"Documento sem valor fiscal — comprovante de
pedido."** Não é NFC-e/SAT/ECF: sem SEFAZ, sem certificado, sem tributo. Proibido
usar "cupom fiscal"/"nota fiscal" no impresso. Camada: conteúdo estático server-side.

**RN-M1 — Entitlement é server-autoritativo, fail-closed.** Quais variantes o
lojista pode imprimir é decidido **no servidor** a partir da flag de módulo da loja
(`seguranca.md` §10). Bloco de variante **não habilitada não é renderizado no
DOM** — nunca só escondido por CSS (senão o "View Source"/print-preview burla).
Dúvida sobre o estado da flag → **não habilita** (fail-closed, mesma postura de
`decidirAcessoPainel`). Camada: **Server (SSR) + entitlement**.

**RN-M2 — Mapa módulo→variantes (recorte confirmado).** **Módulo A ("Impressão
PDF/A4") → variante 1; Módulo B ("Impressão Térmica") → variantes 2 e 3.** Ambos
pagos, independentes, contratáveis em qualquer combinação. Nenhum módulo → sem
seletor (v1 silencioso). O código lê o mapa de um único ponto
(`variantesHabilitadas`) para trocar o recorte sem espalhar `if` — **o mesmo util
serve painel e admin** (RN-M2 admin: espelhar). Camada: Server. Nota Módulo A: gate
controla o **layout formatado** (bloco `@media print` da variante A4 só servido com
o módulo); a tela crua sempre é imprimível via `Ctrl+P` — limite do navegador, não
bypass de dado (ver box em "Gating por módulo").

**RN-M3 — Lojista não auto-habilita módulo.** A flag de módulo é
billing-controlled: setada por admin/`service_role`/webhook de cobrança, **nunca**
por Server Action do lojista. Entra em `CAMPOS_LOJA_SOMENTE_SERVIDOR` + checagens
do trigger `lojas_protege_billing()` e fica fora dos patches explícitos das actions
do lojista (`salvarPerfil`/`salvarHorarios`/`salvarTema`). Camada:
**RLS/allowlist + trigger no banco + Server**.

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai?** Impressos contêm PII do cliente (nome,
  telefone, endereço) e resumo financeiro (variantes 1 e 3). Aceitável: quem
  imprime é o lojista dono do pedido (ou admin operando a loja), em painel
  autenticado, sobre dados que **já vê na tela**. A impressão só reformata o DOM já
  autorizado — nada novo trafega, nada vai à rede. A variante 2 reduz exposição por
  design (sem financeiro).
- **Valor monetário?** Sim (variantes 1/3), **sem recálculo no cliente**. Valores =
  snapshot autoritativo gravado no checkout (`seguranca.md` §10; `architecture.md`
  §6), renderizado sob RLS. O seletor só dispara `window.print()`; não toca em
  preço. Sem caminho para alterar valor via impressão.
- **Permissão/entitlement (novo vetor).** Qual variante o lojista pode imprimir é
  **decisão de permissão** → server-autoritativa (RN-M1) e fail-closed. A flag de
  módulo é **billing-controlled**: não editável pelo lojista
  (`CAMPOS_LOJA_SOMENTE_SERVIDOR` + `lojas_protege_billing_trg`; fora dos patches
  explícitos das actions do lojista). Um lojista não pode "ligar" o módulo pago via
  request forjada — o trigger no banco é o backstop mesmo se o filtro de código
  falhar.
- **`token_acesso` não vaza:** não é renderizado hoje (confirmado em
  `DetalhePedido.tsx`) e **não** entra em nenhuma variante. Só o nº curto
  (não-sensível) aparece.
- **Tabela/coluna nova?** Sim, para o gating (DA-M1 → Opção A): duas colunas
  booleanas em `lojas`, cobertas pela RLS de `lojas` já existente, mas que
  **exigem** (i) extensão do trigger de billing e (ii) inclusão em
  `CAMPOS_LOJA_SOMENTE_SERVIDOR`. **Nenhuma política RLS nova** na Opção A.
- **API externa com key?** Não. Zero rede, zero chave, zero custo na impressão.
- **XSS:** sem `dangerouslySetInnerHTML`, sem URL montada, sem input do usuário.
  `data-print-variant` vem de union fixo (`"a4"|"cozinha"|"recibo"`), nunca de dado
  do usuário. Sem superfície de injeção.

---

## Fora do Escopo (v1)

- **Emissão fiscal real** (NFC-e / SAT / ECF, SEFAZ, certificado digital, cálculo
  de tributo) — **explicitamente fora** (`modelo-negocio.md`; RN-P6). Variante 3 é
  recibo não-fiscal.
- **Fluxo de compra/upsell do módulo de impressão** (checkout do add-on, página de
  oferta, cobrança) — esta spec cobre só **ler** o entitlement e **gatear** a UI. A
  venda/cobrança do módulo reusa o billing existente (`planos`,
  `pagamentos_assinatura`, `webhook_eventos_billing`) e é spec/issue separada.
- **Preço dos módulos e CTA de upgrade** — o recorte módulo→variantes está
  definido (RN-M2: A4 e térmica, ambos pagos); preço e a peça de upsell para loja
  sem módulo ficam para a spec de venda do add-on. **v1: loja sem módulo não
  mostra seletor (silencioso), sem CTA meio-construído.**
- **Tabela `loja_modulos` / Opção B do DA-M1** — v1 usa duas colunas em `lojas`
  (Opção A). A migração A→B é limpa e fica para quando/se houver marketplace de
  add-ons.
- **Geração de PDF server-side** (`@react-pdf/renderer`, puppeteer) — o "Salvar
  como PDF" do diálogo cobre a necessidade sem dependência nova.
- **Template térmico 80mm pixel-perfect estilo ESC/POS** (largura fixa, monoespaçada,
  corte automático) — variantes 2/3 entregam cupom compacto e fluido; calibração
  fina fica para quando houver térmica real para testar.
- **Impressão automática ao chegar/confirmar pedido** — depende de Realtime ao
  painel, fase 2 (`architecture.md` §10; `modelo-negocio.md`). Proibido
  `window.print()` automático nesta fase (RN-P5).
- **Impressão em lote** a partir da listagem (`TabelaPedidos`) — v1 imprime um
  pedido por vez a partir do detalhe.
- **Personalização do impresso pelo lojista** (logo, campos on/off, variante-padrão)
  e **lembrar a última variante** — layouts fixos, sem persistência na v1.
- **Override "admin vê todas as variantes"** — v1 espelha o entitlement da loja
  (RN-M2 admin). Um poder de impressão extra para suporte é decisão futura do dono.
