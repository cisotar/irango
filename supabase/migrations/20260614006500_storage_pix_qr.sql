-- ─────────────────────────────────────────────────────────────────────────────
-- [074] Storage bucket `pix-qr` + policies RLS
-- Bucket público para leitura (vitrine exibe QR no checkout); escrita restrita
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
    RAISE NOTICE '[074] storage.objects não existe — migration storage pix-qr ignorada (pglite/test env).';
    RETURN;
  END IF;

  -- ── Bucket ──────────────────────────────────────────────────────────────────
  -- public=true: o CDN do Supabase serve os objetos sem token (vitrine pública).
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('pix-qr', 'pix-qr', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── Policy: leitura pública (anon/authenticated) ─────────────────────────
  -- Qualquer um pode ler — o QR Pix é exibido na vitrine de checkout.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'storage_pix_qr_leitura_publica'
  ) THEN
    CREATE POLICY "storage_pix_qr_leitura_publica"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'pix-qr');
  END IF;

  -- ── Policy: INSERT restrita ao dono da loja ──────────────────────────────
  -- Path esperado: `{loja_id}/qr.png` — o primeiro segmento do caminho deve
  -- corresponder ao id de uma loja cujo dono_id = auth.uid().
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'storage_pix_qr_insert_propria'
  ) THEN
    CREATE POLICY "storage_pix_qr_insert_propria"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'pix-qr'
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
      AND policyname = 'storage_pix_qr_update_propria'
  ) THEN
    CREATE POLICY "storage_pix_qr_update_propria"
      ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'pix-qr'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()
        )
      )
      WITH CHECK (
        bucket_id = 'pix-qr'
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
      AND policyname = 'storage_pix_qr_delete_propria'
  ) THEN
    CREATE POLICY "storage_pix_qr_delete_propria"
      ON storage.objects FOR DELETE
      USING (
        bucket_id = 'pix-qr'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()
        )
      );
  END IF;

END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (fase contract — nunca antes de validar):
--   DELETE FROM storage.buckets WHERE id = 'pix-qr';  -- cascateia objetos
--   DROP POLICY IF EXISTS "storage_pix_qr_leitura_publica" ON storage.objects;
--   DROP POLICY IF EXISTS "storage_pix_qr_insert_propria"  ON storage.objects;
--   DROP POLICY IF EXISTS "storage_pix_qr_update_propria"  ON storage.objects;
--   DROP POLICY IF EXISTS "storage_pix_qr_delete_propria"  ON storage.objects;
-- ─────────────────────────────────────────────────────────────────────────────
