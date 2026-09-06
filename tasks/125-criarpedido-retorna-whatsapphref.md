# [125] `criarPedido` devolve `whatsappHref` autoritativo (decisão no servidor)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [121]
**Spec:** specs/5-whatsapp-envio-automatico-toggle.md

## Objetivo
Estender o retorno de `criarPedido` para incluir `whatsappHref: string | null`, montado
server-side a partir do pedido autoritativo recém-gravado — a DECISÃO de emitir o link é
do servidor (RN-A2), nunca do cliente.

## Escopo
- [x] `criarPedido` (`src/lib/actions/pedido.ts`): no caminho de sucesso (após a RPC gravar
  e devolver `pedido_id`/`token_acesso`), montar `whatsappHref` com `montarLinkWhatsappPedido`
  a partir do `PedidoComItens` autoritativo + `loja` (`buscarLojaParaPedido` já traz a coluna
  após 121 — sem mudança de query, ver spec §Modelos).
- [x] Emitir `whatsappHref != null` SÓ quando `loja.whatsapp_envio_automatico === true` E a
  loja tem WhatsApp (`montarLinkWhatsappPedido` já retorna `null` sem WhatsApp — RN-A2/RN-W3).
- [x] Estender o tipo de retorno de sucesso para `{ pedidoId, token_acesso, whatsappHref }`.
- [x] `next build` antes de fechar (retorno de Server Action).

## Fora de escopo
- Mecânica client de abrir a aba (issue 126).
- Qualquer mudança no conteúdo da mensagem (herda spec 3, RN-A6).

## Reuso esperado
- `montarLinkWhatsappPedido` (`src/lib/utils/whatsappPedido.ts`) — reuso, NÃO recriar montagem.
- `buscarLojaParaPedido` — reuso; sem query nova.

## Segurança
- Token de pedido: `whatsappHref` NUNCA contém `token_acesso` (RN-A6). A mensagem só formata
  o snapshot autoritativo já gravado — nenhum valor vem do carrinho do cliente.
- Decisão de emitir é do servidor (RN-A2): flag desligada ou sem WhatsApp → `whatsappHref: null`.
- Sem recálculo monetário novo (o total já é autoritativo da RPC).

## Critério de aceite
- [x] (RED-first) Teste: flag `true` + loja com WhatsApp → retorno tem `whatsappHref` string
  `https://api.whatsapp.com/send?...` com o resumo do pedido gravado.
- [x] (RED-first) Teste: flag `false` → `whatsappHref === null`.
- [x] (RED-first) Teste: loja sem WhatsApp (flag `true`) → `whatsappHref === null`.
- [x] (RED-first) Teste: `whatsappHref` NÃO contém o `token_acesso` do pedido.
- [x] Vermelho escrito e confirmado ANTES do código; depois verde.
- [x] `next build` passa.

---

## Plano Técnico

### Diagnóstico

**Causa raiz.** Hoje existem **duas verdades possíveis** para "o que a mensagem de
WhatsApp diz sobre o pedido": o snapshot que a action *acabou de calcular em memória*
(`itensSnapshot`, `subtotal`, `desconto`, `total`) e a **linha realmente gravada** em
`pedidos`/`itens_pedido`/`itens_pedido_opcionais`. Elas **não são equivalentes** — a RPC
`public.criar_pedido` pode divergir do que a action lhe passou em dois pontos legítimos:

1. **Trava de cupom perdida na corrida** (`20260614009500`, passo 2): se o `UPDATE cupons
   ... usos_contagem < usos_maximos` não afeta linha, a RPC zera `v_desconto`, anula
   `v_cupom_codigo` e **recomputa** `v_total := p_subtotal + p_taxa_entrega`. O total
   gravado é MAIOR que o total calculado em memória pela action.
2. **Replay idempotente** (passo 0 e passo 3b): com `p_idempotency_key` já usada, a RPC
   devolve o pedido **pré-existente** e ignora inteiramente os valores recalculados
   nesta chamada. O pedido gravado pode ser de outro carrinho/outro instante.

Montar o link a partir da memória cria um terceiro artefato de verdade — uma mensagem que
diz um total que o painel não confirma. A causa raiz do risco desta issue não é "falta um
campo no retorno": é **de onde vem o `PedidoComItens`**. A única fonte autoritativa é a
linha gravada, relida por `buscarPedidoPorToken`, que é exatamente a mesma leitura que a
página de confirmação já usa para renderizar o botão manual (spec 3).

**Por que é complexo (justifica `arquitetar`, não `planejar`).**
- Muda o **contrato de retorno de uma Server Action pública** consumida por client
  component (`useEnviarPedido`) — sob a restrição do Next de que arquivo `'use server'`
  só exporta funções async.
- Introduz **I/O adicional no caminho crítico** da action mais sensível do produto
  (§10), com risco de derrubar um pedido **já persistido** se o erro não for contido.
- Interage com **idempotência** (RPC passo 0/3b) e com a **trava de cupom** (passo 2) —
  ambas fontes de divergência silenciosa de valor.
- Toca a superfície de **token de pedido** (`token_acesso` = senha do pedido, invariante
  037/RN-A6): o objeto autoritativo relido **contém** o token; a mensagem não pode.

**Correção factual ao enunciado da issue.** A RPC chamada por `criarPedido` se chama
`criar_pedido` (16 args, `p_idempotency_key uuid default null`), **não**
`criar_pedido_idempotente`. Nome canônico:
`supabase/migrations/20260614009500_rpc_criar_pedido_idempotencia.sql`.

