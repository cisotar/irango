-- Issue 067 — adicionar `tipo_entrega` e `troco_para` à tabela `pedidos`.
--
-- `tipo_entrega`: instrução operacional do checkout (retirada|entrega). NOT NULL
-- com DEFAULT 'entrega' para backfill de linhas existentes e para compatibilidade
-- com o INSERT da RPC criar_pedido (que ainda não passa o campo — issue 069).
-- O DEFAULT permanece em produção pois o campo é omitido pelo caller até issue 069.
-- CHECK inline em vez de CREATE TYPE (schema.md §6 — pglite-safe, sem extensão).
--
-- `troco_para`: informativo (RN-C3). Nullable — só dinheiro; nunca entra em
-- cálculo autoritativo. numeric(10,2) por convenção schema.md §6.
--
-- RLS: as policies existentes (pedidos_insert_publico, pedidos_acesso_lojista)
-- cobrem as novas colunas — nenhuma policy nova necessária.
--
-- Rollback: ALTER TABLE public.pedidos DROP COLUMN tipo_entrega, DROP COLUMN troco_para;
-- Janela segura: até o deploy de issue 069 (que começa a escrever tipo_entrega).
-- Após issue 069 em prod, a coluna tem dados reais — DROP elimina histórico.

ALTER TABLE public.pedidos
  ADD COLUMN tipo_entrega text NOT NULL DEFAULT 'entrega'
    CHECK (tipo_entrega IN ('retirada', 'entrega')),
  ADD COLUMN troco_para   numeric(10,2);
