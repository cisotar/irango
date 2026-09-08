## Plano Técnico

> **Natureza da issue:** repasse puro (passthrough) de props em UM client component.
> Não há Server Action nova, migration, RLS, tabela, valor monetário nem decisão de
> autorização nesta issue. Toda a autoridade vive nas actions injetadas por quem
> chama (lojista em `page.tsx`, admin na 119). Por isso esta issue é **crítica: NÃO**
> e a matriz cliente↔servidor de valor/permissão **não se aplica aqui** — ver
> "Regra cliente ↔ servidor" abaixo, onde a invariante é registrada com a camada que
> a garante fora deste arquivo.

### Análise do Codebase

O que já existe e será REUSADO (nada novo a criar além das 2 props):

- `src/components/painel/UploadLogoLoja.tsx` (issue 117, já no working tree, não commitada) — já expõe `onSalvar?: (formData: FormData) => Promise<ResultadoSalvarLogo>` e `onRemover?: () => Promise<ResultadoLogo>`, com **defaults do lojista** (`onSalvar = salvarLogoLoja`, `onRemover = removerLogoLoja`, linhas 65-66). `confirmarCrop` chama `onSalvar(fd)`; `removerPreview` chama `onRemover()`. O componente exporta o tipo `UploadLogoLojaProps` (linha 45). **É a única fonte de verdade da assinatura** — vamos derivar dela em vez de redeclarar.
- `src/lib/actions/logo-contrato.ts` — tipos `ResultadoSalvarLogo` / `ResultadoLogo` (fora do módulo `'use server'`). Reusados; **não duplicar**.
- `src/lib/actions/logo.ts` — actions do lojista `salvarLogoLoja` / `removerLogoLoja`. **NÃO serão importadas em `PerfilClient`** (ver decisão abaixo): o default já vive dentro do `UploadLogoLoja`.
- `PerfilClient` já tem o **padrão de props-action opcionais retrocompatíveis** estabelecido: `onSalvar` / `onDefinirPublicacao` (linhas 68-78). As props de logo seguem o mesmo espírito, com uma diferença deliberada (abaixo).
- `src/app/(painel)/painel/configuracoes/perfil/page.tsx` — caller lojista: renderiza `<PerfilClient ... logoUrlInicial={loja.logo_url} />` **sem** as props de logo → cai no default do lojista. **NÃO tocar** (a retrocompatibilidade é justamente não precisar mexer aqui).
- `src/app/admin/assinantes/[lojaId]/configuracao/ConfiguracaoAdminClient.tsx` — caller admin. **NÃO tocar nesta issue** (é responsabilidade da 119 injetar `onSalvarLogo`/`onRemoverLogo`).

Decisão de design — **por que não replicar o default explícito de `onSalvar`/`onDefinirPublicacao`:**
`onSalvar` e `onDefinirPublicacao` recebem default explícito em `PerfilClient` porque são **chamados dentro** do próprio componente (`salvar()`, `alternarPublicacao()`) e precisam de um valor concreto. As actions de logo **não são chamadas** por `PerfilClient` — são só repassadas. Logo, o repasse deve ser **puro**: `onSalvarLogo`/`onRemoverLogo` podem ser `undefined`, e o default de destructuring do próprio `UploadLogoLoja` assume (parâmetro default só dispara quando o valor é `undefined` — repassar `undefined` aciona `salvarLogoLoja`/`removerLogoLoja` corretamente). Isso evita reimportar as actions do lojista em `PerfilClient` (menos acoplamento, mais DRY, alinhado a "passthrough puro; nenhuma decisão de autorização vive aqui").

### Cenários

**Caminho Feliz (lojista — caller `page.tsx`, sem props):**
1. `page.tsx` renderiza `<PerfilClient ...>` sem `onSalvarLogo`/`onRemoverLogo`.
2. `PerfilClient` repassa `onSalvar={undefined}` / `onRemover={undefined}` ao `UploadLogoLoja`.
3. Destructuring default do `UploadLogoLoja` assume `salvarLogoLoja`/`removerLogoLoja`.
4. Salvar/remover logo funciona **idêntico ao comportamento atual** (RLS, loja pelo auth).

**Caminho Feliz (admin — futuro caller da 119, com props):**
1. Caller passa `onSalvarLogo` / `onRemoverLogo` (adapters com `lojaId` fixado via closure).
2. `PerfilClient` repassa intactos ao `UploadLogoLoja` → o componente usa as actions admin.

**Casos de Borda:**
- **Props ausentes** (undefined): default do lojista assume — coberto acima.
- **Só uma das props passada** (ex.: `onSalvarLogo` sem `onRemoverLogo`): cada prop cai no seu próprio default de forma independente (destructuring por-campo). Sem quebra.
- **Sem permissão / loja inativa / falha de rede:** irrelevante para ESTE arquivo — tratado inteiramente na action injetada e já no `UploadLogoLoja` (toast genérico em `confirmarCrop`/`removerPreview`). `PerfilClient` não adiciona lógica de erro.