### Mapa de Impacto

```
useEnviarPedido.ts (client, checkout)
  └─ chama → criarPedido(payload)                      [src/lib/actions/pedido.ts]
       ├─ lê → buscarLojaParaPedido(svc, loja_id)      [queries/lojas.ts:97 — .select("*")]
       │        └─ tabela `lojas` (service_role, BYPASSRLS)
       │             └─ traz `whatsapp` + `whatsapp_envio_automatico`  ✅ CONFIRMADO
       ├─ RPC → criar_pedido(...16 args)               [migration 20260614009500]
       │        └─ returns table (pedido_id uuid, token_acesso uuid)   ← SÓ ISSO
       ├─ [NOVO] lê → buscarPedidoPorToken(svc, pedidoId, token)  [queries/pedidos.ts:50]
       │        └─ `pedidos` + itens_pedido + itens_pedido_opcionais → PedidoComItens
       └─ [NOVO] montarLinkWhatsappPedido(pedido, loja) [utils/whatsappPedido.ts:50]
                └─ retorna { href } | null → whatsappHref

whatsappHref → retorno da Server Action → useEnviarPedido (126, fora de escopo aqui)

Mesma dupla de primitivos já usada por:
  confirmacao/page.tsx:139-140  →  buscarLojaParaPedido + montarLinkWhatsappPedido
  (o botão manual do spec 3 — comportamento NÃO alterado por esta issue)
```

**Onde cada invariante é garantida (cliente ↔ servidor):**

```
Decisão de emitir o link (RN-A2)
  └── criarPedido / pedido.ts — [SERVER ACTION — AUTORITATIVO]
      (o cliente não envia nada que influencie isso; a flag vem de `lojas` por service_role)
  └── checkout page.tsx expõe a flag ao client — [issue 126, preview de UX, contornável]

Conteúdo/valores da mensagem (RN-A6)
  └── linha gravada em `pedidos` relida por buscarPedidoPorToken — [FONTE ÚNICA DE VERDADE]
  └── montarLinkWhatsappPedido — [função pura, sem I/O, sem decisão]

token_acesso fora do href (RN-A6 / invariante 037)
  └── montarLinkWhatsappPedido nunca lê `pedido.token_acesso` — [garantido por construção]
  └── teste de regressão explícito (ver Cenários T4) — [trava a invariante]

Leitura do pedido recém-criado
  └── service_role + `WHERE id = $1 AND token_acesso = $2` — [não há SELECT anon em `pedidos`]
```

