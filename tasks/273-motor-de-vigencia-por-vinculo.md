# [273] Motor de vigência por vínculo: `VinculoVigencia`, `itemAberto`, rótulos e consumidores autoritativos

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública + painel (contrato de dados compartilhado)
**Depende de:** [272]
**Spec:** specs/vigencia-por-item-do-cardapio.md — RN-01, RN-02, RN-03, RN-04, RN-07, RN-08, RN-09

## Origem

Spec §O motor + §Contrato de dados em TypeScript. Fatia coesa por decisão do
`plan/loop-vigencia-por-item-do-cardapio.md` §5 passo 2: um único vermelho principal cobre a
invariante de dinheiro — **`criarPedido` recusa a Feijoada numa segunda-feira**.

## Objetivo

Trocar o eixo do motor de "cardápio" para "vínculo": `avaliarVigenciaDoProduto` passa a receber
`VinculoVigencia[]`, `itemAberto` filtra **dentro** da janela do cardápio, os rótulos passam a ler os
dias do item, e os dois consumidores autoritativos (`pedido.ts`, `revisarCarrinho.ts`) recusam o item
fora do dia.

## Escopo

- [ ] `vigenciaCardapio.ts`: tipo `VinculoVigencia<C>`, `itemAberto(vínculo, agora, tz)` = `cardapioAberto` **E**
      (`dias_semana` vazio **OU** contém `diaIndex`), `diaIndex` vindo de `partesNoFusoCompletas` (RN-01)
- [ ] `avaliarVigenciaDoProduto(produto, vinculos, agora, timezone)`: união sobre vínculos, curto-circuito
      de `visibilidade === 'menu'` intacto (RN-02); `voltaAAbrir` passa a ser propriedade do vínculo (RN-03)
- [ ] `descreverVigencia.ts`: "Todos os dias" quando os 7 dias estão marcados, num curto-circuito só,
      antes de `corridaDaSemana`, valendo para a prévia longa e o selo curto (RN-07)
- [ ] `descreverVigencia.ts`: `rotuloVoltaQuando` ganha a variante por vínculo — "Só às quartas e sábados",
      teto de 32 caracteres na função pura, faixa de horas vinda do **cardápio**; precedência cardápio
      fechado > item fora do dia (RN-08)
- [ ] `queries/cardapios.ts`: `COLUNAS_CARDAPIO_VIGENCIA` embute `cardapio_produtos(produto_id, dias_semana)`;
      índice `cardapiosPorProduto` **renomeado** para `vinculosPorProduto: Map<string, VinculoVigencia<CardapioDaLoja>[]>`
- [ ] Rename mecânico propagado nos consumidores (17 arquivos não-teste + ~13 de teste), com `tsc` como gate
- [ ] `pedido.ts` (`criarPedido`) e `revisarCarrinho.ts` passam vínculos ao motor — recusa do **pedido inteiro**,
      antes da RPC, no laço que já recusa produto indisponível/oculto/de outra loja (RN-04)
- [ ] `contarProdutosEscondidos.ts`: `CardapiosPorProdutoLidos` → `VinculosPorProdutoLidos` (rename de tipo e
      assinaturas; a mudança de **comportamento** da contagem é [280])

## Fora de escopo

- Filtro por item em `agruparPorCardapio` e sumiço da seção — [279]
- Comportamento novo de `contarProdutosEscondidos`/`diagnosticarSumico` — [280]
- Qualquer Server Action de escrita de dias — [274]
- Qualquer `.tsx` de painel — [275]–[278]
- `voltaAAbrir` resolver a interseção vazia (§Fora do Escopo; mitigado por aviso em [276])

## Reuso esperado

- `partesNoFusoCompletas` (`lib/utils/fusoLoja.ts`) — única fonte de `diaIndex`; nenhum `Intl` novo
- `cardapioAberto`, `proximaAbertura`, `escolherCardapioParaRotulo` — já existem
- `DIAS_LONGOS`/`DIAS_PLURAIS`/`DIAS_CURTOS`, `corridaDaSemana`, `enumerar` em `descreverVigencia.ts` —
  **nenhuma segunda tabela de nome de dia** (mandato 2)
