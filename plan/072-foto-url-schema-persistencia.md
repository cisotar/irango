## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (inventário de reuso):**

- `src/lib/validacoes/pagamento.ts` → `STORAGE_URL_PREFIX` (`NEXT_PUBLIC_SUPABASE_URL + "/storage/v1/object/public/"`) e o padrão de `schemaPixQrUrl` (`z.string().url().refine(startsWith(STORAGE_URL_PREFIX)).optional()`). O prefixo é o mesmo para qualquer bucket (`pix-qr`, `produtos`) — **não é por-bucket**. O refine de origem (anti-injeção de URL externa) será **reusado via extração**, não recriado.
- `src/lib/validacoes/produto.ts` → `schemaProduto` existente (`nome`, `descricao`, `preco`, `categoria_id`, `disponivel`, `ordem`). Será **estendido**, não substituído.
- `src/lib/actions/produto.ts` → `criarProduto` (`.insert({ ...parsed.data, loja_id })`) e `atualizarProduto` (`.update({ ...parsed.data, loja_id })`). O spread já carrega qualquer campo novo de `parsed.data` — **não precisa nova lógica de persistência**, apenas que `foto_url` esteja em `parsed.data` (confirmado abaixo).
- `buscarLojaDoDono` e a derivação de `loja_id` — intocados, já corretos.
- Coluna `produtos.foto_url text` (nullable) já existe (schema.md L132) e RLS do bucket Storage já existe (seguranca.md §18). **Nenhuma migration, nenhuma RLS nova.**

**O que precisa ser criado (com justificativa):**

- `src/lib/validacoes/storage.ts` — módulo neutro que abriga `STORAGE_URL_PREFIX` e um helper de schema de URL de Storage reusável por qualquer bucket.

### Decisão 1 — Onde mora `STORAGE_URL_PREFIX`

**Extrair para `src/lib/validacoes/storage.ts` (módulo neutro); `pagamento.ts` e `produto.ts` importam dele.**

Justificativa (menor acoplamento, churn aceitável e pequeno):
- Importar a constante de `pagamento.ts` dentro de `produto.ts` cria acoplamento semântico errado (foto de produto não tem nada a ver com config de pagamento). Sinal de "wrong home".
- O valor independe do bucket — é um conceito de Storage, não de Pix. Lugar natural é um módulo `storage.ts`.
- Churn é mínimo e mecânico: `pagamento.ts` passa a re-exportar/importar a constante de `storage.ts`. Mantemos `export const STORAGE_URL_PREFIX` re-exportado de `pagamento.ts` (ou um `export { STORAGE_URL_PREFIX } from "./storage"`) para **não quebrar** nenhum import existente — `pagamento.ts:9` é a fonte hoje, mas o grep mostra que ninguém importa `STORAGE_URL_PREFIX` de fora de `pagamento.ts` diretamente (só `schemaPixQrUrl` é importado externamente, em `actions/pagamento.ts`). Logo a re-exportação é defensiva e barata.

Conteúdo de `storage.ts`:
- `STORAGE_URL_PREFIX` (movido de pagamento.ts).
- `schemaStorageUrl` — `z.string().url().refine((u) => u.startsWith(STORAGE_URL_PREFIX), "...")`. **Sem `.optional()` embutido** (diferente de `schemaPixQrUrl`): a opcionalidade/nulabilidade é composta no ponto de uso, para que `produto.ts` possa aplicar `.nullish()` e `pix` continue com `.optional()`. `pagamento.ts` constrói `schemaPixQrUrl = schemaStorageUrl.optional()` a partir dele — mantém o comportamento atual idêntico.

### Decisão 2 — Normalizar `""` → `null` sem quebrar os outros campos nem o tipo inferido

O form envia `foto_url: ""` quando não há foto. Precisamos: `""` vira `null` (persiste remoção), `undefined` continua válido (campo ausente), URL válida do Storage passa, URL externa/`javascript:` rejeitadas.

**Solução: `z.preprocess` escopado SÓ no campo `foto_url`** (não envolve o objeto inteiro, então nenhum outro campo é afetado):

```
foto_url: z.preprocess(
  (v) => (v === "" ? null : v),
  schemaStorageUrl.nullish(),   // nullish() = .nullable().optional() → aceita null e undefined
)
```

