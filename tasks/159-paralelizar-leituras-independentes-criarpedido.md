# [159] Paralelizar as 4 leituras independentes de `criarPedido`

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** —
**Origem:** finding CUSTO da auditoria de performance da issue 125.
Registro: `performance/2026-09-06-criarpedido-whatsapphref.md`

## Problema

Em `src/lib/actions/pedido.ts` linhas 89, 96, 107 e 215, quatro leituras
independentes acontecem em round trips sequenciais:
`listarFormasPagamento`, `buscarProdutosPorIds`, `buscarOpcionaisPorIds` e
`listarZonasComTaxas`. Só `buscarOpcionaisPorCategoria` (linha 117) depende de
`produtos`.

**Correção do enunciado original (2026-09-07).** A issue dizia "linha 208" e
tratava as quatro leituras como incondicionais. Está errado: `listarZonasComTaxas`
está na linha **215**, dentro do `else` de `if (dados.tipo_entrega === "retirada")`
(linha 211). Hoje **pedido de retirada nunca lê zonas**. Agrupar as quatro numa
onda única na linha 89, como o escopo original mandava, adicionaria um round trip
a todo pedido de retirada — o oposto do objetivo da issue.

## Escopo

- [ ] Agrupar numa onda `Promise.all` as **três** leituras incondicionais:
      `listarFormasPagamento`, `buscarProdutosPorIds`, `buscarOpcionaisPorIds`.
- [ ] `listarZonasComTaxas` entra na onda **condicionalmente** (só quando
      `tipo_entrega === "entrega"`) ou permanece onde está. O que não pode
      acontecer é retirada passar a ler zonas.
- [ ] `buscarOpcionaisPorCategoria` (linha 117) permanece na onda seguinte:
      depende de `produtos`.
- [ ] Manter a allowlist e as validações dependentes na onda seguinte. Nenhum
      `if` de validação pode ser movido, reescrito ou reordenado.

## Ressalva explícita (avaliar antes de implementar)

Hoje o `return` antecipado da linha 90 evita as leituras seguintes quando a
forma de pagamento é inválida. Paralelizar troca essa economia no caminho de
ERRO por latência menor no caminho de SUCESSO. Medir antes de decidir: se o
caminho de erro for raro (esperado), a troca compensa.

## Decisão sobre a ressalva (2026-09-07) — recomendação, confirmar antes de implementar

**Paralelizar, aceitando a perda do `return` antecipado.**

Evidência, sem instrumentar nada: forma de pagamento inválida não é alcançável
pela UI legítima, que só oferece as formas configuradas pela loja. Chegar ali
significa payload forjado ou bug — o caminho de ERRO é raro **por construção**,
então a troca (perder a economia no erro, ganhar latência no sucesso) compensa.

A economia perdida também é limitada: quem forja payload já é barrado antes pelo
rate limit (`pedido.ts:54`) e pelo zod `.strict()` (`:61`), ambos anteriores a
qualquer I/O.

Contra-evidência que mudaria a decisão: volume relevante de `ERRO_GENERICO` em
produção logo após a checagem de forma de pagamento. Não existe telemetria por
ramo hoje, então a decisão fica no argumento acima.

## Atenção: a suíte atual não protege sozinha o critério de aceite

`cenarioFeliz()` (`src/lib/actions/pedido.test.ts:313`) mocka todas as queries em
todo teste. Depois de paralelizar, o teste "forma de pagamento não aceita pela
loja" (`:579`) continua verde mesmo que `buscarProdutosPorIds` passe a ser
chamada — e continuaria verde até se ela passasse a ser chamada e a lançar
(`Promise.all` rejeita → catch externo → mesmo `ERRO_GENERICO`). Os testes
existentes passariam **pelo motivo errado**.

Por isso esta issue exige testes de caracterização escritos ANTES da mudança,
apesar de `crítica: NÃO`. O molde de asserção de não-chamada já existe:
`[006-A4]` (`pedido.test.ts:1133`) prova que `distanciaDaLojaAoCep` não é chamado
em retirada.

## Critério de aceite

- [ ] Comportamento e validações idênticos ao atual, inclusive as rejeições —
      mesma rejeição vencedora e mesma mensagem, comparada como string literal.
- [ ] Retirada continua **não** chamando `listarZonasComTaxas`
      (`.not.toHaveBeenCalled()`).
- [ ] Args da RPC (`fakeClient.rpc.mock.calls[0][1]`) idênticos ao baseline no
      cenário feliz com cupom + opcionais + frete de zona.
- [ ] Sem regressão nos testes existentes de `criarPedido`, e nenhum teste sumiu.
- [x] Decisão sobre a ressalva do `return` antecipado registrada na issue.

## Plano de execução

`plan/loop-159-paralelizar-leituras-criarpedido.md`.

## Relacionada

`tasks/158-paralelizar-viacep-nominatim-checkout.md` — mesmo registro de
performance, e é o dono real do p95 do checkout. Vale mais que esta issue;
se atacar as duas, comece por aquela.
