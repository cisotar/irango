# Auditoria de performance — issue 126 (abertura automática do WhatsApp no checkout)

**Data:** 2026-09-06 · **Commit:** `7d75970` · **Branch:** `feat/5-whatsapp-envio-automatico-toggle`
**Escopo:** `tasks/126-mecanica-abertura-automatica-checkout.md`
**Motivo:** a issue toca o CHECKOUT da vitrine pública (mobile-first, sem auth) e
adiciona um módulo novo ao grafo de imports de um componente `'use client'`.

## Contexto

Arquivos lidos (completos):

- `src/components/vitrine/checkout/aberturaWhatsapp.ts` (novo)
- `src/components/vitrine/checkout/useEnviarPedido.ts`
- `src/components/vitrine/checkout/CheckoutWizard.tsx`
- `src/components/vitrine/checkout/EtapaPagamento.tsx`
- `src/app/(publica)/loja/[slug]/pedido/page.tsx`
- `src/lib/utils/urlHttpsSegura.ts`, `src/lib/utils/fotoSegura.ts`
- `src/lib/supabase/queries/lojas.ts` (`buscarLojaPorSlug`)
- `src/lib/validacoes/pedido.ts`
- `next.config.ts`, `package.json`
- `performance/2026-09-06-criarpedido-whatsapphref.md` (issue 125)
- `performance/2026-07-09-vitrine-checkout.md`
- `references/architecture.md`

Diff auditado: `git diff 8235522..7d75970` restrito a `src/components/vitrine/checkout`
e `loja/[slug]/pedido/page.tsx` (+1 módulo novo, +1 prop opcional propagada em 3 níveis).

## Medições

### Método (bundle) — build A/B real, não estimativa

Duas cópias do repo em `.../github/.perf126/{bA,bB}` (FORA do repo, `node_modules`
por hardlink `cp -al`; symlink não serve — o Turbopack 16.2 aborta com
`Symlink [project]/node_modules is invalid, it points out of the filesystem root`).
`.next/` do repo intocado — outros agentes rodavam `next dev` em paralelo.

- **bA** = `7d75970` como está.
- **bB** = baseline sintético: `aberturaWhatsapp.ts` removido e a chamada em
  `useEnviarPedido.ts` trocada por um `concluir` no-op. Único delta entre os builds.

`npx next build` nas duas: exit 0, 23 rotas, tabela de rotas idêntica.
Chunks do cliente atribuídos à rota via
`.next/server/app/(publica)/loja/[slug]/pedido/page_client-reference-manifest.js`.
Gzip = `gzip -9` (proxy do que a Vercel serve; brotli seria menor ainda).

### Rota `/loja/[slug]/pedido` — JS do cliente

| | chunks | raw | gzip |
|---|---|---|---|
| bB (sem a 126) | 10 | 579.031 B | 150.708 B |
| bA (com a 126) | 10 | 579.428 B | 150.868 B |
| **delta** | **0** | **+397 B (+0,07%)** | **+160 B (+0,11%)** |

Chunk do checkout isoladamente (o que contém `useEnviarPedido`):
33.899 → 34.228 B raw (+329 B); 9.089 → 9.220 B gzip (+131 B).
Soma de TODOS os `static/chunks/*.js` do build: 2.934.391 → 2.934.999 B (+608 B).

A 160 B gzip, a 400 kbps efetivos de 3G isso é ~3 ms de download. Dentro do orçamento
por três ordens de grandeza.

### `urlHttpsSegura` entrou agora no bundle do cliente? **Não.**

Verificado nos dois builds: a definição (`startsWith("https://")`) aparece em
**4 chunks em bA e 4 chunks em bB** — mesma contagem. E o conjunto de chunks da rota
do checkout **já continha** a definição em bB (`3r__cibzy9eoq.js`, 41.163 B), onde
`useEnviarPedido` nem importa o módulo: ela chega pela vitrine via `fotoSegura`
(`CardProduto`/`HeaderLoja`), que delega à fonte única §15. `TabelaFaturas.tsx` também
a importa, mas é painel — outra rota.

