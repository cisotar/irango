# Spec: Logo da Loja — upload no painel + exibição no cabeçalho da vitrine

**Versão:** 1.0.0 | **Atualizado:** 2026-06-15 | **Status:** IMPLEMENTADO (issues 001–007)

## Visão Geral

Permitir que o dono da loja envie uma imagem de **logo** na aba **Perfil da Loja**
(`/painel/configuracoes/perfil`) e exibir essa logo, dentro de um círculo, no
**cabeçalho da vitrine pública** (`/loja/[slug]`), ao lado do nome da loja.

**Problema que resolve / paridade com o original:** hoje o cabeçalho da vitrine
mostra apenas a primeira letra do nome dentro de um círculo (fallback "P" para
"Pão do Ciso"). O webapp original (`lojinhaonline`) exibe a logo real circular da
loja nesse mesmo lugar (`<img class="logo-cabecalho" 70×70 border-radius:50%>` à
esquerda do nome em caixa-alta). Queremos paridade: substituir o placeholder de
letra pela logo real quando houver, mantendo a letra apenas como fallback.

**Achado central da investigação (reduz drasticamente o escopo):** a infra de
upload+crop de foto de produto **já existe e está completa**, e o componente
`HeaderLoja.tsx` **já suporta** `logoUrl` com renderização circular (70×70, borda
`white/35`, `object-cover`, `https:`-only anti-XSS) e fallback de letra. O que
falta é **só o pipeline de dado**: coluna no banco, uploader na aba perfil, a
Server Action de salvar a logo, a query/view retornar o campo, e a página passar
`logoUrl` ao header. Nenhum visual novo precisa ser inventado.

**Mundos:** painel (auth obrigatório) para o upload; vitrine pública (sem auth)
para a exibição.

---

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (SaaS)** | fornece o pipeline de upload/crop/validação e o storage; valida a imagem no servidor (magic bytes, tamanho, tipo); RLS de bucket isola por loja |
| **Lojista** | envia e recorta a logo da própria loja na aba Perfil; pode substituir/remover |
| **Cliente** | apenas vê a logo no cabeçalho da vitrine; nenhuma ação |

---

## Páginas e Rotas

### Aba Perfil da Loja — `/painel/configuracoes/perfil`
**Mundo:** painel (auth obrigatório)
**Descrição:** abaixo (ou acima) dos campos de nome/WhatsApp/slug, o lojista vê um
bloco "Logo da loja" com preview circular do estado atual (ou dropzone vazia),
botão de enviar/substituir/remover, e o cropper com **máscara circular** ao
selecionar um arquivo.

**Componentes:**
- `PerfilClient.tsx` (existente) — recebe `logoUrlInicial` e renderiza o uploader
- **`UploadLogoLoja.tsx`** (novo, em `components/painel/`) — variante do
  `UploadFotoProduto.tsx`; **reusa a mesma lib de crop** (`react-easy-crop`),
  mesma casca de UI (dropzone, preview, substituir/remover, zoom acessível,
  toasts sonner), mas com `aspect = 1` (1:1), **`cropShape="round"`** e preview
  circular. Chama uma Server Action própria de logo (não a de produto).
  > Antes de criar do zero: avaliar parametrizar `UploadFotoProduto` (props
  > `aspect`, `cropShape`, `action`, `larguraAlvo`, `label`) e reusá-lo. A decisão
  > entre extrair/parametrizar vs. componente irmão fica para o `/plan` — o spec
  > exige **reuso da lib de crop e do fluxo**, não um segundo cropper.
- `Card` / `Label` / `Button` (shadcn/ui, existentes)

**Behaviors:**
- [x] Selecionar arquivo de imagem para a logo — `processarSelecao`. Garantido
  em: **cliente (gate de UX)** com `validarImagem` (tipo/tamanho) +
  `validarMagicBytes` (conteúdo) reusados; **autoridade na Server Action**.
- [x] Recortar/enquadrar a logo em **círculo** (pan + zoom/pinch, `aspect=1`,
  `cropShape="round"`) — `react-easy-crop`. Garantido em: **cliente (preview de
  UX)** — o recorte é estético; o servidor não confia nele.
- [x] Confirmar e enviar — exporta o crop via `exportarCrop` (Blob webp 1:1) e
  chama a Server Action. Garantido em: **Server Action + RLS de Storage**
  (revalida tipo real, tamanho, deriva a loja do auth, escreve em `{loja_id}/`).
