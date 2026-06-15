## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (não criar nada):**

- `src/components/painel/UploadFotoProduto.tsx` (issue 076) — componente client pronto. Props: `urlAtual?: string | null`, `onUploadConcluido: (url: string) => void`, `disabled?: boolean`. Faz validação de imagem (gate de UX), crop 4:3 e chama a Server Action `enviarFotoProduto` (que deriva a loja do auth). Retorna a `foto_url` pública via `onUploadConcluido`; passa `""` ao remover. **Importar e renderizar — não modificar.**
- `src/lib/validacoes/produto.ts` → `schemaProduto` (issue 072) — já tem `foto_url: z.preprocess((v) => (v === "" ? null : v), schemaStorageUrl.nullish())`. Aceita `string | null | undefined`; normaliza `""` → `null`. **Reusado como está; é o gate de UX no `salvar()` e a autoridade na action.**
- `src/lib/actions/produto.ts` → `criarProduto` / `atualizarProduto` (issue 072) — persistem `{ ...parsed.data, loja_id }`; como `foto_url` já está em `parsed.data`, **basta o form colocar `foto_url` no payload; nenhuma mudança na action.**
- `src/lib/actions/upload.ts` → `enviarFotoProduto` (issue 075) — deriva `loja_id` via `buscarLojaDoDono` e **ignora qualquer `loja_id` do client**. Já é a fonte de verdade do upload.
- `src/lib/supabase/queries/produtos.ts` → `type Produto = Tables<"produtos">` com `select("*")` — `foto_url` já vem no objeto `Produto` carregado (coluna existe desde 072). Nenhuma query nova.
- `src/lib/supabase/queries/lojas.ts` → `buscarLojaDoDono` — já chamado em `produtos/page.tsx`; `loja.id` já está disponível na page (linha 21). Só repassar adiante.

**O que precisa ser criado:** nada. São apenas edições de fiação (props + estado + render) em 3 arquivos existentes.

### Cenários

**Caminho Feliz (criar com foto):**
1. Lojista abre `/painel/produtos` → clica "Novo produto" → Sheet abre `FormProduto` (sem `inicial`).
2. Preenche nome/preço → no campo de foto, seleciona imagem → cropper → "Confirmar e enviar".
3. `enviarFotoProduto` (auth) faz upload e retorna `foto_url`; `onUploadConcluido(url)` → `setFotoUrl(url)`.
4. "Criar produto" → `montarPayload()` inclui `foto_url` → `schemaProduto.safeParse` (UX) → `criarProduto(parsed.data)` → INSERT com `foto_url` + `loja_id` (RLS). Sheet fecha, `router.refresh()`.

**Caminho Feliz (editar):** `ProdutosClient` monta `inicial.foto_url` do produto carregado → `FormProduto` inicializa `fotoUrl` com ele → `UploadFotoProduto urlAtual={fotoUrl}` exibe o preview atual → lojista substitui/remove → salvar persiste.

**Casos de Borda:**
- Produto sem foto → `inicial.foto_url` é `null` → dropzone vazia; payload manda `foto_url: null`.
- Remover a foto e salvar → `onUploadConcluido("")` → `setFotoUrl(null)` (mapear `"" → null` no callback) → payload `foto_url: null` → UPDATE zera a coluna; vitrine volta ao placeholder.
- Upload falha (rede/validação server) → o próprio `UploadFotoProduto` mostra toast genérico e NÃO chama `onUploadConcluido`; `fotoUrl` permanece o anterior. Salvar o produto sem ter trocado a foto é válido.
- URL forjada no estado (cenário teórico) → `schemaStorageUrl` no `schemaProduto` barra URL externa/`javascript:`/bucket alheio, no client (UX) e no servidor (autoridade).
- Submeter durante upload em andamento → o campo de foto fica `disabled={enviando}` (passar o `enviando`/`isPending` do form como `disabled`); o botão de salvar já desabilita por `enviando`.

**Tratamento de Erros:** mensagens genéricas via `sonner` (já em uso). Detalhe cru nunca exibido (`seguranca.md` §14) — o upload já loga via `console.error` server/client e mostra toast genérico. Sem mudança aqui.

### Schema de Banco
Não toca dados. Coluna `produtos.foto_url` e RLS de `produtos` já existem (issue 072). Sem migration.

### Validação (zod)
`schemaProduto` (existente) reusado nos dois lados:
- Form (`salvar()`): `safeParse(montarPayload())` como gate de UX — já existe; só passa a incluir `foto_url`.
- Server Action (`criarProduto`/`atualizarProduto`): revalida `schemaProduto` antes do INSERT/UPDATE — já existe; `foto_url` entra automaticamente em `parsed.data`.