Ou seja: nenhum chunk novo, nenhum módulo novo, nenhum arrasto transitivo.
`urlHttpsSegura` é uma função pura de uma linha, sem dependências.

No bundle minificado o Turbopack **inlinou** `prepararAbaWhatsapp` no call site do
`useEnviarPedido` (verificado no chunk `08n8yni1cp-cd.js`) e resolveu `urlHttpsSegura`
por referência a módulo já presente — daí os +329 B do chunk serem essencialmente só a
mecânica de janela.

### Query / round trip novo: **zero**

`preAbrirWhatsapp` é derivado **em memória** de `loja`, objeto que a página já buscava
(`buscarLojaPorSlug` → `select("*")` na VIEW `vitrine_lojas`). As colunas
`whatsapp_envio_automatico` e `whatsapp` já estavam nessa projeção desde a issue 121
(`20260704120000_lojas_whatsapp_envio_automatico.sql:66`). Nenhum `await` novo em
`page.tsx` (o diff acrescenta só um `const` e uma prop). Nenhuma query, nenhum RTT,
nenhuma coluna a mais.

### Payload servidor → cliente

A fronteira de serialização é `<CheckoutWizard>`: a prop nova é **um boolean**
(`preAbrirWhatsapp={true|false}`) no flight payload — nome do campo + valor, ~20-25 B
antes de compressão. `EtapaPagamento` recebe a mesma prop, mas é filho *client* de um
client component: não é serializado de novo. Uma prop escalar por page load.

## Findings

### 1. POLIMENTO (não corrigido, por opção) — `window.open` antes do dispatch da Server Action

`src/components/vitrine/checkout/useEnviarPedido.ts:80` — `prepararAbaWhatsapp(...)`
(→ `window.open("", "_blank")`, síncrono) roda **antes** de `startEnvio`, portanto antes
de o fetch da Server Action ser disparado e antes de o estado `enviando` ser agendado.
Todo custo de criar o browsing context entra no caminho crítico do clique e conta para
o INP daquela interação.

Mitigações que já existem no código: a janela só é aberta quando `preAbrirWhatsapp` é
`true`; a chamada vem **depois** de todos os `return` antecipados (nenhuma aba órfã); e
o destino é `about:blank` same-origin, que não força processo de renderer novo no
Chrome Android.

**Por que NÃO virou fix neste ciclo:** o reordenamento possível seria disparar
`startEnvio` primeiro (o corpo de uma `async` roda síncrono até o primeiro `await`, logo
`criarPedido` já sairia) e só então abrir a aba, ainda dentro do gesto. Isso ganharia,
no máximo, o custo de um `window.open` no início do RTT — e passaria a depender de um
detalhe de implementação do `startTransition` (se o callback algum dia for adiado, a aba
abre depois de um `await`, o Safari invalida a user activation e a feature inteira morre
silenciosamente). **Não há medição que justifique a troca** (o repo não tem
jsdom/Playwright; não dá para medir `window.open` real aqui), e a regra é explícita:
otimização que complica o código sem medição é especulação. Fica registrado para o dia
em que houver instrumentação de INP em produção.

### 2. CUSTO (pré-existente, NÃO regressão da 126) — zod inteiro no bundle público do checkout

`src/components/vitrine/checkout/useEnviarPedido.ts:19` →
`src/lib/validacoes/pedido.ts:10` (`import { z } from "zod"`, zod 4.4.3).

Primeira medição real do bundle desta rota (a auditoria de 2026-07-09 não conseguiu
rodar `next build` por falta de disco). Dos 10 chunks do checkout, **um sozinho tem
283.469 B raw / 63.797 B gzip** — e é praticamente zod puro: o conteúdo minificado
carrega os validadores que o app não usa (`cidr` ×119, `nanoid`/`cuid2`/`base64url`
×108 cada, `emoji` ×90, `ulid`/`ksuid`/`e164`/`duration` ×59, `toJSONSchema`). O build
clássico do zod v4 não é tree-shakable (API encadeada).