- [x] Ver preview circular da logo enviada — estado local. Garantido em: cliente
  (UX); a URL exibida vem da action (já validada).
- [x] Substituir a logo por outra — reabre o cropper. Garantido em: Server Action
  + RLS (mesma autoridade do envio).
- [x] Remover a logo — limpa o campo (`logo_url` → NULL). Garantido em: **Server
  Action + RLS** (UPDATE escopado por `auth.uid() = dono_id` via política
  `lojas_update_proprio`).
- [x] Salvar o perfil — a logo é persistida pela action de logo (independente do
  botão "Salvar" do perfil, mesmo padrão UX da foto de produto). Garantido em:
  Server Action + RLS.

---

### Cabeçalho da Vitrine — `/loja/[slug]`
**Mundo:** vitrine pública (sem auth)
**Descrição:** o círculo do cabeçalho passa a exibir a logo real da loja quando
existir; quando não existir (ou URL não-`https:`), mantém o fallback com a
primeira letra do nome. Layout, tamanho e estilo **já implementados** em
`HeaderLoja.tsx` — só falta a página alimentar `logoUrl`.

**Componentes:**
- `HeaderLoja.tsx` (existente, **sem mudança de markup**) — já trata
  `logo ? <Image circular> : <div letra>` com `logoSeguro` (`https:`-only).
- `page.tsx` da vitrine (existente) — passar `logoUrl={loja.logo_url}` ao
  `HeaderLoja` (nas duas renderizações: normal e "loja indisponível").

**Behaviors:**
- [x] Ver a logo da loja no cabeçalho — leitura SSR. Garantido em: **RLS** —
  leitura pela view `public.vitrine_lojas` (role anon), nunca `public.lojas`.
- [x] Ver fallback de letra quando a loja não tem logo — `logoSeguro` retorna
  null → `<div>` com inicial. Garantido em: cliente (apresentação pura).
- [x] Não renderizar URL insegura (`javascript:`, `http:`) — `logoSeguro`
  (existente). Garantido em: cliente (anti-XSS, seguranca.md §15) — defesa extra;
  a URL persistida já é validada como Storage do iRango no servidor.

---

## Modelos de Dados

### `lojas` — coluna nova (MIGRATION)

```sql
ALTER TABLE lojas ADD COLUMN logo_url text;
```

- Nullable (loja sem logo usa fallback de letra). Sem default.
- Tipo `text` — armazena a URL pública do Storage (mesmo padrão de
  `produtos.foto_url` e da `chave`/QR do Pix).
- **CHECK opcional (defesa em profundidade):** restringir a `https://` —
  consistente com `seguranca.md §15` ("validar protocolo `https:`"). A validação
  autoritativa da URL pertencer ao Storage do iRango fica na Server Action via
  `schemaStorageUrl` (reuso).

### `public.vitrine_lojas` — adicionar `logo_url` à projeção (MIGRATION)

A view é a **única** fonte de leitura anon da loja (`seguranca.md §19`). Precisa
projetar `logo_url` para a vitrine enxergar a logo:

```sql
CREATE OR REPLACE VIEW public.vitrine_lojas
  WITH (security_invoker = false)
AS SELECT
     id, slug, nome, telefone, whatsapp, ativo,
     endereco_rua, endereco_numero, endereco_bairro,
     endereco_cidade, endereco_estado, endereco_cep,
     tema, horarios, timezone,
     logo_url            -- nova coluna projetada (pública por design)
   FROM public.lojas
   WHERE ativo = true;
```

`logo_url` é dado público (a logo aparece na vitrine) — entra na projeção sem
risco; não é coluna sensível (`dono_id`/`assinatura_*`/`hotmart_*`).

### Storage — bucket de logos

Duas opções (decidir no `/plan`); o spec exige RLS escopada por loja em ambos:

- **Opção A — reusar bucket `produtos`** com prefixo de pasta
  (`{loja_id}/logo/{uuid}.webp`). Reusa as policies de Storage já existentes
  (`produtos_insert_propria`, `produtos_update_propria`, `produtos_delete_propria`,
  `produtos_leitura_publica`) sem migration de RLS nova. Menor superfície.
