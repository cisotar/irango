## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado:**

- `src/lib/actions/auth.ts` — `entrar(payload)` (login) e `cadastrar(payload)`. Entrypoint do rate limit de login. Já segue o contrato `safeParse → try/catch → console.error → retorno genérico`. O rate limit entra ANTES do `signInWithPassword`.
- `src/lib/actions/pedido.ts` — `criarPedido(payload)`. Entrypoint do rate limit de criar pedido. Rate limit entra logo no topo, antes do `createServiceClient()` e de qualquer I/O.
- `src/lib/actions/cupom.ts` — `validarCupom(entrada)`. Entrypoint do rate limit de validar cupom. Rate limit entra antes do `buscarCupomPorCodigo`.
- `src/lib/actions/frete.ts` — `calcularFreteAction(payload)`. Entrypoint do rate limit de preview de frete (finding BAIXA auditoria 067 — enumeração de bairro/CEP + abuso do ViaCEP server-side). Rate limit entra antes do `createClient()`.
- `src/lib/supabase/service.ts` — padrão `import "server-only"` no topo de módulo server-only. O novo `rateLimit.ts` segue o MESMO padrão (nunca pode ser importado de `'use client'`).
- `src/lib/utils/sentryBeforeSend.ts` — referência de util puro + testado isoladamente; o `rateLimit.ts` espelha o estilo (função focada, comentada, testável).
- `next/headers` (`cookies()` já usado async em `src/lib/supabase/server.ts`; `headers()` usado em `src/app/(painel)/painel/layout.tsx`) — fonte do IP do cliente dentro da Server Action. Em Next 16 é **async** (`await headers()`).
- **Env já provisionado:** `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` já existem em `.env.local` (sem prefixo `NEXT_PUBLIC_` — seguranca.md §7). **Falta** adicioná-las ao `.env.example` (documentação, sem valores).
- Contrato de erro de cada action (`{ ok:false, erro }`, `{ erro }`, `{ valido:false, motivo }`) — o retorno ao exceder o limite reusa o shape JÁ existente de cada action; nenhum shape novo.

**O que precisa ser criado (e por que não dá pra reusar):**

- `src/lib/utils/rateLimit.ts` — wrapper sobre `@upstash/ratelimit` + `@upstash/redis`. Não existe equivalente no codebase; é a peça central da issue. Server-only.

### Cenários

**Caminho Feliz:**
1. Cliente chama a Server Action (login / criar pedido / validar cupom / preview frete).
2. A action chama `verificarRateLimit(chave, identificador)` no topo, antes de qualquer I/O.
3. `identificador` = IP extraído de `await headers()` (`x-forwarded-for` → primeiro IP; fallback `x-real-ip`; fallback `"desconhecido"`).
4. Upstash responde `success: true` (dentro do limite) → a action prossegue normalmente.

**Casos de Borda:**
- **Limite excedido:** Upstash responde `success: false` → a action retorna o erro genérico no shape dela (`{ erro }` / `{ ok:false, erro }` / `{ valido:false, motivo:"invalido" }`), sem tocar no banco.
- **IP ausente** (sem `x-forwarded-for` nem `x-real-ip`, ex.: ambiente sem proxy): usa identificador `"desconhecido"`. Decisão: NÃO falhar aberto silenciosamente por IP — todos sem IP compartilham o mesmo balde (degrada para limite global desse caso, aceitável para MVP; documentar como débito).
- **Upstash indisponível / env ausente (rede, timeout, credencial faltando):** política **fail-open** — `verificarRateLimit` engole a exceção, loga `console.error` no servidor e retorna `permitido: true`. Justificativa: rate limit é defesa-em-profundidade contra abuso, NÃO um gate de valor/permissão (esses são RLS + recálculo no servidor, já garantidos). Derrubar login/checkout porque o Redis caiu é pior que perder a trava temporariamente. (Contraste deliberado com a reconciliação CEP que é fail-CLOSED, porque lá a falha reabriria vetor de subpagamento; aqui não há valor em jogo.)
- **Dev local sem Upstash:** sem as env vars, o wrapper desativa o rate limit (fail-open) e loga um aviso uma vez — o app roda normalmente.

**Tratamento de Erros:**
- Exceder o limite → mensagem genérica no shape de cada action (seguranca.md §14). Nunca revelar "rate limited" de forma que ajude o atacante a calibrar; mensagem é a mesma de erro comum da action.
- Falha do Upstash → `console.error("[rateLimit]", e)` no servidor, fail-open. Detalhe nunca vaza ao cliente.

### Schema de Banco

**Não toca o banco.** Nenhuma tabela, coluna, migration ou RLS. O estado de contagem vive no Upstash Redis (externo). Sem impacto em `supabase/migrations/`.

### Validação (zod)

Não há payload novo de usuário a validar — cada action JÁ valida seu payload com o schema zod existente (`schemaLogin`, `schemaPayloadPedido`, `validarCupomInput`, `schemaFretePreview`). O rate limit é ortogonal à validação de payload e roda ANTES dela ou logo após (decisão: rodar o rate limit ANTES do `safeParse` em criar pedido/login para que payload malformado de um atacante em loop também conte na trava por IP; nas demais, qualquer ordem serve — padronizar: rate limit primeiro).

