## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (nada novo de UI, nada novo de servidor):**

- `src/app/admin/assinantes/actions/admin-logo.ts` (116, working tree) — `salvarLogoAdmin(formData)` lê `loja_id` do FormData e o arquivo em `CAMPO_ARQUIVO`; `removerLogoAdmin(lojaId)` recebe o `lojaId` explícito. Devolvem `ResultadoSalvarLogo`/`ResultadoLogo`. **Toda a autoridade** (`validarLojaIdAdmin`, `prepararContextoAdmin`/`verificarAdminSaaS`, `validarBlobImagem`, path server-side, `schemaStorageUrl`, `escopo.atualizarLoja` allowlist) já vive aqui. A 119 só as **importa e injeta** — não as altera.
- `src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx` (118) — já expõe as props `onSalvarLogo?: UploadLogoLojaProps["onSalvar"]` e `onRemoverLogo?: UploadLogoLojaProps["onRemover"]` (linhas 73–87) e já as repassa ao `<UploadLogoLoja onSalvar={onSalvarLogo} onRemover={onRemoverLogo} />` (linhas 285–286). Basta o `ConfiguracaoAdminClient` passar os adapters.
- `src/components/painel/UploadLogoLoja.tsx` (117) — `onSalvar?: (formData: FormData) => Promise<ResultadoSalvarLogo>` (default `salvarLogoLoja`), `onRemover?: () => Promise<ResultadoLogo>` (default `removerLogoLoja`). Em `confirmarCrop` (linha 129) **monta o `FormData`, faz `fd.append(CAMPO_ARQUIVO, blob, "logo.webp")` e chama `onSalvar(fd)`**; em `removerPreview` (linha 163) chama `onRemover()`. Sem mudança.
- `src/app/admin/assinantes/[lojaId]/configuracao/ConfiguracaoAdminClient.tsx` — o adapter `enviarQrPix` (linhas 80–91, via `useCallback`, `formData.set("loja_id", lojaId)`) é o **padrão a espelhar**. `page.tsx` já passa `logoUrlInicial={loja.logo_url}` (linha 68) e o `ConfiguracaoAdminClient` já recebe `lojaId` e `logoUrlInicial` — nenhuma prop nova de página é necessária.
- `CAMPO_ARQUIVO` de `@/lib/actions/upload-contrato` — nome do campo do arquivo, já compartilhado entre `UploadLogoLoja` e `salvarLogoAdmin` (contrato idêntico ao do lojista). O adapter **não toca** nesse campo.
- Tipos `ResultadoSalvarLogo`/`ResultadoLogo` de `@/lib/actions/logo-contrato` — mesma forma nas actions admin e lojista; por isso o adapter é trivial (encaminha o resultado sem remapear).

**O que precisa ser criado:** apenas os dois adapters finos dentro do `ConfiguracaoAdminClient` + a passagem ao `PerfilClient` + o teste RED. Nenhum arquivo novo de produção.

**Diferença-chave vs. `enviarQrPix` (evita duplicar lógica de FormData):** o `UploadLogoLoja` **já monta** o `FormData` com o blob e chama `onSalvar(fd)`. Logo o `onSalvarLogo` **recebe** o FormData pronto — o adapter só injeta `loja_id` e encaminha. Não recriar o FormData nem re-anexar o arquivo (seria duplicar o que o componente já faz e arriscar divergência no nome do campo).

### Cenários

**Caminho Feliz:**
1. Admin abre `/admin/assinantes/[lojaId]/configuracao`; `page.tsx` passa `logoUrlInicial` e `lojaId`.
2. `ConfiguracaoAdminClient` injeta `onSalvarLogo`/`onRemoverLogo` no `PerfilClient`, que os repassa ao `UploadLogoLoja`.
3. Admin recorta e confirma → `UploadLogoLoja` monta `fd` (arquivo em `CAMPO_ARQUIVO`) e chama `onSalvarLogo(fd)`.
4. O adapter faz `fd.set("loja_id", lojaId)` e chama `salvarLogoAdmin(fd)`; a action valida admin + escopo e devolve `{ ok, logo_url }`.
5. Admin clica remover → `onRemoverLogo()` → `removerLogoAdmin(lojaId)` → `{ ok:true }`; `logo_url` zerada só na loja-alvo.

