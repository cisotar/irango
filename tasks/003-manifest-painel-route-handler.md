# [003] Route Handler do manifest do painel (isolamento por sessão)

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** 001
**Spec:** specs/pwa-vitrine-painel.md

## Objetivo
Gerar o manifest do painel em `/painel/manifest.webmanifest` nomeado pela loja do **lojista autenticado**, derivando a loja exclusivamente da sessão (cookie) — nunca de query string.

## Por que é crítica
Embora não toque dinheiro, este handler é um vetor de **vazamento de tenant**: um manifest do painel jamais pode retornar nome/logo de loja de outro `auth.uid()`. Um bug aqui exporia dado de outra loja. Logo, RED-first.

## Escopo
- [ ] Criar `src/lib/utils/manifestPainel.ts` — função PURA `montarManifestPainel(loja)` (builder, sem I/O)
- [ ] Criar `src/app/(painel)/painel/manifest.webmanifest/route.ts` — Route Handler `GET`, `export const runtime = "nodejs"`
- [ ] Resolver a loja com `buscarLojaDoDono(client)` usando `createClient()` server (`@supabase/ssr`, cookies) — RLS `lojas_leitura_propria` escopa `auth.uid() = dono_id`
- [ ] **Nunca** ler `loja_id`/`slug` do query string para escolher a loja — sempre da sessão
- [ ] Sem sessão → responder 401, sem vazar dado de loja
- [ ] Dono sem loja → fallback genérico iRango Painel (sem nome de loja)
- [ ] Montar o manifest:
  - `name` = `"<loja.nome> · Painel"`, `short_name` = `"Painel"`
  - `start_url` = `/painel`, `scope` = `/painel`, `id` = `/painel`
  - `display` = `standalone`
  - `icons`: `loja.logo_url` quando presente e `https://`; senão `/icons/painel-{192,512}.png`
- [ ] `Content-Type: application/manifest+json`
- [ ] `Cache-Control: private, no-store` (não cachear por proxy/SW compartilhado)
- [ ] Validar `https://` em `logo_url` antes de usar como ícone

## Fora de escopo
- Manifest da vitrine (issue 002)
- Metadata `<link rel="manifest">` no layout do painel (issue 005)

## Reuso esperado
- `buscarLojaDoDono` em `src/lib/supabase/queries/lojas.ts` — reusar, não recriar
- `createClient()` server de `src/lib/supabase/server.ts`
- Ícones de `public/icons/painel-*.png` (issue 001)

## Segurança
- RN-2: loja derivada SÓ da sessão (RLS); nunca de query string
- `Cache-Control: private, no-store` obrigatório
- Sem `service_role`. Sem valor monetário.

## Critério de aceite
- [ ] (RED) Teste falho antes do código: requisição autenticada da loja A nunca retorna nome/logo da loja B, mesmo com `?loja_id=<B>`/`?slug=<B>` no query string
- [ ] Lojista autenticado → manifest com `name` = `"<nome da própria loja> · Painel"`
- [ ] Requisição sem sessão → 401 (ou genérico sem nome de loja), sem dado de loja
- [ ] Dono com `logo_url` → ícones usam a `logo_url`; sem `logo_url` → `/icons/painel-{192,512}.png`
- [ ] Resposta inclui `Cache-Control: private, no-store`
- [ ] Teste vermelho escrito e depois verde

---

## Plano Técnico

### Diagnóstico

**Causa raiz.** Não há bug pré-existente — é uma feature nova. A "causa raiz" aqui é o **invariante de isolamento de tenant** que precisa nascer correto: a única autoridade legítima para escolher *qual loja* nomeia o manifest do painel é a **sessão (cookie httpOnly via `@supabase/ssr`)**, jamais um parâmetro de entrada controlável pelo cliente. Qualquer caminho que aceite `loja_id`/`slug`/`nome` da URL ou do corpo reabre o vazamento. O isolamento real é entregue por **RLS** (`lojas_leitura_propria`, `auth.uid() = dono_id`): `buscarLojaDoDono` faz `from('lojas').select('*').maybeSingle()` **sem filtro de id** — o filtro é a própria policy, no banco. Isso é deliberado e é o coração do invariante: como o `WHERE` está na RLS e não no código, não existe parâmetro de aplicação que possa apontar para outra loja.

