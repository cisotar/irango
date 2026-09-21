## Plano Técnico

> Plano da issue `tasks/270-lote-de-cardapio-on-conflict-pula-fk-composta.md`.
> Branch: `feat/vigencia-por-item-do-cardapio` (de `main`, pós-merge do PR #145).
> Primeira issue de código do loop `plan/loop-vigencia-por-item-do-cardapio.md` (§3,
> "Decisões de escopo"): o mecanismo escolhido aqui é o que a issue 274
> (`definirDiasDoVinculo`) vai espelhar — por isso ele é decidido aqui, uma vez só.

### Decisão de mecanismo (a que a 274 herda)

**Escolhido: prova de POSSE do `cardapio_id` na loja-alvo ANTES da escrita**, nos dois mundos,
por UMA função compartilhada. **Rejeitado: `count: "exact"` no upsert.**

Por quê, em um caso numérico:

| cenário | `count` do upsert com `ON CONFLICT DO NOTHING` |
|---|---|
| reaplicar o MESMO lote já aplicado na PRÓPRIA loja (RN-10, legítimo) | `0` |
| cardápio de outra loja cujos pares já existem lá (a brecha da 270) | `0` |

Os dois casos são **indistinguíveis por `count`**. Tratar `count === 0` como falha quebra a
idempotência que RN-10 exige e que `cardapio.test.ts:"[RN-10] reaplicar o MESMO lote continua
{ ok: true }"` já trava; não tratar deixa a brecha aberta. `count` **não é um mecanismo
disponível** para o verbo `upsert … do nothing`. Para o verbo `UPDATE` da 274 ele é,
sim, inequívoco (a linha existe na tripla ou não existe).

**Regra única que os dois mundos e as duas issues passam a seguir** — e que o `escriba` deve
registrar em `seguranca.md` ao fim do loop:

> Toda escrita de lote escopada por `cardapio_id` prova a posse do cardápio no servidor e
> devolve a MESMA frase para "alheio" e "inexistente". **O verbo decide o instrumento:**
> `UPDATE`/`DELETE` de linha existente provam por `count: "exact"`; `upsert` com
> `ON CONFLICT DO NOTHING` prova por **posse ancorada** — porque ali o `count` confunde
> idempotência com recusa.

"Posse ancorada" não é padrão novo: é exatamente a categoria que
`enforcement-escopo-admin.test.ts` (camada 3, `ALLOWLIST_INSERT`) já sanciona para
`admin-entrega.ts`, onde todo insert-filho roda depois de
`escopo.buscarPorId("zonas_entrega", id)`.

**Não é TOCTOU** (a objeção que o docstring atual levanta): `cardapios.loja_id` não muda, e a
janela entre a leitura e a escrita só poderia transformar um cardápio **existente e próprio**
em inexistente — caso em que a FK composta derruba o upsert de qualquer forma. O que a 251
proibiu foi pre-check **da lista de produtos** (esse sim vira oráculo, porque a diferença entre
pedido e gravado denuncia quais ids existem em outra loja). Ler **um** id de cardápio da
PRÓPRIA loja-alvo não produz diferença observável: alheio e inexistente saem pela mesma frase.

### Análise do Codebase

Já existe e será reusado — **nada de mensagem, nada de escopo e nada de validação é criado**:

- `src/lib/actions/cardapio-contrato.ts` — `MSG_GENERICA_LOTE` e `erroDoLote()`. A recusa nova
  usa `MSG_GENERICA_LOTE` **byte a byte**, sem constante nova (seria uma segunda frase para a
  mesma falha = oráculo).
- `src/lib/validacoes/cardapio.ts` — `schemaLoteDeProdutos` (`.strict()`, `cardapio_id: z.guid()`,
  teto de 200 ids). A posse só é consultada **depois** do parse: id não-uuid não chega ao banco.
- `src/lib/supabase/queries/cardapios.ts` — convenção estabelecida na 269/D3: função recebe
  `client` (o autenticado do lojista **ou** o `svc` do admin) e carrega `.eq("loja_id")`
  EXPLÍCITO, o que a torna segura sob BYPASSRLS. É onde a leitura nova entra.
- `src/lib/actions/admin-loja.ts` — `prepararContextoAdmin`, `EscopoLoja.inserirVarios`
  (injeta `loja_id` por último), `registrarAcessoAdmin`, `revalidarLojaAdmin`. **Nenhum helper
  novo em `EscopoLoja` nesta issue** (o `atualizarPorChave` é da 274, spec §RN-10).
- `src/lib/supabase/queries/lojas.ts` — `buscarLojaDoDono` (origem do `loja_id` do lojista).
- `tests/migrations/cardapio_produtos_on_conflict_pula_fk.test.ts` — a prova em SQL já no repo.
  **Não muda**: ela documenta a semântica do Postgres, que o fix não altera.

Precisa ser criado (uma coisa só):

- `cardapioPertenceALoja(client, lojaId, cardapioId): Promise<boolean>` em
  `src/lib/supabase/queries/cardapios.ts`.
  Por que não reusar `buscarCardapioPorId` (que a issue sugeria): ela é **fail-closed por `modo`**
  (`paraCardapioVigencia` → `null`), então um cardápio PRÓPRIO com `modo` fora do domínio
  receberia a frase de "alheio" — recusa correta na vitrine, ruído aqui; além disso faz `select`
  largo de 10 colunas para responder um booleano.
  Por que não `escopo.buscarPorId("cardapios", id, "id")` no admin: funciona, mas o lojista não
  tem `EscopoLoja` — seriam **dois padrões** para a mesma prova, exatamente o que a 274 pediu para
  evitar. Uma função, dois callers, `select("id")`, `maybeSingle()`.

### Cenários

**Caminho feliz**
1. `schemaLoteDeProdutos.safeParse(payload)` → ok (nada de I/O antes disso).
2. `loja_id` derivado: `buscarLojaDoDono(supabase)` (lojista) / `validarLojaIdAdmin(lojaId)` +
   `prepararContextoAdmin` (admin — prova de admin ANTES de elevar, fail-closed).
3. `cardapioPertenceALoja(client, lojaId, cardapio_id)` → `true`.
4. UMA instrução de escrita, inalterada: `upsert` dos N pares com `loja_id` injetado,
   `onConflict: "cardapio_id,produto_id"`, `ignoreDuplicates: true`.
5. `registrarAcessoAdmin` (só admin) → `revalidar…` → `{ ok: true }`.

**Casos de borda**
- *Cardápio de outra loja, pares já existentes lá* (a brecha): passo 3 → `false` ⇒
  `{ ok: false, erro: MSG_GENERICA_LOTE }`, **zero escrita**, **`registrarAcessoAdmin` NÃO
  chamado**, **nenhum `revalidatePath`**.
- *Cardápio inexistente*: idem, resposta byte a byte igual à anterior.
- *Produto alheio/inexistente no lote*: inalterado — a FK composta derruba tudo (`23503`) e
  `erroDoLote`/`MSG_GENERICA_LOTE` respondem. Continua sem pre-check da lista de produtos.
- *Reaplicar o mesmo lote* (idempotência RN-10): posse ok, upsert no-op, `{ ok: true }`.
- *Lote vazio / 201 ids / chave a mais*: barrado pelo zod, `ops.length === 0`, **antes** da
  leitura de posse.
- *Falha de rede/banco na leitura de posse*: a query propaga `error` (§14, convenção do arquivo);
  o `try/catch` da action loga e devolve `MSG_GENERICA_LOTE`. Fail-closed.
- *Loja inativa / assinatura*: fora do escopo desta issue (guard de layout, inalterado).

**Tratamento de erros**
Uma frase só na tela (`MSG_GENERICA_LOTE`); `console.error("[aplicarCardapioEmProdutos]", …)` /
`[aplicarCardapioEmProdutosAdmin]` no servidor. SQLSTATE, nome de constraint e id alheio nunca
entram no retorno — os asserts de `not.toContain("23503" | "cardapio_produtos_cardapio_fk" | PB)`
já existentes continuam valendo e devem permanecer verdes.

### Schema de Banco

**Nenhuma migration.** Nenhuma tabela, coluna, CHECK, índice ou política muda. As FKs compostas
`cardapio_produtos_cardapio_fk` / `cardapio_produtos_produto_fk` e a RLS
`cardapio_produtos_escrita_propria` seguem como estão — o fix é a camada que falta **acima**
delas, não uma substituição. Consequência direta: **nada a aplicar no cloud**, então a issue não
carrega o risco de `PGRST204`.

### Validação (zod)

Sem schema novo. `schemaLoteDeProdutos` continua sendo o mesmo objeto no cliente
(`useLoteDeProdutos`/`contrato-lote.ts`) e nas duas Server Actions.

### Recálculo no Servidor

Não há valor monetário nesta issue. O que o servidor prova do zero, ignorando o cliente:
`loja_id` (sessão ou URL validada, nunca payload) e **a posse do `cardapio_id`**. O cliente envia
apenas `cardapio_id` + `produto_ids`.

### Camada que garante cada invariante

| Invariante | Onde é garantida |
|---|---|
| Vínculo nunca cruza lojas | FK composta `(cardapio_id, loja_id)` / `(produto_id, loja_id)` — inalterada, vale sob `service_role` |
| `loja_id` não vem do cliente | `buscarLojaDoDono` (lojista) · `validarLojaIdAdmin` + `EscopoLoja.inserirVarios` (admin) |
| Escrita em cardápio alheio não reporta sucesso | **NOVO:** `cardapioPertenceALoja` na Server Action (`.eq("loja_id")` explícito — vale sob BYPASSRLS) |
| Log de auditoria não aponta para entidade alheia | **NOVO:** `registrarAcessoAdmin` só depois da posse provada |
| Escrita do lojista | RLS `cardapio_produtos_escrita_propria` + FK + posse |
| Escrita do admin | RLS **não** vale (BYPASSRLS): paridade + FK + posse |
| Alheio ≠ oráculo | `MSG_GENERICA_LOTE` única, `seguranca.md` §14 |

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:** nenhum arquivo novo.

**Modificar (produção — 3):**
1. `src/lib/supabase/queries/cardapios.ts` — `cardapioPertenceALoja(client, lojaId, cardapioId)`,
   no bloco "Leituras compartilhadas lojista ↔ hub admin (269)", com o docstring explicando por
   que ler UM id de cardápio não é o pre-check que a 251 proibiu.
2. `src/lib/actions/cardapio.ts` — gate em `aplicarCardapioEmProdutos` **e** em
   `tirarDeCardapio`; docstring do módulo (o bullet "nenhum pre-check de posse em JS") e o da
   função corrigidos: a FK derruba o lote **quando a linha chega ao índice**, e não chega quando
   o par já existe.
3. `src/app/admin/assinantes/actions/admin-cardapios.ts` — o mesmo gate em
   `aplicarCardapioEmProdutosAdmin` **e** em `tirarDeCardapioAdmin`, **antes** do
   `registrarAcessoAdmin`; docstrings idem.

**Escopo — por que `tirarDeCardapio*` entra junto:** é o mesmo defeito, não um vizinho. O DELETE
é escopado por `loja_id` + `cardapio_id`, então cardápio alheio apaga 0 linhas, devolve
`{ ok: true }` e o admin grava `cardapio.tirar_produtos` com `entidade_id` de outra loja — os
efeitos (a) e (b) que a issue descreve, na mesma família de funções, com o mesmo gate de duas
linhas. Separar custaria uma segunda passada de `auditar` no mesmo vetor.

**Modificar (testes — 2, e um deles é obrigatório, não opcional):**
4. `src/lib/actions/cardapio.test.ts` — o caso
   `"[RN-09] NENHUM pre-check de posse em JS antes da escrita — seria TOCTOU"` assere hoje
   `leituras().some(o => o.tabela === "cardapio_produtos") === false` e **fica vermelho com o
   fix**. Ele não é deletado: é **reescrito** para o que a regra realmente protege —
   *nenhuma leitura de `produtos` antes da escrita* (esse é o oráculo), *uma única leitura de
   `cardapios` por `id` da própria loja*, *uma única instrução de escrita*. Mais os casos novos
   de posse (lojista).
5. `src/app/admin/assinantes/actions/admin-cardapios.paridade.test.ts` — casos RED novos. Atenção
   de mock: `respostaDe` devolve `{ data: null, error: null, count: 1 }` para tabela não
   configurada, e `data: null` no `maybeSingle` de `cardapios` significa **posse negada** —
   os casos de caminho feliz de lote precisam passar a configurar
   `respostaPorTabela.cardapios` com a linha `{ id: CARDAPIO_ID }`. Sem isso, o RED dos
   cenários novos vem acompanhado de falha espúria nos cenários antigos e o sinal se perde.

**NÃO tocar:**
- `tests/migrations/cardapio_produtos_on_conflict_pula_fk.test.ts` — é a prova da semântica do
  Postgres; ela continua verde **depois** do fix, e é isso que documenta que o fix é de aplicação,
  não de banco.
- `supabase/migrations/**`, `src/lib/database.types.ts` — nada muda no schema.
- `src/lib/actions/cardapio-contrato.ts` — nenhuma constante nova; a frase é a que já existe.
- `src/lib/actions/admin-loja.ts` — sem helper novo aqui (o `atualizarPorChave` nasce na 274).
- `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` — o fix **não** adiciona escrita
  crua nem entrada de allowlist: `escopo.inserirVarios` continua sendo o caminho.
- `src/components/painel/**`, `contrato-lote.ts`, `useLoteDeProdutos` — o contrato de retorno
  (`Resultado`) e a frase não mudam; a UI já sabe exibir `{ ok: false, erro }`.
- `components/ui/**` — gerado pelo shadcn CLI.

### Dependências Externas

**Nenhuma.** Nenhum pacote novo, nenhuma API externa, nenhuma chamada que saia do processo.
Custo variável: **zero** — o fix adiciona **um `SELECT id … limit 1` por chamada de lote**, numa
ação de painel disparada por clique humano, com índice de PK já existente. Sem impacto em quota
de Vercel/Supabase/Upstash/Sentry e sem impacto na vitrine pública (o caminho é só de painel).
Não há o que "estourar"; o comportamento sob falha da leitura é fail-closed (recusa).

### Ordem de Implementação

Issue **crítica: SIM** → a fase RED vem antes de qualquer código de produção.

1. **`tdd` (RED).** Nesta ordem, porque o admin é o caso com o efeito (b):
   a. `admin-cardapios.paridade.test.ts` — cardápio alheio com par existente ⇒
      `{ ok: false, erro: MSG_GENERICA_LOTE }`, `opEscrita("cardapio_produtos")` indefinida,
      `registrarAcessoAdmin`/insert em `admin_acessos` **não** chamado, `revalidatePath` não
      chamado; o mesmo para `tirarDeCardapioAdmin`; e a frase comparada com a constante escrita
      à mão no topo do arquivo (paridade byte a byte, não `import`).
   b. `cardapio.test.ts` — o mesmo desfecho no lojista + a reescrita do caso de "pre-check".
   c. Capturar o output `FAIL` real (mandato 3 do CLAUDE.md) antes de seguir.
2. **`executar` (GREEN), na ordem de dependência:** `queries/cardapios.ts`
   (`cardapioPertenceALoja`) → `cardapio.ts` (lojista, que é a referência de paridade) →
   `admin-cardapios.ts` (admin) → docstrings dos dois.
3. **`revisar` ‖ `testar` ‖ `auditar`** em paralelo. O `auditar` responde a uma pergunta
   específica: a leitura de posse introduz algum sinal observável que diferencie "alheio" de
   "inexistente" (frase, timing grosseiro, número de round trips)? Deve ser **não** nos dois.
4. **Gate local:** `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
5. **Sem `verificar` e sem `escriba` por issue** — o loop os roda uma vez no fim (§2 do plano do
   loop). O `escriba` recebe daqui **um** item: a regra "o verbo decide o instrumento" para
   `seguranca.md`.

### Risco residual (registrado, não mitigado)

A prova de posse é uma **segunda** ida ao banco, não uma trava estrutural: quem escrever, no
futuro, um terceiro caller de `cardapio_produtos` com `ON CONFLICT DO NOTHING` sem o gate
reabre o mesmo buraco, e nenhuma regex de `enforcement-escopo-admin.ts` o detecta (a camada 3 só
exige `loja_id` injetado, que o caller teria). A trava estrutural de verdade seria trocar
`ignoreDuplicates: true` por `ON CONFLICT … DO UPDATE SET loja_id = excluded.loja_id` — que faz a
FK composta ser avaliada sempre — mas isso muda o verbo de escrita, toca a idempotência de RN-10 e
é decisão de schema/verbo que merece a sua própria issue. **Fica anotado para o `escriba`
registrar em `architecture.md` §10 (débitos)**, não resolvido aqui.
