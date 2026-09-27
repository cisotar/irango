-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 319 — RPC transacional `public.ativar_modal_sazonal`: desativa o modal
-- ativo anterior da loja e ativa o alvo numa ÚNICA transação.
-- Spec: specs/modal-sazonal-mensagem-formatada.md · RN-M16 (e RN-05 do spec
--       arquivado modal-divulgacao-sazonal).
--
-- Antes a Server Action fazia dois UPDATEs em requests PostgREST separados
-- (transações separadas): falha entre os dois deixava a loja SEM modal ativo. O
-- índice único parcial `modais_sazonais_um_ativo_por_loja` impede dois ativos,
-- não zero. Uma função PL/pgSQL roda numa transação só: qualquer erro depois do
-- desativar desfaz o desativar também.
--
-- Molde: `salvar_modal_sazonal` (20260927121000). SECURITY INVOKER: a policy
-- `modais_sazonais_escrita_propria` continua valendo nos dois UPDATEs. As
-- travas abaixo são a SEGUNDA camada (fail-closed se a policy afrouxar).
-- Mensagens de `raise` estáveis (P0001, prefixo `modal_sazonal:`), sem id nem
-- dado de entrada; a Server Action traduz para mensagem genérica e loga o
-- detalhe (`seguranca.md` §14).
--
-- A loja NÃO vem do payload: é derivada do próprio modal e conferida contra
-- `auth.uid()`. Modal de outra loja e modal inexistente dão a MESMA mensagem.
--
-- Corrida entre duas ativações simultâneas na mesma loja: as duas desativam e
-- as duas tentam ligar; a segunda cai no índice único parcial (23505) e a sua
-- transação inteira reverte. Nunca dois ativos, nunca zero.
--
-- ADITIVA E REVERSÍVEL: só cria uma função.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ativar_modal_sazonal(p_modal_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_loja_id uuid;
begin
  -- S1: sessão de usuário obrigatória. anon (já barrado pelo revoke) e o papel
  -- de serviço sem JWT de usuário caem aqui — fail-closed.
  if auth.uid() is null then
    raise exception 'modal_sazonal: sem sessao';
  end if;

  -- S2: posse EXPLÍCITA antes de tocar em qualquer linha: o modal existe e é de
  -- uma loja do chamador. Não depende só da RLS.
  select m.loja_id into v_loja_id
    from public.modais_sazonais m
    join public.lojas l on l.id = m.loja_id
   where m.id = p_modal_id
     and l.dono_id = auth.uid();

  if v_loja_id is null then
    raise exception 'modal_sazonal: modal inexistente';
  end if;

  -- Desliga o anterior ANTES de ligar o alvo (o índice único parcial recusaria
  -- a ordem inversa). Escopo por loja explícito além da RLS.
  update public.modais_sazonais
     set ativo = false, atualizado_em = now()
   where loja_id = v_loja_id
     and ativo
     and id <> p_modal_id;

  -- Idempotente: se o alvo já está ativo, nada a fazer (0 linhas, sem erro).
  update public.modais_sazonais
     set ativo = true, atualizado_em = now()
   where id = p_modal_id
     and loja_id = v_loja_id
     and not ativo;
end;
$$;

-- O projeto concede EXECUTE a `anon` por default privileges (20260614008500):
-- o revoke nomeia `anon` explicitamente, além de PUBLIC. Ver S7 de
-- 20260927121000.
revoke all on function public.ativar_modal_sazonal(uuid) from public, anon;
grant execute on function public.ativar_modal_sazonal(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- ANTES: a Server Action `ativarModalSazonal` precisa voltar ao caminho antigo
-- (dois UPDATEs), senão ativar quebra com PGRST202. Depois:
--
--   drop function if exists public.ativar_modal_sazonal(uuid);
--
-- Não perde dado (a função não guarda estado).
-- ─────────────────────────────────────────────────────────────────────────────
