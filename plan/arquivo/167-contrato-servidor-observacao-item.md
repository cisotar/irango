## Plano Técnico

> Escrito pelo agente `planejar` em 2026-09-07, após leitura do código real.
> Todos os `arquivo:linha` abaixo foram verificados na árvore atual.

### Análise do Codebase

**O que já existe e será reusado:**

- `src/lib/constants/termos.ts:8` — único arquivo de `src/lib/constants/`. É um módulo
  TS puro: **sem zod, sem `server-only`, sem `import` algum**. Hoje é consumido por
  Server Action (`src/lib/actions/auth.ts:25`), Server Components
  (`src/app/(publica)/termos/page.tsx:11`, `privacidade/page.tsx:15`), layout do painel
  (`src/app/(painel)/painel/layout.tsx:13`) e teste. **É exatamente o precedente que a
  issue supõe** — o novo `src/lib/constants/pedido.ts` segue o mesmo formato
  (comentário no topo declarando quem consome + um `export const`).
- `src/lib/validacoes/pedido.ts:12-35` — `schemaItemPedido`, `.strict()` na linha 35.
  Estender, não criar schema novo.
- `src/lib/validacoes/pedido.ts:86` — `observacoes: z.string().trim().max(500).optional()`.
  É o literal que sai de cena.
- `src/lib/validacoes/pedido.ts:65-70` — `codigo_cupom` já usa o padrão
  `.trim().toUpperCase().pipe(z.string().regex(...))`. **É o precedente exato** para
  encadear normalização + validação de tamanho num único campo; não invento estilo novo.
- `src/lib/validacoes/cupom.ts:21-22` e `src/lib/validacoes/loja.ts:35` — mesmo padrão
  `.transform(...).pipe(...)` já vivo no projeto.
- `src/lib/actions/pedido.ts:125-131` — declaração do tipo literal de `itensSnapshot`
  (`produto_id`/`nome`/`preco`/`quantidade`/`opcionais?`). Ganha `observacao?: string`.
- `src/lib/actions/pedido.ts:180-186` — o `itensSnapshot.push({...})` com o spread
  condicional `...(opcionaisSnapshot.length > 0 ? { opcionais: ... } : {})`. É o padrão
  a copiar para `observacao`.
- `src/lib/actions/pedido.ts:132-136` e `187-191` — `itensCalculo`, a estrutura que
  alimenta `calcularSubtotal`. **Fica intocada**: é a prova estrutural de que a
  observação não entra no cálculo (`seguranca.md` §10).
- `src/lib/actions/pedido.ts:322` — `p_observacoes: dados.observacoes ?? null`.
- `src/lib/validacoes/pedido.test.ts` (572 linhas) — builder `payload(over)` na linha 18,
  `UUID`/`UUID2` nas linhas 13-14, teste de `observacoes` na linha 41-49. Estender.
- `src/lib/actions/pedido.test.ts` (1388 linhas) — harness de mocks completo
  (linhas 1-90: `next/headers`, `rateLimit`, `service`, todas as queries, `rpc`).
  A asserção de contrato de `p_itens` está em `:396-397`. Estender, não recriar.
- `supabase/migrations/20260614009500_rpc_criar_pedido_idempotencia.sql:130-139` — o
  `insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade)`
  dentro do `for v_item in select * from jsonb_array_elements(p_itens)`. **Issue 166**,
  não desta.

**O que NÃO existe e precisa ser criado (com justificativa):**

- `src/lib/constants/pedido.ts` — não há nenhuma constante de pedido compartilhada hoje.
  `grep -rn "lib/constants" src/` devolve só `termos`. Ver §Decisão 1.
- `src/lib/utils/normalizarObservacao.ts` — `ls src/lib/utils/` (63 arquivos) foi lido
  inteiro: **não existe nenhum sanitizador/normalizador de texto livre**. O mais próximo
  é `urlHttpsSegura.ts`/`fotoSegura.ts` (validam URL, não normalizam texto) e
  `validarImagem.ts` (bytes). Não há lib madura em `package.json` para isso (`DOMPurify`
  não se aplica — o texto nunca é HTML; o JSX auto-escapa, `seguranca.md` §15). Uma
  função pura de ~6 linhas com teste próprio é o padrão do repositório
  (`calcularDesconto.ts`, `reconciliarBairroCep.ts`, `formatarMoeda.ts` — todos
  `util.ts` + `util.test.ts` ao lado). Ver §Decisão 2.

