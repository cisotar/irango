# Spec: Produto Oculto na Vitrine — separar visibilidade de disponibilidade

**Versão:** 0.1.1 | **Atualizado:** 2026-07-01 — todos os behaviors implementados (issues 083-089)

## Visão Geral

Hoje o produto tem **um único** eixo de controle no painel: o campo `produtos.disponivel` (boolean). O botão "Ocultar/Exibir" em `/painel/produtos` só alterna esse campo, e a RLS `produtos_leitura_publica` filtra `disponivel = true` — ou seja, marcar como indisponível **some** o produto da vitrine. Isso mistura dois conceitos de negócio distintos.

Esta feature separa em **dois eixos independentes** por produto:

1. **Oculto na vitrine** (campo NOVO `oculto boolean not null default false`) — controla se o produto **aparece** na vitrine pública `/loja/[slug]`. Oculto = não aparece, ponto final, independente de disponível.
2. **Disponível/indisponível** (campo `disponivel`, **já existente**) — passa a significar "comprável ou esgotado". Produto **não-oculto mas indisponível aparece na vitrine marcado como esgotado**, e não pode ser adicionado ao carrinho/pedido.

Regra combinada da vitrine pública:

| `oculto` | `disponivel` | Vitrine pública | Adicionável ao carrinho |
|----------|--------------|-----------------|--------------------------|
| `true`   | qualquer     | **não aparece** | não |
| `false`  | `true`       | aparece normal  | **sim** |
| `false`  | `false`      | aparece como **esgotado** | não |

**Mundo:** afeta os três — **vitrine pública** (`/loja/[slug]`, sem auth), **painel** (`/painel/produtos`, auth) e o **fluxo de pedido** (Server Action autoritativa). É mudança **crítica**: schema + RLS + recálculo autoritativo de pedido.

## Atores Envolvidos

- **iRango (SaaS):** nenhuma mudança de billing/admin. A variante admin de `/admin/assinantes` (que reusa `ProdutosClient`/`FormProduto` com actions injetadas) herda o novo campo automaticamente ao passar pelos mesmos componentes/actions.
- **Lojista:** ganha dois controles distintos por produto — "Oculto da vitrine" e "Disponível/Esgotado". Deixa de perder o produto da vitrine ao marcá-lo como esgotado.
- **Cliente:** vê produtos esgotados na vitrine (marcados, não compráveis) e nunca vê produtos ocultos. Não consegue comprar produto esgotado nem oculto — garantido no servidor.

## Páginas e Rotas

### Vitrine da loja — `/loja/[slug]`
**Mundo:** vitrine pública (sem auth) — lida via anon key + RLS.

**Descrição:** o catálogo passa a incluir produtos **não-ocultos indisponíveis** (marcados como esgotado), além dos disponíveis. Produtos ocultos nunca aparecem. A apresentação de "esgotado" **já existe** em `CardProduto` (prop `disponivel={false}` → badge esgotado, `onClick` desabilitado, botão `disabled`) — esta spec apenas passa a alimentá-la com produtos indisponíveis, que hoje a query exclui.

**Componentes:** (reuso, nada novo aqui)
- `CardProduto` (`components/vitrine/`) — **já suporta** `disponivel={false}`: opacidade, badge "esgotado", clique/botão desabilitados. Inalterado.
- `SecaoCatalogo` / `VitrineClient` / `ProdutoModal` — reusados; precisam apenas propagar `disponivel` de cada produto ao `CardProduto` e impedir abertura de modal/adição para produto esgotado (se ainda não o fazem — verificar na implementação).

**Behaviors:**
- [x] Ver produto disponível — cliente vê o produto normal, pode abrir/adicionar. Garantido em: **Server Component + RLS** (query pública sob `produtos_leitura_publica`).
- [x] Ver produto esgotado — produto não-oculto e indisponível aparece marcado como esgotado, não clicável. Garantido em: **Server Component (dado) + cliente (apresentação)**. O dado `disponivel` vem do banco; a UX de "esgotado" é apresentação.
- [x] Não ver produto oculto — produto `oculto = true` não aparece de forma alguma. Garantido em: **RLS + Server Action/Query** (defesa em profundidade: `oculto = false` na policy E filtro explícito na query — ver Regras de Negócio RN-3).
- [x] Tentar adicionar produto esgotado ao carrinho — bloqueado na UI (botão desabilitado) e, se forçado via DevTools, **recusado no servidor**. Garantido em: **cliente (UX) + Server Action + RLS** ("garantido em: Server Action + RLS").
- [x] Tentar comprar produto oculto (forjando o `produto_id` no payload) — **recusado no servidor**. Garantido em: **Server Action + RLS** ("garantido em: Server Action + RLS").

---

### Produtos (painel) — `/painel/produtos`
**Mundo:** painel (auth obrigatório — guard em `app/(painel)/painel/layout.tsx` + `middleware.ts`).

**Descrição:** cada linha de produto passa a expor **dois controles distintos**, no lugar do único botão "Ocultar/Exibir" atual (que hoje, incorretamente, alterna `disponivel`):

