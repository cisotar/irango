# Spec: Envio de Foto de Produto pelo Lojista

**Versão:** 0.3.0 | **Atualizado:** 2026-06-15

> **Spec de DELTA.** Boa parte da infra já existe (bucket, RLS de Storage, coluna `produtos.foto_url`, utils puros de validação de imagem, renderização na vitrine, padrão de upload `UploadQrPix`). Este spec especifica **somente o que falta** para o lojista enviar a foto pelo painel e ela ser persistida com segurança. Tudo que está em "Infra já existente" é dado de entrada — **não re-especificar**.
>
> **Mudança v0.1.0 → v0.2.0:** revisão de segurança encontrou que a validação de tamanho/tipo/conteúdo planejada era **100% client-side e bypassável**, e que o bucket `produtos` **não tem `file_size_limit` nem `allowed_mime_types`** (zero enforcement server-side hoje). A decisão arquitetural foi revertida: **upload roteado por Server Action** (servidor valida tamanho + magic bytes reais antes de subir), processamento client-side da imagem antes do envio, e `file_size_limit` no bucket como defesa-em-profundidade.
>
> **Mudança v0.2.0 → v0.3.0:** adicionado **crop client-side com `react-easy-crop`**, travado em **4:3** (= aspect do card da vitrine). O lojista enquadra a foto (pinch-zoom no celular); o crop é exportado direto em ~1280×960, o que **substitui** o passo separado de "reduzir lado maior". Motivo: a vitrine usa `object-cover` num box 4:3, que hoje corta a foto pelo centro de forma cega — o crop devolve o controle de enquadramento ao lojista (produto na borda deixa de ser cortado). Detalhe nas seções correspondentes.

---

## Visão Geral

Hoje o lojista cadastra/edita produto pelo painel mas **não consegue enviar uma foto** — o `FormProduto` não tem campo de imagem, e nem o `schemaProduto` nem as actions `criarProduto`/`atualizarProduto` aceitam/gravam `foto_url`. A vitrine pública já renderiza `foto_url` quando presente, então hoje ela cai sempre no placeholder.

Esta feature liga as pontas que faltam, com a validação de segurança na camada certa (servidor):

1. **UI (cliente):** campo de upload de foto integrado ao `FormProduto`, com preview, substituir e remover. Ao selecionar, o lojista **enquadra a foto num crop 4:3** (`react-easy-crop`, pinch-zoom no celular); o crop é **exportado em ~1280×960 webp**, o que resolve enquadramento, dimensão e peso de uma vez (foto de celular de 4000px/vários MB vira ~150-300KB no aspect certo). Validação client-side de tipo/tamanho/magic bytes é **gate de UX** (feedback rápido), não autoridade.
2. **Upload (servidor):** o arquivo (já cropado e reduzido) é enviado a uma **Server Action** (`enviarFotoProduto`), que deriva `loja_id` do dono, **revalida tamanho e magic bytes no servidor** (autoridade, não-bypassável), sobe ao bucket `produtos` em `{loja_id}/{uuid}.{ext}` e devolve a `foto_url`.
3. **Persistência (servidor):** `schemaProduto` ganha `foto_url` opcional, **validado como URL pertencente ao Storage do iRango** (refine `startsWith(STORAGE_URL_PREFIX)`); `criarProduto`/`atualizarProduto` persistem o campo.

**Mundo:** painel do lojista (`/painel/*`, auth obrigatório). **Nenhuma mudança na vitrine pública** — ela já consome `foto_url`.

---

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|--------------------|
| **iRango (SaaS)** | fornece bucket + RLS de Storage; **valida tamanho + conteúdo real (magic bytes) no servidor**; valida a URL persistida; deriva `loja_id` do dono |
| **Lojista** | seleciona, substitui e remove a foto do próprio produto no painel |
| **Cliente** | apenas consome — vê a foto na vitrine (fora do escopo deste delta) |