**Por que é complexo.**
1. Atravessa 3 camadas (RLS no banco → I/O server-side com cookies → resposta HTTP com headers de cache) e o erro em qualquer uma vaza dado de tenant.
2. Contrato de saída é um formato externo padronizado (W3C Web App Manifest) consumido pelo navegador — `Content-Type`, shape de `icons` e `Cache-Control` têm semântica de segurança (um `Cache-Control` errado faz um proxy/SW servir o manifest da loja A para o dono da loja B).
3. É um vetor de segurança sem dinheiro: a tentação é tratá-lo como trivial ("é só um JSON"), mas é exatamente onde um isolamento mal-feito passa despercebido. Por isso RED-first.
4. Route Handler do App Router tem armadilhas de caching default — precisa garantir que a resposta nunca seja estaticamente otimizada/cacheada pelo Next.

### Mapa de Impacto

```
GET /painel/manifest.webmanifest
  └─ route.ts (NOVO)  [Server — Route Handler, runtime nodejs]
       ├─ createClient()                      src/lib/supabase/server.ts   [reuso — cookies httpOnly]
       │     └─ supabase.auth.getUser()       [Server — valida JWT contra o Auth server]
       ├─ buscarLojaDoDono(client)            src/lib/supabase/queries/lojas.ts [reuso]
       │     └─ from('lojas').maybeSingle()   → tabela lojas
       │           └─ RLS lojas_leitura_propria  [banco — AUTORITATIVO: auth.uid() = dono_id]
       └─ montarManifestPainel(loja)          src/lib/utils/manifestPainel.ts (NOVO) [PURA, sem I/O]
             └─ Response(json, headers)        → navegador
                   ├─ Content-Type: application/manifest+json
                   └─ Cache-Control: private, no-store   [não cachear por proxy/SW]

Quem mais toca a tabela `lojas` por sessão (contexto, NÃO alterar):
  src/app/(painel)/painel/layout.tsx → buscarLojaDoDono(supabase)  [mesmo padrão de resolução]
```

