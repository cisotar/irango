# [007] `calcularFreteAction`: preview de frete por raio (coords via service_role)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública (Server Action de preview)
**Depende de:** 002, 003, 005, 006
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Estender `calcularFreteAction` (`lib/actions/frete.ts`) para espelhar o autoritativo: quando a loja tem coords e o cliente informou CEP, buscar coords via service_role, geocodificar o CEP, calcular `distanciaKm` por haversine e injetar no `EnderecoEntrega` antes do `calcularFrete`. Sem UI nova; preview continua não-vinculante.

## Escopo
- [ ] Buscar coords da loja via `buscarCoordsLoja` (service_role) — exceção à regra "anon-only" desta action, justificada no spec (§Como o preview obtém as coords): coords não estão na `vitrine_lojas`. Zonas/loja seguem via anon.
- [ ] Se há coords + CEP → `geocodificarEndereco(cep)` → `haversine` → `endereco.distanciaKm`.
- [ ] Passar a `calcularFrete` (intacto). Fail-closed: geocoding `null` → `distanciaKm` indefinido → zona `raio_km` não casa.
- [ ] Garantir paridade EXATA com `criarPedido` (issue 006): mesmos utils, mesma ordem (reconciliar bairro + geocode CEP). Se issue 006 extraiu helper neutro, reusar aqui.

## Fora de escopo
- Mudança em `Carrinho.tsx`/wizard (consomem o resultado existente; sem alteração).
- Mudar `calcularFrete`.
- Persistência (preview não persiste).

## Reuso esperado
- `haversine.ts` (002), `geocodificarEndereco.ts` (003), `buscarCoordsLoja` (005), e o eventual helper neutro extraído na issue 006 — RN-7. NÃO reimplementar a sequência geocode→haversine.

## Segurança
- RN-4: cliente nunca envia `distanciaKm` nem `taxa`; preview recalculado no servidor.
- RN-7: paridade preview↔autoritativo — preview não pode mostrar frete divergente do que `criarPedido` cobra.
- service_role usado SÓ para as duas colunas de coords; zonas/loja seguem anon (não regredir privacidade).

## Critério de aceite
- [ ] (teste vermelho primeiro) Testes com utils mockados:
  - Loja com coords + CEP + zona `raio_km` cobrindo → `taxa_preview` igual à taxa da zona raio; `zona_nome` = nome da zona.
  - Geocoding falha → cai no fallback/indisponível (mesmo resultado do autoritativo).
  - Loja sem coords → comportamento atual inalterado.
  - Paridade: para o mesmo input, preview e `criarPedido` produzem a mesma `taxa`.
- [ ] `next build` sem erro; `pnpm test` verde.