**Confirmação pedida no enunciado:** `buscarLojaParaPedido` (`src/lib/supabase/queries/lojas.ts:97-108`)
faz `.from("lojas").select("*").eq("id", lojaId).maybeSingle()` e devolve `LojaCompleta =
Tables<"lojas">`. Em `src/lib/database.types.ts` a Row de `lojas` já traz
`whatsapp: string | null` e `whatsapp_envio_automatico: boolean` (não-nullable).
**Nenhuma mudança de query e nenhuma migration são necessárias.**

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/actions/pedido.ts` | Orquestrador autoritativo do pedido (§10). Sucesso: `{ pedidoId, token_acesso }` | Passo (9) novo, pós-RPC, best-effort: relê o pedido e monta `whatsappHref`. Tipo `ResultadoCriarPedido` ganha `whatsappHref: string \| null` no ramo de sucesso |
| `src/lib/supabase/queries/pedidos.ts` | `buscarPedidoPorToken(client, id, token) → PedidoComItens \| null`, guard `z.guid()` em ambos, service_role | **Nada.** Reuso puro |
| `src/lib/supabase/queries/lojas.ts` | `buscarLojaParaPedido` → `LojaCompleta` com `.select("*")` | **Nada.** A coluna já chega |
| `src/lib/utils/whatsappPedido.ts` | `montarLinkWhatsappPedido(pedido, loja) → { href } \| null`; `null` sem WhatsApp (RN-W3); função pura | **Nada.** Reuso puro |
| `src/components/vitrine/checkout/useEnviarPedido.ts` | Consome o retorno via `"erro" in resultado`, usa `pedidoId`/`token_acesso` | **Nada nesta issue** (a mecânica de abrir a aba é a 126). Campo aditivo não quebra o narrowing |
| `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` | Já monta o link do botão manual com os mesmos dois primitivos | **NÃO TOCAR** — RN-A3: o botão manual independe do toggle |
| `src/lib/actions/pedido.test.ts` (1115 linhas) | Suíte de orquestração com mocks de I/O | Ganha bloco RED novo **e** exige ajuste no teste de contrato existente (ver abaixo) |
| `supabase/migrations/20260704120000_lojas_whatsapp_envio_automatico.sql` | Coluna + projeção na view `vitrine_lojas` | **NÃO TOCAR** — já aplicada |

**Regressão obrigatória a tratar (não é opcional):** o teste existente em
`src/lib/actions/pedido.test.ts:301-305`

```ts
it("sucesso: retorna { pedidoId, token_acesso } vindos da RPC", async () => {
  cenarioFeliz();
  const r = await criarPedido(payloadBase());
  expect(r).toEqual({ pedidoId: "ped-1", token_acesso: "tok-1" });
});
```

usa `toEqual` **exato**. Ao adicionar o campo, ele quebra. Ele **deve** ser atualizado
para `{ pedidoId: "ped-1", token_acesso: "tok-1", whatsappHref: null }` (o `lojaRow()`
padrão não tem `whatsapp` nem `whatsapp_envio_automatico`, então o caminho correto
devolve `null`). **Não** trocar por `expect.objectContaining` — isso afrouxaria a
asserção de contrato exatamente onde ela é útil.

### Decisões de Design

#### D1 — De onde vem o `PedidoComItens` autoritativo

- **(a) SELECT extra com `buscarPedidoPorToken(svc, pedidoId, token)` — ESCOLHIDA.**
  Prós: é a **linha realmente gravada**, então cobre o cupom perdido na corrida (RPC
  passo 2 zera desconto e recompõe total) e o replay idempotente (RPC passo 0/3b devolve
  outro pedido); devolve exatamente o tipo `PedidoComItens` que `montarLinkWhatsappPedido`
  exige, com `itens_pedido` e `itens_pedido_opcionais` aninhados e **ids reais**; reusa
  o mesmo caminho de leitura da página de confirmação (uma verdade, dois consumidores);
  zero código novo de montagem.
  Contras: 1 round-trip a mais no checkout, com dois joins.
  Mitigação: a leitura só acontece **quando o link vai ser emitido** (flag ligada + loja
  com WhatsApp) — ver D3. Nos demais casos o custo é zero. É a mesma query que a página
  seguinte (`/confirmacao`) executa milissegundos depois; o índice de PK + `token_acesso`
  torna o custo desprezível frente ao ViaCEP/geocoding que a mesma action já faz.

- **(b) Montar o `PedidoComItens` em memória a partir de `itensSnapshot` + `total`.**
  Prós: zero I/O.
  Contras — **desqualificantes**: (i) diverge do gravado quando a trava de cupom falha na
  corrida, produzindo uma mensagem com total menor do que o cobrado; (ii) no replay
  idempotente descreveria um pedido que não é o retornado; (iii) exigiria fabricar
  `id`/`criado_em`/`status`/ids de `itens_pedido` para satisfazer o tipo — literalmente
  construir um objeto que finge ser a linha do banco. É o padrão "dois fluxos paralelos
  divergentes" listado como remendo. **Rejeitada.**

- **(c) Estender a RPC para `returns table (... pedido jsonb)`.**
  Prós: um round-trip só.
  Contras: exige `DROP FUNCTION` + recriação (mudança de tipo de retorno), nova migration
  — fora do escopo declarado e sem migration autorizada; toca a função mais crítica do
  banco por um ganho de latência marginal; a issue 125 não tem mandato de schema.
  **Rejeitada agora**; anotada como otimização futura se a latência do checkout virar
  problema medido (não especulado).

#### D2 — Contenção do erro (RN-A4, best-effort)

O bloco novo fica em `try/catch` **próprio**, aninhado dentro do `try` externo já
existente. Sem isso, um `throw` de `buscarPedidoPorToken` (PostgREST propaga `error`)
cairia no `catch` externo e retornaria `ERRO_GENERICO` — **para um pedido já gravado e
já cobrado**. O cliente veria "não foi possível criar o pedido", tentaria de novo, e só
não duplicaria por causa da chave de idempotência. Inaceitável.

Regra: qualquer falha do bloco → `console.error("[criarPedido:whatsapp]", e)` +
`whatsappHref = null`. O pedido **sempre** retorna sucesso se a RPC gravou.
Alternativa considerada (deixar propagar) rejeitada pelo motivo acima.

#### D3 — Ordem das guardas / custo

`whatsappHref` só é buscado quando `loja.whatsapp_envio_automatico === true` **e**
`loja.whatsapp` é truthy. Duas razões: (1) RN-A2 — a decisão é do servidor e é barata,
avaliada antes de qualquer I/O; (2) evita o SELECT extra em 100% dos casos em que o
resultado seria `null`.

Guarda de WhatsApp: `loja.whatsapp` **truthy**, e não uma reimplementação de
`replace(/\D/g,"")`. A normalização do número é responsabilidade única de
`montarLinkWhatsappPedido` (RN-W3) — duplicá-la aqui criaria dois lugares para a mesma
regra. Consequência aceita: `whatsapp = "abc"` (sem dígito) paga o SELECT e depois
recebe `null` da função pura. Caso patológico, custo de uma leitura, invariante intacta.

Comparação de flag: `=== true` estrito, não truthiness. `LojaCompleta` tipa a coluna como
`boolean` não-nulo, mas o valor vem de `.select("*")` em runtime (e de fixtures em teste);
`=== true` é fail-closed diante de `undefined`/`null`.

#### D4 — Forma do contrato de retorno e a restrição `'use server'`

O arquivo é `'use server'`: **só funções async podem ser exportadas como valor**. A
extensão é feita no `export type ResultadoCriarPedido`, que é **type-only** e apagado na
compilação — por isso já convive com a diretiva hoje. **Proibido** nesta issue: exportar
qualquer `const`/objeto/schema deste arquivo (ex.: um `const RESULTADO_VAZIO`), o que
quebraria o build com o erro de constraint de export do Next 16.

Forma escolhida — campo **obrigatório e nullable**, sempre presente no sucesso:

```ts
export type ResultadoCriarPedido =
  | { pedidoId: string; token_acesso: string; whatsappHref: string | null }
  | { erro: string };