---

## Infra já existente (dado de entrada — NÃO re-especificar)

| Item | Onde | Status |
|------|------|--------|
| Bucket `produtos` (público p/ leitura) + RLS escopada por `loja_id` (path `{loja_id}/...`, INSERT/UPDATE/DELETE só do dono) | `supabase/migrations/20260614010500_storage_bucket_produtos.sql`; `seguranca.md` §18 | pronto |
| Coluna `produtos.foto_url text null` + tipos gerados | `schema.md` §produtos; `src/lib/database.types.ts`; `src/types/supabase.ts` | pronto |
| Renderização de `foto_url` na vitrine | `src/components/vitrine/SecaoCatalogo.tsx`; `src/app/(publica)/loja/[slug]/page.tsx` | pronto |
| Utils **puros** de validação de imagem (tipo+tamanho, magic bytes JPEG/PNG/WEBP) — feitos para rodar no client E no servidor | `src/lib/utils/validarImagem.ts` (`validarImagem`, `validarMagicBytes`, `TIPOS_IMAGEM_PERMITIDOS`, `TAMANHO_MAXIMO_BYTES`) | pronto — **reusar no servidor** |
| `foto_url` no `schemaProduto` (refine de Storage, `""`→`null`) + módulo neutro `STORAGE_URL_PREFIX`/`schemaStorageUrl` | `src/lib/validacoes/produto.ts`; `src/lib/validacoes/storage.ts` (issue 072) | pronto — não recriar |
| Padrão de UI de upload (preview/substituir/remover) | `src/components/painel/UploadQrPix.tsx` | pronto — **espelhar a UI**, mas trocar o transporte (ver Decisão arquitetural) |

### ⚠️ Lacunas de infra descobertas na revisão (precisam ser fechadas nesta feature)

1. **Bucket `produtos` não tem `file_size_limit` nem `allowed_mime_types`.** A migration `20260614010500` só cria o bucket e as 4 policies de path. Hoje, qualquer arquivo de qualquer tamanho/tipo passa pela RLS (que só checa o primeiro segmento do path). A validação 2MB/tipo da v0.1.0 era **só no cliente** → bypassável por chamada direta a `storage.upload()`.
2. **Não há validação de conteúdo real (magic bytes) no servidor.** `UploadQrPix` valida magic bytes no cliente, antes do upload client-direct — defesa de UX, não de segurança.

### Decisão arquitetural — REVISADA (v0.2.0)

**v0.1.0 dizia:** upload client-direct ao Storage (espelhar `UploadQrPix`), **não** a Server Action — porque a action `uploadFotoProduto` exigia `produtoId`.

**v0.2.0 reverte:** **o upload é roteado por uma Server Action** (`enviarFotoProduto`). Motivos:

- **Segurança não-bypassável:** o requisito "garantir que o arquivo é uma imagem real, não um arquivo malicioso disfarçado" **exige o servidor no caminho do upload**. `allowed_mime_types` do bucket não basta — ele checa o `Content-Type` *declarado pelo cliente* (spoofável). Magic bytes reais só dão garantia se os bytes passarem pelo servidor.
- **`produtoId` não é mais empecilho:** o defeito da action antiga `uploadFotoProduto` era exigir `produtoId` (não existe no fluxo de *criar*). A action nova sobe em `{loja_id}/{uuid}.{ext}` — **não precisa de `produtoId`**. `loja_id` é derivado do dono (`buscarLojaDoDono`), nunca do path do cliente.
- **RLS continua valendo** como defesa-em-profundidade: a Server Action usa o client Supabase autenticado (sessão), então a policy `produtos_insert_propria` ainda checa `auth.uid()`.

> **Código morto a remover:** `src/lib/actions/upload.ts:uploadFotoProduto` (a versão `produtoId`-based) fica sem chamador. Marcar para remoção pelo `auditar`/`documentar`. A action nova (`enviarFotoProduto`) pode viver no mesmo arquivo.

