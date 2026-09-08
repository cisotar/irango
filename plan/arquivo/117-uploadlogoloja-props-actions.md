## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (sem criar nada novo):**

- `src/lib/actions/logo-contrato.ts` — tipos `ResultadoSalvarLogo` (`{ ok:true; logo_url:string } | { ok:false; erro:string }`) e `ResultadoLogo` (`{ ok:true } | { ok:false; erro:string }`). Vivem fora do módulo `'use server'` justamente para poderem ser importados como tipo no client. Serão importados via `import type` para tipar as props novas. **Não duplicar.**
- `src/lib/actions/logo.ts` — `salvarLogoLoja(formData: FormData): Promise<ResultadoSalvarLogo>` (linha 47) e `removerLogoLoja(): Promise<ResultadoLogo>` (linha 119). Continuam importados no `UploadLogoLoja`, mas **apenas** como valor default das props (não mais chamados diretamente na lógica). Assinaturas conferidas — batem 1:1 com o contrato das props.
- `src/components/painel/UploadQrPix.tsx` — **padrão de injeção de referência**. Define o tipo da função injetável (`EnviarQrPix`), a expõe como prop opcional `onEnviar?` com default = impl do lojista (`onEnviar = enviarQrPixLojista`), e chama `onEnviar(...)` no corpo. `UploadLogoLoja` segue exatamente esse formato, com a diferença de que os defaults já são funções nomeadas prontas (`salvarLogoLoja`/`removerLogoLoja`) — não precisa de wrapper local como o `enviarQrPixLojista`.
- `CAMPO_ARQUIVO` (`src/lib/actions/upload-contrato.ts`), `exportarCrop`, `validarImagem`, `validarMagicBytes` — inalterados. A construção do `FormData` (`fd.append(CAMPO_ARQUIVO, blob, "logo.webp")`) permanece no client.

**O que precisa ser criado:** nada. Nenhum arquivo, tipo, util ou query novos. É só parametrização de dois pontos de chamada num componente existente.

### Cenários

**Caminho Feliz (lojista — comportamento inalterado):**
1. Sem props `onSalvar`/`onRemover`, o componente usa os defaults `salvarLogoLoja`/`removerLogoLoja`.
2. `confirmarCrop` gera o blob, monta o `FormData` e chama `onSalvar(fd)` (= `salvarLogoLoja`). Loja derivada do auth sob RLS. Idêntico ao atual.
3. `removerPreview` chama `onRemover()` (= `removerLogoLoja`). Idêntico ao atual.

**Caminho Feliz (admin — habilitado por esta issue, fiado nas issues 118/119):**
1. `ConfiguracaoAdminClient` injeta `onSalvar`/`onRemover` escopados por `lojaId` (closure). Fora do escopo desta issue implementar a injeção — aqui só se garante que o componente **aceita** as props e as usa.

**Casos de Borda:**
- Prop ausente → cai no default do lojista (retrocompat garantida por construção).
- `onSalvar` retorna `{ ok:false }` → mesmo tratamento atual: toast genérico "Não foi possível salvar a logo. Tente novamente."; nunca expõe `resultado.erro` cru.
- `onRemover` retorna `{ ok:false }` → toast genérico atual, preview mantido.
- Exceção no `exportarCrop`/`onSalvar` → `catch` já existente loga em `console.error` e mostra toast genérico. O contrato das props (`Promise<Resultado...>`) não muda o formato do erro.

**Tratamento de Erros:** inalterado. Mensagem genérica ao usuário via `toast.error`; detalhe apenas em `console.error("[UploadLogoLoja] ...", erro)` (`seguranca.md` §14). Nenhuma string de erro nova.

### Schema de Banco

Não se aplica. Zero migration, zero tabela, zero coluna, zero política RLS. Mudança 100% de client React.

### Validação (zod)

Não se aplica a esta issue. A validação client (metadado + magic bytes) é **gate de UX** e permanece **inalterada** (`validarImagem`/`validarMagicBytes`). A autoridade de validação segue no servidor, dentro das actions (default do lojista sob RLS; variante admin na issue 116). Esta issue não altera nenhum schema nem a lógica de validação.

