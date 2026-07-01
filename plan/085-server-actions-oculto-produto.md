## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (não recriar):**
- `src/lib/actions/produto.ts` — `alternarDisponibilidade(id, disponivel)` (linhas 159-180) é o MOLDE EXATO de `alternarOculto`: `createClient()` autenticado, `.from("produtos").update({...}).eq("id", id)`, erro genérico (`console.error` + mensagem sem `e.message`), `revalidatePath(CAMINHO_PAINEL)`. Copiar trocando `disponivel` por `oculto`.
- `src/lib/actions/produto.ts` — `criarProduto`/`atualizarProduto` (49-138): já espalham `...parsed.data` no insert/update. Como `oculto` entra em `schemaProduto`, ele flui AUTOMATICAMENTE via spread — **nenhuma linha nova de código nas duas actions**, basta o schema aceitar o campo. `loja_id` continua derivado de `buscarLojaDoDono` (nunca do payload).
- `ResultadoGestaoProduto` — tipo de retorno reusado como-está.
- `CAMINHO_PAINEL = "/painel/cardapio"` — reusado no `revalidatePath`.
- `schemaProduto` em `src/lib/validacoes/produto.ts` — estender com `oculto` ao lado de `disponivel` (linha 26). NÃO duplicar schema.
- `src/lib/database.types.ts` (issue 084) — `produtos.Insert/Update.oculto?: boolean` já existe; nenhuma regeneração de tipos.
- Migration 083 (`20260621099000_produtos_oculto_rls_publica.sql`) — coluna + RLS já aplicadas. `produtos_escrita_propria` (dono_id = auth.uid()) INTOCADA: é ela que isola a escrita por dono. **Nenhuma migration nesta issue.**

**Nada de lib madura envolvido** (sem máscara/moeda/slug/CEP). Só boolean.

### Decisão de contrato: `oculto` obrigatório (z.boolean()), não opcional
O prompt cogitou "opcional default false", mas o critério de aceite da issue exige "schemaProduto rejeita payload sem `oculto`". Para espelhar `disponivel` (que é `z.boolean()` obrigatório) e manter a validação isomórfica coerente, `oculto` é **`z.boolean()` obrigatório**. O DEFAULT false vive no banco (RN-7, retrocompat de linhas antigas), não no schema — o form sempre envia o valor explícito (como faz com `disponivel`).

### Cenários

**Caminho Feliz (`alternarOculto`):**
1. Lojista clica no toggle de visibilidade de um produto SEU.
2. `alternarOculto(id, true)` → `createClient()` autenticado.
3. `update({ oculto: true }).eq("id", id)`.
4. RLS `produtos_escrita_propria` confirma `dono_id = auth.uid()` → 1 linha afetada.
5. `revalidatePath("/painel/cardapio")` → `{ ok: true }`.

**Caminho Feliz (`criarProduto`/`atualizarProduto` com `oculto`):**
1. Form envia payload com `oculto` (true/false) junto de nome/preco/etc.
2. `schemaProduto` valida (agora aceita `oculto`).
3. `...parsed.data` no insert/update grava `oculto` — persiste `oculto=true` quando enviado.

**Casos de Borda:**
- **Produto de OUTRA loja:** `update().eq("id", idAlheio)` sob RLS retorna 0 linhas afetadas, `error == null` → `{ ok: true }` porém SEM mutar a linha (RLS silenciosa em UPDATE). O teste RED assere via mock que o cliente é o AUTENTICADO e a chamada é escopada por `id` (isolamento é do banco, não do código) — ver contrato de teste abaixo.
- **`oculto` ausente no payload de create/update:** `schemaProduto.safeParse` falha → `{ ok:false, erro:"Produto inválido." }`, sem tocar o banco.
- **`oculto` não-boolean ("sim", 1):** rejeitado pelo schema, sem I/O.
- **Erro de banco:** `console.error("[alternarOculto]", error)` no servidor; cliente recebe `"Não foi possível atualizar o produto."` (sem `e.message`, seguranca.md §14).
- **Falha de rede/exceção:** capturada no `catch`, mesma mensagem genérica.

**Tratamento de Erros:** idêntico a `alternarDisponibilidade` — mensagem genérica ao cliente, detalhe só em `console.error` no servidor (seguranca.md §14).

### Validação (zod)
`src/lib/validacoes/produto.ts`, dentro de `schemaProduto`, ao lado de `disponivel: z.boolean(),`:
```diff
   disponivel: z.boolean(),
+  // Visibilidade na vitrine (issue 085 / migration 083). Obrigatório e boolean,
+  // espelhando `disponivel`: o form sempre envia o valor explícito; o DEFAULT
+  // false vive no banco (RN-7). Separado de `disponivel` (RN-6-b).
+  oculto: z.boolean(),
   ordem: z.number().int().min(0),
```
Schema único reusado no form (UX) e nas Server Actions (segurança).

### Recálculo no Servidor
Não há valor monetário nesta issue. A invariante crítica é de **permissão de escrita**, garantida server-side por:
- **RLS `produtos_escrita_propria`** (`dono_id = auth.uid()`) sobre UPDATE — único enforcement de isolamento entre lojas para `alternarOculto`.
- **Client AUTENTICADO** (`createClient` de `@/lib/supabase/server`), NUNCA `service_role`.
- **`loja_id` nunca do payload** em create/update (derivado de `buscarLojaDoDono`) — inalterado.

