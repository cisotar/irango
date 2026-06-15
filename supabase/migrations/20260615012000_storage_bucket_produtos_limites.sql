-- ─────────────────────────────────────────────────────────────────────────────
-- [073] Bucket `produtos`: file_size_limit + allowed_mime_types
-- Defesa-em-profundidade do upload de foto de produto: o Storage rejeita arquivo
-- > 2 MB ou de Content-Type declarado fora de jpeg/png/webp.
-- Rede de segurança final — NÃO é a defesa primária. `allowed_mime_types` checa
-- só o Content-Type DECLARADO (spoofável); a validação autoritativa de imagem
-- real (magic bytes) vive na Server Action (issue 075).
--
-- GUARD pglite: `storage.buckets` não existe no harness de testes (pglite).
-- Esta migration detecta a ausência do schema e pula silenciosamente.
-- Em prod/local Supabase o schema `storage` existe e o bloco executa.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- pglite não tem `storage` — pular toda a migration de storage silenciosamente.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE '[073] storage.buckets não existe — migration limites bucket produtos ignorada (pglite/test env).';
    RETURN;
  END IF;

  -- 2097152 = 2 * 1024 * 1024 = TAMANHO_MAXIMO_BYTES (src/lib/utils/validarImagem.ts).
  -- Manter os dois alinhados: se um mudar, mudar o outro.
  UPDATE storage.buckets
  SET file_size_limit   = 2097152,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
  WHERE id = 'produtos';

END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (volta o bucket a aceitar qualquer tamanho/tipo):
--   UPDATE storage.buckets
--   SET file_size_limit = NULL, allowed_mime_types = NULL
--   WHERE id = 'produtos';
-- Janela: reversível a qualquer momento — não toca em dado de objeto, só na
-- config do bucket. Reverter NÃO apaga uploads já feitos. Único efeito de
-- reverter: uploads grandes/de outro tipo voltam a passar pelo Storage.
-- ─────────────────────────────────────────────────────────────────────────────
