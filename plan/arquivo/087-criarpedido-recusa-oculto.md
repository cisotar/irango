## Plano Técnico

### Análise do Codebase
O que já existe e será reusado (nenhum arquivo/função nova — é extensão de uma condição existente):
- `src/lib/actions/pedido.ts` (~linhas 136-144) — laço `for (const item of dados.itens)` com a guarda de recusa por item. Hoje: `produto == null || !produto.disponivel || produto.loja_id !== dados.loja_id`. Será acrescido de `|| produto.oculto === true`. É a mesma guarda que já recusa item indisponível/cross-loja/inexistente, e já retorna `{ erro: ERRO_GENERICO }` recusando o PEDIDO INTEIRO antes de chamar a RPC `criar_pedido`. Nenhuma nova recusa/estrutura.
- `src/lib/supabase/queries/produtos.ts` → `buscarProdutosPorIds` (linha 119-127) — já faz `select("*")`, logo já traz a coluna `oculto`. NENHUMA query nova, nenhum select alterado. O comentário da query ("NÃO filtra por disponivel — o recálculo precisa enxergar o indisponível para recusá-lo") vale igual para `oculto`.
- `src/lib/database.types.ts` — `produtos.Row.oculto: boolean` (linha 695) já existe; `porId.get(item.produto_id)` já é tipado como `Tables<"produtos">`, então `produto.oculto` compila sem cast.
- `ERRO_GENERICO` (pedido.ts linha 47) — mensagem genérica reusada; nada de detalhe ao cliente (`seguranca.md §14`).

Nada de lib externa, migration ou RLS nova. A defesa aqui é lógica de aplicação na Server Action.

### Cenários
**Caminho Feliz:** produto `disponivel=true, oculto=false` da loja correta → passa na guarda, segue para frete/cupom/total e RPC. Idêntico ao de hoje.

**Casos de Borda:**
- Produto `oculto=true, disponivel=true`, loja correta (o vetor): antes passava; agora `produto.oculto === true` dispara → `return { erro: ERRO_GENERICO }`, RPC não chamada.
- Produto `oculto=true, disponivel=false`: já recusado hoje por `!disponivel`; continua recusado (curto-circuito `||`).
- Produto `disponivel=false, oculto=false`: recusa preexistente preservada.
- Produto de outra loja / inexistente: recusa preexistente preservada.
- Carrinho misto (1 normal + 1 oculto): guarda por item → primeiro oculto recusa o PEDIDO INTEIRO (semântica atual de cross-loja/indisponível).

**Tratamento de Erros:** recusa devolve `ERRO_GENERICO` — não revela ao cliente que o motivo foi "produto oculto" (não vaza estado escondido pelo lojista). Sem `console.error` adicional (é recusa de regra de negócio, igual às cláusulas irmãs). `seguranca.md §14`.

### Schema de Banco
Não toca schema. `oculto` já existe em `produtos` (issue 084). Sem migration, sem seed novo.

### Validação (zod)
Não muda. O payload não carrega `oculto` (atributo do produto, lido do banco). `schemaPayloadPedido.strict()` segue barrando campos extras. Defesa é 100% recálculo autoritativo server-side.

### Recálculo no Servidor (regra de integridade)
| Invariante | Camada que garante |
|-----------|--------------------|
| Não comprar produto oculto (escondido da vitrine) | **Server Action `criarPedido`** — `produto.oculto` lido do banco via `buscarProdutosPorIds`; cliente ignorado; recusa antes da RPC. |

Cliente envia só `produto_id + quantidade`. Servidor lê `oculto/disponivel/loja_id/preco` REAIS e decide. Não é subpagamento (preço já é recalculado), é integridade. Enforcement na Server Action (não RLS), coerente com as guardas irmãs de `disponivel`/`loja_id` — a RPC roda com service_role e não reavalia visibilidade, então a action é a única fronteira. Decisão consciente: visibilidade de produto no fluxo de pedido é da action.

### Arquivos a Criar / Modificar / NÃO tocar
- MODIFICAR `src/lib/actions/pedido.ts` — condição da guarda de item (uma linha). Diff exato:

```diff
       const produto = porId.get(item.produto_id);
       if (
         produto == null ||
         !produto.disponivel ||
+        produto.oculto === true ||
         produto.loja_id !== dados.loja_id
       ) {
         return { erro: ERRO_GENERICO };
       }
```

  (Sugestão: citar "oculto" no comentário do passo (4), linha 92.)
- MODIFICAR `src/lib/actions/pedido.test.ts` — testes RED (contrato abaixo). Fixture `produtoRow` já expõe `oculto` (default `false`) → `produtoRow({ oculto: true })`.
- NÃO tocar: `buscarProdutosPorIds`, schema zod, migrations, RLS, RPC `criar_pedido`, UI da vitrine.

### Contrato do Teste RED (fase `tdd`, antes do GREEN)
Adicionar ao `describe("criarPedido (Server Action — recálculo autoritativo §10)")`, junto dos testes de "produto indisponível / outra loja":

1. RED principal — produto oculto forjado é recusado:
   ```
   it("[087] ATAQUE: produto oculto=true (disponível) forjado no payload → recusado (não chama a RPC)", ...)
     buscarLojaParaPedido → lojaRow()
     listarFormasPagamento → formasComPix()
     listarZonasComTaxas → zonasComFrete5()
     buscarCupomPorCodigo → null
     buscarProdutosPorIds → [produtoRow({ oculto: true, disponivel: true })]
     r = await criarPedido(payloadBase({ itens: [{ produto_id: PROD_1, quantidade: 1 }] }))
     expect(r).toEqual({ erro: expect.any(String) })
     expect(fakeClient.rpc).not.toHaveBeenCalled()
   ```
   Falha hoje (action chama a RPC e cria o pedido — só checa `disponivel`).

2. Preservação — produto disponível/NÃO-oculto continua criando pedido:
   ```
   it("[087] produto disponivel=true, oculto=false da loja correta → cria pedido normalmente", ...)
     cenarioFeliz()  // produtoRow() já é oculto:false, disponivel:true
     r = await criarPedido(payloadBase())
     expect(r).toEqual({ pedidoId: "ped-1", token_acesso: "tok-1" })
   ```
   (Critério de aceite 3; passa hoje e deve continuar — guarda de não-regressão.)

O teste preexistente "produto indisponível → recusado" (`produtoRow({ disponivel: false })`) cobre o critério 2; opcionalmente reforçar com `disponivel: false, oculto: false` explícito.

### Dependências Externas
Nenhuma.

### Ordem de Implementação
Issue CRÍTICA (integridade do pedido) → RED-first:
1. `/tdd` (RED): adicionar os dois testes em `pedido.test.ts`; `npx vitest run src/lib/actions/pedido.test.ts` e confirmar que [087] ATAQUE FALHA (RPC chamada) e o de preservação passa.
2. `/execute` (GREEN): adicionar `produto.oculto === true ||` à guarda; suíte verde, incluindo testes preexistentes de `disponivel`/cross-loja/opcionais.
3. `next build` antes de fechar (valida tipos; superfície de export inalterada).
