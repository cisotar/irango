## Plano Técnico

> Issue **crítica (autorização/isolamento multitenant)** — começar por `/tdd` (RED)
> e só então `/execute` (GREEN). O núcleo é fiação de padrões que já existem; a
> única fonte de risco é errar a ordem das etapas de segurança.

### Análise do Codebase

Esta issue é **100% reuso** — nenhum primitivo novo. Inventário (`grep -r` em
`src/lib/actions/`, `src/lib/validacoes/`):

O que já existe e será reusado:
- `src/lib/actions/admin-loja.ts` — `validarLojaIdAdmin(lojaId)` (`z.guid` →
  `{ok,lojaId}`), `prepararContextoAdmin(lojaId)` (prova admin fora do try →
  `{svc, escopo}`), `escopo.atualizarLoja(patch)` (UPDATE em `lojas` `.eq("id",lojaId)`
  com `count:"exact"` por construção), `registrarAcessoAdmin` (no-op), `revalidarLojaAdmin`.
  **Base de toda a autorização e escopo desta action.**
- `src/lib/actions/upload-imagem.ts` — `validarBlobImagem(file)` (dupla validação:
  metadado + magic bytes; devolve `{buffer, tipoReal, ext}` derivados do conteúdo).
- `src/lib/actions/upload-contrato.ts` — `CAMPO_ARQUIVO = "file"` (nome do campo).
- `src/lib/validacoes/storage.ts` — `schemaStorageUrl` (URL http(s) que começa por
  `STORAGE_URL_PREFIX`; barra URL externa antes do UPDATE).
- `src/lib/actions/logo-contrato.ts` — tipos `ResultadoSalvarLogo` (`{ok:true;logo_url}`)
  e `ResultadoLogo` (`{ok:true}`). **Mesma forma que as actions do lojista** → o adapter
  no client (issues 117-119) fica trivial.
- Referências de padrão (não editar): `src/app/admin/assinantes/actions/admin-upload.ts`
  (`enviarFotoProdutoAdmin` — FormData + `loja_id`, storage sob `service_role`, path
  server-side) e `admin-perfil.ts` (`salvarPerfilAdmin` — `lojaId` explícito +
  `escopo.atualizarLoja`, prova de admin fora do try).
- `src/lib/actions/logo.ts` (lojista) — **modelo funcional** do fluxo salvar/remover
  logo (path `${id}/logo/${uuid}.${ext}`, `schemaStorageUrl` antes do UPDATE, allowlist
  `{logo_url}`). A action admin é a mesma lógica trocando "loja derivada do auth" por
  "`lojaId` da URL validado + `service_role`". **NÃO tocar** este arquivo (é do lojista).

O que precisa ser criado:
- `src/app/admin/assinantes/actions/admin-logo.ts` — único arquivo de produção novo.
  Justificativa de por que não dá pra reusar `logo.ts`: aquele deriva a loja do auth
  (`buscarLojaDoDono`) e escreve sob RLS; o admin não é dono da loja-alvo. A variante
  admin escopa por `lojaId` da URL sob `service_role`. É exatamente o par
  `admin-upload.ts` ↔ `upload.ts` que já existe no projeto.

### Cenários

**Caminho Feliz (`salvarLogoAdmin`):**
1. Client (`ConfiguracaoAdminClient`, issue 118) monta FormData: `loja_id = lojaId` da
   URL + arquivo cropado em `CAMPO_ARQUIVO`. Chama `salvarLogoAdmin(formData)`.
2. `validarLojaIdAdmin(formData.get("loja_id"))` → UUID válido.
3. Extrai `CAMPO_ARQUIVO`; confere que é `Blob` não-vazio (só presença — validação de
   conteúdo fica depois da prova de admin, anti-DoS).
4. `prepararContextoAdmin(lojaId)` **fora do try** — prova admin, eleva `service_role`,
   devolve `{svc, escopo}`.
5. `validarBlobImagem(file)` → `{buffer, tipoReal, ext}`.
6. `path = ${lojaId}/logo/${crypto.randomUUID()}.${ext}` (bucket `produtos`, sem prefixo
   `produtos/`).
7. `svc.storage.from("produtos").upload(path, buffer, {contentType: tipoReal})`.
8. `getPublicUrl(path)` → `schemaStorageUrl.safeParse(publicUrl)` (barra URL externa).
9. `escopo.atualizarLoja({ logo_url })` (UPDATE `.eq("id",lojaId)`, allowlist de 1 coluna).
10. `registrarAcessoAdmin(svc, {lojaId, acao:"salvar_logo"})` + `revalidarLojaAdmin(lojaId)`.
11. Retorna `{ ok:true, logo_url }`.