1. **Visibilidade na vitrine** — controle "Ocultar/Exibir" que agora alterna o campo **`oculto`** (não mais `disponivel`).
2. **Disponibilidade** — controle "Disponível/Esgotado" que alterna `disponivel` (comprável vs. esgotado).

O badge de status da linha deve refletir os dois eixos (ex.: "Oculto", "Esgotado", "Disponível"). O `FormProduto` (criar/editar) ganha um toggle "Oculto da vitrine" separado do já existente "Disponível na vitrine".

**Componentes:** (reuso de shadcn/ui e componentes existentes)
- `ProdutosClient` (`app/(painel)/painel/produtos/`) — **modificado**: substitui o botão único por dois controles; o handler `alternar` que hoje chama `alternarDisponibilidade` é dividido/renomeado (ver RN-6). Badge de status refeito para cobrir oculto + esgotado.
- `FormProduto` (`components/painel/`) — **modificado**: novo estado/`Checkbox` "Oculto da vitrine" (reusa `Checkbox` do shadcn, mesmo padrão do "Disponível na vitrine" atual). Adiciona `oculto` ao `montarPayload` e ao `ProdutoInicial`.
- `ThumbProduto`, `Badge`, `Button`, `Card`, `Sheet`, `Dialog`, `AlertDialog` — inalterados.

**Behaviors:**
- [x] Ocultar produto da vitrine — lojista alterna "Ocultar" → `oculto = true`; produto some da vitrine. Garantido em: **Server Action + RLS** (`alternarOculto` → `produtos_escrita_propria`, `dono_id = auth.uid()`).
- [x] Exibir produto na vitrine — alterna "Exibir" → `oculto = false`; produto volta à vitrine. Garantido em: **Server Action + RLS**.
- [x] Marcar produto como esgotado — alterna "Esgotado" → `disponivel = false`; produto continua na vitrine, marcado. Garantido em: **Server Action + RLS** (`alternarDisponibilidade`, mantida).
- [x] Marcar produto como disponível — alterna → `disponivel = true`. Garantido em: **Server Action + RLS**.
- [x] Criar/editar produto com `oculto` — form envia `oculto` junto do payload. Garantido em: **Server Action + RLS** (`criarProduto`/`atualizarProduto` revalidam via `schemaProduto`; `loja_id` derivado do dono, nunca do payload).
- [x] Ver status combinado de cada produto — badge distingue Disponível / Esgotado / Oculto. Garantido em: **cliente (apresentação)** — deriva de `disponivel`/`oculto` que já vieram do servidor (RLS `produtos_leitura_propria` traz os dois campos).

---

## Modelos de Dados

Tabela afetada: **`produtos`** (ver `schema.md` §2). Um campo novo → **exige migration** + ajuste de RLS.

### Campo novo

```sql
-- oculto: controla exibição na vitrine, INDEPENDENTE de `disponivel`.
-- default false = comportamento retrocompatível (todo produto existente continua visível).
ALTER TABLE produtos ADD COLUMN oculto boolean NOT NULL DEFAULT false;
```

- `schema.md §2` (bloco `produtos`) deve ganhar a linha `oculto boolean not null default false` — atualização de doc via `documentar`.
- **Índice:** o índice existente é `produtos(loja_id, disponivel, ordem)`. A vitrine passa a filtrar por `oculto = false` (não mais `disponivel`). Avaliar na migration/implementação um índice `produtos(loja_id, oculto, ordem)` para a leitura da vitrine. Otimização — decisão do `migrar`/`planejar`, não bloqueia a feature.

### Migration de RLS (ADITIVA — DROP + CREATE da policy pública)

A policy `produtos_leitura_publica` (definida em `20260614002000_rls_catalogo.sql`) hoje é:

```sql
using (disponivel = true and public.loja_esta_ativa(produtos.loja_id))
```

Passa a ser:

```sql
-- Vitrine mostra produto NÃO-OCULTO de loja ativa — disponível OU esgotado.
-- O filtro "esgotado vs comprável" sai da RLS e vira apresentação (vitrine) +
-- recálculo autoritativo (pedido). Oculto NUNCA aparece.
using (oculto = false and public.loja_esta_ativa(produtos.loja_id))
```

A migration nova faz `DROP POLICY "produtos_leitura_publica" ON produtos;` seguido do `CREATE POLICY` com a nova condição. `produtos_leitura_propria` e `produtos_escrita_propria` (dono) **não mudam** — o dono já enxerga tudo por `dono_id = auth.uid()`, incluindo ocultos e indisponíveis.

## Regras de Negócio

