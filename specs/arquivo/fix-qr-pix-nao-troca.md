# Spec: Fix — QR Code Pix não TROCA (substituir A por B)

**Versão:** 0.1.0 | **Atualizado:** 2026-06-19

> Continuação de `specs/fix-qr-pix-nao-aparece.md` (bugs de aparecer no painel/checkout já corrigidos). Este spec ataca um bug distinto: **substituir** um QR já salvo por outro **não persiste / parece não trocar**.

## Visão Geral

O lojista já tem o QR "A" salvo e funcionando. Quer trocar por "B": remove A (botão X) e sobe B — mas o QR **não troca** na percepção do lojista/cliente: ou continua mostrando A, ou fica vazio, ou volta pro A após reabrir/checkout.

Vive em dois mundos: **painel** (auth, upload/edição) e **vitrine pública** (sem auth, leitura no checkout). O `config.pix_qr_url` no banco é a **verdade autoritativa** (gravado por Server Action). O preview no `UploadQrPix`/`FormPagamento` é **preview de UX** (estado local do cliente).

## Investigação — hipóteses confirmadas/descartadas (evidência arquivo:linha)

### A) `salvarQrPix(id, undefined)` na remoção não limpa o config → **DESCARTADA**
Fluxo: `FormPagamento.tsx:130` (`urlParaSalvar = urlPublica || undefined`) → `salvarQrPix(id, undefined)`. Em `pagamento.ts:130` `schemaPixQrUrl.safeParse(undefined)` passa (`schemaStorageUrl.optional()`), `parsed.data === undefined`. Em `pagamento.ts:166` `configNovo = { ...configAtual, pix_qr_url: undefined }`.

**Verificado empiricamente** (`node -e`): `JSON.stringify({...configAtual, pix_qr_url: undefined})` → `{"tipo_chave":"telefone","chave":"5511"}` — a chave `pix_qr_url` é **dropada na serialização** que o supabase-js envia ao Postgres. Logo o jsonb gravado **fica corretamente SEM `pix_qr_url`**. A remoção **funciona no banco**.

> Fragilidade residual (não é a causa, registrar): a remoção depende de um efeito colateral implícito do `JSON.stringify` (drop de `undefined`). Mais robusto seria escrever a remoção explícita (deletar a chave do objeto antes do update) — ver "Fix" abaixo. Mas **não** é o que quebra a troca.

### B) Cache do CDN serve A na MESMA URL após upload de B → **CONFIRMADA (causa raiz para troca de MESMA extensão)**
`UploadQrPix.tsx:82-90` — path = `{lojaId}/qr.{ext}` com `upsert:true`. Se A e B têm a **mesma extensão** (ambos PNG → ambos `qr.png`), o `upsert` sobrescreve o objeto, **mas a URL pública é idêntica** (`getPublicUrl` em `.tsx:99-101` não adiciona cache-buster). O objeto é servido com `cacheControl: max-age=3600` (metadata do bucket). `<Image ... unoptimized>` (`.tsx:137-144`) **não** adiciona query param. Resultado: navegador/CDN serve **A cacheado por até 1h na URL idêntica** → no painel e no checkout o lojista/cliente vê o QR **antigo**. Parece que "não trocou". **Esta é a causa raiz mais provável do sintoma "volta pro A".**

### C) Extensão divergente deixa objeto órfão → **CONFIRMADA (sujeira, não quebra a troca)**
`UploadQrPix.tsx:82` — `extensaoPorTipo` gera `qr.png`/`qr.jpg`/`qr.webp`. Se A=`qr.png` e B=`qr.jpg`, o `upsert` cria `qr.jpg` e **`qr.png` permanece órfão** no bucket. A URL no `config` muda corretamente para `qr.jpg` (sem o problema B, pois a URL é nova). **Não quebra a troca** (a troca de extensão na verdade *escapa* do bug B), mas acumula lixo no bucket. Registrar para limpeza.

