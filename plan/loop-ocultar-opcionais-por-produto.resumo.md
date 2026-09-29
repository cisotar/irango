# Esconder um grupo de adicionais em um produto específico
2026-09-29 02:18 · plano detalhado: plan/loop-ocultar-opcionais-por-produto.md

**O que você pediu:** continuar ligando grupos de adicionais à categoria inteira, mas poder esconder um grupo em um produto só, clicando na etiqueta dele no cartão do produto.

**O que vai ser feito:** as etiquetas de adicionais nos cartões do painel viram botões de ligar/desligar. Etiqueta desligada fica apagada e aquele grupo some da loja pública só naquele produto — os outros produtos da categoria continuam com ele. O mesmo botão aparece na área de administração do SaaS. Guardar isso exige uma pequena mudança no banco de dados.

**Cuidados:**
- Um cliente espertinho poderia mandar no pedido um adicional escondido. O servidor passa a recusar isso, não só a tela.
- Um lojista não consegue esconder (nem ver) adicionais de outra loja: o banco impede, não só o código.
- Carrinho montado antes de você esconder o grupo é barrado na revisão do pedido, como já acontece com adicional desativado.

**Tempo estimado:** 2h15 a 3h · **Versão mais rápida:** pular a revisão de estilo do código e a atualização da documentação por agente — cerca de 20 minutos a menos, sem perder segurança.

**Precisa de você:**
1. Responder (ou aceitar o que assumimos):
   - Esconder também impede o cliente de pedir aquele adicional? (assumido: sim)
   - Só esconder grupos que vêm da categoria, sem poder adicionar um grupo exclusivo a um produto? (assumido: sim, só esconder)
   - Se o produto mudar de categoria, o "escondido" continua valendo? (assumido: sim, e só tem efeito se o grupo existir na categoria nova)
2. Autorizar a mudança no banco de produção.
3. Autorizar o envio do código e a abertura da revisão (PR).
4. Testar na tela: clicar a etiqueta no painel, abrir o produto na loja e ver o grupo sumir só nele.