---

### Decisão 1 — onde vive `LIMITE_OBSERVACAO`

**`src/lib/constants/pedido.ts` está correto. Confirmado, não é chute.**

| Alternativa | Veredito |
|---|---|
| `src/lib/constants/pedido.ts` (proposta da issue) | **Escolhida.** Módulo TS puro, zero import, igual a `termos.ts`. Cliente (169) importa sem arrastar nada. |
| Exportar de `src/lib/validacoes/pedido.ts` | **Rejeitada.** `validacoes/pedido.ts:10` importa `zod`. O `ProdutoModal.tsx`/`EtapaPagamento.tsx` (169) são `'use client'`; importar a constante de lá arrastaria **63,8 KB gzip de zod** para o bundle da vitrine — que é exatamente o problema aberto da **issue 163** (`tasks/163-zod-no-bundle-publico-do-checkout.md`: "63,8 KB gzip de 151 KB — 42% do JS da rota — é o zod, importado pelo cliente via `src/lib/validacoes/pedido.ts:10`"). Piorar o achado enquanto a issue está aberta é regressão deliberada. |
| `src/lib/utils/` | **Rejeitada.** `utils/` no projeto abriga **funções**, não valores. `constants/` já existe para isso. |
| Literal `200` duplicado nos dois lugares | **Rejeitada.** A spec exige número em um único lugar; o critério de aceite tem `grep`. |

**Proibido** neste arquivo: `import "server-only"`, `import { z }`, qualquer import.
Um import futuro aqui reabre a 163 silenciosamente — deixar isso escrito no comentário
do topo, no mesmo tom de `termos.ts:1-7`.

---

### Decisão 2 — a transformação exata (e por que `.trim()` sozinho não basta)

**O problema real, medido:** o `trim` do Postgres é `btrim(text)`, que remove **só espaço
ASCII (U+0020)**. `\n`, `\r`, `\t` e NBSP (U+00A0) atravessam o `nullif(trim(...), '')`
da RPC (issue 166) **intactos e contando para o teto**. Consequência: um payload de 200
NBSPs chega ao banco como uma observação "vazia" de 200 caracteres, e o
`left(..., 200)` do SQL truncaria uma string que o TS deveria ter encurtado antes.
**O zod é a única camada que normaliza esses caracteres.** O SQL é defesa; o TS é a
autoridade.

**Verificado empiricamente contra o zod 4.4.3 instalado** (`package.json: "zod": "^4.4.3"`),
rodando um probe dentro do repo:

```
trim().max padded ->        true "abcdefghij"     # max mede DEPOIS do trim
trim().max 11 ->            false
trim borders nl/tab ->      "abc"                 # JS trim come \n \r \t (e NBSP)
pipe optional undefined ->  true
pipe norm ->                "ab\n\nc"             # transform roda ANTES do max
pipe 11 ->                  false
strict missing ->           true | unknown -> false
strict output when absent ->{}                    # sem chave observacao
all-whitespace ->           {"o":""}              # NÃO rejeita, vira ""
```

**Transformação escolhida** — `src/lib/utils/normalizarObservacao.ts`, função pura,
sem zod, sem `server-only` (assim a 169 pode reusá-la no contador se quiser):

```ts
export function normalizarObservacao(texto: string): string {
  return texto
    // 1. CRLF/CR → LF: uma só representação de quebra de linha (a comanda imprime LF).
    .replace(/\r\n?/g, "\n")
    // 2. Controles C0/C1 e DEL, PRESERVANDO \n (U+000A) e \t (U+0009).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    // 3. Invisíveis/bidi: zero-width, separadores de linha/parágrafo, overrides
    //    RTL (spoofing de comanda) e BOM.
    .replace(/[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    // 4. Tab → espaço (tab quebra alinhamento de comanda/recibo).
    .replace(/\t/g, " ")
    // 5. Colapsa espaço horizontal repetido (inclui NBSP) — anti-padding.
    .replace(/[^\S\n]{2,}/g, " ")
    // 6. No máximo uma linha em branco entre parágrafos.
    .replace(/\n{3,}/g, "\n\n")
    // 7. Bordas: JS trim() remove \n, \r, \t e NBSP (btrim do Postgres NÃO remove).
    .trim();
}
```