---

## Páginas e Rotas

### Form de Produto (criar/editar) — `/painel/cardapio` (modal/drawer) e `/painel/produtos/*`

**Mundo:** painel (auth obrigatório)

**Descrição:** o lojista, ao criar ou editar um produto, vê um novo campo "Foto do produto". Pode selecionar uma imagem (JPEG/PNG/WEBP), **enquadrá-la num crop 4:3**, ver o preview imediato, substituí-la ou removê-la. Ao confirmar o crop, o cliente exporta a imagem em ~1280×960 e a envia à Server Action, que valida e devolve a `foto_url`. Ao salvar o produto, a `foto_url` vai no payload e é persistida junto dos demais campos.

**Componentes:**
- `FormProduto.tsx` (existente — modificar) — recebe `lojaId` por prop (servidor); integra o campo de upload; guarda `foto_url` em estado; inclui no payload de `salvar()`.
- `UploadFotoProduto.tsx` (**novo** client component) — espelha a **UI** de `UploadQrPix` (preview/substituir/remover) mas com crop + transporte por action: (1) valida tipo/tamanho/magic bytes como gate de UX; (2) abre o **cropper 4:3** (`react-easy-crop`) com pinch-zoom; (3) ao confirmar, exporta o crop via canvas em ~1280×960 webp (`Blob`); (4) envia o Blob à Server Action `enviarFotoProduto`; (5) recebe a `foto_url` validada e chama `onUploadConcluido(url)`. **Não** sobe direto ao Storage e **não** monta a URL no cliente.
- `enviarFotoProduto` (**nova** Server Action) — deriva `loja_id` do dono; revalida `validarImagem` (tamanho/tipo) + `validarMagicBytes` (conteúdo) sobre o buffer recebido; sobe ao bucket `produtos` em `{loja_id}/{uuid}.{ext}` com o client autenticado; retorna `{ ok, foto_url }` ou `{ ok:false, erro }`.
- util de export do crop (canvas) — **novo** (`src/lib/utils/exportarCrop.ts` ou similar) — recebe a imagem + `croppedAreaPixels` do `react-easy-crop`, devolve `Blob` 4:3 em ~1280×960 webp. Substitui o "reduzir lado maior" da v0.2.0 (o crop já define o tamanho-alvo).
- shadcn/ui: `Button`, `Label`, `next/image` (mesmo conjunto de `UploadQrPix`); `react-easy-crop` (dep nova) para o cropper.

> O `FormProduto` precisa receber `lojaId` por prop (derivado no servidor pela página/`buscarLojaDoDono`). Hoje recebe `lojaSlug`; adicionar `lojaId` à assinatura. O `lojaId` serve de fallback/contexto — a Server Action **re-deriva** `loja_id` do dono de qualquer forma, nunca confia no que vem do cliente.

**Behaviors:**
- [x] **Selecionar e enquadrar (crop 4:3)** — abre o seletor; cliente valida tipo+tamanho+magic bytes (UX); abre o cropper 4:3 (`react-easy-crop`, pinch-zoom); ao confirmar, exporta ~1280×960 webp e envia à Server Action. Garantido em: **cliente (UX/crop)** + **Server Action (autoridade: revalida tamanho 2MB + magic bytes reais)** + **RLS do bucket** (escrita só na pasta da própria loja) + **`file_size_limit` do bucket** (teto final).
- [x] **Ver preview da foto** — exibe a `foto_url` devolvida pela Server Action via `next/image`. Garantido em: **cliente (UX)**.
- [x] **Substituir a foto** — re-seleciona, re-enquadra e reenvia (novo `uuid`). Garantido em: **cliente (UX)** + **Server Action** + **RLS do bucket**.
- [x] **Remover a foto** — limpa o preview e zera `foto_url` no payload (string vazia → `null` na action). Garantido em: **cliente (UX)** + **Server Action** (`schemaProduto` persiste `foto_url = null`).
- [x] **Salvar produto com foto** — `foto_url` entra no payload de `criarProduto`/`atualizarProduto`. Garantido em: **Server Action + RLS** — `schemaProduto` revalida a URL (refine de Storage) e persiste; `loja_id` derivado do dono.

