-- ─────────────────────────────────────────────────────────────────────────────
-- Galeria de imagens da loja — M2: RPCs de uso, remoção e varredura.
-- Spec: specs/galeria-imagens-loja.md §"Funções e triggers",
--       §"Ordem das operações na remoção", RN-G7/G8/G9/G21, P12.
-- Testes: tests/migrations/galeria_rpc_remover.test.ts,
--         tests/migrations/galeria_rpc_uso_e_limpeza.test.ts
--
-- As três são SECURITY INVOKER chamadas pelos dois mundos (lojista e admin via
-- service_role), padrão "Quinta instância" (seguranca.md §2): filtro
-- `loja_id = p_loja_id` explícito em toda leitura e escrita, e T2 de posse
-- ANTES de qualquer escrita — 0 linhas sob RLS não é sinal de erro.
-- Via de serviço = claim `role` do JWT E role efetivo da sessão, em conjunção
-- (fail-closed, molde 20260930120000_rpc_salvar_faixas_entrega_ativo).
--
-- Ordem de travas (remoção concorrente com save de produto, casos-limite):
--   remover/limpar travam as linhas de imagens_loja com FOR UPDATE num comando
--   e só DEPOIS, em comandos seguintes (snapshot novo em READ COMMITTED),
--   conferem/recalculam o uso. O trigger BEFORE de M4 lê a linha com
--   FOR KEY SHARE, que conflita com FOR UPDATE: um dos dois espera o outro.
--
-- ADITIVA: só funções novas. ROLLBACK (manual):
--   drop function public.uso_imagens_loja(uuid, uuid[]);
--   drop function public.remover_imagens_loja(uuid, uuid[]);
--   drop function public.limpar_recortes_sem_uso(uuid);
-- ─────────────────────────────────────────────────────────────────────────────

-- ── uso_imagens_loja ─────────────────────────────────────────────────────────
-- Uma linha por original (não pendente) da loja entre p_ids: quantos produtos,
-- até 5 deles {id, nome, oculto} e se a logo usam a original OU qualquer cópia.
-- É prévia para a UI; a remoção recalcula tudo na própria transação.
create or replace function public.uso_imagens_loja(p_loja_id uuid, p_ids uuid[])
returns table (imagem_id uuid, produtos_total int, produtos jsonb, na_logo boolean)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
begin
  -- T1: forma
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 50 then
    raise exception 'uso_imagens_loja: lote inválido' using errcode = '22023';
  end if;

  -- T2: posse
  if not (
       v_e_servico
    or exists (select 1 from public.lojas l where l.id = p_loja_id and l.dono_id = auth.uid())
  ) then
    raise exception 'uso_imagens_loja: sem posse da loja' using errcode = '42501';
  end if;

  return query
  with originais as (
    select i.id, i.caminho
      from public.imagens_loja i
     where i.loja_id = p_loja_id
       and i.id = any(p_ids)
       and i.origem_id is null
       and i.remocao_pendente_em is null
  ),
  familia as (
    select o.id as original_id, o.caminho from originais o
    union all
    select c.origem_id, c.caminho
      from public.imagens_loja c
     where c.loja_id = p_loja_id
       and c.origem_id in (select o.id from originais o)
  ),
  produtos_da_loja as (
    select p.id, p.nome, p.oculto, public.caminho_storage_produtos(p.foto_url) as caminho
      from public.produtos p
     where p.loja_id = p_loja_id
       and p.foto_url is not null
  ),
  usos as (
    select distinct f.original_id, pl.id, pl.nome, pl.oculto
      from familia f
      join produtos_da_loja pl on pl.caminho = f.caminho
  ),
  logo as (
    select public.caminho_storage_produtos(l.logo_url) as caminho
      from public.lojas l
     where l.id = p_loja_id
  )
  select o.id,
         (select count(*)::int from usos u where u.original_id = o.id),
         coalesce(
           (select jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'oculto', x.oculto)
                             order by x.nome, x.id)
              from (select u.id, u.nome, u.oculto
                      from usos u
                     where u.original_id = o.id
                     order by u.nome, u.id
                     limit 5) x),
           '[]'::jsonb),
         exists (select 1 from familia f join logo lg on lg.caminho = f.caminho
                  where f.original_id = o.id)
    from originais o;
end;
$$;

revoke all on function public.uso_imagens_loja(uuid, uuid[]) from public, anon;
grant execute on function public.uso_imagens_loja(uuid, uuid[]) to authenticated, service_role;

-- ── remover_imagens_loja ────────────────────────────────────────────────────
-- Passos 1–8 do spec, nesta ordem. Devolve
--   { caminhos: text[], removidas: int, ignoradas: int,
--     produtos_limpos: int, logo_limpa: bool }
-- O Storage fica com a Server Action, depois do commit (banco antes do Storage).
create or replace function public.remover_imagens_loja(p_loja_id uuid, p_ids uuid[])
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role_sessao     text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico       boolean := coalesce(auth.role(), '') = 'service_role'
                               and v_role_sessao not in ('authenticated', 'anon');
  v_validas         uuid[];
  v_copias          uuid[];
  v_caminhos        text[];
  v_arquivos        text[];
  v_produtos_limpos int := 0;
  v_logo_limpa      int := 0;
