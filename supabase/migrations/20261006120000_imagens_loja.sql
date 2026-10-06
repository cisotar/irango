-- ─────────────────────────────────────────────────────────────────────────────
-- Galeria de imagens da loja — M1: tabela `imagens_loja` + `caminho_storage_produtos`.
-- Spec: specs/galeria-imagens-loja.md §"Modelos de Dados".
-- Testes: tests/migrations/galeria_imagens_loja_rls.test.ts
--
-- Registro de toda imagem da loja no bucket `produtos`. Original (origem_id NULL)
-- aparece na grade; cópia recortada (origem_id preenchido) fica oculta, ligada à
-- original pela FK composta (mesma loja, cascata).
--
-- ADITIVA: tabela e função novas; nada existente muda.
-- ROLLBACK (manual, antes de M2–M4 ou junto com elas):
--   drop table public.imagens_loja;
--   drop function public.caminho_storage_produtos(text);
-- ─────────────────────────────────────────────────────────────────────────────

create table public.imagens_loja (
  id                  uuid primary key default gen_random_uuid(),
  loja_id             uuid not null references public.lojas(id) on delete cascade,
  -- NULL = original (aparece na grade). Preenchido = cópia recortada (oculta).
  origem_id           uuid null,
  -- Caminho RELATIVO ao bucket `produtos` (nunca prefixado por "produtos/").
  caminho             text not null,
  -- Miniatura da original. NULL em cópias e em legadas.
  miniatura_caminho   text null,
  -- Tamanho medido no servidor, não informado pelo cliente.
  bytes               integer null check (bytes is null or bytes between 1 and 2097152),
  -- Marcada na remoção, antes de apagar do Storage (RN-G10).
  remocao_pendente_em timestamptz null,
  criado_em           timestamptz not null default now(),

  constraint imagens_loja_id_loja_unico unique (id, loja_id),
  constraint imagens_loja_caminho_unico unique (caminho),
  -- Cópia e original sempre da mesma loja; apagar a original apaga as cópias.
  constraint imagens_loja_origem_fk foreign key (origem_id, loja_id)
    references public.imagens_loja (id, loja_id) on delete cascade,
  -- Linha da loja A nunca aponta para objeto da pasta da loja B.
  constraint imagens_loja_caminho_da_loja
    check (starts_with(caminho, loja_id::text || '/') and position('..' in caminho) = 0),
  constraint imagens_loja_miniatura_da_loja
    check (miniatura_caminho is null
           or (starts_with(miniatura_caminho, loja_id::text || '/')
               and position('..' in miniatura_caminho) = 0)),
  constraint imagens_loja_recorte_sem_miniatura
    check (origem_id is null or miniatura_caminho is null)
);

-- Grade: originais visíveis, keyset por (criado_em, id).
create index imagens_loja_grade_idx on public.imagens_loja (loja_id, criado_em desc, id desc)
  where origem_id is null and remocao_pendente_em is null;
-- Família de uma original (uso, remoção, cascata).
create index imagens_loja_origem_idx on public.imagens_loja (origem_id) where origem_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.imagens_loja enable row level security;

create policy "imagens_loja_leitura_propria" on public.imagens_loja
  for select to authenticated
  using (exists (select 1 from public.lojas
                  where lojas.id = imagens_loja.loja_id
                    and lojas.dono_id = (select auth.uid())));

create policy "imagens_loja_insert_propria" on public.imagens_loja
  for insert to authenticated
  with check (exists (select 1 from public.lojas
                       where lojas.id = imagens_loja.loja_id
                         and lojas.dono_id = (select auth.uid())));

create policy "imagens_loja_update_propria" on public.imagens_loja
  for update to authenticated
  using (exists (select 1 from public.lojas
                  where lojas.id = imagens_loja.loja_id
                    and lojas.dono_id = (select auth.uid())))
  with check (exists (select 1 from public.lojas
                       where lojas.id = imagens_loja.loja_id
                         and lojas.dono_id = (select auth.uid())));

create policy "imagens_loja_delete_propria" on public.imagens_loja
  for delete to authenticated
  using (exists (select 1 from public.lojas
                  where lojas.id = imagens_loja.loja_id
                    and lojas.dono_id = (select auth.uid())));

-- ── GRANTs ───────────────────────────────────────────────────────────────────
-- Os default privileges do schema concedem SELECT a anon em tabela nova
-- (seguranca.md §19): revoke explícito. A vitrine não lê esta tabela.
-- UPDATE só na coluna de pendência (precedente: clientes).
revoke all on public.imagens_loja from public, anon, authenticated;
grant select, insert, delete on public.imagens_loja to authenticated;
grant update (remocao_pendente_em) on public.imagens_loja to authenticated;
grant all on public.imagens_loja to service_role;

-- ── caminho_storage_produtos ────────────────────────────────────────────────
-- Fonte única do casamento URL ↔ registro: extrai o caminho relativo ao bucket
-- de uma URL pública `…/storage/v1/object/public/produtos/<caminho>`. Ignora o
-- host (o banco não conhece NEXT_PUBLIC_SUPABASE_URL; o host é do zod) e
-- descarta query/fragmento. NULL para qualquer outra forma (outro bucket,
-- object/sign, esquema que não é http(s), NULL).
create or replace function public.caminho_storage_produtos(url text)
returns text
language sql
immutable
set search_path = public
as $$
  select substring(
    url from '^https?://[^/?#]+/storage/v1/object/public/produtos/([^?#]+)(?:[?#].*)?$'
  )
$$;

revoke all on function public.caminho_storage_produtos(text) from public, anon;
grant execute on function public.caminho_storage_produtos(text) to authenticated, service_role;