### D) Preview local (`useState`) dessincroniza do `inicial` após `router.refresh()` → **CONFIRMADA (contribui para "fica vazio / trava no antigo")**
`UploadQrPix.tsx:62` (`useState(urlAtual ?? null)`) e `FormPagamento.tsx:70` (`useState(lerCampo(...))`) **só inicializam no mount**. Após `router.refresh()` (`FormPagamento.tsx:137`) as props do servidor mudam, mas os `useState` **não re-sincronizam**. A `key` de remount em `PagamentosClient.tsx:200` é `${tipo}-${id}` — **não inclui o config** → trocar o QR (mesmo `id`) **não remonta** o `FormPagamento`. Fechar e reabrir o Sheet (`formAberto` toggle) **mantém** o componente montado com estado stale. Durante a sessão o preview acompanha via `setPreview`/`setPixQrUrl` diretos, mas qualquer divergência entre o estado local e o banco (ex.: erro silencioso, refresh parcial) trava o preview no valor antigo ou vazio.

### E) Race entre remover (`salvarQrPix undefined`) e subir B (`salvarQrPix urlB`) → **DESCARTADA como causa primária (latente)**
Ambos rodam no mesmo `startSalvarQr` (`FormPagamento.tsx:128`), são **ações sequenciais do usuário** (remover, depois subir) — não disparam concorrentemente no fluxo normal. Cada `salvarQrPix` faz read-modify-write do config inteiro (`pagamento.ts:144-173`): há um **last-write-wins latente** se duas escritas de config concorressem, mas a troca normal é sequencial. Não é o que quebra a troca; registrar como risco latente (mitigado por `jsonb_set` no fix opcional).

## Causa raiz

| Sintoma observado | Causa raiz | Evidência |
|---|---|---|
| "Subo B mas continua mostrando A" (mesma extensão) | **B** — CDN serve objeto A cacheado (`max-age=3600`) na URL idêntica `qr.{ext}` sem cache-buster | `UploadQrPix.tsx:84,90,99-101,143` |
| "Fica vazio / trava no antigo ao reabrir" | **D** — `useState` não re-sincroniza com prop refrescada; `key` de remount não inclui config | `UploadQrPix.tsx:62`; `FormPagamento.tsx:70`; `PagamentosClient.tsx:200` |
| Lixo no bucket (objeto velho órfão) | **C** — extensão divergente deixa `qr.png` órfão ao subir `qr.jpg` | `UploadQrPix.tsx:82-84` |

**Denominador da TROCA:** **B** (cache na URL idêntica) é a causa primária do "não trocou / volta pro A" — o caso mais comum (lojista troca PNG por PNG). **D** agrava a percepção no painel. A remoção em si (A) **funciona** no banco.

## Atores Envolvidos

- **iRango (SaaS):** dono do bucket `pix-qr`, das RLS de storage e da política de cache do objeto. Responsável pelo cache-buster da URL persistida.
- **Lojista (painel, auth):** sobe/troca/remove o QR. Escreve só na pasta `{loja_id}/` (RLS bucket 074).
- **Cliente (vitrine, sem auth):** lê o QR no checkout. Só leitura pública.

## Páginas e Rotas

### Configurar Pix (sidebar) — `/painel/configuracoes/pagamentos`
**Mundo:** painel (auth obrigatório)
**Descrição:** lojista substitui o QR já salvo. Após trocar A por B, o preview e o banco devem refletir **B** imediatamente, e o checkout idem.

**Componentes (reuso):**
- `PagamentosClient` — Sheet + lista. **Reuso; ajustar `key` de remount.**
- `FormPagamento` — orquestra `salvarQrPix`. **Reuso; ajustar re-sync de `pixQrUrl`.**
- `UploadQrPix` — upload + `getPublicUrl`. **Reuso; ajustar cache-buster + re-sync de `preview`.**
- `next/image` (`unoptimized`). **Reuso.**