- **Opção B — bucket dedicado `logos`** (espelha o padrão do `pix-qr`/`produtos`):
  exige migration nova com bucket público + 4 policies (leitura pública;
  insert/update/delete escopados por `(storage.foldername(name))[1] IN (SELECT
  id::text FROM lojas WHERE dono_id = auth.uid())`) + `file_size_limit` +
  `allowed_mime_types`, todas com o **guard pglite** (`to_regclass(...) IS NULL →
  RETURN`) já usado nas migrations 010500/012000.

> Recomendação do spec: **Opção A** (reuso máximo, zero RLS nova). A logo é
> conceitualmente outra imagem da loja; o isolamento por `{loja_id}/` já cobre o
> requisito de segurança.

### Tipos gerados

Após a migration, regenerar `src/lib/database.types.ts`
(`npx supabase gen types typescript`) para `lojas.logo_url` e
`vitrine_lojas.logo_url` aparecerem nos tipos. `LojaPublica` e `LojaCompleta`
herdam automaticamente.

---

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| A imagem é realmente uma imagem (não executável disfarçado) | **Server Action** — `validarMagicBytes` sobre o conteúdo real, ignorando o Content-Type declarado (reuso de `validarImagem.ts`) |
| Tipo permitido: JPEG, PNG ou WEBP | **Server Action** (`TIPOS_IMAGEM_PERMITIDOS`) + **CHECK no bucket** (`allowed_mime_types`, defesa-em-profundidade) |
| Tamanho máximo (logo é pequena) | **Server Action** (`TAMANHO_MAXIMO_BYTES`, atual 2 MB) + **CHECK no bucket** (`file_size_limit`). Logo é menor que foto de produto: avaliar `larguraAlvo` menor no `exportarCrop` (ex. 256–320px) para gerar arquivo leve — isso é otimização de UX, não gate de segurança |
| Dimensões pequenas / formato 1:1 | **Cliente (preview)** — cropper `aspect=1` força quadrado; `exportarCrop` exporta `larguraAlvo` controlado. **Não é gate de segurança** (o servidor aceita a imagem dentro do limite de bytes/tipo). Se exigir teto de dimensão autoritativo, decidir no `/plan` |
| Só o dono altera a logo da própria loja | **RLS** — UPDATE de `logo_url` pela política `lojas_update_proprio` (`auth.uid() = dono_id`); escrita no Storage pela policy de insert escopada por `{loja_id}/`. `loja_id` **derivado do auth** (`buscarLojaDoDono`), nunca do payload do client (reuso do padrão de `upload.ts`) |
| Nome do arquivo é UUID, nunca o nome do client | **Server Action** — `crypto.randomUUID()` (path traversal/colisão), padrão de `upload.ts` |
| URL persistida pertence ao Storage do iRango | **Server Action** — `schemaStorageUrl` (reuso de `validacoes/storage.ts`) antes do UPDATE em `lojas` |
| Vitrine lê a logo só de loja ativa | **RLS** — view `vitrine_lojas` filtra `ativo = true` |
| Logo ausente → fallback de letra | **Cliente** (apresentação, `HeaderLoja` existente) |

---

## Segurança (obrigatório)

- **Dado sensível?** A logo é uma imagem pública (aparece na vitrine sem login) —
  não é PII nem segredo. O risco não é confidencialidade, é **integridade do
  upload** (arquivo malicioso, DoS por tamanho) e **autorização** (loja A não
  pode trocar a logo da loja B).
- **Valor monetário?** Não. Sem recálculo de valor envolvido.
- **Validação autoritativa do servidor (não confiar no cliente):**
  - Tipo real por **magic bytes** na Server Action (`validarMagicBytes`) —
    Content-Type declarado é ignorado.
  - Tamanho máximo e whitelist de tipo revalidados na Server Action; reforçados
    no bucket (`file_size_limit` + `allowed_mime_types`).
  - `loja_id` **derivado do auth** (`buscarLojaDoDono`), nunca do FormData.
  - Nome de saída UUID; path relativo ao bucket (`{loja_id}/...`) — nunca
    prefixar com o nome do bucket (armadilha documentada em `seguranca.md §18`).
  - URL persistida validada por `schemaStorageUrl` (pertence ao Storage do
    iRango) antes do UPDATE.
