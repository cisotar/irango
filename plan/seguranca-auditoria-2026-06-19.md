# Auditoria de Segurança — iRango
**Data:** 2026-06-19  
**Escopo:** Dado sensível exposto no frontend + histórico git  
**Resultado:** 0 críticos · 0 altos · 0 médios · 2 aceitáveis por design

---

## Metodologia

Duas frentes em paralelo:

1. **Histórico git** — varredura de todos os 56 commits por arquivos `.env`, padrões de JWT (`eyJ…`), chaves de API, URLs com project ref e tokens hardcoded.
2. **Código frontend** — auditoria de `src/app/`, `src/components/`, `src/lib/`, `src/hooks/` cobrindo: secrets no client bundle, `NEXT_PUBLIC_*` indevidos, over-fetch em Server Actions, vazamento cross-tenant em rotas públicas, props Server → Client com dados internos, e `console.log` de PII.

---

## Resultado por vetor

| Vetor | Arquivo(s) relevante(s) | Status |
|-------|------------------------|--------|
| Secrets hardcoded no client | — | ✅ Limpo |
| `.env` no histórico git | `.env.example` | ✅ Só placeholders |
| `NEXT_PUBLIC_*` expondo secret | `src/lib/supabase/client.ts` | ✅ Só URL + anon key (legítimos) |
| `service_role` key acessível no client | `src/lib/supabase/service.ts` | ✅ Bloqueado por `import "server-only"` |
| `SUPABASE_SERVICE_ROLE_KEY` no histórico | — | ✅ Nunca commitada |
| `HOTMART_WEBHOOK_TOKEN` no histórico | — | ✅ Nunca commitada |
| `UPSTASH_REDIS_REST_TOKEN` no histórico | — | ✅ Nunca commitada |
| `GOOGLE_SECRET` / OAuth secret no histórico | — | ✅ Nunca commitada |
| Server Actions com over-fetch | `src/lib/actions/pedido.ts`, `cupom.ts` | ✅ Retornos enxutos |
| Vazamento cross-tenant em rota pública | `src/app/(publica)/loja/[slug]/page.tsx` | ✅ View projeta só colunas públicas |
| Confirmação de pedido sem autenticação | `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` | ✅ Exige `id + token_acesso` |
| `console.log` de PII ou secrets no client | componentes client | ✅ Só strings de erro genéricas |
| Props Server → Client com dados internos | `VitrineClient`, `PerfilClient` | ✅ `dono_id`, `hotmart_*` nunca chegam ao client |
| Project ref Supabase em lugar inesperado | `next.config.ts` | ✅ Só em CSP/image domains (esperado) |

---

## Análise detalhada

### 1. Histórico git

- **`.gitignore`** cobre `.env*` com exceção explícita de `.env.example`.
- Único arquivo de env rastreado: `.env.example` — todos os valores são placeholders (`sua-anon-public-key`, `SEU-PROJETO.supabase.co`, etc.).
- Varredura de todos os patches por `eyJ` (JWT), `service_role`, `HOTMART`, `UPSTASH`, `GOOGLE_SECRET`: **nenhum hit com valor real**.
- Project ref `gdlegxatwylhkjcrusyk` aparece só em `next.config.ts` (CSP + `images.remotePatterns`) — necessário para bloquear origens não autorizadas, não é secret.

### 2. `service_role` key

`src/lib/supabase/service.ts` é o único arquivo que lê `SUPABASE_SERVICE_ROLE_KEY`. Possui `import "server-only"` na linha 1: o build do Next.js quebra com erro de compilação se qualquer módulo `'use client'` o importar, direta ou transitivamente.

Importadores verificados — nenhum tem `'use client'`:

| Arquivo importador | Tipo |
|-------------------|------|
| `src/lib/actions/auth.ts` | Server Action |
| `src/lib/actions/cupom.ts` | Server Action |
| `src/lib/actions/frete.ts` | Server Action |
| `src/lib/actions/loja.ts` | Server Action |
| `src/lib/actions/pedido.ts` | Server Action |
| `src/lib/actions/cupomPreview.ts` | Server Action |
| `src/lib/auth/reconciliarPosConfirmacao.ts` | Server-only util |
| `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` | Server Component |
| `src/app/(painel)/painel/layout.tsx` | Server Component |
| `src/app/api/webhooks/hotmart/route.ts` | Route Handler |

### 3. Variáveis `NEXT_PUBLIC_*`

Apenas duas existem no projeto:

| Variável | Valor público por design | Motivo |
|----------|--------------------------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | Supabase anon client exige URL no browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Chave pública com RLS protegendo os dados |

`UPSTASH_REDIS_REST_URL/TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `HOTMART_WEBHOOK_TOKEN`, `SENTRY_AUTH_TOKEN`, `NOMINATIM_USER_AGENT`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` — todos **sem** prefixo `NEXT_PUBLIC_`.  
Existe inclusive um teste-guarda em `src/lib/utils/rateLimit.test.ts:198` que falha se o módulo referenciar `NEXT_PUBLIC_UPSTASH_*`.

### 4. Server Actions — over-fetch

| Action | Retorno atual | Dado protegido que não vaza |
|--------|--------------|----------------------------|
| `criarPedido` (`pedido.ts:336`) | `{ pedidoId, token_acesso }` ou erro genérico | Dados internos do pedido, `dono_id`, preço de custo |
| `validarCupom` (`cupom.ts:178`) | `{ valido, desconto, motivo }` | Código do cupom inteiro, estratégia comercial |

### 5. Vitrine pública — view `vitrine_lojas`

A view projeta só colunas públicas. **Ausente da projeção:**

- `dono_id`
- `hotmart_subscriber_code`, `hotmart_*`
- `consentimento_*`
- `latitude`, `longitude` (coordenadas precisas da loja)

A migration `20260614005000_vitrine_lojas_assinatura.sql` expõe `assinatura_status` e `assinatura_fim_periodo` — ver seção de itens aceitáveis por design abaixo.

### 6. Confirmação de pedido

`src/app/(publica)/loja/[slug]/confirmacao/page.tsx:125` — lê pedido via `buscarPedidoPorToken(id, token_acesso)` com service_role. Token ausente ou incorreto → `redirect` imediato, sem vazar dado. Token correto prova posse do pedido (modelo de acesso por token, sem sessão obrigatória).

---

## Itens aceitáveis por design

Dois pontos foram avaliados e **não constituem vulnerabilidade**:

### A. Chave Pix no checkout

`src/app/(publica)/loja/[slug]/pedido/page.tsx` hidrata a chave Pix do lojista para o cliente pagar. A tabela `formas_pagamento` tem `SELECT` público via RLS (policy `vitrine_publica_formas_pagamento`, migration `20260614002000_rls_catalogo.sql:193`), gated por `loja_esta_ativa`. A chave Pix é o meio de pagamento — é informação **intencionalmente pública**.

### B. `assinatura_status` na view pública

A view `vitrine_lojas` expõe `assinatura_status` e `assinatura_fim_periodo`. Isso revela se a loja está ativa, o que a própria vitrine já comunica visualmente. Não inclui plano, valor, email, código Hotmart ou `dono_id`. Exposição documentada e deliberada.

---

## Recomendação (não urgente)

Adicionar testes de regressão que verifiquem as colunas projetadas pela view `vitrine_lojas`. Se uma migration futura relaxar a RLS na tabela base e acidentalmente expor `dono_id` ou `hotmart_*` na view, o teste captura antes do deploy.

**Prioridade:** baixa. Não bloqueia nenhum deploy atual.

---

## Conclusão

Nenhuma ação corretiva necessária. A base de código segue os princípios de `seguranca.md` §3/§7/§19: `server-only` nos módulos críticos, queries escopadas manualmente onde RLS é bypassado, retornos enxutos nas Server Actions, view pública com projeção mínima, e histórico git sem secrets reais.