**Casos de Borda:**
- **`lojaId` inválido/ausente na URL:** a rota `[lojaId]` sempre fornece o segmento; ainda assim `validarLojaIdAdmin` (na action, 116) rejeita não-UUID com `{ ok:false }` sem efeito — o client não é autoridade.
- **Admin também é dono de outra loja (vetor cross-tenant):** o `loja_id` do FormData é **sempre** o da URL (closure), nunca o auth; a action escopa por `.eq("id", lojaId)`. O default do lojista (`salvarLogoLoja`, que derivaria a loja do auth) **nunca** é referenciado no caminho admin.
- **Não-admin:** `verificarAdminSaaS()` na action (fora do try, fail-closed) barra — invariante garantida no servidor, independente do client.
- **Falha de rede/erro interno:** a action devolve `{ ok:false, erro: genérico }`; `UploadLogoLoja` já mostra toast genérico ("Não foi possível salvar a logo. Tente novamente.") sem vazar detalhe.
- **Loja inativa/sem logo:** remover com `logo_url` já nula é UPDATE idempotente `{ logo_url: null }` — sem erro.

**Tratamento de Erros:** inalterado — mensagem genérica ao usuário via toast do `UploadLogoLoja`; detalhe só em `console.error` dentro das actions admin (`seguranca.md` §14). O adapter não intercepta nem loga.

### Schema de Banco
Nenhuma migration, tabela, coluna ou política RLS nova. `lojas.logo_url` e o bucket `produtos` já existem. Sob `service_role` a defesa **não é RLS** — é `verificarAdminSaaS()` + escopo por `lojaId` + path server-side, tudo já implementado na 116. A 119 é pura fiação de UI.

### Validação (zod)
Nenhum schema novo. A validação de imagem (metadado + magic bytes) é gate de UX no `UploadLogoLoja` e autoridade em `validarBlobImagem` na action (116). O adapter não valida nada.

### Recálculo no Servidor
Não se aplica — a feature não toca valor monetário. O eixo de segurança é **autorização + isolamento por tenant**, garantido 100% no servidor pela `admin-logo.ts` (116). O único dado que o client "envia" é o arquivo (revalidado server-side) e o `loja_id` — que o servidor **revalida** com `validarLojaIdAdmin` e usa como única autoridade de escopo, ignorando o auth do admin.

### Regra cliente ↔ servidor (mapa de enforcement)

| Invariante | Camada que garante |
|-----------|--------------------|
| Escrita da logo só por admin SaaS | **Server Action** `salvarLogoAdmin`/`removerLogoAdmin` — `verificarAdminSaaS()` (116), fail-closed. O adapter client é só transporte. |
| Escrita escopada na loja-alvo (não na do admin) | **Server Action** — `loja_id` da URL validado + `escopo.atualizarLoja` `.eq("id", lojaId)` (116). Client fixa `lojaId` por closure, mas **não é autoridade**. |
| Imagem é imagem real | **Server Action** — `validarBlobImagem` (116); client valida só como UX. |
| Isolamento no Storage | **Server Action** — path `${lojaId}/logo/${uuid}` server-side (116). |

O plano **não** cria enforcement novo; ele **fecha a fiação** para que o enforcement já existente da 116 seja de fato exercido em vez do default do lojista. O risco desta issue é exatamente recair no default → por isso o teste RED prova o roteamento para a action admin.

### Implementação (adapters no `ConfiguracaoAdminClient`)

Dentro do componente, no mesmo estilo de `enviarQrPix`:

```tsx
import { salvarLogoAdmin, removerLogoAdmin } from "@/app/admin/assinantes/actions/admin-logo";

// onSalvarLogo: o UploadLogoLoja JÁ montou o FormData com o arquivo em CAMPO_ARQUIVO;
// aqui só fixamos o loja_id da URL (closure) e encaminhamos para a action admin.
const onSalvarLogo = useCallback<NonNullable<PerfilProps["onSalvarLogo"]>>(
  (formData) => {
    formData.set("loja_id", lojaId);
    return salvarLogoAdmin(formData);
  },
  [lojaId],
);

const onRemoverLogo = useCallback<NonNullable<PerfilProps["onRemoverLogo"]>>(
  () => removerLogoAdmin(lojaId),
  [lojaId],
);
```

E no JSX: `<PerfilClient ... onSalvarLogo={onSalvarLogo} onRemoverLogo={onRemoverLogo} />`.
(Tipar via `UploadLogoLojaProps["onSalvar"]`/`["onRemover"]` reusados pelo `PerfilClient` — sem tipo novo. `lojaId` sempre da closure; o client nunca decide o tenant.)

### Cenário RED (TDD — issue crítica, red-first OBRIGATÓRIO)

**Arquivo:** `src/app/admin/assinantes/[lojaId]/configuracao/ConfiguracaoAdminClient.test.tsx` (novo).

**Infra:** `environment: node`, sem jsdom/@testing-library (confirmado em `vitest.config.ts` e no comentário de `ProdutosClient.test.tsx`). Não há como simular clique no DOM — a prova de wiring é feita **capturando as props injetadas no `PerfilClient` e invocando-as**, então asserindo qual action foi chamada (mesma limitação/estratégia honesta do projeto).