**Onde o invariante de isolamento é garantido (mapa cliente ↔ servidor):**
```
"Qual loja nomeia o manifest?"
  ├── query string (?loja_id / ?slug)   — [cliente — IGNORADO POR DESIGN, nunca lido]
  ├── route.ts                            — [servidor — só repassa o client; NÃO escolhe loja]
  └── RLS lojas_leitura_propria           — [banco — FONTE ÚNICA DE VERDADE: auth.uid() = dono_id]
```
A assimetria desejada é total: o cliente **não tem** nenhum canal para influenciar a escolha da loja. O `route.ts` não recebe `id` algum para passar a `buscarLojaDoDono` — a query não tem `.eq('id', …)`. Isso é o que torna o vetor `?loja_id=<B>` inofensivo: não há onde esse valor entrar.

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/supabase/queries/lojas.ts` | `buscarLojaDoDono(client)` já resolve a loja do dono via RLS, sem filtro de id; retorna `LojaCompleta \| null` | **Não muda.** Reuso integral. É o componente que carrega o invariante. |
| `src/lib/supabase/server.ts` | `createClient()` cria o client `@supabase/ssr` com cookies | **Não muda.** Reuso integral. |
| `src/app/(painel)/painel/layout.tsx` | Guard de auth do painel (`getUser` + `buscarLojaDoDono` + `decidirAcessoPainel`) | **Não muda.** Referência do padrão de resolução. Nota: o Route Handler de manifest **não** passa pelo guard do layout (route handlers não herdam layout) — por isso o handler refaz a checagem de sessão localmente. |
| `src/lib/utils/acessoPainel.ts` | Padrão de "função pura + I/O fora" (`decidirAcessoPainel`) | **Não muda.** Molde arquitetural a seguir para `montarManifestPainel`. |
| `public/icons/painel-{192,512}.png` | Ícones de fallback (issue 001) | **Não muda.** Já existem (`apple-touch-icon.png`, `painel-192.png`, `painel-512.png` confirmados em `public/icons/`). |
| `src/app/api/webhooks/hotmart/route.ts` | Route Handler `runtime="nodejs"`, `Response.json(..., { status })` | **Não muda.** Referência de convenção de Route Handler. |
| `next.config.ts` | CSP/headers globais; `img-src 'self' https: data: blob:` | **Não muda.** `logo_url` https já permitida pela CSP de imagem. |

### Decisões de Design

**D1 — Pure builder em `lib/utils/` vs. montar o JSON inline no `route.ts`.**
- (a) **Função pura `montarManifestPainel(loja)` em `src/lib/utils/manifestPainel.ts`.** Prós: testável sem mockar Request/Response/cookies (o teste RED do isolamento e os testes de shape rodam sobre a função pura, rápido, determinístico); segue o padrão já consagrado `acessoPainel.ts`/`calcularFrete.ts` (regra pura separada do I/O); o `route.ts` fica fino (I/O + headers). Contras: um arquivo a mais.
- (b) Montar o objeto manifest dentro do handler. Prós: um arquivo. Contras: para testar o shape/escolha de ícone/truncamento eu teria que exercitar o handler inteiro com mocks de `cookies()`/`getUser`, acoplando teste de regra a teste de I/O; foge do padrão do projeto.
- **Escolhida: (a).** O projeto inteiro separa regra pura de I/O (architecture.md §8 DRY; `acessoPainel.ts` é o precedente exato). O builder recebe `LojaCompleta | null` e devolve o objeto manifest — o `null` (dono sem loja) é tratado lá dentro como fallback genérico. O `route.ts` nunca passa nada além da loja já resolvida pela sessão.

**D2 — Sem sessão: 401 vs. manifest genérico.**
- (a) **`401` com corpo mínimo, sem dado de loja.** Prós: semanticamente correto (recurso do painel exige auth); zero superfície de vazamento; alinhado ao spec ("responde 401 … sem vazar dado de loja") e ao §14 (mensagem genérica). Contras: navegador pode logar erro de manifest no console — irrelevante (rota só é buscada quando o dono já está logado no `/painel`, que está atrás do guard).
- (b) Manifest genérico iRango Painel mesmo sem sessão. Prós: nunca um 401 visível. Contras: serve um manifest "instalável" para um anônimo que bateu direto na URL — ruído sem ganho; mistura o caso "sem sessão" com o caso "dono sem loja", apagando a distinção de segurança.
- **Escolhida: (a) 401.** Sem sessão → `Response(null, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })`. O `no-store` vai **também** no 401 para evitar que um proxy cacheie a negação e a sirva no lugar do manifest real após o login. Distinção explícita: **sem sessão ⇒ 401**; **com sessão, sem loja ⇒ 200 + manifest genérico** (D3).

**D3 — Dono autenticado sem loja: fallback genérico (não 401).**
- O dono tem sessão válida porém `buscarLojaDoDono` retorna `null` (user órfão; cf. caso "onboarding" do guard). Retornar 401 seria mentir sobre a auth. **Escolhida:** `200` com manifest genérico — `name = "iRango · Painel"`, `short_name = "Painel"`, ícones de fallback `/icons/painel-{192,512}.png`. Não vaza loja alguma (não há loja). `montarManifestPainel(null)` produz exatamente esse objeto.

**D4 — Validação de `logo_url` (defesa em profundidade).**
- O CHECK do banco já restringe `logo_url` a `NULL OR LIKE 'https://%'` (schema/§RN-3). Ainda assim, **revalidar `https://` no builder** antes de emitir como ícone (`seguranca.md` §15 — `logo_url` é preenchida pelo lojista, não confiável; defesa em profundidade contra um CHECK relaxado no futuro). Implementação: `typeof logo === 'string' && logo.startsWith('https://')`; senão cai no fallback de ícones. Como o output é JSON (`JSON.stringify` escapa), não há vetor de injeção no `name`.

