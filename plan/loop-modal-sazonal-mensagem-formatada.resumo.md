# Modal da vitrine com mensagem formatada
2026-09-27 08:29 · plano detalhado: plan/loop-modal-sazonal-mensagem-formatada.md

**O que você pediu:** implementar, sozinho e de ponta a ponta, a mensagem com formatação no modal sazonal e a escolha de pratos opcional, deixando o pedido de revisão aberto.

**O que vai ser feito:** o lojista passa a escrever um aviso com negrito, cores, tamanhos, listas e links; pode salvar o modal só com título. O cliente vê a mensagem na vitrine e, ao tocar num link, vê para onde vai antes de sair. Salvar passa a ser "tudo ou nada": nunca fica metade gravada.

**Cuidados:** a mensagem de uma loja nunca vira código na tela do cliente nem afeta outra loja; link só seguro (https) e sempre com aviso; cada tipo de ataque tem um teste escrito antes do código e revisado depois.

**Tempo estimado:** 4–5h · **Versão mais rápida:** já aplicada — sem etapa separada de planejamento, desenho e teste no app (o app real não funciona com essa mudança até o banco ser atualizado).

**Precisa de você:** atualizar o banco de produção (comando no pedido de revisão) antes de aprovar; testar na tela: criar um modal com mensagem e link, abrir a vitrine no celular, tocar no link; aprovar e mesclar.
