# [082] Util `calcularTotal` — somar opcionais no subtotal do item

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/spec_opcionais.md

## Objetivo
Estender `lib/utils/calcularTotal.ts` para que o subtotal de cada item inclua o acréscimo dos opcionais: `(preco_produto + Σ preco_opcional × qtd_opcional) × quantidade_item`. Fonte única usada pelo preview (cliente) e pelo recálculo autoritativo (servidor) — sem duplicar lógica.

## Escopo
- [ ] Estender `ItemCalculo` para aceitar `opcionais?: { preco: number; quantidade: number }[]`
- [ ] Em `calcularSubtotal`, somar `Σ (preco_opcional × qtd_opcional)` ao preço do produto antes de multiplicar por `quantidade` do item
- [ ] Manter `arredondar` (2 casas) e o clamp de total já existentes
- [ ] Item sem opcionais → comportamento idêntico ao atual (compatibilidade)

## Fora de escopo
- Validação de quais opcionais são permitidos / pertencem à loja (083).
- Schema zod do payload (083 ou item próprio — ver dependências).
- Qualquer leitura de banco (esta é função pura).

## Reuso esperado
- `lib/utils/calcularTotal.ts` (existente) — estender `ItemCalculo`/`calcularSubtotal`, NÃO criar `calcularSubtotalComOpcionais` paralelo.
- `arredondar` interno já existente.

## Segurança
- Função pura: não confia em nada do cliente por si só. No servidor, os `preco` passados vêm SEMPRE do banco (a action monta o `ItemCalculo` com preços do banco — 083).
- No cliente é apenas preview estético (RN-O1).

## Critério de aceite
- [ ] (crítica) Teste vermelho/verde:
  - item com 2 opcionais (preço a × qtd + preço b × qtd) soma corretamente antes de × quantidade do item;
  - item sem opcionais retorna o mesmo subtotal de antes (regressão);
  - arredondamento a 2 casas sem float drift (ex.: 0.1 + 0.2);
  - `quantidade_item` multiplica produto + opcionais juntos.
