# Galeria de fotos da loja
2026-09-29 04:37 · plano detalhado: plan/loop-galeria-de-fotos.md

**O que você pediu:** que o lojista possa reaproveitar qualquer foto que já enviou (de produto, logo ou outra imagem do painel), veja essas fotos na hora de escolher uma nova e tenha uma tela para consultar todas e apagar uma a uma.

**O que vai ser feito:**
1. Onde hoje existe "enviar foto" (foto do produto e logo da loja) aparece também "Minhas fotos": abre a coleção da loja e o lojista escolhe uma já enviada, sem mandar de novo.
2. Nova tela "Fotos" no menu do painel, com todas as fotos da loja. Cada uma mostra se está em uso e onde. As que não estão em uso podem ser apagadas, com confirmação.
3. Hoje não existe capa, banner nem imagem de categoria no sistema. Quando existirem, vão usar esta mesma coleção.
4. A equipe do iRango, no painel de administração, também vê "Minhas fotos" da loja ao editar produto e logo. A tela de apagar fica só com o lojista.

**Cuidados:**
- Um lojista nunca vê, usa nem apaga foto de outra loja. Isso é testado antes de escrever o código e revisado por uma checagem de segurança separada.
- Hoje o sistema aceita, por descuido, a foto de outra loja num produto. Esse buraco é fechado junto.
- Foto em uso não pode ser apagada: o sistema avisa onde ela aparece, para o cliente nunca encontrar imagem quebrada na loja. **Isso precisa da sua confirmação** (veja abaixo).
- Nada muda na estrutura do banco de dados, então não há alteração irreversível no sistema em produção.

**Tempo estimado:** 2h30 a 3h15, mais o seu teste na tela. · **Versão mais rápida:** sem a revisão de estilo do código, com a documentação feita de forma mais simples e com a parte visível e a parte interna feitas numa etapa só, fica em cerca de 2h05 a 2h45. A checagem de segurança e os testes escritos antes do código continuam.

**Precisa de você:**
1. Decidir o que acontece ao apagar foto em uso: **bloquear e mostrar onde está** (recomendado), ou apagar e deixar o produto sem foto (cerca de 20 min a mais). Só avisar e deixar a imagem quebrada na loja não é recomendado.
2. Autorizar o envio do código ao GitHub e a abertura do pedido de revisão.
3. Testar na tela: enviar foto num produto e vê-la em "Minhas fotos"; usar a mesma foto em outro produto e como logo, e conferir na loja; apagar uma foto livre; tentar apagar uma foto em uso; repetir no celular; no painel de administração, conferir "Minhas fotos" da loja certa.
4. Fazer o merge (a sessão nunca faz).
