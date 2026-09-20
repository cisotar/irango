-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 221 — migration 4: `itens_pedido.preco_original` (snapshot do preço de
-- tabela, ao lado do preço pago).
-- Spec: specs/desconto-por-produto-e-pratos-promocionais.md §Modelos de Dados
--       (migration 4) · D7 · RN-13 · RN-14.
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md, onda 1.
-- Par: 20260920127000_rpc_criar_pedido_preco_original.sql (migration 5, a RPC
--      que passa a gravar esta coluna). Esta vem ANTES, sempre: a coluna existe
--      antes de qualquer INSERT que a referencie.
--
-- ADITIVA / EXPAND-ONLY, SEM BACKFILL:
--   `itens_pedido` é tabela POPULADA em produção. `ADD COLUMN` nullable SEM
--   default é metadata-only: não reescreve a tabela e não invalida nenhuma linha
--   existente. `NULL` = "não houve desconto neste item", que é exatamente a
--   semântica correta para TODO o histórico anterior à feature (RN-13). Nenhum
--   `SET NOT NULL`, nenhum `DROP`, nenhum `RENAME`: não há fase contract aqui.
--   Precedente literal: 20260907120000_itens_pedido_observacao.sql.
--
-- SNAPSHOT IMUTÁVEL: mesma família de `itens_pedido.nome`, `.preco` e
--   `.observacao` (`schema.md` §6). Editar (ou apagar) o produto depois NÃO
--   muda pedido nenhum — `produto_id` é `on delete set null` justamente para o
--   histórico sobreviver ao catálogo.
--
-- O CHECK é DEFESA EM PROFUNDIDADE, não a autoridade:
--   a autoridade dos dois números é a Server Action, que os deriva do BANCO
--   (`seguranca.md` §10) — o schema zod do pedido continua `.strict()` e
--   continua sem nenhum campo monetário. O CHECK existe para o caso de a
--   autoridade falhar: ele impede o snapshot sem sentido ("de R$ 80 por
--   R$ 100"), porque promoção NUNCA sobe preço (RN-13).
--   O `23514` que ele produz nunca vira texto na UI: mensagem genérica ao
--   cliente, detalhe no log do servidor (`seguranca.md` §14).
--
-- POR QUE `preco_original is null or ...` e não só `>= preco`:
--   um CHECK cujo predicado dá NULL é considerado SATISFEITO pelo Postgres, e
--   portanto `preco_original >= preco` sozinho já deixaria NULL passar. A forma
--   explícita está aqui porque o NULL é PARTE DO CONTRATO (item sem desconto),
--   não um acidente tolerado — e é a forma literal da spec.
--
-- RLS: NENHUMA policy nova, e nenhuma alterada.
--   `itens_pedido` já tem RLS habilitada. INSERT é EXCLUSIVO da RPC sob
--   `service_role` (o INSERT público caiu na 20260708130000). Policy filtra
--   LINHA, não COLUNA: a coluna nova nasce coberta pelas policies existentes
--   (SELECT do dono da loja via join em `pedidos`; deny-all de escrita para
--   anon/authenticated). Grants são de TABELA, não de coluna — nada é
--   reemitido, e nenhuma via de escrita nova é aberta: `preco_original` entra
--   pelo `p_itens` que já existia.
--
-- Campo NÃO é billing/identidade: fora de qualquer trigger protege_billing_v*.
-- É valor monetário: `numeric(10,2)`, NUNCA float (`schema.md` §6).
--
-- Rollback: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── (1) a coluna ─────────────────────────────────────────────────────────────
alter table public.itens_pedido
  add column if not exists preco_original numeric(10,2);

comment on column public.itens_pedido.preco_original is
  'D7/RN-13: preco de TABELA do produto no momento do pedido, quando houve desconto. NULL = nao houve desconto (gatilho de RN-14: exibe "de/por" se e somente se nao for NULL). Snapshot imutavel, mesma familia de nome/preco/observacao. Sempre >= preco (itens_pedido_preco_original_check): promocao nunca sobe preco. Derivado do BANCO pela Server Action, nunca do payload do cliente.';

-- ── (2) o CHECK ──────────────────────────────────────────────────────────────
-- Idempotente por `pg_constraint` (ADD CONSTRAINT não aceita IF NOT EXISTS).
-- Entra VALIDADO (sem `not valid`): toda linha existente tem `preco_original`
-- NULL e satisfaz o predicado trivialmente — o bloco de VALIDAÇÃO abaixo confere.
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'itens_pedido_preco_original_check'
       and conrelid = 'public.itens_pedido'::regclass
  ) then
    alter table public.itens_pedido
      add constraint itens_pedido_preco_original_check
      check (preco_original is null or preco_original >= preco);
  end if;
end $$;

-- ── VALIDAÇÃO (conferência, não backfill — esperado: 0) ──────────────────────
do $$
declare v_invalidas bigint;
begin
  select count(*) into v_invalidas
    from public.itens_pedido
   where preco_original is not null;
  if v_invalidas > 0 then
    raise warning 'itens_pedido com preco_original ja preenchido logo apos a migration: %', v_invalidas;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: ATÉ o primeiro pedido gravado com `preco_original` não-NULL em
--   produção. Antes disso a reversão é SEM PERDA (toda linha é NULL). Depois,
--   `drop column` apaga o preço de tabela de pedidos já fechados — snapshot
--   histórico, IRREVERSÍVEL (RN-14 passaria a exibir preço único em pedido que
--   de fato teve desconto).
--
-- Ordem: reverter PRIMEIRO a RPC (20260920127000), senão ela passa a referenciar
--   coluna inexistente e TODO pedido novo aborta. Só então:
--
-- Rollback PARCIAL preferido (zero perda), se o CHECK provar-se apertado demais:
--   alter table public.itens_pedido
--     drop constraint if exists itens_pedido_preco_original_check;
--
-- Rollback TOTAL (só dentro da janela acima, e só depois de reverter a RPC e o
-- código que lê a coluna):
--   alter table public.itens_pedido drop column if exists preco_original;
--   -- (o CHECK cai junto com a coluna que referencia)
-- ─────────────────────────────────────────────────────────────────────────────
