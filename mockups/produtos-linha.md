# Mockup — linha de produto em `/painel/produtos`

**Escopo:** a linha de produto na lista do painel do lojista. Antes (como está) × depois
(proposta), em desktop (920px) e mobile (360px), mais o estado de edição inline.

**Preview no navegador:**
- `mockups/produtos-linha-desktop.html`
- `mockups/produtos-linha-mobile.html`

> Mundo: **painel**, não vitrine. O tema por loja (`lojas.tema` → `primaria`/`fundo`/`destaque`)
> **não se aplica aqui** — o painel usa a superfície fixa de `design-system.md` §10
> (creme `#f5f0e6`, card branco, limite `#8a8a8a`). Por isso os HTMLs não têm config de
> cor de loja: seria cor inventada num mundo que não a consome.
>
> Os HTMLs usam CSS puro recriando os primitivos shadcn (`.card`, `.chip`, `.btn`,
> `.switch`, `.input`), sem CDN, para abrirem offline. Base de fonte em **120%**, como
> `globals.css`, para que os 44px apareçam na proporção real.

---

## Gate de reuso

- **shadcn/ui varridos** (`src/components/ui/`): `button`, `badge`, `card`, `menu`, `dialog`,
  `sheet`, `accordion`, `checkbox`, `input`, `label`, `separator`, `switch`, `textarea`,
  `alert-dialog`, `radio-group`
- **Componentes do painel**: `ThumbProduto`, `FormProduto`, `GerenciarCategorias` (já tem
  edição inline), `LinhaItemOpcional` (estado `leitura → confirmando` na própria linha),
  `LinhaCategoriaReordenavel`, `CartaoAssociacaoOpcionais`, `BarraSelecaoLote`, `BadgeStatus`
- **Tokens** (`globals.css` `@theme`): `--color-promo-texto`, `--border`/`.superficie-painel`
- **Telas comparadas**: `CuponsClient.tsx`, `OpcionaisClient.tsx`, `CardapioAdminClient.tsx`

**Decisão: CONSOLIDAR** (redesenho da linha) + **CRIAR** uma Server Action estreita, só se a
edição inline for aprovada.
**Justificativa:** o padrão de edição inline já existe em `GerenciarCategorias.tsx:185-215`;
o defeito da linha é excesso de elementos causando wrap, não falta de componente.

---

## 1. Como está — desktop 920px

```
┌─ Pães ─────────────────────────── ^   ⚙ Opcionais   ＋ Novo produto ─┐
│ [img] Pão de campanha    (Coloração)(Antipasti)(Bebidas) [Ocultar][Disponibilizar]
│       R$ 30,00 (Esgotado)
│  [⋮]                       ← 1: órfão, linha própria, ancorado à ESQUERDA
│                            ← 4: ~50px de banda morta
│ [img] Pão italiano       (Coloração)(Antipasti)(Bebidas) [Ocultar][Disponibilizar]
│       R$ 30,00 (Esgotado)
│  [⋮]
└──────────────────────────────────────────────────────────────────────┘
```

### Por que o kebab quebra (não é acaso)

`ProdutosClient.tsx:886-1140`. A linha é `flex flex-wrap` e o kebab é
`order-3 sm:order-last` (**linha 1014**). No desktop a ordem fica thumb → texto → chips →
botões → kebab, e a soma das larguras mínimas estoura:

| Filho | Largura mínima | Encolhe? |
|---|---|---|
| `ThumbProduto` | 44px | não (`flex: none`) |
| bloco nome/preço | `sm:min-w-[14rem]` ≈ 269px na base de 120% | até o piso |
| `<ul>` de 3 chips | ~250px | **não** |
| par de botões | ~280px | não |
| kebab | 44px | não |

Total acima da largura útil do card → o **último item da ordem** (o kebab) forma uma
segunda linha de flex e, com `justify-content` padrão, ancora à esquerda. Daí as duas
queixas juntas: o ⋮ do "Pão de campanha" fica mais perto do "Pão italiano" (marca 1) e
sobra a faixa vazia (marca 4).

### Como está — mobile 360px

Três faixas por produto, porque o kebab entra em `order-3`, antes dos chips:

```
[img] Pão de campanha                        [⋮]      ← faixa 1
      R$ 30,00 (Esgotado)
(Coloração)(Antipasti)(Bebidas)                       ← faixa 2  (w-full)
[   Ocultar   ][   Disponibilizar   ]                 ← faixa 3  (basis-full, flex-1)
```

