# [006] `criarPedido`: recálculo autoritativo com `distanciaKm` + persistência no snapshot

**crítica:** SIM (TDD red-first)
**Mundo:** painel/infra (Server Action autoritativa)
**Depende de:** 002, 003, 005
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Estender `criarPedido` (`lib/actions/pedido.ts`): quando a loja tem coords e o pedido é entrega com CEP, geocodificar o CEP do cliente no servidor, calcular `distanciaKm` por haversine, injetar em `EnderecoEntrega` antes do `calcularFrete` autoritativo, e persistir `distanciaKm` no snapshot `endereco_entrega` (JSONB) do pedido.

## Escopo
- [ ] No ramo `tipo_entrega === "entrega"`, após reconciliar bairro: buscar coords da loja (issue 005). Se houver coords e CEP do cliente → `geocodificarEndereco(cep)` → `haversine` → `endereco.distanciaKm`.
- [ ] Passar o endereço com `distanciaKm` a `calcularFrete` (a função pura **não muda**; já lê `endereco.distanciaKm`).
- [ ] Persistir `distanciaKm` no objeto `endereco_entrega` enviado à RPC `criar_pedido` (apenas quando calculado; ausente caso contrário).
- [ ] Fail-closed: geocoding `null` → `distanciaKm` indefinido → zona `raio_km` simplesmente não casa (fallback/indisponível). Sem regressão no fluxo de bairro/faixa_cep.
- [ ] Não persistir coords do cliente, só `distanciaKm` (spec §`distanciaKm` no snapshot).

## Fora de escopo
- Preview (`calcularFreteAction`, issue 007) — mesma lógica, action diferente.
- Mudar `calcularFrete` (proibido — função pura intacta).
- Migration (JSONB aceita campo novo sem schema change).
- Cache de geocoding (v2).

## Reuso esperado
- `haversine.ts` (issue 002), `geocodificarEndereco.ts` (issue 003), `buscarCoordsLoja` (issue 005) — RN-7 paridade preview↔autoritativo: mesmos utils que o preview.
- `calcularFrete` + `reconciliarBairroCep` + `EnderecoEntrega` já importados na action.
- Não duplicar a sequência geocode→haversine: se ficar idêntica ao preview, considerar extrair um helper neutro em `lib/actions/` (módulo sem `'use server'`). Avaliar na implementação.

## Segurança
- RN-4: frete recalculado do zero; `distanciaKm`/`taxa`/`total` do cliente ignorados; `.strict()` rejeita extras.
- RN-9: `distanciaKm` persistido para auditoria de cobrança (Nominatim pode mudar após recadastro do endereço da loja).
- RN-5: fail-closed total no geocoding do CEP do cliente.
- Bug aqui → cliente paga frete por raio errado ou burla zona → crítica.

## Critério de aceite
- [ ] (teste vermelho primeiro) Testes da action com utils mockados:
  - Loja com coords + CEP + zona `raio_km` que cobre a distância → frete da zona raio; `endereco_entrega.distanciaKm` persistido.
  - Geocoding falha (`null`) → zona `raio_km` não casa → cai no fallback; sem `distanciaKm` no snapshot.
  - Loja sem coords → comportamento atual inalterado (bairro/faixa_cep).
  - `retirada` → frete 0, sem geocoding, sem `distanciaKm`.
- [ ] `next build` roda sem erro (constraint de `'use server'`).
- [ ] `pnpm test` verde após implementação.
