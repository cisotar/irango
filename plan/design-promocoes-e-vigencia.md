# Design de UI/UX — Descontos, pratos promocionais e cardápio sazonal

**Autor:** agente `desenhar` · **Data:** 2026-09-19 · **Branch:** `docs/specs-descontos-promocoes-cardapio`
**Entra como:** passo 4 do `plan/loop-descontos-promocoes-cardapio-sazonal.md`.
**Insumos:** o plano do loop (D1–D11), `specs/desconto-por-produto-e-pratos-promocionais.md`
(**Spec A, aprovado**) e `references/design-system.md`.

> **O que este documento decide e o que não decide.**
> Ele decide **forma**: anatomia de componente, hierarquia, copy não fixada, tokens, alvo de toque,
> ordem de leitura, foco e anúncio de leitor de tela. Ele **não** decide regra de negócio: D1–D11 e o
> Spec A estão fechados. Onde o desenho encostou num buraco da regra, o buraco está **apontado** em
> §13, não preenchido.
> A copy dos três estados do cupom já está fixada em **RN-10-e** e é **transcrita**, nunca reescrita.

---

## Gate de reuso

- **shadcn/ui varridos** (`src/components/ui/`, 14 arquivos): `accordion`, `badge`, `button`, `card`,
  `checkbox`, `dialog`, `input`, `label`, `menu`, `radio-group`, `separator`, `sheet`, `switch`,
  `textarea`.
- **Componentes vitrine/painel varridos:** `CardProduto`, `ItemProdutoLista`, `ProdutoModal`,
  `SecaoCatalogo`, `CatalogoVitrine`, `BuscaProdutos`, `VitrineClient`, `Carrinho`, `BadgeStatus`,
  `NavCategorias`, `TextoRealcado`, `ListaOpcionaisItem`, `checkout/{ResumoValores, EtapaItens,
  CheckoutWizard, ModalFreteIndisponivel, estado.ts}`; `FormProduto`, `ProdutosClient`,
  `CartaoAssociacaoOpcionais`, `PainelItensDoGrupo`, `LinhaCategoriaReordenavel`, `ModoReordenar`,
  `ComandaCozinha`, `ReciboCliente`, `DetalhePedido`, `ThumbProduto`.
- **Tokens varridos** (`src/app/globals.css`, blocos `:root` e `@theme inline`): `--cor-primaria`,
  `--cor-fundo`, `--cor-destaque`, `--marrom-cafe`, `--texto`, `--texto-muted`, `--preto`, `--branco`,
  `--borda-nav`, `--cinza-medio`, `--cinza-claro`, `--sombra-suave`, `--sombra-media`,
  `--altura-barra`, `--radius*` e os tokens shadcn (`--muted-foreground`, `--destructive`, …).