### Recálculo no Servidor

Sem valor monetário nesta issue. O rate limit não calcula nem confia em valor — só conta requisições por IP. (O recálculo autoritativo de pedido/cupom/frete permanece intacto nas actions 014/013/072, fora do escopo desta issue.)

### Camada cliente ↔ servidor (enforcement)

| Invariante | Onde é garantida |
|-----------|------------------|
| Trava por IP nas 4 actions | **Server Action** — `verificarRateLimit` no topo de cada action; IP lido de `headers()` server-side, nunca do payload do cliente |
| Credenciais Upstash não vazam ao client | `import "server-only"` em `rateLimit.ts` (build quebra se importado em `'use client'`) + env SEM `NEXT_PUBLIC_` (seguranca.md §7). O cliente nunca recebe URL nem token do Redis |
| IP não é forjável pelo payload | IP derivado de `headers()` no servidor; o cliente não envia o identificador |

Nenhuma regra de valor/permissão depende do rate limit — RLS (INSERT público escopado por loja ativa) e recálculo no servidor seguem sendo o gate primário. O rate limit é camada de contenção de abuso/custo (seguranca.md §5, §12).

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/utils/rateLimit.ts` — `import "server-only"`. Exporta:
  - `LIMITES` (config central por chave): `login` 5/min, `criarPedido` 10/min, `validarCupom` 20/min, `fretedPreview` 20/min — sliding window.
  - `extrairIp(headers: Headers): string` — `x-forwarded-for`[0] → `x-real-ip` → `"desconhecido"` (função pura, testável sem rede).
  - `verificarRateLimit(chave: keyof typeof LIMITES, identificador: string): Promise<{ permitido: boolean }>` — instancia `Ratelimit` (lazy singleton por chave), fail-open total em erro/env ausente.
- `src/lib/utils/rateLimit.test.ts` — fase RED: `extrairIp` (puro), e `verificarRateLimit` com Upstash MOCKADO (excede → `permitido:false`; dentro → `true`; erro do Redis → fail-open `true`). Sem rede real.

**Modificar:**
- `src/lib/actions/auth.ts` — chamar rate limit `login` no topo de `entrar`, lendo IP de `headers()`. (Decisão de produto: aplicar também em `cadastrar`? Escopo da issue só cita login — NÃO ampliar; o comentário D6 da action já antecipa só login.)
- `src/lib/actions/pedido.ts` — rate limit `criarPedido` no topo de `criarPedido`.
- `src/lib/actions/cupom.ts` — rate limit `validarCupom` no topo de `validarCupom`.
- `src/lib/actions/frete.ts` — rate limit `fretedPreview` no topo de `calcularFreteAction`.
- `.env.example` — documentar `UPSTASH_REDIS_REST_URL=` e `UPSTASH_REDIS_REST_TOKEN=` (vazios, sem valor).
- `package.json` / lockfile — adicionar `@upstash/ratelimit` e `@upstash/redis`.

**NÃO tocar:**
- Lógica interna das actions (013/014/015/072) — fora de escopo, só prepend do guard.
- `components/ui/` (shadcn) — irrelevante.
- Headers HTTP (issue 051) — fora de escopo.
- Schema / migrations / RLS — não há mudança de banco.

### Dependências Externas

- `@upstash/ratelimit` (lib consolidada recomendada em seguranca.md §12) — https://github.com/upstash/ratelimit-js · doc: https://upstash.com/docs/redis/sdks/ratelimit-ts/overview
- `@upstash/redis` (REST client, funciona em Edge/Node serverless) — https://upstash.com/docs/redis/sdks/ts/overview
- Instalar via `npx`/`pnpm` conforme MEMORY (usar gerenciador do projeto). Free tier do Upstash cobre o MVP (custo previsível — princípio §9 do architecture.md).

### Ordem de Implementação

Issue **crítica** → começa pela fase RED.

1. **RED (`/tdd`):** escrever `src/lib/utils/rateLimit.test.ts` com Upstash mockado — exceder retorna `permitido:false`, dentro retorna `true`, erro do Redis faz fail-open, `extrairIp` resolve as 3 fontes. Confirmar que falha (módulo `rateLimit.ts` ainda não existe). Adicionar 1 teste por action garantindo que, com rate limit mockado retornando excedido, a action retorna o erro genérico SEM tocar no banco. + teste de não-vazamento: nenhuma env `UPSTASH_*` referenciada com prefixo `NEXT_PUBLIC_`.
2. **GREEN (`/execute`):**
   a. Instalar `@upstash/ratelimit` + `@upstash/redis`.
   b. Criar `rateLimit.ts` (server-only, fail-open, lazy singleton, `LIMITES` central).
   c. Prepend do guard nas 4 actions, lendo IP de `await headers()`.
   d. Documentar env no `.env.example`.
3. **Refatorar** se necessário (extrair helper comum de leitura de IP nas actions, se a repetição incomodar).
