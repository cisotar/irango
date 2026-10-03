# Fechar os ajustes do painel de clientes e do horário dos pedidos
2026-10-03 13:24 · plano detalhado: plan/loop-fechamento-350-351.md

**O que você pediu:** levar até o fim as duas correções que já estão prontas: o limite de velocidade no botão "Carregar mais" da lista de clientes e o horário dos pedidos mostrado no fuso da própria loja.

**O que vai ser feito:** o código já está pronto, testado e aguardando sua aprovação. Nada disso vai ser refeito. Faltam quatro coisas: (1) um revisor de segurança independente lê só o trecho que mexe na lista de clientes do lojista, porque quem escreveu o código não deve conferir o próprio trabalho; (2) você confere a tela na versão de prévia; (3) você aprova a publicação, na ordem certa junto com as outras duas entregas que estão na fila; (4) a documentação passa a registrar os dois problemas como resolvidos, e este plano é arquivado.

**Cuidados:**
- A lista de clientes tem nome e telefone de quem compra. O revisor confirma que a trava nova não deixa um lojista ver nada além da própria loja e que a mensagem de erro não revela nada interno.
- A entrega do "rótulo do fuso" (a terceira da fila) bate de frente com a entrega do cadastro numa linha da documentação. Por isso ela vai por último, depois de um ajuste simples, e não atrasa estas duas.
- Para trocar de versão no seu computador, o servidor de testes precisa estar parado antes. Senão partes do app podem sumir da tela.

**Tempo estimado:** 35 a 50 minutos de ponta a ponta, quase tudo esperando a checagem automática do GitHub. Some 10 a 15 minutos se a terceira entrega for resolvida no mesmo bloco. · **Versão mais rápida:** dá para pular a revisão de segurança independente e economizar uns 12 minutos. Não recomendo, porque esse trecho mexe nos dados dos clientes do lojista.

**Precisa de você:**
- Na prévia do pedido de mudança #181, entrar como dono da "Lanches base" e conferir: a hora dos pedidos na tela inicial do painel e em Pedidos bate com a hora de Brasília em que o pedido foi feito; no detalhe de um cliente, a data e a hora dos pedidos também batem; se a loja tiver mais de 50 clientes, "Carregar mais" continua funcionando no uso normal.
- Aprovar a publicação nesta ordem: primeiro a do cadastro (#179), depois esta (#181) e por fim a do fuso (#180).
- Parar o servidor de testes do seu computador quando eu pedir.
- Autorizar o envio da atualização da documentação.
