# Cadastro de lojista só vale depois de confirmar o e-mail
2026-10-03 11:45 · plano detalhado: plan/loop-cadastro-lojista-papel-pos-confirmacao.md

**Contexto:** Débito não urgente. Dono está ciente. Fica guardado para quando você pedir; só começa depois que o PR #179 for mesclado.

**O que você pediu:** deixar pronto um plano para resolver de vez o caso em que alguém cadastra uma loja usando o e-mail de outra pessoa e o sistema já reserva aquela conta como lojista antes de a dona do e-mail confirmar.

**O que vai ser feito:**
1. O formulário de cadastro de lojista passa a só criar a conta e mandar o e-mail de confirmação. Nada mais fica gravado nesse momento.
2. A conta vira lojista e a loja é criada no instante em que a pessoa clica no link do e-mail, que é a prova de que o e-mail é dela.
3. Quem já pagou a assinatura antes de se cadastrar continua tendo o pagamento ligado à loja: a loja passa a nascer antes dessa ligação, no mesmo clique.
4. As anotações internas sobre segurança e regras do produto são atualizadas.

**O que isso resolve e o que não resolve:** deixa de existir a reserva da conta só por preencher o formulário. Continua como está, e já aceito: quem dispara o e-mail de confirmação escolhe se a pessoa entra como lojista ou como cliente, caso ela clique naquele link. O cadastro de cliente também segue reservando a conta antes da confirmação. Dá para resolver depois com a mesma técnica, se você quiser.

**Cuidados:**
- Pagamento feito antes do cadastro não pode se perder. Há um teste que exige que a loja exista antes de o pagamento ser ligado a ela.
- Ninguém pode ganhar loja sem confirmar o e-mail. Os testes que provam isso são escritos antes da mudança e precisam falhar primeiro.
- Quem se cadastra pela área de cliente nunca ganha loja.

**Tempo estimado:** 1h40 a 2h15 · **Versão mais rápida:** 1h20 a 1h50, sem a segunda revisão de código e sem o revisor de documentação (a própria sessão atualiza as anotações). Não há versão mais curta sem abrir mão da segurança.

**Precisa de você:**
- Antes de começar, confirmar quatro escolhas, todas sem mudar o banco de dados: (1) a data do aceite dos Termos passa a ser a da confirmação do e-mail; (2) os 14 dias de teste grátis contam a partir da confirmação; (3) o endereço inicial da loja pode ganhar um final diferente do atual, e o lojista pode trocar no perfil; (4) e-mail que já é de cliente continua recebendo "Este email já está cadastrado.".
- Autorizar o envio do código e a abertura do PR.
- Testar na tela com um e-mail seu que nunca foi usado: antes de clicar no link, o painel não abre; depois de clicar, a loja aparece e o teste grátis termina 14 dias depois da confirmação.
- Decidir se quer uma tarefa numerada para isso ou se este plano basta.
