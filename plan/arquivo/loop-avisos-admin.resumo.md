# Avisos no painel admin — o que este loop fez (resumo humano)

## O problema, em uma frase

Quando você entra na loja de um lojista pelo hub admin, o menu não mostra "Avisos".
Não é um link esquecido: o item está **escondido de propósito**, porque a tela de
Avisos existe só no painel do lojista. O menu do admin tem uma lista de "rotas que
não existem aqui" justamente para não oferecer link que daria erro 404. Avisos está
nessa lista.

Então o conserto não é mostrar o link — é **construir a tela** e só depois mostrar o
link. Mostrar antes publicaria um 404 (já aconteceu uma vez no projeto).

## O que apareceu no caminho

A tela do lojista salva os avisos por duas funções do banco que exigem estar logado
**como dono da loja**. O admin não é o dono — ele opera com um acesso de serviço. As
duas funções recusam esse acesso de propósito ("admin está fora do escopo", diz o
comentário delas).

Duas saídas:

1. o admin salvar sem passar por essas funções — mas aí "salvar" deixa de ser
   tudo-ou-nada, e "ativar um aviso" volta a poder deixar a loja sem nenhum aviso no
   ar por um instante. Os dois problemas já foram corrigidos no passado, e aqui
   voltariam **na loja de outro lojista**. Recusado;
2. abrir uma "porta de serviço" nessas funções, do jeito que o projeto já fez numa
   função equivalente (a de faixas de entrega). Escolhido.

A porta de serviço é a parte delicada: ela afrouxa uma trava de autoridade no banco.
Por isso ela vem com teste que prova, no banco de verdade, que o público anônimo e
um lojista sem posse continuam barrados, que o dono continua funcionando igual, e
que o admin **não consegue** mexer numa loja diferente da que abriu.

## O que foi entregue

- a tela de Avisos no hub admin, reusando a tela do lojista inteira (ela já aceitava
  receber as ações de fora — nada da tela foi reescrito);
- cinco ações de servidor do lado admin (criar, editar, ativar, desativar, remover),
  cada uma amarrada à loja que está na URL;
- a porta de serviço nas duas funções do banco, com teste de isolamento;
- o item "Avisos" saindo da lista de "rotas que não existem" — o menu do admin passa
  de 6 para 7 itens em Configurações.

## Uma coisa que exige ação sua

A mudança no banco **não foi aplicada** ao Supabase de produção. Isso é irreversível
e o projeto exige sua autorização, então ela viaja dentro do PR e nada mais. Até ela
ser aplicada (`npx supabase db push`), a tela nova dá erro em produção — mesmo com
todos os testes verdes. O PR diz isso em destaque.

Nada foi mesclado: o PR fica aberto, esperando você.