**Behaviors:**
- [ ] Remover o QR (botão X) — grava `config` sem `pix_qr_url`. Garantido em: **Server Action (`salvarQrPix`) + RLS** (`pagamentos_escrita_propria`, `loja_id` derivado do dono). Funciona hoje (hipótese A descartada).
- [ ] Substituir o QR (A→B) e ver **B** no preview imediatamente — a URL persistida deve ter **cache-buster** para não servir A cacheado. Garantido em: **Server Action (URL autoritativa) + RLS**; o preview é **UX (cliente)**, mas a URL exibida deriva da URL gravada.
- [ ] Reabrir o Sheet após trocar e ver **B** — `FormPagamento`/`UploadQrPix` devem re-sincronizar o preview com `inicial.config.pix_qr_url` refrescado. Garantido em: **leitura do banco no Server Component + render no cliente (UX)**.
- [ ] Trocar de extensão (PNG→JPG) sem deixar lixo — opcionalmente remover o objeto antigo do bucket. Garantido em: **client autenticado (RLS bucket 074)**; não é valor monetário.

### Checkout — etapa de pagamento — `/loja/[slug]/pedido`
**Mundo:** vitrine pública (sem auth)
**Descrição:** cliente vê o QR **B** (o atual), nunca o A cacheado.

**Componentes (reuso):**
- `extrairConfigPix` (`pedido/page.tsx:48-58`) — mapeia `config.pix_qr_url` → `pixQrUrl`. **Reuso.**
- `EtapaPagamento` — render `<img src={pixQrUrl}>`. **Reuso.**

**Behaviors:**
- [ ] Selecionar Pix e ver o QR atual (B) — a URL com cache-buster força o CDN/navegador a buscar o objeto novo. Garantido em: **leitura pública (RLS bucket leitura) no Server Component; URL autoritativa do banco; render é UX**. O cliente nunca define a URL.

---

## Modelos de Dados

`formas_pagamento` (`schema.md`) — **sem migration de schema**. O QR vive em `config.pix_qr_url` (jsonb). Mudança é de **valor** (a URL passa a carregar um sufixo de cache-buster), não de coluna.

`storage.objects` (bucket `pix-qr`, migration 074) — sem migration. Mudança comportamental no client de upload (cache-buster + cleanup opcional do órfão). RLS já existente cobre escrita escopada e leitura pública — **não recriar**.

## Regras de Negócio

| Regra | Camada garantida |
|---|---|
| A troca de QR deve invalidar o cache do CDN para não servir o QR antigo | **Server/Client de upload** — URL persistida com **cache-buster** (ex.: `?v={timestamp}` ou path versionado). A URL é **autoritativa do servidor** (validada por `schemaPixQrUrl`). |
| `pix_qr_url` deve pertencer ao Storage do iRango (anti-injeção) | **Server Action** (`schemaPixQrUrl`/`schemaStorageUrl` em `salvarQrPix`). **ATENÇÃO:** se o cache-buster for query string (`?v=`), confirmar que `schemaStorageUrl.refine(startsWith PREFIX)` **continua passando** (query string não quebra o `startsWith`; validar). |
| `loja_id` nunca vem do cliente — derivado do dono | **Server Action + RLS** (`buscarLojaDoDono`, `pagamentos_escrita_propria`). |
| Path no bucket é `{loja_id}/qr.{ext}` — lojista só escreve na própria pasta | **RLS bucket 074**. |
| Remoção do QR grava config sem a chave | **Server Action** — funciona; tornar explícita (deletar a chave) em vez de depender do drop de `undefined` no `JSON.stringify`. |
| Preview no painel deve refletir o estado do banco após troca | **Cliente (UX)** — re-sync de `useState` com prop refrescada / `key` de remount por config. Não é autoritativo. |
| QR é instrução, não valor monetário | n/a — o iRango não processa pagamento (`modelo-negocio.md`); o valor do pedido é recalculado em `criarPedido` independente do QR. |

## Segurança (obrigatório)

