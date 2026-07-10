# [146] Teto `.max()` no array `itens` do pedido + dedupe de `produto_id`

**crítica:** SIM (CWE-770 / OWASP A05 — superfície de abuso de recurso; TDD red-first)
**Mundo:** servidor — checkout Server Action `criarPedido` (cliente anônimo)
**Origem:** pentest 2026-07-09, vetor "Recálculo de valor no servidor" (achado residual de DoS; núcleo de subpagamento resistiu). Spec: `specs/hardening-cardinalidade-itens-pedido.md`

## Contexto
O array raiz `itens` do payload de pedido valida só `.min(1)` — sem teto (`.max()`).
Um cliente pode enviar dezenas de milhares de itens (com `bodySizeLimit: "2mb"`,
~33 mil itens/requisição), e a lista de `ids` derivada **não é deduplicada** (ao
contrário de `opcionalIds`/`categoriaIds`, que já usam `[...new Set(...)]`).
Resultado: query/URL PostgREST gigante, loop de recálculo + RPC
(`FOR ... jsonb_array_elements` + 1 INSERT por item) com dezenas de milhares de
iterações numa única transação → exaustão de CPU/memória/tempo + amplificação de
storage. **Não é subpagamento** — o recálculo de valor resiste; é DoS/abuso de recurso.

## Escopo (a validar no planejamento)
- [ ] `.max(N)` no array raiz `itens` em `schemaPayloadPedido`
  (`src/lib/validacoes/pedido.ts:55`). Reusar o padrão `.max(50)` já em
  `schemaItemPedido.opcionais` (linha 32) — não inventar helper.
- [ ] Deduplicar `ids` antes do `.in()` do PostgREST em `criarPedido`
  (`src/lib/actions/pedido.ts:~93`): `[...new Set(dados.itens.map(i => i.produto_id))]`,
  espelhando `opcionalIds` (100-104) e `categoriaIds` (108-114).
- [ ] `.min(1)` preservado — caminho feliz (1 item até dezenas de linhas) intacto.
- [x] **N = 50** (decisão de negócio, 2026-07-09). Restrição do RED: N ≥ 30 (aceita 30) e < 1.000 (rejeita 1.000). 50 dá ~1.6x de folga sobre o carrinho realista de 30.

## Vermelho (TDD red-first) — JÁ EXISTE
`src/lib/validacoes/pedido.itens-cap.test.ts` — hoje **2 asserts de ataque falham**
(schema aceita 50k e 1k itens) e **2 de não-regressão passam** (30 e 1 item aceitos).
A implementação GREEN é adicionar `.max(N)` até os 4 asserts passarem, **sem** quebrar
os de não-regressão. Rodar este teste e ver o vermelho real antes de tocar no schema.

## Critério de aceite
- [ ] Payload com 50.000 itens é **rejeitado** no `.safeParse` (antes de qualquer I/O).
- [ ] Payload com 1.000 itens é rejeitado.
- [ ] Carrinho de 30 linhas distintas continua **aceito** (não-regressão).
- [ ] Carrinho de 1 item continua aceito (não-regressão).
- [ ] `buscarProdutosPorIds` recebe lista de `produto_id` deduplicada.
- [ ] Recálculo de subtotal/snapshot inalterado (itens repetidos ainda geram linha por item).
- [ ] Suíte completa verde; `next build` limpo.

## Fora do escopo
- Núcleo de subpagamento (resistiu — não reabrir).
- `bodySizeLimit` menor, rate limit mais agressivo, WAF (infra, roadmap).
- Teto em outros arrays do app (varredura separada).
- Residual `faixa_cep` → issue 147.

## Plano Técnico

> Fix pontual de contenção de recurso (CWE-770 / OWASP A05). Duas linhas de código de produção, ambas espelhando padrão JÁ presente no próprio arquivo. Nenhuma migration, nenhuma RLS, nenhuma mudança de contrato de dados, nenhum recálculo de valor tocado. TDD red-first — o vermelho já existe.

### Análise do Codebase

**Confirmação dos números de linha e nomes (lidos em 2026-07-09, ainda válidos):**

