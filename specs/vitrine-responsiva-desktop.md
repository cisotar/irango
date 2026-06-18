# Spec: Vitrine Pública Responsiva (Desktop Landscape)

**Versão:** 0.1.0 | **Atualizado:** 2026-06-18

## Visão Geral

Refatorar o layout da vitrine pública (cliente final) e do checkout para um design **verdadeiramente responsivo**, aproveitando o espaço horizontal do desktop (paisagem) sem alterar o design mobile (retrato), que já está correto.

Hoje toda a experiência do cliente está travada em coluna única `max-w-[480px] mx-auto` (checkout) / `max-w-3xl` (vitrine). No desktop isso desperdiça a tela: conteúdo numa fração centralizada com enormes margens vazias. O objetivo é **reorganizar o mesmo visual canônico** (cores, fontes, espaçamentos e componentes definidos em `design-claude/vitrine/*.html`) em mais colunas e larguras maiores quando há espaço horizontal.

**Mundo:** vitrine pública (`/loja/[slug]`, `/loja/[slug]/pedido`, `/loja/[slug]/confirmacao`) — sem login, cliente final comprando rápido. Desktop **e** mobile.

### Invariantes de design (NÃO negociáveis)

- **Paleta e tipografia INALTERADAS** — tokens em `src/app/globals.css` `@theme` (`--cor-primaria`, `--cor-fundo`, `--cor-destaque`, `--texto`, `--texto-muted`, `--marrom-cafe`, etc.). Esta feature **não muda cor nem fonte**. Só layout/reflow.
- **Mobile (retrato, < `md`) permanece como está** — coluna única, largura ≤ 480px (checkout) / ≤ 3xl (vitrine), grid de 2 colunas no catálogo. É o design correto pra celular.
- **Desktop (paisagem, ≥ `md`) ocupa mais largura útil** — mais colunas no catálogo, checkout em 2 colunas (conteúdo + resumo sticky), sem alterar componentes individuais (cards, stepper, header band).
- **Os canônicos `design-claude/vitrine/*.html` são estendidos, não descartados.** Eles definem o visual mobile; este spec define como esse mesmo visual reflui horizontalmente.

### Direção já decidida (memória de projeto)

`checkout-arquitetura-responsiva`: **drawer (desktop) + wizard (mobile) com UM estado compartilhado.** O `CheckoutWizard.tsx` atual já é fonte única de estado — a camada responsiva desktop reusa esse estado, não duplica.

---

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (SaaS)** | entrega o layout responsivo; nenhuma regra de negócio nova |
| **Lojista** | não participa diretamente — sua vitrine passa a renderizar bem no desktop |
| **Cliente** | navega catálogo, monta carrinho e finaliza pedido — em mobile (retrato) ou desktop (paisagem) |

Esta é uma feature **puramente de apresentação/reflow**. Nenhum valor monetário, cupom, frete ou pedido muda de comportamento. Toda autoridade de valor permanece como está (recálculo no servidor — `seguranca.md` §10).

---

## Breakpoints (canônicos Tailwind v4)

Tokens padrão do Tailwind, sem `tailwind.config.ts` (CSS-first). Referência única para todos os componentes abaixo:

| Token | Largura mín. | Orientação alvo | Papel |
|-------|-------------|-----------------|-------|
| (base) | 0 | retrato (celular) | layout mobile atual — intocado |
| `sm` | 640px | celular grande / retrato largo | ainda coluna única |
| `md` | 768px | tablet paisagem / desktop pequeno | **fronteira mobile→desktop**: catálogo passa a 3 colunas; checkout passa a 2 colunas |
| `lg` | 1024px | desktop | catálogo 3 colunas; conteúdo mais largo |
| `xl` | 1280px | desktop largo | catálogo 4 colunas |
| `2xl` | 1536px | monitor grande | catálogo 4 colunas, largura máxima travada (legibilidade) |

**Regra de ouro de reflow:** abaixo de `md` nada muda. A camada desktop é aditiva via prefixos `md:`/`lg:`/`xl:`. Catálogo nunca passa de 4 colunas (cards ficariam minúsculos e a leitura de preço/CTA sofre).

---

## Páginas e Rotas

### 1. Vitrine da loja — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)
**Descrição:** cliente vê header da loja, catálogo por seções (grid de produtos), abre modal de produto, adiciona ao carrinho (Sheet lateral) e segue pro checkout. Hoje tudo em `max-w-3xl` centralizado.

