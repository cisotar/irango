-- Issue 299 — máquina de status do pedido no banco (spec status-pedido-clicavel-e-latencia).
--
-- A RLS filtra LINHA, não COLUNA. A policy pedidos_acesso_lojista (FOR ALL,
-- lojas.dono_id = auth.uid()) concede UPDATE da linha inteira ao dono
-- autenticado — então o lojista, via PostgREST direto (PATCH /rest/v1/pedidos),
-- reescrevia status e tipo_entrega livremente. A máquina de estados (RN-08,
-- transicaoPermitida) só existia na Server Action, o que abria a sequência de
-- 3 PATCHes "descancela → registra frete → recancela", violando D2 de
-- specs/modalidades-entrega-loja.md (frete combinado não vale para cancelado).
--
-- Correção: trigger BEFORE UPDATE que, quando o autor NÃO é sistema
-- (service_role / migrations):
--   - recusa qualquer troca de tipo_entrega (imutável depois do pedido criado);
--   - recusa troca de status fora do grafo de TRANSICOES
--     (src/lib/utils/transicaoStatus.ts). A diagonal (status reescrito com o
--     mesmo valor) e UPDATE sem status são no-op permitidos.
--
-- O grafo abaixo espelha EXATAMENTE TRANSICOES; a paridade é travada por
-- tests/migrations/pedidos_transicao_status.test.ts, que deriva o esperado dos
-- 30 pares de transicaoPermitida. Mudou o grafo no TS → nova migration aqui.
--
-- Nome ordena depois de pedidos_protege_valor_trg (triggers BEFORE disparam em
-- ordem alfabética): a proteção de valor lê OLD, então a ordem não altera o
-- resultado, mas fica determinística.
--
-- SECURITY INVOKER (default) de propósito: com SECURITY DEFINER, current_user
-- viraria o dono da função (postgres) e todo autor passaria.
--
-- Aditivo, sem mudança de dados nem de colunas (database.types.ts intacto);
-- INSERT fora do escopo (só before update).

create or replace function public.pedidos_transicao_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- 1. Autor é o sistema (Server Actions admin via service_role, migrations/backfill).
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  -- 2. Modalidade do pedido é fixada na criação.
  if new.tipo_entrega is distinct from old.tipo_entrega then
    raise exception 'tipo de entrega do pedido é imutável';
  end if;

  -- 3. Troca de status só pelas arestas do grafo (espelho de TRANSICOES).
  if new.status is distinct from old.status
     and (old.status, new.status) not in (
       ('pendente',     'confirmado'),
       ('pendente',     'saiu_entrega'),
       ('pendente',     'cancelado'),
       ('confirmado',   'em_preparo'),
       ('confirmado',   'saiu_entrega'),
       ('confirmado',   'cancelado'),
       ('em_preparo',   'saiu_entrega'),
       ('em_preparo',   'cancelado'),
       ('saiu_entrega', 'entregue')
     ) then
    raise exception 'transição de status não permitida (% → %)', old.status, new.status;
  end if;

  -- 4. Diagonal (de = para) e UPDATE sem status → no-op permitido (D1).
  return new;
end;
$$;

create trigger pedidos_transicao_status_trg
  before update on public.pedidos
  for each row
  execute function public.pedidos_transicao_status();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Remove a defesa em profundidade; o lojista volta a poder reescrever status e
-- tipo_entrega do próprio pedido via PostgREST direto. Só reverta junto de outra
-- proteção.
--
--   drop trigger if exists pedidos_transicao_status_trg on public.pedidos;
--   drop function if exists public.pedidos_transicao_status();
-- ─────────────────────────────────────────────────────────────────────────────
