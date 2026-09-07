# [158] Paralelizar ViaCEP + Nominatim no checkout (dono real do p95)

**crítica:** SIM (toca cálculo de frete — caminho monetário)
**Mundo:** vitrine pública
**Depende de:** —
**Origem:** finding CUSTO da auditoria de performance da issue 125.
Registro: `performance/2026-09-06-criarpedido-whatsapphref.md`

## Problema

Em `src/lib/actions/pedido.ts:229-248`, `reconciliarBairroCep` (fetch ViaCEP,
timeout 3s) e `distanciaDaLojaAoCep` (`buscarCoordsLoja` + Nominatim, timeout 5s,
trava global de 1 req/s) rodam EM SÉRIE. Ambos dependem só de `endereco.cep` e
nenhum alimenta o outro.

São duas idas à internet pública encadeadas no caminho crítico do checkout, com
pior caso somado de 8s. É o verdadeiro dono do p95 — a releitura da issue 125,
por comparação, custa ~2ms depois do índice `itens_pedido_pedido_id_idx`.

## Escopo

- [ ] `Promise.all` nas duas chamadas. Ambas já são fail-closed com try/catch
      total, então a semântica se preserva.
- [ ] Confirmar que a trava global de 1 req/s do Nominatim continua respeitada.
- [ ] Teste provando que o frete calculado é idêntico antes e depois.

## Segurança

É caminho MONETÁRIO — o resultado alimenta a taxa de entrega. O valor continua
recalculado no servidor e nunca vem do cliente. Exige TDD red-first cobrindo a
equivalência do frete.

## Critério de aceite

- [ ] Frete calculado idêntico ao atual em todos os cenários já cobertos.
- [ ] As duas chamadas externas partem concorrentes.
- [ ] Falha de qualquer uma delas continua fail-closed, sem derrubar o checkout.
