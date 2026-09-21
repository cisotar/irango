-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 245 — correção de achado do `auditar` (severidade BAIXA).
--
-- `cardapio_produtos_leitura_publica` (20260920129000) exigia só loja ativa. O
-- comentário original supunha que o filtro por cardápio ATIVO já estava coberto
-- por `cardapios_leitura_publica`, mas policy de outra tabela não restringe esta:
-- cada tabela avalia a sua. Resultado, provado com a anon key:
--
--   GET /rest/v1/cardapio_produtos?loja_id=eq.<loja>&select=cardapio_id,produto_id,criado_em
--
-- devolvia também os vínculos de cardápio INATIVO — o rascunho que o lojista
-- ainda não lançou. Vaza quantos pratos a loja está montando, desde quando, e os
-- ids envolvidos, enquanto `cardapios` e `produtos` negam essas mesmas linhas.
-- É a mesma classe do vazamento de calendário promocional que gerou a issue 265,
-- e a própria 242 classifica o rascunho como estratégia comercial.
--
-- A trava passa a ser explícita. Seguro porque:
--   * a view `vitrine_produtos` é definer e NÃO passa por esta policy — o
--     catálogo público não depende dela;
--   * o SSR (247) só considera cardápio ativo, por RN-03;
--   * o dono continua lendo os próprios vínculos, inclusive de rascunho, pela
--     `cardapio_produtos_leitura_propria`, que é combinada por OR.
--
-- Continua sem avaliar janela de vigência: isso é função pura em TypeScript
-- (RN-06), e há teste que reprova se a janela aparecer no SQL.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "cardapio_produtos_leitura_publica" on public.cardapio_produtos;

create policy "cardapio_produtos_leitura_publica"
  on public.cardapio_produtos for select
  using (
    public.loja_esta_ativa(cardapio_produtos.loja_id)
    and exists (
      select 1
        from public.cardapios c
       where c.id = cardapio_produtos.cardapio_id
         and c.loja_id = cardapio_produtos.loja_id
         and c.ativo = true
    )
  );

-- Rollback: recriar a policy com o `using` só de `loja_esta_ativa`, como estava
-- em 20260920129000. Reabre o vazamento do rascunho.
