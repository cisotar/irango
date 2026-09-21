-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 245 — Migration 4 do Spec B, parte 2/2 (D14): `public.vitrine_produtos`
-- recriada com o predicado público que conhece `visibilidade` + a coluna como
-- 15ª da projeção.
-- Spec: specs/cardapio-sazonal.md (D14 · RN-05, RN-06, RN-13).
-- Issue/plano: tasks/245-trigger-do-produto-exclusivo-e-policy-publica-ajustada.md
--              (D1, D2, D3, D7; §Predicado novo da view — por extenso).
-- Par: 20260920131000_produtos_exclusivo_trigger.sql (ESCRITA). Esta é a de
--      LEITURA de todas as lojas — risco R1 do plano: coluna a menos derruba a
--      vitrine inteira SEM erro de CI. Conferir o diff coluna a coluna contra a
--      20260920124000 antes do push.
--
-- O BURACO QUE FECHA: a view da 124000 não conhece `visibilidade`. O prato de
-- um "Cardápio de Natal" montado em setembro (cardápio `ativo = false`) era
-- legível por `anon` em `/rest/v1/vitrine_produtos` com a anon key do bundle,
-- mesmo que o SSR o omitisse. Quem filtra é o banco, e é o banco que o
-- atacante consulta.
--
-- DIFF CONTRA A 20260920124000 (só isto, nada mais):
--   (1) `with (security_invoker = false, security_barrier = true)` — AS DUAS,
--       explícitas. `create or replace view` executa AT_ReplaceRelOptions:
--       SUBSTITUI o conjunto inteiro de reloptions pelo que a instrução
--       declara. Omitir `security_barrier = true` desfaz a 124500 EM SILÊNCIO
--       (sem erro), reabrindo o vazamento por erro de cast. Testes [o] (catálogo)
--       e [7a]/[7c] (comportamental) travam.
--   (2) 15ª coluna `p.visibilidade`, NO FIM. `or replace` só aceita coluna nova
--       no fim e recusa (42P16) qualquer mudança de nome/tipo nas 14 existentes
--       — é o gate mecânico de não-regressão do contrato (D1). As 14 primeiras
--       são bit a bit as da 124000, na mesma ordem.
--   (3) terceiro termo do WHERE, em AND:
--         and (p.visibilidade = 'menu' or exists (... c.ativo = true))
--       `oculto = false` e `loja_esta_ativa` NÃO foram enfraquecidos; o
--       disjunto só RESTRINGE. Com 100% dos produtos em 'menu' (produção hoje)
--       o conjunto devolvido é IDÊNTICO ao de hoje — teste [h] afirma por
--       conjunto de ids, não por "não deu erro".
--
-- `visibilidade = 'menu'` É O PRIMEIRO BRAÇO DO OR (D3): o executor avalia OR
-- da esquerda para a direita e para no primeiro true (ExecEvalBoolExpr); com
-- 176/176 produtos 'menu' em produção o EXISTS correlacionado roda ZERO vezes.
-- EXISTS correlacionado por (produto_id, loja_id), e não `id in (subselect)`:
-- o IN viraria hashed SubPlan sobre os vínculos de TODAS as lojas, pago mesmo
-- quando ninguém tem cardápio.
--
-- `c.ativo = true` É EXPLÍCITO: a view é DEFINER e NÃO passa por
-- `cardapios_leitura_publica` (que já filtra ativo). Sem o termo, o rascunho
-- (cardápio inativo) voltaria a vazar — o buraco que esta migration fecha.
--
-- NENHUMA cláusula de JANELA DE VIGÊNCIA aqui (RN-06): a view filtra "tem
-- algum cardápio LIGADO", nunca "está aberto agora". Avaliar a janela (relógio
-- + fuso da loja, dias_semana/hora_*/prazo_*) é da função pura em TS
-- (`projetarCatalogoVitrine`, 247). Produto 'cardapio' de cardápio ATIVO com
-- prazo VENCIDO fica DENTRO da view — teste [j] reprova se a janela entrar no
-- SQL. Órfão pré-existente (dado anterior ao trigger, DISABLE TRIGGER) fica
-- FORA: EXISTS falso → a view falha FECHADA (teste [m]).
--
-- 15ª COLUNA EXPOSTA A anon (D2, decisão do usuário): para um produto JÁ
-- visível, anon passa a saber se é "do menu" ou "de cardápio". Não é
-- estratégia comercial — o rascunho continua invisível pelo predicado. A frase
-- "NAO trafega ao cliente" do comment da 130000 segue verdadeira para o
-- BROWSER (`projetarProdutoVitrine` copia campos nomeados), mas não para a API
-- REST; o `escriba` ajusta schema.md/seguranca.md §19.
--
-- DEPENDÊNCIA NOVA: a view passa a depender de `cardapio_produtos` e
-- `cardapios`. Rollback da 128000/129000 exige derrubar/recriar esta view
-- antes (ordem registrada abaixo).
--
-- GRANTS: `create or replace` preserva os grants existentes, mas o `revoke
-- all` + `grant select` é reemitido NESTE arquivo — regra de seguranca.md §19
-- ("toda view definer pública") e exigência da guarda estática [G4] de
-- vitrine_lojas_select_only.test.ts (todo create/or replace de view pública
-- tem revoke no mesmo arquivo).
--
-- COMPATÍVEL COM O CÓDIGO EM PRODUÇÃO: as 14 colunas nomeadas por
-- `COLUNAS_PRODUTO_PUBLICO` continuam existindo; todo produto é 'menu'. Pode
-- (e DEVE) ir ao cloud ANTES do merge do código que lê a 15ª coluna — a ordem
-- inversa dá 42703 em toda vitrine.
--
-- ROLLBACK: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.vitrine_produtos
  with (security_invoker = false, security_barrier = true)
