# Assistente de primeiros passos e regra única para publicar a loja
2026-11-01 15:52 · revisado 16:07 · plano detalhado: plan/loop-368-primeiros-passos-da-loja.md

**O que você pediu:** quem cria uma loja nova não cai no painel. Passa por um assistente (perfil, horários, entregas, pagamentos, produtos e opcionais) que termina publicando a loja. Junto entra a tarefa 193: endereço completo e localização no mapa passam a ser obrigatórios para publicar, com a mesma regra para o lojista e para o hub admin.

**O que vai ser feito:**
1. A loja passa a guardar se já foi publicada alguma vez. As lojas que já estão no ar, ou que já receberam pedido, ficam marcadas como prontas. Até publicar, qualquer entrada no painel leva ao assistente, sem o menu. A tela de assinatura continua acessível.
2. O assistente reaproveita as telas de configuração que já existem. Opcionais pode ser pulado. A última etapa mostra o que falta e publica.
3. Publicar exige nome, WhatsApp, endereço completo (CEP, rua, número, bairro, cidade e UF), localização no mapa, pelo menos um produto e uma forma de pagamento. Vale para o lojista, para quem publica de novo depois de pausar e para o hub admin, sem exceção.
4. O endereço completo passa a ser exigido ao salvar o perfil, e não na criação da conta. Com isso some o aviso errado "não localizamos seu endereço" para quem ainda não tinha preenchido.
5. Se uma loja no ar ficar sem localização ou sem endereço completo, ela continua no ar. O painel mostra um aviso fixo com o botão "Localizar meu endereço de novo", ou com o link para completar o endereço.

**Cuidados:**
- Pausar a loja não deixa o lojista sem acesso aos pedidos: vale "já foi publicada uma vez".
- A contagem de produtos e de formas de pagamento olha só a própria loja, tanto no lojista quanto no admin. Os testes que provam isso são escritos antes do código.
- Quando o mapa falhar por problema nosso, a mensagem nunca manda o lojista corrigir um endereço que está certo.
- Antes de começar, uma leitura conta quantas lojas no ar estão sem endereço ou sem localização. Se forem mais de 10, ou se a Pão do Ciso estiver entre elas, o trabalho para e você decide.

**Fica de fora, de propósito:** um lojista com conhecimento técnico ainda consegue pôr a própria loja no ar sem passar pela regra. É um risco antigo e aceito, que só afeta a loja dele, e passa a ficar registrado na lista de pendências. Fechar agora exigiria manter a mesma regra copiada em dois lugares.

**Tempo estimado:** de 5h00 a 6h40, versão completa como você pediu. Está perto das cerca de 6h da entrega de setembro que pesou no custo, mas aqui são duas tarefas tratadas como uma só, com uma única rodada de testes de segurança e uma única auditoria. A 193 acrescenta cerca de 1h15 sem aumentar o número de etapas.

**Precisa de você:**
- Responder à leitura inicial, se ela parar o trabalho.
- Autorizar a mudança no banco de produção antes de abrir o PR.
- Autorizar o envio da branch e a abertura do PR.
- Testar na tela, pelo roteiro no fim do plano detalhado: conta nova de teste, assistente, perfil sem endereço, publicar faltando algo, publicar, pausar e entrar de novo, e tentar publicar pelo hub admin sem produto.