### Recálculo no Servidor (valor monetário)
Não há valor monetário nesta issue. A invariante relevante é **propriedade da loja**, garantida server-side em duas camadas (não no client):
- **Upload da foto:** `enviarFotoProduto` deriva `loja_id` do auth (`buscarLojaDoDono`) + RLS do bucket `produtos`; `loja_id` do client é ignorado.
- **Persistência do produto:** `criarProduto`/`atualizarProduto` derivam `loja_id` do dono + RLS de `produtos` (INSERT/UPDATE checam `dono_id`).
- **`lojaId` da prop é só contexto de UI.** O fluxo de upload atual NÃO o consome (deriva tudo do auth). Threadear `lojaId` segue o escopo da issue/spec por consistência e uso futuro, sem introduzir confiança no cliente. Onde a propriedade é garantida: 100% no servidor (actions + RLS).

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**

1. `src/components/painel/FormProduto.tsx`
   - `ProdutoInicial`: adicionar `foto_url?: string | null`.
   - `FormProdutoProps`: adicionar `lojaId: string` (manter `lojaSlug`).
   - Assinatura do componente: desestruturar `lojaId`.
   - Estado: `const [fotoUrl, setFotoUrl] = useState<string | null>(inicial?.foto_url ?? null)`.
   - `montarPayload()`: adicionar `foto_url: fotoUrl` ao objeto retornado.
   - Render: inserir `<UploadFotoProduto urlAtual={fotoUrl} onUploadConcluido={(url) => setFotoUrl(url || null)} disabled={enviando} />` como **filho DIRETO do `<form className="space-y-4">`, SEM wrapper `<div className="space-y-1">`** (o componente já traz Label + `space-y-2` interno; wrapper duplicaria Label). **Posição: logo após o bloco de Nome e antes de Descrição** (decisão UI/UX do agente `desenhar` na issue — ordem final: Nome → Foto → Descrição → Preço → Categoria → Disponível → Botão). Botões internos do upload são `type="button"`, não disparam submit.
   - `import { UploadFotoProduto } from "@/components/painel/UploadFotoProduto"`.
   - Observação: `lojaId` entra na assinatura mas pode não ser consumido pelo render atual (upload deriva do auth). Para evitar lint de var não usada, seguir o mesmo padrão já presente com `lojaSlug` (`void lojaSlug;`) OU repassar `lojaId` adiante caso 076/075 venham a aceitá-lo. Hoje: `void lojaId;` análogo ao `lojaSlug`.

2. `src/app/(painel)/painel/produtos/ProdutosClient.tsx`
   - `ProdutosClientProps`: adicionar `lojaId: string`.
   - Assinatura: desestruturar `lojaId`.
   - No `<FormProduto>`: adicionar `lojaId={lojaId}` (junto do `lojaSlug` existente).
   - No objeto `inicial` (modo edição): adicionar `foto_url: emEdicao.foto_url`.

3. `src/app/(painel)/painel/produtos/page.tsx`
   - No `<ProdutosClient>`: adicionar `lojaId={loja.id}` (junto do `lojaSlug={loja.slug}`).

**NÃO tocar:**
- `src/components/painel/UploadFotoProduto.tsx` (076), `src/lib/actions/upload.ts` (075), `src/lib/actions/produto.ts` (072), `src/lib/validacoes/produto.ts` (072), `src/lib/supabase/queries/produtos.ts`, qualquer migration/RLS.
- `src/components/ui/*` (shadcn — não editar à mão).

### Dependências Externas
Nenhuma nova. Tudo já em `package.json` (react-easy-crop, sonner, lucide-react, next/image) e consumido só dentro do `UploadFotoProduto` existente.

### Ordem de Implementação
Issue **não crítica** (sem dinheiro/RLS/token novos; a segurança já está garantida pelas issues anteriores). TDD red-first não é obrigatório; ainda assim, recomenda-se um teste de unidade do `montarPayload`/integração leve do `FormProduto`.

1. `FormProduto.tsx` — base da fiação (tipos `ProdutoInicial`/`FormProdutoProps`, estado, render, payload). É o consumidor final; definir o contrato primeiro.
2. `ProdutosClient.tsx` — passa a satisfazer o novo contrato (`lojaId` + `inicial.foto_url`).
3. `page.tsx` — fornece `lojaId={loja.id}` ao `ProdutosClient`.
4. `npm run lint` + typecheck (`npx tsc --noEmit` ou script equivalente). Atualizar testes existentes de `FormProduto`/`produto` se exercitam a assinatura antiga.