as
  select
    p.id,
    p.loja_id,
    p.categoria_id,
    p.nome,
    p.descricao,
    p.preco,
    p.disponivel,
    p.ordem,
    p.foto_url,
    public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
      as desconto_ativo,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_tipo   end as desconto_tipo,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_valor  end as desconto_valor,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_inicio end as desconto_inicio,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_fim    end as desconto_fim,
    p.visibilidade                                             -- 15ª, NO FIM (D1)
  from public.produtos p
  where p.oculto = false                                       -- literal 124000
    and public.loja_esta_ativa(p.loja_id)                      -- literal 124000
    and (
      p.visibilidade = 'menu'                                  -- 1º braço: curto-circuito (D3)
      or exists (
        select 1
          from public.cardapio_produtos cp
          join public.cardapios c
            on c.id = cp.cardapio_id
           and c.loja_id = cp.loja_id                          -- redundante com a FK composta; documenta a intenção
         where cp.produto_id = p.id
           and cp.loja_id    = p.loja_id
           and c.ativo = true                                  -- EXPLÍCITO: definer não passa pela policy de cardapios
      )
    );

comment on view public.vitrine_produtos is
  'Projecao PUBLICA do catalogo (seguranca.md §19, view definer). WHERE = oculto = false AND loja_esta_ativa AND (visibilidade = menu OR existe vinculo em cardapio ATIVO) — issue 245/D14. NAO avalia janela de vigencia (RN-06: funcao pura em TS); rascunho (so cardapio inativo) e orfao ficam FORA. desconto_ativo significa "VIGENTE NESTE INSTANTE" (D5/265); desconto_tipo/valor/inicio/fim so saem quando vigente, senao NULL. NAO calcula preco: precoEfetivo() em TS e a unica fonte. 15 colunas, ordem fixa (COLUNAS_PRODUTO_PUBLICO). service_role e o painel leem a TABELA.';

-- SELECT-only para os roles da API (§19; guarda estática [G4]).
revoke all on public.vitrine_produtos from anon, authenticated;
grant select on public.vitrine_produtos to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: ATÉ o deploy do código que lê a 15ª coluna (`visibilidade`
--   em COLUNAS_PRODUTO_PUBLICO). Depois, reverter primeiro o código (senão
--   42703 em toda vitrine), só então o banco.
-- `create or replace view` com o texto da 124000 NÃO funciona para REMOVER
--   coluna (42P16): o rollback é drop + create com o texto literal da 124000
--   + as reloptions da 124500 + revoke/grant:
--
--   drop view if exists public.vitrine_produtos;
--   create view public.vitrine_produtos
--     with (security_invoker = false, security_barrier = true)
--   as
--     select p.id, p.loja_id, p.categoria_id, p.nome, p.descricao, p.preco,
--            p.disponivel, p.ordem, p.foto_url,
--            public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) as desconto_ativo,
--            case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) then p.desconto_tipo   end as desconto_tipo,
--            case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) then p.desconto_valor  end as desconto_valor,
--            case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) then p.desconto_inicio end as desconto_inicio,
--            case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) then p.desconto_fim    end as desconto_fim
--       from public.produtos p
--      where p.oculto = false and public.loja_esta_ativa(p.loja_id);
--   revoke all on public.vitrine_produtos from anon, authenticated;
--   grant select on public.vitrine_produtos to anon, authenticated;
--
-- Efeito do rollback: rascunhos (produto 'cardapio' só em cardápio inativo)
--   voltam a ser legíveis por anon. Não perde dado: nenhuma linha é tocada.
-- Ordem com as outras migrations do Spec B: esta view depende de
--   `cardapio_produtos`/`cardapios`; reverter a 129000/128000 exige derrubar
--   ou recriar esta view ANTES.
-- ─────────────────────────────────────────────────────────────────────────────
