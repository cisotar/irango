# Spec: Hard Delete de Loja (Admin do SaaS)

**Versão:** 0.1.0 | **Atualizado:** 2026-06-21

## Visão Geral

Adiciona à tela `/admin/assinantes` (painel exclusivo do dono do SaaS) um botão de **hard delete** — exclusão permanente e irreversível de uma loja e de TODOS os seus dados filhos (catálogo, pedidos, cupons, zonas, formas de pagamento, billing, objetos de storage).

**Problema que resolve:** hoje a tela só oferece operações de billing reversíveis (cortesia / suspender / reativar — mudam `assinatura_status`). Não há como remover de fato uma loja (teste, fraude, pedido de exclusão LGPD do lojista, lixo de QA). O hard delete cobre esse buraco com uma ação destrutiva, fail-closed e guardada por dupla confirmação.

**Mundo:** painel administrativo do SaaS — **auth obrigatório + admin do SaaS**. Não é vitrine pública nem painel do lojista. A única prova de identidade é `verificarAdminSaaS()` (compara `user.id` do cookie HttpOnly com `SAAS_ADMIN_USER_ID`).

**Diferença vs. o existente:** cortesia/suspender/reativar são `UPDATE` reversível em `lojas`. Hard delete é `DELETE` definitivo — sem desfazer, sem lixeira.

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (dono do SaaS)** | único que pode executar o hard delete. Decide e confirma a exclusão na tela `/admin/assinantes`. |
| **Lojista** | alvo passivo — a loja dele é apagada. NÃO participa do fluxo (não é ele quem aciona). O `auth.user` dele permanece (fora de escopo — ver abaixo). |
| **Cliente** | indireto — os pedidos que ele fez naquela loja são apagados junto (cascade). |

## Páginas e Rotas

### Tela de Assinantes — `/admin/assinantes`

**Mundo:** painel admin do SaaS (auth obrigatório + `verificarAdminSaaS()` no guard da rota)
**Descrição:** lista todas as lojas com dados de assinatura. Cada linha (`AssinanteLinha`) já exibe as ações reversíveis de billing via `AcoesAssinante.tsx`. Esta feature **acrescenta** a ação destrutiva de exclusão, visualmente separada das reversíveis.

**Componentes:** (reuso — nada novo de infra)
- `AcoesAssinante.tsx` (existente) — recebe o novo botão "Excluir loja". Já usa `useTransition`, `sonner` (`toast`), `AlertDialog` do `@base-ui/react/alert-dialog` e `Button` do shadcn. **Espelhar o padrão do "Suspender"** (que já tem `AlertDialog` de confirmação destrutiva via `confirmarSuspensao`).
- `Button` (shadcn/ui) — `variant="destructive"` para o gatilho.
- `AlertDialog` (`@base-ui/react/alert-dialog`) — dialog de confirmação com cópia de palavra. Reuso do padrão já presente no arquivo.
- `Input` (shadcn/ui) — campo onde o admin digita/cola a palavra de confirmação.
- Sem componente novo extraído: a ação vive dentro de `AcoesAssinante.tsx`, isolada num bloco separado das ações de billing (separador visual / agrupamento "Zona de perigo").

**Behaviors:**
- [x] Visualizar botão "Excluir loja" (variante `destructive`) por linha, fisicamente separado do toggle de cortesia e do botão Suspender/Reativar. Garantido em: cliente (UX).
- [x] Abrir dialog de confirmação ao clicar "Excluir loja" — exibe o **nome da loja** e um aviso de irreversibilidade ("Isso apaga a loja, todos os pedidos, produtos e configurações. Não há como desfazer."). Garantido em: cliente (UX).
- [x] Digitar/colar a palavra de confirmação no `Input` — a palavra exigida é o **nome exato da loja** (`assinante.nome`). Garantido em: cliente (UX).
- [x] Botão "Confirmar exclusão" permanece **desabilitado** até o texto digitado bater exatamente com o nome da loja (comparação no cliente). Garantido em: cliente (UX) — esta trava NÃO é a defesa de segurança; é só anti-erro humano. A verdade é `verificarAdminSaaS()` no servidor.
- [x] Confirmar exclusão → chama Server Action `excluirLoja(lojaId)` dentro de `useTransition`; mostra `Loader2` durante a transição. Garantido em: **Server Action + verificarAdminSaaS** (a palavra digitada NÃO é enviada nem revalidada no servidor — o cliente envia apenas `lojaId`).
- [x] Em sucesso → `toast.success("Loja \"<nome>\" excluída permanentemente.")` e a linha some após `revalidatePath`. Garantido em: Server Action (revalidatePath) + cliente (toast).
- [x] Em falha de admin (exceção propagada, D-4) ou erro genérico → `toast.error("Não foi possível concluir a ação.")`, loja permanece. Garantido em: Server Action (fail-closed) + cliente (toast).
- [x] Cancelar/fechar o dialog sem confirmar → nenhum efeito. Garantido em: cliente (UX).

---

## Server Action

### `excluirLoja(lojaId: string): Promise<Resultado>` — `src/app/admin/assinantes/actions.ts`