---

## Modelos de Dados

Nenhuma migration de tabela nova. A coluna já existe:

```sql
-- produtos (schema.md §produtos) — JÁ EXISTE
foto_url text  -- nullable
```

**Migration nova (Storage, defesa-em-profundidade):** atualizar o bucket `produtos` com `file_size_limit` e `allowed_mime_types`.

```sql
-- Fechar a lacuna: hoje o bucket aceita qualquer tamanho/tipo.
UPDATE storage.buckets
SET file_size_limit = 2097152,  -- 2 MB (= TAMANHO_MAXIMO_BYTES)
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id = 'produtos';
```

> Mesmo com `allowed_mime_types` (checa o tipo *declarado*), a garantia de "conteúdo é imagem real" vem da **Server Action** (magic bytes sobre os bytes). O bucket é teto/rede de segurança, não a defesa primária. Migration segue o GUARD pglite das migrations de Storage existentes (pula se `storage.objects` não existe no harness de testes).

RLS de Storage (`seguranca.md` §18) já cobre escrita escopada por `{loja_id}/` e leitura pública. **Nenhuma política RLS nova.**

---

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| `foto_url` é opcional — produto sem foto continua válido (vitrine usa placeholder) | zod (`schemaStorageUrl.nullish()` + `preprocess "" → null`, issue 072) + coluna `nullable` |
| Imagem só JPEG/PNG/WEBP | **cliente** (`validarImagem`, gate de UX) + **Server Action** (`validarImagem` + `validarMagicBytes` sobre o conteúdo real) + **`allowed_mime_types` do bucket** (teto) |
| Imagem ≤ 2MB | **Server Action** (`validarImagem` sobre o buffer recebido — autoridade) + **`file_size_limit` do bucket** (teto). Cliente exporta o crop em ~1280×960 webp antes, então na prática fica muito abaixo |
| Arquivo é uma imagem real (não malicioso disfarçado) | **Server Action** (`validarMagicBytes` — inspeciona os bytes, ignora o `Content-Type` declarado). **Único ponto que garante isto** |
| Foto enquadrada em 4:3 e exportada a ~1280×960 antes de subir | **cliente** (`react-easy-crop` + canvas; UX/enquadramento/peso/perf da vitrine — não é regra de segurança) |
| `foto_url` persistida **deve** ser URL do Storage do iRango (anti-injeção de URL externa) | **Server Action** — `schemaProduto` revalida via `refine(startsWith(STORAGE_URL_PREFIX))`. Bloqueia domínio externo e protocolo `javascript:` (`.url()` sozinho **aceita** `javascript:` — quem barra é o refine) |
| Foto escrita só na pasta da própria loja (`{loja_id}/`) | **Server Action** (`loja_id` derivado de `buscarLojaDoDono`) + **RLS do bucket** (`produtos_insert_propria`, §18) |
| `loja_id` do produto e do path derivado do dono, nunca do payload/cliente | **Server Action** (`buscarLojaDoDono`) |

### Onde está a verdade (cliente ↔ servidor)

- **Preview, crop e redução (cliente):** a imagem exibida, o enquadramento 4:3 e o export a ~1280×960 são UX/otimização. Não são confiados pelo servidor — a action revalida bytes e tamanho do que efetivamente chega.
- **Valor autoritativo (servidor):** **garantido em: Server Action + RLS + limites do bucket.**
  - No **upload**: a Server Action revalida tamanho (`validarImagem`) e **conteúdo real** (`validarMagicBytes`) antes de subir. Um arquivo não-imagem, ou acima de 2MB, é rejeitado — nada é gravado no Storage.
  - No **save**: `schemaProduto.safeParse` revalida que `foto_url` (quando presente) pertence ao Storage do iRango antes de qualquer `INSERT`/`UPDATE`. URL externa, `javascript:` são rejeitadas.

