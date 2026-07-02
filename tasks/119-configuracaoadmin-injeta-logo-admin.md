# [119] `ConfiguracaoAdminClient` injeta as actions admin de logo (fecha o cross-tenant)

**crítica:** SIM (TDD red-first)
**Mundo:** painel (admin SaaS)
**Depende de:** 116, 118
**Spec:** specs/fix-logo-admin-cross-tenant.md

## Objetivo
Fiar as actions admin `salvarLogoAdmin`/`removerLogoAdmin` no `PerfilClient` via
`ConfiguracaoAdminClient`, com o `lojaId` da URL fixado por closure. É a fiação
que fecha o bug: sem ela, o admin usaria o default do lojista e escreveria na
loja errada (cross-tenant silencioso quando o admin também é dono de loja).

## Escopo
- [ ] Em `src/app/admin/assinantes/[lojaId]/configuracao/ConfiguracaoAdminClient.tsx`,
  criar adapters finos (padrão de `enviarQrPix`):
  - `onSalvarLogo`: monta `FormData` com `loja_id = lojaId` da URL e chama `salvarLogoAdmin(formData)`.
  - `onRemoverLogo`: `() => removerLogoAdmin(lojaId)`.
- [ ] Passar ambos ao `<PerfilClient onSalvarLogo={...} onRemoverLogo={...} />`.
- [ ] `lojaId` sempre da closure/URL — o client nunca é a autoridade do escopo.

## Fora de escopo
- Não alterar `salvarLogoAdmin`/`removerLogoAdmin` (issue 116) nem a UI da logo.
- Não tocar o painel do lojista.

## Reuso esperado
- `salvarLogoAdmin` / `removerLogoAdmin` — `@/app/admin/assinantes/actions/admin-logo` (issue 116).
- `PerfilClient` com props de logo (issue 118).
- Padrão de adapter/closure já usado para `enviarQrPix` no mesmo arquivo.

## Segurança
- Fecha o vetor cross-tenant: um erro aqui (recair no default do lojista) reintroduz
  a escrita na loja do admin. Por isso a fiação correta é invariante de segurança.
- `lojaId` fixado por closure a partir da URL — client não decide o tenant.
- A autoridade final continua no servidor (116): admin é reprovado sem `verificarAdminSaaS()`.

## Critério de aceite
- [ ] Teste vermelho antes da implementação e depois verde: o adapter chama
  `salvarLogoAdmin`/`removerLogoAdmin` com o `lojaId` da URL — **nunca** os defaults
  do lojista (`salvarLogoLoja`/`removerLogoLoja`) (cobre cenários 2 e 3 do spec).
- [ ] Em `/admin/assinantes/[lojaId]/configuracao`, admin recorta/salva e remove a
  logo da loja-alvo com sucesso (fim do toast genérico).
- [ ] Painel do lojista permanece com defaults (regressão coberta por 117/118).
- [ ] `next build` verde.
