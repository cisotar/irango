# 322 — Frequência de exibição: escrita lojista + admin (unitária, grade, seleção, categoria)

Spec: `specs/frequencia-exibicao.md` (§Escrita, RN-5, RN-6)
Plano: `plan/loop-frequencia-exibicao.md` (fatia I3)
Crítica: SIM (escopo `loja_id` / autorização; escrita em lote)

## O que fazer

- `src/lib/validacoes/frequencia.ts`: schema zod importando `MSG_HORA_PAR`,
  `MSG_HORA_ORDEM`, `MSG_PRAZO_ORDEM`, `normalizarDiasDoVinculo` de
  `validacoes/cardapio.ts` (importar, não copiar).
- `src/lib/actions/produto.ts` + `produto-contrato.ts`: definir frequência de produto,
  aplicar frequência a vários ids, salvar grade produto × dia (atômico), `alternarOcultaCategoria`,
  definir frequência de categoria. Moldes: `alternarExibirImagens` :381,
  `definirVisibilidadeEmProdutos` :643, contrato compartilhado `comPrazosNoFuso`.
- `src/app/admin/assinantes/actions/admin-produtos.ts`, `admin-categorias.ts`: espelho
  via service_role escopado por `prepararContextoAdmin` (`admin-loja.ts:236`).

## Prova (tabela Risco, linha I3)

`src/lib/actions/produto.frequencia.test.ts` +
`src/app/admin/assinantes/actions/admin-frequencia.paridade.test.ts`: lote (grade e
seleção) com um `produto_id` de outra loja → zero linhas alteradas + fragmento da
mensagem afirmado (não só SQLSTATE); lojista sem loja → recusa; admin só escreve na
`lojaId` do contexto; payload com `hora_inicio >= hora_fim` recusado pelo zod antes do
banco; grade salva tudo ou nada (falha forçada no 2º item ⇒ 1º não gravado).

Depende de: 320.
