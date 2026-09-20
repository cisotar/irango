-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 219 — colunas de desconto por produto + os cinco CHECKs.
-- Spec: specs/desconto-por-produto-e-pratos-promocionais.md §Modelos de Dados
--       (migration 1) · D1, D10 · RN-01, RN-03, RN-04, RN-05, RN-06, RN-07.
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md, onda 1.
--
-- O QUE É: mudança puramente ADITIVA em `public.produtos`. Cinco colunas novas,
-- todas opcionais salvo `desconto_ativo`, que nasce `false` com DEFAULT — no
-- Postgres >= 11 o default não-volátil é metadata-only, sem rewrite da tabela.
-- Nenhuma coluna existente muda de tipo, de nulidade ou de semântica; nenhum
-- leitor atual quebra; não há dual-shape, logo não há expand→backfill→contract.
--
-- BACKFILL: nenhum. Toda linha existente fica `desconto_ativo = false` com os
-- quatro campos NULL, configuração que satisfaz os cinco CHECKs trivialmente —
-- por isso as constraints entram VALIDADAS (sem `not valid`), como a §Nota de
-- migration da spec autoriza. O bloco de VALIDAÇÃO no fim confere isso.
--
-- RLS: NENHUMA policy nova, e nenhuma alterada — de propósito.
--   `produtos` já tem RLS habilitada, com `produtos_leitura_publica`,
--   `produtos_leitura_propria` e `produtos_acesso_proprio` (20260614002000 e
--   20260621099000). Política de RLS filtra LINHA, não COLUNA: as colunas novas
--   nascem cobertas pelo mesmo escopo por `loja_id`/`dono_id`. Grants também são
--   de TABELA, não de coluna — nada é reemitido. Consequência prática, que a
--   issue exige PROVAR (não presumir) em `tests/migrations/`: lojista A não lê
--   nem escreve desconto em produto da loja B, porque a linha inteira já lhe é
--   invisível.
--
-- SEGURANÇA (valor monetário): estes CHECKs são DEFESA EM PROFUNDIDADE, não a
--   barreira principal. A barreira legível é zod + Server Action (issue 230). O
--   `23514` que eles produzem NUNCA vira texto na UI: mensagem genérica ao
--   cliente, detalhe no log do servidor (`seguranca.md` §14).
--
-- Nenhum índice aqui. O índice parcial `(loja_id) where desconto_ativo` é
-- decisão do `acelerar` DEPOIS do `executar` (spec §Modelos de Dados) e está
-- explicitamente fora do escopo desta issue.
--
-- Rollback: bloco comentado no fim do arquivo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── (1) as cinco colunas ─────────────────────────────────────────────────────
alter table public.produtos
  add column if not exists desconto_ativo  boolean not null default false,
  add column if not exists desconto_tipo   text,
  add column if not exists desconto_valor  numeric(10,2),
  add column if not exists desconto_inicio timestamptz,
  add column if not exists desconto_fim    timestamptz;

comment on column public.produtos.desconto_ativo is
  'true = ha desconto configurado e LIGADO. Vigencia (RN-03) ainda exige a janela: ativo AND (inicio is null or inicio <= agora) AND (fim is null or agora < fim). Desligar NAO apaga tipo/valor/prazo (RN-07).';
comment on column public.produtos.desconto_tipo is
  'percentual | fixo. Enum inline por CHECK, convencao do projeto (schema.md §5) — mesmo padrao de cupons.tipo. NULL quando nunca houve desconto configurado.';
comment on column public.produtos.desconto_valor is
  'Percentual em (0,100] quando tipo = percentual; valor em R$ <= preco quando tipo = fixo (RN-04, RN-05/D10). numeric(10,2), NUNCA float.';
comment on column public.produtos.desconto_inicio is
  'Instante absoluto de inicio, INCLUSIVO. timestamptz: comparacao instante<->instante, sem aritmetica de fuso (RN-03). O fuso da loja entra so na escrita e na exibicao.';
comment on column public.produtos.desconto_fim is
  'Instante absoluto de fim, EXCLUSIVO (agora < fim), mesma convencao de lojaAberta e de validarUsoCupom (RN-03). Nao existe coluna "expirada" nem job: a vigencia e avaliada por request.';

