-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 312 — Migration 1 do modal sazonal com mensagem formatada: coluna
-- `modais_sazonais.mensagem jsonb` + 4 CHECKs (2 da mensagem, 2 do título).
-- Spec: specs/modal-sazonal-mensagem-formatada.md (§Modelos de Dados) ·
--       RN-M08 (teto de bytes e forma de topo da mensagem), RN-M09 (título).
--
-- ADITIVA E REVERSÍVEL. Nenhuma tabela nova, nenhuma policy nova, nenhum GRANT
-- novo: a coluna pertence à linha e as três policies de `modais_sazonais`
-- (20260925140000) já cobrem leitura e escrita dela — rascunho segue sem vazar
-- para `anon`, mensagem incluída (RN-03). O grant de tabela cobre a coluna.
--
-- `mensagem` nasce NULL em todas as linhas (NULL = sem mensagem). A validação
-- SEMÂNTICA completa da mensagem (enums, URL, estrutura plana, `.strict()`) é do
-- zod (`src/lib/validacoes/mensagemModal.ts`), na escrita E na leitura. Os CHECKs
-- aqui são o backstop para quem escreve direto no PostgREST com a própria sessão.
--
-- Os CHECKs de TÍTULO validam as linhas JÁ existentes. Se alguma violar, o
-- `db push` aborta inteiro (transacional) — fail-closed. Rodar ANTES do push, no
-- SQL editor do cloud (leitura apenas):
--
--   select id, loja_id, char_length(titulo) as tam
--   from public.modais_sazonais
--   where char_length(titulo) not between 1 and 120
--      or titulo ~ '[\u0001-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]';
--
-- Zero linhas = push seguro. Qualquer linha = corrigir o título antes, com
-- autorização do usuário.
--
-- REGEX DO TÍTULO: escrito SÓ com escapes ARE do Postgres (`\uXXXX`), nunca com
-- caractere invisível literal neste arquivo (Trojan Source, CVE-2021-42574: um
-- invisível literal no próprio SQL seria ilegível na revisão). Com
-- `standard_conforming_strings = on` (default) o `\u` chega intacto ao motor de
-- regex, que o interpreta como code point. Mesmo conjunto dos passos 2 e 3 de
-- `normalizarObservacao` (src/lib/utils/normalizarObservacao.ts), com U+0009 e
-- U+000A incluídos: o zod troca tab/quebra por espaço antes de gravar, então um
-- controle cru no título só chega aqui por escrita direta.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.modais_sazonais
  add column mensagem jsonb null;   -- NULL = sem mensagem

comment on column public.modais_sazonais.mensagem is
  'Mensagem estruturada do modal (contrato versao 1, spec modal-sazonal-mensagem-formatada). NULL = sem mensagem. Validacao semantica e do zod (lerMensagemModal) na escrita e na leitura; os CHECKs so limitam bytes e forma de topo.';

-- RN-M08: teto de BYTES (CWE-770). Folga ~1,5–2x sobre o maior documento
-- legítimo (800 caracteres, 120 trechos com todos os atributos, 20 parágrafos
-- com tipo/alinhamento e 10 links de até 1000 caracteres ≈ 32–40 KB em
-- jsonb::text).
alter table public.modais_sazonais
  add constraint modais_sazonais_mensagem_tamanho
  check (mensagem is null or octet_length(mensagem::text) <= 65536);

-- RN-M08: forma de TOPO (versão + lista de parágrafos com teto).
alter table public.modais_sazonais
  add constraint modais_sazonais_mensagem_forma
  check (
    mensagem is null or (
      jsonb_typeof(mensagem) = 'object'
      and mensagem -> 'versao' = '1'::jsonb
      and jsonb_typeof(mensagem -> 'paragrafos') = 'array'
      and jsonb_array_length(mensagem -> 'paragrafos') between 1 and 20
    )
  );

-- RN-M09: endurecimento do TÍTULO (antes só o zod limitava a 120).
alter table public.modais_sazonais
  add constraint modais_sazonais_titulo_tamanho
  check (char_length(titulo) between 1 and 120);

alter table public.modais_sazonais
  add constraint modais_sazonais_titulo_sem_invisiveis
  check (titulo !~ '[\u0001-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]');

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Ordem REVERSA do deploy: primeiro a RPC de 20260927121000 (e, ANTES dela, a
-- Server Action precisa voltar ao caminho antigo, senão criar/editar quebra com
-- PGRST202), depois esta:
--
--   alter table public.modais_sazonais drop constraint if exists modais_sazonais_titulo_sem_invisiveis;
--   alter table public.modais_sazonais drop constraint if exists modais_sazonais_titulo_tamanho;
--   alter table public.modais_sazonais drop constraint if exists modais_sazonais_mensagem_forma;
--   alter table public.modais_sazonais drop constraint if exists modais_sazonais_mensagem_tamanho;
--   alter table public.modais_sazonais drop column if exists mensagem;
--
-- O `drop column` PERDE as mensagens gravadas. Janela segura: total enquanto
-- nenhum lojista tiver gravado mensagem no cloud; depois, dump antes.
-- ─────────────────────────────────────────────────────────────────────────────
