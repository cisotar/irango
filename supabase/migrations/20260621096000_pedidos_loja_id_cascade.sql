-- ─────────────────────────────────────────────────────────────────────────────
-- [083] pedidos.loja_id → ON DELETE CASCADE
--
-- A FK pedidos.loja_id nasceu no schema_inicial como `references lojas(id)` sem
-- `on delete` ⇒ RESTRICT por padrão. Isso impede o hard delete de uma loja com
-- pedidos (issue 084). Troca a regra para CASCADE: apagar a loja apaga seus
-- pedidos, que por sua vez já cascateiam itens_pedido (schema_inicial:156).
--
-- Constraint gerada inline pelo Postgres como `pedidos_loja_id_fkey` (padrão
-- <tabela>_<coluna>_fkey). Operação aditiva/segura: NÃO apaga nem altera linha
-- alguma; só muda o comportamento de DELETE futuro. Coluna segue `not null`.
--
-- Idempotente: drop com `if exists`; o add é guardado por checagem em
-- pg_constraint para sobreviver a reaplicação parcial. Roda na transação
-- implícita da migration — drop + add commitam juntos ou nenhum.
--
-- Rollback: ver bloco comentado no fim do arquivo (recria SEM on delete = RESTRICT).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.pedidos
  drop constraint if exists pedidos_loja_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pedidos_loja_id_fkey'
  ) then
    alter table public.pedidos
      add constraint pedidos_loja_id_fkey
      foreign key (loja_id) references public.lojas(id) on delete cascade;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration) — volta a RESTRICT:
--
--   alter table public.pedidos drop constraint if exists pedidos_loja_id_fkey;
--   alter table public.pedidos
--     add constraint pedidos_loja_id_fkey
--     foreign key (loja_id) references public.lojas(id);
--   -- (sem `on delete` = NO ACTION/RESTRICT, idêntico ao estado do schema_inicial)
-- ─────────────────────────────────────────────────────────────────────────────
