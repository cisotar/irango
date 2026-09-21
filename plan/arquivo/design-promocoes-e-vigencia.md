# Design de UI/UX — Descontos, pratos promocionais e cardápio sazonal

**Versão:** v2 · **Autor:** agente `desenhar` · **Data:** 2026-09-20 ·
**Branch:** `docs/specs-descontos-promocoes-cardapio`
**Entra como:** passo 4 do `plan/loop-descontos-promocoes-cardapio-sazonal.md`.
**Insumos:** `plan/loop-descontos-promocoes-cardapio-sazonal.md` §0 (D1–D7 e invariantes),
`specs/desconto-por-produto-e-pratos-promocionais.md` (**Spec A v0.4.0**, dono do contrato de
catálogo), `specs/cardapio-sazonal.md` (**Spec B v0.3.0**) e `references/design-system.md`.

> **O que mudou da v1 para a v2.** A v1 foi escrita em 19/09 contra o Spec A v0.1/0.2 e o plano com
> D1–D11. Desde então os specs fecharam **D12 a D16** e responderam **todos** os seis pedidos de
> contrato e os sete buracos de regra que a v1 tinha aberto. Consequências:
> - **§12 deixou de ser uma lista de pedidos** e virou a tabela *pedido → decisão do spec → efeito no
>   desenho*; **§13 deixou de ser uma lista de buracos** e virou a tabela equivalente das sete regras
>   que faltavam. Nenhuma das duas continua em aberto.
> - **M9 e §7.1 foram reescritos:** o `revisaoId` foi **recusado** e substituído por
>   `promocaoExibida` (Spec A, RN-12-a). A garantia de servidor continua; o mecanismo mudou.
> - **§4.2 e §9.2 tinham dois conflitos explícitos com o Spec B** (botão "+" fora do DOM; botão
>   "Último dia do mês"). **O spec venceu nos dois.**
> - **§13 passou a ser o que o Spec B delega ao desenho** (D16, D14, RN-12, D12), e os nomes de
>   componente foram alinhados ao Spec A (§0.1).
> - Os marcadores "pendente" de §4.3, §9.2 e §9.6 **saíram** — as regras existem.
>
> **O que este documento decide e o que não decide.**
> Ele decide **forma**: anatomia de componente, hierarquia, copy não fixada, tokens, alvo de toque,
> ordem de leitura, foco e anúncio de leitor de tela. Ele **não** decide regra de negócio: **D1–D16 e
> os dois specs são contrato fechado**. Regra de precedência: **em conflito, o spec vence** — o
> desenho decide forma, nunca regra. O que ainda não tem resposta está em
> §16 "Pendências para o spec", com o caso concreto, e não foi preenchido aqui.
> A copy dos três estados do cupom já está fixada em **RN-10-e** e é **transcrita**, nunca reescrita;
> o mesmo vale para a copy de `visibilidade` e do diálogo de desligar, fixadas pelo Spec B.

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
(`PrecoProduto`, `SeloDesconto`, `ModalPromocoes`) existem justamente para que a mesma regra não seja
reescrita em quatro superfícies.

### 0.1 Nomes — alinhamento com o Spec A (uma linha por nome)

O Spec A nomeia componentes; o desenho os batizava de outro jeito. **O spec vence.** A tabela existe
para o `quebrar` decidir sem ambiguidade — nenhum nome fica com duas grafias no repositório.

| Nome na v1 do desenho | Nome adotado | Decisão (1 linha) |
|---|---|---|
| `SeloVitrine` (chip de promoção **e** de indisponibilidade) | **`SeloDesconto`** (Spec A §Componentes) | ADOTA o nome do spec e **perde o tom `indisponivel`**: o Spec B manda literalmente *"nenhum estilo novo: mesma pill, mesma opacidade, mesmo `disabled`"* para o não-comprável, então indisponibilidade **não vira componente** — vira token (§2) aplicado à pílula que cada superfície já tem. |
| `linhaDePor.ts` (módulo puro do par de/por) | **`LinhaItemPedido`** (Spec A §Componentes da confirmação) | ADOTA o nome do spec para o helper compartilhado. Como a mesma regra serve o WhatsApp (texto plano, sem React), o helper é um **módulo** `lib/utils/linhaItemPedido.ts` exportando `parDePor` e `textoDePor` — nome do spec, forma testável sem jsdom (M5). |
| `PrecoProduto` | **`PrecoProduto`** | MANTIDO: nenhum spec nomeia o par de preços, então não há conflito a resolver — é nome novo, não nome divergente. |
| `ModalPromocoes`, `decisaoModalPromocoes` | idem | MANTIDOS: são exatamente os nomes que o Spec A já usa (RN-16, §Componentes). |
| `SeloVitrine tom="indisponivel"` no `ProdutoModal` | — | REMOVIDO como componente; o selo central do modal continua onde está e só troca o `#8B4513` pelos tokens `--indisponivel-*` (§2). É consolidação de **hex**, não de markup — o que o Spec B proíbe é estilo novo, não hex unificado. |

### O que é reuso puro

| Necessidade | O que já existe | Como |
|---|---|---|
| Modal com foco preso, ESC e clique-fora | `ui/dialog.tsx` (Base UI) | `ModalPromocoes` e a reconfirmação de preço usam `Dialog`; nada de modal ad-hoc (design-system §5) |
| Ligar/desligar promoção; "definir prazo" | `ui/switch.tsx`, `ui/checkbox.tsx` | bloco Promoção do `FormProduto` |
| Escolher percentual × reais; escolher modo de vigência | `ui/radio-group.tsx` | dois `RadioGroup`, nenhum `Select` novo |
| Chip/selo com cor de sistema + texto | `ui/badge.tsx` + o princípio de `BadgeStatus` (design-system §8) | `SeloDesconto` |
| Estado ao vivo do cardápio no painel ("Aberto agora", "Expirado") | `BadgeStatus` (design-system §7, §8) — **o Spec B manda reusar** | §13.3, sem componente novo |
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
| **M1** | selo e preço riscado implementados 4× (card, lista, modal, busca) e divergindo | **um** `PrecoProduto` e **um** `SeloDesconto`; nenhuma superfície formata preço por conta própria. A busca é coberta de graça porque reusa card e linha | §3 |
| **M2** | prop opcional com default silencioso (`disponivel?: boolean` → `?? true`), que já produz o bug real acima | as superfícies passam a receber **um objeto obrigatório** `produto: ProdutoVitrine`, não campos avulsos. Campo faltando vira erro de `tsc`, não "R$ NaN" nem "disponível por engano" | §3, §4 |
| **M3** | componente decidindo se há desconto (`precoEfetivo < preco`) e refazendo a regra no browser | `temDesconto`, `seloDesconto` (rótulo **pronto**) e `compravel`/`motivoNaoCompravel` chegam **decididos do servidor**; o componente só ramifica em booleano | §3, §4 |
| **M4** | componente escolhendo o estado A/B/C do cupom comparando `baseElegivel` com `subtotal` — reimplementação da regra monetária no cliente | a Server Action devolve `estadoCupom` como **union discriminada**; o componente nunca compara números | §6 |
| **M5** | a frase obrigatória de RN-10-e reescrita/traduzida em revisão, sem nenhum teste capaz de pegar | as 3 redações literais vivem em **`lib/utils/copiaCupom.ts`**, módulo puro, testável byte a byte em `environment: node` — mesmo formato de `alcance-do-grupo.ts` | §6 |
| **M6** | painel e vitrine descrevendo a **mesma** vigência com palavras diferentes ("sáb e dom" vs. "fim de semana") | **um** módulo `lib/utils/descreverVigencia.ts` produz a prévia do painel **e** o rótulo "quando volta" do selo da vitrine | §9, §4 |
| **M7** | mensagem do D10 com um texto no cliente e outro no servidor | a mensagem é montada por **uma** função pura exportada, consumida pelo `superRefine` do `schemaProduto` (que já é isomórfico) — form e Server Action não têm como divergir | §8 |
| **M8** | ação em lote confirmada sobre uma contagem do cliente (seleção velha, produto de outra loja, catálogo mudado noutro dispositivo) | o botão de confirmar recebe `previa` **obrigatória, vinda do servidor**; sem `previa` ele nem existe. E o número vai **dentro do rótulo do botão** ("Aplicar a 12 produtos") | §10 |
| **M9** | "segundo clique explícito" do D11 virando um `disabled` que alguém reabilita — e, pior, a garantia morando **só** no componente, que este repo não sabe testar | o CTA de envio é **removido do DOM** enquanto a reconfirmação está aberta, o gate entra em `podeConfirmar` (`checkout/estado.ts`, função pura já existente e já testada) e **cada item do payload carrega `promocaoExibida: boolean`** (Spec A, **RN-12-a**), que o servidor compara com o `temDesconto` real do banco: `true` afirmado × `false` apurado ⇒ **recusa**. A UI pode esquecer o segundo clique; o servidor não deixa passar | §7.1 |

Três observações que valem para os nove:

1. **Toda copy nova vira função pura em `lib/utils/`.** É o único jeito de testar texto neste repo.
   Cinco módulos: `copiaCupom.ts`, `copiaRevisaoPreco.ts`, `descreverVigencia.ts`,
   `copiaLotePromocao.ts` e `copiaCardapioPainel.ts` (os rótulos de estado do cardápio e o aviso de
   RN-12 — §13.3, §13.4).
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
components/vitrine/SeloDesconto.tsx      — o chip de PROMOÇÃO (nome do Spec A, §0.1)
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

#### `SeloDesconto`

