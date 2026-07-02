# [118] `PerfilClient` repassa actions de logo ao `UploadLogoLoja`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 117
**Spec:** specs/fix-logo-admin-cross-tenant.md

## Objetivo
Fazer `PerfilClient` aceitar e **repassar** as actions de logo ao `UploadLogoLoja`,
mantendo o default do lojista quando as props estão ausentes.

## Escopo
- [ ] Adicionar props opcionais em `src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx`:
  - `onSalvarLogo?: (formData: FormData) => Promise<ResultadoSalvarLogo>`
  - `onRemoverLogo?: () => Promise<ResultadoLogo>`
- [ ] Repassar ao `<UploadLogoLoja onSalvar={onSalvarLogo} onRemover={onRemoverLogo} logoUrlInicial={...} />`.
- [ ] Quando ausentes, `UploadLogoLoja` recai nos defaults do lojista (comportamento idêntico).

## Fora de escopo
- Não alterar outras seções do perfil.
- Não injetar as actions admin aqui (isso é responsabilidade de 119).

## Reuso esperado
- `UploadLogoLoja` com as props novas da issue 117.
- Tipos `ResultadoSalvarLogo` / `ResultadoLogo` — `src/lib/actions/logo-contrato.ts`.

## Segurança
- Passthrough puro; nenhuma decisão de autorização vive aqui. A ausência de props
  preserva o default do lojista (RLS, loja pelo auth).

## Critério de aceite
- [ ] `/painel/configuracoes/perfil` (lojista) salva/remove logo como antes (sem props → default).
- [ ] Props repassadas chegam intactas ao `UploadLogoLoja`.
- [ ] `tsc`/lint verdes.
