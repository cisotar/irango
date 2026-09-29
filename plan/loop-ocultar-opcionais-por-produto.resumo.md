# Adicionais por produto: esconder, acrescentar exclusivos e escolher a posição
2026-09-29 02:18 · revisado 02:48 · plano detalhado: plan/loop-ocultar-opcionais-por-produto.md

**O que você pediu:** continuar ligando grupos de adicionais à categoria inteira, mas poder, em cada produto:
- esconder um grupo que vem da categoria;
- acrescentar um grupo só dele;
- colocar esse grupo exclusivo na posição que quiser entre os outros.

Isso deve funcionar no cartão do produto, na janela de edição e na tela de adicionais, e também no admin.

**O que vai ser feito:**
- **Cartão:** as etiquetas ligam/desligam, há "+ grupo" para acrescentar e "×" para tirar. As etiquetas aparecem na mesma ordem da loja.
- **Janela de edição do produto:** os mesmos botões e uma lista em que você arrasta o grupo exclusivo para onde quiser. Os grupos da categoria aparecem travados, com o aviso "ordem definida na categoria".
- **Tela de adicionais:** o botão "Por produto" escolhe em quais produtos cada grupo aparece ou fica escondido. A ordem dos grupos da categoria continua sendo arrumada ali, como hoje.
- **Loja:** mostra exatamente essa ordem.
- **Uma lógica só:** a regra de ordem é uma só, usada pela loja, pelo cartão e pela janela.

**Regra de ordem que assumimos (confirme):** o grupo exclusivo guarda o **lugar** em que você o pôs, por exemplo o 2º.
- Se depois você reordenar, acrescentar ou tirar grupos da categoria, ele continua em 2º e os demais se ajeitam em volta.
- Se a lista ficar menor que esse lugar, ele vai para o fim.
- Exclusivo acrescentado sem escolher lugar entra no fim.
- A alternativa seria ele "andar junto" com o grupo vizinho. Dá para fazer, mas é mais difícil de prever.

**Cuidados:**
- O servidor recusa pedido com adicional escondido ou com adicional exclusivo de outro produto.
- Um lojista não mexe em nada de outra loja. O banco impede.
- Um carrinho antigo com um adicional agora escondido é barrado na revisão.

**Tempo estimado:** 5h30 a 6h30
**Versão mais rápida:** 4h45 a 5h45, sem perder segurança. Pula a revisão de estilo, a documentação feita por agente e a pausa de conferência entre banco e telas.

**Ainda preciso que você confirme:**
1. A regra de ordem acima ("guarda o lugar").
2. Produto sem categoria pode receber grupo exclusivo? (assumido: sim)
3. Qual versão: completa ou rápida?

**Precisa de você depois:**
- Autorizar a mudança no banco de produção.
- Autorizar o envio do código e a abertura do PR.
- Testar na tela: arrastar o exclusivo na janela do produto e conferir o cartão, a loja e o admin.
