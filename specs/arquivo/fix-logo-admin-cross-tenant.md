# Spec: Fix — Admin não salva/remove logo da loja-alvo (cross-tenant silencioso)

**Versão:** 0.1.0 | **Atualizado:** 2026-07-02

## Visão Geral

Corrige um **bug de autorização confirmado** no hub de onboarding assistido do admin SaaS. Em `/admin/assinantes/[lojaId]/configuracao`, ao salvar ou remover a **logo** da loja-alvo, o admin recebe o toast genérico "Não foi possível salvar a logo. Tente novamente." e a operação nunca conclui.

**Causa raiz** (já diagnosticada — confirmada nos arquivos):

- `ConfiguracaoAdminClient` (`src/app/admin/assinantes/[lojaId]/configuracao/ConfiguracaoAdminClient.tsx`) reusa o `PerfilClient` do painel do lojista injetando actions admin por `lojaId` (issues 091–095/101). A **logo ficou fora da fiação**.
- `PerfilClient` (`src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx:274`) renderiza `<UploadLogoLoja logoUrlInicial={...} />` **sem prop de action**.
- `UploadLogoLoja` (`src/components/painel/UploadLogoLoja.tsx:38`) importa **hardcoded** `salvarLogoLoja`/`removerLogoLoja` de `@/lib/actions/logo` — actions do **lojista** que derivam a loja via `buscarLojaDoDono(auth)`. O admin não é dono da loja-alvo → a action retorna `{ ok:false, erro:"Não autorizado." }` → toast genérico.

**Agravante de segurança (por isso é crítico):** se o admin **também for dono de alguma loja própria**, `salvarLogoLoja` derivaria essa loja pelo auth e gravaria a logo **na loja do admin**, não na loja-alvo — escrita **cross-tenant errada e silenciosa** (a UI mostraria "sucesso" na loja errada). O mesmo vale para `removerLogoLoja`, que zeraria a `logo_url` da loja do admin. Isso caracteriza falha de autorização/isolamento multitenant (`seguranca.md` §2/§7 "Padrão admin") → **exige TDD red-first**.

**Mundo:** painel admin SaaS (`/admin/*`, auth de admin obrigatório, elevação a `service_role` após `verificarAdminSaaS()`). O painel do lojista (`/painel/*`) e a vitrine pública **não mudam de comportamento**.

O SaaS não processa pagamento; esta feature não toca valor monetário. O eixo de segurança aqui é **autorização + isolamento por tenant + path de Storage**, não recálculo de preço.

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|--------------------|
| **iRango (SaaS)** | Fornece as novas Server Actions admin (`admin-logo.ts`) sob `service_role`, precedidas de `verificarAdminSaaS()` e escopadas por `lojaId`. |
| **Lojista** | Continua salvando/removendo a **própria** logo pelo painel (`/painel/configuracoes/perfil`), via as actions do lojista sob RLS — **comportamento inalterado**. |
| **Admin SaaS** | Salva/remove a logo da **loja-alvo** (onboarding assistido) informando o `lojaId` da URL. |
| **Cliente** | Não participa. |

## Páginas e Rotas

### Configuração da loja (hub admin) — `/admin/assinantes/[lojaId]/configuracao`
**Mundo:** painel admin SaaS (auth de admin obrigatório)
**Descrição:** Aba "Configuração" do onboarding assistido. Reusa `PerfilClient` com as actions admin injetadas. Após o fix, a seção de logo (dentro do `PerfilClient`) passa a operar sobre a **loja-alvo** (`lojaId` da URL), não sobre o auth do admin.

**Componentes:** (reuso — nada novo de UI)
- `ConfiguracaoAdminClient` — passa a injetar as duas actions admin de logo no `PerfilClient`, com o `lojaId` fixado via closure (mesmo padrão do adapter `enviarQrPix`).
- `PerfilClient` — passa a **repassar** as actions de logo recebidas para o `UploadLogoLoja` (props novas retrocompatíveis).
- `UploadLogoLoja` — passa a aceitar as actions de salvar/remover via props opcionais (default = actions do lojista). Toda a UI (cropper `react-easy-crop`, preview circular, validação client de metadado + magic bytes) é reuso, sem mudança.

**Behaviors:**
- [x] Admin recorta e salva a logo da loja-alvo. Garantido em: **Server Action `salvarLogoAdmin`** (`verificarAdminSaaS()` + `validarLojaIdAdmin` + `validarBlobImagem` + path server-side por `lojaId` + `schemaStorageUrl` + UPDATE allowlist `{ logo_url }` via `escopo.atualizarLoja`). A validação client (tipo/tamanho/magic bytes) é só **gate de UX**.
- [x] Admin remove a logo da loja-alvo. Garantido em: **Server Action `removerLogoAdmin(lojaId)`** (`verificarAdminSaaS()` + `validarLojaIdAdmin` + UPDATE `{ logo_url: null }` via `escopo.atualizarLoja`).
- [x] Admin com `lojaId` inválido/ausente na URL é rejeitado sem efeito. Garantido em: **Server Action** (`validarLojaIdAdmin` antes de qualquer I/O; não eleva a `service_role`).
- [x] Não-admin não consegue salvar/remover logo por essas actions. Garantido em: **Server Action** (`verificarAdminSaaS()` fora do try — fail-closed, propaga; `service_role` nunca é criado).

