# Trocar a senha estando logado no painel
2026-11-01 23:24 · plano detalhado: plan/loop-369-alterar-senha-lojista-logado.md

**O que você pediu:** que o lojista consiga trocar a própria senha de dentro do painel, sem precisar do link por e-mail.

**O que vai ser feito:** ao clicar no nome da loja, no topo do menu, aparece "Alterar senha", junto do e-mail e do "Sair". A tela pede a senha atual, a nova e a confirmação. Com a senha atual certa, a troca acontece na hora: o lojista continua logado neste aparelho e os outros aparelhos são desconectados. A tela funciona também para loja com assinatura vencida. Quem não lembra a senha atual, ou só entra com Google, recebe um link para redefinir pelo e-mail, que já existe.

**Cuidados:**
- Alguém que encontre o painel aberto num computador não consegue trocar a senha sem saber a atual. Assim não toma a conta do dono.
- Chutar a senha atual fica travado depois de poucas tentativas, por conexão e por conta.
- Errar a senha atual não desconecta ninguém nem muda nada. A senha nunca vai para os registros do sistema.
- A senha vale para as duas entradas (lojista e cliente), porque a conta é uma só. A área do cliente continua sem esta tela, como você decidiu em outubro.

**Tempo estimado:** 1h50 a 3h10 · **Versão mais rápida:** dá para tirar a revisão de estilo do código, a atualização da documentação e um teste rápido de rota, economizando uns 20 a 25 minutos (1h30 a 2h45). A segurança não muda. Abaixo disso não há como cortar sem perder segurança.

**Precisa de você:**
- Aprovar o plano. Se preferir outra opção em algum destes dois pontos, diga antes de começar: continuar logado depois da troca (a outra opção é sair e entrar de novo) e o link ficar no menu da conta (a outra opção é dentro de "Configurações").
- No painel do Supabase, conferir se a opção "Secure password change" está desligada. Se estiver ligada, quem está logado há mais de um dia não consegue trocar a senha.
- Autorizar o envio do código e a abertura do pedido de revisão.
- Testar na tela com a conta da loja de teste "Lanches base" (nunca a loja real), usando a lista de 10 cliques do plano. A lista inclui um segundo navegador, para ver a desconexão.
