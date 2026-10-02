# 340 — Troca e promoção do endereço padrão do cliente em uma única transação

**crítica:** NÃO
**Mundo:** vitrine pública (conta do cliente)
**Depende de:** 335, 337
**Spec:** specs/cliente-identidade.md

## Origem

`auditar` e `testar` do P18 do Marco B (commit 38958d3). Severidade baixa: integridade, sem vazamento.

## Problema

`definirEnderecoPadrao` (`src/lib/actions/cliente.ts`) desmarca o padrão atual e marca o novo em duas escritas
separadas; `removerEnderecoCliente` apaga o endereço padrão e promove o mais antigo em outra escrita. Se a segunda
escrita falhar, ou se duas chamadas correrem juntas, o cliente fica sem endereço padrão (o índice único parcial
impede dois, mas não impede zero). O mesmo estado é alcançável por `UPDATE padrao=false` direto no PostgREST.

## Direção sugerida

Migration nova com RPC `security invoker` que troca o padrão num único UPDATE
(`set padrao = (id = p_id) where cliente_id = auth.uid()`) e trigger `AFTER DELETE` que promove o mais antigo quando
o removido era o padrão. As actions passam a chamar a RPC. Teste pglite: corrida e falha não deixam o cliente com
zero padrão.

## Critério de aceite

- [ ] Nenhum caminho (action ou PostgREST) deixa cliente com endereços e sem padrão.
- [ ] Testes existentes de endereço continuam verdes.
