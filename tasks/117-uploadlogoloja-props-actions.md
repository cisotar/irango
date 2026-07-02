# [117] `UploadLogoLoja` aceita actions de salvar/remover via props (retrocompat)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** — (só depende do contrato já existente em `logo-contrato.ts`)
**Spec:** specs/fix-logo-admin-cross-tenant.md

## Objetivo
Tornar `UploadLogoLoja` reutilizável por qualquer dono de action, trocando os
imports **hardcoded** do lojista por props opcionais com default = actions do
lojista. Nenhuma mudança de UI nem de comportamento no painel do lojista.

## Escopo
- [ ] Adicionar props opcionais em `src/components/painel/UploadLogoLoja.tsx`:
  - `onSalvar?: (formData: FormData) => Promise<ResultadoSalvarLogo>` — default `salvarLogoLoja`.
  - `onRemover?: () => Promise<ResultadoLogo>` — default `removerLogoLoja`.
- [ ] `confirmarCrop` chama `onSalvar(fd)`; `removerPreview` chama `onRemover()`.
- [ ] Manter o import de `salvarLogoLoja`/`removerLogoLoja` **apenas** como valor
  default das props (não mais chamado diretamente na lógica).

## Fora de escopo
- Não mudar cropper, preview circular, validação client (metadado + magic bytes),
  copy, área de toque ou qualquer UI.
- Não criar primitivo genérico de upload (fora do escopo v1).
- Não mexer em `PerfilClient` (issue 118) nem `ConfiguracaoAdminClient` (issue 119).

## Reuso esperado
- Tipos `ResultadoSalvarLogo` / `ResultadoLogo` — `src/lib/actions/logo-contrato.ts`.
- `salvarLogoLoja` / `removerLogoLoja` — `@/lib/actions/logo` (agora como default de prop).
- `CAMPO_ARQUIVO`, `exportarCrop` — inalterados.

## Segurança
- Sem dado monetário. A validação client permanece **gate de UX** — a autoridade
  segue no servidor (issue 116 e nas actions do lojista).
- Defaults garantem que o fluxo do lojista continua idêntico (loja derivada do auth, sob RLS).

## Critério de aceite
- [ ] Sem props, `UploadLogoLoja` usa os defaults e salva/remove a própria logo
  como antes (comportamento observável inalterado no painel do lojista).
- [ ] Com `onSalvar`/`onRemover` injetados, a lógica chama as props, não os imports.
- [ ] `tsc`/lint verdes; nenhuma mudança visual.
