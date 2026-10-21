# Impedir que o lojista apague pedidos ou mude os dados do cliente
2026-10-21 06:24 · plano detalhado: plan/loop-330-pedidos-imutaveis-para-lojista.md

**O que você pediu:** fechar a brecha em que um lojista, mexendo por fora do painel, conseguia apagar pedidos da própria loja ou reescrever os dados do cliente e o código secreto do link de acompanhamento. Com o menor custo possível.

**O que vai ser feito:** o banco passa a permitir que o lojista mude só duas coisas num pedido: o andamento (confirmado, em preparo, saiu para entrega…) e o valor do frete combinado. Todo o resto fica travado: nome, telefone, endereço, observações, data do pedido, forma de pagamento, cupom e o código do link do cliente. Apagar pedido deixa de ser possível para o lojista. Qualquer informação nova que o pedido ganhar no futuro já nasce travada, sem depender de alguém lembrar. Primeiro se escreve um teste que mostra a brecha aberta, depois se fecha a brecha, e por fim alguém diferente revisa a segurança.

**Cuidados:**
- O cliente nunca mais perde o acesso ao link de acompanhamento por causa de uma mudança feita pela loja, e o histórico de pedidos e as métricas do dia não podem ser apagados.
- Mudar o andamento do pedido e registrar o frete combinado continuam funcionando: os testes conferem isso antes de entregar.
- O apagamento de dados que o próprio cliente pede (privacidade) continua funcionando, porque roda pelo sistema e não pelo lojista. Isso foi conferido e há teste.

**Tempo estimado:** 1h a 1h20 · **Versão mais rápida:** não há sem perder segurança. As etapas que daria para cortar já estão fora.

**Precisa de você:**
- autorizar a aplicação da mudança no banco de produção;
- autorizar o envio do código e a abertura do pedido de revisão (PR);
- testar na loja "Lanches base": mudar o andamento de um pedido, registrar um frete combinado e abrir o link de acompanhamento de um pedido recente.