**Invariante que sustenta a segurança:** cada passo só **encurta ou mantém** o
comprimento — nunca expande. Logo `maxLength={200}` no cliente (169) nunca produz um
payload que o servidor rejeite por tamanho: a direção do erro é sempre segura.

**Declaração no schema** (`src/lib/validacoes/pedido.ts`, dentro de `schemaItemPedido`):

```ts
observacao: z
  .string()
  .transform(normalizarObservacao)
  .pipe(z.string().max(LIMITE_OBSERVACAO))
  .optional(),
```

- Normaliza **antes** de medir (comprovado no probe): 300 chars de controle + 150
  visíveis viram 150 e passam; 201 letras reais falham.
- `.trim()` do zod é dispensável — o passo 7 do util já faz, e o encadeamento
  `.transform().pipe()` é o padrão de `codigo_cupom` (`pedido.ts:65-70`).
- **Delta consciente em relação à letra da issue** (que escreve
  `z.string().trim().max(...)`): o `.trim()` puro deixaria passar NBSP/controles no meio
  do texto, contra a recomendação da spec §Segurança. O critério de aceite não muda —
  `grep -rn "200" src/lib/validacoes/pedido.ts` continua sem literal.

**🛑 PROIBIDO adicionar `.min(1)`.** Uma observação só de espaços normaliza para `""`; com
`.min(1)` o `safeParse` falharia e **o pedido inteiro seria recusado** por causa de um
campo cosmético. O `""` é aceito no schema e descartado na action (§Recálculo/Snapshot).

**🛑 PROIBIDO afrouxar o `.strict()`** (`pedido.ts:35`): nenhum `.passthrough()`, nenhum
`.catchall()`. Declarar `observacao` é o que permite o campo passar; qualquer outro campo
continua barrado.

**Paridade no campo do pedido** (`pedido.ts:86`) — mesma transformação, mesmo teto:

```ts
observacoes: z
  .string()
  .transform(normalizarObservacao)
  .pipe(z.string().max(LIMITE_OBSERVACAO))
  .optional(),
```

---

### Cenários

**Caminho feliz**
1. Cliente digita `"sem cebola\ntrocar batata por salada"` no modal; o payload chega em
   `criarPedido` com `itens[0].observacao`.
2. Rate limit passa (`pedido.ts:54-57`).
3. `schemaPayloadPedido.safeParse` (`:61`) normaliza e valida ≤ 200 — `.strict()` aceita
   o campo porque ele agora está declarado.
4. Loja/assinatura/horário/forma de pagamento/produtos/opcionais: **inalterados**.
5. `itensSnapshot.push` acrescenta `observacao` só quando não-vazia; `itensCalculo` **não
   a recebe**.
6. `calcularSubtotal`/`calcularFrete`/`calcularDesconto`/`calcularTotal` produzem
   exatamente os mesmos números que produziriam sem o campo.
7. `p_itens` chega à RPC com a observação já normalizada; o
   `left(nullif(trim(...)), 200)` do SQL (166) é no-op.

**Casos de borda**