Por quê `preprocess` e não `.or`/`.transform`:
- `.transform` roda **depois** da validação — `""` falharia em `.url()` antes de qualquer transform. Não serve.
- `.or(z.literal(""))` aceitaria `""` mas o persistiria como `""` no banco (string vazia, não `null`) — viola o critério "remover foto persiste `foto_url = null`".
- `z.preprocess` roda **antes** do parse interno: converte `""` → `null`, e `schemaStorageUrl.nullish()` aceita `null`. Resultado: `parsed.data.foto_url === null`.

Tipo inferido resultante: `foto_url?: string | null | undefined`. O spread `...parsed.data` no insert/update carrega `null` corretamente → coluna `text` nullable recebe `null`. Coluna nunca recebe `""`.

### Decisão 3 — Persistência via spread (confirmação)

`criarProduto` faz `.insert({ ...parsed.data, loja_id: loja.id })` e `atualizarProduto` faz `.update({ ...parsed.data, loja_id: loja.id })`. Como `foto_url` passa a integrar `parsed.data`:
- **URL válida** → flui no spread → persiste a URL. ✅ Sem código novo.
- **Remoção (`foto_url: ""` do form)** → `preprocess` normaliza para `null` → `parsed.data.foto_url === null` → `update` envia `foto_url: null` → coluna zera. ✅ Sem código novo.
- **Campo ausente (`undefined`)** no insert → `parsed.data.foto_url === undefined` → a chave fica `undefined` no objeto; o supabase-js omite chaves `undefined` no insert (coluna assume default `NULL`). ✅
  - Nuance no UPDATE: se o form **não** enviar `foto_url`, o update não toca a coluna (mantém valor antigo). Para a issue 073 (UI) o form sempre enviará `foto_url` (string vazia quando sem foto), então a remoção sempre chega como `""` → `null`. Esta issue só garante o contrato do schema/action; o form é fora de escopo.

**Conclusão: nenhuma alteração de lógica nas actions é necessária além de o schema já incluir `foto_url`.** As actions ficam **inalteradas em código**; ganham cobertura de teste nova.

### Cenários

**Caminho Feliz (schema):**
1. `safeParse` de produto com `foto_url` = `STORAGE_URL_PREFIX + "produtos/<loja>/<uuid>.webp"` → `success: true`, `data.foto_url` = a URL.
2. `safeParse` sem `foto_url` → `success: true`, `data.foto_url` undefined.

**Caminho Feliz (action):**
1. `criarProduto` com `foto_url` válida → insert carrega `foto_url` = URL.
2. `atualizarProduto` com `foto_url: ""` → update carrega `foto_url: null` (remoção).

**Casos de Borda:**
- `foto_url: ""` (sem foto) → normaliza para `null`, schema válido.
- `foto_url: null` → válido (nullish), persiste null.
- `foto_url` = URL externa (`https://evil.com/x.png`) → rejeitado (não começa com prefixo).
- `foto_url: "javascript:alert(1)"` → rejeitado (falha `.url()` e/ou prefixo).
- `foto_url` = bucket de outro projeto Supabase → rejeitado (prefixo diverge).
- Demais campos inválidos (preço negativo) continuam rejeitados — `preprocess` no `foto_url` não afeta os outros campos.

**Tratamento de Erros:** schema inválido → action devolve `{ ok:false, erro:"Produto inválido." }` (genérico, já existente). Erro de banco → genérico, sem vazar `e.message` (já existente, seguranca.md §14).

### Schema de Banco

Nenhuma mudança. Coluna `produtos.foto_url text` (nullable) já existe (schema.md L132). Sem migration. RLS de tabela `produtos` (escrita própria) e RLS de Storage (§18) já cobrem. Nenhuma política nova.

### Validação (zod)

Schema único `schemaProduto` em `src/lib/validacoes/`, reusado no form (issue 073, UX) e nas Server Actions (segurança). `foto_url` validada com `schemaStorageUrl` extraído. Camada autoritativa: `schemaProduto.safeParse` em `criarProduto`/`atualizarProduto` rejeita URL externa/`javascript:`/cross-bucket **antes** de qualquer INSERT/UPDATE.

### Regra cliente ↔ servidor

| Invariante | Camada que garante |
|---|---|
| `foto_url` é URL do Storage do iRango (anti-injeção, renderizada como `<Image src>`) | **Server Action** — `schemaProduto.safeParse` (refine `startsWith(STORAGE_URL_PREFIX)`) antes do insert/update |
| Escrita do produto isolada por dono | RLS `produtos_escrita_propria` + `loja_id` derivado de `buscarLojaDoDono` (inalterado) |
| Remoção de foto persiste `null` (não `""`) | **Server Action** — `preprocess` no schema normaliza `""` → `null` |
| Upload no bucket escopado por `loja_id` | RLS Storage §18 (fora desta issue) |

