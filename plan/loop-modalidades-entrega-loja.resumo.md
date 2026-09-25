# Retirada, entrega e frete combinado, configurados por loja
2026-09-24 08:41 · plano detalhado: plan/loop-modalidades-entrega-loja.md

**O que você pediu:** que cada loja escolha se aceita retirada, entrega ou as duas, e, na entrega, se o frete é calculado pelo sistema ou combinado com o cliente no WhatsApp, com o valor combinado registrado depois no pedido.

**O que vai ser feito:**
1. Na página de Entregas do painel e do hub admin, o lojista liga e desliga retirada e entrega (uma das duas fica sempre ligada) e escolhe entre frete automático ou a combinar. As lojas que já existem continuam exatamente como hoje.
2. No checkout, o cliente só vê as opções ligadas, e a única opção ligada já vem marcada. No frete a combinar, o cliente vê "A loja vai te chamar no WhatsApp para combinar o frete". Um endereço fora da área de entrega recebe a mensagem nova, com o link do WhatsApp da loja.
3. Nos pedidos, retirada aparece em destaque na lista, no detalhe, na comanda e no recibo. No detalhe, o lojista registra o valor do frete combinado, e o total do pedido se atualiza.

**Cuidados:**
- Quem define o valor é sempre o sistema. Um cliente com a página aberta antes de a loja mudar a configuração não fecha pedido numa opção que foi desligada, e o total do frete registrado é refeito pelo sistema a partir do pedido gravado, nunca a partir do que chega da tela.
- Frete a combinar nunca aparece como "Grátis" nem "R$ 0,00". Frete zero só aparece quando o lojista registra zero.
- A mudança toca a página pública de todas as lojas. Depois de publicar a mudança no banco, a vitrine é aberta de novo para confirmar que continua no ar.

**Tempo estimado:** 3h40 a 4h50, acima das ~2h45 que você aceitou em loops anteriores. **Versão mais rápida:** tirar a revisão de estilo do código e a atualização da documentação feita por um agente separado, que eu faço à mão no fim. Economiza de 10 a 15 minutos, porque a revisão roda em paralelo com a checagem de segurança. Não há corte maior sem perder segurança: a parte de dinheiro precisa de teste escrito antes do código e de checagem de segurança no fim.

**Precisa de você:**
- **Decidir antes de começar:** o lojista combina R$ 6,00, digita R$ 8,00 por engano e o pedido de R$ 45,00 passa a mostrar R$ 53,00. Ele pode corrigir para R$ 51,00? "Não" (o valor trava no primeiro registro) é o padrão do plano. "Sim" soma uns 20 minutos.
- Autorizar a publicação da mudança no banco e a abertura do PR.
- Testar na tela, porque aqui não há navegador: ligar e desligar as opções no painel e no hub admin, fazer pedidos com cada combinação, testar um endereço fora da área de entrega com e sem WhatsApp cadastrado, registrar o frete e imprimir a comanda e o recibo.