| Entrada | Comportamento esperado |
|---|---|
| Campo ausente | `safeParse` ok; a chave **não existe** no output (probe: `strict output when absent -> {}`); nada vai para `p_itens`. |
| `""` ou `"   "` ou `"\n\t "` | `safeParse` **ok** (não rejeita); normaliza para `""`; a action omite a chave → RPC grava `NULL`. |
| Exatamente 200 chars visíveis | aceito. |
| 201 chars visíveis | **rejeitado** → `criarPedido` devolve `ERRO_GENERICO`. |
| 210 chars com 15 de padding nas bordas | aceito (normaliza para ≤200). |
| 500 chars de controle + 100 visíveis | aceito com 100 (prova a ordem transform→max). |
| `\n` no meio | **preservado** (é textarea, sem `.regex` de linha única). |
| `\r\n` no meio | vira `\n` (encurta 1 char por quebra). |
| 50 `\n` seguidos | colapsa para 2. |
| 200 NBSPs | colapsa para `""` → campo omitido. |
| Bidi override / zero-width | removidos. |
| `observacao: 123` / `null` / `{}` | rejeitado (`z.string()`). |
| Campo desconhecido no item (`preco`, `total`) | **continua rejeitado** pelo `.strict()`. |
| Campo desconhecido na raiz | continua rejeitado (`pedido.ts:91`). |
| `observacoes` (pedido) com 201 | rejeitado — hoje passa até 500. |
| `observacoes` (pedido) só com espaços | vira `""` → recomendado gravar `NULL` (ver abaixo). |
| 50 itens × 200 chars | ~10 KB, dentro do `.max(50)` de `itens` (`pedido.ts:57`) e do `bodySizeLimit` de 2 MB. Sem mudança de teto. |
| Falha de rede/RPC | inalterado: `console.error` + `ERRO_GENERICO` (`pedido.ts:337-341`). |
| Loja fechada/inativa, produto oculto, cupom expirado | inalterados — a observação não participa de nenhum desses gates. |

**Tratamento de erros** (`seguranca.md` §14): o `safeParse` que falha por tamanho cai no
`return { erro: ERRO_GENERICO }` de `pedido.ts:62-64` — **mensagem genérica, sem detalhe
do zod**, sem log adicional (payload do cliente não vai para o log). Nenhuma mensagem
nova é introduzida nesta issue.

---

### Schema de Banco

**Nenhuma mudança.** A coluna `itens_pedido.observacao` e o `CREATE OR REPLACE` da RPC
são da **issue 166** (dependência declarada). Esta issue não escreve SQL, não cria
tabela, **não cria nem altera policy RLS**.

