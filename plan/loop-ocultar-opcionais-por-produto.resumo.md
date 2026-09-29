# Adicionais por produto: esconder os da categoria e acrescentar exclusivos
2026-09-29 02:18 · revisado 02:33 · plano detalhado: plan/loop-ocultar-opcionais-por-produto.md

**O que você pediu:** continuar ligando grupos de adicionais à categoria inteira, mas poder, em cada produto, esconder um grupo que vem da categoria e também acrescentar um grupo só dele.

**O que vai ser feito:** no cartão de cada produto, as etiquetas dos grupos que vêm da categoria viram botões de ligar/desligar (desligada fica apagada e riscada). Ao lado, um botão "+ grupo" abre a lista dos grupos que a categoria não tem; o escolhido vira uma etiqueta com borda diferente e um "×" para tirar. Na loja, cada produto mostra os grupos da categoria menos os escondidos, mais os exclusivos (estes por último, na ordem em que foram adicionados). O mesmo vale na área de administração do SaaS. Precisa de uma pequena mudança no banco de dados.

**Cuidados:**
- Um cliente mal-intencionado poderia pedir um adicional escondido, ou um adicional exclusivo de outro produto. O servidor passa a recusar os dois casos, não só a tela.
- Um lojista não consegue mexer em adicionais de outra loja: o banco impede, não só o código.
- Um carrinho montado antes de o grupo ser escondido é barrado na revisão do pedido.

**Tempo estimado:** 3h a 4h · **Versão mais rápida:** pular a revisão de estilo do código e a atualização da documentação por agente. São cerca de 25 minutos a menos, sem perder segurança.

**Já decidido com você:** esconder também bloqueia no pedido. Se o produto mudar de categoria, o "escondido" continua valendo, mas só tem efeito se a categoria nova tiver o grupo.

**Assumimos (diga se não for isso):**
- Produto sem categoria também pode receber grupo exclusivo.
- Reordenar os grupos exclusivos fica para depois.

**Precisa de você:**
1. Escolher a versão: completa ou rápida.
2. Autorizar a mudança no banco de produção.
3. Autorizar o envio do código e a abertura da revisão (PR).
4. Testar na tela:
   - esconder uma etiqueta;
   - adicionar um grupo exclusivo;
   - tirar o grupo exclusivo;
   - conferir tudo isso na loja e no admin.