Ordem de leitura: nome → ⋮ → chips → ações. Dois produtos consomem a tela inteira.

---

## 2. Proposta

### 2.1 Chips de opcionais sobem para o cabeçalho da categoria

Eles vêm de `opcionaisPorCategoria[p.categoria_id]` (`ProdutosClient.tsx:1071-1092`) — são
atributo da **categoria**, idênticos em toda linha do grupo. Quatro produtos × 3 chips = 12
chips dizendo 3 coisas. Subindo para o cabeçalho, ao lado do botão "Opcionais" que já
gerencia isso:

- some o único filho da linha que **não encolhe** → **o wrap do kebab acaba sozinho**;
- marcas 1 e 4 morrem juntas, sem tocar em regra de negócio;
- no mobile, some uma faixa inteira por produto.

**Bônus de acessibilidade:** a `<ul>` de chips hoje não tem rótulo acessível — um leitor de
tela anuncia "lista, 3 itens" sem dizer de quê. No cabeçalho, o texto "Opcionais:" resolve.

### 2.2 Kebab e estado viram um grupo de ação ancorado à direita

`display:flex; flex:none; margin-left:auto`. Se algum dia quebrar, quebra à direita, junto
do produto dele. `order-last` nos dois breakpoints — o kebab para de vir antes do conteúdo
no mobile.

### 2.3 Editar vira a ação primária

O bloco nome+preço passa a ser o gatilho:

```tsx
<button aria-label={`Editar ${p.nome}`} onClick={() => abrirEditar(p)}>
```

Hoje trocar um preço custa **3 toques** (⋮ → Editar → modal) e abre um `FormProduto` de
764 linhas com foto, desconto e vigência. O kebab desce para `variant="ghost"` e guarda só
o raro e o destrutivo: Remover, Devolver ao menu, Religar/Estender, Marcar esgotado.

### 2.4 Os dois botões viram um `Switch` "Na vitrine"

São dois eixos independentes com forma idêntica hoje. Proposta:

| Eixo | Onde fica | Por quê |
|---|---|---|
| `oculto` | `Switch` "Na vitrine" na linha | estado permanente visível; rótulo que alterna ("Ocultar"/"Exibir") obriga a inferir o estado atual pelo texto do botão |
| `disponivel` | item "Marcar esgotado" no kebab | ação pontual, não estado a monitorar |

O `Switch` já existe em `src/components/ui/switch.tsx` — nada novo.

**Alternativa conservadora**, se preferir não mexer no comportamento: mantém os dois
botões, só rebaixa para `variant="ghost"` e tira o `flex-1` do mobile. Resolve a hierarquia
sem mudar o modelo de interação.

### 2.5 O estado deixa de ter a forma do ruído

