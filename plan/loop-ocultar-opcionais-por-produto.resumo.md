# Adicionais por produto: esconder os da categoria e acrescentar exclusivos
2026-09-29 02:18 · revisado 02:36 · plano detalhado: plan/loop-ocultar-opcionais-por-produto.md

**O que você pediu:** continuar ligando grupos de adicionais à categoria inteira, mas poder, em cada produto, esconder um grupo que vem da categoria ou acrescentar um grupo só dele. A escolha deve funcionar em três lugares: nas etiquetas do cartão do produto, na janela de edição do produto e na tela de adicionais. Tudo vale também na área de administração.

**O que vai ser feito:**
- **Cartão do produto:** as etiquetas viram botões de ligar/desligar. Há um "+ grupo" para acrescentar um exclusivo e um "×" para tirá-lo.
- **Janela de edição do produto:** uma seção "Adicionais deste produto" com os mesmos botões. Ela grava na hora e aparece só em produto já salvo.
- **Tela de adicionais:** em cada grupo ligado a uma categoria, um botão "Por produto" abre a lista de produtos. Nela você desmarca onde o grupo não deve aparecer e marca produtos de outras categorias que devem recebê-lo.
- **Loja:** cada produto mostra os grupos da categoria, menos os escondidos, mais os exclusivos.
- **Fonte única:** as três telas usam a mesma regra, o mesmo jeito de salvar e o mesmo estado. Mudar num lugar aparece nos outros, sem três versões da lógica para manter.

**Cuidados:**
- Um cliente mal-intencionado poderia pedir um adicional escondido, ou um adicional exclusivo de outro produto. O servidor recusa os dois casos.
- Um lojista não mexe em adicionais de outra loja, nem mandando vários produtos de uma vez. O banco impede.
- Um carrinho montado antes de o grupo ser escondido é barrado na revisão do pedido.

**Tempo estimado:** 4h45 a 6h
**Versão mais rápida:** 4h a 5h15. Pula a revisão de estilo, a documentação feita por agente e a pausa de conferência entre banco e telas. Não perde segurança, mas a garantia de "uma lógica só" passa a depender de uma checagem automática simples, sem revisor.

**Já decidido com você:** esconder bloqueia no pedido. O "escondido" continua valendo se o produto mudar de categoria, mas só tem efeito se a categoria nova tiver o grupo.

**Ainda preciso que você confirme:**
1. Produto sem categoria pode receber grupo exclusivo? (assumido: sim)
2. Reordenar os grupos exclusivos fica para depois? (assumido: sim)
3. Qual versão: completa ou rápida?

**Precisa de você depois:**
- Autorizar a mudança no banco de produção.
- Autorizar o envio do código e a abertura do PR.
- Testar os três lugares, a loja e o admin na tela.
