# Spec: Hardening do checkout — teto de cardinalidade do array `itens` + residual de `faixa_cep`

**Versão:** 0.1.0 | **Atualizado:** 2026-07-09

> Origem: pentest 2026-07-09, vetor "Recálculo de valor no servidor" do checkout. O **núcleo** (subpagamento — o cliente forjar `total`/`preco`/`desconto`/`taxa_entrega`) **resistiu** e NÃO é objeto deste spec. Cobrimos os dois achados **residuais**: um de abuso de recursos (DoS) e um de documentação imprecisa.

## Visão Geral

O checkout do iRango já garante que o cliente nunca define quanto paga (recálculo autoritativo em `criarPedido` + RPC `public.criar_pedido`). O pentest, porém, encontrou dois resíduos **fora** do eixo de valor:

1. **[MÉDIA] Array `itens` sem teto (OWASP A05 / CWE-770).** O array raiz `itens` do payload de pedido valida só `.min(1)` — não tem `.max()`. Um cliente pode enviar dezenas de milhares de itens (com `bodySizeLimit: "2mb"`, ~33 mil itens/requisição), e a lista de `ids` derivada NÃO é deduplicada (ao contrário de `opcionalIds`/`categoriaIds`). Resultado: query/URL PostgREST gigante, loop de recálculo e RPC (`FOR ... jsonb_array_elements` + 1 INSERT por item) com dezenas de milhares de iterações numa única transação → exaustão de CPU/memória/tempo e amplificação de storage. **Não é subpagamento** — o recálculo de valor resiste; é DoS/abuso de recursos.

2. **[BAIXA/informacional] Comentário superestima a defesa de `faixa_cep`.** Um comentário em `criarPedido` afirma que zonas de frete `tipo='faixa_cep'` são "já reconciliadas por natureza". É impreciso: o CEP É controlado pelo cliente e não há fonte mais canônica para reconciliá-lo server-side. É risco residual inerente (não defeito de código), mas o comentário passa falsa sensação de imunidade.

**Mundo:** ambos vivem no servidor — o checkout Server Action `criarPedido` (`src/lib/actions/pedido.ts`) e seu schema de entrada (`src/lib/validacoes/pedido.ts`). Nenhuma página nova, nenhuma rota nova, nenhuma UI. Nenhuma migration, nenhuma RLS, nenhuma mudança de contrato de dados.

## Atores Envolvidos

- **iRango (SaaS):** dono da superfície de recurso (banco, RPC, transação). É quem sofre o abuso — CPU/memória/storage do tenant compartilhado.
- **Cliente (atacante):** origem do payload hostil. Controla o corpo do POST do pedido (via DevTools/script) — quantidade de itens e CEP declarado.
- **Lojista:** vítima indireta (loja fica lenta/indisponível; storage poluído com pedido de dezenas de milhares de linhas). Não age nesta feature.

## Páginas e Rotas

> Feature de hardening server-side — não há página nova. Os "alvos" abaixo são os pontos de código onde o trabalho acontece; os behaviors são as **ações do atacante** que a mudança precisa neutralizar (e os caminhos felizes que não pode quebrar).

### Alvo A — Schema de entrada do pedido — `src/lib/validacoes/pedido.ts`
**Mundo:** servidor (fronteira de validação do checkout, sem auth — cliente anônimo)
**Descrição:** o schema `schemaPayloadPedido` é a fronteira zod que todo payload de pedido cruza antes de qualquer I/O. Hoje `itens: z.array(schemaItemPedido).min(1)` — sem teto de cardinalidade.

**Componentes / reuso:**
- `z.array(...).max(N)` — mesmo padrão já usado em `schemaItemPedido.opcionais` (`.max(50)`, achado 085). Reusar, não inventar helper novo.

**Behaviors:**
- [ ] Atacante envia payload com 50.000 itens idênticos. Hoje passa o `.safeParse`. Deve ser **rejeitado na entrada** (antes de qualquer I/O). Garantido em: **Server Action** (schema zod validado no servidor em `criarPedido`, antes do rate-limit-liberado seguir para I/O).
- [ ] Atacante envia payload com 1.000 itens. Deve ser rejeitado. Garantido em: **Server Action** (schema zod).
- [ ] Cliente legítimo envia carrinho de 30 linhas distintas. Deve continuar **aceito** (não-regressão). Garantido em: **Server Action** (schema zod — teto acima do caminho feliz).
- [ ] Cliente legítimo envia 1 item (mínimo). Deve continuar aceito (não-regressão). Garantido em: **Server Action** (schema zod, `.min(1)` intacto).

