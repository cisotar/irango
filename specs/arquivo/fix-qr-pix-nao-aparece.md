# Spec: Fix — QR Code Pix não aparece (painel + checkout)

**Versão:** 0.1.0 | **Atualizado:** 2026-06-19

## Visão Geral

Bug em produção: o QR Code Pix que o lojista sobe **não aparece** em duas superfícies:

1. **Painel** (`/painel/configuracoes/pagamentos`) — após upload, ao reabrir a sidebar de edição do Pix o preview some.
2. **Vitrine/checkout** — ao selecionar Pix, o QR não é exibido.

Vive em dois mundos: **painel** (auth obrigatório, upload + edição) e **vitrine pública** (sem auth, leitura no checkout). O QR é um **dado do lojista exibido ao cliente** — não há valor monetário no QR em si (a chave Pix é que precisa de validação server-side; o QR é apenas uma imagem-instrução). A verdade de "qual QR" é sempre o `config.pix_qr_url` no banco, gravado por Server Action.

## Investigação — hipóteses confirmadas/descartadas (evidência arquivo:linha)

### A) Schema Zod faz strip de `pix_qr_url` → **DESCARTADA**
`src/lib/validacoes/pagamento.ts:17-43` — `schemaChavePix` declara `pix_qr_url: schemaPixQrUrl` em **todos** os 5 membros da discriminated union. Zod só faz strip de chaves **não declaradas**; como `pix_qr_url` está declarado, ele passa pelo parse. No fluxo de criação (`FormPagamento.montarPayload` linha 84 inclui `pix_qr_url`), o campo chega ao `salvarFormaPagamento` e é gravado (`actions/pagamento.ts:42-46`). Schema **não** apaga o campo.

> Observação residual (não é a causa, mas é fragilidade): `montarPayload` só inclui `pix_qr_url` quando `pixQrUrl` é truthy (linha 84 `...(pixQrUrl ? {...} : {})`). Em **edição**, se o lojista salvar a chave sem QR carregado em memória, o `atualizarFormaPagamento` faz `update({ config })` **substituindo** o config inteiro (`actions/pagamento.ts:76`) — isso **apaga** um `pix_qr_url` previamente salvo. Ver hipótese D.

### B) Bucket `pix-qr` privado → `getPublicUrl` retorna 403 → **DESCARTADA (verificado em prod 2026-06-19)**
`supabase/migrations/20260614006500_storage_pix_qr.sql:21-23` declara `public: true` **com `ON CONFLICT (id) DO NOTHING`** — risco teórico de bucket pré-existente privado. **Verificado em prod via Storage API:** `GET /storage/v1/bucket/pix-qr` → `{"id":"pix-qr","public":true,...}`. O bucket **é público**. A URL pública real passa `schemaStorageUrl` (`startsWith` do prefixo confirmado). Storage **não é a causa**.

Evidência adicional contra B: o objeto `48e5418e-6006-4cfa-b37d-2c18e81f9b14/qr.png` existe no bucket (200, 5385 bytes), mas a `config` da forma Pix dessa loja **não tem `pix_qr_url`** — ou seja, o upload funcionou e a URL seria válida; o problema é que o campo **foi gravado e depois apagado no banco** (hipótese D).

### C) Checkout nunca lê `config.pix_qr_url` → **DESCARTADA**
`src/app/(publica)/loja/[slug]/pedido/page.tsx:48-56` — `extrairConfigPix` lê `c.pix_qr_url` e mapeia para `pixQrUrl`; linha 92-93 hidrata `FormaPagamentoWizard`. `EtapaPagamento.tsx:200-209` renderiza `<img src={formaSelecionada.pixQrUrl}>`. O caminho de leitura+render **existe e está correto**. Logo, se o checkout não mostra o QR, ou (1) o campo nunca foi persistido (hipótese D em edição), ou (2) a URL 403 (hipótese B).

### D) `montarPayload`/`atualizar` sobrescreve config sem `pix_qr_url` → **CONFIRMADA (causa raiz do painel em edição)**
`actions/pagamento.ts:76` — `atualizarFormaPagamento` faz `.update({ tipo, config: parsed.data.config })`, **substituição total** do jsonb. Em edição, `FormPagamento` inicializa `pixQrUrl` de `inicial.config.pix_qr_url` (`FormPagamento.tsx:70-72`), mas se o lojista subiu o QR numa forma que **ainda não existia** (`inicial?.id == null`), o `aoUploadQrConcluido` só faz `setPixQrUrl` em memória (`FormPagamento.tsx:123-126`) e **não chama `salvarQrPix`**. O QR vai junto no INSERT de criação (linha 84 → ok). Mas a contradição com o sintoma do painel ("reabrir e some") aponta para o **estado stale do `PagamentosClient`**:

`PagamentosClient.tsx:129` — `formaEmEdicao` deriva de `formas` (prop do server). Após `salvarQrPix` + `router.refresh()`, a prop `formas` é re-buscada. **PORÉM:** o `aoSalvar` (que chama `router.refresh`) só roda no submit do form principal (`FormPagamento.onSucesso`). O `salvarQrPix` faz seu próprio `router.refresh()` (`FormPagamento.tsx:137`), mas o Sheet permanece aberto com o `FormPagamento` montado; seu estado local `pixQrUrl` foi setado (linha 136) então o preview deveria aparecer **enquanto aberto**. Ao **fechar e reabrir**, `formaEmEdicao.config` vem da prop refrescada — se `salvarQrPix` gravou, deveria persistir.

→ **Conclusão D:** se o preview some ao reabrir mesmo após `salvarQrPix` ok, a gravação não está chegando ao banco OU a URL é inútil (B). A causa estrutural confirmada é a **substituição total de config em `atualizarFormaPagamento`** (apaga `pix_qr_url` no próximo "Salvar alterações" da chave) + o fato de `salvarQrPix` e `atualizarFormaPagamento` serem **caminhos de escrita concorrentes sobre o mesmo jsonb sem merge consistente**.

## Causa raiz por superfície

| Superfície | Causa raiz primária | Causa secundária |
|---|---|---|
| **Painel (reabrir → some)** | **D** — `atualizarFormaPagamento` (`actions/pagamento.ts:76`) faz update total de config; salvar a chave depois apaga `pix_qr_url` que `salvarQrPix` havia gravado | Estado stale do `FormPagamento` (mitigado pelo `router.refresh()` adicionado em `aoUploadQrConcluido`) |
| **Checkout (Pix → sem QR)** | **D** — `pix_qr_url` apagado no banco → `extrairConfigPix` devolve `null` → `<img>` nem renderiza | n/a |

**O denominador comum é D (apagamento do `pix_qr_url` no banco).** Confirmado por dados de prod: bucket público, objeto presente, mas `config` sem `pix_qr_url`. O caminho de leitura/render está correto em ambas as superfícies — falta apenas o dado, que é apagado pelo update total de config. **B foi descartada** (bucket verificado `public:true`).

## Atores Envolvidos

- **iRango (SaaS):** dono do bucket `pix-qr` e das RLS de storage; garante leitura pública e escrita escopada por loja.
- **Lojista (painel, auth):** sobe o QR, edita a chave Pix. Não pode escrever na pasta de outra loja (RLS bucket 074).
- **Cliente (vitrine, sem auth):** lê o QR no checkout. Só leitura pública.

## Páginas e Rotas

### Configurar Pix (sidebar) — `/painel/configuracoes/pagamentos`
**Mundo:** painel (auth obrigatório)
**Descrição:** lojista ativa Pix, informa chave e sobe o QR Code. Ao reabrir a sidebar, o QR já salvo deve aparecer como preview.

**Componentes (reuso):**
- `PagamentosClient` — Sheet (shadcn/ui) + lista de formas. **Reuso.**
- `FormPagamento` — form de chave + `UploadQrPix`. **Reuso, ajuste de sincronização de estado.**
- `UploadQrPix` — upload ao bucket + `getPublicUrl`. **Reuso; trocar para signed/public conforme decisão de bucket.**
- `next/image` (`unoptimized`) — preview. **Reuso.**

**Behaviors:**
- [ ] Subir QR numa forma Pix **nova** (ainda sem `id`) — guarda em memória e persiste no INSERT ao "Ativar". Garantido em: **Server Action (`salvarFormaPagamento`) + RLS** (`pagamentos_escrita_propria`, `loja_id` derivado do dono).
- [ ] Subir QR numa forma Pix **existente** — persiste via `salvarQrPix` com **merge** preservando `chave`/`tipo_chave`. Garantido em: **Server Action (`salvarQrPix`) + RLS bucket (074) + RLS tabela**.
- [ ] Reabrir a sidebar e ver o QR salvo — `FormPagamento` deve inicializar/re-sincronizar `pixQrUrl` a partir de `inicial.config.pix_qr_url` refrescado. Garantido em: **leitura do banco no Server Component + render no cliente (UX)**.
- [ ] Salvar alterações de chave sem mexer no QR — **não pode apagar** `pix_qr_url` já gravado. Garantido em: **Server Action (`atualizarFormaPagamento` com merge, não substituição)**.
- [ ] Remover o QR (botão X) — grava `config` sem `pix_qr_url` (e opcionalmente apaga o objeto do bucket). Garantido em: **Server Action + RLS**.

### Checkout — etapa de pagamento — `/loja/[slug]/pedido`
**Mundo:** vitrine pública (sem auth)
**Descrição:** cliente seleciona Pix e vê o QR + chave copiável.

**Componentes (reuso):**
- `EtapaPagamento` — render do `<img src={pixQrUrl}>` + chave. **Reuso, sem mudança de lógica.**
- `extrairConfigPix` (em `pedido/page.tsx`) — mapeia `config.pix_qr_url` → `pixQrUrl`. **Reuso.**
- `listarFormasPagamento` — leitura pública. **Reuso.**

**Behaviors:**
- [ ] Selecionar Pix e ver o QR — render da URL pública do Storage. Garantido em: **leitura pública (RLS bucket leitura + RLS `formas_pagamento` loja ativa) no Server Component; render é UX**. O cliente nunca define a URL.
- [ ] Copiar a chave Pix — `navigator.clipboard`. Garantido em: **cliente (UX)**; a chave é dado autoritativo lido do banco no servidor.

