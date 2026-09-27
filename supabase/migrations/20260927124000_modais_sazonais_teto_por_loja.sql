-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 318 — teto de 50 modais sazonais por loja (CWE-770).
-- Spec: specs/modal-sazonal-mensagem-formatada.md · RN-M08.
--
-- O rate limit mora só na Server Action. O dono pode chamar
-- `rpc/salvar_modal_sazonal` ou fazer INSERT direto em `modais_sazonais` com o
-- próprio JWT, em laço, e encher a tabela de rascunhos (a vitrine está
-- protegida pelo índice único parcial de `ativo`, o painel não). Um trigger
-- `before insert` cobre os dois caminhos de uma vez. UPDATE não é afetado.
--
-- Espelho TS: `TETO_MODAIS_POR_LOJA` (src/lib/validacoes/modalSazonal.ts), que
-- também limita a listagem do painel.
--
-- SECURITY DEFINER, com `search_path = ''` e nomes qualificados: a contagem não
-- pode depender da RLS de quem insere. Hoje o único que passa no WITH CHECK de
-- INSERT é o dono, que enxerga todas as linhas da própria loja — mas se uma
-- policy futura deixar alguém inserir sem ler tudo (ex.: papel de suporte), um
-- `count(*)` invoker contaria menos e o teto vazaria. A função só lê a
-- contagem da própria `new.loja_id` e não devolve nada ao chamador além do
-- `raise` (mensagem sem id nem número). Função de trigger não é chamável pelo
-- PostgREST; o revoke abaixo é higiene.
--
-- ADITIVA E REVERSÍVEL: só cria uma função e um trigger.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.modais_sazonais_teto_por_loja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serializa os INSERTs da MESMA loja até o fim da transação: sem isso, dois
  -- INSERTs concorrentes com 49 linhas contariam 49 cada e gravariam o 51º
  -- (o `count` não enxerga a linha não commitada do outro). O pglite tem uma
  -- conexão só e não prova isto — fica para revisão. Chave de dois inteiros
  -- (namespace, loja) para não colidir com outro advisory lock do projeto.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('modais_sazonais_teto'),
    pg_catalog.hashtext(new.loja_id::text)
  );

  if (
    select count(*) from public.modais_sazonais where loja_id = new.loja_id
  ) >= 50 then
    raise exception 'modal_sazonal: teto de modais';
  end if;

  return new;
end;
$$;

revoke all on function public.modais_sazonais_teto_por_loja() from public, anon, authenticated;

create trigger modais_sazonais_teto_por_loja
  before insert on public.modais_sazonais
  for each row execute function public.modais_sazonais_teto_por_loja();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático). Não perde dado.
--
--   drop trigger if exists modais_sazonais_teto_por_loja on public.modais_sazonais;
--   drop function if exists public.modais_sazonais_teto_por_loja();
-- ─────────────────────────────────────────────────────────────────────────────
