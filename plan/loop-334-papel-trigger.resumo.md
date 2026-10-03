# Fechar duas pontas soltas na separação entre conta de lojista e conta de cliente
2026-10-03 10:49 · plano detalhado: plan/loop-334-papel-trigger.md

**O que você pediu:** executar, de ponta a ponta e sem parar, a tarefa 334 (dois pontos fracos achados na revisão de segurança da separação lojista × cliente).

**O que vai ser feito:**
1. Hoje, se alguém tenta criar uma loja em nome de outra pessoa, quem barra é uma única regra do banco. Vamos acrescentar uma segunda barreira independente, para que uma mudança futura nessa regra não abra a porta. Nada muda para quem usa o produto.
2. No cadastro de lojista, em um caso raro (e-mail já cadastrado, ainda não confirmado e sem tipo de conta definido), o tipo de conta é decidido antes de a pessoa provar que o e-mail é dela. Fechar isso exigiria refazer o cadastro inteiro do lojista. Como não dá acesso a nada e o caso é raríssimo, a decisão é aceitar, registrar por escrito e travar o comportamento atual com teste.

**Cuidados:** a nova barreira não pode impedir o lojista de criar a própria loja nem o administrador de criar loja para alguém; os testes provam os dois. A mudança no banco é aplicada na nuvem só depois de todos os testes passarem.

**Tempo estimado:** 45–70 min · **Versão mais rápida:** não há sem perder segurança.

**Precisa de você:** revisar e mesclar o PR (o loop não mescla). Se quiser fechar também o caso raro do item 2, isso vira um trabalho de redesenho do cadastro, a decidir.