- **Utils de copy pura varridos:** `lib/utils/alcance-do-grupo.ts` (precedente exato de "copy em
  módulo puro, testável em `environment: node`"), `rotulosPedido.ts`, `rotuloFrete.ts`,
  `freteDegradado.ts`, `contadorObservacao.ts`, `formatarMoeda.ts`, `lojaAberta.ts`.

**Decisão: REUSAR + CONSOLIDAR + CRIAR (3 componentes e 4 módulos puros).**

**Justificativa (1 linha):** todo primitivo necessário já existe (`Dialog`, `Switch`, `RadioGroup`,
`Checkbox`, `Badge`, `Card`, `Accordion`, `Menu`), o padrão visual de "aparece mas não compra" já
existe em duas variantes divergentes que este trabalho **consolida**, e as três criações
(`PrecoProduto`, `SeloVitrine`, `ModalPromocoes`) existem justamente para que a mesma regra não seja
reescrita em quatro superfícies.

### O que é reuso puro

| Necessidade | O que já existe | Como |
|---|---|---|
| Modal com foco preso, ESC e clique-fora | `ui/dialog.tsx` (Base UI) | `ModalPromocoes` e a reconfirmação de preço usam `Dialog`; nada de modal ad-hoc (design-system §5) |
| Ligar/desligar promoção; "definir prazo" | `ui/switch.tsx`, `ui/checkbox.tsx` | bloco Promoção do `FormProduto` |
| Escolher percentual × reais; escolher modo de vigência | `ui/radio-group.tsx` | dois `RadioGroup`, nenhum `Select` novo |
| Chip/selo com cor de sistema + texto | `ui/badge.tsx` + o princípio de `BadgeStatus` (design-system §8) | `SeloVitrine` |
| Lista densa do painel virando card-list no mobile | `ProdutosClient` (Accordion + Card + `flex-wrap`/`order-*`) | modo seleção e cardápio entram **dentro** desse layout |
| Copy que precisa ser testada sem DOM | `lib/utils/alcance-do-grupo.ts` | 4 módulos de copy pura novos, mesmo formato |
| Texto de erro por veredito, sem culpar o cliente | `ModalFreteIndisponivel.textos()` | a reconfirmação de preço (D11) copia essa forma |
| Alcance de uma ação antes de confirmar | `alcance-do-grupo.ts` (`rotuloAlcance`, `perguntaDeRemocao`) | a confirmação da ação em lote (D2) copia essa forma |
| Aritmética de fuso | `lojaAberta.ts::partesNoFuso` (Spec A já manda extrair para `lib/utils/fusoLoja.ts`) | prévia de vigência em linguagem natural |

### O que este trabalho CONSOLIDA (não cria terceira variante)

🔴 **"Esgotado" hoje tem duas aparências e um bug.**

| Superfície | Hoje | Evidência |
|---|---|---|
| Card (grid) | overlay `bg-black/35` + grayscale + pílula **preta** `#111111` no rodapé da foto + `card-body opacity-60` + card **não clicável** | `src/components/vitrine/CardProduto.tsx:60-73` |
| Modal do produto | selo **marrom** `#8B4513` centralizado + imagem em grayscale + CTA "Produto esgotado" | `src/components/vitrine/ProdutoModal.tsx:337-347` |
| Linha de lista (categoria sem imagem) | **não existe** — a linha não recebe nem conhece `disponivel` | `src/components/vitrine/ItemProdutoLista.tsx:24-38` |
| Painel | `Badge variant="secondary"` "Esgotado" | `ProdutosClient.tsx:199-213` |

🔴 **E o bug que vem junto:** `SecaoCatalogo.abrirModal` monta `ProdutoModalDados` **sem** o campo
`disponivel` (`src/components/vitrine/SecaoCatalogo.tsx:88-100`), e `ProdutoModal` lê
`produto.disponivel ?? true` (`ProdutoModal.tsx:139`). Hoje isso não vaza porque o card esgotado não é
clicável — **mas a linha de lista é** (`ItemProdutoLista` sempre chama `onSelecionar`). Numa categoria
com `exibir_imagens = false`, um produto esgotado abre um modal que se diz disponível e pode ser
adicionado ao carrinho. É um `?:` com default que ninguém passou — exatamente a classe de erro que a
**exigência 5** manda tornar impossível, e o motivo pelo qual §1-M2 abaixo troca props avulsas
opcionais por **um objeto obrigatório**.

Este documento define **uma** aparência de "aparece mas não compra" (§4), válida nas quatro
superfícies, e usada tanto por `esgotado` quanto por `fora_da_janela` (D4 manda literalmente reusar o
padrão de `esgotado`).

### O que precisa ser GERADO pelo shadcn CLI (não editar `components/ui/` à mão)

| Componente | Por quê | Onde |
|---|---|---|
| `npx shadcn add alert-dialog` | design-system §6 manda usar `AlertDialog` em ação destrutiva, mas **ele não existe** em `components/ui/`; `ProdutosClient.tsx:12` importa direto de `@base-ui/react/alert-dialog`. Com a ação em lote (D2) o padrão passa a ter 2+ usos — é a régua de extração do próprio design-system §10 | confirmação da ação em lote |
| **nada além disso** | `Select`, `Form` e `Tabs` **não** são necessários: os dois campos de escolha viram `RadioGroup` (já existe) e o form de produto continua no padrão atual de `useState` + `safeParse` | — |

> **Divergência registrada, não resolvida aqui:** `FormProduto.tsx` não usa react-hook-form, contra o
> que design-system §6 declara como padrão. Migrá-lo é refactor fora do escopo deste trabalho. O que
> §8 abaixo exige é o mínimo: um mapa `campo → mensagem` e `aria-invalid`/`aria-describedby` — sem
> isso a mensagem do D10 não tem onde aparecer.

---

## 1. Nove pontos onde o desenho torna o erro impossível

🔴 **Não existe jsdom neste projeto** (`environment: node`, sem Docker, sem Playwright, sem MCP de
browser). Nada aqui será verificado por teste de DOM. Então, onde a correção dependia de disciplina de
quem escreve o componente, **o desenho mudou**. Estes nove pontos são contrato para o `executar`:

| # | Erro que ficaria solto | Mudança de desenho | Onde |
|---|---|---|---|
| **M1** | selo e preço riscado implementados 4× (card, lista, modal, busca) e divergindo | **um** `PrecoProduto` e **um** `SeloVitrine`; nenhuma superfície formata preço por conta própria. A busca é coberta de graça porque reusa card e linha | §3 |
| **M2** | prop opcional com default silencioso (`disponivel?: boolean` → `?? true`), que já produz o bug real acima | as superfícies passam a receber **um objeto obrigatório** `produto: ProdutoVitrine`, não campos avulsos. Campo faltando vira erro de `tsc`, não "R$ NaN" nem "disponível por engano" | §3, §4 |
| **M3** | componente decidindo se há desconto (`precoEfetivo < preco`) e refazendo a regra no browser | `temDesconto`, `seloDesconto` (rótulo **pronto**) e `compravel`/`motivoNaoCompravel` chegam **decididos do servidor**; o componente só ramifica em booleano | §3, §4 |
| **M4** | componente escolhendo o estado A/B/C do cupom comparando `baseElegivel` com `subtotal` — reimplementação da regra monetária no cliente | a Server Action devolve `estadoCupom` como **union discriminada**; o componente nunca compara números | §6 |
| **M5** | a frase obrigatória de RN-10-e reescrita/traduzida em revisão, sem nenhum teste capaz de pegar | as 3 redações literais vivem em **`lib/utils/copiaCupom.ts`**, módulo puro, testável byte a byte em `environment: node` — mesmo formato de `alcance-do-grupo.ts` | §6 |
| **M6** | painel e vitrine descrevendo a **mesma** vigência com palavras diferentes ("sáb e dom" vs. "fim de semana") | **um** módulo `lib/utils/descreverVigencia.ts` produz a prévia do painel **e** o rótulo "quando volta" do selo da vitrine | §9, §4 |
| **M7** | mensagem do D10 com um texto no cliente e outro no servidor | a mensagem é montada por **uma** função pura exportada, consumida pelo `superRefine` do `schemaProduto` (que já é isomórfico) — form e Server Action não têm como divergir | §8 |
| **M8** | ação em lote confirmada sobre uma contagem do cliente (seleção velha, produto de outra loja, catálogo mudado noutro dispositivo) | o botão de confirmar recebe `previa` **obrigatória, vinda do servidor**; sem `previa` ele nem existe. E o número vai **dentro do rótulo do botão** ("Aplicar a 12 produtos") | §10 |
| **M9** | "segundo clique explícito" do D11 virando um `disabled` que alguém reabilita | o CTA de envio é **removido do DOM** enquanto a reconfirmação está aberta, o gate entra em `podeConfirmar` (`checkout/estado.ts`, função pura já existente e já testada) e o envio exige um **token de revisão** do servidor | §7 |

Três observações que valem para os nove:

1. **Toda copy nova vira função pura em `lib/utils/`.** É o único jeito de testar texto neste repo.
   Quatro módulos: `copiaCupom.ts`, `copiaRevisaoPreco.ts`, `descreverVigencia.ts`,
   `copiaLotePromocao.ts`.
2. **Nenhuma prop nova de valor monetário tem default.** Se o servidor não mandou, o bloco não é
   renderizado — nunca calculado no cliente (§12).
3. **Nenhum componente novo lê `window` direto.** `localStorage`, `scrollY` e o instante `agora`
   entram por parâmetro, como `architecture.md` §8 já manda e como o Spec A fixou em RN-16/RN-18.

---

## 2. Tokens e a proteção do selo contra o tema do lojista

`tema.primaria` e `tema.destaque` são `#RRGGBB` escolhidos pelo lojista e **podem ser qualquer coisa**
(design-system §4, "Contraste do tema custom — risco conhecido"). O selo de desconto e o selo de
indisponibilidade **não podem depender deles**.

**Cinco regras, todas verificáveis lendo o componente:**

1. **O selo nunca lê `--cor-primaria`, `--cor-destaque` ou `--cor-fundo`** — nem em `bg-`, nem em
   `text-`, nem em `border-`. Ele é cor de **sistema**, pelo mesmo princípio de `BadgeStatus`
   (design-system §8): o estado precisa significar a mesma coisa em qualquer loja.
2. **O selo pinta fundo opaco próprio + borda de 1,5px.** O par de contraste é sempre
   (texto do selo × fundo do selo), **nunca** (texto do selo × foto do produto) nem
   (texto do selo × cor do lojista). É isso que o protege: o que está atrás deixa de participar da
   conta.
3. **Cor + texto, sempre.** "-20%", "-R$ 10,00", "Só aos sábados e domingos", "Esgotado". Nunca só cor
   (WCAG 1.4.1, design-system §5).
4. **O preço riscado nunca usa cor de tema.** Ele usa `--texto-muted` (#6b5d4f, já documentado como AA
   em fundo claro). Um tema de baixo contraste pode deixar o preço efetivo fraco — isso é risco
   **pré-existente** (`CardProduto.tsx:85` já pinta o preço com `--cor-destaque`) — mas o preço antigo
   continua legível em qualquer tema.
5. **Nenhuma cor nova é inventada.** Os três tokens abaixo são **promoção a token** de hex que já
   estão no código.

### Tokens novos (só renomeiam hex já existentes no repo)

```css
/* globals.css — bloco :root, seção "Sistema (fixo, não depende do tema da loja)" */

/* Promoção ativa. Mesmo trio verde que BadgeStatus "Aberto agora" já usa
   (BadgeStatus.tsx:30) e que ResumoValores usa no desconto (#166534).
   Contraste #166534 sobre #dcfce7 ≈ 7:1 — AA e AAA para texto normal. */
--promo-fundo: #dcfce7;
--promo-texto: #166534;
--promo-borda: #86efac;

/* Indisponível (esgotado E fora da janela). Mesmo preto da pílula que o
   CardProduto já imprime sobre a foto (CardProduto.tsx:70).
   Contraste #ffffff sobre #111111 ≈ 18,9:1. */
--indisponivel-fundo: #111111;
--indisponivel-texto: #ffffff;
```

Expostos em `@theme inline` como `--color-promo-fundo`, `--color-promo-texto`,
`--color-promo-borda`, `--color-indisponivel-fundo`, `--color-indisponivel-texto`.

> O `#8B4513` (marrom) do selo "Esgotado" do `ProdutoModal.tsx:342` **sai**. É a terceira variante da
> mesma ideia e não tem justificativa semântica — consolidar nele significaria escolher a variante que
> aparece em menos lugares.

### Régua de toque e foco (herdada, não negociada)

- **44×44 literal**, nunca `min-h-11`: a base do projeto é `font-size: 120%`
  (`globals.css`), onde `min-h-11` vira 52,8px e `size="icon-sm"` do shadcn vira **33,6px — proibido**
  em alvo de toque (design-system §5). Precedente no código: `NavCategorias`, `BuscaProdutos`
  (`ALVO_44 = "min-h-[44px]"`), `ProdutosClient` (`min-h-[44px] min-w-[44px]`).
- **Foco visível:** `focus-visible:outline-3 focus-visible:outline-offset-2` na vitrine (precedente
  `BuscaProdutos.FOCO_VISIVEL`) e `focus-visible:ring-3` no painel (default shadcn).
- **Espaçamento:** só múltiplos de 4. **Raio:** `--radius` e derivados.

---

## 3. Vitrine — produto com desconto ativo, nas quatro superfícies (D1)

**Mobile primeiro.** Tudo abaixo é desenhado em 360px; o desktop é o mesmo componente com uma classe
de tamanho a mais.

### 3.1 Os dois componentes novos (M1)

```
components/vitrine/PrecoProduto.tsx      — o par de preços, apresentação pura
components/vitrine/SeloVitrine.tsx       — o chip (promoção OU indisponibilidade)
lib/utils/rotuloPrecoAcessivel.ts        — a frase que o leitor de tela ouve (pura)
```

#### `PrecoProduto`

```tsx
type PrecoProdutoProps = {
  /** Objeto INTEIRO do contrato de catálogo — nunca campos avulsos (M2). */
  produto: Pick<ProdutoVitrine, "preco" | "precoEfetivo" | "temDesconto">;
  /** OBRIGATÓRIO, sem default: esquecer quebra o tsc, não o layout. */
  tamanho: "card" | "lista" | "modal";
};
```

Anatomia (com desconto):

```tsx
<span className={CONTAINER[tamanho]}>
  {/* O que o leitor de tela ouve — UMA frase, montada por função pura.
      `<s>` sozinho NÃO comunica "preço antigo": a maioria dos leitores de tela
      não anuncia line-through por padrão, e nos que anunciam é configurável.
      Por isso o par visual inteiro é aria-hidden e a verdade acessível é o
      sr-only. Mesmo precedente do realce de busca (CardProduto.tsx:76-82) e do
      aviso do contador de observação (ProdutoModal.tsx:466-468). */}
  <span className="sr-only">{rotuloPrecoAcessivel(produto)}</span>

  <s aria-hidden className="text-texto-muted [font-variant-numeric:tabular-nums]">
    {formatarMoeda(produto.preco)}
  </s>
  <span aria-hidden className="font-black text-[var(--cor-destaque)] [font-variant-numeric:tabular-nums]">
    {formatarMoeda(produto.precoEfetivo)}
  </span>
</span>
```

Sem desconto: um `<span>` só com `formatarMoeda(precoEfetivo)`, **sem** `sr-only` duplicado — a mesma
árvore de hoje.

```ts
// lib/utils/rotuloPrecoAcessivel.ts — PURA, node-testável
export function rotuloPrecoAcessivel(p: {
  preco: number; precoEfetivo: number; temDesconto: boolean;
}): string {
  return p.temDesconto
    ? `De ${formatarMoeda(p.preco)} por ${formatarMoeda(p.precoEfetivo)}`
    : formatarMoeda(p.precoEfetivo);
}
```

> 🔴 **Consequência obrigatória em `ItemProdutoLista`.** O `aria-label` da linha hoje é
> `` `Ver detalhes de ${nome}, ${precoFormatado}` `` (`ItemProdutoLista.tsx:48`). Se ficar assim, o
> cliente cego ouve **só o preço cheio** e nunca fica sabendo da promoção. Ele passa a usar
> `rotuloPrecoAcessivel` — a **mesma** função. Mesma correção vale para o `aria-label` do botão "+"
> do `CardProduto` (`CardProduto.tsx:91-93`): `Adicionar ${nome} ao carrinho, ${rotuloPrecoAcessivel(...)}`.

#### `SeloVitrine`

```tsx
type SeloVitrineProps = {
  /** "promocao": verde de sistema. "indisponivel": preto de sistema. */
  tom: "promocao" | "indisponivel";
  /** Texto PRONTO, vindo do servidor. `null` ⇒ o componente devolve null. */
  rotulo: string | null;
  /** "foto" (sobreposto à imagem) | "inline" (no fluxo de texto). Obrigatório. */
  ancoragem: "foto" | "inline";
};
```

**`rotulo: string | null` com o `return null` DENTRO do componente** (M3): não existe um `{x && ...}`
para alguém esquecer em uma das quatro superfícies. Uma decisão, um lugar.

Classes:

```
promocao   : bg-promo-fundo text-promo-texto border-[1.5px] border-promo-borda
indisponivel: bg-indisponivel-fundo text-indisponivel-texto border-[1.5px] border-white/25
comum      : rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide
             whitespace-nowrap shadow-[0_2px_10px_rgba(0,0,0,0.25)]
ancoragem=foto : absolute z-[2]  (posição dada pelo consumidor)
```

O selo **não é interativo** — não é botão, não tem `title`, não tem tooltip. Um chip que só existe no
hover não existe no celular.

### 3.2 Superfície A — `CardProduto` (grid, categoria com imagens)

```
360px · grid-cols-2 · card ≈ 168px de largura

┌──────────────────────────┐
│ ┌────┐                   │   selo de promoção: canto SUPERIOR ESQUERDO da foto
│ │-20%│    [ foto 4:3 ]   │   (a pílula de indisponível já mora no rodapé-centro;
│ └────┘                   │    os dois nunca colidem, e podem coexistir)
│                          │
├──────────────────────────┤
│ Feijoada completa        │   h3, line-clamp-2, 14px/bold
│                          │
│  R̶$̶ ̶1̶0̶0̶,̶0̶0̶          [+] │   ← riscado 12px em --texto-muted, acima…
│  R$ 80,00                │   ← …efetivo 18px black em --cor-destaque
└──────────────────────────┘
        ↑ leitor de tela ouve: "De R$ 100,00 por R$ 80,00"
```

- Em 168px de largura os dois preços **não cabem lado a lado** com o botão "+". Empilhados: riscado
  em cima (`text-xs`), efetivo embaixo (`text-lg`), o "+" alinhado ao final da coluna
  (`items-end`). A partir de `lg` (onde o card encolhe para `text-sm`, `CardProduto.tsx:85`) o riscado
  cai para `text-[11px]`.
- **Nada muda na altura do card sem desconto** — o bloco de preço só ganha a linha riscada quando
  `temDesconto`. A grade (`grid-cols-2 md:grid-cols-3 xl:grid-cols-4`, design-system §9) é padrão fixo
  e **não se ajusta**.

### 3.3 Superfície B — `ItemProdutoLista` (categoria com `exibir_imagens = false`)

```
360px · linha do cardápio textual · min-h-[44px]

┌───────────────────────────────────────────────┐
│ Feijoada completa  ·········  R̶$̶1̶0̶0̶ R$ 80,00 │
│ [-20%]                                        │  ← selo INLINE, 2ª linha
└───────────────────────────────────────────────┘
```

- `ancoragem="inline"`: aqui não há foto. O selo vai numa segunda linha sob o nome, **não** espremido
  entre o nome e a linha pontilhada — em 360px o nome já usa `max-w-[60%]`
  (`ItemProdutoLista.tsx:57`) e um chip no meio derrubaria o alinhamento pontilhado que é a identidade
  visual dessa variante.
- O par de preços à direita: riscado `text-[11px]` + efetivo `text-sm font-extrabold`, empilhados,
  `text-right`.
- A linha inteira continua sendo o alvo de toque (`role="button"`, `min-h-11` → vira
  `min-h-[44px]` literal, para ficar na régua do design-system §5 em vez de 52,8px acidentais).

### 3.4 Superfície C — `ProdutoModal`

```
mobile (full-screen) — cabeçalho na cor primária da loja
┌───────────────────────────────────────────────┐
│           FEIJOADA COMPLETA              [✕]  │  ← ✕ passa a 44×44 (hoje 33,6px)
├───────────────────────────────────────────────┤
│              [ foto 4:3 ]                     │
│                                               │
│  Descrição do prato… ver mais                 │
│                                               │
│            ┌────────────────────┐             │
│            │       -20%         │             │  ← SeloVitrine inline, centrado
│            └────────────────────┘             │
│         De R$ 100,00 por R$ 80,00             │  ← PrecoProduto tamanho="modal"
│                                               │
│  ┌─ Quantidade ─────────────────────────────┐ │
│  │ Unidades                    [−] 1 [+]    │ │
│  │ Cada unidade · R$ 80,00                  │ │  ← preço EFETIVO
│  │ De R$ 100,00 por R$ 80,00                │ │  ← quando temDesconto
│  └──────────────────────────────────────────┘ │
├───────────────────────────────────────────────┤
│  [ Adicionar ao carrinho        R$ 80,00 ]    │  ← subtotal parte do efetivo
│  [ Mais itens ]                               │
└───────────────────────────────────────────────┘
```

- O selo fica **acima** do bloco de quantidade e **abaixo** da descrição — a mesma posição onde hoje
  aparece o selo "Esgotado" (`ProdutoModal.tsx:336-348`). Um lugar, dois tons.
- `Cada unidade · R$ 80,00` (`ProdutoModal.tsx:396-400`) passa a usar `PrecoProduto`.
- O subtotal do rodapé já parte de `produto.preco` via `calcularSubtotal`
  (`ProdutoModal.tsx:151-163`); com o contrato novo esse campo **é** o preço efetivo. Nada de aritmética
  nova no modal.
- 🔴 **O ✕ do cabeçalho é `size-7` = 33,6px** (`ProdutoModal.tsx:310`). Abaixo da régua. Vai para
  `size-[44px]` com o ícone continuando pequeno dentro. Correção de acessibilidade que este trabalho
  encosta e não pode deixar passar.

### 3.5 Superfície D — resultado de busca (`BuscaProdutos` + `CatalogoVitrine`)

**Não há componente de resultado de busca.** A busca é subtrativa: `filtrarCatalogo` devolve as mesmas
`CategoriaComProdutos` e o `SecaoCatalogo` renderiza os mesmos `CardProduto`/`ItemProdutoLista`
(`BuscaProdutos.tsx`, cabeçalho: *"a filtragem é estritamente subtrativa sobre o payload que o SSR já
limitou"*).

**Portanto a superfície D é coberta de graça — desde que uma condição seja mantida:**

> 🔴 `filtrarCatalogo` **repassa o objeto `ProdutoVitrine` inteiro**. Se alguém re-montar um shape
> reduzido (`{ id, nome, preco }`) para "deixar o filtro leve", o selo e o preço riscado somem só na
> busca, e **nenhum teste deste repo pega isso**. O Spec A já registra essa exigência
> (§Componentes: *"a única exigência é que `filtrarCatalogo` continue repassando o objeto inteiro"*);
> este documento a repete porque é o único ponto do desenho da vitrine que depende de disciplina.
> O que reduz o risco a quase zero: os campos são **obrigatórios** no tipo (M2), então um shape
> reduzido não type-checa contra `CardProdutoProps.produto`.

O realce do termo (`TextoRealcado`) continua **só no nome** e continua estritamente visual — selo e
preço não são realçados.

---

## 4. Vitrine — produto fora da janela do cardápio (D4)

D4 é literal: **"mesmo padrão visual de `esgotado`, não o de `oculto`"**. Então não há desenho novo —
há o padrão consolidado de §Gate de reuso, com outro rótulo.

### 4.1 O que o servidor decide (M3)

```ts
compravel: boolean                    // false ⇒ aparece, sem botão de compra
motivoNaoCompravel: "esgotado" | "fora_da_janela" | null
rotuloNaoCompravel: string | null     // ⚠️ CAMPO NOVO — ver §12, item 1
```

O terceiro campo é o que o desenho exige e o contrato ainda não promete: **"Só aos sábados e domingos"
é texto de calendário e não pode ser formatado no browser** (M6). O componente faz um `switch` sobre
`motivoNaoCompravel` para escolher o **tom** e imprime `rotuloNaoCompravel` como **texto**.

Precedência entre `esgotado` e `fora_da_janela` é **do servidor** (regra 3 do contrato de catálogo do
Spec A) — a UI nunca compõe dois motivos e nunca mostra dois selos de indisponibilidade.

### 4.2 Tratamento único, quatro superfícies

| Superfície | Tratamento |
|---|---|
| `CardProduto` | overlay `bg-black/35` + `[backdrop-filter:grayscale(1)]` sobre a foto, `card-body opacity-60`, `SeloVitrine tom="indisponivel" ancoragem="foto"` no rodapé-centro com `rotuloNaoCompravel`, botão "+" **removido do DOM** (não `disabled`) |
| `ItemProdutoLista` | **novidade**: a linha ganha o selo inline, o preço fica em `--texto-muted` sem `--cor-destaque`, e o texto do preço não é riscado (não há promoção aqui, há indisponibilidade) |
| `ProdutoModal` | selo centralizado no mesmo lugar do "Esgotado" de hoje, imagem em grayscale, seção de quantidade e de observação ocultas, CTA `Produto indisponível` desabilitado (é o padrão que já existe, `ProdutoModal.tsx:378-388`) |
| Busca | de graça, pelo mesmo motivo de §3.5 |

Dois desvios deliberados do que está no código hoje, ambos **CONSOLIDAR**:

1. **O botão "+" do card sai do DOM em vez de ficar `disabled`.** Um "+" cinza desabilitado convida o
   toque e não responde; o cliente toca duas vezes e conclui que o site travou. Sem botão, o card
   inteiro continua abrindo o modal (item 2), que é onde a explicação mora.
2. 🔴 **O card não-comprável passa a ser clicável e abre o modal.** Hoje
   `CardProduto` zera o `onClick` quando `!disponivel` (`CardProduto.tsx:46`) enquanto
   `ItemProdutoLista` sempre abre — e abre com o estado errado (o bug de §Gate de reuso). Com D4 isso
   deixa de ser detalhe: **o motivo ("Só aos sábados e domingos") não cabe na pílula do card em 360px**,
   e o único lugar onde ele cabe inteiro é o modal. Um produto marcado que não abre é um beco sem
   saída. A adição continua impossível — o modal não-comprável não tem CTA de adicionar.

### 4.3 Copy do rótulo

Produzida por `descreverVigencia.ts::rotuloVoltaQuando` (M6, §9.5), **no servidor**. Forma curta,
porque divide espaço com uma foto em 168px:

| Configuração | Rótulo |
|---|---|
| dias da semana | `Só aos sábados e domingos` |
| dias da semana + horário | `Sáb e dom, 11:00–15:00` |
| dias do mês | `Só nos dias 1 e 15` |
| só horário | `Só das 11:00 às 15:00` |
| prazo fixo ainda não começado | `A partir de 22/09` |
| prazo fixo já encerrado | *não se aplica* — ver §13, buraco 4 |
| esgotado | `Esgotado` |

Regra de tamanho: **no máximo 32 caracteres**. Acima disso a pílula quebra em duas linhas sobre a foto
e cobre o prato. A função pura aplica o corte — e **é testável byte a byte sem DOM**, que é o ponto.

---

## 5. Modal de promoções na abertura (D6) — e como ele não rouba o gesto

🔴 **O PR #139 acabou de corrigir este erro no carrinho.** O carrinho abria sozinho e interceptava o
gesto de navegação; passou a abrir **só por clique explícito em "Ver carrinho"**
(`VitrineClient.tsx:20-22`, comentário: *"O Sheet só abre por clique explícito … adicionar item nunca
abre sozinho"*). O modal de promoções é, por definição, o caso que o D6 autoriza a abrir sozinho — e
por isso precisa de travas que o carrinho não precisou.

### 5.1 A trava estrutural: um modal sem destino não pode roubar um gesto

A proteção mais forte não é um `if`, é uma **ausência**:

> **O `ModalPromocoes` não navega, não adiciona nada ao carrinho, não abre o carrinho e não dispara
> nenhuma escrita.** O único CTA é "Ver promoções", que **fecha o modal e rola até a primeira
> promoção** — uma âncora dentro da mesma página, nunca uma rota nova (RN-17).

Consequência: mesmo no pior caso imaginável — o cliente já com o dedo na tela quando o modal monta —
o gesto roubado só pode produzir **fechar o modal**. Não existe um destino errado para onde ele possa
levar o cliente. Nenhum outro modal da vitrine tem essa propriedade: o `ProdutoModal` adiciona ao
carrinho, o `ModalFreteIndisponivel` troca o modo de entrega.

E há uma segunda trava que o navegador dá de graça, desde que ninguém a jogue fora:

> **`click` exige `pointerdown` E `pointerup` no mesmo elemento.** Um gesto que começou na página e
> terminou sobre o rodapé do modal **não** ativa o CTA — ele cai no backdrop, que fecha.
> **Regra para o `executar`:** nenhum handler do `ModalPromocoes` escuta `touchstart`, `pointerdown`
> ou `mousedown`. Só `onClick` e `onKeyDown`. Trocar por `onPointerDown` "para responder mais rápido"
> reintroduz exatamente o roubo de gesto do #139.

### 5.2 As sete travas de abertura

Todas derivadas de RN-16/RN-17 do Spec A, traduzidas para o componente:

1. **Decisão única, na montagem.** `useEffect(..., [])`, chamando a função pura
   `decidirModalPromocoes` (RN-16). Nunca reabre: o único `setAberto(true)` do arquivo está dentro
   desse efeito, e nada mais o chama. Rolar, buscar, adicionar ao carrinho, voltar para a aba,
   redimensionar — nada reabre.
2. **Zero `setTimeout`.** Modal que aparece depois de N segundos é *o* padrão que intercepta o toque
   no meio do gesto. A decisão é tomada na montagem ou não é tomada.
3. **`scrollY > 0` ⇒ não abre.** Quem começou a rolar já está navegando; a janela de abrir passou.
   `scrollY` entra **por parâmetro** na função pura (RN-16), nunca lido de `window` lá dentro.
4. **Marca como visto no instante da decisão**, não no fechamento. Fechar por ESC, ✕, clique fora,
   CTA ou recarregar a página têm todos o mesmo efeito: hoje não volta.
5. **Um único caminho de fechamento.** `fechar()` é a única função que fecha, e é ela que vai em
   `onOpenChange` do `Dialog`, no ✕, no "Ver promoções" e no "Continuar vendo o cardápio". Não há um
   segundo caminho para alguém esquecer de instrumentar.
6. **Nada no SSR.** O modal monta depois da hidratação. Se o JS falhar, a vitrine funciona inteira e o
   modal simplesmente não existe. O catálogo atrás dele está completo e interativo.
7. **Uma condição, um lugar (M3).** `VitrineClient` renderiza `<ModalPromocoes …/>`
   **incondicionalmente**; quem devolve `null` quando não há promoção é o próprio componente. Duas
   guardas (uma no pai, outra no filho) é uma guarda a mais para alguém remover.

### 5.3 A trava que o Spec A não cobre: para onde o foco volta

O modal abre **sem trigger** (ninguém clicou em nada). Quando ele fecha, o Base UI devolve o foco
para... nada. O foco cai no `<body>`, e o cliente de teclado ou de leitor de tela é jogado para o topo
do documento — que é **exatamente o mesmo dano** do gesto roubado, só que na navegação por teclado.

**Desenho:**

```tsx
type ModalPromocoesProps = {
  promocoes: ProdutoVitrine[];      // obrigatório; vazio ⇒ o componente devolve null
  toggleDaLoja: boolean;            // loja.modal_promocoes (SSR, via vitrine_lojas)
  diaDeHojeNaLoja: string;          // "YYYY-MM-DD" no fuso da LOJA (RN-16)
  storage: Storage | null;          // injetado (RN-18) — nunca lido de window aqui
  /** OBRIGATÓRIO: para onde o foco volta e para onde o CTA rola. */
  destinoFoco: RefObject<HTMLElement | null>;
};
```

- `destinoFoco` aponta para o `<main>` da vitrine, com `tabIndex={-1}`. É passado a
  `Dialog.Root finalFocus`; se a versão instalada do Base UI não expuser `finalFocus`, o `fechar()`
  chama `destinoFoco.current?.focus()` — **mesma prop obrigatória, mesmo resultado**.
- **Prop obrigatória, não opcional** (M2): sem ela, não compila. Foco perdido é invisível em revisão
  de código e não é testável aqui.
- O **mesmo** ref é o alvo do "Ver promoções": fechar e rolar acontecem para o mesmo lugar, então o
  foco de teclado e o scroll visual nunca divergem.
- `initialFocus` fica no **default** (o popup), para o leitor de tela anunciar título + descrição ao
  abrir. O primeiro tab stop é o ✕.

### 5.4 Anatomia

```
360px · Dialog centralizado · sem scroll interno em 360×640

┌───────────────────────────────────────────────┐
│  PROMOÇÕES DE HOJE                      [ ✕ ] │ ← DialogTitle + ✕ 44×44
│  3 pratos com desconto agora                  │ ← DialogDescription
├───────────────────────────────────────────────┤
│  ┌───┐  Feijoada completa           [-20%]    │
│  │img│  De R$ 100,00 por R$ 80,00             │ ← PrecoProduto tamanho="lista"
│  └───┘                                        │   (a MESMA regra de §3, M1)
│  ┌───┐  Parmegiana de frango        [-R$ 8]   │
│  │img│  De R$ 48,00 por R$ 40,00              │
│  └───┘                                        │
│  ┌───┐  Filé à cubana               [-15%]    │
│  │img│  De R$ 62,00 por R$ 52,70              │
│  └───┘                                        │
│  e mais 2 pratos em promoção                  │ ← só quando > 3
├───────────────────────────────────────────────┤
│  [ Ver promoções ]                            │ ← primário, min-h-[52px]
│  [ Continuar vendo o cardápio ]               │ ← secundário, min-h-[44px]
└───────────────────────────────────────────────┘
```

- **No máximo 3 pratos listados** + a linha "e mais N". Em 360×640 com o teclado ausente, 3 linhas +
  cabeçalho + dois botões cabem sem scroll interno. Um modal que rola dentro de uma página que também
  rola é a segunda causa de gesto perdido.
- **As linhas NÃO são interativas.** Nem `role="button"`, nem `onClick`. RN-17 diz que o único CTA é
  "Ver promoções"; tornar cada linha tocável adicionaria três alvos que o cliente não pediu, dentro de
  um modal que ele não abriu. Registrado como opção **recusada**, não esquecida.
- **Duas saídas explícitas**, ambas ≥44px, ambas com rótulo em palavra (nunca só o ✕): o cliente que
  não quer promoção tem um botão que diz o que ele quer fazer.
- Imagens via `fotoSegura` + `unoptimized` (padrão da vitrine); produto sem foto usa o mesmo
  gradiente-placeholder do `CardProduto`, nunca um quadrado vazio.
- A barra fixa do carrinho (`VitrineClient`, `z-40`) fica **atrás** do backdrop do `Dialog` (`z-50`).
  Nada de dois elementos flutuantes competindo pelo polegar.

### 5.5 Estado vazio — "nunca abre"

Não existe estado vazio visível. Existem **três negativas**, todas resolvidas antes de qualquer pixel:

| Condição | Onde é decidida | O que o cliente vê |
|---|---|---|
| lojista desligou o modal | SSR (`loja.modal_promocoes`) | nada. Nenhum DOM. |
| nenhuma promoção ativa **neste request** | SSR (`promocoes.length === 0`) | nada, **mesmo com o toggle ligado** |
| já viu hoje neste dispositivo | cliente (`localStorage`, `try/catch`) | nada |

- `localStorage` falhando (aba privativa, storage bloqueado, cota) é engolido: leitura devolve `null`,
  escrita é ignorada. **Pior caso: o modal reabre.** Nunca uma exceção, nunca vitrine em branco
  (RN-18).
- Chave por slug (`irango:promo:<slug>`): um dispositivo visita várias lojas no mesmo dia e cada uma
  tem o seu "1× por dia".

### 5.6 Toggle do lojista

`/painel/configuracoes/perfil`, na mesma família de `whatsapp_envio_automatico`:

```
┌───────────────────────────────────────────────┐
│ [Switch●] Mostrar promoções ao abrir a loja   │
│           Na primeira visita do dia, o cliente│
│           vê um aviso com os pratos em        │
│           promoção. Se não houver promoção    │
│           ativa, nada aparece.                │
└───────────────────────────────────────────────┘
```

A segunda frase da ajuda é obrigatória: sem ela o lojista liga o toggle, não vê modal nenhum (porque
não tem promoção ativa) e abre chamado. `aria-describedby` liga a ajuda ao `Switch`.

---

## 6. Checkout — os três estados do cupom (D5, D9, RN-10-e)

⚠️ **A copy está fixada no Spec A, RN-10-e. Transcrita abaixo, não reescrita.** O que este documento
decide é: onde cada estado aparece, o que é anunciado, o detalhamento opcional e os tokens.

### 6.1 O estado vem decidido do servidor (M4)

O componente **não** compara `baseElegivel` com `subtotal`. Isso é reimplementar a regra monetária no
browser — e é o tipo de reimplementação que D5-b existe para proibir.

```ts
// Retorno de revisarCarrinhoAction — union DISCRIMINADA
export type EstadoCupom =
  | { estado: "cheio";   codigo: string; desconto: number }
  | { estado: "parcial"; codigo: string; desconto: number; baseElegivel: number }
  | { estado: "zero";    codigo: string };
```

Repare no que a união dá de graça: **no estado `zero` não existe o campo `desconto`**. Não há como
renderizar "Desconto R$ 0,00" por acidente — o número não está lá. E no estado `cheio` não existe
`baseElegivel`, então a frase explicativa não tem de onde sair.

### 6.2 A copy, em módulo puro (M5)

```ts
// lib/utils/copiaCupom.ts — PURA, sem React, sem DOM. Testável byte a byte
// em environment: node, exatamente como lib/utils/alcance-do-grupo.ts.
export function rotuloLinhaCupom(e: EstadoCupom): string
export function valorLinhaCupom(e: EstadoCupom): string | null   // null ⇒ sem linha de valor
export function fraseCupom(e: EstadoCupom): string | null        // null ⇒ sem frase
```

As três saídas, **literais de RN-10-e**:

| Estado | Linha | Frase |
|---|---|---|
| **A — cheio** | `Cupom PROMO10` · `− R$ 14,00` | `null` — **sem frase**. Nada a explicar. |
| **B — parcial** | `Cupom PROMO10` · `− R$ 6,00` | *"Não acumula com promoção: o desconto valeu sobre R$ 60,00 do pedido — o que não está em promoção, adicionais incluídos."* |
| **C — zero** | `Cupom PROMO10 aplicado` · **sem valor** | *"Cupom PROMO10 aplicado. Sem desconto neste pedido: não há nada fora da promoção para descontar — cupom não acumula com promoção."* |

> **Por que a copy tem de sair daqui e não do JSX:** neste repo não há jsdom. Uma frase dentro de um
> `.tsx` não tem como ser afirmada por teste; uma frase devolvida por função pura tem. É a única
> defesa possível contra a redação ser "melhorada" numa revisão futura — e RN-10-e diz textualmente
> que a linha secundária do estado B **não é opcional**.

### 6.3 Layout no `ResumoValores` (mobile primeiro)

```
360px · dentro da coluna do wizard

  Subtotal                                 R$ 140,00
  Você economizou                        − R$  20,00   ← desconto de PRODUTO (§12 item 2)
  ───────────────────────────────────────────────────
  Cupom PROMO10                          − R$   6,00
   ↳ Não acumula com promoção: o desconto valeu
     sobre R$ 60,00 do pedido — o que não está em
     promoção, adicionais incluídos.
   ▸ Como calculamos                                   ← disclosure, FECHADO
  ───────────────────────────────────────────────────
  Entrega                                  R$   8,00
  ═══════════════════════════════════════════════════
  Total estimado                           R$ 142,00
  ┌─────────────────────────────────────────────────┐
  │ ⓘ Valores estimados. O total final é calculado  │  ← bloco que JÁ existe
  │   e confirmado pela loja no servidor.           │     (ResumoValores.tsx:73-84)
  └─────────────────────────────────────────────────┘
```

Estado **C** (zero):

```
  Subtotal                                 R$  80,00
  Você economizou                        − R$  20,00
  ───────────────────────────────────────────────────
  Cupom PROMO10 aplicado                              ← sem coluna de valor
   ↳ Cupom PROMO10 aplicado. Sem desconto neste
     pedido: não há nada fora da promoção para
     descontar — cupom não acumula com promoção.
   [ Remover cupom ]                                  ← 44×44, continua existindo
```

Tokens e hierarquia:

- Valor do desconto: `font-bold text-[#166534]` — é o que `ResumoValores.tsx:47` já usa. Vira
  `text-promo-texto` (§2), mesmo hex, agora nomeado.
- A frase: `text-xs text-texto-muted`, recuada, **abaixo** da linha e ligada a ela por
  `aria-describedby`. Nunca um tooltip, nunca um `title`, nunca um ícone "?" — no celular nada disso
  existe.
- **A frase é texto no fluxo.** Não é amarela, não tem ícone de alerta, não é um `role="alert"`. Não é
  um problema: é uma condição do cupom, dita uma vez, onde o número aparece (RN-10-e).
- O bloco do cupom (linha + frase) fica em `role="status" aria-live="polite"` — **só ele**, nunca o
  resumo inteiro: com o resumo todo em live region, cada `+`/`−` de quantidade reanuncia quatro
  valores e o leitor de tela vira ruído.
- "Remover cupom" continua disponível nos três estados (reversibilidade, design-system §6).

### 6.4 "Como calculamos" — a decisão que RN-10-e delegou

**Decisão: ADOTAR, com três limites.**

```
   ▾ Como calculamos
     Itens fora da promoção                 R$ 50,00
     + Adicionais                           R$ 10,00
     ─────────────────────────────────────────────
     = O cupom valeu sobre                  R$ 60,00
```

1. **Só no estado B.** No A não há o que explicar; no C não há números para somar.
2. **Fechado por padrão**, `<button aria-expanded aria-controls>` de 44px + região revelada. A vitrine
   é mobile-first e o resumo já é denso (design-system §1). Não é `Accordion` do shadcn: um
   disclosure de uma linha dentro de um resumo financeiro não justifica o chrome do primitivo.
3. **Só existe se o servidor mandar os dois números.** Ver §12, item 3. Se o Spec A recusar a
   ampliação de contrato, **o disclosure é removido do desenho** — ele **não** é calculado no cliente,
   em nenhuma hipótese. A frase obrigatória do estado B sobrevive sozinha.

Por que vale a pena: o cliente vê 10% de um pedido de R$ 140,00 virar R$ 6,00. A frase diz "sobre
R$ 60,00", mas é justamente a parcela **"adicionais incluídos"** que ele erraria se tentasse conferir
sozinho (ele presumiria que a linha inteira da pizza ficou de fora). O detalhamento é o lugar onde
R$ 50,00 + R$ 10,00 fica visível — e é conferível somando o que não tem selo de promoção no carrinho.

> **"Base elegível" é proibido na vitrine.** É vocabulário do spec e do código. Nenhuma string de
> `copiaCupom.ts` contém essa expressão — e, como o módulo é puro, isso é afirmável por teste.
> Por isso a última linha do detalhamento é **"O cupom valeu sobre"**, não "Base do cupom".

### 6.5 O que muda em `EtapaItens`

- `validarCupomAction(lojaId, cod, subtotal)` (`EtapaItens.tsx:85`) **some**: o cliente deixa de
  mandar número monetário (RN-11). A UI passa a chamar `revisarCarrinhoAction` com
  `produto_id`/`quantidade`/`opcionais` e recebe `EstadoCupom` + os totais.
- Estados de feedback do campo de cupom, todos já previstos pelo design-system §6: `Loader2` no botão
  durante a `useTransition` (já existe), `toast` de erro só para falha de **rede**, e mensagem inline
  `aria-live` para o veredito do cupom (já existe como `mensagemCupom`).
- **Cupom recusado por pedido mínimo** continua sendo recusa, com a régua no **subtotal** (D5-a) — não
  é um quarto estado, é o caminho `valido: false` que já existe.

---

## 7. Reconfirmação de preço (D11)

Dois sentidos, dois desenhos opostos. O que os une é a regra de copy:

> 🔴 **Nenhum dos dois usa linguagem de erro.** Sem "erro", "falha", "desculpe", "não foi possível",
> sem ícone de alerta, sem vermelho, sem `role="alert"`. A promoção acabou porque o lojista marcou uma
> data — não é culpa do cliente e não é defeito do sistema. O precedente do projeto é
> `ModalFreteIndisponivel`, cujo cabeçalho diz literalmente: *"O que ele NUNCA faz: dizer que o
> endereço do cliente é o problema quando a causa é o nosso serviço"*. Mesmo princípio, mesma forma
> de módulo de textos.

```ts
// lib/utils/copiaRevisaoPreco.ts — PURA (M5), mesma forma de ModalFreteIndisponivel.textos()
export function textosRevisao(d: { direcao: "subiu" | "caiu"; itens: MudancaItem[]; novoTotal: number })
  : { titulo: string; corpo: string; rotuloCta: string | null }
```

### 7.1 Preço SUBIU — bloqueia, exige segundo clique

```
360px · Dialog centralizado · neutro, NÃO amarelo, NÃO vermelho

┌───────────────────────────────────────────────┐
│  O preço de um item mudou               [ ✕ ] │
├───────────────────────────────────────────────┤
│  A promoção da Feijoada completa terminou.    │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │ Feijoada completa                       │  │
│  │ de  R$ 80,00   →   R$ 100,00            │  │ ← de/para por item
│  └─────────────────────────────────────────┘  │
│                                               │
│  Novo total estimado                R$ 150,00 │ ← destacado
│                                               │
│  [ Confirmar e enviar — R$ 150,00 ]           │ ← primário, 52px
│  [ Voltar ao carrinho ]                       │ ← secundário, 44px
└───────────────────────────────────────────────┘
```

**Por que o número vai dentro do rótulo do botão.** "Segundo clique explícito" (D11) só significa
alguma coisa se o segundo clique for *sobre o número novo*. Um botão genérico "Confirmar" transforma
a reconfirmação em mais um passo a atravessar; `Confirmar e enviar — R$ 150,00` é o valor que a pessoa
está aceitando, no lugar onde o dedo encosta.

**Tokens (neutro, sem cor de estado):** `border-borda-nav`, `bg-cinza-claro`, `text-texto`; o
de/para usa `--texto-muted` no valor antigo (com `<s>`) e `--texto` no novo; o "Novo total estimado"
usa `--cor-destaque`, que é onde o tema da loja legitimamente entra (é preço, não estado). O ✕ e os
dois botões: 44px. **Nenhuma cor de sistema** — porque não é um estado de sistema.

**Acessibilidade:** é um `Dialog` (foco preso, ESC, clique-fora — design-system §5). `DialogTitle` =
"O preço de um item mudou". A lista de/para é uma `<ul>`, cada item com `sr-only` explicando o par
("Feijoada completa: de R$ 80,00 por R$ 100,00"), pelo mesmo motivo de §3.1 — `<s>` sozinho não
comunica.

**Reversibilidade:** ESC e ✕ **não enviam nada**. Eles voltam ao carrinho, com os preços já
atualizados na tela. Fechar nunca é sinônimo de confirmar.

**M9 — as três travas que impedem o envio silencioso:**

1. **O CTA original sai do DOM.** Enquanto a reconfirmação está aberta, o botão "Finalizar pedido" do
   wizard é **removido**, não `disabled`. Um botão desabilitado depende de um booleano que um
   `setState` fora de ordem reabilita; um botão ausente não tem como ser clicado.
2. **O gate entra em `podeConfirmar`** (`components/vitrine/checkout/estado.ts`), que é função pura,
   já testada, e que o design-system §9 declara obrigatória: *"Toda UI que controla o submit do
   checkout deve consultar `podeConfirmar` — nunca reimplementar a lógica no componente."* A condição
   nova (`revisaoConfirmada`) entra **lá**, uma vez, e cobre mobile e desktop de uma vez — que hoje
   são duas árvores diferentes (`variante: "wizard" | "desktop"`).
3. **O envio carrega um token de revisão do servidor** (§12, item 4). Se o componente esquecer de
   pedir o segundo clique, o servidor recusa por token ausente/vencido. Assim a proteção deixa de
   depender de disciplina de componente — que é o que a **exigência 5** manda fazer sempre que não há
   como testar o DOM.

### 7.2 Preço CAIU — só avisa, o pedido segue

Sem modal. Sem botão. Uma faixa no topo do resumo:

```
┌───────────────────────────────────────────────┐
│ Boa notícia: a Feijoada completa entrou em    │
│ promoção. De R$ 100,00 por R$ 80,00.          │
│ Novo total estimado: R$ 130,00.               │
└───────────────────────────────────────────────┘
```

- `role="status" aria-live="polite"` — anunciado sem interromper, e sem roubar o foco.
- Tom: **`--promo-fundo` / `--promo-texto` / `--promo-borda`** (§2). É o mesmo verde do selo de
  promoção, e aqui a semântica bate exatamente: *isto é uma promoção, a seu favor*.
- **Não bloqueia, não confirma, não pede nada.** D11: travar um pedido para confirmar um desconto que
  o cliente não pediu é atrito sem contrapartida.
- Persiste na tela até o envio (não é toast). Um toast de 4 segundos sobre uma mudança de preço é
  informação que some antes de ser lida.

### 7.3 A segunda janela (segundos), que a UI não fecha

Entre a revisão e o `INSERT` ainda existe uma janela de segundos que nenhuma tela fecha (RN-12). O
desenho aceita isso e resolve na tela seguinte: **a confirmação do pedido é a tela autoritativa**.
Ela mostra o que foi cobrado, por item, com o par de/por quando houve promoção — e **sem pop-up de
desculpa e sem linguagem de erro**. O valor exibido ali é o valor.

---

## 8. Painel — configurar desconto por produto (D1) e o erro do D10

### 8.1 O bloco "Promoção" no `FormProduto`

Entra depois de "Preço", **antes** de "Categoria" — adjacência importa: o desconto é uma propriedade
do preço, e o erro do D10 fala dos dois ao mesmo tempo.

```
360px · dentro do Sheet (mobile) / Dialog (desktop) de /painel/produtos

  Preço (R$)
  [ 100,00                                     ]

  ┌─ Promoção ─────────────────────────────────┐
  │ [Switch●]  Produto em promoção             │  ← ui/switch
  │                                            │
  │ Tipo de desconto                           │
  │  ( ) Percentual      (•) Valor em reais    │  ← ui/radio-group, itens 44px
  │                                            │
  │ Valor do desconto                          │
  │  R$ [ 10,00 ]                              │  ← inputMode="decimal"
  │                                            │
  │ ┌────────────────────────────────────────┐ │
  │ │ Na vitrine:  de R$ 100,00 por R$ 90,00 │ │  ← prévia, aria-live="polite"
  │ └────────────────────────────────────────┘ │
  │                                            │
  │ [✓] Definir um prazo (opcional)            │  ← ui/checkbox
  │     Começa em  [19/09/2026] [11:00]        │
  │     Termina em [30/09/2026] [23:59]        │
  │     Horários no fuso da loja:              │
  │     America/Sao_Paulo (GMT-3)              │
  │                                            │
  │ Sem prazo, a promoção vale até você        │
  │ desligar.                                  │
  └────────────────────────────────────────────┘
```

Decisões e por quês:

- **`Switch`, não `Checkbox`, para ligar/desligar.** É um estado que vale agora, não uma escolha de
  formulário — mesma família de `whatsapp_envio_automatico`. `Checkbox` fica para "Definir um prazo",
  que é uma escolha sobre o que o formulário contém.
- **`RadioGroup` para percentual × reais, não `Select`.** Duas opções, ambas sempre visíveis, zero
  cliques de abertura, dois alvos de 44px — e `Select` do shadcn nem existe em `components/ui/`.
- 🔴 **Desligar NÃO esconde os campos.** RN-07: desligar preserva tipo, valor e prazo. Se os campos
  sumissem, o lojista concluiria que a configuração foi apagada e redigitaria tudo na próxima vez. Com
  o `Switch` desligado os campos ficam visíveis, `disabled` e em `opacity-60`, com a linha
  *"Promoção desligada. Os valores ficam salvos para quando você ligar de novo."*
- **A prévia usa `precoEfetivo()`** — a mesma função pura do servidor (isomórfica, como
  `calcularFrete`). Nunca uma segunda fórmula. Fica em `aria-live="polite"` para quem não enxerga o
  número mudando.
- 🔴 **Data e hora em campos separados (`type="date"` + `type="time"`), não `datetime-local`.** Dois
  motivos: (a) o `datetime-local` se apresenta ao usuário como horário **do dispositivo**, e não existe
  lugar dentro do widget para dizer "isto é no fuso da loja"; (b) os dois campos separados dão dois
  alvos de 44px em vez de um controle apertado. A linha de fuso é **obrigatória e adjacente** — esta
  é uma divergência deliberada da nota de componente do Spec A (que disse "dois `datetime-local`");
  o valor persistido continua sendo o mesmo `timestamptz`, então não é mudança de contrato.
- Sem prazo é o **default**: o checkbox nasce desmarcado (D1, "com prazo opcional").

### 8.2 O erro do D10 — a mensagem

**Cenário literal:** produto de R$ 50,00 com desconto fixo de R$ 10,00; o lojista muda o preço para
R$ 8,00 e salva. **A gravação é recusada.**

```
┌────────────────────────────────────────────────┐
│  Não dá para salvar                            │
│                                                │
│  O preço novo (R$ 8,00) é menor que o desconto │
│  configurado (R$ 10,00). O preço na vitrine    │
│  ficaria negativo.                             │
│                                                │
│  Você pode:                                    │
│  [ Reduzir o desconto para R$ 8,00 ]           │
│  [ Desligar a promoção deste produto ]         │
└────────────────────────────────────────────────┘
```

A frase, literal, montada por função pura (M7):

> **Não dá para salvar: o preço novo (R$ 8,00) é menor que o desconto configurado (R$ 10,00). Reduza o
> desconto para no máximo R$ 8,00 ou desligue a promoção deste produto.**

Ela nomeia **os dois números** e **as duas saídas**, como D10 exige.

```ts
// lib/validacoes/produto.ts — exportada, consumida pelo superRefine do schemaProduto
export function mensagemDescontoMaiorQuePreco(preco: number, desconto: number): string {
  return `Não dá para salvar: o preço novo (${formatarMoeda(preco)}) é menor que o desconto ` +
    `configurado (${formatarMoeda(desconto)}). Reduza o desconto para no máximo ` +
    `${formatarMoeda(preco)} ou desligue a promoção deste produto.`;
}
```

**M7 — por que a mensagem vive no zod e não no componente:** `schemaProduto` já é isomórfico (o
`FormProduto` faz `safeParse` e a Server Action revalida o mesmo schema — `FormProduto.tsx:118`,
`admin-produtos.ts:56,94`). Colocando a mensagem no `superRefine`, **form, Server Action do lojista e
Server Action do admin recebem exatamente o mesmo texto**, sem que ninguém tenha de lembrar de
sincronizar três strings. E, sendo uma função pura exportada, o texto é afirmável por teste em
`environment: node` — a única forma de travar copy neste repo.

### 8.3 Onde a mensagem aparece — e por que não é um toast

🔴 **`FormProduto` hoje joga todo erro de validação num toast genérico:**
`toast.error("Confira os dados do produto.")` (`FormProduto.tsx:120`). Para o D10 isso é inaceitável:
a mensagem tem dois números e duas saídas, some em 4 segundos, não é re-legível, não aponta campo
nenhum e não é lida por leitor de tela de forma associada ao input.

**Desenho mínimo (sem migrar o form para react-hook-form, o que está fora de escopo):**

1. Estado `erros: Record<string, string>` alimentado por `parsed.error.issues`
   (`issue.path[0]` → `issue.message`).
2. O erro do D10 aparece num bloco **entre o campo Preço e o bloco Promoção** — os dois campos que ele
   cita. `role="alert"`, `tabIndex={-1}`, e o foco vai para ele no submit falho.
3. **`aria-invalid="true"` nos DOIS inputs** (`#produto-preco` e `#produto-desconto-valor`), ambos com
   `aria-describedby` apontando para o mesmo id do bloco. É um erro de par, não de campo.
4. **As duas saídas são botões, não conselho.** `Reduzir o desconto para R$ 8,00` preenche o campo de
   desconto; `Desligar a promoção deste produto` desliga o `Switch`. **Nenhum dos dois salva** — o
   lojista ainda precisa clicar em "Salvar alterações". D10 diz que *o sistema não ajusta dinheiro
   sozinho*; aqui quem ajusta é o lojista, escolhendo uma das duas saídas que a própria mensagem
   nomeia, e confirmando depois.
   > **Alternativa se o dono do produto achar que até isso é automático demais:** os dois botões viram
   > texto puro e a mensagem não muda em nada. O desenho não depende deles — depende da mensagem.
5. O toast continua, mas **só para falha de rede/servidor** (`resultado.ok === false` por erro
   genérico, `seguranca.md` §14 — detalhe no log, mensagem genérica na UI).

### 8.4 Promoção ativa na lista de produtos

Na linha do produto (`ProdutosClient.tsx:600-611`), ao lado do `badgeStatus(p)` que já existe:

```
  ┌───┐  Feijoada completa
  │img│  R$ 100,00  → R$ 80,00   [Disponível] [-20% até 30/09]
  └───┘
```

- O chip de promoção usa o **mesmo `Badge`** do painel (não o `SeloVitrine`, que é da vitrine e carrega
  cores de sistema pensadas para foto). `variant="secondary"` + `text-promo-texto`.
- O rótulo inclui o fim do prazo quando existe (`-20% até 30/09`) e não inclui quando não existe
  (`-20%`). É a informação que o lojista procura ao abrir a tela: *"ainda está valendo?"*.
- 🔴 **`promocaoVigente` e o rótulo são projetados no Server Component da página**, não derivados no
  `ProdutosClient`. Calcular "está vigente agora" no browser duplicaria RN-03 e usaria o relógio do
  dispositivo. Não é campo novo de banco — é exigência de projeção (§12, item 5).

---

## 9. Painel — o form dos dois modos de vigência (D3)

🔴 **É a peça central deste documento.** As outras telas mostram um número ou um selo; esta pede que o
lojista **descreva um calendário** e depois confie no que descreveu. Se ele tiver de simular
mentalmente "então numa terça-feira de fevereiro…", a tela falhou — e o custo do erro não aparece no
painel, aparece na vitrine, num dia em que o cardápio não apareceu.

**A tese do desenho:** o lojista não lê configuração, lê **frase**. Cada controle existe para produzir
uma frase em português que ele confere num olhar. A configuração é o meio; a frase é a interface.

### 9.1 Escolha do modo

```
360px · /painel/cardapios/[id]

  ┌─ Quando este cardápio aparece ────────────────┐
  │                                               │
  │  (•) Repete sempre                            │  ← RadioGroup, cada item
  │      Volta toda semana ou todo mês, até        │     é um Card de 2 linhas,
  │      você desligar.                           │     alvo ≥ 44px
  │                                               │
  │  ( ) Período com data de fim                  │
  │      Aparece uma vez, de uma data até outra,  │
  │      e some sozinho no fim.                   │
  │                                               │
  │  Ao salvar, vale só o modo selecionado.       │
  └───────────────────────────────────────────────┘
```

- **`RadioGroup`, não `Tabs`.** Isto é uma escolha que fica gravada, não uma navegação entre vistas.
  (E `Tabs` não existe em `components/ui/` — design-system §3 registra que `OpcionaisClient` rolou a
  própria `tablist` por falta de decisão, e este não é o lugar para repetir isso.)
- **A descrição está dentro do rótulo**, não num tooltip. "recorrente" e "prazo fixo" são vocabulário
  do spec; o lojista lê "repete sempre" e "período com data de fim".
- **Trocar de modo não apaga o que foi digitado** enquanto o form está aberto — os dois conjuntos de
  campos vivem no estado do form. Só o modo selecionado é persistido, e a linha
  *"Ao salvar, vale só o modo selecionado"* diz isso antes de o lojista descobrir sozinho. (Não se
  inventa persistência dos dois: o banco guarda um.)

### 9.2 Modo A — Repete sempre

Três dimensões, todas **opcionais**, que compõem a janela (D3: "dias da semana, e/ou dias do mês,
e/ou faixa de horário diária").

```
  ┌─ Dias da semana ──────────────── opcional ───┐
  │  [ Dom ] [ Seg ] [ Ter ] [ Qua ]             │  ← grid-cols-4 sm:grid-cols-7
  │  [ Qui ] [ Sex ] [■Sáb] [■Dom* ]             │     cada célula min-h-[44px]
  │                                              │     toggle com aria-pressed
  │  Nenhum dia marcado = todos os dias.         │
  └──────────────────────────────────────────────┘

  ┌─ Dias do mês ─────────────────── opcional ───┐
  │  [ + Escolher dias do mês ]                  │  ← fechado por padrão
  │                                              │
  │  (aberto:)                                   │
  │   1  2  3  4  5  6  7                        │  ← grid-cols-7, 44px de altura
  │   8  9 10 11 12 13 14                        │
  │  …                                           │
  │  29 30 31                                    │
  │  [ Último dia do mês ]                       │
  └──────────────────────────────────────────────┘

  ┌─ Horário do dia ──────────────── opcional ───┐
  │  [Switch ] Só em um horário do dia           │
  │            Das [11:00] às [15:00]            │
  │            Fuso da loja: America/Sao_Paulo   │
  └──────────────────────────────────────────────┘
```

- **Dias da semana em `grid-cols-4`, não numa fila de 7.** Sete alvos de 44px + gaps somam ~332px e
  não cabem nos 328px úteis de uma tela de 360px com gutter de 16px. Duas linhas de quatro cabem com
  folga e continuam na régua. A partir de `sm`, sete colunas.
- **Dias do mês fechado por padrão.** É a dimensão menos usada ("todo dia 1 e 15") e uma grade de 31
  células sempre aberta esmaga tudo o mais na tela.
- **Toggles, não checkboxes,** nos dias: `<button aria-pressed>` dentro de um `role="group"` com
  `aria-label`. Um checkbox de 16px com rótulo ao lado não dá alvo de 44px numa grade dessas sem
  duplicar a altura.
- **"Nenhum dia marcado = todos os dias"** é dito **antes**, não descoberto depois. É a pergunta que o
  lojista faz na primeira vez que abre a tela.
- 🔴 **Dias da semana + dias do mês ao mesmo tempo:** ver §13, **buraco 1**. D3 diz "e/ou" e não
  define se as duas dimensões se combinam por E ou por OU. A UI **não decide isso sozinha** — ela
  **expõe** o resultado na frase de prévia e mostra um aviso não-bloqueante quando as duas estão
  preenchidas.

### 9.3 Modo B — Período com data de fim

```
  ┌─ Duração ────────────────────────────────────┐
  │  [ Hoje ]  [ 7 dias ]  [ 30 dias ]           │  ← chips 44px, aria-pressed
  │  [ Escolher as datas ]                       │
  └──────────────────────────────────────────────┘

  Começa em   [ 19/09/2026 ]  [ 11:00 ]
  Termina em  [ 26/09/2026 ]  [ 11:00 ]
  Fuso da loja: America/Sao_Paulo (GMT-3)
```

- **Presets preenchem os campos e não os travam.** Um preset é um atalho, não um modo — depois de
  clicar em "7 dias" o lojista ainda pode mexer na hora do fim. Ao aplicar um preset, o foco vai para
  o campo **"Termina em"**, para que a mudança seja vista onde ela aconteceu.
- Os chips carregam `aria-pressed`; editar uma data à mão desmarca todos (vira "Escolher as datas").
- **Mesma decisão de `type="date"` + `type="time"` de §8.1**, pelo mesmo motivo de fuso.
- Data de início no passado é permitida (o lojista lança um cardápio "desde ontem") — mas a prévia
  diz `Está aparecendo desde 18/09`.

### 9.4 A prévia em linguagem natural — o núcleo da tela

```
  ┌─ Prévia ─────────────────────────────────────┐
  │                                              │
  │  Aparece todo sábado e domingo,              │  ← 16px, peso alto
  │  das 11:00 às 15:00.                         │
  │                                              │
  │  Fuso da loja: America/Sao_Paulo             │  ← 12px, --texto-muted
  │                                              │
  │  ─────────────────────────────────────────   │
  │  Agora (sáb, 19/09, 13:04): APARECENDO       │  ← só para o que está SALVO
  └──────────────────────────────────────────────┘
```

Quatro decisões:

1. **A frase é a prévia.** Não um mini-calendário, não uma lista de próximas ocorrências. Um
   calendário obriga o lojista a conferir célula por célula; uma frase ele lê e reconhece — ou não
   reconhece, e é aí que ele corrige.
2. **`aria-live="polite"` com debounce de ~400ms.** Sem debounce, cada clique num dia reanuncia a
   frase inteira e o leitor de tela fica ininterrupto. Com ele, o lojista cego tem a mesma prévia que
   o vidente.
3. 🔴 **A linha "Agora:" só aparece para a configuração SALVA.** Ela é derivada do servidor, no
   instante do request — não do relógio do dispositivo. Enquanto o lojista edita, a prévia mostra só a
   frase; salvou, a linha "Agora:" volta com a verdade do servidor. Um "está aparecendo agora"
   calculado no browser mentiria em qualquer dispositivo com relógio adiantado, e é exatamente o tipo
   de número que não se calcula no cliente.
4. **O fuso é nomeado, sempre.** `lojas.timezone` em texto, não escondido num ícone.

### 9.5 `descreverVigencia.ts` — um módulo, duas saídas (M6)

```ts
// lib/utils/descreverVigencia.ts — PURA, node-testável.
// Reusa partesNoFuso / fusoLoja.ts (extraído de lojaAberta.ts pelo Spec A, RN-03).
// NÃO duplica aritmética de fuso — mandato 2.

/** Frase longa, para a prévia do PAINEL.
 *  "Aparece todo sábado e domingo, das 11:00 às 15:00." */
export function descreverVigencia(v: Vigencia, timezone: string): string;

/** Rótulo CURTO (≤32 caracteres), para o selo da VITRINE (§4.3).
 *  "Só aos sábados e domingos" */
export function rotuloVoltaQuando(v: Vigencia, timezone: string): string;
```

🔴 **Por que as duas frases têm de sair do mesmo módulo.** O lojista configura no painel e o cliente lê
na vitrine. Se as duas frases forem escritas em componentes diferentes, elas divergem — o lojista
configura "sáb e dom" e o cliente lê "fim de semana", ou pior, lê o dia errado por um off-by-one de
índice de dia da semana. Nenhum teste deste repo pegaria isso: seriam duas strings em dois `.tsx`.
Com um módulo puro, as duas saídas nascem da mesma tabela de nomes de dia e do mesmo
`partesNoFuso` — e a tabela é afirmável por teste em `environment: node`.

Tabela de redações (contrato de copy do módulo):

| Configuração | `descreverVigencia` (painel) | `rotuloVoltaQuando` (vitrine, ≤32) |
|---|---|---|
| sáb+dom | `Aparece todo sábado e domingo.` | `Só aos sábados e domingos` |
| sáb+dom, 11–15 | `Aparece todo sábado e domingo, das 11:00 às 15:00.` | `Sáb e dom, 11:00–15:00` |
| seg a sex, 11–15 | `Aparece de segunda a sexta, das 11:00 às 15:00.` | `Seg a sex, 11:00–15:00` |
| dias 1 e 15 | `Aparece todo dia 1 e dia 15 do mês.` | `Só nos dias 1 e 15` |
| último dia do mês | `Aparece no último dia de cada mês.` | `Só no último dia do mês` |
| só horário | `Aparece todo dia, das 11:00 às 15:00.` | `Só das 11:00 às 15:00` |
| nenhuma dimensão | `Aparece sempre — este cardápio não tem janela.` ⚠️ | — |
| prazo fixo futuro | `Aparece de 22/09, 11:00 até 29/09, 11:00.` | `A partir de 22/09` |
| prazo fixo em curso | `Está aparecendo desde 18/09 e some em 29/09, às 11:00.` | — |
| prazo fixo encerrado | `Terminou em 29/09. Este cardápio não aparece mais.` | ver §13, buraco 4 |

### 9.6 Validação do form (o que bloqueia o salvar)

| Situação | Tratamento |
|---|---|
| Modo A com **nenhuma** das três dimensões preenchida | **bloqueia**, com a mensagem: *"Escolha pelo menos um dia da semana, um dia do mês ou um horário. Sem nada marcado, este cardápio aparece sempre e não é sazonal."* — marcado como **recomendação de desenho pendente de confirmação no Spec B** (§13, buraco 2) |
| Modo A com dias da semana **e** dias do mês | **não bloqueia.** Aviso não-bloqueante sob a prévia, nomeando o resultado da regra que o Spec B fixar (§13, buraco 1) |
| Horário `fim <= início` (ex.: 22:00 → 02:00) | ver §13, **buraco 3** — `lojaAberta` não trata virada de meia-noite hoje. Enquanto a regra não existir: **bloqueia**, com *"O horário de fim precisa ser depois do de início."* |
| Modo B com `fim <= início` | **bloqueia**: *"A data de fim precisa ser depois da de início."* (espelha o CHECK `produtos_desconto_prazo_check` do Spec A) |
| Dia 31 escolhido em mês de 30 dias | ver §13, **buraco 5** |

Toda mensagem: `aria-invalid` + `aria-describedby` no controle, bloco com `role="alert"`, foco no
bloco ao falhar o submit — o mesmo padrão de §8.3, uma vez, em toda tela nova deste trabalho.

---

## 10. Painel — ação em lote (D2)

> *"Uma ação em lote que afeta 40 produtos por engano é cara de desfazer."* O desenho ataca isso em
> três pontos: **a seleção é um modo**, **o alcance vem do servidor** e **o número vai dentro do botão
> de confirmar**.

### 10.1 Seleção é um MODO, não chrome permanente

```
/painel/produtos — cabeçalho

  [ Selecionar ]  [ Categorias ]  [ + Novo produto ]
```

Clicando em "Selecionar", a tela entra em modo seleção. **Por que um modo e não checkboxes sempre
visíveis:** design-system §5 já documenta o custo — quando a linha ganha um prefixo (checkbox), *"o
chrome soma ~44px a mais e sobra pouco espaço pro nome em 360px"*, e a saída registrada é a prop
`compacta` (esconder as setas abaixo de `sm`, mover comandos para o kebab). O precedente do projeto
para "modo temporário com barra de ação" é `ModoReordenar`. Reuso de padrão, não padrão novo.

```
  MODO SELEÇÃO — 360px

  ┌─ Pizzas ──────────────────── 12 produtos ─┐
  │  [ Selecionar os 12 ]  [ Limpar ]         │  ← botões no header da categoria
  ├───────────────────────────────────────────┤
  │  [✓] ┌───┐ Margherita                     │
  │      │img│ R$ 45,00  [Disponível]         │
  │      └───┘                                │
  │  [ ] ┌───┐ Calabresa                      │
  │      │img│ R$ 42,00  [Disponível]         │
  └───────────────────────────────────────────┘

  ┌───────────────────────────────────────────┐  ← barra fixa no rodapé,
  │  12 produtos selecionados       [Limpar]  │     mesma forma da barra do
  │  [ Adicionar ao cardápio… ]  [ Cancelar ] │     carrinho (VitrineClient)
  └───────────────────────────────────────────┘
```

- **Seleção por categoria inteira é um par de botões (`Selecionar os 12` / `Limpar`), não um checkbox
  tri-estado.** Motivo concreto: o `Checkbox` gerado (`components/ui/checkbox.tsx`) renderiza um
  `CheckIcon` fixo dentro do `Indicator`; um estado "mixed" mostraria um ✓ — e corrigir isso exigiria
  **editar um arquivo gerado pelo shadcn CLI**, o que o mandato 2 e o design-system §1 proíbem.
  Dois botões com o número escrito são mais legíveis no celular e não têm estado intermediário
  para interpretar errado.
- A barra fixa repete a forma da barra de carrinho da vitrine (`fixed inset-x-0 bottom-0`, altura
  ≥64px, contagem à esquerda, ações à direita): é o padrão que o projeto já tem para "há algo
  pendente, aqui está a saída".
- `aria-live="polite"` na contagem: "12 produtos selecionados" é anunciado a cada mudança.
- Sair do modo (Cancelar ou ESC) **limpa a seleção** e devolve o foco ao botão "Selecionar".

### 10.2 A confirmação — alcance antes do clique (M8)

`AlertDialog` (a gerar pelo CLI — §Gate de reuso), **não** um `Dialog` comum: a ação muda o que a
vitrine mostra para todos os clientes.

```
┌───────────────────────────────────────────────┐
│  Adicionar ao cardápio “Almoço executivo”?    │
├───────────────────────────────────────────────┤
│  12 produtos vão passar a seguir a janela     │
│  deste cardápio:                              │
│    · Feijoada completa                        │
│    · Parmegiana de frango                     │
│    · Filé à cubana                            │
│    e mais 9        [ Ver todos ]              │
│                                               │
│  Este cardápio aparece todo sábado e domingo, │  ← descreverVigencia (M6)
│  das 11:00 às 15:00.                          │
│  Fora dessa janela, os 12 continuam           │
│  aparecendo na vitrine, marcados e sem botão  │
│  de compra.                                   │
│                                               │
│  São os 12 produtos de Pizzas de hoje.        │  ← ver §13, buraco 6
│  Produtos criados depois não entram sozinhos. │
│                                               │
│  [ Adicionar 12 produtos ]  [ Cancelar ]      │
└───────────────────────────────────────────────┘
```

**Cinco travas, por ordem de importância:**

1. 🔴 **O número vai DENTRO do rótulo do botão** — `Adicionar 12 produtos`, nunca "Confirmar". É o
   ponto onde o lojista percebe que selecionou a categoria errada, porque o número está sob o dedo.
   Mesma ideia do CTA da reconfirmação de preço (§7.1).
2. 🔴 **`previa` é prop obrigatória e vem do servidor** (M8). O diálogo não existe antes de a `prévia`
   chegar; enquanto ela está em voo, o botão do modo seleção mostra `Loader2` e o diálogo não abre.
   Contar no cliente contaria uma seleção que pode estar velha (outro dispositivo mexeu no catálogo)
   ou conter id de outra loja — e é o servidor, sob RLS, quem resolve os nomes.
3. **Nomear até 3 e contar o resto** — é a régua já estabelecida por `rotuloAlcance`
   (`lib/utils/alcance-do-grupo.ts`: nomear é mais concreto que contar, mas *"a partir de 3 nomes a
   frase estoura a linha em 360px"*). `[ Ver todos ]` abre a lista completa, rolável, dentro do mesmo
   diálogo.
4. **A consequência é dita em português, não deduzida.** "continuam aparecendo na vitrine, marcados e
   sem botão de compra" é D4 explicado para quem vai apertar o botão. Um lojista que acha que o
   produto vai *sumir* configura a loja errada.
5. **Reversibilidade sem pilha de undo.** Não há "desfazer" em v1 — não está no contrato. O que há é a
   **mesma ação ao contrário**: o mesmo modo seleção, com a ação `Remover do cardápio`, e o mesmo
   diálogo de alcance. Isso é dito na confirmação? Não — seria ruído. É garantido pela simetria da
   tela: a ação inversa está no mesmo menu, com o mesmo nome invertido.

```ts
// lib/utils/copiaLotePromocao.ts — PURA (M5), forma copiada de alcance-do-grupo.ts
export function perguntaLote(p: {
  acao: "adicionar" | "remover";
  nomeCardapio: string;
  nomes: readonly string[];   // nomes vindos do SERVIDOR
  total: number;              // contagem vinda do SERVIDOR
}): { titulo: string; corpo: string; rotuloConfirmar: string };
```

### 10.3 Desktop

Mesma árvore. A barra de ação deixa de ser `fixed` no rodapé e vira `sticky top` sob o cabeçalho da
página (onde o olho já está), e a lista de nomes do diálogo mostra 6 em vez de 3. Nenhuma tabela com
scroll horizontal aparece em nenhum breakpoint (design-system §9).

---

## 11. Painel e impressão — "de X por Y" (D7)

### 11.1 Uma regra, um helper (RN-14)

```ts
// lib/utils/linhaDePor.ts — PURA (M5). RN-14: "cinco superfícies, uma regra".
export function parDePor(item: { preco: number; preco_original: number | null; quantidade: number })
  : { teve: boolean; de: string; por: string; sufixo: string } | null;

export function textoDePor(item): string | null;   // variante de TEXTO PLANO (WhatsApp)
```

- `preco_original === null` ⇒ devolve `null` ⇒ **nada é renderizado**. Nenhuma superfície tem um `if`
  próprio sobre `preco_original` — a decisão mora no helper (M3, mesmo espírito do `rotulo: string |
  null` do `SeloVitrine`).
- 🔴 **O par é sempre o preço UNITÁRIO.** O total da linha nas quatro superfícies é
  `(item.preco + acréscimo dos opcionais) × quantidade` (`DetalhePedido.tsx:215-217`,
  `ReciboCliente.tsx:92-94`, `whatsappPedido.ts:80`, `confirmacao/page.tsx:173`) — um par de/para em
  cima desse número teria de decidir o que fazer com o acréscimo e com a quantidade, e seria
  aritmética monetária nova em cinco lugares. Unitário não decide nada: é literalmente
  `produtos.preco` e `precoEfetivo` como o banco gravou.
- Por isso o `sufixo`: com `quantidade > 1`, o par imprime `/un.` para que ninguém leia o preço de
  tabela como total da linha.

### 11.2 As superfícies

| Superfície | Tratamento | Arquivo |
|---|---|---|
| Confirmação do pedido (cliente) | `R$ 80,00` em `--texto`, `de R$ 100,00` em `--texto-muted`, `text-xs`, linha abaixo | `(publica)/loja/[slug]/confirmacao/page.tsx:164-175` |
| `DetalhePedido` (tela do painel) | idem, `text-muted-foreground` | `DetalhePedido.tsx:205-220` |
| `ReciboCliente` (térmica 80mm) | ver §11.3 | `ReciboCliente.tsx:82-95` |
| `whatsappPedido` (texto plano) | `- 1x Feijoada completa — R$ 80,00 (de R$ 100,00)` | `whatsappPedido.ts:79-83` |
| `ComandaCozinha` (térmica 80mm) | 🔴 **conflito com RN-P1 — ver §13, buraco 7** | `ComandaCozinha.tsx` |
| `paraLinhaPedido` / `TabelaPedidos` | **não muda** — ver §11.4 | `lib/utils/paraLinhaPedido.ts` |

**WhatsApp em texto plano:** parênteses, **não** `~tachado~`. A mensagem é montada com
`citarTextoCliente` e passa por `encodeURIComponent`; introduzir marcação do WhatsApp numa string que
também carrega texto livre do cliente é superfície nova sem ganho de leitura.

### 11.3 Papel térmico — o que muda quando não existe cinza

🔴 A via térmica **não tem cor**. `globals.css` força, sob `@media print`,
`html[data-print-variant="recibo"] .print-recibo * { color: #000 !important }` — justamente porque
`--muted-foreground` *"reprova em térmica"*. Então:

1. **A hierarquia do par não pode ser por cor.** Nada de cinza: no papel, cinza é preto.
   Ela é por **tamanho** (`text-xs` contra `text-sm`), **posição** (linha própria, abaixo) e
   **prefixo** (a palavra "de").
2. 🔴 **O tachado pode não imprimir.** `line-through` é um filete de ~1px; em cabeça térmica de 203dpi,
   com papel gasto ou impressão clara, ele desaparece — e "de R$ 100,00" sem tachado vira um segundo
   preço solto, que na bancada lê como cobrança dupla. **Por isso a palavra "de" é obrigatória e
   carrega o significado sozinha.** O tachado é reforço, nunca o portador da informação. Mesmo
   princípio de "não depender só de cor" (design-system §5), aplicado a não depender só de um filete.
3. **Largura de 80mm.** O par ocupa uma linha inteira própria, alinhada à esquerda sob o nome do item,
   e **nunca** disputa a mesma linha com o total (que já está alinhado à direita). Em 80mm com
   `font-size: 100%` sob print, `1× Feijoada completa` + `R$ 80,00` já ocupa a linha.

```
  via térmica do RECIBO (80mm)

  1× Feijoada completa              R$ 80,00
     de R$ 100,00
     + Borda recheada (1x)           R$ 10,00
     Obs: sem cebola

  1× Refrigerante                   R$ 50,00
  ────────────────────────────────────────────
  Subtotal                         R$ 140,00
```

4. **Zero impacto no Ctrl+P nativo.** Toda a mecânica de impressão é *keyed* por
   `html[data-print-variant]`, que só existe quando o `SeletorImprimirPedido` (server-gated por
   entitlement) o setou. O par de/por é markup comum dentro do bloco já existente — não introduz
   nenhuma regra `@media print` nova, portanto não toca o fail-closed documentado no `globals.css`.

### 11.4 Por que `paraLinhaPedido` não muda

`paraLinhaPedido` projeta `{ id, nome_cliente, total, status, criado_em }` para uma **linha de
tabela de pedidos** — um pedido por linha, sem itens. Um par de/para **por item** não tem onde caber
ali, e uma coluna "economia" agregada seria um número novo, no nível do pedido, que D7 não pede
(D7 fala de `itens_pedido.preco_original`). O Spec A chega à mesma conclusão: *"só muda se a lista
passar a mostrar economia (não é requisito de D7 — ver §Fora do Escopo)"*.

> **Divergência registrada:** o enunciado deste trabalho lista `paraLinhaPedido.ts` entre as cinco
> superfícies do D7; o Spec A o exclui. Seguimos o **Spec A**, que é a fonte de verdade aprovada, e
> deixamos a divergência à vista em vez de escolhê-la em silêncio.

---

## 12. Números que o desenho pede e que o servidor ainda não manda

> **Mandato 1 + exigência 6:** nenhum valor monetário é calculado no cliente. Cada item abaixo é
> **mudança de contrato** e volta para o spec — não se resolve no componente. Para cada um há uma
> **degradação declarada**: o que a UI faz se o contrato **não** for ampliado. Em nenhum caso a
> degradação é "calcular no cliente".

| # | Campo que falta | Quem consome | Por que não pode ser derivado no cliente | Se o spec recusar |
|---|---|---|---|---|
| **1** | `rotuloNaoCompravel: string \| null` no contrato de catálogo | selo de D4, nas 4 superfícies (§4) | "Só aos sábados e domingos" é texto de calendário no **fuso da loja**; derivá-lo no browser significaria mandar a configuração de vigência crua para o cliente e reimplementar `descreverVigencia` lá — o oposto da regra 6 do contrato de catálogo ("as colunas cruas não trafegam") | o selo imprime só `Indisponível` e D4 deixa de cumprir "selo explicando quando volta". **Bloqueante para D4.** Pertence ao **Spec B** (§13) |
| **2** | `economiaProdutos: number` no retorno de `revisarCarrinhoAction` | linha "Você economizou" (§6.3) | o carrinho guarda só o **preço efetivo** (`useCarrinho`); o preço de tabela não está no cliente, e colocá-lo lá criaria um segundo número monetário no `sessionStorage` | a linha "Você economizou" **não é renderizada**. O resto do resumo não muda |
| **3** | `baseProdutos: number` e `baseOpcionais: number` no estado `parcial` | disclosure "Como calculamos" (§6.4) | separar a base em duas parcelas é a mesma regra por componente de RN-09-a; refazê-la no browser é a duplicação que D5-b proíbe | o disclosure **sai do desenho**. A frase obrigatória de RN-10-e (estado B) continua intacta |
| **4** | token/versão de revisão (`revisaoId`) devolvido por `revisarCarrinhoAction` e exigido por `criarPedido` | reconfirmação de preço (§7.1, M9) | é o que transforma "a UI pediu segundo clique" em invariante de servidor. Sem ele, D11 depende de disciplina de componente — e não há teste de DOM aqui | as três travas de UI (CTA removido do DOM, gate em `podeConfirmar`, número no rótulo) continuam; a garantia deixa de ser estrutural e vira convenção. **Recomendação forte de aceitar** |
| **5** | projeção `promocaoVigente: boolean` + `rotuloPromocao: string \| null` na page de `/painel/produtos` | chip de promoção na lista (§8.4) | "vigente agora" é RN-03; no browser usaria o relógio do dispositivo | o chip mostra só "Em promoção", sem o prazo. Não é campo de banco novo — é projeção no Server Component |
| **6** | `previa: { total: number; nomes: string[] }` na Server Action de lote | confirmação da ação em lote (§10.2, M8) | a contagem do cliente pode estar velha ou conter id de outra loja; só o servidor resolve nomes sob RLS | **bloqueante**: sem `previa` a confirmação não pode afirmar o alcance, e D2 vira a ação perigosa que o enunciado pede para evitar. Pertence ao **Spec B** |

Dois campos **já promessa do Spec A** e portanto fora desta lista: `estadoCupom` (A/B/C decidido no
servidor, RN-10-e) e `seloDesconto` (rótulo pronto, contrato de catálogo).

---

## 13. Buracos de regra que o desenho revelou

> D1–D11 e o Spec A estão fechados. Nada abaixo foi preenchido — está **apontado**, com o caso
> numérico ou o cenário concreto em que as leituras divergem, para o dono do produto decidir. Os
> buracos 1 a 6 são do **cardápio sazonal** e caem no `specs/cardapio-sazonal.md` (que outro agente
> está escrevendo agora — **não tocado por este documento**). O buraco 7 é do Spec A.

### Buraco 1 — dias da semana **E** dias do mês: interseção ou união? (D3) 🔴

D3 diz "dias da semana, **e/ou** dias do mês, **e/ou** faixa de horário". Um lojista marca
**sábado e domingo** e **dias 1 e 15**.

- Leitura **E** (interseção): aparece só quando um dia 1 ou 15 **cai** num sábado ou domingo — em 2026
  isso acontece em ~4 dias no ano inteiro. O lojista quase certamente não quis isso.
- Leitura **OU** (união): aparece em todo sábado, todo domingo, todo dia 1 e todo dia 15 — ~120 dias
  no ano.

**A diferença entre as duas leituras é de 4 dias contra 120.** É a maior divergência de toda a
feature, e a UI não tem como escondê-la: a frase da prévia muda por completo. O horário é claramente
um **E** (ele recorta o dia), então o buraco é só entre as duas dimensões de dia.
**A UI está desenhada para os dois resultados** (§9.2, §9.6): a prévia imprime a frase que a regra
escolhida produzir, e um aviso não-bloqueante aparece quando as duas dimensões estão preenchidas.

### Buraco 2 — modo "repete sempre" sem nenhuma dimensão marcada (D3)

Nenhum dia da semana, nenhum dia do mês, nenhum horário: o cardápio "recorrente" aparece **sempre** —
ou seja, o lojista criou uma entidade sazonal que não é sazonal, e os produtos dentro dela ficam
indistinguíveis de produtos sem cardápio (D2: "produto que não está em nenhum cardápio é sempre
visível"). D3 não diz se isso é válido. §9.6 **recomenda** bloquear com mensagem, e marca a
recomendação como pendente.

### Buraco 3 — faixa de horário que cruza a meia-noite (D3) 🔴

"Cardápio da madrugada, 22:00 → 02:00". `lojaAberta.ts` — o primitivo que D3 manda reusar — usa
`minutos >= abre && minutos < fecha`, que **não trata virada de dia**: 23:00 não satisfaz
`23:00 >= 22:00 && 23:00 < 02:00`. E há uma pergunta de produto embutida: às 00:30 de domingo, o
cardápio de "sábado 22:00–02:00" ainda está valendo (é a madrugada de sábado) ou já não (é domingo)?
**São duas regras diferentes**, e nenhuma está escrita. §9.6 bloqueia `fim <= início` enquanto não
houver decisão.

### Buraco 4 — o que acontece com o produto quando o prazo fixo **termina** (D3 + D4)

D4 fixa o comportamento **fora da janela** de um recorrente: aparece marcado, com selo dizendo quando
volta. Mas um cardápio de **prazo fixo encerrado** nunca volta. O selo "quando volta" não tem o que
dizer. Três leituras possíveis: (a) o produto volta a ser um produto normal e comprável, porque o
cardápio expirou e deixou de reger qualquer coisa; (b) continua aparecendo marcado como indisponível
para sempre; (c) some da vitrine. **A UI está desenhada para (a)** — é a única em que `rotuloVoltaQuando`
tem um valor sensato (nenhum) — mas a decisão não é do desenho.

### Buraco 5 — dia 31 em mês de 30 dias (D3)

"Todo dia 31" num mês que tem 30: o cardápio simplesmente não aparece naquele mês, ou cai no último
dia? A UI oferece um botão **"Último dia do mês"** separado (§9.2) justamente para que o lojista possa
expressar a intenção sem depender dessa regra — mas se ele escolher 31 mesmo assim, a regra precisa
existir.

### Buraco 6 — "aplicar a uma categoria inteira" é foto ou vínculo? (D2) 🔴

D2 diz que o painel precisa permitir *"aplicar a uma categoria inteira"*. Duas leituras, com
consequências opostas:

- **(a) Foto:** seleciona os produtos que estão na categoria **agora**; produto criado depois **não**
  entra sozinho.
- **(b) Vínculo:** o cardápio passa a apontar para a **categoria**; todo produto criado nela depois
  herda a janela automaticamente.

(b) é uma relação de dados nova (cardápio→categoria, além de cardápio→produto) e muda o modelo. A UI
está desenhada para **(a)** — que é a leitura literal de "selecionar vários produtos de uma vez e/ou
aplicar a uma categoria inteira" — e a confirmação **diz isso em voz alta**: *"São os 12 produtos de
Pizzas de hoje. Produtos criados depois não entram sozinhos."* Essa frase existe exatamente para
expor a ambiguidade ao lojista; se o spec decidir (b), a frase é removida e a confirmação passa a
dizer o contrário.

### Buraco 7 — 🔴 D7 na comanda da cozinha colide com RN-P1, que já é regra implementada e testada

D7 diz: *"Comanda, painel e mensagem de WhatsApp mostram 'de R$ 100,00 por R$ 80,00'"*. O Spec A
repete `ComandaCozinha` na lista de superfícies. **Mas a comanda de cozinha tem, hoje, uma regra
contrária, explícita e verde:**

- `src/components/painel/ComandaCozinha.tsx:17-22` — *"RN-P1: **ZERO informação financeira** — nenhum
  preço unitário/linha, subtotal, desconto, taxa, total nem forma de pagamento"*;
- `src/components/painel/ComandaCozinha.test.tsx:135-151` — testes verdes que afirmam
  `expect(render()).not.toContain("R$")` e que o HTML **não contém** a palavra `"desconto"`, nem o
  código do cupom (*"estratégia comercial não vaza para a cozinha"*);
- a origem é `specs/arquivo/4-impressao-pedido.md` §RN-P1 — spec já entregue.

Colocar "de R$ 100,00 por R$ 80,00" na comanda **derruba esses testes**. E a trava de regressão do
próprio plano do loop diz: *"Teste antigo ajustado para caber no código novo é sinal de regressão, não
de progresso."*

**Recomendação (não decisão):** o par de/por **não** vai para a `ComandaCozinha`; ele vai para o
`ReciboCliente`, que é o documento térmico financeiro. Quem monta o prato precisa do item e da
quantidade, não do preço — RN-14 já reconhece isso ao dizer que *"na comanda da cozinha, o preço de
tabela é secundário; o par não pode competir com o nome e a quantidade"*, o que, levado a sério, é um
argumento para ele não estar lá.
Se o dono do produto quiser D7 na comanda, isso é uma **reversão de RN-P1** e precisa ser decidida no
spec, com os testes de RN-P1 reescritos deliberadamente — nunca ajustados de passagem por uma issue
de UI.

### Observação adicional (não é buraco de regra, é dívida que este trabalho encosta)

O total de linha exibido em `DetalhePedido`, `ReciboCliente`, `whatsappPedido` e na confirmação é
`(preco + Σ opcionais) × quantidade`, enquanto `calcularSubtotal` (`lib/utils/calcularTotal.ts`,
issue 090) documenta que *"opcionais somam UMA vez por linha, sem multiplicar pela quantidade do
produto"*. As duas aritméticas divergem quando `quantidade > 1` e há opcional. **Este documento não
toca nisso** (o par de/por é unitário justamente para não encostar, §11.1), mas o `executar` e o
`auditar` vão passar por essas linhas e é melhor saberem antes.

---

## 14. Inventário — o que o `executar` cria, modifica e não toca

### Criar

| Arquivo | O quê | Mecanismo |
|---|---|---|
| `components/vitrine/PrecoProduto.tsx` | par de preços, 4 superfícies | M1, M2 |
| `components/vitrine/SeloVitrine.tsx` | chip promoção / indisponível | M1, M3 |
| `components/vitrine/ModalPromocoes.tsx` | modal de abertura (D6) | §5 |
| `components/vitrine/decisaoModalPromocoes.ts` | decisão pura (já prevista em RN-16) | §5.2 |
| `lib/utils/rotuloPrecoAcessivel.ts` | frase do leitor de tela | M1 |
| `lib/utils/copiaCupom.ts` | as 3 redações literais de RN-10-e | **M5** |
| `lib/utils/copiaRevisaoPreco.ts` | textos do D11, sem linguagem de erro | M5 |
| `lib/utils/descreverVigencia.ts` | prévia do painel **e** rótulo da vitrine | **M6** |
| `lib/utils/copiaLotePromocao.ts` | pergunta e rótulo de confirmação do lote | M5, M8 |
| `lib/utils/linhaDePor.ts` | par de/por, 4 superfícies (RN-14) | M3 |
| `components/ui/alert-dialog.tsx` | **via `npx shadcn add alert-dialog`** — não escrever à mão | §Gate |

### Modificar

`CardProduto`, `ItemProdutoLista`, `ProdutoModal`, `SecaoCatalogo`, `VitrineClient`,
`checkout/ResumoValores`, `checkout/EtapaItens`, `checkout/estado.ts` (`podeConfirmar`),
`Carrinho`, `painel/FormProduto`, `painel/ProdutosClient`, `painel/DetalhePedido`,
`painel/ReciboCliente`, `lib/utils/whatsappPedido.ts`,
`(publica)/loja/[slug]/confirmacao/page.tsx`, `app/globals.css` (5 tokens),
`(painel)/painel/(bloqueavel)/configuracoes/perfil` (toggle do modal).

### Não tocar

- `components/ui/*` — gerados pelo CLI (o único acréscimo é gerar `alert-dialog`).
- `ComandaCozinha.tsx` e seus testes — até o buraco 7 ser decidido no spec.
- `paraLinhaPedido.ts` / `TabelaPedidos` — §11.4.
- `lib/utils/calcularTotal.ts` — reusado sem alteração (o que muda é o `preco` que entra).
- As regras `@media print` de `globals.css` — o par de/por é markup comum dentro de bloco existente.
- `specs/cardapio-sazonal.md` — em escrita por outro agente nesta mesma sessão.

### Ordem sugerida (o que destrava o quê)

1. Tokens (`globals.css`) + `SeloVitrine` + `PrecoProduto` + `rotuloPrecoAcessivel` — destrava as 4
   superfícies da vitrine de uma vez.
2. `SecaoCatalogo` passando o **objeto inteiro** (M2) — fecha o bug de `disponivel` de passagem.
3. `linhaDePor` + as 4 superfícies de exibição (D7).
4. `FormProduto` (bloco Promoção + superfície de erro do D10) — depende do `superRefine` do
   `schemaProduto`.
5. `copiaCupom` + `ResumoValores` + `EtapaItens` — depende do `estadoCupom` da Server Action.
6. `ModalPromocoes` + `decisaoModalPromocoes` + toggle no perfil.
7. `copiaRevisaoPreco` + `podeConfirmar` (D11) — depende do token de revisão (§12, item 4).
8. `descreverVigencia` + form de vigência + lote (D2/D3) — depende do Spec B.

---

## 15. Checklist de aceite deste desenho

Marcável por leitura de código, já que não há teste de DOM neste repo:

- [ ] `grep -r "precoEfetivo <" src/components/` **não devolve nada** — nenhum componente decide se há
      desconto (M3).
- [ ] `grep -rn "disponivel?:" src/components/vitrine/` **não devolve nada** — sem prop opcional de
      comprabilidade (M2).
- [ ] `grep -rn "base elegível\|base elegivel" src/components/vitrine/` **não devolve nada** — jargão
      proibido na vitrine (§6.4).
- [ ] `grep -rn "setTimeout\|onPointerDown\|onTouchStart" src/components/vitrine/ModalPromocoes.tsx`
      **não devolve nada** (§5.1, §5.2).
- [ ] `grep -rn "cor-primaria\|cor-destaque\|cor-fundo" src/components/vitrine/SeloVitrine.tsx`
      **não devolve nada** — o selo não lê o tema da loja (§2).
- [ ] `grep -rn "min-h-11\|size=\"icon-sm\"" ` nos arquivos novos **não devolve nada** — 44px literal
      (design-system §5).
- [ ] as três frases de RN-10-e existem **literais** em `lib/utils/copiaCupom.ts` e têm teste que as
      afirma byte a byte.
- [ ] `descreverVigencia.ts` é importado **pelo painel e pela projeção da vitrine** (M6).
- [ ] `ComandaCozinha.test.tsx` continua verde **sem edição** (§13, buraco 7).
- [ ] `plan/design-promocoes-e-vigencia.md` não introduziu nenhuma regra de negócio nova — os sete
      buracos estão em §13, apontados, não preenchidos.
