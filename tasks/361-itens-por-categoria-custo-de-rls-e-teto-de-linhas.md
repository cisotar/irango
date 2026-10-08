# 361 — Itens por categoria: custo de RLS em janela longa e teto de 1000 linhas

crítica: SIM (mexe em função de valor e em fronteira de segurança INVOKER/DEFINER) · Spec: specs/relatorio-vendas.md (RN-V16)

## Origem
Achados do `acelerar` no loop relatorio-vendas (branch feat/relatorio-vendas, após o commit 7ba43d3;
registro em performance/2026-10-07-relatorio-vendas.md):

1. **CUSTO** — `public.vendas_itens_por_categoria` (supabase/migrations/20261007124000_relatorio_vendas_funcoes.sql)
   é `SECURITY INVOKER`; na sessão do lojista cada linha de `itens_pedido`/`itens_pedido_opcionais` reavalia a
   cadeia de RLS até `lojas`. Medido em pglite (2 lojas × 24 mil pedidos): 366 dias → 1,9 s lojista vs 0,26 s
   service_role; 30 dias → 154 ms vs 37 ms. A posse já é provada antes pela T2 de `vendas_preparar_consulta`.
   Fix proposto: migration nova tornando só essa função `SECURITY DEFINER` (mesmo corpo, mesma T2, search_path
   fixo), com parecer do `auditar` e ajuste do T355-21 (hoje exige `prosecdef = false`).
2. **Correção silenciosa** — a função devolve uma linha por (categoria, item); o PostgREST corta em
   `max_rows = 1000` (supabase/config.toml:18; cloud usa o mesmo padrão). Com mais de 1000 nomes distintos no
   período, categorias de menor valor e "Sem categoria" somem sem aviso. Improvável no volume atual.
   Fix proposto: top N itens por categoria no SQL (ou paginação explícita) + aviso na tela quando houver corte.

## Critérios de aceite
- [ ] RED: teste pglite que prova a recusa `42501 sem posse da loja` continua com DEFINER.
- [ ] RED: teste com > N itens distintos mostra o aviso de corte e mantém todas as categorias no total.
- [ ] Medição antes/depois registrada em performance/.