```

- vs. `whatsappHref?: string` (opcional): rejeitado — "ausente" e "servidor decidiu não
  emitir" viram o mesmo `undefined`, e o consumidor da 126 não distingue "flag desligada"
  de "campo não implementado". Nullable obrigatório força o servidor a se pronunciar.
- vs. objeto aninhado `{ whatsapp: { href } | null }`: rejeitado — sem ganho, e o
  consumidor client passaria a desestruturar duas camadas.
- O ramo de **erro não ganha o campo**. Não há link sem pedido.
- Compatibilidade com callers: `useEnviarPedido` faz narrowing por `"erro" in resultado`
  e lê `pedidoId`/`token_acesso`. Campo aditivo em união discriminada por presença de
  chave é **não-quebrante**. Nenhum outro caller consome `ResultadoCriarPedido`
  (verificado por grep em `src/`).

#### D5 — Idempotência (replay)

**Definição normativa:** o `whatsappHref` é montado **exatamente do mesmo jeito** no
replay, e o resultado é **determinístico e idêntico** ao da primeira chamada.

Racional: a decisão de emitir usa `loja` (estado atual da loja) e o conteúdo usa a linha
lida por `(pedido_id, token_acesso)` — que no replay é a **mesma linha** que a primeira
chamada gravou. `montarLinkWhatsappPedido` é pura. Logo, mesma entrada → mesmo href.
Consequência intencional: um retry do cliente (duplo-submit, reload, falha de rede)
reabre o WhatsApp com **o mesmo pedido**, sem criar pedido novo e sem descrever valores
diferentes do que está no painel. Único caso em que o href muda entre a 1ª chamada e o
replay é o lojista ter alterado `whatsapp`/`whatsapp_envio_automatico` no meio —
comportamento correto: a preferência vigente manda.

Não há passo condicional "se foi replay, não monta". Introduzir um exigiria que a RPC
sinalizasse o replay (ela não sinaliza) e criaria um segundo caminho divergente.

### Cenários (entradas, dublês e asserções para a fase RED)

Todos no bloco novo de `src/lib/actions/pedido.test.ts`, reusando `cenarioFeliz()`,
`lojaRow()` e `payloadBase()` já existentes.

**Preparo comum obrigatório (infra de teste, não é cenário):**

1. Adicionar `vi.mock("@/lib/supabase/queries/pedidos", ...)` expondo
   `buscarPedidoPorToken: vi.fn()`. Motivo: o teste é de **orquestração**, não de banco
   (o banco é `tests/migrations/rpc_criar_pedido.test.ts`); e o mock evita depender do
   guard `z.guid()` interno da query real.
2. Trocar as fixtures de retorno da RPC por **uuids de verdade**, para que o cenário
   permaneça realista caso o mock caia:
   `PEDIDO_ID = "99999999-0000-0000-0000-000000000001"` e
   `TOKEN = "77777777-0000-0000-0000-000000000009"`. O `TOKEN` deve ser uma string
   **improvável de aparecer por acaso** no texto da mensagem — é o que dá poder ao T4.
   Ajustar `cenarioFeliz()` (`fakeClient.rpc.mockResolvedValue({ data: [{ pedido_id:
   PEDIDO_ID, token_acesso: TOKEN }], error: null })`) e, em consequência, o teste de
   contrato da linha 301.
3. Fixture nova `pedidoGravadoRow(over)` devolvendo um `PedidoComItens` plausível:
   `id: PEDIDO_ID`, `token_acesso: TOKEN`, `loja_id: LOJA_A`, `nome_cliente: "Fulano"`,
   `telefone_cliente: null`, `subtotal: 50`, `desconto: 0`, `taxa_entrega: 5`,
   `total: 55`, `tipo_entrega: "entrega"`, `forma_pagamento: "pix"`,
   `cupom_codigo: null`, `observacoes: null`, `troco_para: null`,
   `endereco_entrega: { rua: "Rua X", numero: "10", bairro: "Centro", cep: "01000-000" }`,
   `status: "pendente"`, `itens_pedido: [{ ..., nome: "Pizza", preco: 25, quantidade: 2,
   itens_pedido_opcionais: [] }]`.
4. Default no `beforeEach`/`cenarioFeliz`: `buscarPedidoPorToken.mockResolvedValue(null)`
   — assim nenhum teste pré-existente muda de comportamento além do campo `null`.

**Caminho feliz**

- **T1 — flag ligada + loja com WhatsApp → href com o resumo do pedido gravado.**
  Dublês: `buscarLojaParaPedido → lojaRow({ whatsapp: "5511999990000",
  whatsapp_envio_automatico: true })`; `buscarPedidoPorToken → pedidoGravadoRow()`.
  Asserções:
  - `typeof r.whatsappHref === "string"`;
  - `r.whatsappHref.startsWith("https://api.whatsapp.com/send?phone=5511999990000&text=")`;
  - `decodeURIComponent(r.whatsappHref)` contém `"Novo pedido iRango"`, `"Pizza"` e o
    total formatado do **pedido gravado** (`"55,00"`);
  - `buscarPedidoPorToken` foi chamado **1 vez**, com `(fakeClient, PEDIDO_ID, TOKEN)` —
    prova que o objeto veio do banco, não da memória;
  - `r.pedidoId === PEDIDO_ID` e `r.token_acesso === TOKEN` (contrato preservado).

- **T1b — o href descreve o GRAVADO, não o recalculado (a prova da causa raiz).**
  Mesmos dublês de T1, mas `buscarPedidoPorToken → pedidoGravadoRow({ desconto: 0,
  total: 55 })` enquanto o payload leva `codigo_cupom: "PROMO5"` e
  `buscarCupomPorCodigo → cupomRow()` (desconto de 5 → a action calcula total 50 em
  memória, mas a RPC "perdeu" a trava e gravou 55).
  Asserções: `decodeURIComponent(href)` contém `"55,00"` e **não** contém `"50,00"`;
  e não contém `"PROMO5"` (a linha gravada tem `cupom_codigo: null`).
  Este teste é o que impede a implementação preguiçosa de opção (b).

**Bordas**

- **T2 — flag desligada → `whatsappHref === null` e NENHUMA leitura extra.**
  Dublês: `lojaRow({ whatsapp: "5511999990000", whatsapp_envio_automatico: false })`.
  Asserções: `r.whatsappHref === null`; `expect(buscarPedidoPorToken).not.toHaveBeenCalled()`
  (prova a guarda barata de D3); `r.pedidoId` presente (pedido criado normalmente).

- **T3 — loja sem WhatsApp, flag ligada → `null`.**
  Dublês: `lojaRow({ whatsapp: null, whatsapp_envio_automatico: true })`.
  Asserções: `r.whatsappHref === null`; `buscarPedidoPorToken` não chamado;
  `fakeClient.rpc` chamado 1 vez (o pedido existe).

- **T3b — flag ausente/undefined na row → `null` (fail-closed).**
  Dublês: `lojaRow({ whatsapp: "5511999990000" })` (sem a chave da flag).
  Asserção: `r.whatsappHref === null`. Trava o `=== true` estrito de D3.

- **T4 — `whatsappHref` NUNCA contém o `token_acesso` (RN-A6).**
  Dublês de T1, com `pedidoGravadoRow()` carregando `token_acesso: TOKEN` (a row do
  banco **tem** o token — é justamente por isso que o teste tem valor).
  Asserções (as três, não só a primeira):
  - `expect(r.whatsappHref).not.toContain(TOKEN)`;
  - `expect(decodeURIComponent(r.whatsappHref!)).not.toContain(TOKEN)` — pega o caso de o
    token entrar percent-encoded;
  - `expect(decodeURIComponent(r.whatsappHref!)).not.toContain("token")` (case-insensitive
    via regex `/token/i`) — pega o rótulo, se alguém colocar `Token: ...`.

- **T5 — falha ao reler o pedido não derruba o pedido (RN-A4).**
  Dublês de T1, mas `buscarPedidoPorToken.mockRejectedValue(new Error("PostgREST 500"))`.
  Asserções: `r` **não** tem `erro`; `r.pedidoId === PEDIDO_ID`;
  `r.token_acesso === TOKEN`; `r.whatsappHref === null`.
  Este é o teste que força o `try/catch` interno de D2 — sem ele o retorno seria
  `{ erro: ERRO_GENERICO }` e o cliente perderia um pedido já gravado.

- **T5b — pedido não encontrado na releitura (`null`) → `whatsappHref: null`, sucesso.**
  Dublês de T1 com `buscarPedidoPorToken.mockResolvedValue(null)`.
  Asserções: sem `erro`, `pedidoId` presente, `whatsappHref === null`.
  (Cobre o caso de replicação atrasada / row invisível.)

- **T6 — replay idempotente monta o MESMO href (D5).**
  Dublês: cenário T1; chamar `criarPedido(payloadBase({ idempotency_key: KEY }))` duas
  vezes com a RPC devolvendo **sempre** `{ pedido_id: PEDIDO_ID, token_acesso: TOKEN }` e
  `buscarPedidoPorToken` devolvendo **sempre** `pedidoGravadoRow()`.
  Asserções: `r1.whatsappHref === r2.whatsappHref`; ambos strings;
  `r1.pedidoId === r2.pedidoId`.

- **T7 — RPC falha → contrato de erro inalterado.** (não-regressão)
  `fakeClient.rpc.mockResolvedValue({ data: null, error: { message: "x" } })`.
  Asserções: `r` é `{ erro: expect.any(String) }` — sem `whatsappHref` no ramo de erro; e
  `buscarPedidoPorToken` não foi chamado.

**Tratamento de erro (política).** Nenhuma falha do bloco de WhatsApp vira mensagem ao
usuário. Log server-side com prefixo próprio (`"[criarPedido:whatsapp]"`, distinguível do
`"[criarPedido]"` existente para triagem em produção), retorno `null`. Nunca `e.message`
ao cliente (`seguranca.md` §14).

### Contratos de Dados

**Schema: nenhuma mudança.** Sem migration, sem policy, sem regeneração de tipos.

- `lojas.whatsapp_envio_automatico boolean NOT NULL DEFAULT true` — já aplicada em
  `supabase/migrations/20260704120000_lojas_whatsapp_envio_automatico.sql`, já presente em
  `src/lib/database.types.ts` (Row de `lojas`, e também projetada na view `vitrine_lojas`,
  que só interessa à issue 126).
- RLS: nenhuma política nova. A leitura de `lojas` e de `pedidos` aqui é **service_role
  (BYPASSRLS)**, escopada por igualdade explícita — `eq("id", lojaId)` em
  `buscarLojaParaPedido` e `eq("id", pedidoId).eq("token_acesso", token)` em
  `buscarPedidoPorToken`. Não há SELECT anon em `pedidos`; o token é a senha do pedido.

**Contrato de aplicação (único que muda):**

```ts
// src/lib/actions/pedido.ts — type-only export, compatível com 'use server'
export type ResultadoCriarPedido =
  | { pedidoId: string; token_acesso: string; whatsappHref: string | null }
  | { erro: string };
