-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 244 — Migration 3 do Spec B (D14): coluna `public.produtos.visibilidade`.
-- Spec: specs/cardapio-sazonal.md (§Modelos de Dados "produtos.visibilidade —
--       a coluna de D14", §Segurança asserção 10) · D14 · RN-05, RN-13, RN-14.
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md (onda 3,
--        db push #8 — gate humano: leitura do diff).
--
-- EXPAND PURO, SEM BACKFILL, SEM CONTRACT. Uma coluna nova em tabela COM DADO DE
-- PRODUÇÃO (todos os produtos de todas as lojas), mas:
--   • `default 'menu'` é constante e não-volátil ⇒ no Postgres >= 11 o default
--     é gravado como `attmissingval` no catálogo: NÃO há rewrite da tabela e NÃO
--     há `UPDATE` nenhum. Toda linha existente passa a LER `'menu'` sem ter sido
--     escrita — é a asserção de não-regressão que a issue exige em teste.
--   • O CHECK inline é verificado contra as linhas existentes num SCAN (sem
--     rewrite); como toda linha vale `'menu'`, passa trivialmente. A tabela é
--     pequena (catálogos de poucas lojas); o lock ACCESS EXCLUSIVE dura o scan.
--   • `'menu'` É o comportamento de hoje (RN-05: produto do menu nem entra na
--     conta da janela). Nenhum produto muda de aparência por esta migration; é o
--     motivo de `'menu'` ser o default, e não `'cardapio'`.
--
-- TEXTO + CHECK, e não boolean nem `CREATE TYPE` (`schema.md` §5, mesmo padrão
-- de `cupons.tipo`, `produtos_desconto_tipo_check` e `cardapios.modo`): o nome
-- do estado aparece no erro (`23514` diz `produtos_visibilidade_check`), a
-- leitura do SQL é a leitura do negócio, e um terceiro valor futuro ("só no
-- balcão") é `alter constraint`, não migração de semântica de true/false.
-- O nome da constraint é EXPLÍCITO (coincide com o que o Postgres geraria) porque
-- o teste da fatia 16 afirma o nome literal, não só o SQLSTATE. Renomear quebra
-- o RED de propósito.
--
-- RLS: NENHUMA policy nova, nenhuma alterada — de propósito (issue: "políticas
--   existentes, nenhuma reescrita nesta issue"). `produtos` já tem RLS por
--   `loja_id`/`dono_id` (`produtos_leitura_propria`, `produtos_escrita_propria`,
--   20260614002000). Policy filtra LINHA, não COLUNA: a coluna nasce coberta.
--   Consequências que a issue manda PROVAR em `tests/migrations/`: `anon` não
--   faz UPDATE de `visibilidade`; lojista A não muda `visibilidade` de produto
--   da loja B. Grants são de TABELA: nada é reemitido.
--
-- LEITURA PÚBLICA — e por que `public.vitrine_produtos` NÃO é recriada aqui:
--   `produtos_leitura_publica` foi dropada pela 20260920125000; a leitura pública
--   do catálogo sai EXCLUSIVAMENTE pela view definer `vitrine_produtos`
--   (20260920124000, 14 colunas fixas, travadas por `vitrine_produtos.test.ts
--   [5a]` e espelhadas em `COLUNAS_PRODUTO_PUBLICO`/`ProdutoPublico` em
--   `src/lib/supabase/queries/produtos.ts`). Esta migration NÃO acrescenta a
--   coluna à view, por três razões:
--   (1) o spec diz que `visibilidade` é "interna do painel", ENTRADA da projeção
--       e não trafega ao cliente; a decisão de expor esse dado a `anon` é da
--       issue que redesenha o predicado público (245), não desta;
--   (2) o `WHERE` da view precisa, na 245, do disjunto `visibilidade = 'menu'
--       or exists (cardapio_produtos ⋈ cardapios ativo)` — o ajuste que o spec
--       chamava de "policy alterada" migra para a view, e recriar a view DUAS
--       vezes (aqui só a coluna, lá o WHERE) dobra o risco R1 do plano (coluna
--       a menos derruba a vitrine sem erro de CI);
--   (3) recriar a view obriga a sincronizar a lista de colunas em TS e o teste
--       [5a] na MESMA entrega, e esta issue é só SQL.
--   Hoje a view lê `from public.produtos p` — a coluna nova simplesmente não é
--   projetada; a vitrine atual continua bit a bit idêntica.
--
-- FORA DE ESCOPO (245): o trigger de constraint de RN-14
-- (`produtos_exclusivo_tem_cardapio`, `cardapio_produtos_exclusivo_tem_cardapio`)
-- e o predicado público ajustado. Esta migration entrega só a coluna, o CHECK e
-- o índice. Nenhum valor monetário é tocado.
--
-- Rollback: bloco comentado no fim do arquivo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════ 1) a coluna + o CHECK
-- Uma instrução só: metadata-only para o default, scan (sem rewrite) para o
-- CHECK. Sem `UPDATE` — ver cabeçalho.
alter table public.produtos
  add column visibilidade text not null default 'menu'
    constraint produtos_visibilidade_check
    check (visibilidade in ('menu', 'cardapio'));

comment on column public.produtos.visibilidade is
  'D14: menu | cardapio. menu (default) = produto do menu, nunca some por cardapio (RN-05: nem entra na conta da janela). cardapio = so existe por causa de um cardapio: fora da janela aparece marcado enquanto houver proxima abertura e SOME sem ela (RN-13); nunca fica sem vinculo em cardapio_produtos (RN-14, trigger da 245). Interna do painel: entrada da projecao, NAO trafega ao cliente. Convertida SO pelo lojista, nunca pelo sistema. Enum inline por CHECK (schema.md §5).';

-- ═══════════════════════════════════════════════════════════════════ 2) índice
-- Consultado sempre junto com `loja_id` (o painel conta exclusivos por loja;
-- o aviso de "cardápio expirado escondendo N produtos"). Nome explícito =
-- o que o Postgres geraria, mesmo padrão de `cardapios_loja_id_ativo_idx`.
-- Índice completo, e não parcial `where visibilidade = 'cardapio'`, por ser o
-- literal do spec; trocar por parcial é decisão do `acelerar` DEPOIS do
-- `executar`, com a query real na mão.
create index if not exists produtos_loja_id_visibilidade_idx
  on public.produtos (loja_id, visibilidade);

-- ═══════════════════ VALIDAÇÃO (conferência, não backfill — esperado: 0 e 0)
-- Duas provas, no mesmo bloco: (a) nenhuma linha ficou fora de 'menu' logo
-- após a migration (o default valeu para 100% das linhas existentes); (b) o
-- default foi gravado no catálogo como `attmissingval`, i.e. NÃO houve rewrite
-- — é o que sustenta "expand puro" como fato verificado, não como argumento.
do $$
declare
  v_fora_do_menu bigint;
  v_sem_missingval bigint;
begin
  select count(*) into v_fora_do_menu
    from public.produtos
   where visibilidade <> 'menu';
  if v_fora_do_menu > 0 then
    raise warning 'produtos.visibilidade fora de ''menu'' logo apos a migration: %', v_fora_do_menu;
  end if;

  select count(*) into v_sem_missingval
    from pg_attribute
   where attrelid = 'public.produtos'::regclass
     and attname  = 'visibilidade'
     and not attisdropped
     and not atthasmissing
     and exists (select 1 from public.produtos);   -- tabela vazia não tem o que provar
  if v_sem_missingval > 0 then
    raise warning 'produtos.visibilidade: default nao ficou como attmissingval (houve rewrite?)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: ATÉ o primeiro produto marcado `visibilidade = 'cardapio'` por
--   lojista em produção (o painel só ganha o campo na issue 261). Antes disso a
--   reversão é SEM PERDA: toda linha vale o default. Depois, `drop column`
--   apaga a declaração do lojista — irreversível.
--
-- Ordem obrigatória: reverter a 245 ANTES (o trigger `produtos_exclusivo_tem_
--   cardapio` referencia esta coluna e a recriação da view pode projetá-la) e
--   reverter o código/tipos que leem `visibilidade` ANTES — senão o painel
--   quebra em `PGRST204`.
--
--   alter table public.produtos drop column if exists visibilidade;
--   -- (o CHECK `produtos_visibilidade_check` e o índice
--   --  `produtos_loja_id_visibilidade_idx` caem junto com a coluna)
--
-- Rollback PARCIAL, se só o CHECK provar-se apertado demais (zero perda):
--   alter table public.produtos drop constraint if exists produtos_visibilidade_check;
-- ─────────────────────────────────────────────────────────────────────────────