Acrescentada ao arquivo de actions admin existente, seguindo **exatamente** o molde das actions de billing.

Sequência (toda no servidor, ordem obrigatória):

1. `const parsed = lojaIdSchema.safeParse(lojaId)` (reuso do `z.string().uuid()` já no arquivo) — se inválido, `return { ok: false, erro: "Loja inválida." }`.
2. `await verificarAdminSaaS()` — **ANTES de qualquer efeito**. Falha de admin propaga exceção (D-4/D-5), nunca vira `{ ok:false }` amigável. Única linha de defesa.
3. `const svc = createServiceClient()` — eleva para `service_role` (BYPASSRLS) só depois da prova de admin.
4. **Limpeza de storage (antes do DELETE do banco):** para cada bucket `["pix-qr", "produtos"]`: `svc.storage.from(bucket).list(lojaId)` → mapear nomes para `` `${lojaId}/${obj.name}` `` → `svc.storage.from(bucket).remove(paths)`. Objetos vivem sob prefixo `<loja_id>/...`. Falha de storage é logada mas **não aborta** o DELETE do banco (objeto órfão é lixo barato; loja órfã no banco é pior). Decisão: best-effort no storage, autoritativo no DELETE.
5. `const { count } = await svc.from("lojas").delete({ count: "exact" }).eq("id", parsed.data)` — o cascade do Postgres remove todos os filhos (ver Modelos de Dados). `count === 0` → `return lojaNaoEncontrada()`.
6. `revalidatePath("/admin/assinantes")` (constante `ROTA_ASSINANTES` já existe no arquivo).
7. `return { ok: true }`.
8. `catch` genérico → `console.error("[excluirLoja]", e)` + `return { ok: false, erro: "Não foi possível concluir a ação." }` (seguranca.md §14 — erro interno nunca vaza ao cliente).

**Reuso:** `lojaIdSchema`, `ROTA_ASSINANTES`, `lojaNaoEncontrada()`, `verificarAdminSaaS()`, `createServiceClient()` — todos já existem. A query de DELETE pode ir para `adminAssinatura.ts` como `excluirLojaPermanente(client, lojaId)` retornando `{ linhasAfetadas }`, espelhando `aplicarStatusAdmin`, mantendo a action sem `.from(...)` inline (architecture.md §8 DRY).

**Behaviors (servidor):**
- [x] Validar `lojaId` como UUID. Garantido em: Server Action (zod).
- [x] Provar admin antes de qualquer efeito. Garantido em: `verificarAdminSaaS()` (cookie HttpOnly autoritativo).
- [x] Remover objetos dos buckets `pix-qr` e `produtos` sob prefixo `<loja_id>/`. Garantido em: Server Action + service_role (storage não cascateia via FK).
- [x] `DELETE FROM lojas WHERE id = lojaId` com cascade. Garantido em: service_role + FKs `ON DELETE CASCADE` no banco.
- [x] Revalidar a rota. Garantido em: Server Action (`revalidatePath`).

---

## Modelos de Dados

Tabelas afetadas (todas em `schema.md`). O hard delete é um `DELETE` na linha de `lojas`; a propagação depende das FKs.

### Migration nova — obrigatória

**`pedidos.loja_id` → `ON DELETE CASCADE`** (verificado: `supabase/migrations/20260614000129_schema_inicial.sql:135` declara `loja_id uuid not null references public.lojas(id)` **sem cláusula `on delete`** = RESTRICT).

Sem esta migration, o `DELETE FROM lojas` **falha com erro de FK** sempre que a loja tiver ≥1 pedido — bloqueio total da feature para qualquer loja real.

Tabela já populada em produção → **expand/contract** (drop + recreate da constraint):

```sql
-- supabase/migrations/<ts>_pedidos_loja_id_cascade.sql
alter table public.pedidos
  drop constraint pedidos_loja_id_fkey;

alter table public.pedidos
  add constraint pedidos_loja_id_fkey
  foreign key (loja_id) references public.lojas(id) on delete cascade;
```

> Verificar o nome real da constraint antes (`pedidos_loja_id_fkey` é o default do Postgres para `pedidos(loja_id)`; confirmar via `\d pedidos` ou `information_schema`). O agente `migrar` valida o nome e gera o rollback (recriar a FK sem `on delete`).

`itens_pedido.pedido_id` já é `ON DELETE CASCADE` (schema.md `itens_pedido`) → cascateia a partir de `pedidos`, sem mudança. `itens_pedido_opcionais.item_pedido_id` idem.

### Filhos que somem por cascade (já corretos — sem mudança)

Todos com `references lojas(id) on delete cascade` (verificado no schema inicial, linhas 62/71/86/102/127): `categorias`, `produtos`, `cupons`, `zonas_entrega` (e `taxas_entrega`/`bairros_zona` via zona), `formas_pagamento`, `opcionais_categorias`/`opcionais`, `categoria_produto_opcionais`. `pagamentos_assinatura`/billing por `loja_id` cascade idem.

`produtos.categoria_id` é `ON DELETE SET NULL`, mas como a loja inteira é apagada isso é irrelevante (produtos somem junto).

### `auth.users` — NÃO tocado

