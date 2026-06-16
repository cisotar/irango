## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (sem recriar):**

- `src/lib/actions/upload.ts` — `enviarFotoProduto(formData)`. Pattern completo de
  action de upload: deriva loja via `buscarLojaDoDono`, `validarImagem` +
  `validarMagicBytes`, deriva extensão do **tipo real** (`tipoRealPorConteudo`),
  path `{loja.id}/{uuid}.{ext}`, upload no bucket `produtos` com client
  AUTENTICADO (RLS), `getPublicUrl`, erro genérico. Contém as duas funções puras
  privadas (`tipoRealPorConteudo`, mapa `EXTENSAO_POR_TIPO`) que a action de logo
  precisa — **fonte do helper a extrair** (ver Decisão 1).
- `src/lib/actions/upload-contrato.ts` — `CAMPO_ARQUIVO = "file"` e tipo
  `ResultadoUpload`. Módulo neutro (fora do `'use server'`). `CAMPO_ARQUIVO` é
  reusado direto (logo usa o mesmo nome de campo no FormData). `ResultadoUpload`
  NÃO serve para logo (retorna `foto_url`, e a logo persiste + retorna `logo_url`)
  — precisa de tipo próprio.
- `src/lib/utils/validarImagem.ts` — `validarImagem`, `validarMagicBytes`,
  `TIPOS_IMAGEM_PERMITIDOS`, `TAMANHO_MAXIMO_BYTES`. Funções puras reusadas como
  estão.
- `src/lib/validacoes/storage.ts` — `schemaStorageUrl`. Valida que a URL pertence
  ao Storage do iRango. Reusado direto antes do UPDATE (`.parse`/`safeParse`).
- `src/lib/supabase/queries/lojas.ts` — `buscarLojaDoDono(client)`. Deriva a loja
  do auth sob RLS. Reusado direto. (`removerLogoLoja` também usa.)
- `src/lib/actions/loja.ts` — `salvarPerfil`/`salvarTema`: pattern de UPDATE
  coluna-allowlist sob client autenticado (`lojas_update_proprio`), `.eq("id",
  loja.id)` obrigatório (PostgREST recusa UPDATE sem WHERE — 21000),
  `revalidarVitrine(loja.slug)`, `extrairIp` + `verificarRateLimit`,
  `ERRO_GENERICO`. **`revalidarVitrine` é função PRIVADA de `loja.ts`** (não
  exportável — `'use server'` só exporta async) → será reimplementada localmente
  em `logo.ts` (mesmo padrão best-effort; duplicação mínima inevitável, ~6 linhas).
- `src/lib/utils/rateLimit.ts` — `extrairIp`, `verificarRateLimit`, mapa
  `LIMITES`. Reusado; exige **nova chave** `salvarLogoLoja` em `LIMITES` (ver
  Decisão 4).

**Decisão 1 — extrair helper compartilhado vs. espelhar:**
`salvarLogoLoja` NÃO pode reusar `enviarFotoProduto`: (a) path difere
(`{loja_id}/logo/{uuid}.webp`, subdir `logo/`), (b) não retorna só URL — persiste
em `lojas.logo_url`, (c) `larguraAlvo`/destino conceitual diferem.
**Decisão:** extrair um helper PURO de upload em um módulo neutro novo
`src/lib/actions/upload-imagem.ts` (sem `'use server'`), expondo:
`validarBlobImagem(file): { ok: false; erro } | { ok: true; buffer; tipoReal; ext }`
— move `tipoRealPorConteudo` + `EXTENSAO_POR_TIPO` + a sequência
`validarImagem`→`validarMagicBytes`→derivar ext (hoje inline em `upload.ts`).
`enviarFotoProduto` passa a chamar esse helper (refactor pequeno, sem mudar
comportamento — coberto pelos testes existentes de upload). `salvarLogoLoja`
chama o mesmo helper e monta o path com subdir `logo/`. Isso elimina a duplicação
das ~70 linhas de magic bytes / extensão entre as duas actions. **O upload em si
(`supabase.storage.upload`) NÃO entra no helper** — cada action controla seu
path/bucket/contentType e o helper permanece puro (testável sem I/O).

**Decisão 5 — contrato:** novo módulo neutro `src/lib/actions/logo-contrato.ts`
com `export type ResultadoLogo = { ok: true; logo_url: string } | { ok: false;
erro: string }`. `CAMPO_ARQUIVO` é reusado de `upload-contrato.ts` (mesmo nome de
campo) — NÃO duplicar a constante.

### Cenários

**Caminho Feliz (`salvarLogoLoja`):**
1. Client (issue 004) exporta o crop como Blob webp e o anexa ao FormData no campo
   `CAMPO_ARQUIVO`, chama `salvarLogoLoja(formData)`.
