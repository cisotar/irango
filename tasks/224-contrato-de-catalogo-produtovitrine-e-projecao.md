# [224] Contrato de catálogo: `ProdutoVitrine` + `projetarProdutoVitrine` no SSR

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [223] (`tasks/223-preco-efetivo-e-vigencia.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D1, D13 · RN-15, RN-19
**Fatia crítica:** 2 (contrato de catálogo `projetarProdutoVitrine` + correção do D13) — a metade do contrato

## Objetivo

Substituir o `ProdutoCatalogo` de `SecaoCatalogo.tsx` e a projeção inline da página da
loja por **um** objeto produzido no servidor, com todos os campos obrigatórios. Este
contrato é o insumo do Spec B; depois de mergeado ele não deve precisar ser reaberto.

## Escopo

- [ ] criar `src/lib/utils/catalogoVitrine.ts` (módulo neutro, importável por Server
      Component, Server Action e componente client) com o tipo `ProdutoVitrine` **exatamente**
      como §Contrato de catálogo o declara: `id`, `nome`, `descricao`, `foto_url`,
      `categoria_id`, `preco`, `precoEfetivo`, `temDesconto`, `seloDesconto`, `descontoFim`,
      `compravel`, `motivoNaoCompravel`;
- [ ] `export type MotivoNaoCompravel = "esgotado"` — union de **um** membro em v1;
- [ ] `projetarProdutoVitrine(produto, agora)` — pura, `agora` injetado, chamando `precoEfetivo`;
- [ ] em v1: `compravel === disponivel` e `motivoNaoCompravel === disponivel ? null : "esgotado"`;
- [ ] `src/app/(publica)/loja/[slug]/page.tsx` passa a projetar o catálogo por esta função
      (`buscarProdutosPublicos` → `projetarProdutoVitrine`), substituindo `categoriasComProdutos`;
- [ ] "pratos promocionais" é derivado: `produtos.filter(p => p.temDesconto)` sobre o catálogo
      **que a página já carregou** — zero query nova, zero tabela nova (RN-15);
- [ ] teste ao lado do módulo: todo campo presente e não-opcional;
      `temDesconto ⇔ precoEfetivo < preco`; `compravel`/`motivoNaoCompravel` corretos;
      e as colunas cruas (`desconto_tipo`, `desconto_valor`, `desconto_inicio`,
      `desconto_fim`, `desconto_ativo`) **ausentes** do objeto projetado.

## Fora de escopo

A troca de props das quatro superfícies e a correção do beco sem saída de `disponivel`
(issue 225) — aqui só nasce o contrato e o produtor. Nada de `PrecoProduto`/`SeloDesconto`
(issue 232). **Nenhum campo opcional por conveniência** e nenhum default silencioso: campo
ausente vira `undefined` no cliente e produz "R$ NaN" ou pior.
**Nenhum `revalidate`, `'use cache'` ou ISR** — a vitrine é dado vivo por decisão
documentada (`page.tsx:30–42`); catálogo cacheado serve promoção expirada. Custo do filtro
de vigência é nota para o `acelerar`, **depois** do `executar`.
O membro `"fora_da_janela"` e os dois parâmetros extras de `projetarProdutoVitrine` são do
Spec B — esta issue implementa a versão de 2 parâmetros e **não** antecipa a de 4.

## Reuso esperado

- `src/lib/utils/precoEfetivo.ts` (issue 223) — reusar, não recriar a regra de desconto.
- `src/lib/supabase/queries/produtos.ts::buscarProdutosPublicos` — já filtra
  `.eq("oculto", false)`; `oculto` continua ganhando de tudo e nem vira `ProdutoVitrine`.
- `src/lib/supabase/queries/produtos.ts::buscarProdutosPorIds` — continua `select("*")`, já
  traz as colunas novas e **não** ganha filtro de vigência: o recálculo autoritativo precisa
  enxergar preço cheio e configuração para decidir sozinho.
- `agruparCatalogo` — generalização de tipo só; a suíte atual passa sem edição.

## Segurança

- As colunas cruas de desconto **não trafegam** para o cliente (regra 6 do contrato) —
  mesmo princípio da issue 201 sobre `foto_url`: o que a UI não precisa, o payload RSC não carrega.
- Todo número monetário do objeto é autoritativo **na origem**; o que o cliente faz com ele
  depois é preview (`seguranca.md` §10).
- `produtos_leitura_publica` passa a devolver também as colunas de desconto ao `anon` — é
  aceitável (preço promocional é informação pública da vitrine), mas a **projeção continua
  obrigatória**.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde (fatia crítica 2), com o `FAIL` capturado;
- [ ] nenhum campo do contrato é opcional — `grep -rn "?:" ` no tipo não devolve campo de contrato;
- [ ] as cinco colunas cruas de desconto não aparecem no objeto projetado;
- [ ] a página da loja continua sem cache e sem query nova para "pratos promocionais";
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