- **Tabela nova?** Não — só coluna nova em `lojas` (sob RLS já existente). A
  política `lojas_update_proprio` já cobre o UPDATE de `logo_url`. **Atenção ao
  trigger `lojas_protege_billing_trg`:** `logo_url` **não** é coluna protegida —
  garantir que a função `lojas_protege_billing()` não bloqueie sua escrita
  (verificar no `/plan`; só billing/`dono_id` são bloqueados).
- **Storage RLS:** Opção A reusa as policies de `produtos` (escopo `{loja_id}/`);
  Opção B exige 4 policies novas escopadas por loja antes de produção
  (`seguranca.md §2/§18`).
- **API externa com key?** Não. Tudo é Supabase Storage/Postgres.
- **XSS:** render da logo já passa por `logoSeguro` (`https:`-only) no
  `HeaderLoja` (`seguranca.md §15`).
- **Erros:** Server Action retorna mensagem genérica; detalhe só no
  `console.error` (`seguranca.md §14`), padrão de `upload.ts`.
- **Rate limit (opcional):** considerar trava por IP na action de upload de logo,
  como em `salvarPerfil` — avaliar no `/plan`.

---

## Reuso explícito da infra existente (não recriar)

| Necessidade | Reusar |
|-------------|--------|
| Lib de crop | `react-easy-crop` (mesma do `UploadFotoProduto.tsx`) — **mudar só `aspect=1` + `cropShape="round"`** |
| Exportar o recorte | `src/lib/utils/exportarCrop.ts` (parametrizar `aspect`/`larguraAlvo`; hoje fixo 4:3) |
| Validação de imagem (tipo/tamanho/magic bytes) | `src/lib/utils/validarImagem.ts` (`validarImagem`, `validarMagicBytes`, constantes) |
| Validação de URL de Storage | `src/lib/validacoes/storage.ts` (`schemaStorageUrl`) |
| Padrão de Server Action de upload | `src/lib/actions/upload.ts` + `upload-contrato.ts` (derivar loja do auth, UUID, magic bytes, path `{loja_id}/`, erro genérico) |
| Query da loja do dono | `src/lib/supabase/queries/lojas.ts` (`buscarLojaDoDono`) |
| Casca de UI do uploader | `src/components/painel/UploadFotoProduto.tsx` (dropzone, preview, substituir/remover, zoom acessível, toasts sonner) |
| Header circular + fallback | `src/components/vitrine/HeaderLoja.tsx` (**sem mudança de markup**) |
| Limites de bucket / guard pglite | migrations `20260614010500` e `20260615012000` (padrão a copiar se for Opção B) |

---

## Critérios de Aceite

1. O lojista consegue, em `/painel/configuracoes/perfil`, enviar uma imagem,
   recortá-la em **círculo** (cropper 1:1) e salvar; o preview mostra a logo
   circular.
2. Após salvar, abrir `/loja/[slug]` exibe a **logo real** no círculo do
   cabeçalho, à esquerda do nome (paridade visual com o original).
3. Loja **sem** logo continua mostrando a **primeira letra** do nome no círculo.
4. Enviar um arquivo não-imagem (ex.: `.exe` renomeado para `.png`) é **rejeitado
   no servidor** por magic bytes — não chega a ser salvo.
5. Arquivo acima do limite de tamanho é rejeitado (Server Action e/ou bucket).
6. Um lojista **não** consegue alterar a logo de outra loja (RLS de `lojas` e de
   Storage) — o `loja_id` vem do auth, não do payload.
7. Remover a logo zera `logo_url` e a vitrine volta ao fallback de letra.
8. `database.types.ts` regenerado; `vitrine_lojas` projeta `logo_url`; a vitrine
   lê via view (nunca `public.lojas`).
9. URL não-`https:` nunca é renderizada no cabeçalho.

---

## Fora do Escopo (v1)

- Logo na landing do SaaS, favicon dinâmico por loja, ou Open Graph image por
  loja (SEO) — follow-up.
- Banner/capa da loja (imagem retangular grande) — feature distinta.
- Múltiplas variantes/tamanhos da logo (responsive srcset) — a logo é pequena e
  única.
- Remoção física do objeto antigo no Storage ao substituir/remover (limpeza de
  órfãos) — o iRango hoje não faz GC de objetos de produto também; tratar como
  débito técnico comum, não nesta feature.
- Mudança de layout/markup do cabeçalho — já está em paridade com o original.
- Teto autoritativo de dimensões em pixels no servidor (além do limite de bytes)
  — só se o `/plan` apontar necessidade real.
```
