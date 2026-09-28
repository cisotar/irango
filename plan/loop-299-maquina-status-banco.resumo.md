# Travar no banco a ordem das etapas do pedido
2026-09-28 06:24 · plano detalhado: plan/loop-299-maquina-status-banco.md

**O que você pediu:** um plano para executar sozinho, do começo ao fim, a correção que impede o lojista de burlar a ordem das etapas do pedido.

**O que vai ser feito:** Hoje só a tela do painel respeita a ordem "pendente → confirmado → em preparo → saiu → entregue" (com o atalho novo e o cancelamento). Um lojista que chame o sistema por fora da tela consegue "descancelar" um pedido, lançar frete nele e cancelar de novo. A correção põe essa mesma regra dentro do próprio banco de dados, e também impede trocar depois se o pedido é entrega ou retirada. Primeiro escrevemos as provas que falham, depois a correção, depois uma revisão de segurança independente. Nada muda na tela nem para o cliente.

**Cuidados:**
- A regra no banco precisa ser idêntica à da tela, senão o lojista perderia o atalho que acabou de ganhar. Uma prova automática compara as duas em todas as combinações de etapas.
- O registro de frete combinado e as ações do painel administrativo têm de continuar funcionando. Há provas específicas para isso.
- A mudança no banco de produção não tem volta automática. Ela só acrescenta a trava, e a forma de desfazer fica escrita no próprio arquivo.

**Tempo estimado:** 1h a 1h25 do começo até o pedido de revisão aberto · **Versão mais rápida:** esta já é a versão enxuta. A versão completa acrescenta mais uma rodada de testes e uma revisão da documentação: +15 a 20 min.

**Precisa de você, antes de começar (múltipla escolha):**
1. Versão enxuta ou completa?
2. Posso aplicar a mudança no banco de produção? Sim: o trabalho vai até o pedido de revisão aberto. Não: para antes, com tudo pronto no seu computador.
3. Posso enviar o trabalho ao GitHub e abrir o pedido de revisão? A aprovação final continua sendo sua.

**Depois, na tela (loja "Lanches base"):** avançar um pedido por todas as etapas, usar o atalho para "saiu para entrega", cancelar um pedido e registrar um frete combinado. Tudo deve funcionar como antes.
