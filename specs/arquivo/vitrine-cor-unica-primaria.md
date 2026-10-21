# Spec: Vitrine com cor única (primária) e valores monetários sempre pretos

**Versão:** 0.2.0 | **Atualizado:** 2026-10-20

> **Decisão do dono do produto (fechada):** "Tudo que hoje usa a cor de destaque (`--cor-destaque`)
> passa a usar a cor primária (`--cor-primaria`), exceto o preço, que passa a ser sempre preto."
> A cor de fundo (`--cor-fundo`) não muda. As questões abertas da v0.1 foram fechadas em
> 2026-10-20 (ver §Decisões).
>
> **Classificação:** **não crítica** (sem TDD red-first). Não há valor monetário calculado, RLS,
> migration, auth nem Server Action. A mudança vai em duas issues independentes:
> - **Issue A — troca de token na vitrine (`/polir`).** É puramente visual. São cerca de 28 arquivos,
>   mas tudo é troca de classe de cor. Os testes que verificam classe de cor são atualizados no mesmo PR.
> - **Issue B — tela de tema do painel (`/fix`).** Traz o aviso de contraste (RN-7) e o campo
>   "Cor de destaque" oculto (RN-8). Tem lógica de UI, então não cabe no `/polir`. Reusa
>   `razaoContraste` de `src/lib/utils/contrasteWcag.ts:24`, sem criar cálculo novo.

## Visão Geral

Hoje a vitrine pública usa duas cores do tema da loja para elementos de marca. A **primária** pinta o
header, o chip de categoria ativo, a faixa do modal de produto, o header do checkout e o botão
"Finalizar" da gaveta. A **destaque** pinta preço, CTAs, barra do carrinho e o botão "+". Numa loja
como a Izza Lanches (primária vermelha, destaque laranja), o header fica vermelho e a barra do
carrinho fica laranja. O dono do produto quer uma cor de marca só e valores monetários neutros.

Depois da mudança:

- **Primária:** header, chips, barra do carrinho, botões "+" e "−", todos os CTAs, links de ação,
  indicador de etapas, bordas e realces de seleção, anéis de foco e ícones de marca.
