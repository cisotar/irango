# [008] Util `calcularFrete` (fonte única de verdade)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 017
**Spec:** specs/spec_irango_mvp.md (RN-05)

## Objetivo
Função pura que calcula a taxa de entrega a partir das zonas da loja e do endereço informado. Usada como PREVIEW na vitrine e como valor AUTORITATIVO na Server Action de criar pedido.

## Escopo
- [ ] Criar `src/lib/utils/calcularFrete.ts`
- [ ] Assinatura: `calcularFrete(zonas, endereco, subtotal): { taxa: number; zonaId: string | null; gratis: boolean }`
- [ ] Zona tipo `bairro`: match do bairro informado em `bairros_zona` (case-insensitive, trim)
- [ ] Aplicar frete grátis se `subtotal >= taxas_entrega.pedido_minimo_gratis`
- [ ] Ignorar zonas inativas
- [ ] Retornar `taxa: 0` / `zonaId: null` quando bairro não atendido (decidir sentinela; documentar)

## Fora de escopo
Tipo `raio_km` e `faixa_cep` (fora do MVP de cálculo — só `bairro` é exercido na vitrine; manter assinatura extensível). Desconto (009), total (012).

## Reuso esperado
- Tipos de `src/types/supabase.ts` (017)
- Lógica de negócio do `lojinhaonline` portada para TS tipado — não copiar JS literal

## Segurança
- Mesma função usada no preview e no recálculo autoritativo do servidor — DRY evita divergência cliente/servidor (seguranca.md §10)

## Critério de aceite
- [ ] (crítica) Teste vermelho: bairro atendido retorna a taxa correta; subtotal acima do mínimo retorna `gratis: true` e taxa 0; bairro não atendido sinaliza não-atendido; zona inativa é ignorada
