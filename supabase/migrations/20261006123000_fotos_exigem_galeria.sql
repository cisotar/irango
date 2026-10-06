-- ─────────────────────────────────────────────────────────────────────────────
-- Galeria de imagens da loja — M4: foto/logo só de imagem registrada (RN-G6) e
-- recorte sem uso marcado para remoção (D5, RN-G20).
-- Spec: specs/galeria-imagens-loja.md §"Funções e triggers", §"Casos-limite".
-- Teste: tests/migrations/galeria_triggers.test.ts
--
-- DEPLOY: 2º push, DEPOIS do deploy do código que registra todo upload e da
-- reimportação manual (spec, "Migrations e ordem de deploy"). A reimportação
-- abaixo roda de novo antes dos triggers, por garantia.
--
-- BEFORE (DP1, estrito): toda URL nova não nula cujo caminho não seja de linha
-- da MESMA loja sem remoção pendente é recusada com 'imagem_fora_da_galeria'
-- (P0001) — inclusive URL fora do Storage. Reenviar a MESMA URL (payload
-- inteiro de atualizarProduto) passa: produto legado continua editável.
--
-- AFTER (D5): valor antigo que é RECORTE da mesma loja, sem outra referência
-- (produto ou logo), é marcado `remocao_pendente_em`. Nunca toca original nem
-- outra loja; valor antigo legado sem registro é ignorado.
--
-- ROLLBACK (manual): drop dos 4 triggers e das 2 funções abaixo. Sem perda de
-- dado (marcas de pendência já feitas ficam; a varredura apaga do Storage).
-- ─────────────────────────────────────────────────────────────────────────────

-- Os CREATE TRIGGER pegam SHARE ROW EXCLUSIVE em produtos/lojas na mesma
-- transação da reimportação: falhar rápido em vez de enfileirar escritas.
set local lock_timeout = '5s';

-- Reimporta o que o código antigo subiu entre o 1º push e o deploy.
do $$
begin
  if to_regclass('storage.objects') is not null then
    perform public.importar_imagens_do_storage();
  end if;
end $$;

-- ── BEFORE: URL só de imagem registrada da mesma loja ───────────────────────
-- SECURITY INVOKER, de propósito: o lojista autenticado lê pela RLS só as linhas
-- da própria loja (o FOR KEY SHARE exige UPDATE em alguma coluna: ele tem
-- UPDATE(remocao_pendente_em)); service_role ignora RLS e lê tudo. Sob INVOKER,
-- um loja_id alheio em NEW nunca casa com linha visível (recusa sem revelar se o
-- caminho existe em outra loja); DEFINER tiraria essa camada sem ganho.
create or replace function public.galeria_exige_imagem_registrada()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_loja    uuid;
  v_url     text;
  v_caminho text;
begin
  if tg_table_name = 'produtos' then
    -- INSERT OR UPDATE no mesmo trigger: o WHEN não pode citar OLD, então a
    -- comparação com o valor antigo fica aqui.
    if tg_op = 'UPDATE'
       and new.foto_url is not distinct from old.foto_url
       and new.loja_id is not distinct from old.loja_id then
      return new;
    end if;
    v_loja := new.loja_id;
    v_url  := new.foto_url;
  else
    -- INSERT OR UPDATE: o WHEN não pode citar OLD.
    if tg_op = 'UPDATE' and new.logo_url is not distinct from old.logo_url then
      return new;
    end if;
    v_loja := new.id;
    v_url  := new.logo_url;
  end if;

  if v_url is null then
    return new;
  end if;

  v_caminho := public.caminho_storage_produtos(v_url);

  -- FOR KEY SHARE serializa com o FOR UPDATE da remoção: se ela venceu, a linha
  -- relida já está pendente e não casa.
  if v_caminho is not null then
    perform 1
       from public.imagens_loja i
      where i.loja_id = v_loja
        and i.caminho = v_caminho
        and i.remocao_pendente_em is null
        for key share;
  end if;

  if v_caminho is null or not found then
    raise exception 'imagem_fora_da_galeria' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.galeria_exige_imagem_registrada() from public, anon, authenticated, service_role;

