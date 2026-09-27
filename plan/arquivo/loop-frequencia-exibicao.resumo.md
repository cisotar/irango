# Dias e horários de cada prato e de cada categoria, no lugar do cardápio do dia
2026-09-27 10:50 · plano detalhado: plan/loop-frequencia-exibicao.md

**O que você pediu:** trocar o "cardápio do dia" por uma regra simples, em que cada prato e cada categoria têm seus próprios dias, horários e datas, para acabar com o prato que aparece duas vezes na loja.

**O que vai ser feito:**
1. Cada prato ganha dias da semana, horário e período de datas. Cada categoria ganha os mesmos campos e um botão para esconder. Os pratos que hoje estão no cardápio do dia voltam a ficar sempre disponíveis, e o lojista configura de novo na tela nova.
2. Na loja, o bloco "Pratos do dia" some. Prato fora do horário continua aparecendo na categoria dele, marcado como indisponível. Categoria escondida some. Categoria fora do horário aparece com todos os pratos indisponíveis.
3. No painel entram uma tabela com os pratos nas linhas e os dias nas colunas (salva tudo de uma vez), a opção de marcar vários pratos e aplicar o mesmo horário a todos, e um aviso quando a regra do prato e a da categoria nunca coincidem.
4. O menu "Cardápios" sai do painel e da área de administração.

**Cuidados:**
- Um cliente mal-intencionado poderia tentar comprar um prato fora do horário mexendo no próprio celular. O sistema confere de novo na hora de fechar o pedido e recusa. Isso fica provado por teste antes de qualquer código ser escrito.
- Mudar vários pratos de uma vez não pode, por engano ou má-fé, alterar pratos de outra loja. Há teste para isso também, no painel do lojista e no seu.
- A mudança no banco coloca em produção os 8 pratos da Alma Bragantina como sempre disponíveis. Antes disso fica guardada a lista de quais eram, para dar para voltar atrás. Entre a mudança no banco e a publicação do site passa pouco tempo, e nesse intervalo esses pratos ainda aparecem no bloco antigo.

**Tempo estimado:** 3h45 a 4h30 de trabalho automático, mais o tempo das suas aprovações.
**Versão mais rápida:** sem o desenho prévio das telas novas e sem a revisão de estilo do código, que faz cerca de 3h15 a 3h45. As telas ficam mais sujeitas a ajuste depois. As proteções de compra e de loja não entram no corte.

**Precisa de você:**
- Decidir se a mudança atual (a mensagem do aviso sazonal) fecha e publica antes de começar. É o recomendado, porque as duas mexem nas mesmas partes da loja.
- Autorizar a publicação, a abertura do pedido de revisão e a mudança no banco de produção.
- Testar na tela: a tabela de dias, a seleção de vários pratos, esconder uma categoria, o aviso de regra que nunca coincide e, no celular, tentar colocar no carrinho um prato indisponível.