```

`whatsappHref` é sempre uma URL absoluta `https://api.whatsapp.com/send?phone=<dígitos>&text=<encodeURIComponent>`
ou `null`. Nunca string vazia.

### Recálculo no Servidor

Não há **novo** cálculo monetário nesta issue — e é justamente esse o ponto sensível.

| | |
|---|---|
| O cliente envia | nada relacionado ao WhatsApp. Nenhum campo do payload influencia `whatsappHref` (o `schemaPayloadPedido` é `.strict()` e não tem esse campo — payload com `whatsappHref` é **rejeitado antes de qualquer I/O**) |
| O servidor decide | emitir ou não, lendo `lojas.whatsapp_envio_automatico` e `lojas.whatsapp` do banco por service_role |
| O servidor formata | a partir da **linha gravada** em `pedidos`/`itens_pedido`/`itens_pedido_opcionais`, relida por `buscarPedidoPorToken` — nunca de `itensSnapshot`/`total` em memória, nunca do carrinho |

Invariante que a arquitetura preserva: **o texto da mensagem e o valor no painel do
lojista vêm da mesma linha do banco.** Se um dia divergirem, é bug de leitura, não de
cálculo — e T1b trava isso.

### Arquivos

**Criar:** nenhum. (Sinal de saúde do plano: zero primitivo novo — `montarLinkWhatsappPedido`,
`buscarPedidoPorToken` e `buscarLojaParaPedido` já existem e cobrem 100% da necessidade.)

