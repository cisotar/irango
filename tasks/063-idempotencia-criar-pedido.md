# [063] Idempotência em criarPedido (anti duplo-submit)

**crítica:** SIM
**Mundo:** checkout
**Depende de:** 014
**Origem:** finding MÉDIA da auditoria da issue 014

## Objetivo
Evitar pedidos duplicados (e consumo dobrado de cupom de uso único) quando `criarPedido` é disparada 2x (duplo-clique, retry de rede).

## Contexto
Hoje cada chamada de `criarPedido` gera pedido+token novos; cupom de uso único é consumido a cada chamada. Documentado como limitação v1 na auditoria de 014.

## Escopo
- [ ] Chave de idempotência opcional no payload (`idempotency_key: z.guid().optional()`) gerada no client por carrinho/sessão
- [ ] Propagar à RPC `criar_pedido`; `UNIQUE` parcial (ex.: `(loja_id, idempotency_key)`) ou dedupe por janela curta
- [ ] Segunda chamada com a mesma chave → retorna o MESMO `pedido_id`, sem 2º INSERT nem 2º consumo de cupom
- [ ] Mitigação client (botão desabilitado no submit) fica na página de checkout (036) — complementar

## Segurança
- Idempotência server-side é a barreira real; o desabilitar-botão é só UX.

## Critério de aceite
- [ ] Duas chamadas com a mesma chave → 1 pedido, 1 consumo de cupom (teste pglite/unidade)