O que já existe e será reusado (padrão a espelhar, NÃO reinventar):
- `src/lib/validacoes/pedido.ts:55` — `itens: z.array(schemaItemPedido).min(1)`. É exatamente esta linha, sem `.max()`. A raiz `schemaPayloadPedido` já é `.strict()` (linha 89) e o `.refine` condicional de endereço vem depois (92-95) — o `.max()` entra encadeado no `z.array(...)`, antes ou depois do `.min(1)`, sem tocar `.strict()`/`.refine`.
- `src/lib/validacoes/pedido.ts:32` — `.max(50)` já aplicado em `schemaItemPedido.opcionais` (achado 085). **É o padrão a espelhar** para o array raiz. Também há `.max(99)` em `quantidade` (linhas 18 e 28). Não existe nem é necessário helper de teto: `z.array(...).max(N)` é o idioma do arquivo.
- `src/lib/actions/pedido.ts:93` — `const ids = dados.itens.map((i) => i.produto_id);` **sem** `[...new Set(...)]`. Confirmado.
- `src/lib/actions/pedido.ts:100-104` — `opcionalIds` já usa `[...new Set(dados.itens.flatMap(...))]`. **Padrão de dedupe a espelhar.**
- `src/lib/actions/pedido.ts:108-114` — `categoriaIds` já usa `[...new Set(...)]`. Segundo exemplo do mesmo padrão no mesmo arquivo.
- `src/lib/supabase/queries/produtos.ts:125-133` — `buscarProdutosPorIds(client, ids: string[])` monta `.in("id", ids)` direto do array recebido. Assinatura `ids: string[]` — `[...new Set(ids)]` produz o mesmo tipo, **sem mudança de assinatura**. Guard `ids.length === 0` já existe.
- `src/lib/utils/calcularTotal.ts` — `calcularSubtotal(itens)` itera `dados.itens` (com repetições) e o loop de recálculo em `pedido.ts:136-190` resolve cada `item.produto_id` via `porId.get(...)` (Map). **Prova de que o dedupe é seguro:** o Map indexa por `id`; linhas duplicadas na query trariam registros idênticos, então deduplicar a *busca* não altera o conteúdo do Map. O loop continua iterando cada linha do carrinho → snapshot e subtotal preservados byte-a-byte. O dedupe só encolhe a URL/`.in()` do PostgREST.

Nada novo a criar: sem arquivo novo, sem util novo, sem query nova, sem schema zod novo. Ambas as mudanças são reuso literal de padrão local.

### Cenários

**Caminho Feliz (não-regressão — não pode quebrar):**
1. Cliente envia carrinho de 1 item → `.safeParse` aceita (`.min(1)` intacto, ≤ N) → recálculo autoritativo segue igual.
2. Cliente envia carrinho realista de 30 linhas distintas → aceito (30 ≤ N).
3. Cliente envia carrinho com `produto_id` repetido legítimo (ex.: mesma pizza em 2 linhas com opcionais diferentes) → `ids` deduplicado na *busca*, mas o loop ainda gera uma linha por item; subtotal/snapshot idênticos ao comportamento atual.

**Ataque neutralizado:**
4. Atacante envia 50.000 itens → `.safeParse` **rejeita na fronteira**, antes de qualquer I/O (`criarPedido` retorna `ERRO_GENERICO` no ramo `!parsed.success`, linha 60-62). Nenhuma query, nenhuma RPC.
5. Atacante envia 1.000 itens → idem, rejeitado.
6. Atacante envia N itens (dentro do teto) com `produto_id` repetido para inflar a URL PostgREST → `[...new Set(ids)]` colapsa para os ids distintos; `.in()` fica pequeno. Camada de redução de amplificação complementar ao teto.

**Casos de Borda:**
- Payload vazio / `itens: []` → já barrado por `.min(1)` (inalterado).
- `itens` exatamente no limite N → aceito (teste do RED usa 30 < N e 1.000/50.000 > N; a fronteira exata N/N+1 não é asserida — escolher N com folga sobre o caminho feliz cobre isso sem fragilidade).
- Loja inativa / fechada / assinatura vencida / produto indisponível → fluxo de recusa existente intacto (não tocado por este fix).

**Tratamento de Erros:** rejeição de cardinalidade cai no `!parsed.success → return { erro: ERRO_GENERICO }` (linha 61) — mensagem genérica ao cliente, sem vazar que o motivo foi o teto (`seguranca.md §14`). Nenhum log novo necessário; o payload hostil nem chega a I/O.

### Schema de Banco

Não se aplica. **Sem migration, sem coluna, sem tabela, sem RLS.** O `.max(N)` é estreitamento de validação de entrada, compatível com todo payload legítimo existente. Contrato de dados (`schemaPayloadPedido`, RPC `public.criar_pedido`, tabelas `pedidos`/`itens_pedido`/`itens_pedido_opcionais`) inalterado. `schema.md` não muda.

### Validação (zod)

Schema único já existente: `schemaPayloadPedido` em `src/lib/validacoes/pedido.ts`, reusado no form do checkout (UX) e na Server Action `criarPedido` (segurança). A mudança é **uma** adição: `.max(N)` no `z.array(schemaItemPedido)` do campo `itens` (linha 55). O mesmo schema continua sendo a fronteira única — nenhum schema paralelo.

### Recálculo no Servidor

Nenhuma mudança no eixo de valor. Este fix **não toca** o recálculo autoritativo — o pentest confirmou que o núcleo de subpagamento resiste. O cliente continua enviando só `produto_id` + `quantidade` (+ opcionais, endereço, forma de pagamento, cupom); o servidor continua recalculando `preco/subtotal/desconto/taxa_entrega/total` do banco. O `.max()` limita apenas o **volume** de itens; o dedupe encolhe apenas a **busca** de produtos. `calcularSubtotal` / `calcularTotal` / `itensSnapshot` / RPC inalterados.