- **Dado sensível:** chave Pix (PII de pagamento) e QR (imagem com a chave). A chave é validada por `schemaChavePix`; o QR por `schemaPixQrUrl` no servidor. **Mantém-se.**
- **Valor monetário:** o QR/chave **não** definem quanto o cliente paga. **Sem recálculo novo necessário** — não há dinheiro nesta troca.
- **Cache-buster e validação de URL:** se o cache-buster for `?v=timestamp`, **revalidar** que a URL ainda passa `schemaStorageUrl` (`startsWith STORAGE_URL_PREFIX` — query string preserva o prefixo, mas testar) e que não abre espaço para injeção (o `v` é gerado no servidor/cliente do iRango, nunca input do usuário). Se for **path versionado** (`qr-{ts}.{ext}`), o `startsWith` continua válido e elimina o cache por construção (URL sempre nova) — preferível.
- **Tabela nova?** Não. **Nenhuma política RLS nova.** As RLS de `formas_pagamento` e do bucket `pix-qr` (074) já cobrem.
- **API externa com key?** Não.
- **Limpeza de órfão (hipótese C):** ao trocar de extensão, deletar o objeto antigo é feito pelo **client autenticado** (RLS bucket escopa por `{loja_id}/`). Sem novo segredo. Se path passar a ser versionado, **todo** upload deixa órfão → cleanup torna-se necessário (ou aceitar lixo + lifecycle policy — fase 2).

## Fora do Escopo (v1)

- Não unificar `salvarQrPix` e `atualizarFormaPagamento` num único endpoint (fix mínimo).
- Não migrar para signed URLs (bucket público resolve; signed só se QR virar privado — **fase 2**).
- Não implementar lifecycle/garbage-collection automático do bucket — limpeza inline do órfão na troca é suficiente para v1; varredura periódica é **fase 2**.
- Não resolver o race latente E com lock/transação — sequencial no fluxo real; `jsonb_set` server-side é melhoria opcional, não bloqueante.
- Não validar que a chave embutida no QR == chave digitada — **fase 3**.

---

## Próximos passos de implementação (fix mínimo, ordem)

1. **Fix B (causa raiz da troca):** dar **cache-buster** à URL do QR. Duas opções, escolher uma:
   - (a) **Path versionado** — `UploadQrPix.tsx:84` passa a `{lojaId}/qr-{Date.now()}.{ext}` → toda troca gera URL nova, **elimina o cache por construção** e o problema C de extensão deixa de importar (mas todo upload deixa órfão → exige cleanup do anterior). **Preferível pela robustez.**
   - (b) **Query cache-buster** — manter `qr.{ext}` e persistir `...{url}?v={Date.now()}`. Menos órfãos, mas requer revalidar `schemaStorageUrl` com query string e o `<Image unoptimized>` precisa renderizar a URL com query.
2. **Cleanup do objeto antigo (Fix C):** antes/depois do upload de B, `supabase.storage.from('pix-qr').remove([pathAntigo])` (client autenticado, RLS 074). Necessário se adotar (1a) ou troca de extensão.
3. **Fix D (re-sync de preview):** ou (i) incluir um hash/trecho do `config` na `key` de remount em `PagamentosClient.tsx:200`, ou (ii) `useEffect` em `UploadQrPix`/`FormPagamento` que re-sincroniza `preview`/`pixQrUrl` quando `urlAtual`/`inicial.config.pix_qr_url` muda. Preview é **UX**, não autoritativo.
4. **Fix A (robustez de remoção):** tornar a remoção explícita em `salvarQrPix` — quando `pix_qr_url` é `undefined`, construir `configNovo` **deletando** a chave (`const {pix_qr_url: _, ...resto} = configAtual`) em vez de depender do drop de `undefined` no `JSON.stringify`. Não muda comportamento atual, blinda contra regressão.
5. **Testes (RED-first onde crítico):** `pagamento.test.ts` hoje só cobre `atualizarFormaPagamento`. Adicionar testes de `salvarQrPix`:
   - troca: salva URL B sobre config com URL A → `config.pix_qr_url === B` (autoritativo);
   - remoção: `salvarQrPix(id, undefined)` → `config` **sem** `pix_qr_url`;
   - escopo: update filtrado por `id` + `loja_id` + `tipo='pix'`.