> **Limite conhecido (aceito):** o refine `startsWith(STORAGE_URL_PREFIX)` garante "é uma URL do Storage do iRango", mas **não** restringe a `loja_id`/bucket específico — uma URL apontando para a pasta de outra loja (no bucket público) passaria no refine. Impacto é **baixo**: o bucket é público (a imagem já é legível por qualquer um) e o upload real é escopado por `loja_id` (RLS + derivação no servidor), então um lojista não consegue *escrever* fora da própria pasta — no máximo *referenciar* uma URL pública alheia. Endurecer o refine para `produtos/{loja_id_do_dono}/` é follow-up de baixa prioridade. **A redação anterior ("anti cross-loja") era imprecisa e foi corrigida.**

---

## Delta a implementar (resumo objetivo)

1. **Migration de Storage** — `UPDATE storage.buckets SET file_size_limit, allowed_mime_types WHERE id='produtos'` (com GUARD pglite). Fecha a lacuna de enforcement de tamanho/tipo no bucket.
2. **`react-easy-crop`** (dep nova) + **`src/lib/utils/exportarCrop.ts`** (novo) — o cropper trava 4:3; o util recebe imagem + `croppedAreaPixels` e exporta `Blob` ~1280×960 webp via canvas (substitui o "reduzir lado maior" da v0.2.0).
3. **`enviarFotoProduto`** (nova Server Action, em `src/lib/actions/upload.ts` ou `produto.ts`) — recebe o arquivo (FormData); deriva `loja_id` via `buscarLojaDoDono`; lê o buffer; revalida `validarImagem` (tamanho/tipo) + `validarMagicBytes` (conteúdo); sobe a `{loja_id}/{uuid}.{ext}` com o client autenticado; retorna `{ ok, foto_url }` ou erro genérico (`seguranca.md` §14). `ext` derivada do tipo validado (será `webp` após o export), **nunca** de `file.name`.
4. **`src/components/painel/UploadFotoProduto.tsx`** (novo) — UI espelhando `UploadQrPix` (preview/substituir/remover) + cropper 4:3; valida (UX) → crop (`react-easy-crop`) → export (`exportarCrop`) → envia à `enviarFotoProduto` → guarda a `foto_url` retornada.
5. **`src/components/painel/FormProduto.tsx`** — receber `lojaId` por prop; renderizar `UploadFotoProduto`; guardar `foto_url` em estado; incluir no `montarPayload()`.
6. **Página(s) que renderizam `FormProduto`** — passar `lojaId` (derivado no servidor) além do `lojaSlug`.
7. **Remover** `uploadFotoProduto` (action antiga `produtoId`-based) — sem chamador após esta feature. Confirmar com `auditar`/`documentar`.
8. **`next.config`** — se o teto de 2MB for relevante, garantir `serverActions.bodySizeLimit: '2mb'` (com redução client-side os payloads ficam <500KB, mas alinhar o teto evita rejeição prematura do Next antes da nossa validação).