Hoje `badgeStatus` e os chips de opcionais são **a mesma pílula cinza**
(`Badge variant="secondary"` nos dois). Proposta: estado vira ponto colorido + texto
(cor **e** texto, WCAG 1.4.1 — nunca cor sozinha); procedência (cardápios, "Exclusivo de
cardápio", promoção) fica em pílulas `outline` menores, subordinadas; o aviso âmbar de
RN-12 segue como hoje e passa a ser o único elemento âmbar da linha.

### Desktop proposto

```
┌─ Pães ─── ^  ⚙ Opcionais: Coloração · Antipasti · Bebidas  ＋ Novo produto ─┐
│ [img] Pão de campanha            ● Esgotado    [ Na vitrine (o──) ]   [⋮]
│       R$ 30,00
│ [img] Pão italiano               ● Esgotado    [ Na vitrine (o──) ]   [⋮]
│       R$ 30,00
│ [img] Focaccia bianca            ● Esgotado    [ Na vitrine (o──) ]   [⋮]
│       R$ 25,00  ⌐Pães · seg-sex¬  ⌐-20% até 30/09¬
└─────────────────────────────────────────────────────────────────────────────┘
```

Quatro produtos cabem onde hoje cabem dois e meio.

### Mobile 360px proposto

```
⚙ Opcionais: Coloração · Antipasti · Bebidas     ← uma vez, no cabeçalho

[img] Pão de campanha                        [⋮]
      R$ 30,00  ● Esgotado
                          [ Na vitrine (o──) ]

[img] Focaccia cipolla e oliva               [⋮]
      R$ 25,00  ○ Oculto
      ⌐ Pães · seg-sex · fora da janela agora ¬
      ⚠ Sumiu da vitrine: o cardápio Pães está fora da janela agora.
                          [ Na vitrine (──o) ]
```

Uma faixa de controle por produto em vez de duas. Mesma altura mostra 4 produtos.

---

## 3. Anatomia do componente

```
LinhaProduto
├── [modoSelecao] <label> checkbox         44×44 literal, prefixo
├── ThumbProduto                           44×44, existente
├── <button> gatilho de edição             ← NOVO papel, ação primária
│   ├── nome                               line-clamp-2
│   └── faixa 1: preço · status (ponto+texto)
│   └── faixa 2: procedência (cardápios · exclusivo · promoção) — chips outline
├── [sumico] <p role="alert">              aviso âmbar RN-12, existente
└── grupo de ação (flex-none, ml-auto, order-last)
    ├── <Switch> "Na vitrine"              eixo `oculto`
    └── <Menu> kebab (ghost, 44×44)
        ├── Editar
        ├── Marcar esgotado / Disponibilizar   ← vindo da linha
        ├── [sumico] Religar ou estender
        ├── [sumico] Devolver ao menu
        └── Remover (destrutivo)
```

**Estado de edição (`editandoId === p.id`)**: a linha esconde chips, switch e kebab e mostra
`[input nome] [input preço] [Salvar] [Cancelar]`. Em 360px os dois campos **empilham** — é
a régua "comprimir, não estourar" de `design-system.md` §5. Mesmo mecanismo do
`leitura → confirmando` de `LinhaItemOpcional.tsx`.

### Props que mudam em `ProdutosClient`

Nenhuma prop nova para as propostas 1-5: tudo já chega no componente. A edição inline
acrescenta uma action ao contrato `AcoesProdutosClient` — e **as 21 chaves existem em duas
variantes** (lojista e admin), sem default, de propósito (issue 160).

---

## 4. Atritos, por impacto

| Impacto | Atrito | Onde | Fix |
|---|---|---|---|
| ALTO | kebab órfão, posse ambígua | `ProdutosClient.tsx:1014` | 2.1 + 2.2 |
| ALTO | nenhuma ação é primária (3× `variant="outline"`) | 1012, 1102, 1121 | 2.3 + 2.4 |
| ALTO | ação mais frequente = 3 toques + form de 764 linhas | — | 2.3 |
| MÉDIO | 12 chips dizendo 3 coisas, inertes com cara de botão | 1071-1092 | 2.1 |
| MÉDIO | status e ruído são a mesma pílula cinza | `badgeStatus` | 2.5 |
| MÉDIO | ~50px de banda morta por linha | — | 2.1 + 2.2 |
| MÉDIO | no mobile o kebab vem antes do conteúdo (`order-3`) | 1014 | 2.2 |
| BAIXO | rótulos que alternam ("Ocultar"/"Exibir") | 1115, 1131 | 2.4 |

---

## 5. Acessibilidade (WCAG 2.1 AA)

**Já correto hoje, preservar:**
- alvos com **44px literal** (`min-h-[44px] min-w-[44px]`) — nunca `min-h-11` (52,8px) nem
  `size="icon-sm"` (33,6px) na base de 120% (§5);
- `aria-label` nominal em todo ícone ("Mais ações de {nome}");
- `badgeStatus` não depende só de cor: "Oculto" carrega `EyeOff` + texto;
- contrastes medidos: `--promo-texto` `#166534` sobre `--promo-fundo` `#dcfce7` ≈ 7:1;
  `text-amber-700` sobre branco passa AA. Nenhum chip falha hoje.

**Achados:**

1. `ProdutosClient.tsx:1071-1092` — `<ul>` de chips sem rótulo acessível. Resolvido pela 2.1.
2. `GerenciarCategorias.tsx:202, 211, 239, 250` — o padrão de edição inline que seria
   reusado usa `size="icon-sm"` = **33,6px**, abaixo do mínimo e explicitamente proibido
   pela §5. **Defeito pré-existente:** se a edição inline entrar, o padrão tem que ser
   copiado **corrigido** (44px literal). Vale issue separada para consertar o original.
3. Foco de teclado: o gatilho de edição adiciona uma parada por produto; em compensação a
   2.1 tira os chips do fluxo e a 2.4 funde dois botões em um — o saldo por linha cai.
4. Edição inline exige: `<label class="sr-only">` por campo ("Nome do produto" / "Preço"),
   `aria-invalid` + `aria-describedby` no erro, `role="alert"` na mensagem, e
   `aria-live="polite"` no resultado. O `Input` do shadcn sozinho não dá isso.
5. `Switch`: `aria-label` explícito ("Exibir {nome} na vitrine") — "Na vitrine" sozinho não
   diz de qual produto.

---

## 6. Edição inline de nome e preço

### Nome: barato

`nome: z.string().trim().min(1).max(200)` (`validacoes/produto.ts`). Sem regra cruzada. O
padrão de UI já existe em `GerenciarCategorias.tsx:185-215` (estado `editandoId`, Enter
salva, Esc cancela). A Server Action é clone direto de `alternarDisponibilidade`
(`actions/produto.ts:216`): schema próprio, `.update({nome})`, `.eq("id").eq("loja_id")`.

### Preço: não é barato — e o motivo não é UI

1. **`atualizarProduto` é UPDATE total, não patch** (`actions/produto.ts:119-181`). Parseia
   `schemaProdutoUpdate`, que exige `visibilidade`, `disponivel`, `oculto`, `ordem` e o bloco
   inteiro de desconto, e grava `.update({ ...comPrazosNoFuso(parsed.data, loja.timezone) })`.
   Mandar `{nome, preco}` por ali não passa; e "resolver" enchendo o payload no cliente
   **apagaria em silêncio a promoção, a foto e a visibilidade** do produto.
2. **Preço tem regra cruzada de dinheiro (D10)** — `validacoes/produto.ts:269-295`. Baixar o
   preço abaixo do desconto configurado é **recusado**, com mensagem que nomeia os dois
   números:

   > Não dá para salvar: o preço novo (R$ 20,00) é menor que o desconto configurado
   > (R$ 30,00). Reduza o desconto para no máximo R$ 20,00 ou desligue a promoção deste
   > produto.

   Uma action estreita de preço tem que **reler** `desconto_tipo`/`desconto_valor` do banco
   e reaplicar D10 — senão a edição inline vira o buraco por onde se grava o estado que o
   formulário proíbe.
3. **Paridade admin obrigatória.** `src/app/admin/assinantes/actions/admin-produtos.paridade.test.ts`
   existe porque o caminho admin usa `service_role`, que é BYPASSRLS: nenhuma regra que more
   só na RLS o protege. Action nova = duas implementações + teste de paridade afirmando a
   mensagem de D10 **byte a byte**. `ProdutosClient` é o mesmo componente nos dois mundos
   (`CardapioAdminClient.tsx`), então o campo apareceria nos dois.

### Contras de UX específicos

- No mobile, toque-para-editar compete com toque-para-abrir: o gatilho tem que ser decidido
  de uma vez (o bloco nome/preço **ou** um lápis), nunca os dois.
- A linha já perde para o chrome em 360px (o checkbox do modo seleção soma ~44px, §5): dois
  inputs + Salvar + Cancelar só cabem com a linha entrando em modo edição e escondendo o resto.
- Campo de dinheiro inline sem máscara convida `1,5` / `1.50` / `R$1,50` — precisa da
  coerção de borda que o `FormProduto` já faz (o schema trata `preco` como **número**; a
  conversão é responsabilidade da borda, não do schema autoritativo).

### Recomendação: dividir

| Iteração | Escopo | Workflow |
|---|---|---|
| **1 — agora** | redesenho da linha (2.1-2.5) + edição inline **só do nome** | `/fluxo` (toca Server Action). As propostas 2.1 e 2.2 isoladas seriam `/polir` |
| **2 — issue própria** | edição inline de **preço** | `/fluxo` com **TDD red-first obrigatório** (mandato 3): action `definirPrecoProduto` que relê o desconto e reaplica D10, gêmea admin, teste de paridade com a mensagem literal |

Misturar um diff de layout com um diff monetário no mesmo PR atrapalha a revisão justamente
da parte que importa. **Se as duas forem juntas mesmo assim, a ordem é inegociável: teste
vermelho de D10 na action nova antes de qualquer JSX.**

**Caminho mais barato de todos:** as propostas 2.1 e 2.2 sozinhas já matam as marcas 1, 3 e
4 da imagem anotada, são puramente visuais e não abrem Server Action nenhuma.
