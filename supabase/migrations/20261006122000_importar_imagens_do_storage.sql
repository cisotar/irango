-- ─────────────────────────────────────────────────────────────────────────────
-- Galeria de imagens da loja — M3: backfill do Storage para `imagens_loja` (D3, RN-G17).
-- Spec: specs/galeria-imagens-loja.md §"Migrations e ordem de deploy",
--       §"Testar o backfill em pglite".
-- Teste: tests/migrations/galeria_backfill.test.ts
--
-- Registra como ORIGINAL todo objeto do bucket `produtos` cujo primeiro
-- segmento é o id de uma loja existente e cujo mimetype é jpeg/png/webp.
-- Idempotente (ON CONFLICT (caminho) DO NOTHING): não sobrescreve linha já
-- registrada pelo código novo (recorte com origem, miniatura etc.). Devolve o
-- número de linhas NOVAS.
--
-- plpgsql resolve `storage.objects` só na execução: a função é criada mesmo
-- onde o schema `storage` não existe (pglite). A chamada fica atrás do guard
-- `to_regclass`. O deploy roda a função de novo à mão (papel dono) entre o
-- deploy do código e M4 — ver spec, passo 3.
--
-- Fora: objetos de loja que não existe mais, prefixo que não é uuid, nome com
-- `..`, bucket `pix-qr`, miniaturas (`<loja>/galeria/mini/` e as já
-- referenciadas por alguma linha).
--
-- ADITIVA. ROLLBACK (manual): drop function public.importar_imagens_do_storage();
-- (as linhas importadas ficam; apagar só com a tabela, em M1).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.importar_imagens_do_storage()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_novas integer := 0;
begin
  insert into public.imagens_loja (loja_id, caminho, criado_em)
  select l.id, o.name, coalesce(o.created_at, now())
    from storage.objects o
    -- Compara texto com texto: nenhum cast de `name` para uuid (prefixo
    -- inválido nunca derruba a função).
    join public.lojas l
      on l.id::text = split_part(o.name, '/', 1)
   where o.bucket_id = 'produtos'
     and split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and strpos(o.name, '/') > 0
     and position('..' in o.name) = 0
     and o.metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
     and not starts_with(o.name, l.id::text || '/galeria/mini/')
     and not exists (select 1 from public.imagens_loja m where m.miniatura_caminho = o.name)
  on conflict (caminho) do nothing;

  get diagnostics v_novas = row_count;
  return v_novas;
end;
$$;

-- Só o dono roda (migration / SQL editor). Nomeia service_role: o revoke de
-- public não o alcança (default privileges do projeto, seguranca.md §2).
revoke all on function public.importar_imagens_do_storage() from public, anon, authenticated, service_role;

-- Chamada protegida: pglite (testes) não tem storage.objects.
do $$
begin
  if to_regclass('storage.objects') is not null then
    perform public.importar_imagens_do_storage();
  end if;
end $$;
