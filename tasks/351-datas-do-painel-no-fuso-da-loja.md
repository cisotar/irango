# 351 — Datas do painel no fuso da loja

**Origem:** implementação da issue 347 (pré-existente).
**Crítica:** NÃO
**Mundo:** painel

## Problema
`formatarDataHora` fixa `America/Sao_Paulo` e ignora `lojas.timezone`. Afeta a coluna Hora de `/painel/pedidos` e a coluna Data dos pedidos no detalhe do cliente. Loja em outro fuso (ex.: Manaus) vê horários deslocados.

## Escopo
- Passar o fuso da loja para a formatação (reusar `diaNoFuso`/`fusoLoja`).
- Testes com fuso diferente de São Paulo.
