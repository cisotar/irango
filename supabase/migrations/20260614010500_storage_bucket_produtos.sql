-- ─────────────────────────────────────────────────────────────────────────────
-- [003] Storage bucket `produtos` + policies RLS
-- Bucket público para leitura (vitrine exibe foto de produto); escrita restrita
-- à pasta `{loja_id}/` do lojista dono (seguranca.md §18).
--
-- GUARD pglite: `storage.objects` não existe no harness de testes (pglite).
-- Esta migration detecta a ausência do schema e pula silenciosamente.
-- Em prod/local Supabase o schema `storage` existe e o bloco executa.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- pglite não tem `storage` — pular toda a migration de storage silenciosamente.
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE '[003] storage.objects não existe — migration storage produtos ignorada (pglite/test env).';
    RETURN;
  END IF;

  -- ── Bucket ──────────────────────────────────────────────────────────────────
  -- public=true: o CDN do Supabase serve os objetos sem token (vitrine pública).
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('produtos', 'produtos', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── Policy: leitura pública (anon/authenticated) ─────────────────────────
  -- Qualquer um pode ler — a foto de produto é exibida na vitrine pública.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'produtos_leitura_publica'
  ) THEN
    CREATE POLICY "produtos_leitura_publica"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'produtos');
  END IF;

  -- ── Policy: INSERT restrita ao dono da loja ──────────────────────────────
  -- Path esperado: `{loja_id}/{produto_id}` — o primeiro segmento do caminho deve
  -- corresponder ao id de uma loja cujo dono_id = auth.uid().
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'produtos_insert_propria'
  ) THEN
    CREATE POLICY "produtos_insert_propria"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'produtos'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()
        )
      );
  END IF;

  -- ── Policy: UPDATE restrita ao dono da loja ──────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'produtos_update_propria'
  ) THEN
    CREATE POLICY "produtos_update_propria"
      ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'produtos'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()
        )
      )
      WITH CHECK (
        bucket_id = 'produtos'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()
        )
      );
  END IF;

  -- ── Policy: DELETE restrita ao dono da loja ──────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'produtos_delete_propria'
  ) THEN
    CREATE POLICY "produtos_delete_propria"
      ON storage.objects FOR DELETE
      USING (
        bucket_id = 'produtos'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()
        )
      );
  END IF;

END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (fase contract — nunca antes de validar):
--   DELETE FROM storage.buckets WHERE id = 'produtos';  -- cascateia objetos
--   DROP POLICY IF EXISTS "produtos_leitura_publica" ON storage.objects;
--   DROP POLICY IF EXISTS "produtos_insert_propria"  ON storage.objects;
--   DROP POLICY IF EXISTS "produtos_update_propria"  ON storage.objects;
--   DROP POLICY IF EXISTS "produtos_delete_propria"  ON storage.objects;
-- ─────────────────────────────────────────────────────────────────────────────