**Componentes (reuso — `components/vitrine/`):**
- `HeaderLoja.tsx` — logo, nome, status aberto/fechado (`BadgeStatus.tsx`). Reflui pra largura desktop sem mudar tipografia.
- `SecaoCatalogo.tsx` — título de seção + grid. **Hoje:** `grid-cols-2 lg:grid-cols-3`. Esta é a peça central do reflow.
- `CardProduto.tsx` — card individual. **Inalterado** internamente (aspect-ratio 4/3, preço, botão +). Só muda quantos cabem por linha.
- `ProdutoModal.tsx` — modal de produto (Dialog shadcn). **Hoje:** `max-w-[480px]` no mobile; **`md:max-w-3xl` no desktop** (já implementado, issue 003) com imagem maior à esquerda + detalhes/opcionais à direita.
- `Carrinho.tsx` — Sheet lateral (já `sm:max-w-md`). **Mantém Sheet em todos os tamanhos** (padrão consistente; não vira coluna fixa na vitrine — só no checkout).
- `VitrineClient.tsx` — dono do estado do carrinho + FAB/barra fixa. A barra fixa inferior (`max-w-3xl`) acompanha a nova largura do container.

**Layout por breakpoint:**

| Breakpoint | Container | Grid catálogo | Header | Barra carrinho fixa |
|-----------|-----------|---------------|--------|---------------------|
| base–`sm` | `max-w-3xl mx-auto px-4` (atual) | `grid-cols-2` | full | fixa inferior, `max-w-3xl` |
| `md` | `md:max-w-5xl` | `md:grid-cols-3` | full | fixa inferior, acompanha container |
| `lg` | `lg:max-w-6xl` | `lg:grid-cols-3` | full | idem |
| `xl`+ | `xl:max-w-7xl` | `xl:grid-cols-4` | full | idem |

**Behaviors:**
- [ ] Ver catálogo em N colunas conforme largura — 2 (mobile) → 3 (`md`/`lg`) → 4 (`xl`). Garantido em: cliente (UX/layout puro; sem valor).
- [ ] Rolar seções do catálogo com `scroll-mt` preservado nas âncoras de seção. Garantido em: cliente (UX).
- [ ] Abrir modal de produto — modal estreito no mobile, mais largo (`md:max-w-3xl`) no desktop. Garantido em: cliente (UX).
- [ ] Adicionar produto ao carrinho — abre Sheet lateral (comportamento atual, todos os tamanhos). Subtotal exibido é **preview de UX**. Garantido em: cliente (preview); valor autoritativo só no checkout/Server Action.
- [ ] Ver barra/FAB de carrinho fixa acompanhando a largura do container em cada breakpoint. Garantido em: cliente (UX).
- [ ] Seguir para o checkout via barra do carrinho. Garantido em: cliente (navegação).

---

### 2. Checkout — `/loja/[slug]/pedido`

**Mundo:** vitrine pública (sem auth)
**Descrição:** hoje wizard sequencial de 3 etapas em coluna `max-w-[480px]` (Itens → Entrega → Pagamento) com `IndicadorEtapas`. No desktop a coluna de 480px desperdiça a tela. **Repensar:** desktop usa **2 colunas — conteúdo das etapas à esquerda + resumo do pedido sticky à direita** (`ResumoValores`), eliminando a navegação sequencial obrigatória quando há espaço (resumo sempre visível). Mobile **mantém o wizard** intacto.

**Componentes (reuso — `components/vitrine/checkout/`):**
- `CheckoutWizard.tsx` — **fonte única de estado** (etapa atual, endereço, forma de pagamento, cupom). É aqui que entra a bifurcação de layout responsivo. NÃO duplicar estado.
- `IndicadorEtapas.tsx` — stepper. **Mobile:** visível (navegação sequencial). **Desktop:** vira navegação de seções/âncoras dentro da coluna esquerda (ou stepper compacto no topo da coluna), já que todas as etapas ficam acessíveis.
- `EtapaItens.tsx` / `EtapaEntrega.tsx` / `EtapaPagamento.tsx` — **conteúdo inalterado**. No desktop empilham na coluna esquerda (uma abaixo da outra) em vez de troca sequencial; no mobile seguem como etapas do wizard.
- `ResumoValores.tsx` — subtotal, desconto, frete, total. **Mobile:** dentro da etapa de pagamento. **Desktop:** coluna direita **sticky** (`lg:sticky lg:top-4`), sempre visível.
- `FormEndereco.tsx` — autocomplete ViaCEP (chamado do client, sem credencial — `seguranca.md` §9). Inalterado.
- `ResumoValores` consome `calcularFreteAction` / `validarCupom` via `CheckoutWizard` — **preview de UX**; valor real só na finalização.

**Layout por breakpoint:**