### Assinatura exata da nova action
Em `src/lib/actions/produto.ts`, após `alternarDisponibilidade` (após linha 180):
```ts
export async function alternarOculto(
  id: string,
  oculto: boolean,
): Promise<ResultadoGestaoProduto> {
  try {
    const supabase = await createClient();
    // Toggle de VISIBILIDADE escopado por id; RLS produtos_escrita_propria
    // isola por dono. NÃO mexe em `disponivel` (RN-6-b).
    const { error } = await supabase
      .from("produtos")
      .update({ oculto })
      .eq("id", id);
    if (error) {
      console.error("[alternarOculto]", error);
      return { ok: false, erro: "Não foi possível atualizar o produto." };
    }
    revalidatePath(CAMINHO_PAINEL);
    return { ok: true };
  } catch (e) {
    console.error("[alternarOculto]", e);
    return { ok: false, erro: "Não foi possível atualizar o produto." };
  }
}
```

### Arquivos a Criar / Modificar / NÃO tocar
- **Modificar** `src/lib/validacoes/produto.ts` — adicionar `oculto: z.boolean()` ao `schemaProduto`.
- **Modificar** `src/lib/actions/produto.ts` — adicionar `alternarOculto`. `criarProduto`/`atualizarProduto` NÃO mudam (spread já carrega `oculto`).
- **Modificar (fase RED, antes do código)** `src/lib/validacoes/produto.test.ts` e `src/lib/actions/produto.test.ts` — novos casos (contrato abaixo).
- **NÃO tocar:** `alternarDisponibilidade` (RN-6-b, só `disponivel`); migration 083; `database.types.ts` (084); RLS; qualquer UI (`FormProduto`/`ProdutosClient` são issues 088/089); query pública (086); `criarPedido` (087).

### Dependências Externas
Nenhuma. zod já em uso; Supabase SSR client já em uso.

### Contrato do teste RED (fase `tdd`, ANTES do código)

**`src/lib/validacoes/produto.test.ts`** — adicionar `oculto: false` ao `produtoValido` base (senão os testes existentes passam a falhar por schema mais estrito) e:
- `it("rejeita produto sem oculto")` → `safeParse` do `produtoValido` sem `oculto` → `success === false`.
- `it("rejeita oculto não-booleano")` → `{ ...produtoValido, oculto: "sim" }` → `success === false`.
- `it("aceita oculto=true e preserva o valor")` → `{ ...produtoValido, oculto: true }` → `success===true` e `data.oculto === true`.

**`src/lib/actions/produto.test.ts`** — adicionar `oculto: false` ao helper `payloadProduto()` base; usar `authClient`/`opEscrita`/`createServiceClient` já existentes:
- `describe("alternarOculto")`:
  - `it("atualiza apenas o flag oculto escopado por id, via client autenticado")`:
    `await alternarOculto("produto-1", true)` → `{ ok:true }`; `opEscrita("produtos")?.update?.oculto === true`; `opEscrita("produtos")?.update` NÃO contém `disponivel`; `filtros` contém `["id","produto-1"]`; `createServiceClient` NÃO chamado.
  - `it("NÃO usa service_role")` → `createServiceClient` não chamado.
  - `it("erro de banco → genérico, sem vazar e.message")`:
    `respostaPorTabela.produtos = { data:null, error:{ message:"senha postgres XYZ" } }` → `r.ok===false` e `JSON.stringify(r)` não contém `"senha"`.
  - `it("ATAQUE: produto de OUTRA loja — escrita passa pelo client autenticado escopada por id (RLS isola no banco)")`:
    assere que a chamada usa `createClient` autenticado (não service_role) e é escopada por `.eq("id", idAlheio)`. Comentário no teste explica que o isolamento efetivo é da RLS `produtos_escrita_propria` (verificado em teste de integração RLS separado / não mockável no unit) — o unit garante o CONTRATO (client certo + escopo por id), não o comportamento do Postgres.
- `criarProduto`/`atualizarProduto` (novos casos):
  - `it("oculto=true persiste no insert via parsed.data")` → `criarProduto(payloadProduto({ oculto: true }))` → `opEscrita("produtos")?.insert?.oculto === true`.
  - `it("oculto=true persiste no update via parsed.data")` → `atualizarProduto("produto-1", payloadProduto({ oculto: true }))` → `opEscrita("produtos")?.update?.oculto === true`.
  - `it("ATAQUE: payload sem oculto é rejeitado SEM tocar no banco")` → `criarProduto` com payload sem `oculto` → `r.ok===false` e `opEscrita("produtos")` undefined.
- `alternarDisponibilidade` (regressão): manter o teste existente e adicionar
  `it("alternarDisponibilidade NÃO escreve oculto")` → `opEscrita("produtos")?.update` não contém a chave `oculto`.

> Nota de honestidade do teste: o isolamento cross-loja REAL de `alternarOculto` é enforced pela RLS no Postgres, não observável no unit com mock. O caso "ATAQUE outra loja" no unit valida apenas o contrato (client autenticado + escopo por `id`, sem service_role). O isolamento efetivo (linha de outra loja NÃO muda) deve ser coberto por teste de integração RLS no Supabase local, se/quando a suíte de integração de produtos existir.

### Ordem de Implementação (crítica → RED primeiro)
1. **RED (`/tdd`):** escrever os testes acima em `produto.test.ts` e `produto.test.ts` (validações + action). Ajustar `produtoValido`/`payloadProduto` para incluir `oculto`. Confirmar falha real (schema sem `oculto`, `alternarOculto` inexistente).
2. **GREEN (`/execute`):** adicionar `oculto: z.boolean()` no schema; adicionar `alternarOculto`. `criar/atualizarProduto` passam por consequência do spread.
3. `next build` verde (contrato `'use server'`: só funções async exportadas — MEMORY use-server-export-constraint).