```tsx
type SeloDescontoProps = {
  /** Texto PRONTO, vindo do servidor (`ProdutoVitrine.seloDesconto`).
   *  `null` ⇒ o componente devolve null. */
  rotulo: string | null;
  /** "foto" (sobreposto à imagem) | "inline" (no fluxo de texto). Obrigatório. */
  ancoragem: "foto" | "inline";
};
```

> **Por que não há prop `tom`.** A v1 tinha um componente com dois tons (promoção e
> indisponibilidade). O Spec B fechou o não-comprável como *"nenhum estilo novo: mesma pill, mesma
> opacidade, mesmo `disabled`, mesmo padrão de `aria-label`. Só o texto muda."* — então a
> indisponibilidade **não** ganha componente: ela continua na pílula que `CardProduto` já imprime, e
> o que este documento unifica é o **hex** dela (§2, tokens `--indisponivel-*`). Um componente a
> menos, e o Spec B respeitado na letra.

**`rotulo: string | null` com o `return null` DENTRO do componente** (M3): não existe um `{x && ...}`
para alguém esquecer em uma das quatro superfícies. Uma decisão, um lugar.

Classes:

```
SeloDesconto   : bg-promo-fundo text-promo-texto border-[1.5px] border-promo-borda
                 rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide
                 whitespace-nowrap shadow-[0_2px_10px_rgba(0,0,0,0.25)]
ancoragem=foto : absolute z-[2]  (posição dada pelo consumidor)

pílula de indisponível (NÃO é componente — é a pílula que o CardProduto já imprime,
só trocando o hex pelos tokens de §2):
                 bg-indisponivel-fundo text-indisponivel-texto border-[1.5px] border-white/25
                 + o mesmo rounded-full/px/py/text-xs acima
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
│            │       -20%         │             │  ← SeloDesconto inline, centrado
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
// No objeto (contrato de catálogo do Spec A, estendido pelo Spec B):
compravel: boolean                    // false ⇒ aparece, sem botão de compra
motivoNaoCompravel: "esgotado" | "fora_da_janela" | null

// AO LADO do objeto, no mesmo retorno de projetarCatalogoVitrine (Spec B, RN-06):
rotulosVigencia: Record<string, string>   // produto_id → frase pronta do selo
```

🔴 **A v1 pediu um campo `rotuloNaoCompravel` no objeto. O Spec B recusou — e a recusa é melhor que
o pedido.** A regra 2 do contrato de catálogo proíbe campo novo em `ProdutoVitrine`, então o rótulo
viaja **num mapa `produto_id → rótulo`**, devolvido pela **mesma** função que devolve os produtos
(RN-06): não existe caminho de código que produza o produto marcado sem produzir o rótulo dele, e o
mapa é imune ao filtro da busca porque é chaveado por id — exatamente como `opcionaisPorCategoria` já
faz nesta mesma cadeia de componentes. O que o desenho precisava está garantido: **a frase continua
vindo pronta do servidor**, formatada no fuso da loja, e o componente só a imprime.

Consequências de forma, e são três:

1. `SecaoCatalogo` recebe `rotulosVigencia` como prop **obrigatória**, ao lado de
   `opcionaisPorCategoria` (Spec B, §Componentes). Prop obrigatória, de novo, porque sem jsdom o
   `tsc` é a única trava.
2. **Fallback de render:** chave ausente ⇒ o selo imprime **"Indisponível no momento"**. Na vitrine
   isso é puramente defensivo — por RN-13, todo produto que chega marcado **tem** uma volta a
   anunciar. Na **revisão do carrinho** é caso real de negócio: ver §13.7.
3. A precedência entre `esgotado` e `fora_da_janela` é **do servidor** e está fechada no Spec B
   (RN-05): **`fora_da_janela` ganha**. A UI nunca compõe dois motivos e nunca mostra dois selos.

### 4.2 Tratamento único, quatro superfícies

| Superfície | Tratamento |
|---|---|
| `CardProduto` | overlay `bg-black/35` + `[backdrop-filter:grayscale(1)]` sobre a foto, `card-body opacity-60`, a **pílula que já existe** no rodapé-centro com o rótulo vindo de `rotulosVigencia`, botão "+" **`disabled` e com `pointer-events-none`** (ver o conflito resolvido abaixo) |
| `ItemProdutoLista` | **novidade**: a linha ganha a mesma pílula, inline, o preço fica em `--texto-muted` sem `--cor-destaque`, e o texto do preço não é riscado (não há promoção aqui, há indisponibilidade) |
| `ProdutoModal` | selo centralizado no mesmo lugar do "Esgotado" de hoje, imagem em grayscale, seção de quantidade e de observação ocultas, CTA `Produto indisponível` desabilitado (é o padrão que já existe, `ProdutoModal.tsx:378-388`) |
| Busca | de graça, pelo mesmo motivo de §3.5 |

#### 🔴 Conflito resolvido — o botão "+" fica `disabled`, e o card continua abrindo o modal

**A v1 mandava remover o "+" do DOM. O Spec B diz o contrário, com todas as letras:** *"Nenhum estilo
novo: mesma pill, mesma opacidade, **mesmo `disabled`**, mesmo padrão de `aria-label`. Só o texto
muda."* **O spec vence: o botão fica no DOM, `disabled`.**

O que a v1 estava protegendo continua valendo — um "+" cinza que não responde faz o cliente tocar
duas vezes e concluir que o site travou — mas a saída não é remover o botão. É esta, e ela é
compatível com a letra do Spec B:

```tsx
// CardProduto — produto não comprável
<button
  disabled
  aria-label={`${produto.nome} — ${rotulo}`}   // "Feijoada — Só aos sábados e domingos"
  className="pointer-events-none …"            // ← a peça que resolve o conflito
>
  +
</button>
```

1. **`disabled`** — é o que o Spec B pede, e é o que impede a adição. Botão `disabled` não é
   focável nem dispara `click`; a UI não é a proteção de qualquer jeito (o servidor recusa, RN-08).
2. **`pointer-events-none`** — sem isso, o toque **morre no botão**: navegador nenhum propaga
   `click` de elemento `disabled`, então o dedo que cai sobre o "+" não abre o modal e a tela parece
   travada, que é exatamente o dano que a v1 queria evitar. Com ele, o toque **atravessa** para o
   card, que abre o modal, que é onde a explicação mora. **Uma classe compra o comportamento inteiro
   sem tirar o botão do DOM.**
3. **O rótulo do motivo vai no `aria-label` do botão**, que é o *"mesmo padrão de `aria-label`"* que o
   Spec B manda preservar: quem usa leitor de tela ouve o motivo no mesmo lugar onde o vidente vê a
   pílula.

