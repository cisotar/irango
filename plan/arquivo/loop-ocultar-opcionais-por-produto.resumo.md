# Esconder um grupo de adicionais em produtos específicos
2026-09-29 02:18 · revisado 02:53 · plano detalhado: plan/loop-ocultar-opcionais-por-produto.md

**O que você pediu:** continuar ligando grupos de adicionais à categoria inteira, mas poder esconder um desses grupos em produtos específicos. A escolha deve funcionar em três lugares e também no admin.

**O que vai ser feito:**
- **Cartão do produto:** as etiquetas dos grupos viram botões de ligar/desligar. Desligada, a etiqueta fica apagada e riscada.
- **Janela de edição do produto:** uma seção "Adicionais deste produto" com os mesmos botões. Ela grava na hora e aparece só em produto já salvo.
- **Tela de adicionais:** em cada grupo ligado a uma categoria, um botão "Por produto" lista os produtos dessa categoria para você desmarcar onde o grupo não deve aparecer.
- **Loja:** cada produto mostra os grupos da categoria, na ordem da categoria, menos os escondidos nele.
- **Uma lógica só:** as três telas usam a mesma regra e o mesmo jeito de salvar. Mudar num lugar aparece nos outros.

**Cuidados:**
- O servidor recusa pedido com adicional escondido naquele produto. Um carrinho antigo que já o tinha é barrado na revisão.
- Um lojista não mexe em nada de outra loja, nem mandando vários produtos de uma vez. O banco impede.
- Se o produto mudar de categoria, o "escondido" continua guardado e só vale se a nova categoria tiver o grupo.

**Tempo estimado:** 4h a 4h50
**Versão mais rápida:** 3h20 a 4h10, sem perder segurança. Pula a revisão de estilo, a documentação feita por agente e a pausa de conferência entre banco e telas.

**Precisa de você:**
1. Escolher a versão: completa ou rápida.
2. Autorizar a mudança no banco de produção.
3. Autorizar o envio do código e a abertura do PR.
4. Testar na tela os três lugares, a loja e o admin.
