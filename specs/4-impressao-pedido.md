# Spec: Imprimir pedido a partir do painel do lojista (3 variantes + gating por módulo)

**Versão:** 0.4.0 | **Atualizado:** 2026-07-04

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

**Papel:** A4 é o padrão do navegador para a variante 1; para as 2 e 3 o lojista
escolhe **térmica 80mm** no diálogo. O CSS das variantes térmicas usa coluna
única, largura fluida (`width:auto`, sem `max-width` em px de tela) e fonte
compacta — cabe em 80mm **sem hardcodar largura** e ainda sai legível em A4.

---

### Gating por módulo (controle comercial server-autoritativo)

**O que existe hoje no codebase (levantamento):**
- `lojas.assinatura_status` (`trial | ativa | inadimplente | cancelada | suspensa |
  cortesia`) — **gate global** de acesso ao painel (`acessoPainel.ts` +
  `assinaturaPermiteAcesso` + guard `painel/layout.tsx`). É binário: libera ou
  bloqueia o painel inteiro.
- `lojas.plano_id` → `planos(id)`; tabela `planos` (catálogo, **preço
  autoritativo**, `ativo`, `provider_price_id`) — migrations [070]/[073].
  **`plano_id` NÃO influencia acesso hoje** — serve só para cobrança; `planos` não
  tem coluna de capabilities/features.
- `pagamentos_assinatura` (histórico de faturas), `webhook_eventos_hotmart` /
  `webhook_eventos_billing` (log imutável, `service_role`).
- Escrita de billing centralizada: só `service_role`/webhook, protegida pelo
  trigger `lojas_protege_billing_trg` e espelhada em `CAMPOS_LOJA_SOMENTE_SERVIDOR`
  (`lib/actions/admin-loja.ts`). Nenhuma Server Action do painel altera billing.

**O que NÃO existe hoje:** **nenhum primitivo de entitlement por-feature / add-on.**
Não há tabela de módulos, coluna de capabilities em `planos`, nem feature-flag. O
gating atual é global (painel on/off) + um único `plano_id` que nem afeta acesso.
`modelo-negocio.md` também não descreve add-ons/módulos pagos (mensalidade fixa
única). Liberar variantes de impressão por loja **exige um primitivo novo**.

> **Recorte comercial DEFINIDO (confirmado pelo dono do SaaS):** **dois módulos
> pagos independentes** —
> - **Módulo A — "Impressão PDF/A4"**: variante 1 (comum A4 + Salvar como PDF).
> - **Módulo B — "Impressão Térmica"**: variantes 2 e 3 (via cozinha + recibo).
>
> A loja pode contratar um, outro, ambos ou nenhum. Sem nenhum módulo → sem
> seletor "Imprimir" (com CTA de upgrade a definir). O mapa módulo→variantes
> vive num único ponto (`variantesHabilitadas`, RN-M2).
>
> ⚠️ **Limite físico do Módulo A (deixar claro na venda):** a variante A4 é o
> próprio `DetalhePedido` visível na tela — impossível "não renderizar". Um
> lojista sem o Módulo A ainda consegue `Ctrl/Cmd+P` e imprimir a **tela crua**
> (com chrome, sem formatação). O que o Módulo A vende é o **layout formatado de
> comprovante** (CSS print limpo): sem o módulo, o bloco `@media print` da
> variante A4 **não é servido** e o impresso sai como página comum de navegador.
> Não é bypass de dado (o lojista já vê tudo na tela) — é limite inerente ao
> navegador, documentado para não prometer bloqueio impossível (RN-M1).

**Proposta mínima de primitivo (a validar) — DA-M1:** representar entitlement por
**flag booleana por módulo**, controlada só pelo billing/admin:

- **Opção A (mínima, recomendada p/ v1):** duas colunas em `lojas`:
  `modulo_impressao_a4 boolean not null default false` e
  `modulo_impressao_termica boolean not null default false`. Lidas na
  `LojaCompleta` já carregada no painel.
- **Opção B (escalável, fase futura):** tabela `loja_modulos (loja_id, modulo,
  ativo)` ou `planos.recursos jsonb` — evita ALTER em `lojas` a cada novo módulo.

Independente da opção, valem as **invariantes de segurança**:
1. O gate é **server-autoritativo**: o Server Component decide renderizar (ou não)
   cada variante a partir do banco. **Não** basta esconder via CSS — bloco não
   habilitado **não é renderizado no DOM** (RN-M1).
2. A flag é **billing-controlled**: setada por admin/`service_role`/webhook,
   **nunca** editável pelo lojista. Entra em `CAMPOS_LOJA_SOMENTE_SERVIDOR` /
   proteção `lojas_protege_billing_trg` (issue 074) e fica fora do allowlist de
   `atualizarLoja` (débito `tasks/115`). Ver Segurança.

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
impressão da loja** (a `LojaCompleta` já é lida via `buscarLojaDoDono` no guard;
expor a(s) flag(s) de módulo por essa via — não escrever `.from('lojas')` inline,
`architecture.md` §8) e repassá-lo a `DetalhePedido`; (ii) exibir o **seletor
"Imprimir"** com **apenas** as variantes habilitadas.