---

## Modelos de Dados

`formas_pagamento` (`schema.md` §225) — **sem migration de schema**. O QR vive em `config` (jsonb): `config.pix_qr_url`. O `schema.md:233` documenta o exemplo de config pix **sem** `pix_qr_url` → **atualizar a documentação** do schema para incluir `"pix_qr_url"` no exemplo do tipo pix (não é mudança de DDL, é doc).

`storage.buckets` / `storage.objects` (bucket `pix-qr`, migration 074) — **possível migration corretiva** se o bucket em prod estiver privado:
- Migration idempotente que força `update storage.buckets set public = true where id = 'pix-qr';` (o `ON CONFLICT DO NOTHING` original não corrige bucket pré-existente). RLS de leitura pública já existe (074) — não recriar.

## Regras de Negócio

| Regra | Camada garantida |
|---|---|
| `pix_qr_url` deve pertencer ao Storage do iRango (anti-injeção de URL externa) | **Server Action** (`schemaPixQrUrl` / `schemaStorageUrl` no parse de `salvarQrPix` e `salvarFormaPagamento`) |
| `loja_id` nunca vem do cliente — derivado do dono | **Server Action + RLS** (`buscarLojaDoDono`, `pagamentos_escrita_propria`) |
| Path no bucket é `{loja_id}/qr.{ext}` — lojista só escreve na própria pasta | **RLS do bucket (074)** |
| Editar a chave **não** pode apagar o QR já salvo | **Server Action** — `atualizarFormaPagamento` deve fazer **merge** do jsonb (hoje substitui — `actions/pagamento.ts:76`) |
| Bucket `pix-qr` deve ser público para leitura | **Migration / config de Storage** (verificar prod) |
| QR é instrução, não valor monetário — sem recálculo | n/a (não há dinheiro no QR; a chave é o dado sensível, validada no servidor) |

## Segurança (obrigatório)

- **Dado sensível:** chave Pix (PII de pagamento do lojista) e QR (imagem com a chave embutida). A chave é validada por `schemaChavePix` no servidor; o QR por `schemaPixQrUrl`. **Mantém-se.**
- **Valor monetário:** o QR/chave **não** definem quanto o cliente paga (o iRango não processa pagamento — `modelo-negocio.md`). O valor do pedido é recalculado pelo servidor em `criarPedido` independentemente do QR. **Sem recálculo novo necessário.**
- **Bucket público:** `pix-qr` é intencionalmente público para leitura (vitrine sem auth). Tornar público **não** vaza dados entre lojas além do que já é exibido no checkout (o QR é, por design, mostrado a qualquer cliente). Escrita continua escopada por RLS (074). **Aceito.**
- **Tabela nova?** Não. RLS de `formas_pagamento` e do bucket já existem (074). Nenhuma política nova.
- **API externa com key?** Não.
- **Risco de regressão do fix D (merge):** garantir que o merge no `atualizarFormaPagamento` não reintroduza chaves antigas indesejadas — fazer merge **explícito** (`{ ...configAtual, ...configNovo }`) lendo a config atual no servidor, como já faz `salvarQrPix` (`actions/pagamento.ts:137-143`). **Reusar esse padrão.**

## Fora do Escopo (v1)

- Não reescrever o fluxo de upload (drawer/wizard) nem unificar `salvarQrPix` com `atualizarFormaPagamento` num único endpoint — fix mínimo por superfície.
- Não migrar para signed URLs se o bucket público resolver (signed URL só seria necessário se o produto decidisse tornar QR privado — **fase 2**, fora do roadmap atual).
- Não adicionar validação de status HTTP da URL no servidor (checar 200 do CDN) — defesa cara; o fix de bucket público elimina a necessidade.
- Não validar conteúdo do QR (decodificar e conferir que a chave do QR == chave digitada) — **fase 3**.

---

## Próximos passos de implementação (fix mínimo, ordem)

0. ~~VERIFICAR PROD~~ **FEITO (2026-06-19):** bucket `pix-qr` é `public:true`; objeto `qr.png` existe mas `config` sem `pix_qr_url`. **B descartada — D é a causa raiz única.**
1. **Fix D (causa raiz — resolve ambas as superfícies):** `atualizarFormaPagamento` deve fazer **merge** do jsonb (ler config atual + spread), não substituição total — preserva `pix_qr_url` ao salvar a chave. Reusar o padrão exato de `salvarQrPix` (`actions/pagamento.ts:121-150`).
3. **Fix de sincronização do painel:** garantir que, em edição de forma existente, o upload de QR chame `salvarQrPix` (já chama quando há `inicial.id`) e que `FormPagamento` re-sincronize `pixQrUrl` do `inicial` refrescado (hoje só inicializa no mount; o `key` no `PagamentosClient.tsx:200` força remount por `id`, mas não por mudança de `config` do mesmo `id` — avaliar incluir hash do config na `key` ou um `useEffect` de sync).
4. Atualizar doc do exemplo de config pix em `schema.md:233` para incluir `pix_qr_url`.
