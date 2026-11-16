-- ─────────────────────────────────────────────────────────────────────────────
-- lojas.primeira_publicacao_em — marcador "já publicada ao menos uma vez" (issue 368)
--
-- D1. O roteamento do painel usa `primeira_publicacao_em IS NOT NULL`, nunca o
--     `ativo` atual: despublicar não devolve o lojista ao assistente.
-- D2. Backfill: toda loja com `ativo = true` OU com ≥1 pedido já foi publicada.
-- D3. Só o banco grava, via trigger BEFORE INSERT/UPDATE, quando `ativo`
--     nasce/vira true. Write-once para QUALQUER papel (authenticated,
--     service_role, sem bypass).
-- DD11. O trigger ignora o valor enviado pelo escritor (não lança): um UPDATE que
--     reenvie a linha inteira continua funcionando, e a coluna fica intocável.
-- D17. Sem validação de prontidão em SQL: o gate único é `podePublicarLoja` no
--     servidor. O débito 140 (PATCH direto em `ativo` pelo dono) segue aberto.
--
-- Expand-only e aditiva: coluna nula, sem default, sem índice (lida sempre por
-- linha da própria loja). RLS de `lojas` não muda: a coluna herda as policies da
-- tabela, e o trigger impede qualquer escrita direta.
--
-- ORDEM IMPORTA: o backfill roda ANTES do trigger existir. Com o trigger já
-- criado, o UPDATE do backfill seria recalculado (coalesce(old, ativo ? now())) e
-- as lojas `ativo = false` com pedido ficariam nulas.
--
-- O backfill só toca `primeira_publicacao_em`. Triggers `update of <coluna>` de
-- `lojas` (dono, logo) não disparam; `lojas_protege_billing_trg` dispara, mas o
-- autor é `postgres` (bypass) e a coluna não está na lista protegida.
--
-- Rollback (janela: qualquer momento; perde só o marcador, que é recalculável
-- pelo mesmo backfill — mas lojas publicadas e depois despublicadas sem pedido
-- perderiam o histórico):
--   drop trigger if exists lojas_marca_primeira_publicacao_trg on public.lojas;
--   drop function if exists public.lojas_marca_primeira_publicacao();
--   alter table public.lojas drop column if exists primeira_publicacao_em;
-- Antes do drop column, o código que lê a coluna (P6) precisa ter sido revertido,
-- senão o PostgREST responde PGRST204/42703.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Coluna (expand).
alter table public.lojas
  add column if not exists primeira_publicacao_em timestamptz;

comment on column public.lojas.primeira_publicacao_em is
  'Momento da primeira publicação (ativo nasceu/virou true). Gravada só pelo trigger lojas_marca_primeira_publicacao_trg; write-once; nunca volta a null. Issue 368.';

-- 2. Backfill D2 (antes do trigger). Idempotente: só preenche quem está nulo.
update public.lojas l
   set primeira_publicacao_em = now()
 where l.primeira_publicacao_em is null
   and (
     l.ativo = true
     or exists (select 1 from public.pedidos p where p.loja_id = l.id)
   );

-- 3. Função do trigger (DD11). SECURITY INVOKER; search_path vazio e objetos
--    qualificados (now() é pg_catalog, sempre resolvido).
create or replace function public.lojas_marca_primeira_publicacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.primeira_publicacao_em := case when new.ativo then now() else null end;
  else
    new.primeira_publicacao_em := coalesce(
      old.primeira_publicacao_em,
      case when new.ativo then now() else null end
    );
  end if;
  return new;
end;
$$;

revoke all on function public.lojas_marca_primeira_publicacao() from public, anon, authenticated;

-- 4. Trigger em toda escrita (não `update of ativo`: precisa reescrever o valor
--    mesmo quando o UPDATE mexe só em `primeira_publicacao_em`).
drop trigger if exists lojas_marca_primeira_publicacao_trg on public.lojas;
create trigger lojas_marca_primeira_publicacao_trg
  before insert or update on public.lojas
  for each row
  execute function public.lojas_marca_primeira_publicacao();