**Componentes:**
- `DetalhePedido` (`components/painel/DetalhePedido.tsx`) — **reuso, sem
  duplicar**. Continua Server Component puro. Ganha: prop nova
  `modulosImpressao` (quais variantes estão habilitadas); o seletor no bloco do
  título; `className` marcando o detalhe atual como conteúdo da variante A4 e o
  chrome como `no-print`; e a renderização **condicional** dos blocos das
  variantes habilitadas.
- `SeletorImprimirPedido` (`components/painel/SeletorImprimirPedido.tsx`) —
  **componente novo, Client Component** (`'use client'` — handler DOM). Recebe
  como prop a lista de variantes habilitadas (decidida no servidor). É um
  `DropdownMenu` (shadcn/ui) com trigger `Button variant="outline" size="sm"` +
  ícone `Printer` (lucide-react) e um item por variante habilitada. Ao selecionar,
  aplica a variante e dispara `window.print()` (RN-P3). Marcado `no-print`. Sem
  I/O, sem estado persistente. Se só uma variante estiver habilitada, degrada para
  botão simples.
- `ComandaCozinha` (`components/painel/ComandaCozinha.tsx`) — **novo Server
  Component puro**. Bloco de preparo **sem preços** (variante 2). Reusa
  `ListaOpcionaisItem` (com opção de ocultar preço). Print-only; **só renderizado
  se a loja tem a variante habilitada**.
- `ReciboCliente` (`components/painel/ReciboCliente.tsx`) — **novo Server
  Component puro**. Cupom do cliente **com preços + aviso não-fiscal** (variante
  3). Reusa `formatarMoeda` e `ListaOpcionaisItem`. Print-only; **só renderizado
  se habilitado**.
- `Button` / `DropdownMenu` / `Card` / `Badge` / `Separator` / `ListaOpcionaisItem`
  — shadcn/ui / existentes, sem mudança de contrato.
- `AcoesStatus` (card "Ações") — não muda; ocultado em todas as variantes (RN-P2).
- `NavPainel` (`SidebarPainel`/`TopbarPainel`) — chrome; ocultado (RN-P2).
- `variantesHabilitadas(loja)` — **util puro novo** (`lib/utils/`), fonte única do
  mapa módulo→variantes (RN-M2). Recebe a loja/flags e devolve a lista de variantes
  liberadas. Testável sem I/O.
- `globals.css` — bloco `@media print` (fonte única, sub-regras por variante).

**Behaviors:**
- [ ] Ver o seletor "Imprimir" no cabeçalho do detalhe **somente se a loja tem
  ao menos um módulo**; sem módulo, sem seletor (CTA de upgrade a definir).
  Garantido em: **Server (SSR) + entitlement**.
- [ ] Abrir o seletor e ver **apenas** as variantes habilitadas para a loja.
  Garantido em: **Server (SSR) + entitlement** — a lista de opções é decidida no
  servidor a partir da flag de módulo; variante não habilitada nem chega ao
  cliente (RN-M1).
- [ ] Escolher **"Comum (A4)"** → imprime o detalhe completo. Garantido em:
  cliente (variante A4 + `window.print()`); valores em **Server (SSR) + RLS**;
  disponibilidade em **Server (entitlement)**.
- [ ] Escolher **"Via da cozinha"** → imprime resumo de preparo **sem
  preços/totais/pagamento**. Garantido em: cliente (`window.print()`); conteúdo em
  **Server (SSR) + RLS**; disponibilidade em **Server (entitlement)**.
- [ ] Escolher **"Recibo do cliente"** → imprime cupom não-fiscal (itens + preços
  + total + básicos + aviso). Garantido em: cliente (`window.print()`); valores em
  **Server (SSR) + RLS**; disponibilidade em **Server (entitlement)**.
- [ ] **Não** ver (nem conseguir imprimir) uma variante que a loja não tem no
  plano. Garantido em: **Server (entitlement) + RLS/allowlist** — bloco não
  renderizado no DOM; o lojista não pode auto-habilitar o módulo (RN-M1/RN-M3).
- [ ] Em qualquer variante, ver **apenas o conteúdo daquela variante** — sem
  chrome, sem "Voltar", sem "Ações", sem seletor, sem os blocos das outras.
  Garantido em: cliente (CSS `@media print` por variante).
- [ ] Escolher impressora e papel (A4 ou térmica 80mm) e/ou "Salvar como PDF".
  Garantido em: cliente (diálogo nativo do navegador).

---

### Detalhe do pedido (espelho admin) — `/admin/assinantes/[lojaId]/pedidos/[id]`

**Mundo:** painel admin do SaaS (auth admin — `verificarAdminSaaS()`; leitura via
loader `service_role` escopado por `loja_id`).

**Descrição:** herda o seletor e as variantes por compartilhar `DetalhePedido`. O
caller admin resolve o entitlement da loja-alvo e o repassa igual ao painel.
Decisão de produto a validar (RN-M2): o admin, operando em nome da loja, pode ver
**todas** as variantes independentemente do módulo, ou espelhar exatamente o que a
loja tem. Default recomendado: **espelhar** (o admin vê o que o lojista veria);
liberar tudo no admin é um override explícito a decidir.