### Alvo B — Orquestrador autoritativo `criarPedido` — `src/lib/actions/pedido.ts`
**Mundo:** servidor (Server Action de checkout, cliente anônimo)
**Descrição:** por volta da linha 93, `const ids = dados.itens.map((i) => i.produto_id)` alimenta `buscarProdutosPorIds` (`.in("id", ids)` do PostgREST). A lista NÃO é deduplicada, ao contrário de `opcionalIds` (linhas 100-104) e `categoriaIds` (108-114), que já usam `[...new Set(...)]`. Por volta das linhas 220-221, um comentário sobre `faixa_cep` superestima a reconciliação.

**Componentes / reuso:**
- `[...new Set(...)]` — padrão de dedupe **já presente no próprio arquivo** para `opcionalIds` e `categoriaIds`. Espelhar, não criar util.

**Behaviors:**
- [ ] Atacante envia N itens com `produto_id` repetido. Hoje a query PostgREST recebe N ids repetidos (URL/`.in()` gigante). Deve receber a lista **deduplicada**. Garantido em: **Server Action** (dedupe `[...new Set(ids)]` antes do `buscarProdutosPorIds`). Nota: a defesa primária de cardinalidade é o `.max()` do Alvo A; o dedupe é redução de amplificação complementar (reduz o tamanho da query mesmo dentro do teto).
- [ ] Cálculo de subtotal/snapshot continua correto com ids deduplicados. O loop de recálculo itera sobre `dados.itens` (com repetições preservadas para quantidade/snapshot); só a **busca** de produtos é deduplicada — o `Map porId` já resolve cada `produto_id` por lookup, então repetição no carrinho continua gerando linha por item. Garantido em: **Server Action** (recálculo autoritativo intacto — não muda contrato nem valor).
- [ ] (Doc) Comentário de `faixa_cep` (linhas ~220-221) deve deixar explícito que zona `tipo='faixa_cep'` **não** é imune: o CEP é declarado pelo cliente e não há fonte canônica para reconciliá-lo server-side; o risco é residual e mitigado só operacionalmente. Garantido em: **documentação** (comentário no código + registro em `references/seguranca.md` §10-A). Sem efeito de runtime.

---

## Modelos de Dados

Nenhuma tabela afetada. **Sem migration, sem coluna nova, sem RLS nova.** O contrato de dados do pedido (`schemaPayloadPedido`, RPC `public.criar_pedido`, tabelas `pedidos`/`itens_pedido`/`itens_pedido_opcionais`) permanece idêntico. O `.max()` é um estreitamento de validação de entrada, compatível com todo payload legítimo existente (`schema.md` inalterado).

## Regras de Negócio

| Regra | Camada onde é garantida |
|-------|------------------------|
| **RN-1** — O array `itens` tem teto de cardinalidade (`.max(N)`). Um carrinho real jamais tem N linhas distintas. **O número final N é decisão de produto/negócio** — o teste RED sugere `100`; confirmar com o negócio antes de fechar. | **Server Action** (schema zod `.strict()` validado em `criarPedido`, antes de qualquer I/O). O teste RED trava a regressão. |
| **RN-2** — A lista de `produto_id` passada ao PostgREST é deduplicada antes do `.in()`. | **Server Action** (`[...new Set(ids)]` espelhando `opcionalIds`/`categoriaIds`). |
| **RN-3** — O teto NÃO barra o caminho feliz: carrinhos realistas (≤ dezenas de linhas) e o mínimo de 1 item continuam aceitos. `.min(1)` preservado. | **Server Action** (schema zod). |
| **RN-4** — Frete por zona `tipo='faixa_cep'` carrega risco residual de CEP declarado (o cliente pode declarar um CEP da faixa mais barata); mitigável só operacionalmente, não server-side. Documentar como residual, sem alegar imunidade. | **Documentação** (comentário + `seguranca.md` §10-A). Não há camada técnica que feche este vetor — é risco inerente aceito. |

**Nota de defesa em profundidade:** o rate limit ~10/min por IP (issue 052, §12) já existe no topo de `criarPedido`, mas sozinho ainda deixa volume de abuso relevante (10 payloads de 33 mil itens/min por IP). O `.max()` é a trava real de cardinalidade; rate limit e dedupe são camadas complementares.

## Segurança (obrigatório)

