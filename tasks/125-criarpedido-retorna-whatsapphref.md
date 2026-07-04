# [125] `criarPedido` devolve `whatsappHref` autoritativo (decisão no servidor)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** [121]
**Spec:** specs/5-whatsapp-envio-automatico-toggle.md

## Objetivo
Estender o retorno de `criarPedido` para incluir `whatsappHref: string | null`, montado
server-side a partir do pedido autoritativo recém-gravado — a DECISÃO de emitir o link é
do servidor (RN-A2), nunca do cliente.

## Escopo
- [ ] `criarPedido` (`src/lib/actions/pedido.ts`): no caminho de sucesso (após a RPC gravar
  e devolver `pedido_id`/`token_acesso`), montar `whatsappHref` com `montarLinkWhatsappPedido`
  a partir do `PedidoComItens` autoritativo + `loja` (`buscarLojaParaPedido` já traz a coluna
  após 121 — sem mudança de query, ver spec §Modelos).
- [ ] Emitir `whatsappHref != null` SÓ quando `loja.whatsapp_envio_automatico === true` E a
  loja tem WhatsApp (`montarLinkWhatsappPedido` já retorna `null` sem WhatsApp — RN-A2/RN-W3).
- [ ] Estender o tipo de retorno de sucesso para `{ pedidoId, token_acesso, whatsappHref }`.
- [ ] `next build` antes de fechar (retorno de Server Action).

## Fora de escopo
- Mecânica client de abrir a aba (issue 126).
- Qualquer mudança no conteúdo da mensagem (herda spec 3, RN-A6).

## Reuso esperado
- `montarLinkWhatsappPedido` (`src/lib/utils/whatsappPedido.ts`) — reuso, NÃO recriar montagem.
- `buscarLojaParaPedido` — reuso; sem query nova.

## Segurança
- Token de pedido: `whatsappHref` NUNCA contém `token_acesso` (RN-A6). A mensagem só formata
  o snapshot autoritativo já gravado — nenhum valor vem do carrinho do cliente.
- Decisão de emitir é do servidor (RN-A2): flag desligada ou sem WhatsApp → `whatsappHref: null`.
- Sem recálculo monetário novo (o total já é autoritativo da RPC).

## Critério de aceite
- [ ] (RED-first) Teste: flag `true` + loja com WhatsApp → retorno tem `whatsappHref` string
  `https://api.whatsapp.com/send?...` com o resumo do pedido gravado.
- [ ] (RED-first) Teste: flag `false` → `whatsappHref === null`.
- [ ] (RED-first) Teste: loja sem WhatsApp (flag `true`) → `whatsappHref === null`.
- [ ] (RED-first) Teste: `whatsappHref` NÃO contém o `token_acesso` do pedido.
- [ ] Vermelho escrito e confirmado ANTES do código; depois verde.
- [ ] `next build` passa.