### Perfil da loja (painel do lojista) — `/painel/configuracoes/perfil`
**Mundo:** painel do lojista (auth obrigatório)
**Descrição:** **Sem mudança de comportamento.** O `UploadLogoLoja` continua usando os defaults (`salvarLogoLoja`/`removerLogoLoja` do lojista, sob RLS, loja derivada do auth). A prova de que nada mudou é ter defaults nas props novas.

**Behaviors:**
- [x] Lojista salva/remove a própria logo. Garantido em: **Server Action do lojista + RLS** (`buscarLojaDoDono(auth)` → `lojas_update_proprio` `auth.uid() = dono_id`). Inalterado.

---

## Modelos de Dados

Nenhuma migration nova. Nenhuma tabela nova. Nenhuma coluna nova.

- Tabela `lojas`, coluna `logo_url` (`schema.md`) — já existe; segue sendo a única coluna escrita (allowlist `{ logo_url }`).
- Bucket de Storage `produtos` — já existe; a logo continua em `${lojaId}/logo/${uuid}.${ext}` (relativo ao bucket, sem prefixo `produtos/`), idêntico ao path do lojista, apenas montado a partir do `lojaId` validado server-side em vez do `loja.id` derivado do auth.
- Contrato de resultado: **reusar** `ResultadoSalvarLogo` e `ResultadoLogo` de `src/lib/actions/logo-contrato.ts` — não duplicar tipos. As actions admin devolvem a **mesma forma** que as do lojista, tornando o adapter trivial no client.

> Como não há tabela/coluna nova nem migration, não há nova política RLS. A defesa das actions admin **não é RLS** (o `service_role` a bypassa) — é `verificarAdminSaaS()` + escopo por `lojaId` + path de Storage (ver Segurança).

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| Admin só salva/remove logo se for admin SaaS. | **Server Action** — `verificarAdminSaaS()` via `prepararContextoAdmin(lojaId)`, **fora do try** (fail-closed; propaga; `service_role` só é criado depois da prova). |
| `lojaId` deve ser UUID válido antes de qualquer efeito. | **Server Action** — `validarLojaIdAdmin(lojaId)` (`z.guid()`), antes de validar imagem (anti-DoS) e antes de elevar a `service_role`. |
| Imagem realmente é imagem permitida (não arquivo disfarçado). | **Server Action** — `validarBlobImagem` (metadado + magic bytes) **depois** da prova de admin. Client valida também, mas só como gate de UX. |
| Isolamento por tenant no Storage. | **Server Action** — path montado server-side `${lojaId}/logo/${uuid}.${ext}`; sob `service_role` o path é a única amarra de isolamento. Nome é UUID (nunca `file.name`), sem prefixo `produtos/`. |
| URL persistida pertence ao Storage do iRango. | **Server Action** — `schemaStorageUrl.safeParse` **antes** do UPDATE (barra URL externa). |
| Só a coluna `logo_url` é escrita, só na loja-alvo. | **Server Action** — UPDATE allowlist `{ logo_url }` / `{ logo_url: null }` via `escopo.atualizarLoja` (escopo por `id` na loja-alvo, injetado por construção — nunca `svc.from("lojas").update()` cru). |
| Erro interno nunca vaza detalhe ao client. | **Server Action** — mensagem genérica ao client; detalhe só em `console.error` (`seguranca.md` §14). |
| Painel do lojista permanece sob RLS, loja derivada do auth. | **Server Action do lojista + RLS** — defaults das props não mudam. |

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** blob de imagem (logo) + `lojaId` (UUID da URL). Sem PII, sem chave Pix, sem valor monetário.
- **Valor monetário?** Não — nenhum recálculo de preço envolvido.
- **Tabela nova?** Não — nenhuma política RLS nova.
- **API externa com key?** Não.
- **Autorização (núcleo do bug):** as actions admin seguem o **padrão admin** de `seguranca.md` §7 e o contrato das actions existentes (`admin-upload.ts`, `admin-perfil.ts`):
  1. `validarLojaIdAdmin(loja_id)` **antes de qualquer efeito**; não-UUID/ausente → `{ ok:false }`, zero upload, sem elevar a `service_role`.
  2. `prepararContextoAdmin(lojaId)` **fora do try** — `verificarAdminSaaS()` prova admin **antes** de validar a imagem (anti-DoS de CPU/memória) e **antes** de criar o `service_role`. Se lança, propaga (fail-closed).
  3. `validarBlobImagem` (dupla validação: metadado + magic bytes) só **depois** da prova de admin.
  4. Path server-side `${lojaId}/logo/${crypto.randomUUID()}.${ext}` no bucket `produtos` — única amarra de isolamento sob `service_role`.
  5. `schemaStorageUrl` valida a URL pública **antes** do UPDATE.
  6. UPDATE allowlist `{ logo_url }` via `escopo.atualizarLoja` (escopo por `id` na loja-alvo).
  7. `registrarAcessoAdmin(svc, { lojaId, acao })` (no-op hoje) + `revalidarLojaAdmin(lojaId)`.
  8. Erro genérico ao client; detalhe em `console.error`.
