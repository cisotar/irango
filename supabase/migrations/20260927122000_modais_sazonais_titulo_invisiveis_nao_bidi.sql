-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 316 — CHECK do título do modal sazonal passa a recusar também os
-- invisíveis NÃO-bidi (Hangul filler, SOFT HYPHEN, tags, seletores de variação…).
-- Spec: specs/modal-sazonal-mensagem-formatada.md · RN-M09.
--
-- Recria `modais_sazonais_titulo_sem_invisiveis` com o MESMO nome e o conjunto
-- de 20260927120000 AMPLIADO com: U+00AD U+034F U+115F U+1160 U+180E U+2800
-- U+3164 U+FE00-U+FE0D U+FFA0 U+FFF9-U+FFFB U+E0000-U+E007F. É o espelho do
-- passo 3b de `removerInvisiveisEControles` (src/lib/utils/normalizarObservacao.ts):
-- o título canônico do zod nunca casa com este conjunto.
--
-- FORA do CHECK, de propósito:
--   - U+FE0E e U+FE0F: são legítimos DEPOIS de pictograma (coração texto/emoji)
--     e o regex do Postgres não avalia `\p{Extended_Pictographic}`. O zod remove
--     o U+FE0E solto; o U+FE0F segue preservado.
--   - Zalgo (marcas combinantes em excesso): o Postgres não tem `\p{Mn}`. O zod
--     limita a 3 marcas seguidas antes de medir o teto de 120.
--
-- REGEX só com escapes ARE (`\uXXXX` e `\UXXXXXXXX` para o plano 14), nunca com
-- invisível literal neste arquivo (Trojan Source, CVE-2021-42574).
--
-- O CHECK valida as linhas JÁ existentes. Se alguma violar, ESTA migration falha
-- e é revertida — mas as anteriores do mesmo push podem já ter sido aplicadas
-- (a transação é por arquivo). Rodar ANTES do push, no SQL editor do cloud
-- (leitura apenas), e só dar push com zero linhas:
--
--   select id, loja_id, char_length(titulo) as tam
--   from public.modais_sazonais
--   where titulo ~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0D\uFEFF\uFFA0\uFFF9-\uFFFB\U000E0000-\U000E007F]';
--
-- Zero linhas = push seguro. Qualquer linha = corrigir o título antes, com
-- autorização do usuário.
--
-- ADITIVA E REVERSÍVEL: só troca um CHECK por um mais estrito, na mesma
-- transação (drop + add), sem janela sem CHECK.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.modais_sazonais
  drop constraint modais_sazonais_titulo_sem_invisiveis;

alter table public.modais_sazonais
  add constraint modais_sazonais_titulo_sem_invisiveis
  check (titulo !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0D\uFEFF\uFFA0\uFFF9-\uFFFB\U000E0000-\U000E007F]');

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático): volta ao conjunto de
-- 20260927120000. Não perde dado.
--
--   alter table public.modais_sazonais drop constraint if exists modais_sazonais_titulo_sem_invisiveis;
--   alter table public.modais_sazonais
--     add constraint modais_sazonais_titulo_sem_invisiveis
--     check (titulo !~ '[\u0001-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]');
-- ─────────────────────────────────────────────────────────────────────────────