Nenhuma regra depende só do cliente.

### Recálculo no Servidor

Sem valor monetário nesta issue. A invariante de valor/permissão aqui é a **origem da URL**, garantida server-side pelo `safeParse` na action (cliente é ignorado).

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/validacoes/storage.ts` — `STORAGE_URL_PREFIX` + `schemaStorageUrl`.

**Modificar:**
- `src/lib/validacoes/produto.ts` — adicionar campo `foto_url` ao `schemaProduto` (preprocess + `schemaStorageUrl.nullish()`); importar de `./storage`.
- `src/lib/validacoes/pagamento.ts` — importar `STORAGE_URL_PREFIX` de `./storage` (remover a definição local), construir `schemaPixQrUrl = schemaStorageUrl.optional()`; re-exportar `STORAGE_URL_PREFIX` para não quebrar nenhum import. Comportamento idêntico.
- `src/lib/validacoes/produto.test.ts` — (fase RED do `tdd`) novos casos para `foto_url`.
- `src/lib/actions/produto.test.ts` — (fase RED do `tdd`) casos de persistência de `foto_url` (válida e remoção→null).

**NÃO tocar:**
- `src/lib/actions/produto.ts` — código de produção **inalterado**; o spread já cobre `foto_url`. (Só confirmar; nenhuma edição.)
- `src/lib/actions/upload.ts:uploadFotoProduto` — código morto, follow-up de auditoria (issue diz: não tocar).
- `src/components/ui/**` — shadcn, não editar à mão. Nenhum componente nesta issue.
- Migrations / RLS — nada.
- `src/components/painel/UploadQrPix.tsx`, `src/lib/actions/pagamento.ts` — só consomem `schemaPixQrUrl`, cujo comportamento não muda.

### Dependências Externas

Nenhuma nova. `zod` já no `package.json`. `z.preprocess`, `.refine`, `.url`, `.nullish` são API estável do zod já em uso no projeto.

### Ordem de Implementação (issue crítica — RED antes do código)

1. **RED (`/tdd`)** — escrever os testes falhos ANTES de qualquer código de produção:
   - Em `produto.test.ts`: casos de schema de `foto_url` (lista abaixo).
   - Em `produto.test.ts` (actions): casos de persistência (válida → insert carrega URL; `""` → update carrega `null`).
   - Confirmar a falha real (`schemaStorageUrl`/campo ainda não existem; spread ainda não carrega `foto_url`).
2. **GREEN (`/execute`)**:
   - Criar `src/lib/validacoes/storage.ts`.
   - Refatorar `pagamento.ts` para importar de `storage.ts` (manter testes de pagamento verdes — regressão zero).
   - Estender `schemaProduto` em `produto.ts` com `foto_url`.
   - Confirmar actions verdes sem editar `produto.ts` de produção.
3. **Refator/verde**: rodar suíte inteira (`pagamento.test.ts`, `produto.test.ts` schema+action) para garantir regressão zero.

### Cenários de teste para o `/tdd` (RED-first)

**`src/lib/validacoes/produto.test.ts` (schema):**
- `foto_url` ausente/`undefined` → `success: true`.
- `foto_url: null` → `success: true`, `data.foto_url === null`.
- `foto_url: ""` → `success: true` E `data.foto_url === null` (normalização — asserção no valor, não só no success).
- `foto_url` = `STORAGE_URL_PREFIX + "produtos/x.webp"` → `success: true`, `data.foto_url` = a URL.
- `foto_url: "https://evil.com/x.png"` → `success: false`.
- `foto_url: "javascript:alert(1)"` → `success: false`.
- (regressão) demais campos válidos continuam válidos com `foto_url` presente.

**`src/lib/actions/produto.test.ts` (persistência):**
- `criarProduto` com `foto_url` válida → `opEscrita("produtos").insert.foto_url` === a URL.
- `atualizarProduto` com `foto_url: ""` → `opEscrita("produtos").update.foto_url === null` (remoção persiste null).
- (opcional/regressão) `criarProduto` com `foto_url` externa → `{ ok:false }` e `opEscrita("produtos")` undefined (lixo não toca banco).
