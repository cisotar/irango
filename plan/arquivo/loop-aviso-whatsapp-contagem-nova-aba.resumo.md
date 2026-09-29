# Aviso do WhatsApp volta a contar e abre numa aba separada
2026-09-29 02:12 · plano detalhado: plan/loop-aviso-whatsapp-contagem-nova-aba.md

**O que você pediu:** trazer de volta a contagem de 5 segundos no aviso do WhatsApp, abrir o WhatsApp numa aba nova quando a contagem acabar e fechar o aviso sozinho depois.

**O que vai ser feito:**
1. Primeiro se reescrevem os testes automáticos que hoje garantem o comportamento antigo, e se confirma que eles falham — prova de que a mudança é intencional.
2. Depois se muda o aviso: a contagem volta em qualquer aparelho; no fim, tenta abrir o WhatsApp numa aba nova e fecha o aviso. Se o navegador bloquear, no computador o aviso mostra o botão "Enviar mensagem" (a tela do pedido não some); no celular abre o WhatsApp como hoje.
3. Os botões "Enviar agora" e "Enviar mensagem" passam a abrir sempre numa aba nova. Isso também conserta um defeito atual: no computador, clicar neles hoje troca a tela do pedido pelo WhatsApp.
4. Uma revisão de segurança independente, a atualização da documentação e a abertura do pedido de revisão do código.

**Cuidados:**
- A tela de acompanhamento do pedido nunca é trocada sozinha no computador.
- A aba nova não consegue mexer na tela do pedido (proteção contra golpe de página falsa), e os dados do cliente continuam fora do que o servidor envia e fora dos registros.
- Não se cria nenhuma tarefa nova no backlog nem se toca na branch antiga que sobrou no GitHub, para não repetir a quebra que você descartou.

**Tempo estimado:** 1h20 a 1h50, mais o seu teste na tela. · **Versão mais rápida:** pular a revisão de estilo do código e deixar a documentação com a sessão principal: cerca de 1h10 a 1h35. A revisão de segurança e os testes escritos antes não saem.

**Precisa de você (o loop para e espera):**
1. Aprovar este plano antes de começar.
2. Autorizar o envio do código ao GitHub e a abertura do pedido de revisão.
3. Testar na tela os 5 cenários (Chrome e Firefox no computador, Android e iPhone) e dizer o resultado.
4. Autorizar o envio final que marca a spec como concluída.
5. Fazer o merge. A sessão nunca faz.