**D5 — `runtime = "nodejs"` + impedir cache estático do Next.**
- Route Handler `GET` sem parâmetros dinâmicos pode ser estaticamente otimizado pelo App Router → serviria um manifest "congelado" e potencialmente de outro tenant. `export const runtime = "nodejs"` (consistência com hotmart; `@supabase/ssr` lê `cookies()`, que já força dinamismo) **e** `export const dynamic = "force-dynamic"` para garantir avaliação por request. O uso de `cookies()` já marca a rota como dinâmica, mas declarar `force-dynamic` é explícito e à prova de refactor. Decisão: declarar ambos.

**D6 — `short_name`.** Spec fixa `short_name = "Painel"` (constante, ≤ 12 chars). **Não** truncar `loja.nome` aqui (diferente da vitrine). Logo, RN-5 não exige util de truncamento neste handler — nenhum primitivo novo de string. (Confirma "não reinventar a roda": nada a criar.)

### Cenários

| Cenário | Entrada | Resposta |
|---|---|---|
| Caminho feliz | Dono da loja A logado, loja A tem `nome="Pizzaria da Vovó"`, `logo_url="https://…/a.png"` | `200`, `name="Pizzaria da Vovó · Painel"`, `icons` apontam para a `logo_url` |
| **Isolamento (vetor)** | Dono da loja A logado, URL `?loja_id=<B>&slug=loja-b` | `200`, `name="Pizzaria da Vovó · Painel"` (da **própria** loja A). O query string é ignorado — `buscarLojaDoDono` não recebe id. Nunca aparece nome/logo de B. |
| Dono sem `logo_url` | Dono logado, `logo_url=null` | `200`, ícones `/icons/painel-{192,512}.png` |
| **Sem sessão** | Nenhum cookie / JWT inválido (`getUser` → `user=null`) | `401`, sem corpo de loja, `Cache-Control: private, no-store` |
| **Sessão sem loja** (órfão) | `getUser` ok, `buscarLojaDoDono` → `null` | `200`, manifest genérico `"iRango · Painel"`, ícones de fallback. Nenhuma loja vazada. |
| `logo_url` malformada | (improvável; CHECK barra) `logo_url="http://x"` ou `"javascript:…"` | builder rejeita (não começa com `https://`) → cai no fallback de ícones |
| Erro de I/O | `buscarLojaDoDono` lança (PostgREST/conexão) | `catch` → `console.error("[manifestPainel]", e)` (sem PII/detalhe ao cliente, §14) → `500` genérico com `Cache-Control: private, no-store` |
| Race / duplo GET | Navegador busca o manifest em paralelo | Idempotente e stateless; sem efeito colateral. `no-store` evita cache cruzado entre sessões. |
| Sessão expirada | `getUser` retorna `null` (JWT expirado) | Trata como "sem sessão" → `401`. (O middleware refresca em navegação; aqui basta fail-closed.) |

Tratamento de erro: usuário/navegador recebe status genérico (401/500) sem detalhe; o stack/erro real só no `console.error` do servidor (`seguranca.md` §14). Nenhum `error.message` do Postgres no corpo.

### Contratos de Dados

**Schema:** nenhuma migration, nenhuma tabela, nenhuma coluna, **nenhuma RLS nova**. Reuso integral de `lojas` + policy `lojas_leitura_propria` (já em produção). `supabase gen types` **não** roda (schema inalterado).