**Tratamento de Erros:** nenhum novo. Erros de upload/remoção continuam tratados no `UploadLogoLoja` (toast genérico ao usuário; `console.error` server/client conforme já existe — `seguranca.md` §14). `PerfilClient` não intercepta nem loga nada de logo.

### Schema de Banco
Nenhum. A issue não toca dados, migration ou RLS.

### Validação (zod)
Nenhuma nova. A validação de imagem (metadado + magic bytes, gate de UX) já vive no `UploadLogoLoja`; a autoridade é a action injetada. `PerfilClient` não valida nada de logo.

### Recálculo no Servidor
Não se aplica — sem valor monetário.

### Regra cliente ↔ servidor (registro da invariante fora deste arquivo)

| Invariante | Camada que garante (NÃO neste arquivo) |
|-----------|----------------------------------------|
| Escrita da logo do lojista escopada ao dono | Action lojista `salvarLogoLoja` + RLS `lojas_update_proprio` (`auth.uid() = dono_id`) — default das props, inalterado |
| Escrita da logo pelo admin escopada por `lojaId` | Action admin `salvarLogoAdmin`/`removerLogoAdmin` (issue 116) — `verificarAdminSaaS()` + escopo por `lojaId` + `service_role`. Injetada pela issue 119, **não** por esta |
| `loja_id` nunca é autoridade do cliente | Actions ignoram/validam `loja_id` server-side; `PerfilClient` é passthrough e não monta escopo |

`PerfilClient` **não** garante nenhuma invariante de valor/permissão — e por design não deve. O plano está completo porque cada invariante acima está ancorada numa camada server-side (RLS ou Server Action) de outra issue já mapeada.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar (único arquivo):**
- `src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx`
  1. Importar o tipo da assinatura como fonte única de verdade:
     `import { UploadLogoLoja, type UploadLogoLojaProps } from "@/components/painel/UploadLogoLoja";`
     (a linha 21 já importa `UploadLogoLoja`; só acrescentar o `type`).
  2. Adicionar duas props opcionais ao tipo do componente (bloco de props, ~linhas 63-79):
     ```ts
     /** Action de salvar a logo. Default (ausente): action do lojista via UploadLogoLoja. */
     onSalvarLogo?: UploadLogoLojaProps["onSalvar"];
     /** Action de remover a logo. Default (ausente): action do lojista via UploadLogoLoja. */
     onRemoverLogo?: UploadLogoLojaProps["onRemover"];
     ```
     (Derivar de `UploadLogoLojaProps` mantém a assinatura em sincronia automática com a 117. Alternativa equivalente aceita pela issue: tipar direto com `ResultadoSalvarLogo`/`ResultadoLogo` de `logo-contrato.ts`. Preferir a derivação por ser mais DRY.)
  3. Repassar no JSX (linha ~274):
     ```tsx
     <UploadLogoLoja
       logoUrlInicial={logoUrlInicial}
       onSalvar={onSalvarLogo}
       onRemover={onRemoverLogo}
     />
     ```
     **Sem** default nos parâmetros de `PerfilClient` (repasse de `undefined` é intencional — o default vive no `UploadLogoLoja`).

**NÃO tocar:**
- `src/components/painel/UploadLogoLoja.tsx` — já pronto pela 117.
- `src/app/(painel)/painel/configuracoes/perfil/page.tsx` — a retrocompat prova-se por ele **não** mudar.
- `src/app/admin/assinantes/[lojaId]/configuracao/ConfiguracaoAdminClient.tsx` — injeção admin é a issue 119.
- `src/lib/actions/logo.ts`, `logo-contrato.ts`, `admin-logo.ts` — fora do escopo (issue 116).
- `src/components/ui/*` (shadcn) — não se edita à mão.

### Dependências Externas
Nenhuma. Sem novos pacotes, sem API externa.

### Ordem de Implementação
Issue **não crítica** (passthrough puro, sem enforcement de valor/permissão aqui) → não exige TDD red-first. A cobertura crítica (cross-tenant, defaults do lojista, `lojaId` inválido) vive nos testes das actions admin (issue 116, `admin-logo.test.ts`, já presente no working tree) e no comportamento verificado ponta-a-ponta pela 119.

1. Depende de 117 (já no working tree). Confirmar que `UploadLogoLoja` exporta `UploadLogoLojaProps` com `onSalvar`/`onRemover` (confirmado).
2. Editar `PerfilClient.tsx` (import do tipo, 2 props, repasse no JSX).
3. `npx tsc --noEmit` + lint verdes.
4. Sanidade manual: `/painel/configuracoes/perfil` salva/remove logo como antes (default do lojista, sem props).
5. Desbloqueia a issue 119 (injeção admin em `ConfiguracaoAdminClient`).