**Behaviors:**
- [ ] Admin imprime as variantes habilitadas de um pedido de loja assinante.
  Garantido em: cliente (UX) + loader `service_role` escopado + entitlement
  server-side (autoridade do dado e do módulo no servidor).

---

## Modelos de Dados

**A parte de impressão em si é 100% apresentação** (sem migration): as tabelas
`pedidos` + `itens_pedido` + `itens_pedido_opcionais` (ver `schema.md`) continuam
lidas pela via atual (`buscarPedidoDoDono` sob RLS no painel; loader
`service_role` escopado no admin). Nenhum campo de pedido novo; `token_acesso`
**não** entra em nenhuma variante.

**A parte de gating por módulo EXIGE primitivo novo (pré-requisito, DA-M1 — a
validar):**
- **Opção A (recomendada v1):** migration adicionando as duas colunas booleanas
  em `lojas` (`modulo_impressao_a4`, `modulo_impressao_termica`, ambas
  `not null default false`). Como são **colunas de permissão/billing**, precisam:
  - entrar em `CAMPOS_LOJA_SOMENTE_SERVIDOR` e ser coberta pelo trigger
    `lojas_protege_billing_trg` (issue 074) — UPDATE só por `service_role`/admin;
  - ficar **fora** do allowlist de `atualizarLoja` (lojista não edita — débito
    `tasks/115`);
  - default `false` (fail-closed: loja nasce sem o módulo pago).
- **Opção B (escalável):** tabela nova `loja_modulos (loja_id, modulo text, ativo
  boolean)` → **exige política RLS própria antes de produção** (`seguranca.md` §2):
  SELECT escopado por `loja_id = lojas.dono_id` (leitura do próprio módulo);
  INSERT/UPDATE/DELETE **negados** ao lojista (só `service_role`/admin).

Seja qual for a opção, **nenhuma tabela/coluna de módulo é editável pelo
lojista**. A escolha A×B é decisão de arquitetura a validar no `/break`.

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
| Opcionais por item | ✅ (com preço) | ✅ (**sem preço**) | ✅ (com preço) |
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
  observações em destaque ("sem cebola", "bem passado").
- **Variante 3 (recibo):** financeiro completo, **não-fiscal** (RN-P6).

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
seletor (CTA de upgrade a definir). O código lê o mapa de um único ponto
(`variantesHabilitadas`) para trocar o recorte sem espalhar `if`. Camada: Server.
Nota Módulo A: gate controla o **layout formatado** (bloco `@media print` da
variante A4 só servido com o módulo); a tela crua sempre é imprimível via
`Ctrl+P` — limite do navegador, não bypass de dado (ver box em "Gating por
módulo").

**RN-M3 — Lojista não auto-habilita módulo.** A flag de módulo é
billing-controlled: setada por admin/`service_role`/webhook de cobrança, **nunca**
por Server Action do lojista. Entra em `CAMPOS_LOJA_SOMENTE_SERVIDOR` / proteção
`lojas_protege_billing_trg` e fica fora do allowlist de `atualizarLoja`. Camada:
**RLS/allowlist + Server**.

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
  (`CAMPOS_LOJA_SOMENTE_SERVIDOR` + `lojas_protege_billing_trg`, issue 074; fora do
  allowlist de `atualizarLoja` — débito `tasks/115`). Um lojista não pode "ligar" o
  módulo pago via request forjada.
- **`token_acesso` não vaza:** não é renderizado hoje e **não** entra em nenhuma
  variante. Só o nº curto (não-sensível) aparece.
- **Tabela/coluna nova?** Sim, para o gating (DA-M1). Se **Opção A** (colunas em
  `lojas`): cobertas pela RLS de `lojas`, mas **exigem** proteção de billing +
  exclusão do allowlist de update do lojista. Se **Opção B** (tabela
  `loja_modulos`): **exige política RLS própria antes de produção** (`seguranca.md`
  §2) — SELECT escopado ao dono; escrita só `service_role`/admin.
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
  sem módulo ficam para a spec de venda do add-on.
- **Geração de PDF server-side** (`@react-pdf/renderer`, puppeteer) — o "Salvar
  como PDF" do diálogo cobre a necessidade sem dependência nova.
- **Template térmico 80mm pixel-perfect estilo ESC/POS** (largura fixa, monoespaçada,
  corte automático) — variantes 2/3 entregam cupom compacto e fluido; calibração
  fina fica para quando houver térmica real para testar.
- **Impressão automática ao chegar/confirmar pedido** — depende de Realtime ao
  painel, fase 2 (`architecture.md` §10; `modelo-negocio.md` §8). Proibido
  `window.print()` automático nesta fase (RN-P5).
- **Impressão em lote** a partir da listagem (`TabelaPedidos`) — v1 imprime um
  pedido por vez a partir do detalhe.
- **Personalização do impresso pelo lojista** (logo, campos on/off, variante-padrão)
  e **lembrar a última variante** — layouts fixos, sem persistência na v1.
