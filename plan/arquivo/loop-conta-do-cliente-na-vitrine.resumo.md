# Aviso "Já é nosso cliente?" e menu do cliente na loja
2026-10-02 22:42 · plano detalhado: plan/loop-conta-do-cliente-na-vitrine.md

**O que você pediu:** ao tocar em "Finalizar pedido", o cliente vê um aviso com "Criar conta", "Fazer login" e "Prosseguir sem login". Quem estiver logado ganha um botão de menu no canto de cima, à esquerda, com os links da conta e a opção de sair.

**O que vai ser feito:**
1. Antes de começar, três perguntas rápidas, uma de cada vez: em que momento o aviso aparece, se ele volta depois de "Prosseguir sem login" e se o menu também aparece na tela de finalizar pedido.
2. O aviso centralizado. "Fazer login" e "Criar conta" levam às telas que já existem, e depois o cliente volta para finalizar o pedido com o carrinho intacto. "Prosseguir sem login" segue a compra como hoje.
3. O menu lateral do cliente logado, com "Minha conta", "Endereços", "Pedidos" e "Sair". Ao sair, o cliente continua na mesma loja, já deslogado.

**Cuidados:**
- O menu não mostra nome nem e-mail. A página da loja é pública, e assim nenhum dado pessoal aparece nela.
- Os links de entrar, criar conta e sair só levam para dentro do próprio iRango. Os testes provam que um link adulterado não manda o cliente para outro site.
- Nada muda no carrinho nem nos valores. Um teste confere que o cálculo do total ficou intocado.
- Isto já acontece hoje e não muda nesta entrega: quem cria conta por e-mail confirma por um link, que pode abrir em outra aba. Nessa aba nova o carrinho não aparece. Pelo Google isso não acontece.

**Tempo estimado:** 1h20 a 1h50, sem contar o tempo das suas respostas. · **Versão mais rápida:** sem a revisão de código independente, cerca de 20 minutos a menos. As checagens automáticas continuam, mas quem escreveu o código passa a ser o único a conferir.

**Precisa de você:** responder às 3 perguntas, autorizar o envio do código e a abertura do pedido de revisão no GitHub, e testar na tela da "Lanches base" (roteiro de 10 toques no plano detalhado: aviso, as três opções, menu, links, sair, teclado e celular).