**Impacto medido:** **42% do JS do checkout público** (63,8 KB de 151 KB gzip) é uma
biblioteca de validação cujo veredito é apenas *preview de UX* — `criarPedido` revalida
tudo no servidor com o mesmo schema `.strict()` (seguranca.md §10). Em 3G isso é ~1,3 s
só desse chunk. É a maior alavanca isolada de LCP/TTI da rota mais monetária do produto.

`useEnviarPedido.ts` é o **único** importador client de zod na vitrine — todos os
outros (`FormProduto`, `FormCupom`, `LoginForm`, `PerfilClient`, …) são painel/auth,
atrás de login, onde conversão não está em jogo. O custo é pago exclusivamente pelo
cliente final.

**Fix sugerido (nativo, sem lib nova):** migrar `src/lib/validacoes/pedido.ts` para
`zod/mini` (mesmo pacote já instalado, API funcional tree-shakable) e importar o schema
no client por `dynamic`/`import()` dentro do `enviar()`, ou eliminar o gate client e
manter só a validação de campos que já existe no wizard, deixando o veredito com o
servidor. O schema é a fronteira de segurança **no servidor** — ali ele fica intacto.
Exige medir de novo (build A/B) e testar a paridade de mensagens de erro do gate.

**Status: ISSUE SEPARADA** — fora do escopo da 126, mexe na fronteira de validação do
caminho monetário e precisa de teste próprio.

### Não reaberto (já registrado)

- `buscarLojaPorSlug` ainda roda 2× no checkout (`pedido/page.tsx:24` em
  `generateMetadata` + `:64` no corpo), sem `React cache()`. É o **GARGALO 1** da
  auditoria `2026-07-09-vitrine-checkout.md`, ainda aberto — não é achado novo desta
  auditoria e a 126 não piorou.
- Findings 2 e 3 da auditoria da 125 (ViaCEP/Nominatim em série; 4 queries de catálogo
  em série, issues 158 e 159) seguem válidos e intocados pela 126.

## Considerado e rejeitado (não é finding)

- **`dynamic()` em `aberturaWhatsapp.ts`:** 329 B raw. Carregar assíncrono um módulo que
  PRECISA existir de forma síncrona no gesto do clique quebraria a feature para ganhar
  um terço de KB. Absurdo.
- **Cachear/ISR a página do checkout:** já rejeitado em 2026-07-09 e continua valendo —
  `preAbrirWhatsapp` deriva de config de loja mutável (o lojista liga/desliga o toggle na
  issue 123) e a página mistura dado vivo (formas de pagamento, zonas, loja aberta).
- **Memoizar `preAbrirWhatsapp`:** duas comparações de campo já em memória. Zero.
- **Dependência nova:** nenhuma. `package.json` inalterado pela 126.

## Resumo

| # | Severidade | Local | Status |
|---|---|---|---|
| 1 | POLIMENTO | `window.open` antes do dispatch (`useEnviarPedido.ts:80`) | aceito (sem medição que justifique o risco) |
| 2 | CUSTO | zod completo no bundle público (`validacoes/pedido.ts:10`) | issue separada — **pré-existente, não é regressão da 126** |

**Nenhum GARGALO.** A issue 126 custa **+160 B gzip** na rota do checkout, **zero query
nova**, **zero round trip novo**, **zero chunk novo** e **um boolean** a mais no payload
servidor→cliente. Dentro do orçamento com folga.

Nenhum arquivo de produção foi editado nesta auditoria (sem GARGALO a corrigir) — sem
risco de conflito com os agentes que trabalham nos mesmos arquivos do checkout e na 124.

**Baseline registrado para comparação futura:** `/loja/[slug]/pedido` = 10 chunks,
579.428 B raw / 150.868 B gzip de JS do cliente (Next 16.2.9, Turbopack, `7d75970`).
