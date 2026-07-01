-- [083] produtos.oculto + RLS produtos_leitura_publica por oculto = false
--
-- Migration ADITIVA (uma coluna) + troca de predicado da policy de leitura
-- pública já existente (criada na 20260614002000_rls_catalogo.sql).
--
-- 1) Coluna `oculto boolean NOT NULL DEFAULT false`:
--    - Separa VISIBILIDADE (oculto) de DISPONIBILIDADE (disponivel). Produto pode
--      estar indisponível (esgotado) e ainda assim visível na vitrine; produto
--      oculto some da vitrine independente de disponivel.
--    - DEFAULT false (RN-7): retrocompatível — todo produto preexistente continua
--      visível. Postgres 11+ resolve o backfill como metadados (attmissingval),
--      sem reescrever a tabela; seguro em tabela populada. Decisão de produto:
--      NÃO migrar produtos hoje indisponíveis para oculto.
--
-- 2) DROP + CREATE da policy `produtos_leitura_publica`:
--    - Antes:  USING (disponivel = true AND public.loja_esta_ativa(produtos.loja_id))
--    - Depois: USING (oculto = false AND public.loja_esta_ativa(produtos.loja_id))
--    - Reusa a função SECURITY DEFINER public.loja_esta_ativa(uuid) (NÃO recriar):
--      a base `lojas` não tem SELECT público para anon (seguranca.md §19), então um
--      EXISTS direto em lojas rodaria sob RLS do anon e retornaria zero linhas,
--      tornando o catálogo invisível. O helper responde só o booleano.
--    - `produtos_leitura_propria` e `produtos_escrita_propria` ficam INTOCADAS:
--      o dono já vê/gerencia tudo por dono_id = auth.uid(), inclusive oculto.

alter table public.produtos
  add column oculto boolean not null default false;

-- Troca do predicado da leitura pública: disponivel = true  →  oculto = false.
-- DROP + CREATE (mesmo padrão da 20260614002000): Postgres não tem
-- "ALTER POLICY ... USING" que preserve intenção de forma legível; recriar é o
-- padrão do projeto.
drop policy "produtos_leitura_publica" on public.produtos;

create policy "produtos_leitura_publica"
  on public.produtos for select
  using (
    oculto = false
    and public.loja_esta_ativa(produtos.loja_id)
  );
