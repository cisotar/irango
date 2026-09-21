-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 272 — Vigência por ITEM do cardápio: agenda semanal do VÍNCULO
-- produto↔cardápio.
-- Spec: specs/vigencia-por-item-do-cardapio.md (§Modelos de Dados, RN-01,
--       RN-11, RN-13).
-- Plano: plan/loop-vigencia-por-item-do-cardapio.md (§5, passo 5).
--
-- DEPENDE de 20260920129000 (issue 243), que cria `public.cardapio_produtos`
-- com RLS e GRANTs. Aplicar SEMPRE depois dela; reverter SEMPRE antes dela.
--
-- ADITIVA E REVERSÍVEL. Coluna NULLABLE, SEM DEFAULT e SEM BACKFILL: todo
-- vínculo existente fica `NULL`, que a regra lê como "todos os dias do
-- cardápio" — o comportamento de hoje, byte a byte. NADA muda no deploy, e a
-- aplicação antiga continua funcionando contra o schema novo (a coluna é
-- ignorada por quem não a seleciona). `add column` nullable sem default é
-- metadata-only no Postgres: sem reescrita de tabela e sem lock longo, mesmo
-- com a tabela já populada no cloud. O CHECK é validado contra as linhas
-- existentes num scan — todas `NULL`, portanto todas passam.
--
-- NENHUMA tabela nova ⇒ NENHUMA policy nova e NENHUM GRANT novo
-- (`seguranca.md` §2 já satisfeito):
--   · as três policies de `cardapio_produtos` (20260920129000, com a pública
--     reescrita pela 20260920133000) filtram por LINHA, não por coluna — a
--     coluna nova entra coberta, sem alteração;
--   · os GRANTs da 20260920129000 são de TABELA
--     (`grant select on public.cardapio_produtos to anon`), não de coluna:
--     column-level privilege não existe aqui, então não há grant a tocar.
-- Quem lê a coluna é o embed `cardapio_produtos(produto_id, dias_semana)` de
-- `COLUNAS_CARDAPIO_VIGENCIA` (`src/lib/supabase/queries/cardapios.ts`), sob a
-- RLS da própria `cardapio_produtos` — não pela view `public.vitrine_produtos`,
-- que só usa `cardapio_produtos` dentro de um predicado EXISTS
-- (20260920132000) e não projeta nenhuma coluna dela. A view NÃO é recriada.
--
-- FORA DE ESCOPO: qualquer índice sobre `dias_semana` (a decisão de dia é
-- função pura em TS — RN-01 desta spec e RN-06 da spec-mãe: janela nunca vira
-- SQL), horário por item, `dias_mes` por item, e toda leitura/escrita em TS
-- (issues 273/274).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════ 1) A coluna
alter table public.cardapio_produtos
  add column dias_semana smallint[];

comment on column public.cardapio_produtos.dias_semana is
  'Dias da semana em que ESTE produto aparece DENTRO deste cardapio. 0=dom..6=sab, mesma convencao de partesNoFuso e de cardapios.dias_semana. NULL = todos os dias do cardapio. NUNCA e uma segunda janela: a regra e cardapioAberto(cardapio) E (dias_semana vazio OU contem(diaIndex)) — RN-01.';

-- ══════════════════════════════════════════════════════ 2) CHECK de domínio
-- Domínio, e só isso. Array literal dentro do CHECK (nada de generate_series,
-- que não é IMMUTABLE) — precedente LITERAL: `cardapios_dias_semana_dominio`
-- em 20260920128000.
--
-- O array VAZIO passa de propósito (`<@` é verdadeiro para `{}`): vazio e NULL
-- são SEMANTICAMENTE IDÊNTICOS aqui ("sem restrição por este eixo"), diferente
-- de `cardapios_recorrente_tem_eixo`, onde vazio em todos os eixos significava
-- um cardápio que não restringe nada. A Server Action normaliza `[]` para NULL
-- (RN-11) para que haja UMA representação no banco; o CHECK não precisa proibir
-- a outra — ele é backstop de domínio, não a autoridade da normalização.
--
-- Nome LITERAL: o teste de migration afirma o nome da constraint dentro da
-- mensagem do erro, não só o SQLSTATE `23514`. Renomear quebra o RED de
-- propósito.
alter table public.cardapio_produtos
  add constraint cardapio_produtos_dias_semana_dominio
  check (
    dias_semana is null
    or dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: TOTAL. Reverter volta todo vínculo a "todos os dias do
-- cardápio", que é o comportamento de hoje. O ÚNICO dado perdido é a agenda que
-- o lojista tiver marcado DEPOIS do deploy — nenhum vínculo, produto, cardápio
-- ou pedido é afetado, e nenhuma linha existente é reescrita por esta migration.
--
-- ORDEM OBRIGATÓRIA: reverter DEPOIS de retirar do código todo select que
-- NOMEIA a coluna (o embed `cardapio_produtos(produto_id, dias_semana)` de
-- `COLUNAS_CARDAPIO_VIGENCIA`) — senão o select nomeado quebra com `42703
-- column cardapio_produtos.dias_semana does not exist`. Reverter ANTES de
-- reverter 20260920129000, que cria a tabela.
--
--   alter table public.cardapio_produtos
--     drop constraint if exists cardapio_produtos_dias_semana_dominio;
--   alter table public.cardapio_produtos
--     drop column if exists dias_semana;
--
-- `DROP COLUMN` é irreversível: só rode depois de validar 100% o shape novo, e
-- com dump da coluna antes se já houver agenda gravada em produção
-- (`select id, dias_semana from public.cardapio_produtos where dias_semana is not null`).
-- ─────────────────────────────────────────────────────────────────────────────
