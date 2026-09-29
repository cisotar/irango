# Melhorar a previa do tema da vitrine
2026-09-29 14:30 · plano detalhado: plan/loop-preview-tema.md

**O que voce pediu:** Trocar a previa do tema (aquele bloco pequeno com o nome da loja e a tag "Destaque") por uma miniatura que mostre como a vitrine do cliente realmente fica — com cabecalho, categorias, produtos e barra do carrinho, tudo reagindo em tempo real quando voce muda as cores. Clicar na miniatura abre uma versao maior num modal.

**O que vai ser feito:** Um componente novo vai renderizar uma miniatura da vitrine usando emojis no lugar das fotos (logo, produtos). A miniatura mostra: cabecalho colorido com o nome da loja, barra de busca, pilulas de categoria, cards de produto com preco ficticio e botao de adicionar, e a barra de carrinho no rodape — tudo nas cores que voce esta escolhendo. Ao clicar, abre um modal com a previa em tamanho maior. Os seletores de cor, o botao de salvar e tudo que ja funciona continuam exatamente iguais.

**Cuidados:**
- O que ja funciona (salvar tema, validacao de cor) nao e tocado — o risco de quebrar e praticamente zero.
- A verificacao final e visual: so voce sabe se a miniatura esta parecida o suficiente com a vitrine real, entao uma lista de conferencia no celular e no computador fecha a entrega.

**Tempo estimado:** 25 a 45 minutos · **Versao mais rapida:** pular a revisao de qualidade do codigo — economiza ~8 minutos sem perder seguranca.

**Precisa de voce:**
- Aprovar o plano para comecar
- Testar na tela: abrir a pagina de tema, mexer nas cores, clicar na miniatura para abrir o modal, salvar e conferir na vitrine publica
- Autorizar o push e a abertura do PR quando estiver satisfeito