- **RN-1 — Dois eixos independentes.** `oculto` e `disponivel` são ortogonais; nenhum deriva do outro. Marcar esgotado não oculta; ocultar não altera disponibilidade. Garantido em: **schema** (dois campos) + **cliente/Server Action** (dois controles distintos).
- **RN-2 — Oculto vence tudo na vitrine.** `oculto = true` → invisível na vitrine mesmo com `disponivel = true`. Garantido em: **RLS** (`oculto = false` na policy pública) — camada primária no banco.
- **RN-3 — Defesa em profundidade na query pública.** `buscarCatalogoPublico` (`src/lib/supabase/queries/produtos.ts`) deve filtrar **explicitamente** `.eq("oculto", false)` — não confiar só na RLS (`architecture.md §9.4`, `seguranca.md §1`). Além disso, **trocar** o atual `.eq("disponivel", true)` por não-filtrar-disponivel: a query passa a trazer indisponíveis (não-ocultos) para que a vitrine os exiba como esgotado. Garantido em: **Server Component (query) + RLS**.
- **RN-4 — Esgotado aparece, não vende.** Produto não-oculto indisponível é renderizado como esgotado na vitrine e é **não-adicionável**. O bloqueio de UX (`CardProduto disabled`) é preview; a **verdade é o servidor**. Garantido em: **cliente (UX) + Server Action** (recálculo de pedido, RN-5).
- **RN-5 — Recálculo autoritativo recusa esgotado E oculto.** A Server Action `criarPedido` (`src/lib/actions/pedido.ts`) hoje recusa item quando `!produto.disponivel || produto.loja_id !== loja_id`. Deve passar a recusar também `produto.oculto === true`. Um produto oculto/esgotado forjado no payload nunca vira pedido. Garantido em: **Server Action + RPC `criar_pedido`** (`seguranca.md §10`). O `buscarProdutosPorIds` já traz `oculto` (faz `select("*")`); a checagem é adicionar `|| produto.oculto` à condição de recusa (linha ~140).
- **RN-6 — Semântica do controle "Ocultar" migra de campo.** Hoje o botão "Ocultar/Exibir" chama `alternarDisponibilidade`. Passa a haver: (a) controle de **visibilidade** → nova Server Action `alternarOculto(id, oculto)` escrevendo `oculto`; (b) controle de **disponibilidade** → `alternarDisponibilidade` (mantida, escreve `disponivel`). Ambas escopadas por `id` sob RLS `produtos_escrita_propria`. Garantido em: **Server Action + RLS**.
- **RN-7 — Retrocompatibilidade.** `oculto` nasce `false` para todo produto existente → nenhuma vitrine muda de comportamento no deploy (produtos disponíveis continuam visíveis). A única mudança de comportamento visível é: produtos que antes eram marcados "indisponível" e sumiam agora **aparecem como esgotado** (não mais sumindo). Isso é o comportamento desejado; comunicar na doc/changelog.

## Segurança (obrigatório)

- **Dado sensível que entra/sai?** Não há PII de cliente, chave Pix nem cupom nesta feature. `oculto`/`disponivel` são flags de catálogo do próprio lojista — não sensíveis.
- **Valor monetário?** Não há novo cálculo monetário, **mas** há um vetor de **compra indevida** (produto esgotado/oculto): o cliente pode ver "esgotado" e forjar o `produto_id` no payload do pedido. **Recálculo/revalidação no servidor é obrigatório** — `criarPedido` deve recusar `oculto = true` além do `!disponivel` já checado (RN-5). Esse é o ponto de segurança central da spec.
- **Tabela nova?** Não — campo novo em tabela existente (`produtos`). A tabela já tem RLS habilitada e três policies (`_leitura_publica`, `_leitura_propria`, `_escrita_propria`). **Policy a alterar:** `produtos_leitura_publica` (DROP + CREATE trocando `disponivel = true` por `oculto = false`). Nenhuma policy nova; as de dono cobrem escrita/leitura do novo campo sem alteração (RLS filtra linha, e `oculto` é coluna da mesma linha já autorizada — sem gate de coluna necessário, pois não é campo de billing).
- **Isolamento multitenant:** toda escrita de `oculto` usa o **client autenticado** (RLS `produtos_escrita_propria`, `dono_id = auth.uid()`), **nunca** `service_role`. As novas actions seguem o contrato de `alternarDisponibilidade` (escopo por `id`, RLS isola por dono, erro genérico sem vazar `e.message` — `seguranca.md §14`).
- **API externa com key?** Nenhuma.
- **XSS:** nada novo renderizado — só um boolean vira badge/toggle. Sem `dangerouslySetInnerHTML`.

## Fora do Escopo (v1)

- **Agendar visibilidade** (ocultar/exibir por horário ou data) — fase futura.
- **Motivo do esgotamento / reposição automática** — não há controle de estoque no iRango; `disponivel` continua manual.
- **Ocultar categoria inteira** de uma vez — esta spec é por produto. Bulk actions ficam fora.
- **Reordenar produtos** — `ordem` continua como está; não faz parte desta mudança.
- **Índice de performance da vitrine** (`produtos(loja_id, oculto, ordem)`) — otimização opcional a critério do `migrar`/`planejar`; não bloqueia a feature.
- **Migração de dados** de "indisponível que sumia" para "oculto" — decisão de produto é **não** migrar: produtos hoje indisponíveis passam a aparecer como esgotado (RN-7). Se algum lojista quiser escondê-los, usa o novo controle "Ocultar".