**Shape de saída (`montarManifestPainel`):**
```ts
// src/lib/utils/manifestPainel.ts
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

// Subconjunto do W3C Web App Manifest que emitimos. Tipado localmente (não há
// type oficial empacotado; o objeto é serializado como JSON application/manifest+json).
export interface ManifestPainel {
  name: string;
  short_name: "Painel";
  start_url: "/painel";
  scope: "/painel";
  id: "/painel";
  display: "standalone";
  icons: { src: string; sizes: string; type?: string }[];
}

const ICONES_FALLBACK: ManifestPainel["icons"] = [
  { src: "/icons/painel-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icons/painel-512.png", sizes: "512x512", type: "image/png" },
];

function iconesDaLoja(logoUrl: string | null): ManifestPainel["icons"] {
  if (typeof logoUrl === "string" && logoUrl.startsWith("https://")) {
    return [
      { src: logoUrl, sizes: "192x192" },
      { src: logoUrl, sizes: "512x512" },
    ];
  }
  return ICONES_FALLBACK;
}

/**
 * PURA (sem I/O). `loja` JÁ resolvida pela sessão (RLS) no Route Handler.
 * `null` = dono autenticado sem loja → manifest genérico, sem nome de tenant.
 * NUNCA recebe id/slug do cliente: quem escolhe a loja é a RLS, não esta função.
 */
export function montarManifestPainel(loja: LojaCompleta | null): ManifestPainel {
  const base = {
    short_name: "Painel",
    start_url: "/painel",
    scope: "/painel",
    id: "/painel",
    display: "standalone",
  } as const;
  if (loja === null) {
    return { ...base, name: "iRango · Painel", icons: ICONES_FALLBACK };
  }
  return {
    ...base,
    name: `${loja.nome} · Painel`,
    icons: iconesDaLoja(loja.logo_url),
  };
}
```

**Route Handler (`route.ts`):**
```ts
// src/app/(painel)/painel/manifest.webmanifest/route.ts
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { montarManifestPainel } from "@/lib/utils/manifestPainel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // nunca otimizar estaticamente (D5)

const NO_STORE = "private, no-store";

export async function GET(): Promise<Response> {
  // IMPORTANTE: a assinatura NÃO recebe Request — não há de onde ler query string.
  // A loja é derivada SÓ da sessão (cookie). RN-2.
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user === null) {
      // Sem sessão: 401, sem dado de loja, sem cache (D2).
      return new Response(null, { status: 401, headers: { "Cache-Control": NO_STORE } });
    }
    const loja = await buscarLojaDoDono(supabase); // RLS escopa auth.uid()=dono_id
    const manifest = montarManifestPainel(loja);   // loja null → genérico (D3)
    return Response.json(manifest, {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": NO_STORE,
      },
    });
  } catch (e) {
    console.error("[manifestPainel]", e); // detalhe só no servidor (§14)
    return new Response(null, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
```
> Nota: `Response.json` seta `content-type: application/json` por padrão; o handler **sobrescreve** explicitamente para `application/manifest+json` no objeto `headers` passado (o último vence). Verificar no teste que o header final é `application/manifest+json`.

### Recálculo no Servidor
Não se aplica — **sem valor monetário** (spec §Segurança). O único valor autoritativo aqui é *qual loja*, garantido pela RLS, não por recálculo numérico.

### Resposta às perguntas do orquestrador

1. **Como garantir que `buscarLojaDoDono` derive a loja SÓ da sessão (sem query string)?** A função já faz `from('lojas').select('*').maybeSingle()` **sem nenhum `.eq('id', …)`**; o `WHERE auth.uid() = dono_id` vive na policy `lojas_leitura_propria`, no banco. O Route Handler reforça isso na borda da aplicação: a assinatura do `GET` **não recebe `Request`/`params`**, logo não há sequer um canal para ler `?loja_id`/`?slug`. Garantia em duas camadas — **RLS (autoritativa)** + **ausência de canal de input** no handler.

2. **Se `getUser()` retorna `null` → 401 ou genérico?** **401** (D2), com `Cache-Control: private, no-store`, corpo vazio, nenhum dado de loja. Distinto de "sessão sem loja".

3. **Se o dono tem sessão mas `buscarLojaDoDono` retorna `null` (sem loja)?** **200 + manifest genérico** `"iRango · Painel"` com ícones de fallback (D3). `montarManifestPainel(null)` cobre isso. Não vaza loja (não existe) e não mente sobre auth (a sessão é válida).