- **Isolamento multitenant:** com o fix, o admin nunca escreve na própria loja ao operar sobre a loja-alvo. A escrita é escopada por `lojaId` da URL (não pelo auth), fechando o vetor cross-tenant silencioso.
- **Restrição de módulo `"use server"`:** `admin-logo.ts` só pode exportar **funções async**. `BUCKET`/constantes/tipos ficam locais e não exportados (const exportada de módulo `'use server'` quebra só no `next build` — rodar `next build` antes de fechar).
- **Enforcement automático:** as novas actions em `src/app/admin/assinantes/actions/admin-logo.ts` são descobertas por `readdirSync` no teste `enforcement-escopo-admin.test.ts` (sem lista manual) — devem passar nas duas verificações estáticas (referência a `prepararContextoAdmin`/`verificarAdminSaaS`; `.eq(...)` em qualquer `.update()`/`.delete()` cru). Usar `escopo.atualizarLoja` já satisfaz por construção.

## Contrato das props novas (retrocompatível)

**`UploadLogoLoja` — props novas opcionais (default = actions do lojista):**
- `onSalvar?: (formData: FormData) => Promise<ResultadoSalvarLogo>` — default `salvarLogoLoja` de `@/lib/actions/logo`.
- `onRemover?: () => Promise<ResultadoLogo>` — default `removerLogoLoja` de `@/lib/actions/logo`.
- O componente troca os imports hardcoded por essas props; a UI e a validação client não mudam. `confirmarCrop` chama `onSalvar(fd)`; `removerPreview` chama `onRemover()`.

**`PerfilClient` — repasse:**
- Recebe as duas actions (ex.: `onSalvarLogo?` / `onRemoverLogo?`, com o mesmo default do lojista) e as **repassa** ao `UploadLogoLoja`. No fluxo do lojista, ausência das props mantém o default → comportamento idêntico.

**`ConfiguracaoAdminClient` — injeção (padrão do adapter `enviarQrPix`):**
- Monta o `FormData` com `loja_id = lojaId` da URL e chama `salvarLogoAdmin(formData)`; injeta `() => removerLogoAdmin(lojaId)`. O `lojaId` é fixado via closure — o client nunca é a autoridade do escopo.

**Server Actions novas — `src/app/admin/assinantes/actions/admin-logo.ts`:**
- `salvarLogoAdmin(formData: FormData): Promise<ResultadoSalvarLogo>` — lê `loja_id` do FormData (padrão `enviarFotoProdutoAdmin`), campo do arquivo = `CAMPO_ARQUIVO`.
- `removerLogoAdmin(lojaId: string): Promise<ResultadoLogo>` — `lojaId` explícito (padrão `salvarPerfilAdmin`).

## Cenários de Teste (TDD red-first — issue crítica)

O teste vermelho deve existir e falhar **antes** da implementação. Cobrir:

1. **Bug principal:** admin salva logo em loja que **não é dele** → sucesso; `lojas.logo_url` da **loja-alvo** passa a apontar para `${lojaId}/logo/...`.
2. **Cross-tenant fechado:** admin que **também é dono de outra loja** salva/remove a logo da loja-alvo → a loja **do admin permanece intacta** (nenhuma escrita na loja do admin).
3. **Lojista inalterado:** `UploadLogoLoja` sem props usa os defaults; lojista salva/remove a **própria** logo sob RLS como antes.
4. **`lojaId` inválido:** `loja_id` ausente/não-UUID no FormData (salvar) e `lojaId` inválido (remover) → `{ ok:false }`, zero upload, `service_role` **não** criado.
5. **Não-admin bloqueado:** chamada sem `verificarAdminSaaS()` válido → exceção propaga (fail-closed), sem efeito colateral.
6. **Remoção:** `removerLogoAdmin(lojaId)` zera `logo_url` **apenas** na loja-alvo, escopado por `escopo.atualizarLoja`.
7. **Enforcement estático:** `admin-logo.ts` passa em `enforcement-escopo-admin.test.ts` (referência a `prepararContextoAdmin`/`verificarAdminSaaS`; sem `.update()` cru sem `.eq`).

## Fora do Escopo (v1)

- Não refatorar `UploadLogoLoja`/`UploadQrPix`/`salvarLogoLoja` para um único primitivo genérico de upload — só a fiação mínima do bug.
- Não implementar a tabela de auditoria/log de acesso admin (`registrarAcessoAdmin` segue no-op — issue futura já mapeada em `admin-loja.ts`).
- Não mudar a UI da seção de logo (cropper, copy, preview, área de toque) nem o bucket/path.
- Não tocar no painel do lojista além de garantir defaults retrocompatíveis.
- Não mexer nos erros de CSP/Sentry (report-only, irrelevantes ao bug).