**Modificar (nível função):**

1. `src/lib/actions/pedido.test.ts` — **fase RED, primeiro.**
   - novo `vi.mock("@/lib/supabase/queries/pedidos")` com `buscarPedidoPorToken`;
   - `PEDIDO_ID`/`TOKEN` uuid + fixture `pedidoGravadoRow()`;
   - `cenarioFeliz()` atualizado (RPC devolve os uuids; `buscarPedidoPorToken` default `null`);
   - teste de contrato da linha 301 atualizado para incluir `whatsappHref: null`;
   - `describe("criarPedido — whatsappHref autoritativo (125 / RN-A2·A4·A6)")` com T1, T1b,
     T2, T3, T3b, T4, T5, T5b, T6, T7.

2. `src/lib/actions/pedido.ts` — **fase GREEN.**
   - imports: `buscarPedidoPorToken` de `@/lib/supabase/queries/pedidos`,
     `montarLinkWhatsappPedido` de `@/lib/utils/whatsappPedido`;
   - `ResultadoCriarPedido`: ramo de sucesso ganha `whatsappHref: string | null`;
   - dentro de `criarPedido`, **entre** o guard de erro da RPC e o `return` final, passo
     (9) — bloco best-effort:
     ```
     let whatsappHref: string | null = null;
     if (loja.whatsapp_envio_automatico === true && loja.whatsapp) {
       try {
         const gravado = await buscarPedidoPorToken(svc, pedidoId, token);
         whatsappHref = gravado ? montarLinkWhatsappPedido(gravado, loja)?.href ?? null : null;
       } catch (e) { console.error("[criarPedido:whatsapp]", e); }
     }
     ```
     (forma normativa — nomes e ordem exatos; sem helper novo, sem extrair função);
   - `return { pedidoId, token_acesso, whatsappHref }`;
   - comentário curto no bloco citando RN-A2 (decisão do servidor), RN-A4 (best-effort,
     por isso o try/catch interno) e D1 (a fonte é a linha gravada, não a memória — cita
     a divergência da trava de cupom).

**NÃO tocar (e por quê):**

- `src/lib/utils/whatsappPedido.ts` — conteúdo da mensagem é fora de escopo (RN-A6,
  herdado do spec 3). Qualquer edição aqui muda também o botão manual da confirmação.
- `src/lib/supabase/queries/pedidos.ts` e `queries/lojas.ts` — reuso puro; a issue
  declara "sem query nova" e a verificação confirma que nada falta.
