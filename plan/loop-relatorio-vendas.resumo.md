# Relatório de vendas no painel e no hub admin
2026-10-07 09:39 · plano detalhado: plan/loop-relatorio-vendas.md

**O que você pediu:** uma seção "Vendas" no painel do lojista mostrando quanto a loja faturou, e a parte financeira dela também na área de gestão de cada loja (admin), feita de ponta a ponta sem sua supervisão.

**O que vai ser feito:** cada item vendido passa a guardar a categoria em que estava no momento da venda (as vendas antigas recebem a categoria atual). A loja ganha a configuração do dia em que o mês dela começa. O painel ganha a tela Vendas: total bruto, descontos, líquido e frete separados; por dia, semana ou mês; filtro por entrega ou retirada; itens mais vendidos por categoria; ranking dos clientes fiéis. O admin vê a mesma parte financeira, sem o ranking.

**Cuidados:** os números são calculados no servidor a partir dos pedidos gravados, nunca do navegador; um lojista nunca enxerga venda ou cliente de outra loja (testado antes de escrever o código); a mudança na gravação do pedido não altera preço nem total — só acrescenta a categoria, e os testes do checkout continuam passando antes da publicação.

**Tempo estimado:** 4 a 5 horas · **Versão mais rápida:** já sem a etapa de desenho de tela e sem atualizar dados de exemplo (~30 min a menos); cortar mais exigiria pular testes de dinheiro — não há sem perder segurança.

**Precisa de você:** revisar e mesclar o PR; clicar na tela (filtros, abas, ordenação do ranking, gráfico, mudar o dia do ciclo, tela do admin). A exportação em planilha ficou para depois, registrada como tarefa.
