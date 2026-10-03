-- Issue 334 (achado BAIXA do `auditar` da 332): defesa em profundidade no
-- trigger `lojas_exige_dono_lojista_trg`.
--
-- Antes: usuário final (`anon`/`authenticated`) gravando loja com `dono_id`
-- de OUTRA conta fazia `return new` e dependia só da policy de `lojas` para
-- recusar. Se uma policy futura aceitasse `dono_id` de terceiro, a regra
-- "conta só-cliente nunca é dona de loja" deixava de valer nesse caminho.
-- Agora o próprio trigger recusa (42501), sem ler nem gravar papel alheio:
-- a mensagem é a mesma qualquer que seja o papel do alvo (não vira oráculo).
-- `service_role` e o dono da própria loja seguem pelo ramo de papel, sem mudança.
--
-- Só redefine a função (create or replace): o trigger e o revoke da
-- 20261001120000_papel_cliente.sql continuam valendo. Idempotente.
--
-- Rollback (volta ao comportamento da 332; seguro, sem perda de dado):
--   reexecutar o bloco `create or replace function public.lojas_exige_dono_lojista()`
--   de 20261001120000_papel_cliente.sql (ramo de dono alheio com `return new`).

create or replace function public.lojas_exige_dono_lojista()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Usuário final pedindo loja de OUTRO dono: recusa aqui, independente da
  -- policy. Não ler nem gravar papel alheio.
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and new.dono_id is distinct from auth.uid() then
    raise exception 'loja: dono_id diferente do usuário da sessão'
      using errcode = '42501';
  end if;
  if not ('lojista' = any (public.atribuir_papel_inicial(new.dono_id, 'lojista'))) then
    raise exception 'loja: conta de cliente não pode ser dona de loja';
  end if;
  return new;
end
$$;

revoke all on function public.lojas_exige_dono_lojista() from public, anon, authenticated;