### Recálculo no Servidor

Não se aplica. Feature de upload de logo — sem valor monetário. O eixo de segurança é autorização/isolamento por tenant, garantido **na Server Action** (o default do lojista deriva a loja do auth sob RLS; a variante admin — issue 116 — valida `lojaId` e usa `service_role` escopado). O componente é só transporte: nunca é a autoridade de escopo. Injetar a action por prop **não abre** vetor novo, porque:
- No fluxo do lojista o default ignora qualquer `loja_id` e deriva a loja do auth.
- No fluxo admin o `lojaId` é fixado por closure no servidor (issue 119), nunca vindo de input do usuário, e re-provado dentro da action admin (`verificarAdminSaaS` + `validarLojaIdAdmin`, issue 116).

**Camada que garante cada invariante:**

| Invariante | Camada |
|-----------|--------|
| Escrita de logo do lojista escopada ao dono | Server Action `salvarLogoLoja` + RLS `lojas_update_proprio` (`auth.uid() = dono_id`). Inalterado — default da prop. |
| Escrita de logo admin escopada à loja-alvo | Server Action admin `salvarLogoAdmin` (issue 116): `verificarAdminSaaS()` + `validarLojaIdAdmin` + `escopo.atualizarLoja`. Fora desta issue. |
| Validação de conteúdo da imagem | Server Action (gate real). Client = gate de UX, inalterado. |

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar (único arquivo):**
- `src/components/painel/UploadLogoLoja.tsx`:
  1. Adicionar `import type { ResultadoSalvarLogo, ResultadoLogo } from "@/lib/actions/logo-contrato";` (tipar as props).
  2. Manter `import { salvarLogoLoja, removerLogoLoja } from "@/lib/actions/logo";` — passam a ser usados **só como default de prop**.
  3. Em `UploadLogoLojaProps`, adicionar `onSalvar?: (formData: FormData) => Promise<ResultadoSalvarLogo>;` e `onRemover?: () => Promise<ResultadoLogo>;`.
  4. Na desestruturação de props, adicionar `onSalvar = salvarLogoLoja, onRemover = removerLogoLoja`.
  5. Em `confirmarCrop`: trocar `await salvarLogoLoja(fd)` por `await onSalvar(fd)`.
  6. Em `removerPreview`: trocar `await removerLogoLoja()` por `await onRemover()`.
  7. Ajustar o comentário do cabeçalho que cita a action fixa (item 3 da doc) para refletir que a action agora é injetável com default do lojista.

**NÃO tocar (fora de escopo desta issue):**
- `src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx` — repasse das props é a issue 118.
- `src/app/admin/assinantes/[lojaId]/configuracao/ConfiguracaoAdminClient.tsx` — injeção admin é a issue 119.
- `src/lib/actions/logo.ts` / `logo-contrato.ts` — actions e contratos permanecem intactos.
- Server Action admin `admin-logo.ts` — issue 116.
- Cropper, preview circular, validação client, copy, área de toque, `components/ui/` (shadcn) — nenhuma mudança de UI.

### Dependências Externas

Nenhuma nova. Continua usando `react-easy-crop`, `sonner`, `lucide-react`, `next/image` já presentes. Zero alteração em `package.json`.

### Ordem de Implementação

Issue **não crítica** (sem dinheiro, sem RLS/tabela nova, sem nova superfície de autorização — só parametriza pontos de chamada preservando o default). TDD red-first **não** é exigido.

1. Adicionar `import type` dos contratos e as duas props opcionais com default.
2. Trocar os dois pontos de chamada (`confirmarCrop`, `removerPreview`) para usar as props.
3. Ajustar o comentário do cabeçalho.
4. Verificação: `tsc` e lint verdes; garantir que o fluxo do lojista permanece observavelmente idêntico (defaults) — reusar `src/lib/actions/logo.test.ts` como rede de regressão das actions default. A cobertura de teste do fluxo admin injetado é responsabilidade da issue crítica 116.
