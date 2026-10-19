# Escolher a forma de cobrar a entrega, sem uma tela apagar a outra
2026-10-18 10:05 · plano detalhado: plan/loop-formas-de-frete.md

**O que você pediu:** fechar três pendências da tela de entregas num único pacote: o lojista escolher entre cobrar por distância, por faixa de CEP ou por bairro; impedir que uma aba aberta desfaça a mudança feita em outra; e limpar o que sobrou da tela antiga.

**O que vai ser feito:**
1. Primeiro se desenha, de uma vez, como o sistema guarda cada forma de cobrança e como ele percebe que a tabela mudou desde que a tela foi aberta.
2. Antes de qualquer código, se escrevem os testes que comprovam as regras de preço e de proteção. Depois vem a parte do servidor, e com ela sai o caminho antigo que gravava preço sem essa proteção.
3. Depois vem a tela: o lojista escolhe a forma, vê só a tela daquela forma e é avisado quando a loja está sem localização cadastrada. Numa loja nova, a forma que já vem marcada é a cobrança por distância (km).
4. No fim há uma revisão de segurança, a atualização no banco real (com a sua autorização) e a abertura do pedido de revisão do código.

**Cuidados:**
- Ao trocar de forma, a forma anterior para de valer por completo. Se uma faixa antiga continuasse ligada, o cliente poderia pagar um frete menor do que o lojista definiu.
- Se o lojista mexer em duas abas, ou o suporte mexer junto com ele, a segunda gravação é recusada com o pedido para recarregar a página. Assim nenhum preço novo é desfeito sem ninguém perceber.
- O valor cobrado no pedido continua sendo calculado no servidor, e essa parte não é alterada.

**Tempo estimado:** de 3h45 a 5h15, cerca de 1 hora a mais que a tela de faixas da última vez, porque são três pendências. **Versão mais rápida:** de 3h15 a 4h30, juntando as duas etapas de código e dispensando a revisão de estilo e os testes extras da tela. A proteção dos preços e a revisão de segurança ficam.

**Precisa de você:**
- Autorizar a atualização do banco real.
- Autorizar o envio do código e a abertura do pedido de revisão.
- Testar na tela: trocar de forma, editar CEP e bairro, abrir em duas abas, conferir o aviso de loja sem localização e repetir no painel de suporte.
