# Mudar o status do pedido direto na lista, com atalho para "pronto"
2026-09-28 00:09 · plano detalhado: plan/loop-status-pedido-clicavel.md

**O que você pediu:** executar sozinho, do começo ao fim, a primeira etapa do documento sobre status clicável e demora da atualização para o cliente.

**O que vai ser feito:** o selo de status nas listas de pedidos do painel e do seu painel de administração vira um botão. Ao tocar nele, o lojista vê as ações daquele pedido nesta ordem: a próxima etapa, um atalho para "Pronto para retirada" ou "Saiu pra entrega" e "Cancelar". O mesmo atalho aparece na tela de um pedido aberto. O selo muda na hora, e vários toques seguidos recarregam a lista uma vez só. Em pedido de retirada, lojista e cliente passam a ler "Pronto para retirada" em vez de "Saiu para entrega". A consulta que a tela do cliente faz a cada 8 segundos passa a ler só o status do pedido, sem nome, telefone nem endereço. A parte de aviso instantâneo ao cliente fica para depois, como o documento decidiu.

**Cuidados:**
- O atalho muda a regra de quem pode mudar o status e como. Antes de escrever o código, vêm os testes que provam que nenhuma loja mexe em pedido de outra e que pedido entregue ou cancelado continua sem volta. No fim, uma revisão de segurança confere tudo.
- Um toque por engano no atalho de um pedido recém-chegado impediria cancelar e faria o cliente sair de casa. Por isso o atalho pede confirmação quando pula etapas, e "Cancelar" também passa a pedir.
- Se duas pessoas mudarem o mesmo pedido ao mesmo tempo, só a primeira mudança vale. A segunda recebe uma mensagem de erro, e nada é gravado por cima.

**Tempo estimado:** 2h50 a 3h40 · **Versão mais rápida:** sem a revisão de textos e de qualidade, em um passo de código só: ~2h25 a 3h10. A revisão de textos é pedida pelo próprio documento.

**Precisa de você antes de sair:** (1) confirmar a execução automática; (2) autorizar enviar o documento e o código para o GitHub e abrir o PR (a mesclagem continua com você); (3) nada vai para o banco em produção, porque esta etapa não muda o banco; (4) nenhuma biblioteca nova é necessária; (5) ligar o modo automático de permissões.
**Precisa de você na volta:** testar na tela, no celular e no computador, a lista de 10 cliques que vai no PR. Nenhum teste automático toca a tela por você.
**Decidido sem perguntar (dá para mudar antes de começar):** o documento continua na pasta ativa depois de concluído, porque a parte adiada ainda está descrita nele.