- **Dado sensível que entra/sai?** Não muda. O payload de pedido segue com PII do comprador (nome/telefone/endereço) já governada pelas regras existentes (§10, §20). Esta mudança só restringe a **quantidade** de itens e deduplica ids — não toca PII.
- **Valor monetário?** Sim, mas **fora do escopo do fix**. O recálculo autoritativo (`criarPedido` recalcula preço/subtotal/desconto/taxa/total do banco) **já resiste** e permanece intacto — o pentest confirmou. Nenhuma linha de recálculo muda. O `.max()` e o dedupe não alteram como o valor é computado; apenas limitam o volume de itens processados.
- **Tabela nova?** Não. Nenhuma RLS nova.
- **API externa com key?** Não. (ViaCEP, usado na reconciliação de bairro, permanece como está.)
- **Superfície de abuso de recurso (CWE-770):** este É o ponto crítico. O fix fecha a alocação de recursos sem limite: teto de cardinalidade na fronteira (rejeita antes de I/O) + dedupe (reduz amplificação da query/URL PostgREST). Recálculo no servidor **não** é o que está em jogo aqui — é contenção de recurso.
- **Residual aceito (`faixa_cep`):** documentado, não fechável server-side. Sem prova server-side de que um CEP é "o real do cliente", zonas `faixa_cep` mais baratas na mesma loja carregam risco de CEP declarado. Mitigação é operacional (a loja modela zonas com cautela). O comentário atual precisa parar de alegar imunidade.

## Implementação — criticidade e delegação

- **Achado 1 (Alvos A + B) — IMPLEMENTAÇÃO CRÍTICA, TDD red-first.** Superfície de abuso de recurso.
  - **Vermelho já existe:** `src/lib/validacoes/pedido.itens-cap.test.ts`. Hoje **2 asserts de ataque falham** (schema aceita 50k e 1k itens — `expect(r.success).toBe(false)` falha) e **2 de não-regressão passam** (30 e 1 item aceitos). A implementação GREEN é adicionar `.max(N)` ao array raiz `itens` até os 4 asserts passarem, **sem** quebrar os de não-regressão. Não escrever novo teste antes de rodar este e ver o vermelho real.
  - O dedupe de `ids` (Alvo B) é a mesma issue — complementa o teto reduzindo a amplificação da query. Espelhar `[...new Set(...)]` já usado no arquivo.
- **Achado 2 (Alvo B, comentário `faixa_cep`) — NÃO-CRÍTICO, delegável ao `escriba`.** Trabalho de documentação/comentário: ajustar o comentário nas linhas ~220-221 de `src/lib/actions/pedido.ts` e registrar o residual em `references/seguranca.md` §10-A (frete por `faixa_cep` carrega risco de CEP declarado, mitigado só operacionalmente). Sem teste, sem runtime.

## Arquivos load-bearing

- `src/lib/validacoes/pedido.ts` — linha 55, `itens: z.array(schemaItemPedido).min(1)` → adicionar `.max(N)`. Padrão `.max(50)` já na linha 32.
- `src/lib/actions/pedido.ts` — linha ~93, dedupe de `ids`; padrão `[...new Set(...)]` nas linhas 100-104 e 108-114. Comentário `faixa_cep` nas linhas ~220-221.
- `src/lib/validacoes/pedido.itens-cap.test.ts` — teste RED existente (referência de aceite do Achado 1).
- `references/seguranca.md` §10-A (linha ~746) — onde registrar o residual do Achado 2.

## Fora do Escopo (v1)

- **Núcleo de subpagamento** — resistiu ao pentest, não é reaberto. Nenhuma mudança no recálculo autoritativo de valor.
- **Fechar o residual de `faixa_cep` tecnicamente** — não há defesa server-side possível (não se prova qual é "o CEP real do cliente"). Só documentação. Qualquer mitigação operacional (guia ao lojista para modelar zonas) é orientação de produto, não código.
- **Rate limit mais agressivo / WAF / bloqueio por corpo** — o rate limit ~10/min por IP já existe; ajuste de política de rate limit e migração para Cloudflare WAF são item de infra (§5, roadmap), fora daqui.
- **`bodySizeLimit` menor no `next.config`** — reduzir o limite de corpo do Server Action ajudaria, mas é decisão de infra com impacto em uploads/outros payloads; não faz parte deste fix pontual.
- **Teto de cardinalidade em outros arrays/payloads do app** — este spec cobre só `itens` do pedido. Uma varredura de `z.array(...)` sem `.max()` em outras Server Actions é trabalho separado.