-- ── (2) os cinco CHECKs ──────────────────────────────────────────────────────
-- Idempotentes por `pg_constraint` (ADD CONSTRAINT não aceita IF NOT EXISTS).
do $$ begin

  -- (2.1) enum inline do tipo — NULL ou um dos dois valores.
  if not exists (
    select 1 from pg_constraint
     where conname = 'produtos_desconto_tipo_check'
       and conrelid = 'public.produtos'::regclass
  ) then
    alter table public.produtos
      add constraint produtos_desconto_tipo_check
      check (desconto_tipo is null or desconto_tipo in ('percentual', 'fixo'));
  end if;

  -- (2.2) coerência — ligado exige tipo E valor. A exigência é condicionada a
  -- `desconto_ativo` justamente para que DESLIGAR preserve a configuração
  -- (RN-07): desligado, os quatro campos podem ser qualquer coisa válida,
  -- inclusive NULL.
  if not exists (
    select 1 from pg_constraint
     where conname = 'produtos_desconto_coerente_check'
       and conrelid = 'public.produtos'::regclass
  ) then
    alter table public.produtos
      add constraint produtos_desconto_coerente_check
      check (
        desconto_ativo = false
        or (desconto_tipo is not null and desconto_valor is not null)
      );
  end if;

  -- (2.3) percentual em (0, 100] — RN-04. `is distinct from` e não `<>` porque
  -- `desconto_tipo <> 'percentual'` seria NULL (logo o CHECK passaria por
  -- vacuidade) quando o tipo é NULL; aqui a intenção é a mesma, mas explícita.
  if not exists (
    select 1 from pg_constraint
     where conname = 'produtos_desconto_percentual_check'
       and conrelid = 'public.produtos'::regclass
  ) then
    alter table public.produtos
      add constraint produtos_desconto_percentual_check
      check (
        desconto_tipo is distinct from 'percentual'
        or (desconto_valor > 0 and desconto_valor <= 100)
      );
  end if;

  -- (2.4) fixo nunca maior que o preço — RN-05 e RN-06/D10. Cross-column, legal
  -- no Postgres porque só envolve colunas da MESMA linha. É este CHECK que faz
  -- o caminho PostgREST direto recusar baixar `preco` abaixo de um desconto fixo
  -- já configurado; o sistema NÃO ajusta dinheiro sozinho.
  if not exists (
    select 1 from pg_constraint
     where conname = 'produtos_desconto_fixo_check'
       and conrelid = 'public.produtos'::regclass
  ) then
    alter table public.produtos
      add constraint produtos_desconto_fixo_check
      check (desconto_tipo is distinct from 'fixo' or desconto_valor <= preco);
  end if;

  -- (2.5) prazo coerente quando os DOIS lados existem — RN-03. Prazo aberto dos
  -- dois lados, ou só de um, continua válido.
  if not exists (
    select 1 from pg_constraint
     where conname = 'produtos_desconto_prazo_check'
       and conrelid = 'public.produtos'::regclass
  ) then
    alter table public.produtos
      add constraint produtos_desconto_prazo_check
      check (
        desconto_inicio is null
        or desconto_fim is null
        or desconto_fim > desconto_inicio
      );
  end if;

end $$;

-- Sem CHECK próprio de positividade em `desconto_valor`: os dois CHECKs por tipo
-- já o cobrem (`> 0` no percentual; `<= preco` no fixo, combinado com o `> 0` do
-- zod da issue 230). Um `desconto_valor > 0` solto seria redundante e passaria a
-- recusar linha desligada com valor 0 legado — que não existe hoje e não deve
-- nascer como regra nova.

-- ── VALIDAÇÃO (conferência, não backfill — esperado: 0) ──────────────────────
do $$
declare v_invalidas bigint;
begin
  select count(*) into v_invalidas
    from public.produtos
   where desconto_ativo
      or desconto_tipo is not null
      or desconto_valor is not null
      or desconto_inicio is not null
      or desconto_fim is not null;
  if v_invalidas > 0 then
    raise warning 'produtos com desconto ja preenchido logo apos a migration: %', v_invalidas;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: ATÉ o primeiro produto gravado com desconto configurado em
--   produção. Antes disso a reversão é SEM PERDA (toda linha é false/NULL).
--   Depois, `drop column` apaga promoção configurada pelo lojista —
--   irreversível.
--
-- Rollback PARCIAL preferido (zero perda, zero risco), se algum CHECK provar-se
-- apertado demais: dropar só a constraint em questão. As colunas ficam, o código
-- continua lendo, e a barreira de zod/Server Action segue de pé.
--   alter table public.produtos drop constraint if exists produtos_desconto_prazo_check;
--   alter table public.produtos drop constraint if exists produtos_desconto_fixo_check;
--   alter table public.produtos drop constraint if exists produtos_desconto_percentual_check;
--   alter table public.produtos drop constraint if exists produtos_desconto_coerente_check;
--   alter table public.produtos drop constraint if exists produtos_desconto_tipo_check;
--
-- Rollback TOTAL (só dentro da janela acima, e só depois de reverter o código
-- que lê as colunas — senão toda leitura do catálogo falha):
--   alter table public.produtos
--     drop column if exists desconto_fim,
--     drop column if exists desconto_inicio,
--     drop column if exists desconto_valor,
--     drop column if exists desconto_tipo,
--     drop column if exists desconto_ativo;
--   -- (os CHECKs caem junto com as colunas que referenciam)
-- ─────────────────────────────────────────────────────────────────────────────
