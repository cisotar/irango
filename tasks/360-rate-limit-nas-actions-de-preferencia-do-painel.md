# 360 — Rate limit nas actions de preferência do painel

crítica: NÃO · Spec: nenhum

## Origem
Achado BAIXA do `auditar` no loop relatorio-vendas (branch feat/relatorio-vendas, após o commit 7801cd5):
`salvarCicloVendas` (src/lib/actions/vendas.ts) não tem rate limit. Ela segue o padrão das irmãs
`salvarModalidadesEntrega`, `salvarHorarios` e `salvarTema`, que também não têm; em `loja.ts` só
`salvarPerfil` tem (chama o geocoder). Impacto: só custo de UPDATE de uma linha na própria loja
(RLS `lojas_update_proprio` + `count !== 1`); nenhum outro tenant, nenhum valor.

## O que fazer
- Decidir um balde por lojista (identificador = `dono_id` da sessão, molde `carregarMaisClientes` em
  src/lib/utils/rateLimit.ts) para as actions de preferência do painel, em vez de um balde por action.
- Aplicar em `salvarCicloVendas`, `salvarModalidadesEntrega`, `salvarHorarios`, `salvarTema` (e a
  action admin equivalente fica de fora: admin já é `verificarAdminSaaS`).
- Registrar o balde em references/seguranca.md §12.

## Critérios de aceite
- [ ] Teste unitário: com o limite estourado, cada action devolve erro genérico sem tocar o banco.
- [ ] Mensagem genérica na UI; nenhum detalhe interno.
