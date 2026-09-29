# Cadastro de clientes com conta única no iRango
2026-09-29 05:50 (revisão do plano de 2026-09-15) · plano detalhado: plan/loop-cadastro-de-clientes.md

**O que você pediu:** o cliente cria uma conta única (e-mail, senha, nome, telefone, data de nascimento e até 3 endereços), recupera a senha por código enviado ao e-mail, vê o próprio histórico de compras e pode apagar a conta; o lojista vê a lista dos clientes que já compraram na loja dele — sem que um cliente veja outro, o lojista ou o dono do iRango, e sem que cliente vire lojista.

**O que vai ser feito:** em quatro blocos, cada um aprovado por você antes de começar e entregue sozinho.
1. Fechar a porta que existe hoje: qualquer pessoa logada que abre o painel ganha uma loja. Enquanto isso estiver de pé, criar conta de cliente é criar um atalho para virar lojista. Vale por si só.
2. A conta do cliente: cadastro, entrar, código por e-mail para trocar a senha, página "Minha conta" com dados e endereços, e o botão de apagar a conta.
3. Ligar a conta ao pedido: quem está logado fecha o pedido com endereço já preenchido e vê o histórico; quem não está continua comprando exatamente como hoje. Cupom passa a poder ter limite por pessoa. Conta apagada deixa o pedido no painel como "Cliente removido", com valores intactos.
4. A lista de clientes no painel do lojista: só quem já comprou ali, com o histórico naquela loja e um filtro de aniversariantes do mês.
Promoções automáticas por data ficam para depois, anotadas como pendência de produto.

**Cuidados:** cada bloco tem testes escritos antes do código provando que um cliente não lê dados de outro, que o lojista só vê clientes da própria loja e que o desconto do cupom é decidido no servidor, nunca na tela. Uma checagem de segurança fecha cada bloco, e uma simulação de ataque completa fecha o bloco 3, antes de expor o login de cliente. Nenhum teste apaga nada no banco real; o código de recuperação é o do próprio serviço de login, não um inventado aqui.

**Tempo estimado:** 19h30 a 26h de trabalho automático no total — bloco 1: 3h20–4h30 · bloco 2: 6h–8h · bloco 3: 6h30–8h15 · bloco 4: 3h30–5h20. Nenhum bloco cabe nas ~2h45 que você aceitou em loops anteriores. · **Versão mais rápida:** tirar a revisão de estilo do código em todos os blocos, a atualização de documentação feita por agente nos blocos 1 e 4 e o desenho de tela do bloco 4 economiza cerca de 1h no total; os testes de segurança e a simulação de ataque não saem. Comparado ao plano de 2026-09-15, este já corta mais da metade do custo por não repetir a checagem de segurança em cada pedacinho.

**Precisa de você:** aprovar este plano; aprovar a decisão de como o sistema distingue cliente de lojista (bloco 1); aprovar o texto de cada bloco antes de virar código; autorizar cada atualização do banco de produção, uma por vez; colocar o texto do e-mail com o código de recuperação no painel do provedor; testar na tela o roteiro de cada bloco (criar conta, 3 endereços, trocar senha por código, tentar abrir o painel, apagar a conta; comprar logado e como visitante; conferir a lista de clientes); aprovar e mesclar cada entrega.