**Caminho Feliz (`removerLogoAdmin(lojaId)`):** `validarLojaIdAdmin` →
`prepararContextoAdmin(lojaId)` fora do try → `escopo.atualizarLoja({ logo_url: null })`
→ `registrarAcessoAdmin` + `revalidarLojaAdmin` → `{ ok:true }`. Sem upload, sem storage.

**Casos de Borda:**
- `loja_id` ausente/não-UUID (salvar) ou `lojaId` inválido (remover) → `{ ok:false }`,
  **zero upload, `service_role` não criado** (validação antes de `prepararContextoAdmin`).
- Arquivo ausente/vazio → `{ ok:false, erro:"Imagem inválida." }` antes de elevar.
- Imagem falsa (extensão mente, magic bytes não batem) → `validarBlobImagem` falha →
  `{ ok:false }`, **sem upload** (já provou admin, mas não grava nada).
- `verificarAdminSaaS()` lança (não-admin) → exceção **propaga** (fail-closed): sem
  service client, sem upload, sem UPDATE.
- URL pública fora do Storage do iRango → `schemaStorageUrl` reprova → `{ ok:false }`,
  **não persiste** (objeto órfão no storage é aceitável; o que importa é não gravar
  URL externa em `lojas.logo_url`).
- Falha de upload / falha de UPDATE (rede/Storage) → `console.error` + `{ ok:false }`
  genérico.

**Tratamento de Erros:** mensagem genérica ao client (reusar a copy de `logo.ts`:
`"Não foi possível salvar a logo. Tente novamente."`); detalhe só em `console.error`
(`seguranca.md` §14). Loja-alvo inativa **não** bloqueia — é onboarding assistido; o
admin opera justamente sobre lojas ainda não ativas.

### Schema de Banco

**Nenhuma migration, coluna ou tabela nova.** Escreve só `lojas.logo_url`
(`text CHECK (logo_url IS NULL OR logo_url LIKE 'https://%')`, migration
`20260615013000_logo_url_lojas.sql`). `schemaStorageUrl` (só https + prefixo do Storage)
já garante o CHECK por construção.

**RLS:** nenhuma política nova. A defesa **não é RLS** — `service_role` a bypassa. O gate
é `verificarAdminSaaS()` (via `prepararContextoAdmin`, fora do try) + escopo por `lojaId`
da URL (via `escopo.atualizarLoja`) + path de Storage montado server-side
(`seguranca.md` §7 "Padrão admin"). O painel do lojista (`logo.ts`) segue sob
`lojas_update_proprio` (`auth.uid() = dono_id`) — inalterado.

### Validação (zod)

- `lojaIdSchema` (`z.guid()`, já em `admin-loja.ts`) via `validarLojaIdAdmin`.
- `schemaStorageUrl` (já em `validacoes/storage.ts`) para a URL pública.
- Validação de imagem via `validarBlobImagem` (magic bytes). **Nenhum schema novo** —
  reuso integral.

### Recálculo no Servidor

