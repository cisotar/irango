# [262] Selo e estado não comprável na vitrine e no checkout (`fora_da_janela`)

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [247] (`tasks/247-extensao-do-contrato-de-catalogo-com-vigencia.md`), [252] (`tasks/252-revisarcarrinhoaction-com-vigencia.md`), [232] (`tasks/232-tokens-de-promocao-selodesconto-e-precoproduto.md`), [233] (`tasks/233-selo-e-par-de-precos-nas-quatro-superficies.md`) e [237] (`tasks/237-tres-estados-do-cupom-no-checkout.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D4, D14 · RN-06, RN-13 · design §4.1, §4.2, §4.3
**Fatia:** 14

## Objetivo

Fazer o cliente **ver** o que o servidor já decidiu: o card aparece, marcado, sem botão de
compra, com o selo dizendo **quando volta** — reuso literal do padrão de `esgotado`, nenhum
estilo novo, só o texto muda. E travar o envio do checkout enquanto houver item bloqueado.

## Escopo

- [ ] `CardProduto` — o prop `disponivel` dá lugar a `compravel` + `motivoNaoCompravel` +
      `rotuloIndisponivel`; **mesma pill, mesma opacidade, mesmo `disabled`, mesmo padrão de
      `aria-label`** (`CardProduto.tsx:67-97`);
- [ ] o botão "+" fica `disabled` **e** `pointer-events-none`, com
      `aria-label={`${produto.nome} — ${rotulo}`}` — `pointer-events-none` é a peça que faz o
      toque **atravessar** para o card e **abrir o modal**, que é o único lugar onde a frase
      inteira cabe em 360px;
- [ ] `ItemProdutoLista` — a mesma pílula, inline, na variante textual; preço em `--texto-muted`,
      **sem** riscar (é indisponibilidade, não promoção);
- [ ] `ProdutoModal` — o selo central (linhas 341-352) e o CTA desabilitado (linhas 523-531)
      passam a ser dirigidos pelo **motivo**; o modal **abre** (o cliente pode querer ler a
      descrição) e não adiciona nada;
- [ ] `SecaoCatalogo` recebe `rotulosVigencia` como prop **obrigatória**, ao lado de
      `opcionaisPorCategoria`; `CatalogoVitrine` repassa;
- [ ] fallback de render: chave ausente ⇒ **"Indisponível no momento"** — degradação visível e
      correta, nunca selo em branco;
- [ ] `EtapaItens` exibe o aviso inline por item não comprável e bloqueia o avanço;
      `ResumoValores` desconsidera o item bloqueado do subtotal exibido e mostra a linha riscada
      com o motivo; **`podeConfirmar` ganha a condição "nenhum item bloqueado"** — toda UI que
      controla o submit consulta `podeConfirmar`, nunca reimplementa (`design-system.md` §9);
- [ ] teste de `filtrarCatalogo` afirmando que o produto filtrado **mantém** `compravel === false`
      e `motivoNaoCompravel === "fora_da_janela"` — a exigência é que a busca continue subtrativa.

## Fora de escopo

As seções de destaque, `ancoraCardapio`, `idNaSecao` e as pílulas do trilho — issue 263, que
**depende desta** porque as duas editam `SecaoCatalogo.tsx` e `CardProduto.tsx`:
**nunca em paralelo**, é o único conflito de arquivo real entre as fatias de UI deste spec.
Reescrever `filtrarCatalogo`/`BuscaProdutos`: são **verificados, não reescritos**. Criar um
componente `SeloVigencia`: a indisponibilidade **não é componente**, é a pílula que o
`CardProduto` já imprime. "Confirmar assim mesmo" para item fora da janela.

## Reuso esperado

- O tratamento de `esgotado` que `CardProduto` já tem — **reuso literal**, nenhum estilo novo.
- Os tokens `--indisponivel-fundo` / `--indisponivel-texto` da issue 232 — nenhuma cor nova, e
  nunca cor do tema da loja no selo.
- `podeConfirmar` (`components/vitrine/checkout/estado.ts`) — **o** lugar da regra de submit.
- `descreverVigencia` (issue 254) — o rótulo chega **pronto** do servidor; a UI não o inventa.
- `filtrarCatalogo` (`lib/utils/buscarProdutos.ts:82`) — verificado, não tocado.

## Segurança

- **A trava do botão é cortesia; a autoridade é a Server Action** (issues 249 e 252). O card
  desabilitado é para quem está olhando a tela.
- O componente **nunca** avalia janela a partir de dados crus: recebe `compravel`,
  `motivoNaoCompravel` e o rótulo já decididos no servidor.
- Se alguém re-montar um shape reduzido no filtro da busca, o estado "fora da janela" some e o
  botão de compra volta — por isso o teste de `filtrarCatalogo` é obrigatório.

## Critério de aceite

- [ ] o card fora da janela **aparece** (padrão de `esgotado`, nunca o de `oculto`);
- [ ] o toque no card não comprável **abre o modal**, e o modal não tem CTA de adicionar;
- [ ] o produto filtrado pela busca mantém `compravel === false` e o motivo `"fora_da_janela"`;
- [ ] com item bloqueado no carrinho, `podeConfirmar` é `false` e o submit não avança;
- [ ] chave ausente no mapa ⇒ "Indisponível no momento", nunca selo vazio;
- [ ] `grep -rn "SeloVigencia" src/` **não devolve nada**;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