- `src/lib/actions/paridade-preview-autoritativo.test.ts` como gate de paridade preview × autoritativo

## Segurança

- Muda o predicado que decide **se um item pode ser vendido** → caminho autoritativo do pedido
- Cliente nunca envia dia, hora, fuso nem preço; `criarPedido` recalcula do banco (`seguranca.md` §10)
- Nenhum motivo novo em `MotivoNaoCompravel`: item fora do dia produz `"fora_da_janela"`
- Nenhuma tabela nova, nenhuma RLS nova

## Critério de aceite

- [ ] RED capturado com `FAIL` real, em `src/lib/actions/pedido.vigencia-cardapio.test.ts`:
      `criarPedido` recusa a Feijoada (vínculo `{qua, sáb}` em cardápio aberto os 7 dias) numa segunda-feira
- [ ] RED também em `src/lib/utils/descreverVigencia.test.ts` para "Só às quartas e sábados" e "Todos os dias"
- [ ] `npx vitest run src/lib/actions/pedido.vigencia-cardapio.test.ts src/lib/actions/revisarCarrinho.vigencia.test.ts src/lib/utils/vigenciaCardapio.test.ts src/lib/utils/descreverVigencia.test.ts` verde
- [ ] `grep -r cardapiosPorProduto src/` → **vazio**
- [ ] `npx tsc --noEmit` = 0 erros; `npm test` verde, com `paridade-preview-autoritativo.test.ts` verde

---

## Plano Técnico

> Plano completo: `plan/273-motor-de-vigencia-por-vinculo.md` (decisões rejeitadas, seams com
> 279/280 e contrato de teste para o `tdd`). Esta seção é o que o `executar` precisa ter em mãos.

### Diagnóstico

**Causa raiz.** O motor de vigência tem o eixo errado. `avaliarVigenciaDoProduto` recebe
`CardapioVigencia[]` — o produto herda a janela do cardápio **inteira**, sem nenhum lugar onde
uma restrição *do vínculo* possa existir. Não é que falte uma validação: falta um **tipo**. O
`Map<string, CardapioDaLoja[]>` que `buscarCardapiosComProdutos` devolve joga fora a linha de
`cardapio_produtos` assim que lê `produto_id` dela (`queries/cardapios.ts:79-84`), e a coluna
`dias_semana` que a 272 criou não tem por onde chegar a quem decide. A correção certa é trocar o
eixo do motor de "cardápio" para "vínculo" em toda a cadeia — não pendurar um segundo filtro em
cada consumidor.

**Por que é complexo.**
1. Muda **contrato de dados** consumido por 30 arquivos (17 não-teste + 13 de teste).
2. Toca o **caminho autoritativo do pedido**: `criarPedido` passa a recusar por um predicado novo.
3. Toca **duas superfícies de rótulo** (prévia do painel e selo da vitrine) que compartilham a
   mesma tabela de nomes de dia, com precedência nova entre dois motivos de "fora da janela".
4. O mesmo `Map` alimenta vitrine pública (anon), painel do lojista (RLS) e hub admin
   (`service_role`, BYPASSRLS) — nenhuma regra pode morar na RLS.
5. Deixa **seams abertos** para 279 (seção só-itens-do-dia) e 280 (contagem de escondidos), que
   consomem o tipo novo antes de mudarem de regra.

### Mapa de Impacto

```
cardapio_produtos.dias_semana (272, NULL em 100% das linhas de hoje)
  └── COLUNAS_CARDAPIO_VIGENCIA (embed cardapio_produtos(produto_id, dias_semana))
      └── buscarCardapiosComProdutos → { cardapios, vinculosPorProduto }   ← RENAME
          ├── buscarCardapiosDoPainel → vinculosPorProduto                 ← RENAME
          │   ├── (painel)/cardapios/page.tsx  → contarProdutosEscondidos  [preview UX]
          │   └── admin/[lojaId]/carga-cardapios.ts → idem                 [preview UX]
          ├── (publica)/loja/[slug]/page.tsx
          │   ├── projetarCatalogoVitrine(vinculosPorProduto)     [SSR — estado do card]
          │   │   ├── avaliarVigenciaDoProduto(produto, VÍNCULOS) ← FONTE ÚNICA DA REGRA
          │   │   └── escolherVinculoParaRotulo + rotuloVoltaQuando(VÍNCULO)  [SSR — a frase]
          │   └── agruparPorCardapio(…, vinculosPorProduto)       [só o tipo em 273; regra em 279]
          ├── (painel)/produtos/page.tsx → diagnosticarSumico(VÍNCULOS)    [preview UX]
          ├── (painel)/cardapios/[cardapioId]/page.tsx → v.cardapio.id     [preview UX]
          ├── admin/[lojaId]/carga-cardapio-detalhe.ts → idem              [preview UX]
          ├── lib/actions/revisarCarrinho.ts  → avaliarVigenciaDoProduto   [Server Action]
          └── lib/actions/pedido.ts (criarPedido) → avaliarVigenciaDoProduto
                                                    [Server Action — AUTORITATIVO, recusa a venda]
```