### Camada onde cada invariante é garantida (cliente ↔ servidor)

| Invariante | Camada |
|-----------|--------|
| Teto de cardinalidade do array `itens` (`.max(N)`) | **Server Action** — schema zod validado em `criarPedido` (linha 59) antes de qualquer I/O. Rejeita na fronteira. |
| Dedupe de `produto_id` antes do `.in()` PostgREST | **Server Action** — `[...new Set(ids)]` em `criarPedido` (linha 93). Redução de amplificação. |
| `.min(1)` e recálculo de valor preservados | **Server Action** — inalterados. |

Não há caminho de cliente (`'use client'`) envolvido: ambas as invariantes são de servidor. O RED trava a regressão de `.max()`.

### Valor de N — DECISÃO DE NEGÓCIO (não decidir sozinho)

`N` é **decisão de produto/negócio**, não de engenharia. O teste RED sugere `100` e os asserts o comprovam suficiente (aceita 30, rejeita 1.000). **Recomendação técnica:** `100`. Justificativa — um carrinho real de delivery jamais tem 100 *linhas distintas*; 100 dá folga confortável de 3x+ sobre o carrinho realista de 30 do teste, com margem para o maior cardápio plausível, e mantém o loop de recálculo + RPC em ordem de grandeza trivial. Confirmar com o negócio antes de fechar a issue; qualquer N em `[100, ~250]` satisfaz o RED e o critério de aceite. **Não fixar N acima de alguns milhares** — anularia a contenção.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:** nenhum.

**Modificar:**
- `src/lib/validacoes/pedido.ts` (linha 55) — adicionar `.max(N)` ao `z.array(schemaItemPedido)` do campo `itens`, espelhando o `.max(50)` da linha 32. Comentário curto citando CWE-770 / achado 085. **É a mudança GREEN que faz o RED passar.**
- `src/lib/actions/pedido.ts` (linha 93) — trocar `const ids = dados.itens.map((i) => i.produto_id);` por `const ids = [...new Set(dados.itens.map((i) => i.produto_id))];`, espelhando `opcionalIds` (100-104) / `categoriaIds` (108-114). Complementar ao teto (não coberto por teste unitário direto; sua correção é observável na URL da query — o valor de subtotal/snapshot não muda por construção).

**NÃO tocar:**
- `src/lib/validacoes/pedido.itens-cap.test.ts` — o RED já existe. Referenciar, rodar, ver passar. **Não escrever outro teste.**
- Recálculo autoritativo (`calcularSubtotal`, `calcularTotal`, loop 136-190, RPC 290-329) — núcleo de valor intacto (fora do escopo, resistiu ao pentest).
- Comentário `faixa_cep` (linhas 220-221) e `references/seguranca.md §10-A` — Achado 2 do spec, **não-crítico, delegado ao `escriba`** em issue/passo separado (issue 147). Fora do escopo do fix crítico 146.
- `buscarProdutosPorIds` — assinatura `ids: string[]` já aceita o array deduplicado; sem mudança.
- `next.config` (`bodySizeLimit`), rate limit, WAF — infra, fora do escopo.

### Dependências Externas

Nenhuma. `zod` já é dependência (`z.array().max()` é API estável). Sem novo pacote, sem nova API.

### Ordem de Implementação (crítica — RED antes do código de produção)

1. **RED (já existe):** rodar `npx vitest run src/lib/validacoes/pedido.itens-cap.test.ts` e confirmar o vermelho real — hoje 2 asserts de ataque falham (`expected true to be false` para 50k e 1k) e 2 de não-regressão passam. **Vermelho confirmado em 2026-07-09.**
2. **GREEN — `.max(N)`:** adicionar `.max(N)` (N = decisão de negócio, recomendado 100) em `pedido.ts:55`. Rodar o teste de novo → os 4 asserts passam (2 ataques rejeitados, 2 não-regressões preservadas).
3. **Dedupe:** aplicar `[...new Set(...)]` em `pedido.ts:93` (actions). Não altera nenhum assert do RED; valida por construção (Map por id) + suíte de pedido existente.
4. **Suíte completa:** rodar toda a suíte de validação/actions de pedido para garantir não-regressão do recálculo (subtotal/snapshot/total).
5. **`next build`** limpo (memória: `use-server` só exporta funções async; `criarPedido` já é async — checar mesmo assim) + `tsc --noEmit` (CI cobre testes).

### Riscos

- **Baixo — escolher N pequeno demais** barra um cardápio real grande. Mitigado por N ≥ 100 (folga 3x+ sobre o caminho feliz do teste). É reversível (só um número no schema).
- **Nenhum risco de valor:** o dedupe é matematicamente neutro para subtotal/snapshot (prova: Map por id). Se algum teste de valor quebrar, é sinal de regressão a investigar, não do dedupe.
- **Sem risco de contrato/migração/RLS** — nada disso é tocado.