4. **Teste RED-first — pglite ou função pura?** **Dois níveis, ambos RED-first, sem pglite:**
   - **Nível 1 (função pura — prova o shape e o fallback):** `manifestPainel.test.ts` exercita `montarManifestPainel` direto. Rápido, determinístico, sem mock de I/O. Prova: nome/ícone da loja própria, fallback de ícone sem `logo_url`, rejeição de `logo_url` não-`https://`, genérico em `null`.
   - **Nível 2 (handler — prova o invariante de isolamento):** `route.test.ts` mocka `@/lib/supabase/server` (`createClient`) e `@/lib/supabase/queries/lojas` (`buscarLojaDoDono`) — **exatamente** o padrão de `src/lib/actions/loja.test.ts` (linhas 111–148). O mock de `buscarLojaDoDono` é configurado para devolver **só a loja A** independentemente de qualquer coisa. O teste invoca `GET()` (o handler não recebe Request) e, num caso adversarial, monta um cenário em que um `Request` com `?loja_id=<B>` *existisse* — e prova que **o id de B nunca chega a nenhuma query** (asserta que `buscarLojaDoDono` foi chamado sem argumento de id e que o `name` resultante é o da loja A). Por que **não** pglite aqui: o invariante a provar é "a aplicação nunca passa input do cliente para a escolha da loja"; isso é provável com mock (assertando *o que o handler chama*). A RLS em si (`auth.uid()=dono_id`) já é coberta por testes pglite existentes da camada de queries (`lojas.test.ts`) — não reprovar a RLS aqui.
   - **O que especificamente testar (RED, todos falham antes do código):**
     - `montarManifestPainel({nome:"Loja A", logo_url:"https://a.png"}).name === "Loja A · Painel"`
     - ícones = `[{src:"https://a.png",…}×2]` quando `logo_url` https
     - ícones = `/icons/painel-{192,512}.png` quando `logo_url=null`
     - ícones = fallback quando `logo_url="http://x"` (rejeita não-https)
     - `montarManifestPainel(null).name === "iRango · Painel"` e ícones de fallback
     - `GET()` com `getUser→user=null` ⇒ status `401`, sem corpo de loja, `Cache-Control: private, no-store`
     - `GET()` com `getUser→user`, `buscarLojaDoDono→lojaA` ⇒ status `200`, `Content-Type: application/manifest+json`, `Cache-Control: private, no-store`, `name` = loja A
     - **(isolamento)** `buscarLojaDoDono` foi invocado **sem** nenhum `loja_id`/`slug`; o corpo nunca contém o nome/logo da loja B mockada como "outra loja"
     - `GET()` com `buscarLojaDoDono→null` (órfão) ⇒ `200`, `name="iRango · Painel"`
     - `buscarLojaDoDono` lança ⇒ `500`, sem detalhe de erro no corpo
   - **Como o RED falha de verdade:** criar `route.ts` e `manifestPainel.ts` como **stubs mínimos de assinatura** que `throw new Error("TODO: GREEN")` (padrão `lojas.test.ts`/`loja.test.ts`), para que a suíte caia na **asserção** e não num erro de import/type-check que mascara tudo.