**Onde a invariante "este item pode ser vendido agora?" é garantida:**

```
itemAberto(vínculo, agora, tz)
  ├── lib/utils/vigenciaCardapio.ts  — [FONTE ÚNICA DE VERDADE, função pura]
  ├── catalogoVitrine.ts (SSR)       — [servidor, mas só ESTADO do card: preview]
  ├── revisarCarrinho.ts             — [Server Action — preview autoritativo do checkout]
  └── pedido.ts (criarPedido)        — [Server Action — AUTORITATIVO: recusa o pedido inteiro]
```

O cliente **nunca** envia dia, hora, fuso, `visibilidade`, cardápio ou preço. `agora` é o relógio
do servidor; `timezone` vem de `lojas.timezone` lido do banco. Nenhuma camada de banco participa:
por RN-14 da spec, **nada pode morar na RLS** (o hub admin roda sob `service_role`/BYPASSRLS) —
por isso a regra é função pura chamada pelos três caminhos, e o único caminho que *decide dinheiro*
é `criarPedido`. **Nenhuma política RLS nova, nenhum CHECK novo, nenhuma migration** nesta issue:
a 272 já entregou coluna + CHECK de domínio + tipos, e política é por linha, não por coluna.

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/utils/vigenciaCardapio.ts` | decide vigência a partir de `CardapioVigencia[]` | ganha `VinculoVigencia<C>`, `itemAberto`; `voltaAAbrir` e `avaliarVigenciaDoProduto` passam a receber vínculo |
| `src/lib/utils/descreverVigencia.ts` | 5 redações sobre `CardapioVigencia` | `escolherCardapioParaRotulo` → `escolherVinculoParaRotulo`; `rotuloVoltaQuando(vínculo, agora, tz)`; RN-07 "Todos os dias"; preposição concordando com o 1º dia |
| `src/lib/supabase/queries/cardapios.ts` | embed `cardapio_produtos(produto_id)`; índice `cardapiosPorProduto` | embed ganha `dias_semana`; índice vira `vinculosPorProduto: Map<string, VinculoVigencia<CardapioDaLoja>[]>` (em `buscarCardapiosComProdutos` **e** `buscarCardapiosDoPainel`) |
| `src/lib/actions/pedido.ts` | `criarPedido` recusa fora da janela antes da RPC (`:224-233`) | passa **vínculos** ao motor. Nenhuma linha de regra nova |
| `src/lib/actions/revisarCarrinho.ts` | linha bloqueada com `fora_da_janela` (`:230-247`) | idem |
| `src/lib/utils/catalogoVitrine.ts` | projeta o catálogo e agrupa por cardápio | tipos e acessos `v.cardapio`; chamada nova de rótulo. **A regra de `agruparPorCardapio` NÃO muda (é 279)** |
| `src/lib/utils/contarProdutosEscondidos.ts` | conta/lista escondidos e diagnostica sumiço | rename de tipo e assinaturas; `v.cardapio.*`. **Comportamento idêntico (é 280)** |
| `src/components/painel/contrato-lote.ts` | `CardapiosPorProduto = Record<string, CardapioDoProduto[]>` (tipo de **apresentação**) | rename para `VinculosPorProduto` / `VinculoDoProduto`. O campo `dias` é 275/278 |
| 13 arquivos de teste | fixtures com `cardapiosPorProduto` | rename + `{ cardapio, dias_semana: null }` nas fixtures |
| `CardProduto`, `ItemProdutoLista`, `ProdutoModal`, `SecaoCatalogo`, `NavCategorias`, `filtrarCatalogo`, `rotuloEsgotado.ts`, `FormVigencia.tsx`, `SeletorProdutosDoCardapio.tsx` | consomem `compravel`/`motivoNaoCompravel`/`rotulosVigencia` | **NÃO TOCAR** — o contrato que eles leem é byte a byte o mesmo |
| `supabase/migrations/*`, `src/lib/database.types.ts` | coluna + CHECK + tipos | **NÃO TOCAR** — entregues pela 272 |

### Contratos de Dados

Nenhuma mudança de schema. A mudança de contrato é **em TypeScript**:

```ts
// src/lib/utils/vigenciaCardapio.ts
/** Um vínculo produto↔cardápio reduzido ao que decide vigência (RN-01). */
export type VinculoVigencia<C extends CardapioVigencia = CardapioVigencia> = {
  cardapio: C;
  /** 0=dom..6=sab. NULL ou vazio = todos os dias do cardápio. NUNCA uma 2ª janela. */
  dias_semana: number[] | null;
};

