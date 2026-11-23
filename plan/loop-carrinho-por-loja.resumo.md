# Sacola de uma loja aparecendo em outra
2026-11-23 18:38 · plano detalhado: plan/loop-carrinho-por-loja.md

**O que você pediu:** que a sacola e os dados do checkout de uma loja parem de aparecer em outra loja aberta no mesmo navegador.

**O que vai ser feito:** hoje o navegador guarda uma sacola só, sem dizer de qual loja ela é. Quando o cliente abre outra loja numa aba nova a partir de um link, o navegador copia essa sacola. A loja B passa a mostrar os itens da loja A, e o pedido falha com uma mensagem vaga. Isso não expõe dados de outra pessoa: tudo acontece no aparelho do próprio cliente. Na correção, cada loja ganha a sua própria sacola e o seu próprio formulário de checkout, guardados à parte. Depois do pedido, só a sacola daquela loja é esvaziada. Sacolas antigas, guardadas no formato de hoje, são descartadas uma única vez.

**Decisão já tomada por você:** cada loja tem a sua sacola, ao mesmo tempo e separada das outras. Nenhuma tela nova e nenhum aviso de "esvaziar a sacola anterior".

**Cuidados:**
- O total e a quantidade de cada item não podem mudar com a reorganização. Testes já existentes travam isso e continuam valendo sem alteração.
- O servidor que recebe o pedido não é alterado, e uma conferência automática garante isso.
- Antes de qualquer código, um teste reproduz o problema: adicionar na loja A e a loja B continuar vazia.

**Tempo estimado:** 1h45 a 2h30 · **Versão mais rápida:** sem a revisão de estilo e sem o teste na tela feito pela automação, de 1h30 a 2h10. Nesse caso, o teste na tela fica só com você.

**Precisa de você:**
- rodar no computador que tem as dependências instaladas, ou autorizar instalá-las neste;
- aprovar o envio e a abertura do pedido de revisão do código;
- testar na tela: adicionar na loja A, abrir a loja B pelo link (sacola vazia), voltar à A (item lá), fazer um pedido de teste na A (sacola da A esvazia, a da B fica como estava).