5. **`Cache-Control: private, no-store` é suficiente? Precisa de mais headers?** `private, no-store` é o núcleo e é suficiente para o invariante de cache (proíbe cache compartilhado por proxy/CDN/SW e cache privado do browser). Reforços recomendados, baixo custo:
   - **`Content-Type: application/manifest+json`** (obrigatório pelo spec e por instalabilidade).
   - **`Vary: Cookie`** — defesa em profundidade: sinaliza a qualquer cache intermediário que a resposta varia por cookie de sessão (impede servir a resposta da sessão A para a sessão B mesmo que `no-store` seja ignorado por um proxy mal-configurado). Recomendado adicionar.
   - **Não** adicionar `ETag`/`Last-Modified` (induziriam revalidação cacheável — contraproducente com `no-store`).
   - Headers globais de segurança (`X-Content-Type-Options: nosniff`, etc.) já vêm de `next.config.ts` — não duplicar no handler.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/utils/manifestPainel.ts` — `montarManifestPainel(loja: LojaCompleta | null): ManifestPainel` (pura) + `interface ManifestPainel` + `iconesDaLoja` (helper interno) + `ICONES_FALLBACK`.
- `src/lib/utils/manifestPainel.test.ts` — testes da função pura (Nível 1).
- `src/app/(painel)/painel/manifest.webmanifest/route.ts` — Route Handler `GET`, `runtime="nodejs"`, `dynamic="force-dynamic"`.
- `src/app/(painel)/painel/manifest.webmanifest/route.test.ts` — testes do handler com mocks de `createClient`/`buscarLojaDoDono` (Nível 2, isolamento).

**NÃO tocar (com motivo):**
- `src/lib/supabase/queries/lojas.ts` — `buscarLojaDoDono` já é correta e é o portador do invariante; recriar/alterar seria reinventar a roda e arriscar o isolamento.
- `src/lib/supabase/server.ts` — `createClient()` reuso direto.
- `src/app/(painel)/painel/layout.tsx` — guard de página, independente do route handler (route handlers não herdam layout); alterá-lo está fora de escopo (issue 005 cuida do `<link rel="manifest">`).
- `next.config.ts` / CSP — `img-src https:` já permite `logo_url`; sem mudança.
- Migrations / RLS — nada de schema (spec §Modelos de Dados).

### Dependências Externas
Nenhuma nova. Tudo já no `package.json`: `@supabase/ssr@^0.12.0`, `@supabase/supabase-js@^2.108.1`, `next@16.2.9`, `vitest`. Sem lib de manifest (objeto trivial; W3C Web App Manifest — https://developer.mozilla.org/en-US/docs/Web/Manifest). Route Handlers Next 16: https://nextjs.org/docs/app/building-your-application/routing/route-handlers (`dynamic`/`runtime` segments).

### Ordem de Implementação (estrita)

1. **RED — função pura (`tdd`):** escrever `manifestPainel.test.ts` + stub `manifestPainel.ts` (`throw "TODO: GREEN"`). Rodar `pnpm test` → vermelho real na asserção. *Dependência:* o builder é a unidade base, sem I/O — fixá-lo primeiro trava o contrato de shape.
2. **RED — handler/isolamento (`tdd`):** escrever `route.test.ts` com mocks de `createClient`/`buscarLojaDoDono` + stub `route.ts` (`GET` que lança). Rodar → vermelho. *Dependência:* o teste de isolamento precisa do nome do módulo/handler já fixado.
3. **GREEN — builder (`executar`):** implementar `montarManifestPainel` até o Nível 1 ficar verde.
4. **GREEN — handler (`executar`):** implementar `route.ts` (sessão → `buscarLojaDoDono` → builder → headers) até o Nível 2 ficar verde.
5. **`next build`** — confirmar que a rota não vira estática e que nenhuma `const` exportada não-permitida quebra o build (MEMORY: export `'use server'` não se aplica aqui, mas `next build` é o gate real de Route Handlers/segments).
6. **`auditar`** — revisão de isolamento de tenant (vetor `?loja_id`) e de cache antes de fechar.

### Checklist de Validação Pós-Implementação
- [ ] `pnpm build` sem warnings novos; a rota aparece como dinâmica (ƒ), não estática (○)
- [ ] `pnpm test` verde (Nível 1 + Nível 2), tendo sido vermelho antes
- [ ] Política/Isolamento testado: requisição com `?loja_id=<B>`/`?slug=<B>` retorna o nome da **própria** loja A; `buscarLojaDoDono` invocado sem id do cliente
- [ ] Sem sessão ⇒ `401`; sessão sem loja ⇒ `200` genérico `"iRango · Painel"`; nenhum vaza loja alheia
- [ ] Resposta inclui `Cache-Control: private, no-store` (no 200, no 401 e no 500) e `Content-Type: application/manifest+json` (no 200)
- [ ] `logo_url` não-`https://` cai no fallback de ícones (defesa em profundidade §15)
- [ ] Sem `service_role`, sem secret no corpo, sem PII; erros só no `console.error` (§14)

---

## Fase RED (TDD) — vermelho comprovado

**Arquivos de teste criados:**
- `src/lib/utils/manifestPainel.test.ts` (Nível 1 — função pura, 5 casos)
- `src/app/(painel)/painel/manifest.webmanifest/route.test.ts` (Nível 2 — handler/isolamento, 5 casos)

