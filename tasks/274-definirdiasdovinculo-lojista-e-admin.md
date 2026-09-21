# [274] `definirDiasDoVinculo` no lojista e no admin, pelo contrato neutro, com escopo por `loja_id`

**crítica:** SIM (TDD red-first)
**Mundo:** painel + painel admin
**Depende de:** [272], [273]
**Spec:** specs/vigencia-por-item-do-cardapio.md — RN-10, RN-11, RN-12, RN-14 (+ §Segurança)

## Origem

Spec §Detalhe do cardápio (behavior "Não conseguir definir dias num vínculo de outra loja") e
§Cardápio no hub admin (paridade total, `service_role` com BYPASSRLS). O precedente de auditoria de
[270] vale aqui: o padrão novo não copia o bug do `ON CONFLICT`.

## Objetivo

Criar a única via de escrita da agenda do vínculo, nos dois mundos, com `loja_id` derivado da sessão
(lojista) ou do `lojaId` da URL validado (admin) — nunca do payload — e uma frase de recusa única
para vínculo inexistente ou alheio.

## Escopo

- [ ] `schemaDiasDoVinculo` em `src/lib/validacoes/cardapio.ts` (`.strict()`, `dias_semana` 0..6, `.max(7)`)
- [ ] `normalizarDiasDoVinculo` (função pura, dedup + ordem, `[]` → `null`) e `MSG_DIAS_DO_VINCULO`
      em `src/lib/actions/cardapio-contrato.ts` — compartilhados pelos dois mundos (RN-11, RN-12)
- [ ] `EscopoLoja.atualizarPorChave(tabela, chave, patch)` em `src/lib/actions/admin-loja.ts`:
      escopo duplo `loja_id` + colunas da chave, `count: "exact"`. `cardapio_produtos` não tem `id`,
      então o `atualizar` existente (escopo `loja_id`+`id`) não serve — e o `svc` cru não é opção
- [ ] `definirDiasDoVinculo` em `src/lib/actions/cardapio.ts`: UPDATE escopado pela tripla
      `loja_id` + `cardapio_id` + `produto_id`, `count: "exact"`; `count === 0` ⇒ falha com `MSG_DIAS_DO_VINCULO`
- [ ] `definirDiasDoVinculoAdmin` em `src/app/admin/assinantes/actions/admin-cardapios.ts`:
      `verificarAdminSaaS` **antes** de elevar a `service_role`, escopo injetado pelo wrapper,
      `registrarAcessoAdmin({ acao: "cardapio.definir_dias", entidadeId: cardapio_id, metadados: { produto_id, dias: n } })`
- [ ] `revalidatePath` das rotas de cardápio nos dois mundos (via `rotasCardapios.ts`)

## Fora de escopo

- Qualquer componente que chame a action — [275]–[278]
- A ação "Definir dias" no diálogo de lote (consome esta action, mas é UI) — [277]
- Horário por item; segundo caminho de escrita de qualquer tipo

## Reuso esperado

- `cardapio-contrato.ts` (contrato neutro da 269): `Resultado`, padrão de mensagem única
- `EscopoLoja` / `prepararContextoAdmin` / `validarLojaIdAdmin` (`src/lib/actions/admin-loja.ts`)
- `buscarLojaDoDono` no lojista; `rotasCardapios.ts` para revalidação
- `schemaIdCardapio` / `z.guid()` já usados em `lib/validacoes/cardapio.ts`
- `admin-cardapios.paridade.test.ts` como suíte de paridade já existente

## Segurança

- **RLS não protege o caminho admin** (`service_role` = BYPASSRLS): quem protege é a **FK composta**
  `(cardapio_id, loja_id)` / `(produto_id, loja_id)` + o escopo explícito por `loja_id`
- `loja_id` **nunca** do payload (RN-10); `.strict()` recusa chave a mais antes de tocar o banco
- Alheio e inexistente recebem a **mesma** frase — sem oráculo de existência de id (`seguranca.md` §14)
- Erro do banco vai para `console.error("[definirDiasDoVinculo]", e)`; a UI vê frase genérica
- Log admin grava **contagem** (`dias: n`), nunca conteúdo de produto

## Critério de aceite

- [ ] RED capturado com `FAIL` real antes do código de produção, cobrindo:
      (a) `loja_id` enviado no payload é ignorado; (b) `cardapio_id` de outra loja é recusado
      **afirmando o fragmento da mensagem** (`MSG_DIAS_DO_VINCULO`), não só o SQLSTATE;
      (c) `dias_semana: []` chega ao banco como `NULL`; (d) admin não chama `registrarAcessoAdmin` na recusa
- [ ] `npx vitest run src/lib/actions/cardapio.test.ts src/app/admin/assinantes/actions/admin-cardapios.paridade.test.ts` verde
- [ ] `npx tsc --noEmit` = 0 · `npm run lint` = 0 · **`npm run build` verde** (const exportada em `'use server'` só quebra aqui)
