-- ─────────────────────────────────────────────────────────────────────────────
-- [001] lojas.latitude / lojas.longitude — coordenadas geográficas da loja
--
-- Adiciona `latitude`/`longitude` (float8, nullable) à tabela lojas, para que o
-- geocoding do endereço da loja (issue 008, salvarPerfil) tenha onde persistir.
--
-- float8 por design: coordenada NÃO é dinheiro; numeric(10,2) não se aplica
-- (spec §Modelos de Dados). Nullable por design: "loja sem coords" → zonas
-- raio_km ignoradas silenciosamente (RN-3).
--
-- 3 CHECKs de defesa-em-profundidade (a autoridade real de escrita é a Server
-- Action salvarPerfil; o CHECK é a rede final do banco):
--   - lojas_coords_par_check      → par tudo-ou-nada (lat e lng juntos ou ambos NULL)
--   - lojas_latitude_range_check  → -90..90 quando preenchida
--   - lojas_longitude_range_check → -180..180 quando preenchida
--
-- Envolto em bloco DO idempotente porque `add constraint` não é idempotente
-- nativamente. Aditivo, sem backfill (colunas nullable) — expand puro.
--
-- NÃO toca em RLS (coords herdam a RLS de linha de lojas) nem na view
-- vitrine_lojas (a view NÃO expõe coords — decisão do spec §Modelos de Dados).
--
-- Rollback: ver bloco comentado no fim do arquivo.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lojas
  add column if not exists latitude  float8,
  add column if not exists longitude float8;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lojas_coords_par_check'
  ) then
    alter table public.lojas
      add constraint lojas_coords_par_check
      check ((latitude is null) = (longitude is null));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'lojas_latitude_range_check'
  ) then
    alter table public.lojas
      add constraint lojas_latitude_range_check
      check (latitude is null or latitude between -90 and 90);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'lojas_longitude_range_check'
  ) then
    alter table public.lojas
      add constraint lojas_longitude_range_check
      check (longitude is null or longitude between -180 and 180);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   alter table public.lojas drop constraint if exists lojas_longitude_range_check;
--   alter table public.lojas drop constraint if exists lojas_latitude_range_check;
--   alter table public.lojas drop constraint if exists lojas_coords_par_check;
--   alter table public.lojas drop column if exists longitude;
--   alter table public.lojas drop column if exists latitude;
-- ─────────────────────────────────────────────────────────────────────────────