2. Rate limit por IP (`verificarRateLimit("salvarLogoLoja", ip)`) — fail-open.
3. `formData.get(CAMPO_ARQUIVO)` → valida `instanceof Blob` e `size > 0`.
4. `buscarLojaDoDono(supabase)` (client autenticado) → `loja` ou "Não autorizado.".
5. `validarBlobImagem(file)` (helper): `validarImagem` (tipo/tamanho) →
   `validarMagicBytes` (conteúdo real) → `tipoReal` + `ext`. Erro → genérico.
6. Path `{loja.id}/logo/{crypto.randomUUID()}.{ext}` (relativo ao bucket, sem
   prefixo `produtos/`). Upload no bucket `produtos` com `contentType: tipoReal`.
7. `getPublicUrl(path)` → `publicUrl`.
8. **`schemaStorageUrl.safeParse(publicUrl)` ANTES do UPDATE** — barra URL fora do
   Storage do iRango. Falha → erro genérico (não persiste).
9. UPDATE `lojas SET logo_url = publicUrl` sob client autenticado
   (`lojas_update_proprio`), `.eq("id", loja.id)`.
10. `revalidarVitrine(loja.slug)` (best-effort). Retorna `{ ok: true, logo_url }`.

**Caminho Feliz (`removerLogoLoja`):**
1. `buscarLojaDoDono` → loja.
2. UPDATE `logo_url = NULL` sob a mesma RLS, `.eq("id", loja.id)`.
   (NULL passa pelo CHECK `logo_url IS NULL OR logo_url LIKE 'https://%'`.)
3. `revalidarVitrine(loja.slug)`. Retorna `{ ok: true }` (sem `logo_url`).

**Casos de Borda:**
- Campo ausente / Blob vazio (`size <= 0`) → "Imagem inválida." sem I/O.
- Sem sessão / dono sem loja (`buscarLojaDoDono` → null) → "Não autorizado.".
- Arquivo não-imagem (`.exe` renomeado `.png`): `validarMagicBytes` reprova →
  genérico, NÃO sobe nada.
- Tipo não-whitelist (gif/svg) ou acima de 2 MB → `validarImagem` reprova.
- `loja_id` injetado no FormData → IGNORADO (loja sempre de `buscarLojaDoDono`).
- Loja B tentando UPDATE da loja A → `lojas_update_proprio` (`auth.uid() =
  dono_id`) barra no banco; e o path já é `{loja_A_id}/` só p/ a própria loja.
- `getPublicUrl` retorna URL fora do prefixo do Storage → `schemaStorageUrl`
  barra antes de persistir.
- Falha de rede/Storage (`upload` error) ou erro no UPDATE → `console.error` com
  detalhe, retorno genérico ("Não foi possível...").
- `revalidatePath` falha → só loga; resultado permanece `{ ok: true }` (dado já
  persistido).

**Tratamento de Erros (seguranca.md §14):** mensagem genérica ao usuário; detalhe
(`error` do PostgREST/Storage) só em `console.error` no servidor. Nenhum
`e.message` vaza ao client.

### Schema de Banco

Nenhuma migration nesta issue. A coluna `lojas.logo_url` (text, nullable, CHECK
`https://%`) e a projeção em `vitrine_lojas` são entregues pela **issue [001]**
(dependência). Esta action assume `database.types.ts` já regenerado com
`lojas.logo_url`.

**RLS (reuso, nenhuma política nova — Opção A):**
- Escrita no Storage: policy `produtos_insert_propria` (e update/delete) escopa por
  `(storage.foldername(name))[1] IN (SELECT id::text FROM lojas WHERE dono_id =
  auth.uid())`. O subdir `logo/` NÃO quebra o isolamento: `[1]` continua sendo
  `loja_id` (o `logo/` é `[2]`).
- UPDATE de `lojas.logo_url`: policy `lojas_update_proprio` (`auth.uid() =
  dono_id`, USING + WITH CHECK). `logo_url` NÃO é coluna protegida pelo trigger
  `lojas_protege_billing_trg` (só billing/`dono_id`) → escrita pelo dono passa.

### Validação (zod)

`schemaStorageUrl` (já existe) aplicado à `publicUrl` antes do UPDATE — único
ponto zod desta action. Não há payload estruturado a validar (entrada é
FormData/Blob, coberto por `validarBlobImagem`).

### Recálculo no Servidor

Não há valor monetário. As invariantes de segurança garantidas no servidor:
- **Tipo/tamanho/conteúdo real** da imagem → `validarBlobImagem` na action
  (Content-Type declarado é ignorado).
- **`loja_id`** → derivado do auth (`buscarLojaDoDono`), nunca do FormData.
- **Nome do objeto** → `crypto.randomUUID()`, nunca `file.name`.
- **URL persistida** → `schemaStorageUrl` (pertence ao Storage do iRango).
- **Permissão de escrita** → RLS de Storage (path) + RLS `lojas_update_proprio`.

### Mapa cliente ↔ servidor (enforcement)

