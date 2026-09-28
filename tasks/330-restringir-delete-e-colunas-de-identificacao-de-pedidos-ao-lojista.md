# 330 — Restringir DELETE e colunas de identificação de `pedidos` para o lojista

crítica: SIM (RLS + token de pedido)

## Origem

Observação do `auditar` na issue 299 (commit auditado `2c4ef61`, PR #164), registrada como
problema anterior que aquele diff não amplia. Não é regressão da 299.

## Problema

A policy `pedidos_acesso_lojista` (`supabase/migrations/20260614002500_rls_cupons_pedidos.sql:52`)
é `FOR ALL`: filtra a **linha** pela loja do dono, mas não restringe **operação** nem **coluna**.
Os triggers `pedidos_protege_valor_trg` (colunas de valor) e `pedidos_transicao_status_trg`
(`status` e `tipo_entrega`, issue 299) cobrem só parte da linha. Pelo PostgREST direto
(`/rest/v1/pedidos`, com o JWT do próprio lojista), o dono ainda consegue:

- **apagar** pedidos da própria loja (`DELETE`). Nenhum fluxo do app apaga pedido (`grep` de
  `.delete()` em pedidos em `src/lib/actions` e `src/app` vazio), e o INSERT de anon/authenticated
  já foi revogado (`20260923060457`), então o pedido apagado não volta;
- **reescrever** colunas de identificação e de acesso: `nome_cliente`, `telefone_cliente`,
  `endereco_entrega`, `observacoes`, `token_acesso`, `criado_em`.

Sem cruzamento entre lojas: a RLS continua escopando pela loja do `auth.uid()`. Efeitos
concretos no próprio pedido:

- trocar `token_acesso` quebra o link de acompanhamento que o cliente recebeu
  (`/loja/[slug]/confirmacao?pedido=…&token=…`), e ele passa a ver "pedido não encontrado";
- apagar o pedido, ou reescrever `criado_em`, altera o histórico e as métricas do painel
  (`calcularMetricasDoDia`) sem rastro;
- reescrever os dados do cliente altera o registro do que foi pedido.

Não foi confirmado no cloud se `anon`/`authenticated` têm `TRUNCATE`/`TRIGGER` em `pedidos`
(apareceu no pglite; não é alcançável pelo PostgREST). Conferir junto.

## Direção sugerida

- Revogar `DELETE` em `pedidos` de `authenticated` (ou trocar o `FOR ALL` por policies separadas
  de `SELECT` e `UPDATE`), mantendo o `service_role` para o admin.
- Imutabilidade das colunas de identificação e de `token_acesso`/`criado_em` para autor não-sistema:
  estender o trigger da 299 ou criar outro no mesmo molde (SECURITY INVOKER, whitelist
  `service_role`/`postgres`/`supabase_admin`). Antes, conferir se algum fluxo legítimo do lojista
  edita esses campos (hoje nenhum foi encontrado).
- Teste pglite RED primeiro: `asUser(dono)` tenta `DELETE` e o `UPDATE` de cada coluna → recusa
  com fragmento de mensagem próprio + releitura via `asService`; o `service_role` continua passando;
  `registrarFreteCombinado` e `atualizarStatusPedido` continuam verdes.

## Criticidade

Crítica (TDD red-first): RLS, migration e `token_acesso` (capability do cliente).