🔴 **E a exigência que a v1 acertou continua de pé: o card não-comprável ABRE o modal.** Hoje
`CardProduto` zera o `onClick` quando `!disponivel` (`CardProduto.tsx:46`) enquanto
`ItemProdutoLista` sempre abre — e abre com o estado errado (o bug de D13/RN-19). Com D4 isso deixa
de ser detalhe: **"Só aos sábados e domingos, das 11:00 às 15:00" não cabe na pílula do card em
360px**, e o único lugar onde ele cabe inteiro é o modal. Um produto marcado que não abre é um beco
sem saída — a mesma classe de erro que D13 manda fechar. A adição continua impossível: o modal
não-comprável não tem CTA de adicionar (Spec B: *"o modal de um produto fora da janela abre — o
cliente pode querer ler a descrição — mas não adiciona nada"*).

### 4.3 Copy do rótulo

Produzida por `descreverVigencia.ts::rotuloVoltaQuando` (M6, §9.5), **no servidor**, e entregue ao
componente pelo mapa `rotulosVigencia` (§4.1). Forma curta, porque divide espaço com uma foto em
168px:

| Configuração | Rótulo |
|---|---|
| dias da semana | `Só aos sábados e domingos` |
| dias da semana + horário | `Sáb e dom, 11:00–15:00` |
| dias do mês | `Só nos dias 1 e 15` |
| dias da semana **+** dias do mês | `Sáb, dom, dia 1 e dia 15` — os dois eixos **somam** (Spec B, RN-02: **OU**) |
| só horário | `Só das 11:00 às 15:00` |
| prazo fixo ainda não começado | `A partir de 22/09` |
| prazo fixo já encerrado | **não existe rótulo, porque não existe card**: o produto `visibilidade = 'cardapio'` **some da vitrine** (Spec B, RN-13) e o `'menu'` nunca recebe este motivo (RN-05) |
| produto em N cardápios fechados | o rótulo do que **abre mais cedo** — escolha determinística do servidor por `proximaAbertura`, desempate por `nome` e `id` (Spec B, RN-07). A UI **nunca** escolhe |
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
  Você economizou                        − R$  20,00   ← desconto de PRODUTO; `economiaProdutos`
                                                          vem pronto do servidor (§12, concedido)
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
3. **Os dois números vêm do servidor — e o Spec A CONCEDEU.** `derivarBasesCupom` passa a devolver
   `baseProdutos` e `baseOpcionais` junto com `baseElegivel`, com a invariante
   `baseElegivel === arred2(baseProdutos + baseOpcionais)` travada no RED da fatia crítica 3
   (RN-10-e). Custo declarado pelo spec: **zero** — a função já somava as duas parcelas, só não as
   devolvia. O disclosure **não** é calculado no cliente, em nenhuma hipótese; se os números não
   vierem, ele não é renderizado e a frase obrigatória do estado B sobrevive sozinha (§12).

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
3. 🔴 **O envio carrega `promocaoExibida` por item — e é o servidor que fecha a porta** (Spec A,
   **RN-12-a**). A v1 pediu um token de revisão (`revisaoId`); **o Spec A recusou o mecanismo e
   adotou o objetivo**, com um booleano de exibição assimétrico que não precisa de HMAC, de tabela
   nova nem de round-trip a mais. O que o `executar` implementa:

   ```ts
   // payload de criarPedido — zod .strict(), SEM nenhum campo monetário (inalterado)
   itens: [{ produto_id, quantidade, opcionais, promocaoExibida: boolean }]
   ```

   `promocaoExibida` é a afirmação do cliente **sobre o que a tela mostrou**, nunca sobre quanto
   custa. `criarPedido` compara com o `temDesconto` real do banco:

   | Cliente afirmou | Servidor apurou | Ação |
   |---|---|---|
   | `true` | `true` | segue |
   | `false` | `false` | segue |
   | `false` | `true` | **segue** — a promoção começou no caminho, o cliente paga **menos** que viu (§7.2) |
   | `true` | `false` | **RECUSA** com código de revisão — é o caso desta tela |

   **Como isso amarra o desenho:** o card do produto em promoção é a única coisa que pode fazer o
   componente enviar `true`; quando a recusa volta, o checkout chama `revisarCarrinhoAction`, abre
   **este** diálogo, e o segundo clique envia `promocaoExibida: false` — o que prova que a tela
   mostrou o preço novo. **A UI pode esquecer o segundo clique; o pedido não passa mesmo assim.**
   Três propriedades que o desenho pode confiar sem teste de DOM: o campo **só sabe recusar** (não
   existe valor que barateie o pedido), **ausente ⇒ `false`** (fail-closed, cliente antigo durante o
   deploy segue pelo preço do banco) e **nenhum número monetário novo trafega** do cliente.

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

- O chip de promoção usa o **mesmo `Badge`** do painel (não o `SeloDesconto`, que é da vitrine e carrega
  cores de sistema pensadas para foto). `variant="secondary"` + `text-promo-texto`.
- O rótulo inclui o fim do prazo quando existe (`-20% até 30/09`) e não inclui quando não existe
  (`-20%`). É a informação que o lojista procura ao abrir a tela: *"ainda está valendo?"*.
- 🔴 **`promocaoVigente` e o rótulo são projetados no Server Component da página**, não derivados no
  `ProdutosClient`. Calcular "está vigente agora" no browser duplicaria RN-03 e usaria o relógio do
  dispositivo. Não é campo novo de banco — é exigência de projeção no Server Component (§12).

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
  │                                              │
  │  O dia 31 não existe em todo mês. Nos meses  │  ← nota que só aparece
  │  de 30 dias, este cardápio não aparece.      │     quando 31 está marcado
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
  lojista faz na primeira vez que abre a tela. **Cuidado de implementação:** "nenhum dia marcado" é
  *sem restrição por esse eixo*, e o Spec B (RN-02) proíbe os **três** eixos vazios ao mesmo tempo —
  ver §9.6.
- 🔴 **Dias da semana + dias do mês ao mesmo tempo: é OU, e a regra está fechada** (Spec B, **RN-02**;
  era o buraco 1 da v1). Os dois eixos **somam** dias; o horário filtra **dentro** deles. O caso que
  separa as leituras: `{sáb, dom}` + `{1, 15}` numa **quarta-feira, dia 15** ⇒ **ABERTO**.
  Consequências de forma, e são as duas que a v1 já tinha preparado — agora sem aviso de ambiguidade:
  - **o aviso não-bloqueante SAI.** Não há nada de ambíguo a avisar; um aviso sobre uma regra fechada
    só ensina o lojista a ignorar avisos;
  - **a prévia diz a regra por extenso**, que é onde ela fica verificável:
    *"Aparece todo sábado e domingo, e também todo dia 1 e dia 15."* A conjunção **"e também"** é
    obrigatória — ela é a diferença de 4 dias contra ~120 no ano, escrita em português.

### 9.3 Modo B — Período com data de fim

```
  ┌─ Duração ────────────────────────────────────┐
  │  [ 1 dia ]  [ 7 dias ]  [ 1 mês ]            │  ← chips 44px, aria-pressed
  │  [ Escolher as datas ]                       │     (diario / semanal / mensal)
  └──────────────────────────────────────────────┘

  Começa em   [ 19/09/2026 ]  [ 11:00 ]
  Termina em  26/09/2026, 11:00                   ← LEITURA quando há preset
  Fuso da loja: America/Sao_Paulo (GMT-3)
```

- 🔴 **Com preset, "Termina em" é LEITURA, não campo.** Corrigido contra a v1, que dizia que o preset
  "preenche e não trava". O Spec B (**RN-04**) é explícito: com `diario`, `semanal` ou `mensal`, a
  Server Action **recalcula `prazo_fim` a partir de `prazo_inicio` + preset e descarta o `fim` que
  veio do cliente**. Um campo editável cujo valor o servidor joga fora é uma mentira de UI — o
  lojista digitaria 23:59 e receberia 11:00 sem explicação. Só **"Escolher as datas"**
  (`customizado`) abre o campo de fim para edição.
- **Os quatro chips são os quatro presets do banco**, um para um (`diario`, `semanal`, `mensal`,
  `customizado`), com `aria-pressed`. Nomeados em português de lojista ("1 dia", "7 dias", "1 mês"),
  nunca com o literal do schema.
- **A data de fim mostrada com preset vem da mesma função pura do servidor**
  (`calcularFimDoPreset`, isomórfica, RN-04) — inclusive o clamp de fim de mês: `31/01 + 1 mês` é
  **28/02**, e a prévia tem de dizer 28/02, não 03/03. Nunca uma segunda fórmula no browser.
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
| sáb+dom **e** dias 1 e 15 | `Aparece todo sábado e domingo, e também todo dia 1 e dia 15.` | `Sáb, dom, dia 1 e dia 15` |
| dia 31 marcado | `Aparece todo dia 31 — nos meses de 30 dias, não aparece.` | `Só no dia 31` |
| só horário | `Aparece todo dia, das 11:00 às 15:00.` | `Só das 11:00 às 15:00` |
| prazo fixo futuro | `Aparece de 22/09, 11:00 até 29/09, 11:00.` | `A partir de 22/09` |
| prazo fixo em curso | `Está aparecendo desde 18/09 e some em 29/09, às 11:00.` | — |
| prazo fixo encerrado | `Terminou em 29/09. Este cardápio não aparece mais.` | **não existe** — o produto exclusivo some (RN-13) e o do menu não recebe o motivo (RN-05) |

**Duas linhas da v1 saíram da tabela, e é o spec que as tira:**

- **"último dia do mês"** — o Spec B põe *"regras de calendário além de dia-da-semana e dia-do-mês"*
  explicitamente em **Fora do Escopo (v1)**, nomeando "último dia do mês" como exemplo. A frase não
  tem configuração que a produza, então a redação não existe.
- **"nenhuma dimensão"** (`Aparece sempre — este cardápio não tem janela`) — o estado **não pode ser
  gravado**: o CHECK `cardapios_recorrente_tem_eixo` o recusa no banco (RN-02). Uma frase para um
  estado impossível é código morto que um dia alguém "reativa".

### 9.6 Validação do form (o que bloqueia o salvar)

**Toda linha desta tabela é espelho de um CHECK do banco** (Spec B, §Modelos de Dados). O form é a
primeira barreira com mensagem legível; a autoridade é o `zod` + o CHECK, e `23514` vira mensagem
genérica na UI com detalhe no log (`seguranca.md` §14). Nenhuma linha aqui é recomendação do desenho.

| Situação | Tratamento | Trava no banco |
|---|---|---|
| Modo A com **nenhuma** das três dimensões preenchida | **bloqueia**: *"Escolha pelo menos um dia da semana, um dia do mês ou um horário. Sem nada marcado, este cardápio aparece sempre e não é sazonal."* | `cardapios_recorrente_tem_eixo` (RN-02) — recusa `NULL` **e** `'{}'` |
| Modo A com dias da semana **e** dias do mês | **não bloqueia, e não avisa.** É **OU** por regra fechada (RN-02): a prévia diz *"…e também…"* (§9.2) | — (combinação válida) |
| Horário `fim <= início` (ex.: 22:00 → 02:00) | **bloqueia**: *"O horário de fim precisa ser depois do de início."* A janela que cruza a meia-noite está **fora do escopo v1** por decisão do Spec B, recusada por CHECK — não é regra faltando | `cardapios_hora_ordem` + `cardapios_hora_par` |
| Modo B com `fim <= início` | **bloqueia**: *"A data de fim precisa ser depois da de início."* | `cardapios_prazo_ordem` |
| Modo B sem `fim` | **bloqueia**: prazo fixo exige o par completo | `cardapios_prazo_obrigatorio` |
| Dia 31 marcado | **não bloqueia** — é configuração válida. A prévia diz o efeito: *"Aparece todo dia 31 — nos meses de 30 dias, não aparece."* (RN-02: *"não casa em meses de 30 dias; é a leitura literal e é o que o preview tem de dizer ao lojista"*) | `cardapios_dias_mes_dominio` (1..31) |
| Preset de prazo fixo (diário/semanal/mensal) | o campo "Termina em" vira **leitura**, não entrada: o `fim` é **recalculado no servidor** e o que o cliente mandar é descartado (RN-04). Só "Escolher as datas" aceita o fim digitado | — |

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
│  São os 12 produtos de Pizzas de hoje.        │  ← foto, não vínculo (RN-10)
│  Produtos criados depois não entram sozinhos. │
│                                               │
│  [ Adicionar 12 produtos ]  [ Cancelar ]      │
└───────────────────────────────────────────────┘
```

**Seis travas, por ordem de importância:**

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
   > ⚠️ **Com D14, esta frase depende da `visibilidade` dos produtos selecionados, e o diálogo tem de
   > dizer os dois casos quando os dois existem** (mesma forma do diálogo de desligar, §13.4):
   > *"N produtos **do menu** continuam aparecendo e vendendo fora da janela. M produtos **de
   > cardápio** só aparecem quando este cardápio estiver aberto."* Os dois números vêm da mesma
   > `previa` do servidor — nunca contados no cliente.
5. **"Categoria inteira" é FOTO, e a frase pode afirmar isso** (era o buraco 6 da v1; fechado pelo
   Spec B, **RN-10**). A expansão acontece **dentro da transação**, na RPC
   `aplicar_cardapio_em_categoria` (`insert ... select`), justamente para não ser TOCTOU — e o que
   ela grava são **vínculos produto↔cardápio**, um por produto existente naquele instante. Não existe
   vínculo cardápio↔categoria no modelo, então produto criado depois **não** entra sozinho, e a frase
   *"São os 12 produtos de Pizzas de hoje. Produtos criados depois não entram sozinhos."* deixa de
   ser exposição de ambiguidade e passa a ser **descrição do que o botão faz**.
   > Detalhe de forma que vem junto: a RPC inclui produto `oculto` e `disponivel = false` (RN-10), e
   > o diálogo **não** os esconde da contagem. Se os 12 incluem 2 ocultos, a frase diz
   > *"2 deles estão ocultos e continuam ocultos"* — senão o lojista reabre um produto meses depois e
   > descobre que ele herdou uma janela que ninguém lembra de ter aplicado.
6. **Reversibilidade sem pilha de undo.** Não há "desfazer" em v1 — não está no contrato. O que há é a
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
// lib/utils/linhaItemPedido.ts — helper LinhaItemPedido (nome do Spec A, §0.1).
// PURA (M5). RN-14: "cinco superfícies, uma regra".
export function parDePor(item: { preco: number; preco_original: number | null; quantidade: number })
  : { teve: boolean; de: string; por: string; sufixo: string } | null;

export function textoDePor(item): string | null;   // variante de TEXTO PLANO (WhatsApp)
```

- `preco_original === null` ⇒ devolve `null` ⇒ **nada é renderizado**. Nenhuma superfície tem um `if`
  próprio sobre `preco_original` — a decisão mora no helper (M3, mesmo espírito do
  `rotulo: string | null` do `SeloDesconto`).
- 🔴 **O par é sempre o preço UNITÁRIO — e agora por mérito, não por desvio.** A v1 mantinha o par
  fora da aritmética de linha porque essa aritmética estava **errada**. **D15/RN-20 consertou a
  conta**: `totalDaLinha` passa a ser a mesma função que produz `calcularSubtotal`
  (`(preco × qtd) + Σ opcionais`, opcional somando **uma vez por linha**), com a invariante
  `Σ totalDaLinha === calcularSubtotal` travada em teste. O par continua unitário pelas três razões
  que o Spec A dá em RN-14: é o que D7 diz literalmente, é o número que o cliente reconhece do card
  da vitrine, e um par de linha misturaria quantidade, desconto e opcionais num par só.
- **As quatro superfícies passam a consumir `totalDaLinha`** — é requisito do Spec A (RN-20), não
  opção deste desenho, e **corrigir só uma das quatro está errado mesmo que a tela fique certa**.
  Efeito visível: `2× Pizza R$ 50,00 + borda R$ 10,00` passa a imprimir **R$ 110,00** (o cobrado), e
  não R$ 120,00. A linha do recibo passa a fechar com o subtotal do próprio recibo.
- Por isso o `sufixo`: com `quantidade > 1`, o par imprime `/un.` para que ninguém leia o preço de
  tabela como total da linha. Com RN-20 aplicada, o par unitário e o total da linha convivem na mesma
  linha, ambos corretos: `2× Pizza · de R$ 50,00 por R$ 40,00 · R$ 90,00`.

### 11.2 As superfícies

| Superfície | Tratamento | Arquivo |
|---|---|---|
| Confirmação do pedido (cliente) | `R$ 80,00` em `--texto`, `de R$ 100,00` em `--texto-muted`, `text-xs`, linha abaixo | `(publica)/loja/[slug]/confirmacao/page.tsx:164-175` |
| `DetalhePedido` (tela do painel) | idem, `text-muted-foreground` | `DetalhePedido.tsx:205-220` |
| `ReciboCliente` (térmica 80mm) | ver §11.3 | `ReciboCliente.tsx:82-95` |
| `whatsappPedido` (texto plano) | `- 1x Feijoada completa — R$ 80,00 (de R$ 100,00)` | `whatsappPedido.ts:79-83` |
| `ComandaCozinha` (térmica 80mm) | **selo `[PROMO]`, nenhum valor** (D12, RN-14-a) — ver §13.6 | `ComandaCozinha.tsx:52` |
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

## 12. Pedido → decisão do spec → efeito no desenho

> A v1 terminava com duas listas em aberto: **seis números que o desenho pedia** (§12) e **sete
> buracos de regra** (§13). Os specs responderam **todos**. As duas tabelas abaixo substituem as duas
> listas: cada linha é um pedido da v1, a decisão que o spec tomou e o que muda neste documento.
> **Nada aqui está pendente.** O que restou sem resposta está em §16.

### 12.1 Os seis pedidos de contrato da v1

| # | Pedido da v1 | Decisão do spec | Efeito no desenho |
|---|---|---|---|
| **1** | `rotuloNaoCompravel: string \| null` **dentro** do `ProdutoVitrine` | **RECUSADO** (Spec B, **RN-06**, e regra 2 do contrato de catálogo: o ponto de extensão é `compravel` + `motivoNaoCompravel`, **e só ele**). O rótulo viaja num mapa `rotulosVigencia: Record<produto_id, string>`, devolvido pela **mesma** função que devolve os produtos | **§4.1 reescrito.** O objetivo foi atendido — a frase continua pronta, do servidor, no fuso da loja. `SecaoCatalogo` recebe `rotulosVigencia` como prop **obrigatória**; o fallback de chave ausente é `"Indisponível no momento"` (§13.7). A forma é melhor que a pedida: o mapa é imune ao filtro da busca porque é chaveado por id |
| **2** | `economiaProdutos: number` no retorno de `revisarCarrinhoAction` | **CONCEDIDO** (Spec A, **RN-10-e**): o carrinho guarda só o preço efetivo, e pôr o preço de tabela no `sessionStorage` criaria um segundo número monetário no browser sem necessidade | **§6.3 mantido.** A linha "Você economizou R$ X,XX" existe. Se o número não vier, a linha **não é renderizada** — nunca calculada no cliente |
| **3** | `baseProdutos` e `baseOpcionais` no estado `parcial` | **CONCEDIDO** (Spec A, **RN-10-e**): `derivarBasesCupom` já somava as duas parcelas; passa a devolvê-las. Custo declarado: **zero**. Invariante `baseElegivel === arred2(baseProdutos + baseOpcionais)` no RED da fatia crítica 3 | **§6.4 mantido e destravado.** O disclosure "Como calculamos" existe, fechado por padrão, só no estado B. Some do desenho a frase "se o Spec A recusar" |
| **4** | Token de revisão (`revisaoId`) devolvido por `revisarCarrinhoAction` e exigido por `criarPedido` | **RECUSADO o mecanismo, ACEITO o objetivo** (Spec A, **RN-12-a** e §Fora do Escopo): entra `promocaoExibida: boolean` por item — booleano de exibição, assimétrico, sem HMAC, sem tabela nova, sem round-trip. *"Se um dia a reconfirmação precisar cobrir mais do que promoção, o token volta à mesa."* | **M9 e §7.1 reescritos.** A garantia continua sendo de **servidor**, não de componente: `true` afirmado × `false` apurado ⇒ recusa. As três travas de UI continuam (CTA fora do DOM, gate em `podeConfirmar`, número no rótulo do botão), agora com o servidor atrás delas |
| **5** | Projeção `promocaoVigente` + `rotuloPromocao` na page de `/painel/produtos` | **CONCEDIDO como projeção de Server Component** (Spec A, §Páginas — não é campo de banco, é o que a página projeta antes de entregar ao `ProdutosClient`) | **§8.4 mantido.** O chip da lista mostra `-20% até 30/09`; "vigente agora" **nunca** é derivado no browser (usaria o relógio do dispositivo, contra RN-03) |
| **6** | `previa: { total, nomes }` na Server Action de lote | **CONCEDIDO, e com mais garantias do que o pedido** (Spec B, **RN-09**/**RN-10**): a contagem e os nomes vêm do servidor sob RLS, e a escrita é um `upsert` homogêneo numa transação — id de outra loja viola `cardapio_produtos_produto_fk` e **derruba a operação inteira** | **§10.2 mantido e ampliado.** O diálogo não existe sem `previa`. Ganhou duas frases novas: os **dois números de D14** (do menu × exclusivos) e o aviso de produto oculto incluído pela RPC de categoria |

### 12.2 Os sete buracos de regra da v1

| # | Buraco da v1 | Decisão do spec | Efeito no desenho |
|---|---|---|---|
| **1** | dias da semana **E** dias do mês: interseção ou união? (diferença de 4 dias contra ~120 no ano) | **OU — regra fechada** (Spec B, **RN-02**). `{sáb,dom}` + `{1,15}` numa **quarta dia 15** ⇒ **ABERTO**. Os dois eixos acrescentam dias; o horário filtra dentro deles | **§9.2 e §9.5.** O **aviso não-bloqueante saiu** — não há ambiguidade a avisar. A prévia passa a dizer a regra por extenso, com a conjunção **"e também"**, que é onde os 120 dias ficam verificáveis |
| **2** | modo "repete sempre" sem nenhuma dimensão marcada | **PROIBIDO no banco**: CHECK `cardapios_recorrente_tem_eixo`, recusando `NULL` **e** `'{}'`; a Server Action normaliza array vazio para NULL (Spec B, RN-02) | **§9.6 deixou de ser recomendação.** A mensagem do form é a primeira barreira de um estado que o banco **não aceita**; o marcador "pendente" saiu. E a redação `Aparece sempre — este cardápio não tem janela` **saiu de §9.5**: é frase para um estado impossível |
| **3** | faixa de horário cruzando a meia-noite (22:00 → 02:00) | **FORA DO ESCOPO v1, por CHECK** (`cardapios_hora_ordem`), com erro explícito no form. O Spec B registra que o mesmo buraco existe hoje em `lojas.horarios` e lá é **mudo** — aqui é diagnosticável | **§9.6.** O bloqueio deixa de ser provisório ("enquanto a regra não existir") e passa a ser espelho de um CHECK. A pergunta de produto embutida (00:30 de domingo ainda é "sábado"?) **não precisa de resposta**, porque a configuração não é gravável |
| **4** | o que acontece quando o prazo fixo **termina** | **D14 + RN-13**: uma pergunta só decide — *existe próxima abertura conhecida?* Sem ela, o produto `visibilidade = 'cardapio'` **some da vitrine**; o produto `'menu'` **nunca some e nunca deixa de vender** | **§4.3 e §9.5.** A linha "prazo fixo encerrado" deixa de precisar de rótulo: **não há card**. A v1 tinha desenhado para a leitura (a) ("volta a ser produto normal"), que é o que D14 confirma **para o produto do menu** e nega para o exclusivo. O selo genérico continua existindo, mas só na revisão do carrinho (§13.7) |
| **5** | dia 31 em mês de 30 dias | **Não casa, e é a leitura literal** (Spec B, RN-02: *"é o que o preview tem de dizer ao lojista"*) | **§9.2, §9.5 e §9.6.** O botão "Último dia do mês" **saiu** (Fora do Escopo v1 do Spec B nomeia "último dia do mês" entre as regras de calendário recusadas) e foi substituído por uma **nota de efeito** ao lado da grade e por uma redação própria na prévia |
| **6** | "aplicar a uma categoria inteira" é foto ou vínculo? | **FOTO** (Spec B, **RN-10**): `insert ... select` **dentro** da transação, via RPC `aplicar_cardapio_em_categoria`, gravando vínculo por produto. Não existe relação cardápio↔categoria no modelo | **§10.2, trava 5.** A frase *"São os 12 produtos de Pizzas de hoje. Produtos criados depois não entram sozinhos."* deixa de expor ambiguidade e passa a **descrever o que o botão faz**. Acrescentada a nota de produto oculto, que a RPC inclui de propósito |
| **7** | D7 na comanda da cozinha colide com RN-P1 | **D12: selo, nunca valor.** `[PROMO]` depois do nome, **sem nenhum valor em reais**; RN-P1 **não é revertida** e os três testes de `ComandaCozinha.test.tsx:135-151` continuam verdes **sem edição** | **§11.2 e §13.6.** A recomendação da v1 foi acatada na direção certa: o par de/por não vai para a comanda. `ComandaCozinha.tsx` **sai** da lista "não tocar" e entra na de modificar, com um `it` novo que afirma o selo **e** a ausência de `R$` no mesmo teste |

### 12.3 Dois achados da v1 que viraram requisito

| Achado | Onde foi parar |
|---|---|
| Bug vivo de `disponivel` (modal se acha disponível; linha de lista sempre clicável) | **D13 / RN-19** — requisito do Spec A, corrigido **neste trabalho**, com o `tsc` como trava (M2) |
| Total de linha exibido ≠ cobrado quando `quantidade > 1` e há opcional | **D15 / RN-20** — era "dívida encostada" na v1; virou **fatia crítica 8** do Spec A, com `totalDaLinha` única e a invariante `Σ totalDaLinha === calcularSubtotal` no RED (§11.1) |

---

## 13. O que o Spec B delega ao desenho

> O Spec B fecha a regra e diz, em quatro pontos, que **a forma é deste documento**: o cabeçalho e o
> tratamento da seção de destaque (D16), o caso de muitas seções abertas, os rótulos e cores de
> estado do cardápio no painel (`BadgeStatus`) e a copy do que já está fixado. Nada abaixo inventa
> regra: cada item cita a regra que está obedecendo.

### 13.1 D16 — a seção de destaque do cardápio aberto

```
360px · topo do catálogo, ANTES da primeira categoria

  ┌───────────────────────────────────────────────┐
  │  Cardápio de Inverno          Até domingo     │ ← h2 + rótulo de janela
  │  ──────────────────────────                   │
  │  ┌──────────┐  ┌──────────┐                   │
  │  │  [foto]  │  │  [foto]  │                   │ ← MESMA grade do catálogo
  │  │ Lasanha  │  │  Sopa    │                   │   grid-cols-2 md:3 xl:4
  │  │ R$ 48,00 │  │ R$ 32,00 │                   │
  │  └──────────┘  └──────────┘                   │
  └───────────────────────────────────────────────┘

  ┌─ Massas ──────────────────────────────────────┐ ← a Lasanha aparece AQUI
  │  ┌──────────┐  ┌──────────┐                   │   também (D16-a)
```

**Sete decisões de forma, e o porquê de cada uma:**

1. **A seção é a mesma `<section>` das categorias, com o cabeçalho em `<h2>`** — mesmo peso, mesmo
   espaçamento, mesma grade (`grid-cols-2 md:grid-cols-3 xl:grid-cols-4`, design-system §9, **padrão
   fixo**). O Spec B diz que a seção de destaque renderiza como **grid** porque é vitrine; fazer dela
   um carrossel ou uma faixa com scroll horizontal criaria um terceiro layout de catálogo e esconderia
   produto atrás de um gesto — contra o design-system §9 ("nenhum scroll horizontal").
2. **O nome do cardápio é o texto do lojista, sem prefixo.** Nada de "Cardápio: Cardápio de Inverno".
   O lojista já nomeia; a UI não redecora. `TextoRealcado` **não** se aplica aqui (a busca não alcança
   o destaque, RN-16).
3. **Um rótulo de janela à direita do nome, curto, e é o único texto que o cabeçalho acrescenta.**
   `Até domingo` (prazo fixo em curso) · `Hoje, até as 15:00` (recorrente com horário) ·
   `Hoje` (recorrente sem horário). Sai de **`descreverVigencia`**, o mesmo módulo de M6 — **nunca**
   uma quarta redação de calendário escrita no componente. Limite: **20 caracteres**, senão quebra ao
   lado do nome em 360px.
   > **Por que dizer a janela aqui:** a seção **some sozinha** quando o cardápio fecha. Sem o rótulo,
   > o cliente que voltar às 15:01 não tem como saber que aquilo era temporário e não um erro.
4. **Nenhum badge de estado.** A seção só existe quando o cardápio está **aberto** (RN-15); um
   "Aberto agora" ali seria sempre verdadeiro, e badge sempre verdadeiro é ruído. O estado com badge
   é assunto do **painel** (§13.3).
5. **Âncora e pílula do trilho**, exatamente como o Spec B fixou em RN-16:
   - `id` da `<section>` e `href` do chip saem da **mesma** função, `ancoraSecao(secao, indice)`, que
     despacha para `ancoraCardapio(id)` (`cardapio-<uuid>`) ou para a `ancoraCategoria` **intocada**.
     Prefixos disjuntos por construção;
   - **a pílula é visualmente idêntica à de categoria.** Mesma altura de 44px, mesmo `aria-current`,
     mesmo scrollspy. A única diferença é a **posição**: as de destaque vêm **primeiro**, na ordem
     das seções (`cardapios.ordem` → `nome` → `id`);
   - o rótulo da pílula é o **nome do cardápio**, truncado por `max-w` com reticências — nunca
     abreviado por regra própria, que produziria "Card. de Inv." em uma tela e outro corte na outra;
   - `MINIMO_CATEGORIAS = 3` passa a contar as seções de destaque junto (RN-15, item 5): o trilho
     existe quando há o que navegar.
6. **`scroll-margin-top` igual ao das categorias.** A seção fica sob a barra fixa da vitrine pela
   mesma medida; um destaque que ancora dois pixels diferente do resto denuncia que é um caminho de
   código separado — e é o tipo de coisa que ninguém corrige depois.
7. **Produto de categoria "ocultar" aparece no destaque sem foto**, com o mesmo placeholder de
   gradiente que o grid já usa. É consequência direta da correção de RN-06 (o `foto_url` passa a ser
   zerado **por produto**, dentro da projeção): o produto viaja com **um** `foto_url` para onde for, e
   a URL escondida não volta ao payload pela segunda seção.

**Acessibilidade da duplicata.** O mesmo produto aparece duas vezes na página. Três consequências, e
nenhuma delas é "esconder de leitor de tela":

- o `<h2>` do destaque dá **contexto**: quem navega por cabeçalhos ouve "Cardápio de Inverno" antes
  dos cards, e entende por que a Lasanha volta a aparecer em "Massas";
- **nada é `aria-hidden`.** Esconder a cópia do destaque tiraria do cliente cego o caminho que o
  lojista criou de propósito;
- o **id de DOM** é escopado por seção (`idNaSecao`, RN-16), então nenhum `aria-labelledby` futuro
  pode apontar para dois elementos. A `key` do React **não muda** — `key` é local ao laço, e trocá-la
  remontaria o card à toa (RN-16).

### 13.2 Muitas seções de destaque abertas ao mesmo tempo

O Spec B **não impõe teto** ("um teto arbitrário esconderia um cardápio que o lojista ligou de
propósito") e manda explicitamente o `desenhar` tratar o caso. **O desenho também não inventa teto —
ele ataca o sintoma, que é o catálogo empurrado para baixo.** Quatro medidas, todas de forma:

1. **A seção de destaque mostra no máximo 6 produtos e depois uma linha de continuação.**
   `[ Ver os 14 produtos do Cardápio de Inverno ]`, um botão de 44px que **rola até a categoria** e
   não abre nada. Seis é o que cabe em três linhas de duas colunas em 360px sem que a primeira
   categoria saia da tela. O corte é **de render**, não de dado: os outros produtos continuam na
   categoria deles, que é a casa deles (D16-a).
   > **Por que isto não é o "filtro por cardápio" recusado pelo Spec B:** não muda a navegação, não
   > esconde nada e não é subtrativo — é a mesma vitrine, com menos rolagem antes do cardápio comum.
2. **A partir da terceira seção aberta, as seções seguintes entram colapsadas**, com cabeçalho
   visível e conteúdo revelado por um `<button aria-expanded aria-controls>` de 44px. Cabeçalho e
   âncora continuam existindo, então a pílula do trilho **nunca** leva a uma seção que não existe.
   Três é o número de cabeçalhos que cabem acima da dobra em 360px sem esconder o catálogo.
3. **O trilho não estoura.** Ele já rola horizontalmente e já tem `MINIMO_CATEGORIAS`; com seis
   cardápios abertos as pílulas de destaque ocupariam a largura inteira antes da primeira categoria.
   Regra: **as pílulas de destaque não podem ocupar mais que ~70% da largura visível do trilho**; a
   partir daí o trilho começa rolado o suficiente para mostrar **a última pílula de destaque e a
   primeira de categoria juntas** — o cliente vê que existe catálogo além do destaque.
4. **Nada disso é decidido no cliente por medição.** "Quantas seções abertas" é um número que o SSR
   já tem (`cardapiosAbertos.length`, RN-06). Medir largura no browser para decidir layout é o tipo
   de coisa que quebra na hidratação e não é testável aqui.

> **Nota para o `acelerar`, não para o `executar`:** o Spec B já registra que o catálogo duplicado
> tem custo de payload e pede medição **depois** do `executar`. O corte de 6 acima reduz o render,
> **não** o payload — e reduzir payload por corte seria decidir no servidor o que o cliente pode
> buscar, o que a regra da busca (RN-16) não permite.

### 13.3 Estado do cardápio no painel — `BadgeStatus`, sem cor nova

O Spec B manda reusar `BadgeStatus` e diz que *"os rótulos/cores exatos são do agente `desenhar`"*.
**Nenhuma cor nova é inventada:** os quatro estados caem no mapa semântico que o design-system §8 já
fixou, e cada um leva **cor + texto**, nunca cor sozinha (WCAG 1.4.1).

| Estado do cardápio | Texto exibido | Cor (§8) | Racional |
|---|---|---|---|
| aberto agora | **`Aberto agora`** | **verde** | é literalmente o mesmo rótulo e o mesmo significado do status da loja na vitrine (§8.1): disponível neste instante. Reusar a palavra é o ponto — o lojista já aprendeu o que ela quer dizer |
| fechado, com próxima abertura | **`Abre sábado às 11:00`** | **cinza/neutro** | mesma razão do "Fechado" da loja: **ausência de atividade, não erro**. O horário vem de `proximaAbertura` (RN-07), no fuso da loja, do servidor |
| prazo fixo terminando | **`Expira em 3 dias`** | **âmbar** | mesma semântica de `pendente` em §8.2: **requer ação do lojista**. Aparece a partir de 7 dias do fim; abaixo de 24h vira `Expira hoje às 23:59` |
| expirado ou desligado sem volta | **`Expirado`** / **`Desligado`** | **cinza/neutro** | é estado terminal, não falha. O vermelho fica **fora**: nada quebrou, e vermelho num cardápio de temporada encerrada ensina o lojista a ignorar vermelho. O que precisa de atenção é o **aviso de RN-12** ao lado (§13.4), que é âmbar e traz número |

Quatro regras que valem para os quatro:

1. **O texto carrega a informação inteira.** Nenhum estado depende da cor para ser entendido — é o
   critério do próprio `BadgeStatus` (design-system §8).
2. **"Aberto agora" ganha a frase de efeito que o Spec B pediu:** logo abaixo do badge, em
   `text-xs text-texto-muted`, *"aparecendo como seção no topo da sua loja"*. É RN-12 ao contrário —
   o lojista precisa saber o que o cliente está vendo.
3. **O estado é SSR, recalculado a cada render.** Nunca um `setInterval` que "atualiza o badge": um
   relógio no browser diria a hora do dispositivo, e o Spec B é explícito que o cliente (aqui, o
   painel) **nunca** decide se um cardápio está aberto.
4. **`aria-label` completo quando o rótulo é abreviado.** `Abre sábado às 11:00` já é autoexplicativo;
   `Expira em 3 dias` ganha `aria-label="Expira em 3 dias, em 23/09 às 23:59"`.

### 13.4 O aviso de RN-12 — o único lugar onde o sumiço é observável

Com D14, o produto exclusivo de um cardápio expirado **some da vitrine** e o lojista não tem como
descobrir isso olhando a loja. O Spec B diz: *"o painel é o único lugar do sistema onde esse estado é
observável"*. Por isso este aviso **não é um toast e não é dispensável**.

```
/painel/cardapios — na linha do cardápio

  ┌───────────────────────────────────────────────┐
  │  Cardápio de Inverno            [ Expirado ]  │
  │                                               │
  │  ⚠ 4 produtos sumiram da vitrine              │ ← âmbar, texto + ícone
  │    Eles são exclusivos deste cardápio.        │
  │    Outros 7 produtos do menu continuam        │ ← o segundo número
  │    aparecendo e vendendo normalmente.         │
  │                                               │
  │  [ Religar o cardápio ]                       │ ← as duas saídas, 44px
  │  [ Devolver os 4 ao menu ]                    │
  └───────────────────────────────────────────────┘
```

1. 🔴 **Os dois números aparecem sempre que os dois existem**, e nesta ordem: **primeiro o que
   sumiu**, depois o que continua vendendo. O número que dói vem antes do número que tranquiliza —
   invertido, o lojista lê "7 continuam vendendo" e fecha a tela.
2. **Os dois vêm de `contarProdutosEscondidos`** (função pura, RN-12), não de contagem no componente.
   É preview de UX: nenhuma decisão depende do número, mas ele é **testável sem jsdom**, que é a única
   forma de travar texto neste repo.
3. **As duas saídas são as que o spec nomeia** — religar/estender o cardápio, ou devolver os produtos
   ao menu — e **nenhuma das duas roda sozinha**. "Devolver os 4 ao menu" abre o `AlertDialog` de
   confirmação nomeando os 4; o sistema **nunca** converte `visibilidade` por conta própria (RN-12:
   *"um conversor automático venderia sopa de cebola em dezembro"*).
4. **Âmbar, não vermelho** — mesma razão de §13.3: requer ação, não é falha. Ícone **+ texto**, nunca
   só a cor.
5. **O mesmo aviso, reduzido, na linha do produto em `/painel/produtos`:**
   *"sumiu da vitrine — o cardápio Cardápio de Inverno expirou"*, com o mesmo âmbar e o mesmo par de
   saídas no kebab da linha.

**Os dois diálogos que carregam os mesmos dois números** (copy fixada pelo Spec B, transcrita):

| Gesto | O diálogo diz | Desfecho |
|---|---|---|
| **Desligar** o cardápio (`Switch`) | *"N produtos **do menu** continuam aparecendo e vendendo normalmente."* + *"M produtos são **exclusivos deste cardápio** e vão **sumir da vitrine**."* | **permitido** — é o gesto legítimo de guardar o cardápio de inverno até o ano que vem. Reversível com um clique, e listado no aviso acima |
| **Remover** o cardápio | as mesmas duas frases + a saída a um clique **"converter os M para o menu"** | **RECUSADO** enquanto existir exclusivo (RN-14). A recusa não é um beco: a saída está **dentro** do diálogo |

- `AlertDialog` nos dois (design-system §6: ação destrutiva sempre diz o que será afetado).
- O `Switch` de desligar **não** pode ter ajuda dizendo "os produtos voltam a vender" — é exatamente
  a frase que RN-03 proíbe, porque é falsa para o exclusivo.
- A recusa da remoção aparece **no mesmo diálogo**, não como toast depois do clique: o lojista precisa
  ver o motivo e a saída no lugar onde tomou a decisão.

### 13.5 D14 — `visibilidade` no form e na lista

**Copy fixada pelo Spec B, transcrita, não reescrita.**

```
  ┌─ Onde este produto aparece ───────────────────┐
  │  (•) Aparece sempre no meu menu               │  ← RadioGroup, itens 44px
  │      Continua vendendo mesmo quando um        │
  │      cardápio dele fecha ou expira.           │
  │                                               │
  │  ( ) Só aparece quando um cardápio dele       │
  │      estiver aberto                           │
  │      Fora da temporada, ele some da vitrine.  │
  └───────────────────────────────────────────────┘
```

1. **`RadioGroup`, não `Switch`.** São duas opções nomeadas, ambas legítimas e permanentes — não é
   ligar/desligar. Mesma escolha de §8.1 para percentual × reais, e é o que o Spec B já prevê
   (*"um `RadioGroup` de duas opções"*). `Select` continua não existindo em `components/ui/`.
2. **As duas primeiras linhas são literais do Spec B** (*"Aparece sempre no meu menu"* × *"Só aparece
   quando um cardápio dele estiver aberto"*) — copy que o lojista consegue verificar sozinho, nunca
   `'menu'`/`'cardapio'`. A segunda linha de cada opção é deste desenho e diz **a consequência**, que
   é o que a escolha realmente decide.
3. **O default é "Aparece sempre no meu menu"**, igual ao default da coluna e ao `zod`
   (`z.enum(["menu","cardapio"]).default("menu")`). Form antigo e payload sem o campo continuam
   produzindo o comportamento de hoje.
4. 🔴 **Marcar "só no cardápio" num produto que não está em nenhum cardápio é RECUSADO** (RN-14,
   trigger no banco). O form não esconde a opção — ele **explica a recusa e oferece a saída**:
   *"Este produto não está em nenhum cardápio. Escolha um cardápio antes, ou deixe-o no menu."* com o
   atalho `[ Escolher um cardápio ]`. Esconder a opção produziria a pior versão do erro: o lojista
   procura um controle que sumiu.
5. **Badge na lista de produtos**, ao lado do `badgeStatus(p)` que já existe:
   `Badge variant="secondary"` com **`Exclusivo de cardápio`** — e **nada** para o produto do menu,
   que é o default e não merece ruído em toda linha. O badge é texto + cor de sistema (nunca cor do
   tema), como o Spec B pede.
6. **Na lista de produtos do cardápio** (`SeletorProdutosDoCardapio`), o mesmo badge aparece por
   produto: é essa diferença que decide o que acontece quando o cardápio fechar, e é onde o lojista
   está olhando quando decide.

### 13.6 D12 — o selo `[PROMO]` na comanda da cozinha

```
  via térmica da COMANDA (80mm) — ZERO informação financeira (RN-P1)

  2× Pizza Margherita [PROMO]
     + Borda recheada
     Obs: sem cebola

  1× Refrigerante
```

1. **`[PROMO]`, depois do nome, dentro do mesmo elemento** — rótulo fixado por **RN-14-a**, não
   escolhido aqui. **Nenhum valor em reais, nenhum percentual, nenhum código de cupom.**
2. **Os colchetes não são decoração:** o `]` impede que um dígito vizinho encoste em `PROMO` e forme
   `PROMO10` por acidente de markup — a linha já renderiza `{item.quantidade}×` num `<span>` ao lado.
3. **Forma no papel:** mesmo tamanho do nome, **sem negrito**, separado por um espaço. Na térmica não
   existe cor e `line-through` some (§11.3); o selo vive de **posição e literal**. Ele **não** pode
   competir com nome e quantidade, que é o que a cozinha lê.
4. **Se for preciso texto acessível, é *"Item em promoção"***, nunca *"Item com desconto"*: a palavra
   `desconto` entra no HTML pelo `aria-label` e **derruba o teste 2** de RN-P1.
5. **O teste novo é um `it` só, com as duas asserções juntas** (`toContain("[PROMO]")` **e**
   `not.toContain("R$")`), exatamente como RN-14-a manda — separadas, alguém conserta uma e a outra
   fica órfã.

### 13.7 O fallback "Indisponível no momento" na revisão do carrinho

Na vitrine, este texto é **defensivo**: por RN-13, todo produto que chega marcado tem uma volta a
anunciar. Na **revisão do carrinho** ele é **caso real de negócio** — o item da temporada encerrada
existe no carrinho de alguém e não tem data para prometer (RN-06, RN-13).

```
  EtapaItens — linha bloqueada

  ┌───────────────────────────────────────────────┐
  │  Sopa de cebola                               │
  │  Indisponível no momento                      │ ← texto, não badge de erro
  │  R̶$̶ ̶3̶2̶,̶0̶0̶                       [ Remover ] │ ← 44px, ação óbvia
  └───────────────────────────────────────────────┘

  [ Finalizar pedido ]   ← BLOQUEADO enquanto houver linha assim
```

1. **A linha nunca é omitida.** O Spec B é explícito: *"item que a revisão não encontra no banco é
   tratado como não comprável, nunca ignorado"* — sumir da conta seria alterar o carrinho do cliente
   por omissão. O preço da linha fica riscado e **fora do subtotal**.
2. **"Indisponível no momento", e só.** Sem "erro", sem "desculpe", sem vermelho, sem `role="alert"` —
   mesma regra de copy de §7. O produto saiu de temporada; não é falha e não é culpa do cliente.
3. **A saída é uma só e está na linha:** `[ Remover ]`, 44×44, com `aria-label` completo
   (*"Remover Sopa de cebola do carrinho"*). Não há "tentar de novo" — não existe tentativa que
   mude o resultado.
4. **O bloqueio mora em `podeConfirmar`** (`checkout/estado.ts`), com a condição nova *"nenhum item
   bloqueado"* (Spec B, §Componentes do checkout), **uma vez**, cobrindo wizard e desktop. O botão
   desabilitado é cortesia; a autoridade é `criarPedido` (RN-08).
5. **Anúncio uma vez, não por linha:** um `role="status" aria-live="polite"` no topo da etapa —
   *"1 item não está disponível agora e precisa ser removido."* — em vez de cada linha gritar
   sozinha.

---

## 14. Inventário — o que o `executar` cria, modifica e não toca

> Atualizado para a v2: nomes do Spec A (§0.1), `ComandaCozinha` saiu de "não tocar" (D12),
> `calcularTotal.ts` saiu de "não tocar" (D15/RN-20) e entraram as superfícies do Spec B.

### Criar

| Arquivo | O quê | Mecanismo |
|---|---|---|
| `components/vitrine/PrecoProduto.tsx` | par de preços, 4 superfícies | M1, M2 |
| `components/vitrine/SeloDesconto.tsx` | chip de **promoção** (nome do Spec A; sem tom de indisponibilidade — §0.1) | M1, M3 |
| `components/vitrine/ModalPromocoes.tsx` | modal de abertura (D6) | §5 |
| `components/vitrine/decisaoModalPromocoes.ts` | decisão pura (RN-16 do Spec A) | §5.2 |
| `lib/utils/rotuloPrecoAcessivel.ts` | frase do leitor de tela | M1 |
| `lib/utils/copiaCupom.ts` | as 3 redações literais de RN-10-e | **M5** |
| `lib/utils/copiaRevisaoPreco.ts` | textos do D11, sem linguagem de erro | M5 |
| `lib/utils/descreverVigencia.ts` | prévia do painel, rótulo da vitrine **e** o rótulo de janela do cabeçalho de D16 (§13.1) | **M6** |
| `lib/utils/copiaLotePromocao.ts` | pergunta e rótulo de confirmação do lote, incluindo os **dois números de D14** (§10.2) | M5, M8 |
| `lib/utils/linhaItemPedido.ts` | helper `LinhaItemPedido` — par de/por, 4 superfícies (RN-14) | M3 |
| `lib/utils/copiaCardapioPainel.ts` | rótulos de `BadgeStatus` (§13.3) e o aviso de RN-12 com os dois números (§13.4) — **pura, testável sem jsdom**, como `contarProdutosEscondidos` exige | M5, M6 |
| `components/ui/alert-dialog.tsx` | **via `npx shadcn add alert-dialog`** — não escrever à mão | §Gate |

### Modificar

**Spec A:** `CardProduto`, `ItemProdutoLista`, `ProdutoModal`, `SecaoCatalogo`, `VitrineClient`,
`checkout/ResumoValores`, `checkout/EtapaItens`, `checkout/estado.ts` (`podeConfirmar`),
`Carrinho`, `painel/FormProduto`, `painel/ProdutosClient`, `painel/DetalhePedido`,
`painel/ReciboCliente`, `lib/utils/whatsappPedido.ts`,
`(publica)/loja/[slug]/confirmacao/page.tsx`, `app/globals.css` (5 tokens),
`(painel)/painel/(bloqueavel)/configuracoes/perfil` (toggle do modal).

**Entraram na v2:**

| Arquivo | Por quê |
|---|---|
| `components/painel/ComandaCozinha.tsx` | **D12** — selo `[PROMO]` depois do nome, sem valor (§13.6). Os três testes de RN-P1 continuam **sem edição**; entra **um `it` novo** |
| `lib/utils/calcularTotal.ts` | **D15/RN-20** — `totalDaLinha` extraída ao lado de `calcularSubtotal`, consumida pelas 4 superfícies. Critério: a suíte atual passa **sem edição** |
| `components/vitrine/CatalogoVitrine.tsx` | **D16** — prop `secoesDestaque` **separada** de `categorias` (trava de RN-16) |
| `components/vitrine/NavCategorias.tsx` | **D16** — pílulas de destaque primeiro; `CategoriaNavegavel` ganha `tipo` (§13.1) |
| `lib/utils/ancoraCategoria.ts` | **D16** — ganha `ancoraCardapio` e o despachante `ancoraSecao`; a função atual fica **intocada, byte a byte** |
| `app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx` | modo seleção (D2) **+** badge `Exclusivo de cardápio` e o aviso reduzido de RN-12 (§13.4, §13.5) |

**Telas novas do Spec B, cuja forma este documento define:** `/painel/cardapios` (`CardapiosClient`,
§13.3 e §13.4) e `/painel/cardapios/[cardapioId]` (`FormVigencia` + `PreviewVigencia` +
`SeletorProdutosDoCardapio`, §9).

### Não tocar

- `components/ui/*` — gerados pelo CLI (o único acréscimo é gerar `alert-dialog`).
- `ComandaCozinha.test.tsx` — os três testes de RN-P1 continuam verdes **sem edição**; o teste novo
  é **acrescentado**, nunca substitui (RN-14-a).
- `paraLinhaPedido.ts` / `TabelaPedidos` — §11.4 (o Spec A confirma a exclusão).
- `agruparCatalogo` além da generalização de tipo — a suíte atual passa **sem edição** (RN-15).
- `filtrarCatalogo` / `contarProdutos` — a seção de destaque **nunca** entra na lista que eles
  recebem; a trava é ausência, não filtro (RN-16).
- `ancoraCategoria` (a função atual) e a `key` dos cards — RN-16.
- As regras `@media print` de `globals.css` — o par de/por e o `[PROMO]` são markup comum dentro de
  bloco existente.
- `specs/*` — contrato fechado; em conflito, o spec vence e o desenho se ajusta (§0, §12).

### Ordem sugerida (o que destrava o quê)

1. Tokens (`globals.css`) + `SeloDesconto` + `PrecoProduto` + `rotuloPrecoAcessivel` — destrava as 4
   superfícies da vitrine de uma vez.
2. `SecaoCatalogo` passando o **objeto inteiro** (M2) — fecha o bug de `disponivel` (D13/RN-19) de
   passagem.
3. `totalDaLinha` (RN-20) **antes** de `LinhaItemPedido` — o par de/por convive com um total que já
   está certo (§11.1).
4. `LinhaItemPedido` + as 4 superfícies de exibição (D7) + `[PROMO]` na comanda (D12, §13.6).
5. `FormProduto` (bloco Promoção + superfície de erro do D10) — depende do `superRefine` do
   `schemaProduto`.
6. `copiaCupom` + `ResumoValores` + `EtapaItens` — depende do `estadoCupom` da Server Action.
7. `ModalPromocoes` + `decisaoModalPromocoes` + toggle no perfil.
8. `copiaRevisaoPreco` + `podeConfirmar` (D11) — depende de `promocaoExibida` no payload (RN-12-a).
9. `descreverVigencia` + form de vigência (§9) + lote (§10) — Spec B, fatias 8 a 13.
10. `visibilidade` no form e na lista (D14, §13.5) → aviso de RN-12 (§13.4) → seção de destaque e
    pílulas (D16, §13.1 e §13.2). **§13.1 depois de §4**: as duas tocam `SecaoCatalogo` e
    `CardProduto`, e o Spec B é explícito que as fatias 14 e 19 **nunca** andam em paralelo.

---

## 15. Checklist de aceite deste desenho

Marcável por leitura de código, já que não há teste de DOM neste repo.

**Vitrine e preço (Spec A):**

- [ ] `grep -r "precoEfetivo <" src/components/` **não devolve nada** — nenhum componente decide se há
      desconto (M3).
- [ ] `grep -rn "disponivel?:" src/components/vitrine/` **não devolve nada** — sem prop opcional de
      comprabilidade (M2).
- [ ] `grep -rn "base elegível\|base elegivel" src/components/vitrine/` **não devolve nada** — jargão
      proibido na vitrine (§6.4).
- [ ] `grep -rn "setTimeout\|onPointerDown\|onTouchStart" src/components/vitrine/ModalPromocoes.tsx`
      **não devolve nada** (§5.1, §5.2).
- [ ] `grep -rn "cor-primaria\|cor-destaque\|cor-fundo" src/components/vitrine/SeloDesconto.tsx`
      **não devolve nada** — o selo não lê o tema da loja (§2).
- [ ] `grep -rn "min-h-11\|size=\"icon-sm\"" ` nos arquivos novos **não devolve nada** — 44px literal
      (design-system §5).
- [ ] as três frases de RN-10-e existem **literais** em `lib/utils/copiaCupom.ts` e têm teste que as
      afirma byte a byte.
- [ ] `grep -rn "SeloVitrine\|linhaDePor" src/` **não devolve nada** — os nomes da v1 não chegaram ao
      código; valem `SeloDesconto` e `LinhaItemPedido` (§0.1).

**Vigência e cardápio (Spec B):**

- [ ] `descreverVigencia.ts` é importado **pelo painel, pela projeção da vitrine e pelo cabeçalho da
      seção de destaque** — três consumidores, uma redação (M6, §13.1).
- [ ] `grep -rn "Último dia do mês" src/` **não devolve nada** — está em Fora do Escopo v1 do Spec B
      (§9.2, §12.2 buraco 5).
- [ ] o botão "+" do card não-comprável está **`disabled`** (Spec B) **e** com `pointer-events-none`,
      e o card continua abrindo o modal (§4.2).
- [ ] `filtrarCatalogo` e `contarProdutos` são chamados **só** com `categorias` — a seção de destaque
      não aparece em nenhuma chamada dos dois (RN-16).
- [ ] nenhum componente monta `id={produto.id}` — o único produtor de id de DOM é `idNaSecao`
      (RN-16).
- [ ] o `Switch` de desligar cardápio **não** contém a frase "voltam a vender" em lugar nenhum
      (RN-03, §13.4).
- [ ] o aviso de RN-12 imprime **os dois números**, e os dois vêm de `contarProdutosEscondidos`
      (§13.4).
- [ ] a copy das duas opções de `visibilidade` é **literal** do Spec B (§13.5).

**Pedido e impressão:**

- [ ] `ComandaCozinha.test.tsx` — os três testes de RN-P1 continuam verdes **sem edição**, e existe
      **um `it` novo** com `toContain("[PROMO]")` e `not.toContain("R$")` juntos (§13.6).
- [ ] `grep -rn "preco_original" src/components/ src/app/` só aparece **dentro** de
      `lib/utils/linhaItemPedido.ts` — nenhuma superfície tem `if` próprio (§11.1).
- [ ] as quatro superfícies de total de linha chamam `totalDaLinha`; `calcularTotal.test.ts` passa
      **sem edição** e a invariante `Σ totalDaLinha === calcularSubtotal` tem teste (RN-20).
- [ ] o payload de `criarPedido` ganhou **só** `promocaoExibida: boolean` por item — nenhum campo
      monetário novo, `.strict()` intacto (RN-12-a, M9).

**Do documento:**

- [ ] este desenho **não introduziu nenhuma regra de negócio nova**: §12 mostra, linha a linha, qual
      spec decidiu o quê, e o que sobrou está em §16 com o caso concreto.
- [ ] nenhum conflito com os specs continua aberto: os dois de §4.2 e §9.2 foram resolvidos **a favor
      do spec**.

---

## 16. Pendências para o spec

> Regra do documento: se algo continua sem resposta nos specs, ele é **listado aqui com o caso
> concreto**, nunca preenchido no desenho. Nenhum item abaixo bloqueia o `quebrar`: todos têm uma
> degradação declarada, e nenhuma delas é "decidir no componente".

| # | O caso concreto | Por que o desenho não decide | O que a UI faz enquanto não há resposta |
|---|---|---|---|
| **P1** | **Cabeçalho da seção de destaque quando o cardápio abre e fecha no mesmo dia.** "Almoço executivo", seg–sex 11:00–15:00, olhado às 14:58: o rótulo de §13.1 diz `Hoje, até as 15:00`. Às 15:01 a seção **some** com o cliente olhando a tela (a vitrine é dado vivo, sem cache, e a próxima navegação rerenderiza). O cliente que tinha a Lasanha na tela vê a seção sumir sem explicação | "avisar que a seção vai fechar" é **regra de produto** (quantos minutos antes? avisa ou não avisa?), não forma. Inventar um aviso de 10 minutos seria criar comportamento que nenhum D cobre | Nada: a seção some. O produto continua **na categoria dele** (D16-a), e se estiver fora da janela aparece **marcado**, com o selo de quando volta (D4) — o cliente não fica sem caminho, só sem aviso prévio |
| **P2** | **Ordem entre "Expira em 3 dias" e o aviso de RN-12 quando os dois valem.** Cardápio de prazo fixo que expira em 2 dias **e** já tem produtos exclusivos sumidos de um período anterior desligado. §13.3 e §13.4 definem os dois elementos, mas não qual manda quando aparecem juntos na mesma linha | é prioridade de atenção do lojista — pergunta de produto, não de layout | Os dois aparecem: badge âmbar `Expira em 2 dias` **e**, abaixo, o aviso de RN-12 com os dois números. Nada é escondido; o que falta é saber se um deles deveria calar o outro |
| **P3** | **Teto de produtos por seção de destaque.** §13.2 corta o render em **6 produtos** + `[ Ver os 14 produtos ]`. O Spec B recusa **teto de seções**, mas não fala de teto de **produtos dentro** de uma seção | 6 é decisão de forma (cabe em 360px sem empurrar a primeira categoria) e está dentro do que o desenho decide — **mas** se o dono do produto entender que o destaque tem de mostrar o cardápio inteiro, isso é regra de produto e o corte sai | O corte de 6 fica, com o botão de continuação que **rola até a categoria** e não esconde dado nenhum |
| **P4** | **`descontoFim` no contrato de catálogo não tem consumidor na vitrine.** O Spec A declara o campo como "só exibição", e este desenho **não o usa** em nenhuma das quatro superfícies: "-20%" cabe na pílula, "-20% até 30/09" não cabe em 168px | acrescentar "até 30/09" ao selo da vitrine é decisão de produto (urgência ajuda a vender? polui?), e o campo já trafega ao cliente de qualquer jeito | O selo da vitrine mostra só a economia; **o prazo aparece no painel**, na lista de produtos (`-20% até 30/09`, §8.4), que é onde o lojista pergunta "ainda está valendo?" |