| Invariante | Camada |
|-----------|--------|
| Só o dono altera a logo da própria loja | RLS Storage (`produtos_insert/update_propria`, path `{loja_id}/`) + RLS `lojas_update_proprio` |
| `loja_id` não vem do cliente | Server Action (`buscarLojaDoDono`) |
| Arquivo é imagem real | Server Action (`validarMagicBytes`) + `allowed_mime_types` do bucket |
| Tamanho ≤ 2 MB | Server Action (`validarImagem`) + `file_size_limit` do bucket |
| URL persistida é do Storage do iRango | Server Action (`schemaStorageUrl`) antes do UPDATE |
| Remover logo zera `logo_url` | Server Action + RLS `lojas_update_proprio` |
| Abuso/custo de upload | Rate limit por IP (contenção, não gate) |

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/actions/logo.ts` (`'use server'`) — `salvarLogoLoja(formData):
  Promise<ResultadoLogo>` e `removerLogoLoja(): Promise<ResultadoLogo>`. Só
  exporta async (regra `use-server`; rodar `next build`).
- `src/lib/actions/logo-contrato.ts` (módulo neutro) — `type ResultadoLogo`.
- `src/lib/actions/upload-imagem.ts` (módulo neutro, helper puro) —
  `validarBlobImagem(file: Blob)` + `tipoRealPorConteudo` + `EXTENSAO_POR_TIPO`,
  movidos de `upload.ts`.

**Modificar:**
- `src/lib/actions/upload.ts` — passa a importar `validarBlobImagem` de
  `upload-imagem.ts` (remove o código duplicado de magic bytes/extensão).
  Comportamento idêntico; testes de upload existentes devem continuar verdes.
- `src/lib/utils/rateLimit.ts` — adicionar chave `salvarLogoLoja: { limite: 10,
  janela: "1 m" }` ao mapa `LIMITES` (mesmo perfil de `salvarPerfil`).

**NÃO tocar:**
- `src/lib/actions/upload-contrato.ts` — `CAMPO_ARQUIVO` reusado como está.
- `src/lib/utils/validarImagem.ts`, `src/lib/validacoes/storage.ts`,
  `src/lib/supabase/queries/lojas.ts` — reuso direto.
- `supabase/migrations/` — bucket `produtos` e policies (Opção A, nada novo).
- Componentes `components/ui/` (shadcn) e o uploader (issue 004).

### Dependências Externas

Nenhuma nova. Já no projeto: `@supabase/supabase-js` (Storage/PostgREST), `zod`,
`@upstash/ratelimit`/`@upstash/redis` (via `rateLimit.ts`), `crypto.randomUUID`
(Node/Web nativo). Bloqueante: issue [001] (coluna `logo_url` + tipos).

### Ordem de Implementação (crítica → RED primeiro)

1. **FASE RED (`/tdd`)** — teste vermelho ANTES do código de produção:
   `tests/.../salvar_logo.test.ts` (unit, mock do client Supabase) cobrindo os
   casos críticos abaixo + um teste-proxy de isolamento de path no estilo
   `storage_bugket_produtos.test.ts` (pglite valida a subquery `{loja_id}/` com
   subdir `logo/`). Confirmar a falha com output real e PARAR.
2. **GREEN** (`/execute`): extrair `upload-imagem.ts`; criar `logo-contrato.ts`;
   adicionar chave `salvarLogoLoja` ao `rateLimit`; criar `logo.ts`; reapontar
   `upload.ts` ao helper.
3. `next build` (const exportada de `'use server'` quebra só no build —
   `use-server-export-constraint`).
4. Rodar suite completa (tests de upload existentes + novos verdes).

### Casos de teste que o `/tdd` deve cobrir (RED)

1. `.exe` renomeado `.png` (magic bytes não batem) → `{ ok: false }`, NUNCA chama
   `storage.upload` nem `update`.
2. Arquivo acima de `TAMANHO_MAXIMO_BYTES` → `{ ok: false }` antes de I/O.
3. Tipo não-whitelist (ex. `image/gif`) → `{ ok: false }`.
4. `loja_id` alheio injetado no FormData é IGNORADO — o path do upload usa o id de
   `buscarLojaDoDono`, não o do payload.
5. Isolamento RLS entre lojas: loja B não consegue UPDATE de `logo_url` da loja A
   (proxy: subquery `id::text FROM lojas WHERE dono_id = auth.uid()` só retorna a
   própria; UPDATE escopado por `.eq("id", loja.id)` da loja resolvida sob RLS).
6. `schemaStorageUrl` barra `publicUrl` fora do prefixo do Storage → NÃO persiste
   (sem `update`), retorna genérico.
7. Caminho feliz: webp válido → `upload` chamado com path
   `{loja_id}/logo/<uuid>.webp` (regex), `update({ logo_url })` com a URL
   validada, retorno `{ ok: true, logo_url }`.
8. `removerLogoLoja` → `update({ logo_url: null })` com `.eq("id", loja.id)`,
   retorno `{ ok: true }`.
9. Sem loja (`buscarLojaDoDono` → null) → "Não autorizado." em ambas as actions.
10. Erro do Storage/UPDATE → `console.error` + retorno genérico (sem vazar
    `e.message`).
