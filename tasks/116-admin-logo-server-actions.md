# [116] Server Actions admin de logo (`salvarLogoAdmin` / `removerLogoAdmin`)

**crítica:** SIM (TDD red-first)
**Mundo:** painel (admin SaaS)
**Depende de:** — (reusa helpers já existentes)
**Spec:** specs/fix-logo-admin-cross-tenant.md

## Objetivo
Criar as duas Server Actions admin que salvam/removem a logo da **loja-alvo**
(`lojaId` da URL) sob `service_role`, escopadas por tenant, fechando o vetor
cross-tenant silencioso. Este é o núcleo de autorização do fix.

## Escopo
- [ ] Criar `src/app/admin/assinantes/actions/admin-logo.ts` com diretiva `"use server"`.
- [ ] `salvarLogoAdmin(formData: FormData): Promise<ResultadoSalvarLogo>` — lê
  `loja_id` do FormData (padrão `enviarFotoProdutoAdmin`); arquivo em `CAMPO_ARQUIVO`.
- [ ] `removerLogoAdmin(lojaId: string): Promise<ResultadoLogo>` — `lojaId`
  explícito (padrão `salvarPerfilAdmin`).
- [ ] Sequência de `salvarLogoAdmin`:
  1. `validarLojaIdAdmin(formData.get("loja_id"))` **antes de qualquer efeito**.
  2. `prepararContextoAdmin(lojaId)` **fora do try** (prova admin antes de validar
     imagem e antes de criar `service_role`; fail-closed / propaga se lançar).
  3. `validarBlobImagem(file)` **depois** da prova de admin.
  4. Path server-side `${lojaId}/logo/${crypto.randomUUID()}.${ext}` no bucket `produtos`.
  5. `schemaStorageUrl.safeParse(publicUrl)` **antes** do UPDATE.
  6. UPDATE allowlist `{ logo_url }` via `escopo.atualizarLoja` (nunca `svc.from("lojas").update()` cru).
  7. `registrarAcessoAdmin(svc, { lojaId, acao })` + `revalidarLojaAdmin(lojaId)`.
  8. Erro genérico ao client; detalhe só em `console.error`.
- [ ] `removerLogoAdmin`: `validarLojaIdAdmin` → `prepararContextoAdmin(lojaId)` fora
  do try → UPDATE `{ logo_url: null }` via `escopo.atualizarLoja` → registrar/revalidar.
- [ ] `BUCKET`/constantes/tipos ficam **locais e não exportados** (módulo `"use server"`
  só exporta funções async).
- [ ] Rodar `next build` antes de fechar (const exportada só quebra no build).

## Fora de escopo
- Não tocar `UploadLogoLoja`/`PerfilClient`/`ConfiguracaoAdminClient` (issues 117–119).
- Não criar migration, coluna, política RLS nem primitivo genérico de upload.
- Não implementar `registrarAcessoAdmin` real (segue no-op).

## Reuso esperado
- `ResultadoSalvarLogo` / `ResultadoLogo` — `src/lib/actions/logo-contrato.ts` (não duplicar tipos).
- `prepararContextoAdmin`, `validarLojaIdAdmin`, `registrarAcessoAdmin`,
  `revalidarLojaAdmin`, `escopo.atualizarLoja` — `src/lib/actions/admin-loja.ts`.
- `validarBlobImagem` — `@/lib/actions/upload-imagem`.
- `CAMPO_ARQUIVO` — `@/lib/actions/upload-contrato`.
- `schemaStorageUrl` — `@/lib/validacoes/storage`.
- Referência de padrão: `admin-upload.ts` (`enviarFotoProdutoAdmin`) e `admin-perfil.ts`.

## Segurança
- Autorização é o núcleo do bug — **padrão admin** (`seguranca.md` §7): `verificarAdminSaaS()`
  via `prepararContextoAdmin` fora do try (fail-closed); `service_role` só nasce após a prova.
- Isolamento multitenant: escrita escopada por `lojaId` da URL (nunca pelo auth do admin);
  path de Storage montado server-side é a única amarra sob `service_role`.
- `schemaStorageUrl` antes do UPDATE barra URL externa. Allowlist `{ logo_url }` na loja-alvo.
- `validarLojaIdAdmin` antes de validar imagem = anti-DoS (não gasta CPU sem admin/UUID).

## Critério de aceite
- [ ] Teste vermelho escrito **antes** da implementação e depois verde, cobrindo:
  (1) admin salva logo em loja que não é dele → `logo_url` da loja-alvo aponta para `${lojaId}/logo/...`;
  (2) admin dono de outra loja salva/remove alvo → loja do admin **intacta**;
  (4) `loja_id` ausente/não-UUID (salvar) e `lojaId` inválido (remover) → `{ ok:false }`, zero upload, `service_role` não criado;
  (5) sem `verificarAdminSaaS()` válido → exceção propaga, sem efeito colateral;
  (6) `removerLogoAdmin` zera `logo_url` só na loja-alvo.
- [ ] `admin-logo.ts` passa em `enforcement-escopo-admin.test.ts` (auto-descoberto por
  `readdirSync`): referencia `prepararContextoAdmin`/`verificarAdminSaaS` e não tem
  `.update()`/`.delete()` cru sem `.eq`.
- [ ] `next build` verde (sem export não-async).