begin
  -- 1. T1: forma (cardinality, nunca array_length)
  if p_ids is null
     or cardinality(p_ids) < 1
     or cardinality(p_ids) > 50
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) as x) then
    raise exception 'remover_imagens_loja: lote inválido' using errcode = '22023';
  end if;

  -- 2. T2: posse, antes de qualquer escrita
  if not (
       v_e_servico
    or exists (select 1 from public.lojas l where l.id = p_loja_id and l.dono_id = auth.uid())
  ) then
    raise exception 'remover_imagens_loja: sem posse da loja' using errcode = '42501';
  end if;

  -- 3. Trava e filtro: só originais não pendentes da loja seguem (D8).
  select coalesce(array_agg(t.id), '{}')
    into v_validas
    from (select i.id
            from public.imagens_loja i
           where i.loja_id = p_loja_id
             and i.id = any(p_ids)
             and i.origem_id is null
             and i.remocao_pendente_em is null
           order by i.id
             for update) t;

  if cardinality(v_validas) = 0 then
    return jsonb_build_object(
      'caminhos', '[]'::jsonb,
      'removidas', 0,
      'ignoradas', cardinality(p_ids),
      'produtos_limpos', 0,
      'logo_limpa', false
    );
  end if;

  -- 3b. Trava as cópias das válidas.
  select coalesce(array_agg(t.id), '{}')
    into v_copias
    from (select c.id
            from public.imagens_loja c
           where c.loja_id = p_loja_id
             and c.origem_id = any(v_validas)
           order by c.id
             for update) t;

  -- 4. Uso recalculado agora, com as linhas travadas: originais + cópias.
  select coalesce(array_agg(i.caminho), '{}')
    into v_caminhos
    from public.imagens_loja i
   where i.loja_id = p_loja_id
     and (i.id = any(v_validas) or i.id = any(v_copias));

  -- 5. Produtos em qualquer estado (oculto, indisponível, fora da vitrine).
  update public.produtos p
     set foto_url = null
   where p.loja_id = p_loja_id
     and public.caminho_storage_produtos(p.foto_url) = any(v_caminhos);
  get diagnostics v_produtos_limpos = row_count;

  -- 6. Logo da loja.
  update public.lojas l
     set logo_url = null
   where l.id = p_loja_id
     and public.caminho_storage_produtos(l.logo_url) = any(v_caminhos);
  get diagnostics v_logo_limpa = row_count;

  -- 7. Família pendente.
  update public.imagens_loja i
     set remocao_pendente_em = now()
   where i.loja_id = p_loja_id
     and (i.id = any(v_validas) or i.id = any(v_copias));

  -- 8. Caminhos a apagar do Storage (inclui miniaturas) e contagens.
  select coalesce(array_agg(a.caminho), '{}')
    into v_arquivos
    from public.imagens_loja i
    cross join lateral unnest(array[i.caminho, i.miniatura_caminho]) as a(caminho)
   where i.loja_id = p_loja_id
     and (i.id = any(v_validas) or i.id = any(v_copias))
     and a.caminho is not null;

  return jsonb_build_object(
    'caminhos', to_jsonb(v_arquivos),
    'removidas', cardinality(v_validas),
    'ignoradas', cardinality(p_ids) - cardinality(v_validas),
    'produtos_limpos', v_produtos_limpos,
    'logo_limpa', v_logo_limpa > 0
  );
end;
$$;

revoke all on function public.remover_imagens_loja(uuid, uuid[]) from public, anon;
grant execute on function public.remover_imagens_loja(uuid, uuid[]) to authenticated, service_role;

-- ── limpar_recortes_sem_uso ─────────────────────────────────────────────────
-- Varredura de garantia (RN-G21): marca pendentes os recortes da loja sem
-- referência e criados há mais de 24 h (P12), e devolve os caminhos de TODAS
-- as linhas pendentes da loja (com miniatura, quando houver) para a action
-- apagar. Teto de 50 caminhos; original e miniatura nunca são separadas.
create or replace function public.limpar_recortes_sem_uso(p_loja_id uuid)
returns text[]
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
  v_caminhos    text[];
begin
  -- T2: posse, antes de qualquer escrita
  if not (
       v_e_servico
    or exists (select 1 from public.lojas l where l.id = p_loja_id and l.dono_id = auth.uid())
  ) then
    raise exception 'limpar_recortes_sem_uso: sem posse da loja' using errcode = '42501';
  end if;

  -- Trava os candidatos primeiro; a conferência de uso vem no comando seguinte.
  perform 1
     from public.imagens_loja i
    where i.loja_id = p_loja_id
      and i.origem_id is not null
      and i.remocao_pendente_em is null
      and i.criado_em < now() - interval '24 hours'
    order by i.id
      for update;

  update public.imagens_loja i
     set remocao_pendente_em = now()
   where i.loja_id = p_loja_id
     and i.origem_id is not null
     and i.remocao_pendente_em is null
     and i.criado_em < now() - interval '24 hours'
     and not exists (select 1 from public.produtos p
                      where p.loja_id = p_loja_id
                        and public.caminho_storage_produtos(p.foto_url) = i.caminho)
     and not exists (select 1 from public.lojas l
                      where l.id = p_loja_id
                        and public.caminho_storage_produtos(l.logo_url) = i.caminho);

  select coalesce(array_agg(a.caminho), '{}')
    into v_caminhos
    from (select i.caminho, i.miniatura_caminho,
                 sum(case when i.miniatura_caminho is null then 1 else 2 end)
                   over (order by i.remocao_pendente_em, i.id) as acumulado
            from public.imagens_loja i
           where i.loja_id = p_loja_id
             and i.remocao_pendente_em is not null) x
    cross join lateral unnest(array[x.caminho, x.miniatura_caminho]) as a(caminho)
   where x.acumulado <= 50
     and a.caminho is not null;

  return v_caminhos;
end;
$$;

revoke all on function public.limpar_recortes_sem_uso(uuid) from public, anon;
grant execute on function public.limpar_recortes_sem_uso(uuid) to authenticated, service_role;