**RLS (herdada, verificada, sem alteração):**
- `itens_pedido` — leitura: `itens_pedido_lojista` (SELECT só do dono da loja).
- `itens_pedido` — escrita: deny-all para `anon`/`authenticated`; **INSERT é exclusivo da
  RPC sob `service_role`** (`seguranca.md` §`itens_pedido`, achado #3A). A observação
  entra pelo `p_itens` já existente e **não abre nenhuma via de escrita nova**.
- `pedidos.observacoes` — coluna `text` **sem CHECK** (`20260614000129_schema_inicial.sql`).
  Baixar 500 → 200 **não exige migration**: pedidos antigos maiores continuam válidos e
  legíveis; o teto novo vale só para pedidos novos.

**⚠️ Runtime:** enquanto a migration da 166 não estiver com `Remote` preenchido em
`npx supabase migration list`, a RPC no cloud ignora `observacao` dentro de `p_itens` —
o pedido é criado normalmente e a observação simplesmente não persiste (o `p_itens` é
`jsonb`, então **não** dá `PGRST204`). Testes e build ficam verdes de qualquer forma; a
verificação ponta a ponta é o passo 3 do `plan/loop-observacoes-por-item-pedido.md`.

---

### Validação (zod)

Schema único em `src/lib/validacoes/pedido.ts`, reusado no form (preview de UX, via
`useEnviarPedido.ts`) e na Server Action (autoridade). Não existe segundo schema.

| Regra | Camada que garante |
|---|---|
| Tamanho ≤ 200 do `itens[].observacao` | **Server Action** — `schemaItemPedido` (`pedido.ts:61`, antes de qualquer I/O). Cliente `maxLength` (169) é preview; CHECK + `left(...,200)` da RPC (166) são defesa em profundidade. |
| Tamanho ≤ 200 de `observacoes` (pedido) | **Server Action** — `schemaPayloadPedido`. Sem CHECK no banco (nunca teve). |
| Normalização (controles, bidi, CRLF, padding) | **Server Action, exclusivamente.** O `btrim` do Postgres remove só U+0020 — o SQL não consegue fazer esse trabalho. |
| Campo opcional | zod `.optional()` + coluna nullable (166). |
| Vazio/whitespace → `NULL` | Server Action (omite a chave) + `nullif(trim(...),'')` da RPC (166). |
| Nenhum campo extra no item | **`.strict()`** de `schemaItemPedido` (`pedido.ts:35`) — trava anti-injeção monetária, intacta. |
| Observação não altera preço | **Estrutural**: `itensCalculo` (`pedido.ts:132-136`) não tem o campo; o recálculo é cego a ele. Coberto por teste. |
| Leitura da observação pelo lojista | **RLS** `itens_pedido_lojista` (issue 171). |
| Escrita em `itens_pedido` | **RLS deny-all** + RPC `service_role` (166). |

---

### Recálculo no Servidor (`seguranca.md` §10)

**O cliente envia:** `produto_id`, `quantidade`, `opcionais[].opcional_id`,
`opcionais[].quantidade`, `endereco_entrega`, `forma_pagamento`, `codigo_cupom`,
`tipo_entrega`, `troco_para`, `idempotency_key`, identificação **e, agora, `observacao`
por item** (texto puro).

**O servidor recalcula do zero, a partir do banco:** `preco` de cada produto
(`buscarProdutosPorIds`), `preco_snapshot` de cada opcional (`buscarOpcionaisPorIds`),
`subtotal` (`calcularSubtotal`), `taxa_entrega` (`calcularFrete` sobre zonas do banco +
bairro reconciliado via ViaCEP), `desconto` (`buscarCupomPorCodigo` + `validarUsoCupom` +
`calcularDesconto`), `total` (`calcularTotal`).

**`observacao` é texto e NADA MAIS.** Não entra em `itensCalculo`, não entra em nenhuma
das funções acima, não é lida por nenhum ramo condicional de valor. A mudança em
`itensSnapshot` (`pedido.ts:180-186`) é puramente de persistência.

**Snapshot — código exato a acrescentar:**

```ts
// tipo (pedido.ts:125-131) — acrescentar após `quantidade`:
observacao?: string;

// push (pedido.ts:180-186) — spread condicional, mesmo padrão de `opcionais`:
...(item.observacao ? { observacao: item.observacao } : {}),
```

Sem `.trim()` aqui: o zod já normalizou, e re-normalizar criaria um segundo ponto de
verdade. O spread condicional (em vez de `observacao: item.observacao`) mantém intacta a
asserção de contrato de `pedido.test.ts:396-397`
(`expect(args.p_itens).toEqual([{ produto_id, nome, preco, quantidade }])`) e evita
mandar chave `undefined` no `jsonb`.

**Ajuste recomendado, mesmo campo, 1 linha** — `pedido.ts:322`:
`p_observacoes: dados.observacoes ?? null` → `p_observacoes: dados.observacoes || null`.
Hoje uma observação de pedido só com espaços já grava `""` em vez de `NULL` (o `.trim()`
do zod produz `""`, que sobrevive ao `??`). É pré-existente, alinha o campo do pedido com
a regra "vazio → `NULL`" da spec e é seguro (`""` é o único valor falsy possível para um
`string | undefined`).

---

### Arquivos a Criar / Modificar / NÃO tocar

**Criar**

| Arquivo | Motivo |
|---|---|
| `src/lib/constants/pedido.ts` | `export const LIMITE_OBSERVACAO = 200;` — fonte única. Sem zod, sem `server-only`, **sem nenhum import**. Comentário no topo listando os consumidores (zod desta issue, `maxLength`/contador da 169) e a proibição de importar, no formato de `termos.ts:1-7`. |
| `src/lib/utils/normalizarObservacao.ts` | Função pura de normalização (§Decisão 2). Nada equivalente em `src/lib/utils/` (63 arquivos verificados) nem em lib de `package.json`. |
| `src/lib/utils/normalizarObservacao.test.ts` | Teste unitário ao lado do módulo — padrão do repo. |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `src/lib/validacoes/pedido.ts` | `import { LIMITE_OBSERVACAO }` + `import { normalizarObservacao }`; campo `observacao` em `schemaItemPedido` (após `quantidade`, antes de `opcionais`, ~l.19); `observacoes` da raiz (`:86`) passa a usar a mesma transformação e `LIMITE_OBSERVACAO`. |
| `src/lib/actions/pedido.ts` | `observacao?: string` no tipo de `itensSnapshot` (`:125-131`); spread condicional no `push` (`:180-186`); `?? null` → `\|\| null` em `p_observacoes` (`:322`). |
| `src/lib/validacoes/pedido.test.ts` | Estender com os cenários RED abaixo. |
| `src/lib/actions/pedido.test.ts` | Estender com os cenários de orquestração RED abaixo. |

**NÃO tocar**

| Arquivo | Por quê |
|---|---|
| `src/components/ui/**` | gerado pelo shadcn CLI. |
| `src/components/vitrine/ProdutoModal.tsx`, `checkout/EtapaPagamento.tsx` | issue **169** (UI, `maxLength`, contador). |
| `src/components/vitrine/checkout/estado.ts`, `src/types/dominio.ts`, `src/hooks/useCarrinho.ts` | issue **168** (`ItemPayload`/`ItemCarrinho`/chave de dedup). O schema recebe `unknown`, então a 167 é verde e testável sem eles. |
| `supabase/migrations/**`, `supabase/seed.sql` | issue **166** + `popular`. |
| `src/lib/database.types.ts` | regenerado só depois do `db push` (marco humano #1 do loop). |
| `src/lib/utils/whatsappPedido.ts` | issue **170**. |
| `src/components/painel/DetalhePedido.tsx`, `ComandaCozinha.tsx`, `ReciboCliente.tsx` | issue **171**. |
| `src/lib/validacoes/pedido.itens-cap.test.ts` | teto de cardinalidade (pentest 2026-07-09), assunto ortogonal. |
| `src/lib/actions/pedido.ts` §(4)-(7) — recálculo de valor | **explicitamente fora**: a observação não entra em cálculo. |

---

### Dependências Externas

**Nenhuma.** Nenhum pacote npm novo, nenhuma API externa, nenhuma chamada de rede nova.

**Custo e quota (`architecture.md` §9 nº1):** R$ 0,00 e quota inalterada.
- Nenhuma chamada nova a Upstash (o `verificarRateLimit` de `criarPedido` já roda e
  continua com o mesmo número de chamadas por pedido), a Nominatim (1 req/s — o
  `distanciaDaLojaAoCep` não é tocado), ao ViaCEP ou ao Sentry (nenhum evento novo:
  payload inválido cai em `return`, não em `throw`).
- Vercel Hobby: o `zod.transform` é ~6 `String.replace` sobre ≤200 chars por item, teto
  de 50 itens — custo de CPU desprezível, sem efeito em tempo de função.
- Payload: teto de +10 KB por pedido no pior caso (50 × 200 chars), contra os 2 MB de
  `bodySizeLimit`. Storage: `text` nullable, sem índice.
- **O que acontece se estourar:** não há quota a estourar. O único fail-closed relevante
  é o do próprio schema: acima de 200 chars normalizados, o pedido é **recusado inteiro**
  com mensagem genérica — nunca truncado silenciosamente no TS.

---

### Ordem de Implementação

**Issue crítica → a fase RED do agente `tdd` vem antes de qualquer código de produção.**

**0. RED (`tdd`) — escrever, rodar, capturar o `FAIL`, e PARAR.**

`src/lib/validacoes/pedido.test.ts` (reusar o builder `payload(over)` de `:18`):
1. item com `observacao` de 200 chars visíveis → `success === true`
   *(hoje FALHA: o `.strict()` rejeita o campo não declarado)*
2. item com 201 chars visíveis → `success === false`
3. `observacao` com `\n` no meio → aceita **e** o output preserva o `\n`
4. item **sem** o campo → aceita e `data.itens[0]` **não tem** a chave `observacao`
5. campo desconhecido no item (`{ preco: 0.01 }`, `{ total: 0 }`) → **continua**
   `success === false` *(anti-regressão do `.strict()`)*
6. `observacao: "   "` / `""` / `"\n\t "` → `success === true`, output `""`
   *(prova que não há `.min(1)` derrubando o pedido)*
7. 210 chars com padding nas bordas → aceito, output com 200
8. 500 chars de controle (`\u0000`, `\u001B`) + 100 visíveis → aceito com 100
   *(prova a ordem transform → max)*
9. `\r\n` → `\n`; 50 `\n` seguidos → 2; 200 NBSPs → `""`
10. bidi override / zero-width removidos do output
11. `observacao: 123` e `observacao: null` → `success === false`
12. `observacoes` (raiz) com 200 → aceito; com 201 → rejeitado; com 500 → **rejeitado**
    *(hoje passa — é RED)*

`src/lib/utils/normalizarObservacao.test.ts`: tabela de entrada→saída dos 7 passos, mais
a invariante `saida.length <= entrada.length` sobre um conjunto de fixtures.

`src/lib/actions/pedido.test.ts` (reusar o harness de mocks de `:1-90`):
13. pedido com `observacao` → `fakeClient.rpc.mock.calls[0][1].p_itens[0].observacao`
    é a string **normalizada**
14. pedido **sem** observação → `p_itens[0]` **não tem** a chave `observacao`
    *(anti-regressão de `:396-397`)*
15. **o mesmo carrinho, com e sem observação, produz `p_subtotal`, `p_taxa_entrega`,
    `p_desconto` e `p_total` idênticos** — o teste de `seguranca.md` §10 desta issue
16. `observacao` de 201 chars → `criarPedido` devolve `{ erro: ERRO_GENERICO }` e
    **`fakeClient.rpc` nunca é chamado** (falha antes de qualquer I/O)
17. `observacoes: "   "` no pedido → `p_observacoes === null`

Gate da fase: `npx vitest run src/lib/validacoes/pedido.test.ts src/lib/actions/pedido.test.ts`
com `FAIL` capturado no relato.

**1. `src/lib/constants/pedido.ts`** — sem dependência; tudo abaixo importa daqui.
**2. `src/lib/utils/normalizarObservacao.ts`** — pura, independente; roda o teste dela
sozinho antes de plugar no schema.
**3. `src/lib/validacoes/pedido.ts`** — depende de 1 e 2. É o gate autoritativo; verde
aqui já fecha o critério de segurança da issue.
**4. `src/lib/actions/pedido.ts`** — depende de 3 (o campo precisa sobreviver ao
`safeParse` para existir em `dados.itens[i]`; sem o passo 3 o TypeScript nem compila o
acesso a `item.observacao`).

**Gates finais, nesta ordem:**
```
npx vitest run src/lib/utils/normalizarObservacao.test.ts \
               src/lib/validacoes/pedido.test.ts \
               src/lib/actions/pedido.test.ts
npm run build     # const exportada em 'use server' só quebra aqui
npm test
grep -rn "\.max(500)" src/lib/validacoes/pedido.ts          # sem resultado
grep -rn "200" src/lib/validacoes/pedido.ts                 # só o import, sem literal
grep -rn "^import" src/lib/constants/pedido.ts              # sem resultado (nem zod, nem server-only)
```

### Riscos

1. **Regressão de checkout inteiro** — se `observacao` for declarada errada (ex.: com
   `.min(1)`), uma observação só de espaços derruba o pedido completo, não só o campo.
   Coberto pelo teste RED 6.
2. **Afrouxar o `.strict()`** — um `.passthrough()` acidental reabre a injeção de valor
   monetário. Coberto pelo teste RED 5 (anti-regressão).
3. **Reabrir a issue 163** — qualquer `import` em `src/lib/constants/pedido.ts` arrasta
   dependência para o bundle público quando a 169 importar a constante. Coberto pelo
   `grep` final.
4. **Divergência TS ↔ SQL** — se o `left(..., 200)` da 166 truncar de fato, é sinal de que
   a normalização do TS não rodou. Nunca deve acontecer: é defesa, não caminho.
5. **Persistência silenciosa a zero** — antes do `db push` da 166, a observação some sem
   erro. Não é falha desta issue; é o passo 3 do loop.
