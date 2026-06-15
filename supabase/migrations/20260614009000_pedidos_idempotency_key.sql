-- Issue 063 — idempotência de `criar_pedido` (anti duplo-submit / retry).
--
-- Migration A (expand-only): adiciona a coluna `idempotency_key` em `pedidos`
-- e um índice UNIQUE PARCIAL `(loja_id, idempotency_key) WHERE idempotency_key
-- is not null`. A coluna é NULLABLE, sem DEFAULT que toque linhas existentes →
-- ALTER instantâneo (metadata-only) mesmo na tabela populada. As linhas legadas
-- ficam com `idempotency_key = NULL`; como o índice é PARCIAL, duas linhas NULL
-- nunca colidem no UNIQUE.
--
-- RLS: `pedidos` já tem RLS (002500). Adicionar coluna não altera políticas; a
-- coluna nova é coberta por elas como qualquer outra. Nada a fazer em RLS/grants.

alter table public.pedidos
  add column if not exists idempotency_key uuid;

-- UNIQUE PARCIAL: garante 1 pedido por (loja, chave) SOMENTE quando há chave.
-- Linhas legadas (idempotency_key NULL) ficam fora do índice → não colidem.
create unique index if not exists pedidos_loja_idempotency_key_uniq
  on public.pedidos (loja_id, idempotency_key)
  where idempotency_key is not null;
