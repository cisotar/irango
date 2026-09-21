# [247] Extensão do contrato de catálogo: `projetarProdutoVitrine`/`projetarCatalogoVitrine` com vigência

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [224] (`tasks/224-contrato-de-catalogo-produtovitrine-e-projecao.md`), [225] (`tasks/225-quatro-superficies-recebem-produtovitrine-e-correcao-do-d13.md`), [243] (`tasks/243-migration-cardapio-produtos-fks-compostas-e-rls.md`), [245] (`tasks/245-trigger-do-produto-exclusivo-e-policy-publica-ajustada.md` — é ela que põe `visibilidade` em `vitrine_produtos`/`ProdutoPublico`) e [246] (`tasks/246-vigenciacardapio-cardapioaberto-e-avaliarvigenciadoproduto.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D4, D14 · RN-05, RN-06, RN-13
**Fatia crítica:** 3 (extensão do contrato de catálogo)

## Objetivo

Compor `compravel` com a vigência do cardápio no **contrato que o Spec A nomeou**, sem acrescentar
nenhum campo ao objeto, e fazer a projeção **filtrar** o produto que D14 manda sumir — omitindo-o
da lista **antes** do agrupamento, do mesmo jeito que `oculto` já sai.

## Escopo

- [ ] `export type MotivoNaoCompravel = "esgotado" | "fora_da_janela"` — **acrescenta** membro,
      não remove nem renomeia;
- [ ] `projetarProdutoVitrine(produto, cardapios, agora, timezone)` — os dois parâmetros novos são
      **OBRIGATÓRIOS**. Lista vazia ⇒ comportamento idêntico ao v1;
- [ ] `compravel === disponivel && dentroDaJanela`; precedência de RN-05 —
      **`"fora_da_janela"` ganha de `"esgotado"`**, um motivo só, decidido no servidor;
- [ ] `projetarCatalogoVitrine({ produtos, cardapiosPorProduto, agora, timezone })` devolvendo
      **num único objeto**: `produtos` (já filtrada por RN-13), `rotulosVigencia`
      (`produto_id → frase`, uma entrada para **cada** produto com motivo `"fora_da_janela"`) e
      `cardapiosAbertos` (consumido pela issue 248) — os três saem do **mesmo** retorno, para que
      não exista caminho que produza o produto marcado sem o rótulo dele;
- [ ] query nova de cardápios para o SSR (`buscarCardapiosComProdutos(lojaId)` em
      `src/lib/supabase/queries/`), entrando na onda de `Promise.all` que já existe em
      `src/app/(publica)/loja/[slug]/page.tsx` (hoje `buscarCategorias` ‖ `buscarProdutosPublicos`);
- [ ] `agruparCatalogo` (`lib/supabase/queries/produtos.ts:88`) **generalizada, não reescrita**:
      `<T extends { id: string; categoria_id: string | null }>` em vez de `Produto[]`;
- [ ] `page.tsx` passa a projetar na **ordem obrigatória**: `projetarCatalogoVitrine` **→**
      `agruparCatalogo`, invertendo o que existe hoje (linhas 174-190) — é isso que faz a regra
      do grupo vazio da issue 177 continuar cobrindo a categoria esvaziada pela temporada;
- [ ] teste ao lado do módulo com os cenários 3 e 6 literais.

## Fora de escopo

`agruparPorCardapio`, a ordenação das seções e o `foto_url` zerado por produto (issue 248).
O selo e o estado não comprável nos componentes (issue 262). Qualquer campo novo em
`ProdutoVitrine`: a regra 2 do contrato do Spec A é o ponto de extensão **e só ele**, e o rótulo
viaja **ao lado**, no mapa, como `opcionaisPorCategoria` já faz na mesma cadeia. **Nenhuma
proposta de cache do catálogo** (`revalidate`, `'use cache'`, ISR): a vitrine é dado vivo por
decisão documentada e um cardápio que abre às 11:00 tem que abrir às 11:00 — o custo das duas
queries novas é nota para o `acelerar`, **depois** do `executar`.

## Reuso esperado

- `src/lib/utils/catalogoVitrine.ts` (issue 224) — módulo do Spec A, **estendido, não duplicado**.
- `src/lib/utils/vigenciaCardapio.ts` (issue 246) — a decisão de janela vem toda de lá.
- `agruparCatalogo` e a regra "grupo sem produto visível não é devolvido" (issue 177,
  `produtos.ts:78-88`) — reusada de graça pela ordem nova, **sem código de agrupamento novo**.
- `buscarProdutosPublicos` (`produtos.ts`) — lê a view `public.vitrine_produtos` com select
  **nomeado** (`COLUNAS_PRODUTO_PUBLICO`, D4 da 265 — nunca `select("*")`). A coluna
  `visibilidade` **não** "chega sozinha": ela entra como 15ª coluna da view, da constante e de
  `ProdutoPublico` na issue **245** (decisão de recriar a view uma vez só). Esta issue só a
  **consome** de `ProdutoPublico`. **Nenhuma query de produto nova.**
- O padrão de mapa ao lado do catálogo de `opcionaisPorCategoria`.

## Segurança

- `visibilidade` e as colunas cruas de vigência **não trafegam ao cliente**: são **entrada** da
  projeção (regra 6 do contrato do Spec A; mesmo princípio da issue 201 sobre `foto_url`).
- O produto sumido **não é enviado ao browser** — não há estado a forjar no devtools.
- Parâmetros obrigatórios são a trava: sem jsdom, um default "dentro da janela" produziria, em
  silêncio, um catálogo inteiro comprável fora da janela. Obrigatório move o erro para o `tsc`,
  primeiro passo do CI (mesmo princípio do `resolverEndereco` como thunk, issue 160).
- `oculto = true` continua ganhando de tudo e nem chega a virar `ProdutoVitrine`.

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes do código (fatia 3);
- [ ] `compravel === disponivel && dentroDaJanela`, provado nas seis linhas do cenário 3;
- [ ] fora da janela **e** `disponivel = false` ⇒ motivo `"fora_da_janela"`;
- [ ] produto `'menu'` fora da janela ⇒ `compravel === true` e **nenhum** rótulo;
- [ ] produto sumido **não está** na lista devolvida, e a categoria que ficou só com ele
      **não é devolvida** por `agruparCatalogo`;
- [ ] `visibilidade` **ausente** do objeto projetado (asserção sobre as chaves, não sobre o valor);
- [ ] há rótulo para **todo** produto com motivo `"fora_da_janela"`;
- [ ] a suíte atual de `agruparCatalogo` passa **sem uma edição**;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.

---

## Plano Técnico

> Escrito pelo `arquitetar` em 2026-09-20, contra a branch `feat/cardapio-sazonal-nucleo`
> (HEAD `f0877ad`, com 242–246 já entregues). Tudo abaixo foi conferido no código, não no texto
> da issue.

### Diagnóstico

**Causa raiz.** O contrato de catálogo da 224 congelou `compravel = disponivel` porque, naquele
momento, **toda** a informação que decidia comprabilidade cabia numa linha de `produtos` + o
relógio. O Spec B acrescenta um segundo insumo que **não é do produto**: a janela vive numa
relação por loja (`cardapios` ⋈ `cardapio_produtos`). Uma função pura por produto não tem como
alcançá-la, e é por isso que a extensão não é "mais um `&&`": exige um **ponto de entrada por
catálogo** (`projetarCatalogoVitrine`) que seja dono das três saídas correlacionadas — a lista
projetada, o mapa de rótulos e os cardápios abertos.

O segundo pedaço da causa raiz está em `page.tsx:176-190`: hoje a página **agrupa antes de
projetar** (`buscarProdutosPublicos` → `agruparCatalogo` → `map(projetar)`). Com essa ordem, RN-13
("o produto some, e a categoria que ficou só com ele some junto") **não é expressável sem código de
agrupamento novo** — teria de existir um segundo filtro depois do agrupamento, re-derrubando grupos
vazios, que é exatamente a segunda cópia da regra da issue 177. Inverter a ordem
(`projetar → agrupar`) é o fix de raiz: a regra do grupo vazio, que já existe e já tem suíte,
passa a cobrir a categoria esvaziada pela temporada **de graça**.

**Remendos recusados explicitamente:**
- filtrar o produto sumido dentro de `agruparCatalogo` (guard no agrupador ⇒ ele passaria a conhecer
  vigência, e a suíte da 177 teria de mudar);
- filtrar no `page.tsx` depois do agrupamento (segunda passada de "derruba grupo vazio");
- `compravel` opcional / `cardapios` com default `[]` (assimetria silenciosa: sem jsdom, um caller
  que esquecesse o parâmetro produziria um catálogo inteiro comprável fora da janela, e **nenhum**
  teste do repo pegaria).

**Por que é complexo:** contrato compartilhado por 3 consumidores (SSR, revisão de carrinho,
`criarPedido`), 4 issues em 2 ondas dependem do formato de retorno (248, 262, 263, 264), a ordem das
operações no SSR muda, e há uma **dependência de texto que só chega na onda 4** (254) — tratada em
D3.

### Mapa de Impacto

```
/loja/[slug]/page.tsx (Server Component, SEM cache — dado vivo)
 ├── buscarLojaPorSlug ─ view vitrine_lojas ─ timezone da LOJA ──────┐
 ├── Promise.all                                                     │
 │    ├── buscarCategorias(db, lojaId) ───── tabela categorias       │
 │    ├── buscarProdutosPublicos(db, lojaId) ─ VIEW vitrine_produtos │  [anon + RLS]
 │    │      └─ 15 colunas, inclui `visibilidade` (245)              │
 │    └── buscarCardapiosComProdutos(db, lojaId)  ← NOVO             │
 │           └─ cardapios ⋈ cardapio_produtos (embed, 1 round trip)  │  [anon + RLS]
 ├── projetarCatalogoVitrine({produtos, cardapiosPorProduto, agora, timezone}) ← NOVO
 │      └── projetarProdutoVitrine(produto, cardapios, agora, timezone)  [assinatura muda]
 │             ├── precoEfetivo()            (224/223 — intocado)
 │             └── avaliarVigenciaDoProduto() (246 — intocado)
 │                    └── cardapioAberto() → fusoLoja.partesNoFuso/paraMinutos
 │      ⇒ { produtos (JÁ filtrada por RN-13), rotulosVigencia, cardapiosAbertos }
 ├── agruparCatalogo(produtosVitrine, categorias)   [GENÉRICA JÁ — nada a fazer]
 │      └── regra da issue 177: grupo sem produto NÃO é devolvido  ← cobre RN-13 de graça
 ├── buscarOpcionaisPorCategoria(db, categoriaIds)  [inalterado, depende dos grupos]
 └── CatalogoVitrine / VitrineClient                [NÃO TOCAR nesta issue — 262/263]

Consumidores futuros do MESMO retorno (não implementar aqui):
  cardapiosAbertos  → agruparPorCardapio (248) → seções de destaque (263)
  rotulosVigencia   → CatalogoVitrine/CardProduto (262) e contagem de escondidos (264)

Invariante "produto pode ser comprado agora?" — onde é garantida:
  ├── CardProduto.tsx (botão disabled)        — [cliente — só UX, contornável]
  ├── projetarProdutoVitrine / avaliarVigenciaDoProduto — [fonte única da REGRA]
  ├── revisarCarrinhoAction (252)             — [Server Action — preview autoritativo]
  ├── criarPedido (249)                       — [Server Action — AUTORITATIVO, recusa o pedido]
  └── view vitrine_produtos (245)             — [RLS/SQL — esconde o RASCUNHO (cardápio inativo),
                                                 NUNCA a janela: `where` sem cláusula de vigência]
```

**Assimetria declarada e aceita:** esta issue **não** acrescenta nenhuma trava server-side de
compra. Ela é 100% superfície de leitura (SSR). A recusa autoritativa do item fora da janela é a
**issue 249** (`criarPedido`) e o preview é a **252** (`revisarCarrinhoAction`), ambas na mesma onda
3, ambas consumindo `avaliarVigenciaDoProduto` — a mesma função pura, nunca uma segunda leitura da
regra. Enquanto 249 não mergear, um payload forjado com um produto fora da janela **é aceito**:
é a janela entre merges já registrada como R3 no plano da onda, e o mitigador é o mesmo — nenhum
cardápio existe em loja real antes da onda 4 (o CRUD é a 255).
**Nenhum valor monetário nasce, muda ou é lido aqui**: `preco`, `precoEfetivo`, `temDesconto`,
`seloDesconto` e `descontoFim` saem de `precoEfetivo()` exatamente como hoje.

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/utils/catalogoVitrine.ts` | contrato v1: `ProdutoVitrine` (12 campos), `MotivoNaoCompravel = "esgotado"`, `projetarProdutoVitrine(produto, agora)` | `+ "fora_da_janela"` na união; `projetarProdutoVitrine` ganha 2 parâmetros **obrigatórios**; nasce `projetarCatalogoVitrine`; **zero campo novo** em `ProdutoVitrine` |
| `src/lib/utils/vigenciaCardapio.ts` (246) | `cardapioAberto`, `avaliarVigenciaDoProduto`, tipos `CardapioVigencia`/`ProdutoVigencia` | **nenhuma regra muda**; ganha 2 normalizadores exportados (D6). `voltaAAbrir` segue privada |
| `src/lib/supabase/queries/produtos.ts` | `buscarProdutosPublicos` (select nomeado, 15 colunas com `visibilidade`), `agruparCatalogo<T extends {id, categoria_id}>` | **NADA.** Confirmado no código: `agruparCatalogo` **já é genérica** desde a 224 (`produtos.ts`, default `= ProdutoPublico`). O item "generalizar" do escopo **já está feito** — é verificação, não trabalho |
| `src/lib/supabase/queries/cardapios.ts` | **não existe** | **criar** — `buscarCardapiosComProdutos(client, lojaId)` |
| `src/app/(publica)/loja/[slug]/page.tsx` | 4 queries, `agrupar → map(projetar)`, `foto_url` zerado por grupo (l. 188-190) | 5ª query no `Promise.all`; ordem invertida para `projetar → agrupar`; `foto_url` **fica onde está** (é a 248) |
| `src/lib/utils/catalogoVitrine.test.ts` | suíte da 224 + 4 guardas estáticas sobre `page.tsx` | **edição mecânica obrigatória** — ver "Armadilha 1" |
| `src/lib/supabase/queries/produtos.test.ts` | `describe("207 agruparCatalogo …")` | **não pode ser tocado** (critério de aceite) |
| `supabase/migrations/*` | 128000–132000 entregam `cardapios`, `cardapio_produtos`, `visibilidade`, view recriada | **nenhuma migration nova.** Todo o schema necessário já está aplicado e tipado em `src/lib/database.types.ts` |

**Armadilha 1 — a suíte da 224 quebra no `tsc`, e isso é esperado.**
`catalogoVitrine.test.ts` tem ~20 chamadas `projetarProdutoVitrine(x, AGORA)`. Com o 3º/4º
parâmetros obrigatórios, **todas** param de compilar. A edição autorizada é **mecânica**:
`projetarProdutoVitrine(x, AGORA)` → `projetarProdutoVitrine(x, [], AGORA, TZ)`, com
`const TZ = "America/Sao_Paulo"`. **Nenhuma asserção da 224 muda** — "lista vazia ⇒ comportamento
idêntico ao v1" é justamente o que torna a edição mecânica. Se alguma asserção precisar mudar,
o contrato regrediu: reverter, não ajustar o teste.

**Armadilha 2 — duas guardas estáticas da 224 reprovam de propósito e precisam ser estendidas:**
1. `it("não abre NENHUMA query além das quatro que já existiam")` — a lista `PERMITIDAS` ganha
   `"buscarCardapiosComProdutos"` e **só ela** (a guarda continua letal para a 6ª query).
2. `it("projeta o catálogo por `projetarProdutoVitrine`")` — o regex casa o literal
   `projetarProdutoVitrine`, que **não é substring** de `projetarCatalogoVitrine`. Trocar o regex
   para `projetarCatalogoVitrine`, que passa a ser o ponto de entrada único da página.
As outras duas guardas (`sem ISR/cache` e `nenhuma coluna crua de desconto no SSR`) **têm de
continuar passando sem edição** — se uma delas reprovar, o plano foi violado.

**Armadilha 3 — `visibilidade` não pode virar 13ª chave.** `projetarProdutoVitrine` monta campo a
campo, sem spread. A guarda `CHAVES_CONTRATO` (12 chaves) segue como está e ganha uma irmã que
afirma `visibilidade` **ausente** de `Object.keys(...)`.

### Decisões de Design

**D1 — Onde acontece o filtro de RN-13 ("o produto que some").**
- (a) dentro de `agruparCatalogo`: o agrupador passaria a conhecer vigência, precisaria receber
  `cardapios`/`agora`/`timezone`, e a suíte da 177 mudaria. **Recusada** — viola o critério de
  aceite e espalha a regra.
- (b) em `page.tsx`, depois do agrupamento: exige uma segunda passada derrubando grupos que ficaram
  vazios — segunda cópia da regra da issue 177, a divergir na primeira mudança.
- (c) **ESCOLHIDA — dentro de `projetarCatalogoVitrine`**, antes de qualquer agrupamento: o produto
  com `visivelNaVitrine === false` **não entra** na lista devolvida, do mesmo jeito que `oculto`
  nunca entra. Motivos: (i) é o único ponto onde a lista ainda é uma lista (nenhum grupo a
  reconsiderar); (ii) `agruparCatalogo` fica literalmente intocado e a regra do grupo vazio cobre a
  categoria esvaziada sem uma linha nova; (iii) o produto **nunca chega ao payload RSC** — não há
  estado a forjar no devtools; (iv) os dois agrupamentos da onda 4 (`agruparCatalogo` e
  `agruparPorCardapio`) leem a **mesma** lista já filtrada, que é o que garante a invariante 1 do
  §D16 da spec.

**D2 — O que a página desestrutura (e o warning de lint).**
`projetarCatalogoVitrine` devolve três chaves, mas 262/263 é que consomem `rotulosVigencia` e
`cardapiosAbertos`. Desestruturar as três agora dispara `@typescript-eslint/no-unused-vars`
(`warn`; o checklist do projeto exige **zero warning novo**).
**Escolhida:** a página desestrutura **apenas `{ produtos }`** nesta issue. O par
produto-marcado/rótulo continua indivisível **na função** (é lá que a invariante mora e é lá que o
teste a prova); prefixar `_rotulosVigencia` seria carimbar de "morto" algo que a issue 262 vai usar.

**D3 — De onde sai o TEXTO do rótulo, já que `descreverVigencia` é a issue 254 (onda 4).**
- (a) antecipar a 254 para a onda 3: move uma issue não-crítica para dentro do PR crítico, inflando
  o diff que o usuário lê com atenção máxima, e reabre o fatiamento aprovado do plano.
- (b) injetar um formatter obrigatório (`rotuloDe: (cardapios, agora, tz) => string`) em
  `projetarCatalogoVitrine`: o `tsc` força a decisão no call-site, mas não força ninguém a **trocar**
  a implementação quando a 254 chegar — o ganho é aparente.
- (c) **ESCOLHIDA — constante provisória no próprio módulo**, `ROTULO_VIGENCIA_PROVISORIO =
  "Indisponível no momento"` (a copy final do `desenhar` para o caso sem data), com
  `// TEMP(254): trocar por descreverVigencia do cardápio que abre mais cedo (RN-07)`.
  Justificativa de remendo legítimo: (i) o critério de aceite desta issue é **estrutural** — "existe
  uma entrada de rótulo para todo motivo `fora_da_janela`" — e não sobre o texto; (ii) a feature é
  *dark* até a onda 4 (o único jeito de criar cardápio é o CRUD da 255), então **nenhum cliente real
  vê o texto provisório**; (iii) a escolha determinística entre N cardápios fechados é, por RN-07,
  propriedade da 254 e não deve nascer duplicada aqui.
  **Critério de remoção, obrigatório:** acrescentar à issue 254 um item de escopo —
  *"trocar `ROTULO_VIGENCIA_PROVISORIO` por `descreverVigencia` do cardápio escolhido por
  `proximaAbertura`, com teste afirmando o texto específico; `grep -rn ROTULO_VIGENCIA_PROVISORIO
  src/` deve voltar vazio"*. **Sem esse item, o provisório vira permanente em silêncio** — é o risco
  R2 abaixo.

**D4 — `cardapiosAbertos` precisa carregar `ordem`, que `CardapioVigencia` não tem.**
A 248 ordena as seções por `ordem → nome → id`, mas `CardapioVigencia` (246) só tem os campos que
decidem janela. Recriar o tipo, ou acrescentar `ordem` a `CardapioVigencia`, sujaria o módulo de
vigência com um campo de apresentação.
**Escolhida:** `projetarCatalogoVitrine` é **genérica em `C extends CardapioVigencia`** e devolve
`cardapiosAbertos: C[]`. A query devolve `CardapioDaLoja = CardapioVigencia & { ordem: number }`, e
o `ordem` sobrevive à projeção sem que o contrato de vigência o conheça. É o mesmo recurso que
`agruparCatalogo<T>` já usa no repo — nenhum primitivo novo.

**D5 — Forma da query de cardápios.**
- (a) duas queries (`cardapios` + `cardapio_produtos`) e junção em memória: 2 round trips.
- (b) embed a partir de `vitrine_produtos`: **impossível** — a view não tem FK e o PostgREST não
  embute a partir dela.
- (c) **ESCOLHIDA — uma query, embed de cima para baixo**:
  `from("cardapios").select("id, nome, ativo, ordem, modo, dias_semana, dias_mes, hora_inicio,
  hora_fim, prazo_inicio, prazo_fim, cardapio_produtos(produto_id)").eq("loja_id", lojaId)
  .order("ordem").order("nome").order("id")` — **select nomeado**, nunca `*` (D4 da 265), 1 round
  trip, e o índice `cardapio_produtos(loja_id, cardapio_id)` (criado pela 243) é o caminho do embed.
  A função devolve `{ cardapios, cardapiosPorProduto }`, com o `Map` montado no mesmo passo
  (agrupamento em memória, mesmo padrão de `agruparOpcionaisPorCategoria`).
  **Sem `.eq("ativo", true)`, de propósito:** RN-03 é decidida na função pura
  (`avaliarVigenciaDoProduto` já faz `cardapios.filter(c => c.ativo)`). Filtrar no SQL criaria a
  segunda casa da regra e, pior, **quebraria a reutilização pela 249**, que roda sob `service_role`
  (BYPASSRLS) e precisa ver o mesmo conjunto que a vitrine.
  **`.eq("loja_id", lojaId)` é explícito** mesmo com RLS cobrindo `anon`: é o que torna a função
  segura sob `service_role` para 249/252 reusarem sem escrever uma segunda query.
  Loja sem cardápio ⇒ `{ cardapios: [], cardapiosPorProduto: new Map() }` ⇒ catálogo **byte a byte**
  igual ao de hoje.

**D6 — `modo` e `visibilidade` chegam como `string` dos tipos gerados; onde é feito o estreitamento.**
`Tables<"cardapios">.modo` é `string` e `Tables<"produtos">.visibilidade` é `string` (o CHECK não
viaja para o TypeScript). Um `as CardapioVigencia` no call-site resolveria o `tsc` e criaria três
estreitamentos divergentes (SSR, 249, 252).
**Escolhida:** dois normalizadores **exportados de `vigenciaCardapio.ts`** (dono dos tipos),
consumidos por todo mundo, e **nenhum `as` no projeto**:
- `paraCardapioVigencia(row): CardapioVigencia | null` — `modo` fora de `{recorrente, prazo_fixo}`
  ⇒ **`null`, a linha é descartada** (*fail-closed*). É a única direção segura: as duas alternativas
  de estreitamento por fallback caem no "eixo NULL = sem restrição" de 246 e produziriam um cardápio
  **sempre aberto**.
- `visibilidadeDe(produto): "menu" | "cardapio"` — `=== "cardapio" ? "cardapio" : "menu"`.
  Aqui o fallback é `'menu'` **por decisão oposta e deliberada**: `visibilidade` é `not null default
  'menu'` com CHECK, então "desconhecido" só existe se uma migration futura acrescentar um terceiro
  valor; tratar esse valor como `'cardapio'` faria produtos **sumirem de todas as vitrines** (perda
  de venda silenciosa, sem erro), enquanto tratá-lo como `'menu'` preserva exatamente o
  comportamento de hoje. Nenhuma das duas rotas cria acesso indevido: a compra continua sendo
  recusada/aceita pela 249, que usa o mesmo normalizador.
  Ambos ganham teste unitário próprio, e o aceite inclui `grep -rn "as CardapioVigencia" src/` vazio.

**D7 — Ordem dos parâmetros e obrigatoriedade.** Literal da spec:
`projetarProdutoVitrine(produto, cardapios, agora, timezone)`. Sem default em nenhum dos quatro
(precedente do thunk `resolverEndereco`, issue 160): o repo não tem jsdom, e proteção que dependa de
alguém lembrar não é travável — parâmetro obrigatório move o erro para o `tsc`, 1º passo do CI.

### Contratos de Dados

**Nenhuma migration nova. Nenhum tipo regenerado** (`src/lib/database.types.ts` já traz `cardapios`,
`cardapio_produtos` e `produtos.visibilidade` — conferido). Só contratos TypeScript:

```ts
// src/lib/utils/catalogoVitrine.ts
export type MotivoNaoCompravel = "esgotado" | "fora_da_janela";   // ACRESCENTA

export function projetarProdutoVitrine(
  produto: ProdutoParaVitrine & { visibilidade: string },
  cardapios: CardapioVigencia[],   // os cardápios DESTE produto; [] ⇒ idêntico ao v1
  agora: Date,
  timezone: string,
): ProdutoVitrine;                 // 12 campos, os MESMOS 12

export const ROTULO_VIGENCIA_PROVISORIO = "Indisponível no momento"; // TEMP(254)

export function projetarCatalogoVitrine<C extends CardapioVigencia>(entrada: {
  produtos: (ProdutoParaVitrine & { visibilidade: string })[];
  cardapiosPorProduto: Map<string, C[]>;
  agora: Date;
  timezone: string;
}): {
  produtos: ProdutoVitrine[];          // JÁ filtrada por RN-13 — pode ser menor que a entrada
  rotulosVigencia: Record<string, string>;  // 1 entrada por motivo "fora_da_janela"
  cardapiosAbertos: C[];               // consumida pela 248; NÃO reavaliada lá
};

// src/lib/supabase/queries/cardapios.ts  (NOVO)
export type CardapioDaLoja = CardapioVigencia & { ordem: number };
export async function buscarCardapiosComProdutos(
  client: SupabaseClient<Database>, lojaId: string,
): Promise<{ cardapios: CardapioDaLoja[]; cardapiosPorProduto: Map<string, CardapioDaLoja[]> }>;

// src/lib/utils/vigenciaCardapio.ts  (só ACRESCENTA exports)
export function paraCardapioVigencia(row): CardapioVigencia | null;
export function visibilidadeDe(produto: { visibilidade: string }): "menu" | "cardapio";
```

**Fórmulas, literais (§5.1 e §5.2 do pedido):**

```
vig            = avaliarVigenciaDoProduto({visibilidade: visibilidadeDe(p)}, cardapios, agora, tz)
compravel      = p.disponivel && vig.dentroDaJanela
motivo         = compravel ? null
               : !vig.dentroDaJanela ? "fora_da_janela"   // PRECEDÊNCIA: a janela ganha
               : "esgotado"
entra na lista = vig.visivelNaVitrine                     // RN-13, avaliado ANTES de agrupar
rótulo         = motivo === "fora_da_janela" ? ROTULO_VIGENCIA_PROVISORIO : (sem entrada)
```

**Produto `'menu'` fora de janela:** `avaliarVigenciaDoProduto` curto-circuita em `visibilidade ===
"menu"` e devolve `{dentroDaJanela: true, visivelNaVitrine: true}` **sem sequer ler a lista de
cardápios**. Logo `compravel === p.disponivel` (idêntico ao v1), o motivo só pode ser `"esgotado"`,
e **nunca** existe entrada no mapa de rótulos para ele — não há precedência a decidir, porque o
motivo de janela não se aplica. É o que as duas últimas linhas do cenário 3 fixam.

**Precedência `"fora_da_janela"` > `"esgotado"` (RN-05), e por que:** (i) "Esgotado" seria
**factualmente errado** — numa terça, a feijoada do cardápio de fim de semana não acabou, ela não é
servida hoje; (ii) é a restrição que **sobrevive** à outra (repor estoque na terça não faz o produto
vender); (iii) é a única das duas que **sabe dizer quando volta**, que é o que D4 pede do selo — e,
com D14/RN-13, todo produto que chega à vitrine com esse motivo tem, por construção, uma abertura a
anunciar (o caso sem volta **some**).

### Recálculo no Servidor

Não há dinheiro nesta issue. O cliente **não envia nada** para esta superfície: é render de página
pública, e os únicos insumos são o banco + o relógio do **servidor** no fuso da **loja**
(`loja.timezone`, nunca do browser). As colunas cruas de vigência (`dias_semana`, `hora_*`,
`prazo_*`) e `visibilidade` são **entrada** da projeção e **não** trafegam no payload RSC.
O que o cliente manda de volta (o carrinho) é recalculado do zero pela 252 e pela 249.

### Cenários

**Caminho feliz.** Loja com 1 cardápio recorrente sáb+dom 11:00–15:00; sábado 12:00. Todos os
produtos vinculados: `compravel = disponivel`, sem rótulo, catálogo idêntico ao de hoje.

**Bordas:**
| Situação | Comportamento exigido |
|---|---|
| Loja **sem nenhum cardápio** (100% da produção hoje) | `cardapiosPorProduto` vazio, todo produto `'menu'` ⇒ catálogo **idêntico** ao atual. É a asserção de não-regressão mais importante do RED |
| Loja inativa / assinatura suspensa | as 5 queries **nem rodam** (gate anterior, `page.tsx`) — inalterado |
| Cardápio **inativo** (rascunho de Natal em setembro) | não vaza: a view da 245 já esconde o produto `'cardapio'` órfão de cardápio ativo, `cardapios_leitura_publica` não devolve a linha, e `avaliarVigenciaDoProduto` filtra `ativo` de novo (3 camadas, nenhuma redundante) |
| Prazo fixo **expirado**, produto `'cardapio'` | some da lista, a categoria que ficou só com ele não é devolvida, **nada** vai ao browser (cenário 6) |
| Prazo fixo expirado, produto `'menu'` | continua vendendo normalmente (cenário 6, coluna direita) |
| Produto em 2 cardápios, um aberto e um expirado | comprável (união, RN-05); e **não some** — basta um com volta conhecida (cenário 4) |
| Produto fora da janela **e** `disponivel = false` | `compravel = false`, motivo `"fora_da_janela"`, **um** rótulo |
| `oculto = true` | nem chega: a view não devolve. Nenhuma linha nova |
| Vínculo com `produto_id` que não está no catálogo (produto oculto) | o `Map` tem a chave, ninguém a consulta. **Não** pode virar produto fantasma |
| `modo` fora do domínio (CHECK violado por migration futura) | linha **descartada** na query (D6) |
| Fuso inválido em `loja.timezone` | `partesNoFuso` (222) já é a única casa disso; `?? "America/Sao_Paulo"` continua sendo o default da página |
| Race de duplo submit | **não se aplica**: a issue não tem escrita |
| Virada da janela durante o request | `agora` é capturado **uma vez** na página e desce por parâmetro a tudo — a vitrine é internamente consistente; a divergência com o instante do `criarPedido` é resolvida pela 249, que reavalia com o próprio relógio |
| Falha da query de cardápios | `throw` propaga (§14) ⇒ `error.tsx` da rota. **Fail-closed por omissão é proibido**: engolir o erro e seguir com `[]` faria a vitrine vender a temporada inteira em silêncio |

**Tratamento de erro:** mensagem genérica na UI (o `error boundary` existente), detalhe só no
`console.error` do servidor. Nenhuma mensagem nova ao usuário nesta issue.

### Arquivos

**Criar**
- `src/lib/supabase/queries/cardapios.ts` — `CardapioDaLoja`, `COLUNAS_CARDAPIO_VIGENCIA`
  (select nomeado), `buscarCardapiosComProdutos(client, lojaId)`.
- `src/lib/supabase/queries/cardapios.test.ts` — contrato TS com client mockado (mesmo padrão de
  `produtos.test.ts` camada 2): select nomeado, `.eq("loja_id", …)` presente, `Map` montado,
  linha com `modo` inválido descartada, embed vazio ⇒ `Map` vazio.

**Modificar (nível função)**
- `src/lib/utils/vigenciaCardapio.ts` — **acrescentar** `paraCardapioVigencia` e `visibilidadeDe`.
  Nenhuma alteração em `cardapioAberto`, `avaliarVigenciaDoProduto`, `voltaAAbrir`, `dentroDoPrazo`,
  `dentroDaRecorrencia`.
- `src/lib/utils/catalogoVitrine.ts` — `MotivoNaoCompravel` (+1 membro);
  `projetarProdutoVitrine` (+2 params, `compravel`/`motivoNaoCompravel` compostos);
  `projetarCatalogoVitrine` (nova); `ROTULO_VIGENCIA_PROVISORIO` (nova, TEMP).
  **Não tocar** em `precoEfetivo`/`descontoFim`/`seloDesconto`.
- `src/app/(publica)/loja/[slug]/page.tsx` — 5ª entrada no `Promise.all`; `const timezoneLoja =
  loja.timezone ?? "America/Sao_Paulo"` extraído (hoje repetido 3×); `map(projetar)` + `agrupar`
  substituídos por `projetarCatalogoVitrine(...)` **→** `agruparCatalogo(...)`. O `map` que zera
  `foto_url` por grupo (l. 188-190) **permanece intacto** (é a 248).
- `src/lib/utils/catalogoVitrine.test.ts` — edição **mecânica** dos call-sites da 224 + as duas
  guardas da Armadilha 2 + os `describe("247 — …")` novos.

**NÃO tocar (com motivo)**
- `src/lib/supabase/queries/produtos.ts` — `agruparCatalogo` **já é genérica**; `buscarProdutosPublicos`
  já traz `visibilidade`. Qualquer diff aqui é sinal de que o plano foi desviado.
- `src/lib/supabase/queries/produtos.test.ts` — critério de aceite explícito.
- `supabase/migrations/**` — nenhuma migration; nada a aplicar no cloud nesta issue.
- `src/components/vitrine/**` (`CatalogoVitrine`, `SecaoCatalogo`, `CardProduto`,
  `ItemProdutoLista`, `BuscaProdutos`) — selo e estado não-comprável são a 262; seções são 263.
- `src/lib/utils/buscarProdutos.ts` (`filtrarCatalogo`) — é subtrativa e repassa o objeto por
  referência; **verificar, não editar**.
- `src/lib/actions/pedido.ts` / `revisarCarrinhoAction` — 249 e 252.
- `src/lib/database.types.ts` — já contém tudo; **não** regenerar dentro desta issue.

### Dependências Externas

**Nenhum pacote novo.** Nada de `react-imask`, `zod` novo, lib de data ou de fuso: toda a aritmética
de fuso já está em `src/lib/utils/fusoLoja.ts` (222) via `Intl`, e a decisão de janela em
`vigenciaCardapio.ts` (246).
**Custo e quota:** nenhuma API externa é chamada; **zero custo variável**. O único custo novo é uma
query a mais por render de vitrine contra o Supabase — dentro do mesmo plano e da mesma conexão
PostgREST já usada pelas outras quatro, sem cobrança por chamada.

### Ordem de Implementação

1. **RED (`tdd`) — antes de qualquer código de produção.** Os testes da §5.7, com `FAIL` capturado.
   Nesta fase o `tsc` da suíte da 224 já reprova; a edição mecânica dos call-sites (Armadilha 1)
   faz parte do RED, porque sem ela o arquivo de teste nem roda.
2. `vigenciaCardapio.ts`: os dois normalizadores (D6) — é o tipo de que tudo abaixo depende.
3. `queries/cardapios.ts`: `buscarCardapiosComProdutos` — dá a entrada real de `cardapiosPorProduto`.
4. `catalogoVitrine.ts`: `MotivoNaoCompravel` → `projetarProdutoVitrine` → `projetarCatalogoVitrine`
   (nesta ordem: a de catálogo chama a de produto).
5. `page.tsx`: 5ª query + inversão da ordem. **Por último**, porque só aqui as duas peças novas se
   encontram e só aqui as guardas estáticas fazem sentido verdes.
6. Guardas estáticas da Armadilha 2 ajustadas; suíte inteira verde.
7. `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.

### O que o RED precisa provar (§5.7)

- [ ] `compravel === disponivel && dentroDaJanela` nas **seis** linhas renderizáveis do cenário 3
      (a terça-feira do cardápio sáb+dom 11:00–15:00), incluindo as duas linhas `'menu'`;
- [ ] fora da janela **e** `disponivel = false` ⇒ motivo **`"fora_da_janela"`** (precedência);
- [ ] produto `'menu'` fora da janela ⇒ `compravel === true` e **nenhuma** entrada em
      `rotulosVigencia`;
- [ ] cenário 6 literal: a sopa `'cardapio'` **não está** na lista devolvida **e** a categoria que só
      tinha ela **não é devolvida** por `agruparCatalogo` — asserção sobre a saída de
      `agruparCatalogo(projetarCatalogoVitrine(...).produtos, categorias)`, a composição real da
      página; a Coca-Cola `'menu'` do mesmo cardápio expirado segue comprável;
- [ ] `expect(Object.keys(projetado)).not.toContain("visibilidade")` — asserção sobre as **chaves**,
      não sobre o valor (e as 12 chaves continuam lá);
- [ ] **todo** produto com motivo `"fora_da_janela"` tem entrada em `rotulosVigencia`, verificado por
      propriedade sobre a lista inteira (`produtos.filter(motivo === "fora_da_janela")
      .every(p => p.id in rotulosVigencia)`), e **nenhum** produto comprável tem;
- [ ] `cardapiosAbertos` contém exatamente os cardápios ativos abertos naquele instante, e preserva
      `ordem` (D4);
- [ ] lista de cardápios vazia ⇒ saída **idêntica** ao v1 (não-regressão);
- [ ] `npx vitest run src/lib/supabase/queries/produtos.test.ts` verde **sem uma edição** no arquivo
      (`git diff --stat` do arquivo = vazio no fim da issue).

### Performance

Custo esperado, com a linha de base de `performance/2026-09-20-224-contrato-de-catalogo.md`
(mediana da leitura de catálogo ≈ 40 ms, dominada pelo RTT de ~35 ms):

- **Latência de parede: ~0 ms.** A query nova entra no `Promise.all` que já existe; ela só aparece
  no tempo total se for **mais lenta** que `buscarProdutosPublicos`, o que é improvável (uma loja
  tem unidades de cardápios; o embed usa `cardapio_produtos(loja_id, cardapio_id)`, criado pela 243).
- **Payload:** o embed devolve um uuid por vínculo. Teto real = nº de produtos da loja × nº de
  cardápios; 68 produtos × 3 cardápios ≈ 200 uuids ≈ 8 KB — abaixo dos 7,6 KB que a projeção nomeada
  da 265 já economizou.
- **CPU do SSR:** `avaliarVigenciaDoProduto` é O(produtos × cardápios do produto), sem I/O e sem
  `Intl` por produto além do que a 246 já faz. **Nenhuma memoização aqui** — a de `proximaAbertura`
  (1× por cardápio por request) é da 254.
- **Cache: proibido**, e a guarda estática da 224 continua provando (`revalidate`, `'use cache'`,
  `unstable_cache`, `force-static`). Um cardápio que abre às 11:00 tem de abrir às 11:00.

**O que o `acelerar` mede depois** (novo arquivo em `performance/`, escopo `/loja/[slug]`):
1. A/B **intercalado** (25 rodadas alternadas, o método que a nota da 224 fixou depois de uma
   medição errada por drift de rede) da página inteira, antes × depois, em `lanches-base`;
2. latência isolada da query nova vs. as duas do mesmo `Promise.all` — a pergunta é **se ela virou
   o caminho crítico**, não quanto ela custa sozinha;
3. bytes do embed com 0, 1 e 3 cardápios;
4. `EXPLAIN ANALYZE` em pglite do embed, confirmando o índice `(loja_id, cardapio_id)`;
5. reconfirmar que o `EXISTS` da view da 245 segue custando zero enquanto 100% dos produtos são
   `'menu'` (primeiro braço do `OR`).

### Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | A edição mecânica da suíte da 224 vira edição **semântica** e mascara uma regressão do contrato | regra explícita: só o call-site muda; qualquer asserção alterada é motivo de reverter |
| R2 | `ROTULO_VIGENCIA_PROVISORIO` sobrevive à onda 4 e a vitrine mostra "Indisponível no momento" onde D4 prometeu "volta sábado" | item de escopo obrigatório na 254 + `grep` no aceite dela (D3). **Precisa ser registrado na 254 antes do merge desta issue** |
| R3 | 249/252 escreverem o próprio estreitamento de `modo`/`visibilidade` e divergirem do SSR | normalizadores exportados de `vigenciaCardapio.ts` + `grep -rn "as CardapioVigencia" src/` vazio no aceite |
| R4 | A 248 precisar reabrir o retorno de `projetarCatalogoVitrine` (p.ex. por `ordem` ausente) | resolvido em D4 pela genérica `C extends CardapioVigencia` |

### Checklist de Validação Pós-Implementação

- [ ] `npx tsc --noEmit` → `npm run lint` (**zero warning novo**, inclusive `no-unused-vars`) →
      `npm test` → `npm run build`
- [ ] `git diff --stat src/lib/supabase/queries/produtos.ts src/lib/supabase/queries/produtos.test.ts`
      = **vazio**
- [ ] As 4 guardas estáticas da 224 passam (2 delas com a extensão autorizada, e **só** ela)
- [ ] `visibilidade` ausente das chaves do objeto projetado; 12 chaves intactas
- [ ] Loja sem cardápio ⇒ catálogo idêntico ao de antes da issue (comparação por conjunto de ids)
- [ ] Nenhuma coluna crua de vigência (`dias_semana`, `hora_inicio`, `prazo_fim`, `visibilidade`)
      aparece no HTML/payload RSC de `/loja/[slug]` — conferir com `curl | grep`
- [ ] Nenhuma migration nova; `npx supabase migration list` inalterado
- [ ] Nenhum secret, nenhum dado pessoal, nenhuma dependência nova em `package.json`