- **Preto fixo (`--preto` #111111):** **todo valor monetário** exibido na vitrine, no checkout e na
  confirmação, exceto as cores semânticas da RN-3.
- **Fundo:** sem mudança.
- **Destaque:** deixa de ser lida pela vitrine e some da tela de tema. O dado continua em
  `lojas.tema`, sem migration (RN-8).

**Mundo:** vitrine pública (`/loja/[slug]`, checkout e confirmação) e tela de tema do painel
(`/painel/configuracoes/tema`, mais o espelho admin `/admin/assinantes/[lojaId]/configuracoes/tema`,
que reusa `TemaClient`/`PreviewVitrine`).

## Atores Envolvidos

- **Cliente:** vê a vitrine com uma cor de marca só e os valores em preto.
- **Lojista:** configura o tema com 2 cores (primária e fundo), é avisado se a primária deixar o texto
  branco ilegível e vê a pré-visualização seguindo a nova regra.
- **iRango (admin):** usa a mesma tela de tema pelo hub admin, sem mudança própria.

## Páginas e Rotas

### Vitrine da loja — `/loja/[slug]` (issue A)
**Mundo:** vitrine pública (sem auth)
**Descrição:** catálogo, busca, card de produto, modal do produto, barra e gaveta do carrinho.

**Componentes (todos existentes, só trocam classe):**
- `VitrineClient`: barra fixa do carrinho (`:88`, `bg-[var(--cor-destaque)]` com texto `#f5f0e6`)
  e o comentário de doc (`:83`)
- `CardProduto`: botão "+" (`:180`) e o comentário de doc (`:59`)
- `PrecoProduto`: preço efetivo (`:61`, `:73`, `text-destaque`), usado por card, lista e modal
- `ProdutoModal`: "Ver mais" (`:340`), "−"/"+" da quantidade (`:429`, `:448`), foco da observação
  (`:482`), botões Adicionar / Carrinho cheio / Indisponível (`:527`, `:543`, `:558`), "Continuar
  comprando" (`:569`)
- `SecaoOpcionais`: borda e trilho do grupo (`:74`), contador (`:92`), preço do opcional (`:151`),
  "−"/"+" (`:171`, `:189`)
- `TextoRealcado` (`:22`), `BuscaProdutos` (`:30` foco, `:173` botão)
- `NavCategorias` (`:76`) e `ItemProdutoLista` (`:142`): anel de foco
- `Carrinho` (gaveta): preço de cada linha (`~:103`, hoje `text-muted-foreground`) e subtotal
  (`~:163`, hoje herdado)
- `HeaderLoja`: **sem mudança** (já usa a primária e é a referência)

**Behaviors:**
- [x] Ver a barra do carrinho na cor primária, com o mesmo texto claro de hoje. Garantido em: cliente (UX).
- [x] Ver o botão "+" do card de produto na cor primária, com "+" branco. Garantido em: cliente (UX).
- [x] Ver o preço do produto (card, lista textual e modal) em preto, com e sem desconto. Garantido em: cliente (UX). É só exibição: o valor autoritativo continua recalculado em `criarPedido` (`seguranca.md` §10).
- [x] Ver o preço riscado e o selo de desconto com as cores de hoje, distinguíveis do efetivo preto. Garantido em: cliente (UX).
- [x] No modal do produto, ver "Ver mais", "−"/"+", Adicionar, Carrinho cheio, Indisponível e "Continuar comprando" na primária. Os estados `disabled` continuam em `#9a9a9a`. Garantido em: cliente (UX).
- [x] Abrir um grupo de opcionais e ver borda, trilho e contador na primária, com o preço do opcional em preto. Garantido em: cliente (UX).
- [x] Buscar um termo e ver o sublinhado do realce e o botão de limpar na primária. Garantido em: cliente (UX).
- [x] Navegar por teclado e ver os anéis de foco de chips, busca e itens da lista na primária. Garantido em: cliente (UX).
- [x] Abrir a gaveta do carrinho e ver o preço de cada linha e o subtotal em preto. "Você economizou" continua em `promo-texto`. Garantido em: cliente (UX).

---

### Checkout — drawer (desktop) e wizard (mobile) em `/loja/[slug]` (issue A)
**Mundo:** vitrine pública (sem auth)
**Descrição:** etapas Itens → Entrega → Pagamento e modais de revisão.

**Componentes (existentes, só trocam classe):**
- `IndicadorEtapas` (`:35`, `:37`, `:66`, `:76`, `:86`)
- `EtapaItens`: preço unitário (`~:251`, hoje `text-texto-muted`), subtotal do item (`:264`),
  hover de "−"/"+" (`:292`, `:309`), CTA (`:424`)
- `EtapaEntrega`: links (`:348`, `:476`), opções selecionadas (`:364`, `:380`), taxa de frete
  (`~:452`, hoje `text-texto-muted`), CTA (`:523`), voltar (`:533`)
- `EtapaPagamento`: opção selecionada (`:256`), CTA (`:367`), voltar (`:379`)
- `SeletorEnderecoCliente` (`:8`)
- `ResumoValores`: subtotal (`~:100`), linhas do detalhamento (`~:161`), entrega (`~:176`), anel
  de foco (`:146`), **total estimado** (`:190`)
- `CheckoutWizard`: CTA (`:656`)
- `ModalRevisaoPreco`: "→ para" de cada item (`~:85`), **novo total** (`:96`), CTA (`:104`)
- `ModalFreteIndisponivel`: CTA (`:139`)

**Behaviors:**
- [x] Ver o indicador de etapas (etapa atual, concluídas e trilho) na primária. Garantido em: cliente (UX).
- [x] Ver todos os CTAs de avançar ("Continuar", "Confirmar pedido" e os dos modais) na primária. Garantido em: cliente (UX).
- [x] Ver as opções selecionadas (modalidade, endereço, forma de pagamento) com borda e fundo `/5` na primária. Garantido em: cliente (UX).
- [x] Ver em preto: preço unitário, subtotal do item, taxa de frete, subtotal, linhas do detalhamento, entrega, total estimado, "→ para" e novo total do modal de revisão. Garantido em: cliente (UX). Tudo isso é **preview**: o total cobrado continua recalculado em `criarPedido` a partir do banco.
- [x] Ver o item indisponível (subtotal riscado), o "de" riscado do modal de revisão, a economia e o cupom com as cores de hoje. Garantido em: cliente (UX).

---

### Confirmação — `/loja/[slug]/confirmacao` (issue A)
**Mundo:** vitrine pública (sem auth, token do pedido)

**Componentes:** `confirmacao/page.tsx` (ícone `:180`; subtotal, desconto, frete e total `~:230-250`),
`confirmacao/LinkMapsLoja.tsx:42`, `confirmacao/ModalAvisoWhatsapp.tsx:230`.

**Behaviors:**
- [x] Ver o ícone de confirmação, o link do Maps e o spinner do aviso de WhatsApp na primária. Garantido em: cliente (UX).
- [x] Ver os valores do pedido (itens, subtotal, desconto, frete e total) em preto. Os rótulos continuam muted. Garantido em: cliente (UX). Os valores vêm do pedido gravado, sem recálculo nesta tela.

---

### Tema da loja — `/painel/configuracoes/tema` (e `/admin/assinantes/[lojaId]/configuracoes/tema`)
**Mundo:** painel (auth obrigatório) / hub admin (auth admin)

**Componentes:** `TemaClient` (existente, `:35-37`), `PreviewVitrine` (existente, `:47`, `:117`,
`:123`, `:137`). Reuso: `razaoContraste` (`src/lib/utils/contrasteWcag.ts:24`).

**Behaviors (issue A):**
- [x] Mudar a cor primária e ver, na pré-visualização, header, botão "+" e barra do carrinho mudando juntos. Garantido em: cliente (UX).
- [x] Ver o preço na pré-visualização sempre em preto, independente do tema. Garantido em: cliente (UX).

**Behaviors (issue B):**
- [x] Escolher uma primária clara (ex.: `#ffe066`) e ver, perto do seletor, um aviso de que o texto branco dos botões, da barra e do header pode ficar ilegível. O aviso **não bloqueia** o salvamento. Garantido em: cliente (UX). É só um aviso: a vitrine renderiza qualquer hex que o zod aceite.
- [x] Escolher uma primária escura (ex.: `#f2052c`, `#332616`) e não ver o aviso. Garantido em: cliente (UX).
- [x] Abrir a tela de tema e **não** ver o campo "Cor de destaque". Salvar preserva sem mudança o `destaque` já gravado em `lojas.tema`. Garantido em: cliente (UX). A gravação continua na Server Action existente (allowlist + zod de `lojas.tema`), sem mudança.

---

## Modelos de Dados

**Nenhuma mudança de schema.** `lojas.tema` (JSONB `{primaria, fundo, destaque}`) continua igual. A
chave `destaque` continua aceita e gravada pelo zod de `src/lib/validacoes/loja.ts`, para manter
compatibilidade com dados existentes e com o manifest. **Sem migration e sem RLS nova.**

`src/app/(publica)/loja/[slug]/page.tsx:337` pode continuar injetando `--cor-destaque`, que passa a
ser um token sem consumidor na vitrine. Removê-lo é opcional. Se ficar, leva o comentário da RN-8.

`src/lib/utils/manifest.ts` e `src/lib/utils/tema.ts` **não mudam**.

## Regras de Negócio

- **RN-1 — Cor de marca única.** Todo elemento da vitrine que hoje lê `--cor-destaque`
  (`bg-`, `text-`, `border-`, `outline-`, `decoration-`, `ring-`, `has-[…]:`, `hover:`, `data-open:`,
  `before:`, em forma de utilitário `*-destaque` ou de `[var(--cor-destaque)]`) passa a ler
  `--cor-primaria`, mantendo o mesmo modificador de opacidade (`/90`, `/5`, `/30`). As exceções são
  os valores monetários, que seguem a RN-2. **Camada:** cliente (UX).
- **RN-2 — Todo valor monetário em preto.** Todo valor em R$ exibido na vitrine, na gaveta do
  carrinho, no checkout, nos modais do checkout, na confirmação e na pré-visualização do tema usa
  `--preto` (#111111), seja qual for a cor de hoje (destaque, `texto`, `texto-muted`,
  `muted-foreground` ou herdada). A lista dos pontos está nos componentes de cada página acima.
  **Camada:** cliente (UX).
  - Implementação: acrescentar `--color-preto: var(--preto);` ao `@theme inline` de `globals.css`
    para expor `text-preto`, reusando o token existente sem criar cor nova. Usar `text-preto` em
    todos os pontos.
  - O rótulo ao lado do valor ("Subtotal", "Entrega", "/ unidade") **não** muda de cor. Só o número.
- **RN-3 — Exceções semânticas (não ficam pretas).** Estas cores carregam significado e continuam
  como estão:
  - preço antigo riscado (`<s>` em `text-texto-muted`), inclusive o "de" do `ModalRevisaoPreco`;
  - economia, desconto e cupom (`text-promo-texto`), e o selo de desconto (`promo-*`);
  - subtotal de item indisponível (riscado em `text-texto-muted`, fora do total);
  - valor dentro de botão colorido (ex.: "Adicionar ao carrinho R$ 18,00"), que continua com o texto
    do botão (branco).

  **Camada:** cliente (UX).
- **RN-4 — Texto sobre a primária.** Continua branco fixo (`text-white`), e a barra do carrinho
  continua `#f5f0e6`, como no `HeaderLoja` (design-system §4). A vitrine **não** calcula luminância.
  A defesa contra primária clara é o aviso do painel (RN-7). **Camada:** cliente (UX).
- **RN-5 — Cores fixas de sistema não mudam:** `BadgeStatus`, `promo-*`, `indisponivel-*`,
  `marrom-cafe`, `texto`, `texto-muted` (em rótulos), `PALETA_MENSAGEM`, `destructive`, `#9a9a9a` de
  disabled.
- **RN-6 — Valor monetário não muda de origem.** Esta spec só troca a cor de exibição. Preço, frete,
  desconto e total autoritativos continuam recalculados em `criarPedido` a partir do banco
  (`seguranca.md` §10). **Camada:** Server Action, sem mudança.
- **RN-7 — Aviso de contraste no painel (issue B).** O `TemaClient` mostra um aviso quando
  `razaoContraste("#ffffff", primaria) < 3` (WCAG AA texto grande/negrito; 4,5 avisaria no vermelho da Izza, 4,34:1, que lê bem). O aviso:
  - recalcula a cada mudança do seletor e só aparece com um hex válido;
  - não bloqueia o salvamento nem desabilita o botão;
  - explica que botões, barra do carrinho e header usam texto branco, e sugere uma cor mais escura;
  - usa cor de sistema de alerta, nunca a cor do tema, e traz ícone e texto (WCAG 1.4.1);
  - é anunciado a leitor de tela (`role="status"` ou `aria-live="polite"`).

  O limiar e a comparação ficam num helper puro (ex.: `primariaTemContrasteBaixo(hex): boolean`)
  ao lado de `contrasteWcag.ts`, com teste unitário: um caso claro, um escuro e um no limiar (3:1).
  **Camada:** cliente (UX).
- **RN-8 — Campo "Cor de destaque" oculto (issue B).** O campo sai da UI do `TemaClient`, mas a chave
  `destaque` continua no estado do formulário e no payload enviado. O valor atual é reenviado sem
  mudança, para não quebrar o zod nem apagar o dado. Não há migration nem mudança em
  `validacoes/loja.ts`, `tema.ts` ou `manifest.ts`.
  **Comentário obrigatório no código**, junto à definição dos campos (`TemaClient.tsx:35-37`),
  dizendo:
  1. que a cor de destaque está oculta de propósito e não tem efeito na vitrine;
  2. que o dado é mantido em `lojas.tema` para compatibilidade, sem migration;
  3. que a referência é `specs/vitrine-cor-unica-primaria.md` (RN-8).

  O mesmo aviso vai, em uma linha, no comentário do token em `globals.css` e na injeção de
  `page.tsx:337` (se ela continuar emitindo `--cor-destaque`). **Camada:** cliente (UX).

## Decisões (fechadas em 2026-10-20)

- **D-1 — Contraste:** implementar o **aviso no painel** (RN-7), sem bloquear. Nada de texto
  automático por luminância na vitrine.
- **D-2 — Campo destaque:** **ocultar** no painel e manter o dado. O comentário no código deixa a
  decisão evidente (RN-8).
- **D-3 — Alcance do preto:** **todos os valores monetários** (RN-2), com as exceções semânticas da
  RN-3.
- **D-4 — Landing do SaaS (`src/app/page.tsx`):** fica **fora**. Ela funciona de forma independente
  e vai passar por um refactor próprio depois.

## Documentação a atualizar (no mesmo PR)

- `src/app/globals.css:9,15,17`: comentários. Primária = "header, CTA, barra do carrinho, botão +,
  foco". Destaque = "legado, sem uso na vitrine nem no painel (ver
  specs/vitrine-cor-unica-primaria.md RN-8)". Atualizar também o comentário da linha 86, que cita
  `text-destaque` como exemplo.
- `references/design-system.md`: na seção de tema (~76-78 e ~94-96), primária = CTA, links, header,
  barra do carrinho, controles e foco; destaque = sem efeito e oculta no painel; **valor monetário =
  `--preto` fixo, não tematizável**, com as exceções da RN-3. Na §4 (contraste, ~119-123), trocar a
  "Proposta" pela decisão D-1 (aviso no painel, `razaoContraste`).
- Comentários de doc nos componentes que citam "cor de destaque" (`VitrineClient.tsx:83`,
  `CardProduto.tsx:59`).

## Testes afetados

Grep feito em 2026-10-20 (`text-destaque|cor-destaque|bg-destaque|outline-destaque` em `*.test.ts*`):

- `src/components/vitrine/superficiesForaDaJanela.test.tsx:193`: `not.toContain("var(--cor-destaque)")`
  na pílula de indisponível. O teste continua passando, mas perde o sentido. Acrescentar
  `not.toContain("cor-primaria")` para manter a intenção ("a pílula nunca usa a cor do tema").
- `src/components/vitrine/SeloDesconto.test.tsx:39`: já itera as três cores. Sem mudança.
- `src/components/vitrine/NavCategorias.test.tsx:79`: já espera `bg-primaria`. Sem mudança.
- `PrecoProduto.test.tsx` e `SecaoOpcionais.test.tsx`: opcional acrescentar `toContain("text-preto")`
  e `not.toContain("destaque")` para travar a RN-2.
- **Issue B:** teste unitário novo do helper da RN-7. É obrigatório, porque é lógica.
- `npm test` completo: os testes da **seção de destaque do cardápio** (feature 263:
  `superficiesPromocao`, `secoesDestaque`) usam "destaque" em outro sentido e **não devem ser tocados**.

## Segurança (obrigatório)

- **Dado sensível:** nenhum entra ou sai.
- **Valor monetário:** só muda a cor de exibição, nenhum cálculo. O recálculo em `criarPedido` continua
  sendo a única verdade.
- **Tabela nova / RLS:** nenhuma. A gravação do tema continua na Server Action existente, sem mudança
  de allowlist.
- **API externa:** nenhuma.
- **Injeção de CSS:** `page.tsx:337` continua lendo hex validado por zod. Esta spec não acrescenta
  nenhuma interpolação.

## Critérios de aceite

1. **Izza Lanches** (primária vermelha, destaque laranja): header = barra do carrinho = botão "+" =
   CTAs do modal e do checkout = **vermelho**. Nenhum laranja visível na vitrine, no checkout ou na
   confirmação.
2. Na mesma loja, todo valor em R$ aparece em **preto (#111111)**: card, lista, modal, opcional,
   gaveta, checkout (unitário, item, frete, subtotal, entrega, total), modal de revisão e confirmação.
3. As exceções da RN-3 continuam com a cor de hoje: riscado muted, economia e cupom em `promo-texto`,
   item indisponível riscado, valor dentro de botão em branco.
4. Loja sem tema customizado: CTAs e barra na primária default (`#332616`), valores em preto.
5. Painel → Tema: trocar a primária muda header, "+" e barra da pré-visualização juntos. O campo "Cor
   de destaque" não aparece. Salvar preserva o `destaque` gravado.
6. Painel → Tema: com primária `#ffe066` aparece o aviso e salvar funciona. Com `#f2052c` não aparece.
7. O comentário da RN-8 está presente em `TemaClient.tsx`, junto à definição dos campos.
8. `grep -rnE "cor-destaque|text-destaque|bg-destaque|border-destaque|outline-destaque" src/components/vitrine src/components/painel/PreviewVitrine.tsx "src/app/(publica)"`
   não retorna uso de cor. Sobram só a injeção opcional de `page.tsx:337`, comentada, e as
   ocorrências da feature 263 ("seção/produto em destaque").
9. Gate local: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build` verdes.

## Arquivos afetados

**Issue A — modificar:**
- `src/app/globals.css` (`--color-preto` no `@theme` e comentários)
- `src/components/vitrine/VitrineClient.tsx`
- `src/components/vitrine/CardProduto.tsx`
- `src/components/vitrine/PrecoProduto.tsx`
- `src/components/vitrine/ProdutoModal.tsx`
- `src/components/vitrine/SecaoOpcionais.tsx`
- `src/components/vitrine/TextoRealcado.tsx`
- `src/components/vitrine/BuscaProdutos.tsx`
- `src/components/vitrine/NavCategorias.tsx` (anel de foco)
- `src/components/vitrine/ItemProdutoLista.tsx` (anel de foco)
- `src/components/vitrine/Carrinho.tsx` (valores da gaveta)
- `src/components/vitrine/checkout/IndicadorEtapas.tsx`
- `src/components/vitrine/checkout/EtapaItens.tsx`
- `src/components/vitrine/checkout/EtapaEntrega.tsx`
- `src/components/vitrine/checkout/EtapaPagamento.tsx`
- `src/components/vitrine/checkout/ResumoValores.tsx`
- `src/components/vitrine/checkout/SeletorEnderecoCliente.tsx`
- `src/components/vitrine/checkout/CheckoutWizard.tsx`
- `src/components/vitrine/checkout/ModalRevisaoPreco.tsx`
- `src/components/vitrine/checkout/ModalFreteIndisponivel.tsx`
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx`
- `src/components/vitrine/confirmacao/LinkMapsLoja.tsx`
- `src/components/vitrine/confirmacao/ModalAvisoWhatsapp.tsx`
- `src/components/painel/PreviewVitrine.tsx`
- `src/components/vitrine/superficiesForaDaJanela.test.tsx` (reforço da asserção)
- `references/design-system.md`

**Issue B — modificar e criar:**
- `src/app/(painel)/painel/(bloqueavel)/configuracoes/tema/TemaClient.tsx` (aviso RN-7, campo oculto
  e comentário RN-8)
- `src/lib/utils/contrasteWcag.ts` (ou um arquivo vizinho): helper `primariaTemContrasteBaixo` e
  teste ao lado

**Opcional:**
- `src/app/(publica)/loja/[slug]/page.tsx:337`: remover `--cor-destaque` da injeção. Se ficar, leva
  o comentário da RN-8.

**Não tocar:**
- `src/components/vitrine/HeaderLoja.tsx` (já é a referência)
- `src/lib/validacoes/loja.ts`, `src/lib/utils/tema.ts`, `src/lib/utils/manifest.ts` (contrato do tema)
- `src/app/page.tsx` (landing do SaaS, D-4: refactor próprio depois)
- Painel do lojista fora da tela de tema (pedidos, comanda, recibo, dashboard)
- `BadgeStatus`, `paletaMensagem.ts`, `ComandaCozinha`, `ReciboCliente`, `NavPainel`
- Componentes e testes da feature "seção de destaque" (263): `SecaoCatalogo`, `CatalogoVitrine`,
  `catalogoVitrine.ts`, `secoesDestaque.test.tsx`

## Fora do Escopo (v1)

- Cálculo automático de cor de texto por luminância na vitrine (D-1).
- Remover a chave `destaque` de `lojas.tema`, do zod ou do manifest.
- Qualquer migration ou mudança de RLS.
- Novos temas, paletas pré-definidas ou cor de texto configurável pelo lojista.
- Landing institucional (D-4) e painel do lojista fora da tela de tema.
- Mudança em cálculo de preço, frete, desconto ou total.
