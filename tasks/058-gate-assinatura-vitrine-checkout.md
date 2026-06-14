# [058] Gate de assinatura inativa na vitrine e no `criarPedido`

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 014, 035, 056
**Spec:** specs/spec_irango_mvp.md (Adendo — Ajuste Vitrine Pública; RN-A7)

## Objetivo
Impedir que uma loja com assinatura inválida opere para o cliente final: a vitrine renderiza "Loja temporariamente indisponível" e a Server Action `criarPedido` recusa o pedido. Enforcement server-side reusando a regra de carência da issue 056.

## Escopo
- [ ] **Emenda à 035 (vitrine)** — no Server Component `/loja/[slug]/page.tsx`, após buscar a loja, chamar `assinaturaPermiteAcesso` (056) com `assinatura_status` + `assinatura_fim_periodo`. Se inválida (`suspensa` ou fora da carência) → renderizar estado "Loja temporariamente indisponível" (sem catálogo, sem botão de pedido). Decisão preferencial: marcar indisponível (preserva slug/SEO), não `notFound()`
- [ ] **Emenda à 014 (`criarPedido`)** — além de loja aberta (RN-09), checar `assinaturaPermiteAcesso` no servidor antes de inserir. Se inválida → recusar com "Loja indisponível no momento". **ENFORCEMENT SERVER-SIDE OBRIGATÓRIO**
- [ ] Garantir que a query de loja da vitrine (023) já traga `assinatura_status` + `assinatura_fim_periodo` (ajustar select se necessário)

## Fora de escopo
Guard do painel do lojista (016). Webhook que escreve o status (057). Página de status do lojista (060).

## Reuso esperado
- `assinaturaPermiteAcesso` (056) — mesma regra do guard do painel, **não duplicar**
- `buscarLojaPorSlug` (023), `criarPedido` (014)

## Segurança
- Decisão de bloqueio sempre server-side (Server Component + Server Action), nunca flag de client (RN-A7)
- Mesma fonte de verdade do guard do painel — evita divergência entre painel e vitrine

## Critério de aceite
- [ ] (crítica) Teste vermelho: loja `suspensa` → vitrine indisponível e `criarPedido` recusa; loja `cancelada` fora da carência → recusa; loja `ativa`/`trial` válido/`inadimplente` na carência → vitrine normal e pedido aceito; recusa do `criarPedido` é server-side mesmo com payload forjado