`lojas.dono_id references auth.users(id) on delete cascade` aponta de `lojas` para `auth.users` (não o contrário). Deletar a loja **não** deleta o usuário. Intencional — ver Fora de Escopo.

### Storage — não cascateia via FK

Buckets `pix-qr` e `produtos` (migrations 074 e 010500). Objetos sob `<loja_id>/...`. Postgres FK não alcança `storage.objects` por path → limpeza explícita na Server Action (passo 4).

### RLS

Nenhuma tabela nova → nenhuma política RLS nova. A `lojas` já tem `lojas_delete_proprio` (FOR DELETE USING `auth.uid() = dono_id`) — irrelevante aqui porque a action usa `service_role` (BYPASSRLS). A defesa é `verificarAdminSaaS()` na action, não RLS.

## Regras de Negócio

| # | Regra | Camada que garante |
|---|-------|--------------------|
| RN-1 | Só o admin do SaaS executa hard delete. | `verificarAdminSaaS()` na Server Action (cookie HttpOnly vs `SAAS_ADMIN_USER_ID`) — **fail-closed**: env ausente bloqueia todos (D-5). |
| RN-2 | A confirmação por digitação da palavra (nome da loja) é UX anti-erro, **não** segurança. | Cliente (UX). O servidor não recebe nem valida a palavra — recebe só `lojaId`. |
| RN-3 | O cliente envia **apenas** `lojaId`. Nada além disso é confiável. | Server Action (zod `uuid()`) + service_role escopado por `eq("id", lojaId)`. |
| RN-4 | Exclusão é atômica do ponto de vista do banco: ou a loja e todos os filhos somem, ou nada. | Cascade transacional do Postgres (um único `DELETE` dispara todos os cascades na mesma transação). |
| RN-5 | `pedidos` da loja são apagados junto. | FK `pedidos.loja_id ON DELETE CASCADE` (migration nova) — sem ela, o DELETE falha. |
| RN-6 | Objetos de storage da loja (`pix-qr`, `produtos`) são removidos. | Server Action + service_role (storage não cascateia). Best-effort: falha de storage não aborta o DELETE. |
| RN-7 | Loja inexistente (`count === 0`) → `{ ok:false, erro:"Loja não encontrada." }`, não exceção. | Server Action (`lojaNaoEncontrada()`). |
| RN-8 | Erro interno nunca vaza ao cliente. | Server Action `catch` genérico (seguranca.md §14). |

## Segurança (obrigatório)

- **Dado sensível que entra:** apenas `lojaId` (UUID). A palavra de confirmação **não** trafega para o servidor — é validação local.
- **Dado sensível que sai (é destruído):** PII de cliente em `pedidos` (nome, telefone, endereço), chave Pix em `formas_pagamento`, QR Pix no bucket `pix-qr`. Tudo apagado permanentemente — alinhado ao direito de exclusão LGPD (seguranca.md §20). A irreversibilidade é a feature, não um risco.
- **Valor monetário?** Não há cálculo de valor. Não aplica recálculo no servidor — a única "decisão" do servidor é *qual loja* apagar, derivada de `lojaId` validado, nunca da palavra digitada.
- **Tabela nova?** Não. Migration altera FK de `pedidos` (ON DELETE CASCADE); sem tabela nova, sem RLS nova.
- **API externa com key?** Não.
- **Defesa primária:** `verificarAdminSaaS()` antes de qualquer efeito, idêntico às actions de billing. A confirmação no cliente (digitar nome) é defesa-em-profundidade contra clique acidental do próprio admin, **nunca** a barreira de autorização.
- **service_role:** mesmo caminho das outras actions admin (`createServiceClient()`, módulo `server-only`). Query escopada manualmente por `eq("id", lojaId)` — RLS não protege sob service_role (seguranca.md §7).
- **Trigger de billing:** `lojas_protege_billing_trg` é `BEFORE UPDATE` apenas → não interfere no `DELETE` (verificado).
- **Tratamento de erro:** mensagem genérica ao cliente, detalhe só em `console.error` (seguranca.md §14).

## Fora do Escopo (v1)

- **Deletar o `auth.user` do dono.** A loja é apagada; o usuário permanece e pode recriar uma loja (`garantir_loja_do_dono` é idempotente). Remoção de conta de auth é fluxo distinto (LGPD do lojista) — follow-up.
- **Lixeira / soft delete / desfazer.** Hard delete é definitivo por decisão. Não há undo, snapshot ou retenção.
- **Exportar dados da loja antes de excluir** (backup/portabilidade). Não nesta versão.
- **Log de auditoria persistente** de quem excluiu o quê e quando (apenas `console.error`/log de servidor na v1). Trilha de auditoria estruturada é follow-up.
- **Exclusão em lote / multi-seleção.** Uma loja por vez.
- **Confirmação por segundo fator (email/2FA) do admin.** A palavra digitada é a única barreira anti-erro além do `verificarAdminSaaS()`.
- O painel super-admin do SaaS em si é fase 2 no roadmap (`modelo-negocio.md` §8), mas a tela `/admin/assinantes` já existe — esta feature só acrescenta uma ação a ela.