drop trigger if exists produtos_foto_na_galeria_trg on public.produtos;
create trigger produtos_foto_na_galeria_trg
  before insert or update of foto_url, loja_id on public.produtos
  for each row
  when (new.foto_url is not null)
  execute function public.galeria_exige_imagem_registrada();

drop trigger if exists lojas_logo_na_galeria_trg on public.lojas;
create trigger lojas_logo_na_galeria_trg
  before insert or update of logo_url on public.lojas
  for each row
  when (new.logo_url is not null)
  execute function public.galeria_exige_imagem_registrada();

-- ── AFTER: recorte que perdeu o último uso fica pendente ────────────────────
-- SECURITY DEFINER, de propósito: "sem outra referência" precisa enxergar TODOS
-- os produtos e a logo da loja. Sob INVOKER a resposta dependeria do que a RLS
-- do chamador mostra; uma visão parcial marcaria como sem uso um recorte ainda
-- referenciado, e a action o apagaria do Storage (imagem quebrada na vitrine).
-- O alcance é o da linha que o chamador JÁ alterou legitimamente (o AFTER só
-- dispara depois da RLS de produtos/lojas): lê e escreve só `loja_id` de OLD,
-- e não é chamável fora de trigger.
create or replace function public.galeria_marca_recorte_sem_uso()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_loja    uuid;
  v_caminho text;
  v_id      uuid;
begin
  if tg_table_name = 'produtos' then
    if tg_op = 'UPDATE'
       and new.foto_url is not distinct from old.foto_url
       and new.loja_id is not distinct from old.loja_id then
      return null;
    end if;
    v_loja    := old.loja_id;
    v_caminho := public.caminho_storage_produtos(old.foto_url);
  else
    v_loja    := old.id;
    v_caminho := public.caminho_storage_produtos(old.logo_url);
  end if;

  if v_caminho is null then
    return null;
  end if;

  -- Loja em exclusão (cascata de lojas → produtos): as imagens caem junto.
  if not exists (select 1 from public.lojas l where l.id = v_loja) then
    return null;
  end if;

  -- Trava o recorte antes de conferir as referências (comando seguinte, snapshot
  -- novo). Original e legado sem registro não casam: nada a fazer.
  select i.id
    into v_id
    from public.imagens_loja i
   where i.loja_id = v_loja
     and i.caminho = v_caminho
     and i.origem_id is not null
     and i.remocao_pendente_em is null
     for update;

  if not found then
    return null;
  end if;

  -- Sem filtrar o próprio produto: num UPDATE só de host, o valor novo ainda
  -- aponta para o mesmo caminho e conta como uso.
  if exists (select 1 from public.produtos p
              where p.loja_id = v_loja
                and public.caminho_storage_produtos(p.foto_url) = v_caminho)
     or exists (select 1 from public.lojas l
                 where l.id = v_loja
                   and public.caminho_storage_produtos(l.logo_url) = v_caminho) then
    return null;
  end if;

  update public.imagens_loja i
     set remocao_pendente_em = now()
   where i.id = v_id
     and i.loja_id = v_loja;

  return null;
end;
$$;

revoke all on function public.galeria_marca_recorte_sem_uso() from public, anon, authenticated, service_role;

drop trigger if exists produtos_recorte_sem_uso_trg on public.produtos;
create trigger produtos_recorte_sem_uso_trg
  after update of foto_url, loja_id or delete on public.produtos
  for each row
  when (old.foto_url is not null)
  execute function public.galeria_marca_recorte_sem_uso();

drop trigger if exists lojas_recorte_sem_uso_trg on public.lojas;
create trigger lojas_recorte_sem_uso_trg
  after update of logo_url on public.lojas
  for each row
  when (old.logo_url is not null and old.logo_url is distinct from new.logo_url)
  execute function public.galeria_marca_recorte_sem_uso();
