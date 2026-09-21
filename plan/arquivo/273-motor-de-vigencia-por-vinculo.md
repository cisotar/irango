## Plano Técnico — 273 (motor de vigência por vínculo)

> Plano da issue `tasks/273-motor-de-vigencia-por-vinculo.md`.
> Branch: `feat/vigencia-por-item-do-cardapio`, sobre `9b737de` (270 e 272 entregues).
> Loop: `plan/loop-vigencia-por-item-do-cardapio.md` §5 passo 6 (issue B, `arquitetar` em vez de
> `planejar` — multi-camada, contrato de dados, ~30 arquivos).
> A seção `## Plano Técnico` da issue tem o **o quê e em que ordem**. Este arquivo guarda o que o
> código não conta: alternativas rejeitadas, seams com 279/280, riscos aceitos e o contrato do RED.

---

### 1. Causa raiz, em uma frase

`avaliarVigenciaDoProduto` recebe `CardapioVigencia[]`, e o `Map` que a query devolve descarta a
linha de `cardapio_produtos` assim que lê `produto_id` dela (`queries/cardapios.ts:79-84`). Não
falta validação — **falta um tipo**: não existe lugar onde uma restrição *do vínculo* possa ser
expressa. Qualquer solução que não troque o eixo do motor de "cardápio" para "vínculo" acaba
pendurando um segundo predicado de dia em cada consumidor (vitrine, revisão, pedido, painel,
admin) — cinco casas para uma regra que a spec exige que tenha uma.

### 2. Alternativas rejeitadas

**(a) Segundo `Map<produtoId, Map<cardapioId, number[]>>` ao lado do que já existe.**
Zero renames, `tsc` verde o tempo todo. Rejeitada: cria dois índices que podem discordar (um
vínculo no primeiro e não no segundo) e obriga cada um dos 5 consumidores a fazer o `join` na mão.
É literalmente o "componente novo cuja única função é mediar uma divergência que não deveria
existir".

**(b) Manter o nome `cardapiosPorProduto` apontando para vínculos.**
Rejeitada pela própria spec (RN-09): o `tsc` pega o erro de tipo, mas o **nome** é o que impede o
próximo leitor de escrever `.get(id)[0].ativo`. O rename é a parte barata; o `grep` vazio é o gate.

**(c) Colocar o filtro de dia em SQL (`where dias_semana @> …`).**
Rejeitada por RN-06 da spec-mãe e §Fora do Escopo: janela nunca vira SQL. Além de criar a segunda
casa da regra, quebraria o reuso sob `service_role` e a memoização de `proximaAbertura`.

**(d) `voltaAAbrir` passar a ler `dias_semana` do item para resolver a interseção vazia.**
Rejeitada por RN-03 e §Fora do Escopo da spec. Ver Risco R1.

### 3. Riscos e mitigação

**R1 — `voltaAAbrir` com interseção vazia (RN-03 / §Fora do Escopo).**
Cardápio {sáb, dom} + item {qua}: `voltaAAbrir` responde `true`, o produto exclusivo fica
**permanentemente marcado** na vitrine com um selo que promete uma volta que nunca chega.
*Mitigação nesta issue:* nenhuma — é decisão registrada da spec, e encodá-la aqui obrigaria o
predicado a ler a regra de dia (2ª casa de RN-02 da spec-mãe). O aviso do painel é a issue 276.
*Se virar dor real:* a saída limpa **não** é mudar `voltaAAbrir`, e sim generalizar a varredura de
`proximaAbertura` para receber o predicado (`cardapioAberto` **ou** `itemAberto`) — o mesmo laço,
parametrizado, sem segunda tabela de dias. Vale uma issue própria, **depois** do loop; não abrir
agora para não reescopar a 273.

**R2 — `escolherVinculoParaRotulo` com dois vínculos, um aberto e um fechado.**
A escada continua sendo `proximaAbertura` **do cardápio**. Cardápio A aberto hoje (item só qua) e
cardápio B fechado que abre amanhã: `proximaAbertura(A) = agora` < `proximaAbertura(B)` ⇒ ganha A,
e o selo diz "Só às quartas" mesmo havendo uma volta *mais cedo* por B. Frase verdadeira, não
ótima. *Mitigação:* aceitar em v1 — a alternativa é o mesmo `proximaAberturaDoItem` de R1, e
manter a escada idêntica à ordem das seções de destaque é a invariante que evita "a frase mudou
sozinha". Registrar em comentário no `catalogoVitrine.ts`, não em issue.

