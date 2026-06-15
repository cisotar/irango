# [051] Headers HTTP de segurança

**crítica:** NÃO
**Mundo:** infra
**Depende de:** —
**Spec:** specs/spec_irango_mvp.md (seguranca.md §11)

## Objetivo
Configurar headers de segurança em `next.config.ts` (anti-clickjacking, MIME sniffing, HSTS, Permissions-Policy) e CSP em report-only.

## Escopo
- [ ] Adicionar `headers()` em `next.config.ts` com X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, HSTS, Permissions-Policy
- [ ] `Content-Security-Policy-Report-Only` inicial (endurecer depois)

## Fora de escopo
Rate limiting (052).

## Reuso esperado
- `references/seguranca.md` §11 — lista de headers

## Segurança
- Defesa contra clickjacking/MIME sniffing/injeção; CSP começa em report-only (Next usa inline scripts)

## Critério de aceite
- [ ] Headers presentes na resposta (verificar via `curl -I`); app continua funcional