> **Já feito (issue 072):** `foto_url` no `schemaProduto` (com `preprocess "" → null` e `.nullish()`), módulo `storage.ts` (`STORAGE_URL_PREFIX`/`schemaStorageUrl`), `criarProduto`/`atualizarProduto` persistindo via `...parsed.data`. **Não re-especificar nem reimplementar.**

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** arquivo de imagem (sem PII estruturada) e uma URL pública de Storage. Sem chave Pix, sem dado de cliente.
- **Valor monetário?** Não. Nenhum recálculo de valor.
- **Validação de tamanho/conteúdo é server-side e não-bypassável:** a Server Action `enviarFotoProduto` revalida `validarImagem` (2MB/tipo) e `validarMagicBytes` (conteúdo real) sobre o buffer recebido, antes de subir. Bypass do cliente (chamada direta) esbarra na action; e o bucket tem `file_size_limit`/`allowed_mime_types` como rede final.
- **`foto_url` é renderizada como `<Image src>` na vitrine** → vetor de injeção de URL. A Server Action de save (`schemaProduto`) valida que a URL pertence ao Storage do iRango (`STORAGE_URL_PREFIX`) antes de persistir. Bloqueia URL externa e protocolo `javascript:` (`seguranca.md` §15). **Nota:** as imagens são servidas com `Content-Type: image/*` pelo CDN do Supabase, o que neutraliza execução de script mesmo se um payload disfarçado fosse gravado — mas o magic-bytes na action impede o disfarce na origem.
- **Path do Storage:** `{loja_id}/{uuid}.{ext}` — `loja_id` derivado no servidor (`buscarLojaDoDono`), **nunca** do input; nome via UUID, **nunca** o `file.name` do usuário; **não** prefixar com `produtos/` (armadilha §18 — quebraria `produtos_insert_propria`).
- **Tabela nova?** Não. **RLS nova?** Não — bucket e coluna já têm RLS/políticas (§18). **Migration nova?** Sim, mas só `UPDATE` de limites no bucket (não cria tabela/coluna/policy).
- **API externa com key?** Não. Upload usa o client Supabase autenticado (sessão), RLS protege.

---

## Fora do Escopo (v1)

- **Mudanças na vitrine** — já renderiza `foto_url`; nada a fazer.
- **Endurecer o refine para `loja_id` específico** — o refine garante "Storage do iRango"; restringir a pasta da própria loja é follow-up de baixa prioridade (ver limite conhecido). Bucket público torna o impacto baixo.
- **Limpeza de órfãos no Storage** — substituir/remover foto não apaga o arquivo antigo (nome é UUID, então acumula). Garbage collection é follow-up (custo de Storage desprezível na v1).
- **Edição avançada** — o crop 4:3 (`react-easy-crop`) com zoom **está** na v1; ficam fora rotação, filtros, ajuste de qualidade/brilho e aspect ratios alternativos.
- **Múltiplas fotos por produto / galeria** — v1 é uma foto por produto (coluna única `foto_url`).
- **Reordenação de fotos, foto de categoria, foto de capa da loja** — fora do escopo.

---

## Saída

- **Páginas:** 1 (Form de Produto no painel — criar/editar).
- **Behaviors:** 5 (selecionar+crop 4:3, preview, substituir, remover, salvar com foto).
- **Pontos de segurança críticos:**
  - **Server Action `enviarFotoProduto`** — valida tamanho (2MB) + **magic bytes reais** server-side; deriva `loja_id` do dono; sobe a `{loja_id}/{uuid}.{ext}`. Garantia não-bypassável de que o arquivo é uma imagem real na pasta certa.
  - **Validação server-side da `foto_url` no save** (`schemaProduto`, issue 072) — refine de Storage espelhando `schemaPixQrUrl`; bloqueia injeção de URL externa/`javascript:`.
  - **Bucket `produtos`** — adicionar `file_size_limit` + `allowed_mime_types` (defesa-em-profundidade; fecha lacuna descoberta na revisão).
  - **RLS do bucket** (existente, §18) — escrita só em `{loja_id}/` do dono.
  - **Sem RLS nova, sem tabela/coluna nova.** Uma migration de `UPDATE` de limites do bucket.
- **Próximo passo:** `/break` passando `specs/foto-produto-painel.md` (gera/atualiza as issues: migration de bucket, crop+`exportarCrop` (`react-easy-crop`), `enviarFotoProduto`, `UploadFotoProduto`, `FormProduto`+páginas, remoção de `uploadFotoProduto`). A issue 072 já cobre a camada de `schemaProduto`/persistência.