**R3 — Seam com a 279: seção de destaque temporariamente incoerente.**
Entre 273 e 279, `projetarCatalogoVitrine` já marca o item fora do dia como `fora_da_janela`, mas
`agruparPorCardapio` (regra inalterada) continua empurrando esse produto para a seção do cardápio —
um card desabilitado dentro do destaque, o que a spec diz nunca acontecer ("nenhum produto de
seção de destaque está fora da janela"). *Mitigação:* (i) nenhuma linha de dado real tem
`dias_semana` até a 274 entrar (a coluna nasceu `NULL` e não há tela de escrita), então o estado é
**inobservável** em produção; (ii) a branch não vai ao ar antes do loop fechar; (iii) 279 é a
issue seguinte na ordem do loop. **Não** antecipar o filtro aqui: ele tem teste próprio e a 273 já
é a fatia máxima que cabe num vermelho só.

**R4 — Seam com a 280: `contarProdutosEscondidos` e `diagnosticarSumico` consomem o tipo novo sem
mudar a regra.** Os dois passam a receber `VinculoVigencia[]`, mas o predicado (`visivelNaVitrine`,
que depende de `voltaAAbrir`) é insensível a `dias_semana` — logo a contagem é **byte a byte** a de
hoje. *Mitigação:* isso é o critério de revisão da 273 — se algum número do painel mudar, o
`executar` extrapolou o escopo. A mudança de comportamento é 280.

**R5 — `paridade-preview-autoritativo.test.ts` como gate.** Ele mocka
`buscarCardapiosComProdutos` devolvendo `{ cardapios: [], cardapiosPorProduto: new Map() }`
(`:65-68`). O rename **quebra o mock** — e é bom que quebre: se ele continuasse verde com a chave
antiga, `pedido.ts` e `revisarCarrinho.ts` estariam lendo `undefined` e caindo no `?? []`, isto é,
vendendo tudo sempre. *Mitigação:* o `executar` corrige o mock para `vinculosPorProduto`, e o
`revisar` confere que a correção foi do **nome da chave**, não do `?? []`.

**R6 — `dias_semana` do embed como `number[] | null`.** O PostgREST devolve `smallint[]` como
`number[]`; linha antiga pode trazer `[]`. `itemAberto` trata `null` e `[]` idênticos
(`(v.dias_semana ?? []).length === 0`), e `ordenarSemana` já filtra inteiro fora de 0..6.
Nenhum saneamento novo na query (o CHECK da 272 é o backstop).

**R7 — Mudança de redação por D4 (preposição).** Cardápio recorrente com primeiro dia feminino
passa de "Só aos terças e quintas" para "Só às terças e quintas". É correção de concordância, não
regressão; o único teste que afirma a frase (`descreverVigencia.test.ts:144`) usa {sáb, dom} e
continua verde. Se o `testar` achar outra asserção, ela deve ser **atualizada**, não contornada.

### 4. Contrato de teste para o `tdd` (fase RED)

Vermelho principal, em `src/lib/actions/pedido.vigencia-cardapio.test.ts` (arquivo **existente**,
novo `describe`). O harness já está pronto: `cardapiosDoBanco(vinculos)` em `:189-196` monta o
`Map` — passa a montar `VinculoVigencia`.

```
Fuso da loja: "America/Sao_Paulo" (já no `bancoBase()`)
SEGUNDA  = new Date("2026-12-21T15:00:00.000Z")  // seg 21/12/2026, 12:00 -03
QUARTA   = new Date("2026-12-23T15:00:00.000Z")  // qua 23/12/2026, 12:00 -03
SEMPRE   = { modo:"recorrente", ativo:true, dias_semana:[0,1,2,3,4,5,6],
             dias_mes:null, hora_inicio:null, hora_fim:null,
             prazo_inicio:null, prazo_fim:null, ordem:0 }
FEIJOADA = { cardapio: SEMPRE, dias_semana: [3, 6] }   // qua e sáb
```

| # | Asserção | Camada |
|---|---|---|
| 1 | `criarPedido` na SEGUNDA com FEIJOADA ⇒ `erro === ERRO_FORA_DA_JANELA` **e** `fakeClient.rpc` NÃO chamada | **autoritativa — o vermelho do loop** |
| 2 | o mesmo payload na QUARTA ⇒ RPC chamada (a regra não fecha o que devia abrir) | autoritativa |
| 3 | `dias_semana: null` e `dias_semana: []` na SEGUNDA ⇒ RPC chamada | autoritativa (regressão do deploy da 272) |
| 4 | produto `visibilidade:"menu"` com FEIJOADA na SEGUNDA ⇒ RPC chamada (RN-02 curto-circuita) | autoritativa |
| 5 | carrinho com 1 item bom + FEIJOADA na SEGUNDA ⇒ cai **inteiro**, RPC não chamada | autoritativa |

Complementares, no mesmo RED:

- `src/lib/actions/revisarCarrinho.vigencia.test.ts` — FEIJOADA na SEGUNDA vira linha
  `compravel:false`, `motivoNaoCompravel:"fora_da_janela"`, **fora** do subtotal e da economia.
- `src/lib/utils/vigenciaCardapio.test.ts` — a tabela de RN-01: (7 dias + {qua}) na qua = `true`,
  na seg = `false`; ({sáb,dom} + {qua}) = `false` sempre; ({sáb,dom} + `dias_mes:[15]` + {qua}) na
  quarta **dia 15** = `true` e no dia 16 = `false`; e `avaliarVigenciaDoProduto` de exclusivo
  recorrente com {qua} numa segunda ⇒ `{ dentroDaJanela:false, visivelNaVitrine:true }` (RN-03).
- `src/lib/utils/descreverVigencia.test.ts` —
  `rotuloVoltaQuando({cardapio:SEMPRE, dias_semana:[3,6]}, SEGUNDA, tz)` === **"Só às quartas e
  sábados"**; precedência RN-08: cardápio {sáb,dom} + item {qua} na SEGUNDA ⇒ **"Só aos sábados e
  domingos"** (a frase do **cardápio**, porque ele é quem está fechado);
  `descreverVigencia(7 dias)` === **"Aparece todos os dias."**; selo curto de 7 dias com faixa
  11:00–15:00 === **"Todos os dias, 11:00–15:00"**; e o teto de 32 caracteres afirmado com um item
  de 5 dias não-consecutivos (a asserção é sobre `.length <= 32` **e** o `…` final).

**O que o RED NÃO deve afirmar** (é 279/280, e afirmar aqui trava o `executar` fora do escopo):
que a seção de destaque some, que ela lista só o item do dia, ou que `contarProdutosEscondidos`
mudou de número.

### 5. Gate mecânico por bloco

| Bloco | Comando |
|---|---|
| motor | `npx vitest run src/lib/utils/vigenciaCardapio.test.ts` |
| query | `npx vitest run src/lib/supabase/queries/cardapios.test.ts` |
| rename | `npx tsc --noEmit` = 0 **e** `grep -rn cardapiosPorProduto src/` vazio |
| autoritativo | `npx vitest run src/lib/actions/pedido.vigencia-cardapio.test.ts src/lib/actions/revisarCarrinho.vigencia.test.ts src/lib/actions/paridade-preview-autoritativo.test.ts` |
| rótulos | `npx vitest run src/lib/utils/descreverVigencia.test.ts src/lib/utils/catalogoVitrine.test.ts` |
| final | `npx tsc --noEmit` · `npm run lint` · `npm test` · `npm run build` |

### 6. O que esta issue deixa para o `escriba` (no fim do loop, não agora)

- `references/architecture.md` §8: o contrato `VinculoVigencia` e o índice `vinculosPorProduto`
  como forma canônica de "produto↔cardápio reduzido ao que decide vigência".
- `references/seguranca.md` §10: acrescentar à lista do recálculo autoritativo que o **dia da
  semana do item** também é lido do banco e nunca do payload.