- `src/components/vitrine/checkout/useEnviarPedido.ts` e `CheckoutWizard.tsx` — a mecânica
  de abrir a aba (RN-A5) é a **issue 126**. Consumir `whatsappHref` aqui antecipa escopo e
  polui o diff que a 126 precisa revisar.
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` — RN-A3: o botão manual independe
  do toggle. Mexer aqui seria acoplar as duas coisas.
- `supabase/migrations/**` — coluna já existe (`20260704120000`). Nenhuma migration.
- `src/lib/database.types.ts` — gerado; a coluna já está lá.
- `src/lib/validacoes/pedido.ts` — o payload do cliente não ganha campo nenhum.

### Dependências Externas

**Nenhuma.** Sem pacote novo. Stack já presente: `next@16.2.9`, `vitest@^4.1.8`,
`zod`, `@supabase/supabase-js`. `api.whatsapp.com/send` é link público, sem chave, sem
custo (`architecture.md` §9 — nada de custo variável).

Restrição de plataforma relevante: arquivo com diretiva `'use server'` só pode exportar
funções async. `export type` é apagado na compilação e portanto é permitido — evidência
empírica no próprio repositório: `ResultadoCriarPedido` já é exportado hoje de
`src/lib/actions/pedido.ts` e `npm run build` passa. **Não introduzir `export const`
neste arquivo.**

### Ordem de Implementação

1. **RED (agente `tdd`)** — escrever a infra de teste do preparo comum + T1..T7 em
   `src/lib/actions/pedido.test.ts`, rodar `npx vitest run src/lib/actions/pedido.test.ts`
   e **confirmar a falha com output real**. Esperado: os testes novos falham (campo
   inexistente / `buscarPedidoPorToken` nunca chamado) **e** o teste de contrato da linha
   301, já atualizado para `whatsappHref: null`, também falha. Parar aqui.
   *Justificativa de ordem:* issue `crítica: SIM`; o teste é o que fixa a decisão D1
   (T1b) e a contenção D2 (T5) — se o código vier antes, a opção (b) "montar da memória"
   passa despercebida por ser mais simples.
2. **GREEN** — alterar o tipo `ResultadoCriarPedido`, adicionar os dois imports e o bloco
   (9) em `src/lib/actions/pedido.ts`. Depende de 1 (o vermelho define a forma exata do
   contrato e a assinatura da releitura).
3. **Suíte da action verde** — `npx vitest run src/lib/actions/pedido.test.ts`.
4. **Suíte inteira** — `NODE_OPTIONS='--max-old-space-size=2048' npx vitest run --maxWorkers=2`.
   Depende de 3; alvo de vigilância: qualquer teste que faça `toEqual` sobre o retorno de
   `criarPedido` (grep já indica que só `pedido.test.ts` faz).
5. **`npm run build`** — obrigatório e por último: é o único passo que valida a constraint
   de export de `'use server'` do Next 16, que o vitest **não** enxerga.

### Checklist de Validação Pós-Implementação

- [x] `npx vitest run src/lib/actions/pedido.test.ts` — verde, T1..T7 inclusos
- [x] `NODE_OPTIONS='--max-old-space-size=2048' npx vitest run --maxWorkers=2` — sem regressão
- [x] `npm run build` sem warnings novos (valida `'use server'` — nenhum `export const` novo)
- [x] `whatsappHref` é montado a partir de `buscarPedidoPorToken`, **não** de
      `itensSnapshot`/`total` em memória (revisar o diff: nenhum objeto `PedidoComItens`
      literal construído em `pedido.ts`)
- [x] Flag desligada e loja sem WhatsApp → `null` **e sem SELECT extra** (custo zero)
- [x] `try/catch` próprio no bloco de WhatsApp: falha na releitura → pedido continua
      retornando sucesso (RN-A4)
- [x] `whatsappHref` não contém `token_acesso` — cru nem percent-encoded (RN-A6 / 037)
- [x] Nenhum secret ou dado pessoal hardcoded; fixtures de teste usam telefone/uuid
      fictícios (`seguranca.md` §8)
- [x] Nenhuma migration nova; `git status` não mostra `supabase/migrations/**`
- [x] `useEnviarPedido.ts`, `confirmacao/page.tsx` e `whatsappPedido.ts` **inalterados**
- [x] Log de falha do WhatsApp usa prefixo próprio e nunca vaza `e.message` ao cliente (§14)

---

## RED capturado

Baseline antes da mudança (`git stash` de `src/lib/actions/pedido.test.ts`):
`Tests 50 passed (50)` — a suíte estava 100% verde. Após escrever o vermelho:
**`Tests 13 failed | 47 passed (60)`**.

Comando: `npx vitest run src/lib/actions/pedido.test.ts --reporter=verbose`

### Contrato de retorno (4 falhas de não-regressão, `toEqual` exato preservado)

```
 FAIL  src/lib/actions/pedido.test.ts > criarPedido (Server Action — recálculo autoritativo §10) > sucesso: retorna { pedidoId, token_acesso } vindos da RPC
AssertionError: expected { …(2) } to deeply equal { …(3) }

- Expected
+ Received

  {
    "pedidoId": "99999999-0000-0000-0000-000000000001",
    "token_acesso": "77777777-0000-0000-0000-000000000009",
-   "whatsappHref": null,
  }
```

Mesma falha nos outros três testes que fazem `toEqual` sobre o sucesso:
`[087] produto disponivel=true, oculto=false … → cria pedido normalmente`,
`cupom esgotado na leitura → recalcula SEM desconto e PROSSEGUE (D5)` e
`[071] RN-C4 entrega fora de zona com taxa_entrega_fora_zona=8 → frete 8`.
Todos atualizados para `{ pedidoId, token_acesso, whatsappHref: null }` — **não**
afrouxados para `expect.objectContaining`.

### T1 — href do pedido gravado

```
 FAIL  … > [125-T1] flag true + loja com WhatsApp → whatsappHref é o link do pedido GRAVADO (lido por buscarPedidoPorToken)
AssertionError: expected 'undefined' to be 'string' // Object.is equality

Expected: "string"
Received: "undefined"

 ❯ src/lib/actions/pedido.test.ts:1211:35
    1211|     expect(typeof r.whatsappHref).toBe("string");
```

### T1b — o href descreve o GRAVADO, não o recalculado em memória

```
 FAIL  … > [125-T1b] href descreve o GRAVADO, não o recalculado: cupom aplicado em memória (total 50) mas linha gravada tem total 55 → mensagem diz 55,00
AssertionError: expected 'undefined' to match /Total: R\$\s55,00/

- Expected:
/Total: R\$\s55,00/

+ Received:
"undefined"

 ❯ src/lib/actions/pedido.test.ts:1241:19
    1241|     expect(texto).toMatch(/Total: R\$\s55,00/); // linha gravada
    1242|     expect(texto).not.toMatch(/Total: R\$\s50,00/); // total calculado em memória
```

### T2 / T3 / T3b — decisão do servidor, sem leitura extra

```
 FAIL  … > [125-T2] flag whatsapp_envio_automatico=false → whatsappHref null e NENHUMA releitura do pedido
AssertionError: expected undefined to be null

- Expected:
null

+ Received:
undefined

 ❯ src/lib/actions/pedido.test.ts:1256:28
    1256|     expect(r.whatsappHref).toBeNull();
```

(`[125-T3] loja sem WhatsApp (flag true)` e `[125-T3b] flag ausente/undefined na row`
falham identicamente — `expected undefined to be null`.)

### T4 — token_acesso nunca no href

```
 FAIL  … > [125-T4] whatsappHref NUNCA contém o token_acesso — cru, percent-encoded ou rotulado
AssertionError: expected 'undefined' to be 'string' // Object.is equality

 ❯ src/lib/actions/pedido.test.ts:1293:35
    1293|     expect(typeof r.whatsappHref).toBe("string"); // sem link, o teste não provaria nada
    1294|     expect(r.whatsappHref!).not.toContain(TOKEN); // string crua
    1295|     const texto = decodeURIComponent(r.whatsappHref!);
```

O teste falha na **guarda** (`typeof === "string"`) antes das três negativas —
intencional: uma asserção `not.toContain` sobre `undefined` passaria por vacuidade
e não provaria nada. Só fica verde quando existe um href de verdade sem o token.

### T5 / T5b — best-effort (RN-A4)

```
 FAIL  … > [125-T5] buscarPedidoPorToken lança → pedido continua sucesso com whatsappHref null (RN-A4, try/catch próprio)
AssertionError: expected undefined to be null

 ❯ src/lib/actions/pedido.test.ts:1311:28
    1311|     expect(r.whatsappHref).toBeNull();
```

Observação: hoje `r` **já** é sucesso (a action nem chama a releitura), então o teste
falha só no campo. Depois do GREEN ele passa a valer como trava do `try/catch` interno
de D2 — sem ele o retorno viraria `{ erro: ERRO_GENERICO }` para um pedido já gravado.

### T6 — replay idempotente

```
 FAIL  … > [125-T6] replay idempotente (mesma idempotency_key) → whatsappHref idêntico ao da 1ª chamada
AssertionError: expected 'undefined' to be 'string' // Object.is equality

 ❯ src/lib/actions/pedido.test.ts:1335:36
    1335|     expect(typeof r1.whatsappHref).toBe("string");
```

### T7 — não-regressão do ramo de erro (verde hoje, deve permanecer verde)

`[125-T7] RPC falha → { erro } sem whatsappHref e sem releitura do pedido` **passa**
hoje e é guarda: o GREEN não pode adicionar o campo ao ramo de erro nem reler o pedido
quando a RPC falhou.

### Resumo

```
 Test Files  1 failed (1)
      Tests  13 failed | 47 passed (60)
```

**Contrato para a fase GREEN** (`src/lib/actions/pedido.ts`, nenhum outro arquivo):

```ts
export type ResultadoCriarPedido =
  | { pedidoId: string; token_acesso: string; whatsappHref: string | null }
  | { erro: string };
```

Assinatura consumida pelos testes (mock de `@/lib/supabase/queries/pedidos`):
`buscarPedidoPorToken(svc, pedidoId, token) → Promise<PedidoComItens | null>`,
chamada **exatamente 1 vez** e **só** quando `loja.whatsapp_envio_automatico === true`
e `loja.whatsapp` truthy. Nenhum código de produção foi escrito nesta fase.

---

## GREEN

`src/lib/actions/pedido.ts` — único arquivo de produção alterado:
- `ResultadoCriarPedido` ganhou `whatsappHref: string | null` no ramo de sucesso
  (`export type`, erased — nenhum `export const` novo, `'use server'` intacto).
- imports novos: `buscarPedidoPorToken` (`@/lib/supabase/queries/pedidos`) e
  `montarLinkWhatsappPedido` (`@/lib/utils/whatsappPedido`) — reuso puro, zero primitivo novo.
- passo (9) na forma normativa do plano, entre o guard de erro da RPC e o `return`:
  guarda `loja.whatsapp_envio_automatico === true && loja.whatsapp` antes de qualquer I/O,
  `try/catch` próprio com `console.error("[criarPedido:whatsapp]", e)` → `whatsappHref = null`.

```
$ npx vitest run src/lib/actions/pedido.test.ts
 Test Files  1 passed (1)
      Tests  60 passed (60)

$ NODE_OPTIONS='--max-old-space-size=2048' npx vitest run --maxWorkers=2
 Test Files  191 passed (191)
      Tests  2642 passed (2642)

$ npm run build
 ✓ Compiled successfully — rotas geradas, sem warning novo
```

Nada tocado em `supabase/migrations/**`, `database.types.ts`, `whatsappPedido.ts`,
`queries/pedidos.ts`, `useEnviarPedido.ts` ou `confirmacao/page.tsx`.
