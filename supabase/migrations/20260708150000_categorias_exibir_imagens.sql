-- ─────────────────────────────────────────────────────────────────────────────
-- categorias.exibir_imagens — toggle por categoria de exibir/ocultar imagens na vitrine
--
-- Adiciona a flag que decide, POR CATEGORIA, se a vitrine pública renderiza os
-- produtos daquela categoria em grid de cards com imagem (`true`) ou como lista
-- textual estilo cardápio, sem imagem (`false`). Preferência do lojista, editável.
-- Spec: specs/toggle-imagens-por-categoria.md.
--
-- DEFAULT true = RETROCOMPATÍVEL (RN-2): hoje toda categoria mostra imagens. Toda
-- categoria existente pós-migration continua "exibir" — nenhuma vitrine muda de
-- comportamento até o lojista desligar explicitamente. Categoria nova nasce "exibir"
-- (o controle já aparece disponível e no estado esperado). Diferente das flags de
-- billing (fail-CLOSED, default false): esta é preferência OPERACIONAL do lojista,
-- não entitlement pago — por isso NÃO entra em CAMPOS_LOJA_SOMENTE_SERVIDOR nem em
-- trigger de proteção de billing.
--
-- SEGURO SEM EXPAND/BACKFILL/CONTRACT (aditivo puro):
--   `ADD COLUMN ... DEFAULT` com default CONSTANTE (`true`) em Postgres >= 11 NÃO
--   reescreve a tabela: o default é gravado no catálogo e materializado na próxima
--   escrita de cada linha; o NOT NULL é satisfeito para toda linha existente sem
--   table rewrite nem backfill. Mesma classe de `produtos.disponivel`/`oculto`.
--
-- Naming: snake_case, `boolean NOT NULL DEFAULT` — padrão de `produtos.disponivel`.
--
-- RLS: NENHUMA política nova. A coluna cai sob as políticas existentes de
--   `categorias` (leitura pública via `loja_esta_ativa`; UPDATE do dono via
--   `categorias_escrita_propria`; escrita admin via service_role escopada por loja).
--
-- Rollback: bloco comentado no fim. Aditivo e reversível.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.categorias
  add column if not exists exibir_imagens boolean not null default true;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   alter table public.categorias drop column if exists exibir_imagens;
-- ─────────────────────────────────────────────────────────────────────────────