/** RN-01 — filtro DENTRO da janela do cardápio. */
export function itemAberto(
  vinculo: VinculoVigencia, agora: Date, timezone: string,
): boolean;

/** RN-02 — união sobre VÍNCULOS; `visibilidade === 'menu'` continua curto-circuitando antes. */
export function avaliarVigenciaDoProduto(
  produto: ProdutoVigencia,
  vinculos: VinculoVigencia[],
  agora: Date,
  timezone: string,
): VigenciaDoProduto;

// privada, RN-03 — propriedade do VÍNCULO; o eixo do item NÃO entra no predicado
function voltaAAbrir(vinculo: VinculoVigencia, agora: Date): boolean;
```

```ts
// src/lib/utils/descreverVigencia.ts
export function escolherVinculoParaRotulo<C extends CardapioVigencia>(
  vinculos: VinculoVigencia<C>[],
  proxima: (cardapio: C) => Date | null,
): VinculoVigencia<C> | null;

/** RN-08 — precedência: cardápio fechado > item fora do dia. Por isso `agora` entra. */
export function rotuloVoltaQuando(
  vinculo: VinculoVigencia, agora: Date, timezone: string,
): string;
```

```ts
// src/lib/supabase/queries/cardapios.ts
export const COLUNAS_CARDAPIO_VIGENCIA =
  "id, nome, ativo, ordem, modo, dias_semana, dias_mes, hora_inicio, hora_fim, " +
  "prazo_inicio, prazo_fim, cardapio_produtos(produto_id, dias_semana)";

buscarCardapiosComProdutos(client, lojaId):
  Promise<{ cardapios: CardapioDaLoja[];
            vinculosPorProduto: Map<string, VinculoVigencia<CardapioDaLoja>[]> }>