**Stubs mínimos criados (lançam `TODO: GREEN` — corpo é da fase GREEN):**
- `src/lib/utils/manifestPainel.ts` — `interface ManifestPainel` + `montarManifestPainel(loja): ManifestPainel` (assinatura fixada; corpo `throw`)
- `src/app/(painel)/painel/manifest.webmanifest/route.ts` — `export const runtime/dynamic` + `GET(): Promise<Response>` (sem `Request` — sem canal p/ query string; corpo `throw`)

**Comando:**
```
npx vitest run src/lib/utils/manifestPainel.test.ts "src/app/(painel)/painel/manifest.webmanifest/route.test.ts" --reporter=verbose
```

**Saída real (RED):**
```
 × manifestPainel.test.ts > caso 1: loja com logo_url https → name = '<nome> · Painel'…
   → TODO: GREEN
 × manifestPainel.test.ts > caso 2: loja sem logo_url (null) → ícones de fallback…
   → TODO: GREEN
 × manifestPainel.test.ts > caso 3: logo_url com http:// (inseguro) → rejeita e usa fallback…
   → TODO: GREEN
 × manifestPainel.test.ts > caso 4: loja = null → name = 'iRango · Painel' e ícones de fallback
   → TODO: GREEN
 × manifestPainel.test.ts > caso 5: start_url, scope, id e display são constantes
   → TODO: GREEN
 × route.test.ts > dono autenticado → 200, Content-Type application/manifest+json…
   → TODO: GREEN
 × route.test.ts > ISOLAMENTO: buscarLojaDoDono chamado SEM loja_id/slug; corpo nunca traz loja B
   → TODO: GREEN
 × route.test.ts > sem sessão (getUser → user null) → 401, sem corpo de loja…
   → TODO: GREEN
 × route.test.ts > sessão sem loja (órfão) → 200 genérico 'iRango · Painel'
   → TODO: GREEN
 × route.test.ts > erro de I/O (buscarLojaDoDono lança) → 500 genérico, sem detalhe no corpo
   → TODO: GREEN

 Test Files  2 failed (2)
      Tests  10 failed (10)
```
Todos os 10 caem na execução do alvo (`throw "TODO: GREEN"` do stub), não em erro de import/type-check — RED por comportamento, não por acidente de compilação. Confirmado: nenhum passa antes da implementação.

**Contrato para a fase GREEN (`executar`):**

1. `src/lib/utils/manifestPainel.ts` — implementar `montarManifestPainel(loja: LojaCompleta | null): ManifestPainel` (pura, sem I/O). Casos que precisam passar:
   - loja c/ `logo_url` `https://` → `name = "<nome> · Painel"`, `short_name = "Painel"`, ícones = a `logo_url` (2 tamanhos)
   - `logo_url = null` → ícones de fallback `/icons/painel-{192,512}.png` (`type: "image/png"`)
   - `logo_url` `http://` (ou não-https) → rejeita, usa fallback (defesa em profundidade §15)
   - `loja = null` → `name = "iRango · Painel"` + fallback
   - `start_url`/`scope`/`id` = `/painel`, `display` = `standalone` sempre

2. `src/app/(painel)/painel/manifest.webmanifest/route.ts` — implementar `GET(): Promise<Response>` (sem `Request`). Casos:
   - autenticado + loja → `200`, `Content-Type: application/manifest+json`, `Cache-Control: private, no-store`, `name` da própria loja
   - **isolamento**: `buscarLojaDoDono` invocado com **um único argumento** (o client), nunca id/slug; nada de loja B vaza no corpo
   - `getUser → user null` → `401`, `Cache-Control: private, no-store`, sem dado de loja, **sem** chamar `buscarLojaDoDono`
   - autenticado + `buscarLojaDoDono → null` → `200` genérico `"iRango · Painel"`
   - `buscarLojaDoDono` lança → `500`, `Cache-Control: private, no-store`, sem detalhe do erro no corpo (só `console.error`)
