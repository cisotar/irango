# 321 — Frequência de exibição: regra de compra no servidor

Spec: `specs/frequencia-exibicao.md` (§Regra de compra, RN-1, RN-2, RN-3)
Plano: `plan/loop-frequencia-exibicao.md` (fatia I2)
Crítica: SIM (comprabilidade — seguranca.md §10; fuso da loja)

## O que fazer

- `src/lib/utils/frequencia.ts`: avaliador puro produto ∩ categoria no fuso da loja,
  reusando `fusoLoja.ts` (`partesNoFusoCompletas`, `paraMinutos`, `diaNoFuso`) — nenhum
  `Intl` novo; motivo `fora_da_janela` (`MotivoNaoCompravel`), sem motivo novo.
- `src/lib/actions/pedido.ts`: troca `buscarCardapiosComProdutos` +
  `avaliarVigenciaDoProduto` pelo avaliador novo; recusa categoria oculta.
- `src/lib/actions/revisarCarrinho.ts` e `src/components/vitrine/checkout/itensBloqueados.ts`:
  mesmos três casos.

## Prova (tabela Risco, linha I2)

`src/lib/utils/frequencia.test.ts`: tabela de casos (dia fora, hora na borda
inclusiva/exclusiva, período na borda, interseção vazia RN-1, fuso `America/Manaus` vs
`America/Sao_Paulo` na virada do dia). `src/lib/actions/pedido.frequencia.test.ts`: produto
fora da frequência do produto → `ERRO_FORA_DA_JANELA`, categoria fora da frequência →
idem, categoria oculta → `ERRO_GENERICO`, RPC `criar_pedido` com 0 chamadas.
`revisarCarrinho` marca `fora_da_janela` nos mesmos três casos.

Depende de: 320.