```

```ts
// src/lib/utils/contarProdutosEscondidos.ts
export type VinculosPorProdutoLidos = ReadonlyMap<string, VinculoVigencia[]>;
// listarProdutosEscondidos / contarProdutosEscondidos: 3º parâmetro passa a ser VinculosPorProdutoLidos
// diagnosticarSumico(produto, vinculos: readonly VinculoVigencia[], agora, timezone)
```

`LinhaCardapio.cardapio_produtos` passa a `{ produto_id: string; dias_semana: number[] | null }[] | null`.
`dias_semana` do embed **não** é estreitado nem saneado na query: `ordenarSemana`/`itemAberto`
já filtram inteiro fora de 0..6 (o CHECK `cardapio_produtos_dias_semana_dominio` é o backstop).

### Decisões de Design

**D1 — `escolherCardapioParaRotulo` vira `escolherVinculoParaRotulo` (rename), não só troca de tipo.**
(a) manter o nome e devolver vínculo: zero diffs a mais, mas é exatamente o padrão que RN-09 da
spec condena — nome que mente sobre o conteúdo. (b) **Escolhida:** renomear. Mesmo argumento do
`vinculosPorProduto`, mesma issue, mesmo gate (`tsc`). Dois callers (`catalogoVitrine.ts` e testes).

**D2 — `rotuloVoltaQuando` ganha `agora`, e a precedência de RN-08 mora nela.**
(a) o caller decide qual frase pedir: espalha a precedência por N callers — é a "lista de guards
em N caminhos" que o mandato proíbe. (b) **Escolhida:** a função pura recebe o vínculo e `agora`,
pergunta `cardapioAberto(vinculo.cardapio, agora, tz)` e decide sozinha: aberto ⇒ frase do **item**,
fechado ⇒ frase do **cardápio** (exatamente o `textoDoSelo` de hoje, intacto). Uma casa, afirmável
byte a byte sem DOM. Custo: `cardapioAberto` roda uma vez a mais por produto marcado — O(1),
sem `Intl` novo (`partesNoFusoCompletas` já é chamada no mesmo request).

**D3 — "Todos os dias" (RN-07) sai de um helper único, não de dois ifs.**
(a) um `if (semana.length === 7)` em `descreverVigencia` e outro em `textoDoSelo`: duas casas da
mesma regra, exatamente o que M6 existe para impedir. (b) **Escolhida:** extrair
`descreverDiasDaSemana(semana: number[], forma: "longa" | "curta"): string`, que contém o
curto-circuito de 7 dias **antes** de `corridaDaSemana` e é usada pelas duas redações.
Consequência assumida: com `dias_semana` de 7 **e** `dias_mes` preenchido, a prévia longa lê
*"Aparece todos os dias, e também todo dia 15 do mês."* — verdadeiro, raro, e preferível a um
terceiro ramo de redação.

**D4 — A preposição do plural concorda com o PRIMEIRO dia enumerado.**
Hoje `textoDoSelo` escreve `Só aos ${plurais}` fixo. Com o item {qua, sáb} isso daria *"Só aos
quartas e sábados"*, e a spec pede *"Só às quartas e sábados"*. (a) hard-code "às" no ramo do item:
cria duas redações divergentes para a mesma lista de dias. (b) **Escolhida:** `preposicaoPlural(dia)`
= `dia === 0 || dia === 6 ? "aos" : "às"`, aplicada ao **primeiro** dia de `ordenarSemana` (que
começa na segunda), usada pelas duas redações. Efeito colateral **desejado**: o cardápio {ter, qui}
deixa de dizer "Só aos terças e quintas". O único teste que afirma a frase hoje
(`descreverVigencia.test.ts:144`, `{sáb, dom}` → "Só aos sábados e domingos") **continua verde**,
porque sábado é o primeiro na ordem seg-first.

**D5 — `voltaAAbrir` recebe o vínculo e IGNORA `dias_semana` — deliberado (RN-03).**
Encodar o dia do item ali obrigaria o predicado a ler a regra de dia e criaria a segunda casa de
RN-02 da spec-mãe. Fica como está; a interseção vazia é tratada por aviso no painel (RN-06, issue
276) e está em §Fora do Escopo da spec. Ver **Riscos** no plano companheiro.

**D6 — O rename alcança o tipo de apresentação `CardapiosPorProduto` (`contrato-lote.ts`).**
O gate de aceite é `grep -r cardapiosPorProduto src/` **vazio**, e a prop de `ProdutosClient` /
`CardapioAdminClient` usa esse nome. (a) renomear só a prop e deixar o tipo: meia-verdade que
obriga um segundo passe mecânico na 275. (b) **Escolhida:** renomear tipo e prop
(`VinculosPorProduto` / `VinculoDoProduto`), **sem** acrescentar o campo `dias` — ele é da 275/278.
Não é violação do "fora de escopo: qualquer `.tsx` de painel": o `.tsx` muda só o **identificador**,
nenhuma linha de render.

### Cenários

**Caminho feliz.** Quarta-feira, 12:00 no fuso da loja. Cardápio "Especiais do Dia" recorrente com
os 7 dias marcados; Feijoada vinculada com `dias_semana = [3, 6]`. `itemAberto` = `true E true` ⇒
`dentroDaJanela`; o card é comprável, a revisão do carrinho soma a linha e `criarPedido` grava.

**Bordas:**

| Caso | Resultado esperado |
|---|---|
| Segunda-feira, mesmo vínculo | `dentroDaJanela=false`, `visivelNaVitrine=true` (RN-03), card marcado, selo "Só às quartas e sábados", `criarPedido` ⇒ `ERRO_FORA_DA_JANELA`, RPC **não chamada** |
| `dias_semana` `NULL` ou `[]` | idêntico a hoje, byte a byte — é 100% das linhas no deploy da 272 |
| `visibilidade = 'menu'` com vínculo {qua, sáb}, numa segunda | **vende**: RN-02 curto-circuita antes de olhar vínculo nenhum |
| Cardápio `ativo = false` com item {qua}, numa quarta | fechado — `ativo` é filtrado antes de `itemAberto` |
| Cardápio {sáb, dom} + item {qua} | nunca abre; `visivelNaVitrine` continua `true` (RN-03, lacuna deliberada) |
| Cardápio {sáb,dom} + `dias_mes {15}`, item {qua}, quarta dia 15 | **ABERTO** — o `OU` dos eixos fica dentro de `cardapioAberto`; dia 16 ⇒ fechado |
| Produto em 2 vínculos, um aberto hoje e um não | comprável (união, RN-02) — pôr em mais um cardápio nunca reduz disponibilidade |
| Vínculo duplicado vindo do banco | a união é idempotente; `agruparPorCardapio` já deduplica por `cardapio.id` |
| Virada de meia-noite entre carrinho e checkout | `revisarCarrinhoAction` bloqueia a linha; `criarPedido` recusa o pedido inteiro — mesma função pura, mesmo `agora` do servidor |
| Duplo submit / payload forjado com `dias_semana` no corpo | o schema zod do pedido é `.strict()` e não declara nada de vigência; o servidor lê dia e vínculo do banco |
| `cardapios` indisponível (erro do PostgREST) | `buscarCardapiosComProdutos` propaga; `Promise.all` rejeita; catch externo ⇒ recusa fail-closed. Inalterado |
| `modo` fora do domínio | `paraCardapioVigencia` ⇒ `null`, a linha é descartada e **os vínculos dela não entram no Map**. Inalterado |

**Tratamento de erro.** Nenhuma mensagem nova. Item fora do dia produz o mesmo
`ERRO_FORA_DA_JANELA` / `motivoNaoCompravel: "fora_da_janela"` de hoje — não há motivo novo em
`MotivoNaoCompravel`, e o cliente não distingue "cardápio fechado" de "item fora do dia" a não ser
pela frase do selo. Erro de banco nunca vaza (`seguranca.md` §14, caminho inalterado).

### Recálculo no Servidor

| O cliente envia | O servidor faz |
|---|---|
| `produto_id`, `quantidade`, `loja_id`, `forma_pagamento`, endereço, cupom | lê `produtos`, `cardapios` + `cardapio_produtos.dias_semana` e `lojas.timezone` **do banco**, sob `service_role`, escopado por `.eq("loja_id", …)` |
| — nada de dia, hora, fuso, cardápio, `visibilidade`, preço (`.strict()` rejeita) | avalia `avaliarVigenciaDoProduto` com `new Date()` do servidor e o fuso da **loja**; fora do dia ⇒ recusa o **pedido inteiro antes da RPC** |
| — | preço, subtotal, frete, desconto e total seguem recalculados do zero (`seguranca.md` §10, inalterado) |

`revisarCarrinhoAction` usa **a mesma** função pura, com a **mesma** query
(`buscarCardapiosComProdutos`) — é essa identidade estrutural que
`src/lib/actions/paridade-preview-autoritativo.test.ts` trava, e ele **tem de continuar verde**.

### Arquivos

**Criar:** nenhum arquivo de produção. (Os testes novos/estendidos são do `tdd`.)

**Modificar (nível função):**

1. `src/lib/utils/vigenciaCardapio.ts` — `+ VinculoVigencia<C>`, `+ itemAberto`;
   `voltaAAbrir(vinculo, agora)`; `avaliarVigenciaDoProduto(produto, vinculos, agora, tz)`.
   `cardapioAberto`, `dentroDoPrazo`, `dentroDaRecorrencia`, `paraCardapioVigencia`,
   `visibilidadeDe` **intactos**.
2. `src/lib/supabase/queries/cardapios.ts` — `COLUNAS_CARDAPIO_VIGENCIA`, `LinhaCardapio`,
   `buscarCardapiosComProdutos` (monta `{ cardapio, dias_semana }`), `buscarCardapiosDoPainel`
   (repassa o rename). `buscarCardapioPorId`, `cardapioPertenceALoja`, `buscarLinhasDaPrevia`,
   `buscarProdutosQueFicariamOrfaos` **intactos**.
3. `src/lib/utils/descreverVigencia.ts` — `+ descreverDiasDaSemana`, `+ preposicaoPlural`,
   `+ textoDoSeloDoItem`; `escolherVinculoParaRotulo`; `rotuloVoltaQuando(vinculo, agora, tz)`;
   `descreverVigencia` e `textoDoSelo` passam a chamar o helper. `proximaAbertura`,
   `rotuloJanelaDestaque`, `rotuloAbreQuando`, `rotuloAgora`, `descreverPrazoFixo` **intactos**.
4. `src/lib/utils/catalogoVitrine.ts` — `projetarProdutoVitrine(produto, vinculos, …)`,
   `projetarCatalogoVitrine({ vinculosPorProduto, … })` (inclui o laço de `cardapiosAbertos`, que
   passa a ler `v.cardapio`), a chamada de rótulo, e a **assinatura** de `agruparPorCardapio`.
   **O corpo de `agruparPorCardapio` só troca `cardapio` por `v.cardapio` — o filtro por
   `itemAberto` é a issue 279.**
5. `src/lib/utils/contarProdutosEscondidos.ts` — `VinculosPorProdutoLidos`, `vinculado`,
   `listarProdutosEscondidos`, `contarProdutosEscondidos`, `diagnosticarSumico`. **Sem mudança de
   comportamento (280).**
6. `src/lib/actions/pedido.ts:226` e `src/lib/actions/revisarCarrinho.ts:232` — passam
   `cardapios.vinculosPorProduto.get(produto.id) ?? []`. Nenhuma outra linha.
7. `src/components/painel/contrato-lote.ts` — `CardapioDoProduto` → `VinculoDoProduto`,
   `CardapiosPorProduto` → `VinculosPorProduto` (**rename puro**).
8. Rename mecânico (`grep -rl cardapiosPorProduto src/`), com `v.cardapio.*` onde a lista era
   percorrida: `(publica)/loja/[slug]/page.tsx`, `(painel)/produtos/page.tsx` (o `map` de
   `lista.map(c => …)` vira `lista.map(v => … v.cardapio …)` e a chamada de `diagnosticarSumico`),
   `(painel)/produtos/ProdutosClient.tsx`, `(painel)/cardapios/page.tsx`,
   `(painel)/cardapios/[cardapioId]/page.tsx` (`.some(v => v.cardapio.id === cardapioId)`),
   `admin/[lojaId]/carga-cardapios.ts`, `admin/[lojaId]/carga-cardapio-detalhe.ts`,
   `admin/[lojaId]/cardapios/page.tsx`, `admin/[lojaId]/cardapios/[cardapioId]/page.tsx`,
   `admin/[lojaId]/produtos/page.tsx`, `admin/[lojaId]/produtos/CardapioAdminClient.tsx`
   + os 13 arquivos de teste.

**NÃO tocar (e por quê):**

| Arquivo | Motivo |
|---|---|
| `supabase/migrations/**`, `src/lib/database.types.ts` | 272 já entregou coluna, CHECK e tipos. Nenhuma migration nesta issue |
| `src/lib/actions/cardapio.ts`, `admin-cardapios.ts`, `cardapio-contrato.ts`, `lib/validacoes/cardapio.ts` | escrita de dias é a **274** |
| `FormVigencia.tsx`, `SeletorProdutosDoCardapio.tsx`, `FormProduto.tsx`, `rascunhoCardapio.ts` | UI do painel é **275–278** |
| `CardProduto`, `ItemProdutoLista`, `ProdutoModal`, `SecaoCatalogo`, `CatalogoVitrine`, `NavCategorias`, `ancoraSecao`, `filtrarCatalogo`, `rotuloEsgotado.ts` | consomem `compravel`/`motivoNaoCompravel`/`rotulosVigencia`, que não mudam |
| `src/lib/utils/fusoLoja.ts` | `partesNoFusoCompletas` é a única fonte de `diaIndex`; nenhum `Intl` novo (mandato 2) |
| corpo da regra de `agruparPorCardapio` | é a 279 |
| regra de `contarProdutosEscondidos`/`diagnosticarSumico` | é a 280 |

### Dependências Externas

**Nenhuma.** Nenhum pacote novo, nenhum `package.json` tocado, nenhuma API externa, nenhuma chave.
**Custo e quota (`architecture.md` §9 nº1):** zero custo variável — nenhuma ida a mais ao banco
(o embed `cardapio_produtos(...)` já existe e ganha **uma coluna escalar** `smallint[]`; o payload
cresce ~alguns bytes por vínculo), nenhuma chamada de rede nova, nenhum índice novo. Não há o que
estourar e não há degradação a negociar. O custo de CPU adicional é `dias_semana.includes(diaIndex)`
por vínculo — O(1) sobre no máximo 7 elementos, sem `Intl` novo.

### Ordem de Implementação

Estrita. O `tsc` fica vermelho entre os passos 2 e 6 — isso é esperado, o gate é no fim de cada
bloco lógico, não a cada arquivo.

1. **RED (`tdd`)** — ver §Critério de aceite e o contrato de teste em
   `plan/273-motor-de-vigencia-por-vinculo.md`. `FAIL` real capturado **antes** de qualquer código
   de produção (mandato 3: isto é o predicado que decide venda).
2. **Tipo + motor** — `vigenciaCardapio.ts`. Primeiro porque **todo o resto depende do tipo**:
   `VinculoVigencia` é o contrato que a query produz e que os consumidores leem.
3. **Query** — `queries/cardapios.ts`. Segundo porque é quem **produz** o tipo; sem ela nenhum
   consumidor tem o que passar. Gate: `npx vitest run src/lib/supabase/queries/cardapios.test.ts`.
4. **Rename mecânico** — os 30 arquivos + `contrato-lote.ts`. Terceiro porque só aqui o `tsc`
   volta a 0: cada erro que ele aponta é exatamente um lugar que lia cardápio e agora lê vínculo.
   Gate: `npx tsc --noEmit` = 0 **e** `grep -rn cardapiosPorProduto src/` vazio.
5. **Consumidores autoritativos** — `pedido.ts` e `revisarCarrinho.ts`. Quarto porque é o vermelho
   principal: com 2–4 prontos, o teste do checkout fecha. Gate:
   `npx vitest run src/lib/actions/pedido.vigencia-cardapio.test.ts src/lib/actions/revisarCarrinho.vigencia.test.ts src/lib/actions/paridade-preview-autoritativo.test.ts`.
6. **Rótulos** — `descreverVigencia.ts` + a chamada em `catalogoVitrine.ts`. Por último porque é a
   única parte que **não** decide nada: é a frase. Gate:
   `npx vitest run src/lib/utils/descreverVigencia.test.ts src/lib/utils/catalogoVitrine.test.ts`.
7. **Gate final** — `npx tsc --noEmit` · `npm run lint` · `npm test` · `npm run build`.

### Checklist de Validação Pós-Implementação

- [ ] `npx tsc --noEmit` = 0 erros
- [ ] `grep -rn cardapiosPorProduto src/` → vazio (RN-09)
- [ ] `npm run lint` = 0 erros; `npm run build` sem warnings novos
- [ ] `npm test` verde, com `paridade-preview-autoritativo.test.ts` verde
- [ ] `criarPedido` com payload forjado (Feijoada numa segunda) devolve `ERRO_FORA_DA_JANELA` e
      **não chama a RPC** — valor recalculado do banco, payload de vigência inexistente
- [ ] Vínculo `dias_semana = NULL` e `[]` vendem em qualquer dia (regressão zero no deploy da 272)
- [ ] `visibilidade = 'menu'` com vínculo agendado continua vendendo todo dia (RN-02)
- [ ] Nenhuma migration nova em `supabase/migrations/`; `src/lib/database.types.ts` sem diff
- [ ] Nenhum secret no client; nenhum dado pessoal em fixture; nenhuma chamada de rede nova