| Breakpoint | Estrutura | Etapas | Resumo | Stepper |
|-----------|-----------|--------|--------|---------|
| base–`sm` | coluna única `max-w-[480px] mx-auto` (atual) | wizard sequencial (1→2→3) | dentro da etapa pagamento | visível, navegação por etapa |
| `md`+ | 2 colunas `md:grid md:grid-cols-[1fr_360px] lg:grid-cols-[1fr_400px]` em `max-w-5xl/6xl mx-auto` | empilhadas na coluna esquerda, todas visíveis | coluna direita **sticky** | compacto no topo da coluna esquerda / âncoras |

**Behaviors:**
- [ ] Mobile: avançar/voltar entre etapas Itens → Entrega → Pagamento (wizard atual). Garantido em: cliente (UX de navegação).
- [ ] Desktop (`md`+): ver as 3 seções empilhadas na coluna esquerda, sem precisar avançar etapa. Garantido em: cliente (UX).
- [ ] Desktop: ver `ResumoValores` sticky à direita sempre visível ao rolar. Garantido em: cliente (UX).
- [ ] Editar quantidade de item no carrinho/etapa Itens — recalcula subtotal exibido. Garantido em: **cliente (preview de UX)**; valor autoritativo em: **Server Action `criarPedido` + RPC `criar_pedido` + RLS** (`seguranca.md` §10).
- [ ] Preencher endereço (ViaCEP autocomplete) — frete exibido atualiza. Garantido em: **cliente (preview via `calcularFreteAction`)**; valor autoritativo em: **Server Action `criarPedido`** (recalcula frete + reconcilia bairro↔CEP server-side, `seguranca.md` §10-A).
- [ ] Aplicar cupom — desconto exibido atualiza. Garantido em: **cliente (preview)**; valor autoritativo em: **Server Action `validarCupom` (service_role, escopo por loja_id) + RPC `criar_pedido`** (`seguranca.md` §9). Cliente nunca recebe lista de cupons.
- [ ] Selecionar forma de pagamento (exibidas conforme config da loja). Garantido em: cliente (seleção); validação em: Server Action.
- [ ] Finalizar pedido. Garantido em: **Server Action `criarPedido` + RPC `criar_pedido` + RLS** — recalcula subtotal/frete/desconto/total do zero do banco; payload zod `.strict()` rejeita campos monetários do client. O reflow desktop **não altera** este caminho.

---

### 3. Confirmação — `/loja/[slug]/confirmacao`

**Mundo:** vitrine pública (sem auth — leitura escopada por `id + token_acesso`, `seguranca.md` §pedidos)
**Descrição:** cliente vê resumo do pedido confirmado (itens, total, forma de pagamento, dados da loja). Hoje coluna única estreita. No desktop pode centralizar num card mais largo ou layout 2 colunas (detalhes do pedido + instruções de pagamento/loja), sem mudar o visual canônico (`design-claude/vitrine/confirmacao.html`).

**Componentes:**
- `ConfirmacaoClient.tsx` — renderiza o pedido lido server-side por token. Reflui pra largura confortável de leitura no desktop.

**Layout por breakpoint:**

| Breakpoint | Estrutura |
|-----------|-----------|
| base–`sm` | coluna única estreita (atual) |
| `md`+ | card centralizado `md:max-w-2xl` ou 2 colunas (resumo do pedido + bloco pagamento/instruções da loja) |

**Behaviors:**
- [ ] Ver confirmação do pedido lida por `id + token_acesso`. Garantido em: **Server Component + service_role escopado por token** (`seguranca.md` §pedidos) — o reflow não toca a leitura.
- [ ] Ver instruções de pagamento (chave Pix da loja, troco, link) no layout desktop mais amplo. Garantido em: servidor (dado vem da leitura por token); apresentação em: cliente (layout).
- [ ] Voltar à loja / fazer novo pedido. Garantido em: cliente (navegação).

---

## Modelos de Dados

**Nenhuma mudança de schema.** Esta feature é 100% de apresentação (CSS/reflow + estrutura de container). Não há migration, não há tabela nova, não há campo novo.

Tabelas lidas (já existentes, RLS já definida em `seguranca.md`): `vitrine_lojas` (view), `produtos`, `categorias`, `formas_pagamento`, `zonas_entrega`/`taxas_entrega`/`bairros_zona`, `pedidos` (via token), `itens_pedido`, `opcionais*`. **Nenhuma policy nova é necessária.**

---

## Regras de Negócio

Esta feature **não introduz regra de negócio nova**. Todas as regras de valor já existentes permanecem com a mesma garantia de camada — o reflow visual não pode tocá-las:

| Regra | Camada que garante (inalterada) |
|-------|--------------------------------|
| Subtotal/frete/desconto/total exibidos no carrinho e resumo são **estimativa** | cliente (preview de UX) |
| Valor autoritativo do pedido | **Server Action `criarPedido` + RPC `criar_pedido`** — recalcula do banco (`seguranca.md` §10) |
| Cupom válido + desconto | **Server Action `validarCupom`** (service_role, escopo loja_id) — nunca SELECT aberto (`seguranca.md` §9) |
| Frete e reconciliação bairro↔CEP | **Server Action** (ViaCEP server-side, fail-closed §10-A) |
| Leitura da confirmação pelo cliente | **service_role escopado por `id + token_acesso`** (`seguranca.md` §pedidos) |
| Catálogo só de loja ativa / produto disponível | **RLS** (`produtos_leitura_publica` + `loja_esta_ativa`) |

**Regra de implementação (DRY / não reinventar a roda):** o reflow reusa os componentes e utils existentes — `calcularFrete`, `calcularDesconto`, `validarCupom`, `lojaAberta`, `formatarMoeda`, Sheet/Dialog do shadcn/ui. **Não criar** componentes paralelos "desktop" que dupliquem `CardProduto`, `ResumoValores`, `EtapaItens/Entrega/Pagamento` ou o estado do `CheckoutWizard`. Um único componente responde aos dois mundos via prefixos `md:`/`lg:`/`xl:`.

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai?** Nenhum novo. PII de cliente (nome, telefone, endereço), chave Pix e cupom continuam tratados exatamente como hoje. O reflow não expõe campo novo nem muda query.
- **Algum valor monetário?** Sim, **exibido** (subtotal, frete, desconto, total) — mas como **preview de UX**. O recálculo autoritativo no servidor (`criarPedido` + RPC) **não é tocado** por esta feature. Risco: um dev, ao mover o `ResumoValores` pra coluna sticky desktop, pode ser tentado a "passar o total já calculado" como prop fixa — proibido confiar nesse valor no submit. O submit segue enviando só `produto_id`/`quantidade`/`loja_id`/`endereco`/`codigo_cupom` (payload `.strict()`), nunca valores monetários (`seguranca.md` §10).
- **Tabela nova?** Não → nenhuma RLS nova.
- **API externa com key?** ViaCEP continua sem credencial (chamável do client para autocomplete; reconciliação de frete permanece server-side, §10-A). Nenhuma key nova.
- **`dangerouslySetInnerHTML`?** Não usar. Nomes de produto/loja renderizados como texto (React escapa — `seguranca.md` §15). `foto_url`/`logo_url` já validados `https://` — manter ao reusar no layout largo.

**Conclusão de segurança:** feature de baixo risco (apresentação). O único ponto de vigilância é não permitir que a reorganização do `ResumoValores` desktop vire um atalho que confie no total calculado no client.

---

## Fora do Escopo (v1)

- **Mudar paleta, tipografia ou tokens** — proibido por invariante. Só reflow.
- **Redesenhar componentes individuais** (card, stepper, header band) — só reorganizar quantos/onde aparecem.
- **Layout do painel do lojista (`/painel/*`)** — outra área, outro mundo; esta feature é só vitrine pública.
- **Novo design de carrinho como coluna fixa na vitrine** — vitrine mantém Sheet lateral; coluna fixa/sticky só aparece no checkout (resumo).
- **PWA / app instalável** — Fase 2 (`modelo-negocio.md` §8).
- **Subdomínio / domínio próprio por loja** — Fase 2/3.
- **Qualquer mudança em cálculo de frete, cupom, pedido ou auth** — esta feature não toca lógica de negócio nem segurança de valor.
- **Imagens responsivas / `next/image` srcset otimizado por breakpoint** — pode virar follow-up; não é pré-requisito do reflow.

---

## Notas de Implementação (para o /break)

- Bifurcação central do checkout vive em `CheckoutWizard.tsx`: abaixo de `md`, renderiza wizard sequencial (estado `etapa`); a partir de `md`, renderiza grid de 2 colunas com todas as etapas empilhadas + `ResumoValores` sticky — **mesmo estado, dois layouts**. Evitar `display:none` duplicado de árvores pesadas se possível (preferir uma árvore que reflui), mas se a navegação sequencial mobile exigir, manter UM estado compartilhado é a invariante inegociável.
- Reflow do catálogo é a mudança mais simples: ajustar `SecaoCatalogo.tsx` (`grid-cols-2 md:grid-cols-3 xl:grid-cols-4`) e o container em `VitrineClient.tsx`/`page.tsx` (`max-w-3xl` → `md:max-w-5xl lg:max-w-6xl xl:max-w-7xl`) + a barra fixa do carrinho acompanhar.
- Testar nos dois mundos com `verificar` (vitrine e checkout, mobile e desktop) antes de fechar.