**Estratégia de mock (para não arrastar `server-only` das actions/child clients):**
- `vi.mock` do módulo do `PerfilClient` por um stub que **captura** `onSalvarLogo`/`onRemoverLogo` em variáveis do teste (o stub retorna `null`, não renderiza a árvore real).
- `vi.mock` dos demais child clients importados pelo `ConfiguracaoAdminClient` (`HorariosClient`, `TemaClient`, `EntregasClient`, `PagamentosClient`) por stubs vazios — evita carregar suas cadeias `server-only`.
- `vi.mock` de **todos** os módulos de action admin que o arquivo importa (`admin-perfil`, `admin-publicar`, `admin-horarios-tema`, `admin-entrega`, `admin-pagamento` **e** `admin-logo`) com `vi.fn()` — inclusive `salvarLogoAdmin`/`removerLogoAdmin` retornando `{ ok:true, logo_url:"..." }` / `{ ok:true }`.
- `vi.mock` de `@/lib/actions/logo` (`salvarLogoLoja`/`removerLogoLoja` como `vi.fn`) para asserir que os **defaults do lojista NUNCA são chamados** no caminho admin.

**Asserções (falham HOJE porque o `ConfiguracaoAdminClient` ainda não importa `admin-logo` nem passa as props → props capturadas são `undefined`):**
1. Após `renderToStaticMarkup(<ConfiguracaoAdminClient ... lojaId={LOJA_ALVO} />)`, `onSalvarLogo` capturado é **definido** (hoje: `undefined` → RED).
2. Invocar `onSalvarLogo(fd)` com um `FormData` que tem o arquivo em `CAMPO_ARQUIVO` → `salvarLogoAdmin` foi chamado **1x** com um `FormData` cujo `get("loja_id") === LOJA_ALVO`; e `salvarLogoLoja` (default lojista) **nunca** foi chamado (cobre spec §Cenários 2 e 3).
3. Invocar `onRemoverLogo()` → `removerLogoAdmin` chamado **1x** com `LOJA_ALVO`; `removerLogoLoja` **nunca** chamado.
4. (Robustez do escopo) o `loja_id` do FormData vem da **closure/URL**, não de qualquer valor pré-existente no FormData — o teste pode pré-setar `loja_id` errado no `fd` e asserir que o adapter o **sobrescreve** com `LOJA_ALVO` via `fd.set`.

Confirmar a falha com output real **antes** do GREEN e anexar à issue (precedente `admin-logo.test.ts`).

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/app/admin/assinantes/[lojaId]/configuracao/ConfiguracaoAdminClient.tsx` — importar `salvarLogoAdmin`/`removerLogoAdmin`, criar os dois adapters `useCallback`, passá-los ao `PerfilClient`. Único arquivo de produção.

**Criar:**
- `src/app/admin/assinantes/[lojaId]/configuracao/ConfiguracaoAdminClient.test.tsx` — teste RED de wiring (acima).

**NÃO tocar:**
- `admin-logo.ts` (116), `UploadLogoLoja.tsx` (117), `PerfilClient.tsx` (118) — contratos já prontos; alterar reabriria issues fechadas.
- `page.tsx` da rota — já passa `logoUrlInicial`/`lojaId`.
- `lib/actions/logo.ts` e painel do lojista — comportamento inalterado (defaults).
- `components/ui/` (shadcn) — não se edita à mão.

### Dependências Externas
Nenhuma nova. `react` (`useCallback`), `vitest` + `react-dom/server` (já no projeto). Sem pacote/API novo.

### Ordem de Implementação
1. **RED (`/tdd`):** criar `ConfiguracaoAdminClient.test.tsx` e confirmar a falha real (props não injetadas / action admin não chamada). **Obrigatório antes do código de produção** — é a fiação que fecha o cross-tenant; um erro silencioso aqui reintroduz a escrita na loja errada.
2. **GREEN (`/execute`):** adicionar os dois adapters e a passagem ao `PerfilClient`; mínimo para o teste passar.
3. **Verde total:** `npm test` (`vitest run`) + `next build` (client component não sofre a restrição de `"use server"`, mas o build valida a árvore de imports admin↔client).
4. **`/verify`:** admin salva/remove a logo da loja-alvo em `/admin/assinantes/[lojaId]/configuracao`; painel do lojista segue com defaults.

### Riscos
- **Recair no default do lojista (o bug):** mitigado pelo teste RED asserir explicitamente `salvarLogoAdmin`/`removerLogoAdmin` chamados e `salvarLogoLoja`/`removerLogoLoja` **não** chamados.
- **Nome do campo do arquivo divergir:** mitigado por reusar `CAMPO_ARQUIVO` (mesmo contrato client↔action); o adapter não recria o FormData nem o campo do arquivo.
- **`server-only` quebrar o teste no import:** mitigado mockando todos os child clients e módulos de action que o `ConfiguracaoAdminClient` importa.