Não há valor monetário. Mas o eixo análogo aqui é **autoridade do escopo**: o client
envia `loja_id`/`lojaId` e o arquivo; o servidor **reconstrói** a única coisa que amarra
o tenant — o `path` de Storage (`${lojaId}/logo/${uuid}.${ext}`) — a partir do `lojaId`
**validado**, nunca de `file.name` nem do auth do admin. Nome sempre `crypto.randomUUID()`.
Extensão derivada do conteúdo real (`validarBlobImagem`), nunca do Content-Type declarado.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/app/admin/assinantes/actions/admin-logo.ts` — `"use server"`; exporta apenas
  `salvarLogoAdmin(formData)` e `removerLogoAdmin(lojaId)` (ambas `async`). `BUCKET`,
  `ERRO_GENERICO`, `acao` e quaisquer constantes ficam **locais e não exportadas**
  (módulo `'use server'` só exporta função async — const exportada quebra só no
  `next build`). Tipos de retorno importados de `logo-contrato.ts` (não redeclarar).
- `src/app/admin/assinantes/actions/admin-logo.test.ts` — fase RED (ver Ordem).

**Modificar:** nenhum arquivo de produção nesta issue.

**NÃO tocar:**
- `src/lib/actions/logo.ts` / `logo-contrato.ts` — contrato do lojista; só importar.
- `admin-upload.ts` / `admin-perfil.ts` / `admin-loja.ts` — reuso, sem edição.
- `UploadLogoLoja` / `PerfilClient` / `ConfiguracaoAdminClient` — fiação de UI é das
  issues 117-119.
- `enforcement-escopo-admin.test.ts` — auto-descobre `admin-logo.ts` por `readdirSync`;
  não editar (a nova action tem de **passar** nele, não alterá-lo).

### Dependências Externas

Nenhuma nova. `zod`, `next/cache`, `@supabase/*` já no `package.json`. Sem instalar nada.

### Enforcement estático (obrigatório passar)

`admin-logo.ts` é varrido por `enforcement-escopo-admin.test.ts`:
- **Camada 2 (GUARD):** cada `export async function` deve referenciar
  `prepararContextoAdmin` ou `verificarAdminSaaS`. `removerLogoAdmin` **também** chama
  `prepararContextoAdmin` (não só `salvarLogoAdmin`) — caso contrário o guard falha
  para o export dela.
- **Camada 3 (ESCOPO):** nenhum `.from("...").update(/.delete(` cru sem `.eq`. Usar
  **exclusivamente** `escopo.atualizarLoja(...)` (nunca `svc.from("lojas").update()`)
  satisfaz por construção.
- Sanidade: mantém o total ≥ 20 exports async (só soma 2, sem risco).

### Ordem de Implementação

Issue crítica → **RED antes do código de produção.**

1. **RED (`/tdd`)** — `admin-logo.test.ts` com os cenários do spec §Cenários (1,2,4,5,6):
   - **Caso 1 (bug principal):** admin salva logo em loja que não é dele → `{ok:true}`;
     `path.split("/")[0] === lojaId` e `path` contém `/logo/`; o patch capturado no
     `escopo.atualizarLoja` é `{ logo_url }` apontando para o Storage; `.eq` escopa
     `("id", lojaId)`.
   - **Caso 2 (cross-tenant fechado):** com `lojaId` da URL ≠ loja do admin, o único
     UPDATE capturado escopa por `("id", lojaId)` — prova que nada é escrito na loja do
     admin (não há segundo `from("lojas")` com outro id).
   - **Caso 4 (lojaId inválido):** `loja_id` ausente/não-UUID (salvar) e `lojaId` inválido
     (remover) → `{ok:false}`, zero upload, `createServiceClient` **não** chamado.
   - **Caso 5 (não-admin):** `verificarAdminSaaS` rejeita → `await expect(...).rejects`;
     zero upload; `createServiceClient` não chamado.
   - **Caso 6 (remoção):** `removerLogoAdmin(lojaId)` → patch `{ logo_url: null }` escopado
     `("id", lojaId)`, sem chamada ao storage.
   - Extra: imagem falsa (magic bytes) → `{ok:false}`, sem upload; `schemaStorageUrl`
     barra URL externa → `{ok:false}`, sem UPDATE.

   **Harness (combinar os dois modelos existentes):** o mock de `createServiceClient` desta
   action precisa ter **`storage`** (padrão `admin-upload.test.ts` §`makeServiceClient` —
   captura `upload`/`getPublicUrl`) **E** `from("lojas")` (padrão `admin-perfil.test.ts`
   §`builderLojas` — `.update(patch, opts)` → `.eq(col,val)` awaitable resolvendo
   `{error,count}`), porque `salvarLogoAdmin` faz storage **e** `escopo.atualizarLoja`
   (o `escopo` real de `admin-loja.ts` **não** é mockado; ele chama
   `svc.from("lojas").update(patch,{count:"exact"}).eq("id",lojaId)`). Mockar
   `next/cache`, `@/lib/auth/admin` (`verificarAdminSaaS`) e `@/lib/supabase/service`
   como nos dois testes. Definir `process.env.NEXT_PUBLIC_SUPABASE_URL` **no topo, antes
   dos imports** e fazer `getPublicUrl` devolver `${STORAGE_URL_PREFIX}${bucket}/${path}`
   (padrão `logo.test.ts`) para o `schemaStorageUrl` passar no caminho feliz; caso da URL
   externa injeta um `publicUrl` fora do prefixo. Rodar e **confirmar o vermelho** contra
   o stub `Error("TODO: GREEN")`.

2. **GREEN (`/execute`)** — escrever `admin-logo.ts` na sequência exata do §Escopo da issue.
3. `next build` (const exportada de `'use server'` só quebra aqui) + a suíte
   (`admin-logo.test.ts`, `enforcement-escopo-admin.test.ts`, `isolamento-admin.test.ts`
   se enumerar por invocação).

### Riscos

- **Ordem das etapas de segurança** é o risco central: `validarLojaIdAdmin` antes de
  qualquer efeito; `prepararContextoAdmin` **fora do try** (fail-closed); `validarBlobImagem`
  **depois** da prova de admin. Trocar a ordem reabre DoS/anti-fail-closed.
- **`removerLogoAdmin` sem guard** falha a Camada 2 do enforcement — garantir
  `prepararContextoAdmin` também nela.
- **Escrita crua** (`svc.from("lojas").update`) em vez de `escopo.atualizarLoja` falha a
  Camada 3 e reabre cross-tenant.
- **Export não-async** (const/tipo exportado) passa em `tsc`/`vitest` e só quebra no
  `next build` — manter constantes locais.
