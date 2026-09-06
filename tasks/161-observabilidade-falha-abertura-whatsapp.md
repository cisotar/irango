# [161] Observabilidade da falha de abertura do WhatsApp

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [126]
**Origem:** finding BAIXA da auditoria de segurança da issue 126.

## Problema

Os blocos `catch {}` de `src/components/vitrine/checkout/aberturaWhatsapp.ts`
engolem em silêncio a falha de entregar o pedido à loja. O padrão §14 do repo é
`console.error` com prefixo próprio — ver `[criarPedido:whatsapp]` em
`src/lib/actions/pedido.ts`.

Hoje, se a abertura falha (popup bloqueado, COOP, desapossamento recusado),
ninguém fica sabendo: nem o cliente, nem o log.

## Escopo

- [ ] Adicionar log com prefixo próprio nos `catch` do módulo.
- [ ] Avaliar se vale um aviso discreto ao cliente ("não conseguimos abrir o
      WhatsApp — use o botão na próxima tela"), sem quebrar o RN-A4 (best-effort,
      o checkout nunca falha por causa disso).

## 🛑 Atenção ao implementar

**NUNCA logar o `href`.** Ele carrega nome, telefone e endereço do comprador na
query string. Logar o href seria vazar PII no console do navegador do cliente.
Logue só o motivo/categoria da falha.

## Critério de aceite

- [ ] Falha de abertura produz log identificável, sem nenhum dado pessoal.
- [ ] Checkout continua sem quebrar em qualquer cenário de falha.
