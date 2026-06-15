# [052] Rate limiting nas Server Actions sensíveis

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 013, 014, 015
**Spec:** specs/spec_irango_mvp.md (seguranca.md §12, §5)

## Objetivo
Aplicar rate limit por IP nas ações de login, criar pedido e validar cupom para conter brute force e spam.

## Escopo
- [ ] Criar `src/lib/utils/rateLimit.ts` (wrapper sobre `@upstash/ratelimit` + Upstash Redis)
- [ ] login ~5/min; criar pedido ~10/min; validar cupom ~20/min; preview de frete ~20/min — por IP
- [ ] Aplicar nas actions 015 (login), 014 (criar pedido), 013 (validar cupom), `calcularFreteAction` (preview frete — enumeração de bairro/CEP + abuso do ViaCEP, finding BAIXA auditoria 067)
- [ ] Mensagem genérica ao exceder (seguranca.md §14)

## Fora de escopo
Headers (051). Lógica das actions (013/014/015).

## Reuso esperado
- `@upstash/ratelimit` (lib consolidada — não reinventar)
- env sem `NEXT_PUBLIC_` para credenciais Upstash (seguranca.md §7)

## Segurança
- Sem trava, INSERT público de pedido e login viram superfície de abuso (seguranca.md §5, §12)

## Critério de aceite
- [ ] (crítica) Teste vermelho: exceder o limite por IP retorna erro de rate limit; dentro do limite passa; credenciais Upstash não vazam ao client
