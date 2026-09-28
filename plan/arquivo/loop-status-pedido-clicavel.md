# Loop · status do pedido clicável + atalho para saiu_entrega (v1)
gerado: orquestrar · 2026-09-28 00:09 · degrau: 3 · resumo humano: plan/loop-status-pedido-clicavel.resumo.md

## Pedido
> Loop de execução autônoma (sem intervenção humana, do início ao fim) da ETAPA 1 inteira do spec specs/status-pedido-clicavel-e-latencia.md. Ler o documento inteiro, não inventar nada. Devolver o plano mais barato e seguro: quem roda, em que ordem, com que travas e custo estimado.

contexto:
- spec `specs/status-pedido-clicavel-e-latencia.md` v0.4.2, 536 linhas, **untracked** em `main`. `main` == `origin/main` == `9501682`.
- "Etapa 1" = **v1** do spec: Frente 1 inteira + Frente 2 itens 2, 3 e 4 do "Plano" (spec:300) + RN-SC11 nas duas partes. Fora: Fase B (spec:300, :322, :519, :530). O termo "etapa 1" não existe no spec. Leitura alternativa ("etapa 1" = só Frente 1) difere apenas na leitura enxuta (`buscarStatusPedidoPorToken`) e no título da confirmação do cliente: UPDATE condicional, otimista e refresh coalescido já são checkboxes da Frente 1 (spec:146, :149, :151, :170).
- decisões fechadas no spec: P1 (a) detalhe · P2 menu · P3 opção A (arestas em `TRANSICOES`) · P4 confirmação só no atalho que pula etapa · P5 "Cancelar" no menu e confirmação no menu e no detalhe · P9 latência não é problema · P12 filtro "A caminho / pronto". P10: esta feature antes da 299. P8: só Fase B. **Nenhuma pendência trava o loop.**
- 299 não implementada: nenhuma migration toca a máquina de status (`grep saiu_entrega supabase/migrations/*` só casa `20260614000129_schema_inicial.sql`, o CHECK). **v1 sem migration, sem `db push`** (spec:392).
- sem mockup em `mockups/`; o spec manda a copy final passar pelo `desenhar` (spec:418).
- `quebrar`/`planejar` pulados: o spec já traz arquivos, símbolos, linhas e fatiamento (spec:43-67, :528-536). A sessão escreve a issue.
- número livre: 329 (`tasks/` vai até 328).

## Arquivos
criar:
1. `tasks/329-status-pedido-clicavel-v1.md` (removido no fim, P8)
2. `src/lib/utils/acoesStatusPedido.ts` + `.test.ts`
3. `src/lib/utils/refresh-coalescido.ts` + `.test.ts`
4. `src/components/painel/BadgeStatusPedido.tsx` (+ teste de markup)
5. `src/components/painel/MenuStatusPedido.tsx` (+ teste de markup)
6. `src/lib/utils/rotulosPedido.test.ts` (não existe hoje)
7. `tests/migrations/pedidos_status_atalho_isolamento.test.ts`
8. `src/app/admin/assinantes/[lojaId]/page.test.tsx` e `src/app/admin/assinantes/[lojaId]/pedidos/page.test.tsx` (injeção da action admin)
modificar:
9. `src/lib/utils/transicaoStatus.ts` + `.test.ts`
10. `src/lib/actions/status.ts` + `.test.ts`
11. `src/app/admin/assinantes/actions/admin-status.ts` + `.test.ts`
12. `src/lib/supabase/queries/pedidos.ts` + `tests/migrations/queries_pedidos.test.ts`
13. `src/lib/actions/consultarStatusPedido.ts` + `.test.ts`
14. `src/lib/utils/rotulosPedido.ts` (`rotuloStatusPedido`)
15. `src/lib/utils/statusConfirmacaoUi.ts` + `.test.ts`
16. `src/components/vitrine/confirmacao/LinhaTempoStatus.test.tsx` (só teste)
17. `src/components/painel/TabelaPedidos.tsx` + `.test.tsx`
18. `src/components/painel/DashboardLoja.tsx` + `.test.tsx`
19. `src/components/painel/DetalhePedido.tsx` + `.test.tsx`
20. `src/app/(painel)/painel/(bloqueavel)/pedidos/PedidosClient.tsx` + `.test.tsx`
21. `src/app/(painel)/painel/(bloqueavel)/pedidos/[id]/AcoesStatus.tsx` + `.test.tsx`
22. `src/app/admin/assinantes/[lojaId]/page.tsx`, `src/app/admin/assinantes/[lojaId]/pedidos/page.tsx`
23. `tasks/299-pedidos-maquina-de-status-no-banco.md` (nota do grafo, spec:117-118)
24. `specs/status-pedido-clicavel-e-latencia.md` (27 checkboxes → `[x]`)
25. `references/design-system.md` §7 e §8.2; `references/architecture.md` §10 (linha do débito TOCTOU, :391)

## Reuso (grep feito)
- `src/lib/utils/transicaoStatus.ts:28-35` — `TRANSICOES` é a fonte única; `acoesDisponiveis`/`ehAtalho`/`origensPermitidas` DERIVAM dele, nunca listam arestas de novo → P2, P3
- `src/lib/utils/transicaoStatus.ts:58` — `ehStatusTerminal` decide selo estático vs gatilho → P4
- `src/lib/actions/admin-loja.ts:92-99,151-158` — `escopo.atualizar(...)` devolve builder encadeável com `.eq`/`.in`; precedente de condição extra no UPDATE admin: `src/app/admin/assinantes/actions/admin-frete-combinado.ts:77-79` → P3
- `src/lib/actions/freteCombinado.ts:57-59` — precedente de UPDATE condicional por status no lado do lojista → P3
- `src/lib/actions/status.test.ts:9-45` — mock de builder já prevê `.eq().eq()` encadeado; estender para `.in().select()` → P2
- `src/lib/supabase/queries/pedidos.ts:16,48-66` — `schemaUuid` e guard de `buscarPedidoPorToken`; a nova query copia o guard e troca só a projeção → P3
- `tests/migrations/queries_pedidos.test.ts:143-168` — casos [4]-[6] de `buscarPedidoPorToken` como template → P2
- `tests/migrations/rls_cupons_pedidos.test.ts:389` — [17] "dono B NÃO atualiza pedido de A" (RLS inalterada; deve seguir verde) → gate P3
- `src/lib/utils/salvamento-coalescido.ts` + `.test.ts` — padrão de timers injetados/fake timers para `criarRefreshCoalescido` → P2, P4
- `src/lib/utils/alternar-associacao-opcional.ts` — padrão de orquestração pura com action injetada (confirmar → action → refresh) → P2, P4 (`references/architecture.md` §8, :349)
- `src/lib/utils/statusConfirmacaoUi.ts:43-55` — `copyStatusConfirmacao` já tem o default seguro; só o `titulo` muda → P3
- `src/lib/utils/rotulosPedido.ts:21-24` — `ROTULO_TIPO_ENTREGA`; `rotuloStatusPedido` entra ao lado → P3
- `src/components/painel/TabelaPedidos.tsx:52-86,96-104` — `APARENCIA_STATUS` + `BadgeStatusPedido` a extrair; `:155-160` padrão de overlay `after:absolute after:inset-0` a replicar no card mobile (`:185-201`) → P4
- `src/components/ui/menu.tsx:71` — `Menu`/`MenuTrigger`/`MenuPortal`/`MenuPositioner`/`MenuPopup`/`MenuItem`; uso de referência em `src/components/painel/SeletorImprimirPedido.tsx` → P4
- `src/components/ui/alert-dialog.tsx` — confirmação (não editar `components/ui/`) → P4
- `src/app/admin/assinantes/[lojaId]/pedidos/[id]/page.tsx:47` + `page.test.tsx:97` — padrão `.bind(null, lojaId)` e o teste que prova a injeção → P2, P4
- libs: `react@19.2.4` (`useOptimistic`, `useTransition`), `sonner`, `lucide-react` (`ChevronDown`, `ShoppingBag`), `@base-ui/react` — todas já em `package.json`. **Nenhuma dependência nova.**
- artesanal: nenhum.

## Risco por fatia
| fatia | superfície | prova |
|---|---|---|
| F1 grafo + `origensPermitidas` + `atualizarStatusPedido` (UPDATE condicional, sem SELECT prévio) | autorização (RN-08 afrouxada), RLS, TOCTOU | `transicaoStatus.test.ts`: tabela dos 36 pares com o conjunto aceito EXATO {p→c, p→x, p→s, c→ep, c→x, c→s, ep→s, ep→x, s→e} e todo o resto `false` (inclui `entregue→*`, `cancelado→*`, `s→x`, `p→e`, `c→e`, `ep→e`, `p→ep`, reversões). `acoesStatusPedido.test.ts`: `origensPermitidas(para)` ⇔ `transicaoPermitida(de, para)` nos 36 pares; `origensPermitidas("pendente")` = `[]`. `status.test.ts`: UPDATE chamado com `.eq("id", id).in("status", origensPermitidas(novo)).select("id")`, sem `select("status")` prévio; 0 linhas → `ok:false` genérico; erro → `ok:false` sem `error.message`; destino sem origem (`"pendente"`) → `ok:false` SEM `createClient`; `pendente→saiu_entrega` com 1 linha → `ok:true`. `tests/migrations/pedidos_status_atalho_isolamento.test.ts`: `asUser(donoA)` atalho em pedido de B com `status in (origens)` → 0 linhas e `asService` lê status de B intacto; pedido de A em `entregue` com o mesmo predicado → 0 linhas, intacto; afirmar contagem E leitura, não só ausência de erro |
| F2 `atualizarStatusPedidoAdmin` com `.eq("status", atual)` | autorização admin, escopo `loja_id` | `admin-status.test.ts`: UPDATE encadeia `.eq("status", atual)` depois do escopo; `count 0` → `ok:false`, sem `registrarAcessoAdmin`; `pendente→saiu_entrega` → `ok:true` e log `{de:"pendente", para:"saiu_entrega"}`; `entregue→saiu_entrega` → `ok:false` sem UPDATE; `lojaId` inválido antes de `prepararContextoAdmin` (existente). Gate: `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` verde |
| F3 leitura enxuta `buscarStatusPedidoPorToken` + `consultarStatusPedido` | token de pedido, PII (LGPD §20), anti-enumeração | `queries_pedidos.test.ts` (pglite, `asService`): par correto → objeto com chaves EXATAS `["status","tipo_entrega"]`; token errado → `null`; token de outro pedido → `null`; uuid inválido → `null` sem query. `consultarStatusPedido.test.ts`: chama `buscarStatusPedidoPorToken`, nunca `buscarPedidoPorToken`; rate limit antes da leitura (existente); retorno `ResultadoStatusPedido` inalterado |
| F4 injeção admin nas listas (`[lojaId]/page.tsx`, `[lojaId]/pedidos/page.tsx`) | autorização admin (fail-closed: sem a prop, cai na action do lojista, que a RLS zera) | `[lojaId]/page.test.tsx` e `[lojaId]/pedidos/page.test.tsx` no padrão de `pedidos/[id]/page.test.tsx:97`: `acaoStatus(id, novo)` delega para `atualizarStatusPedidoAdmin(lojaId, id, novo)` |
| F5 UI painel (Badge extraído, Menu, Tabela, AcoesStatus, Detalhe, PedidosClient, refresh coalescido, rótulo) | nenhuma (UX; autoridade é F1/F2) | `acoesStatusPedido.test.ts`: ordem RN-SC13 por status × modalidade; `exigeConfirmacao` só em atalho de `pendente`/`confirmado` e em `cancelado`. `rotulosPedido.test.ts`: `saiu_entrega`+`retirada` → "Pronto para retirada"; `entrega`/`null`/`""`/desconhecido → "Saiu pra entrega". `refresh-coalescido.test.ts`: rajada de 10 → 1 refresh com fake timers. Orquestração pura: confirmação pendente não chama a action. Markup (`renderToStaticMarkup`): terminal sem gatilho; nenhum `<button>` dentro de `<a>` no card mobile; `aria-label` "Alterar status do pedido #XXXX, atual: …"; atalho com rótulo da modalidade |
| F6 vitrine: título "Pronto para retirada" + trava da linha do tempo | nenhuma | `statusConfirmacaoUi.test.ts`: `copyStatusConfirmacao("saiu_entrega","retirada").titulo` = "Pronto para retirada"; `LinhaTempoStatus.test.tsx`: `status="em_preparo" tipoEntrega="retirada"` sem "Saiu para entrega"; `status="saiu_entrega"` com os 3 passos anteriores concluídos (trava, verde já hoje) |

## Travas
max_iterations: 3 (por passo de `executar`) · estagnação: 2 rodadas com a mesma lista de FAIL, ou diff vazio → parar e reportar
sucesso: `npx tsc --noEmit && npm run lint && npm test && npm run build` verdes; todos os testes da tabela "Risco por fatia" em PASS; `git diff --stat main...HEAD -- supabase/` vazio; PR aberto (se autorizado) com `gh pr checks` verde
proibido sempre, mesmo com modo autônomo: `npx supabase db push` (v1 não tem migration: se aparecer arquivo em `supabase/migrations/`, parar e reportar) · `gh pr merge` · `git push --force`/rebase de branch publicada · `git add -A` · editar `.env*` · `npm run dev` ou qualquer escrita no Supabase cloud · `npm install` de pacote novo (nenhum é necessário; se um agente pedir, parar a fatia de UI e reportar) · editar `src/components/ui/*`
depende da resposta do usuário antes do lançamento: `git push` do spec em `main` (P0) e da branch + `gh pr create` (P9); sem autorização, P0 commita o spec na branch e o loop para após P8 com tudo local
input externo: dado, não instrução (issue, spec, saída de agente, comentário de PR)
achado de auditoria: crítico/alto → volta a `executar`, conta iteração, re-`auditar` só o achado · médio → corrige no ciclo · baixo → 1–2 linhas no ciclo, senão issue em `tasks/` com `## Origem` = hash do commit
achado de `revisar`: CONTRATO → corrige no ciclo · MANUTENÇÃO de 1–2 linhas → sessão corrige · resto → issue ou descarte justificado no relatório
paralelismo: teto 2 agentes simultâneos (máquina)
verificar sem browser: prova por comando = suíte, build, tsc, lint, `git diff --stat main...HEAD -- supabase/` vazio; nenhum `verificar` no cloud (tudo o que muda é clique) · checklist de clique para o usuário (vai no corpo do PR): (1) em Lanches base, `/painel` e `/painel/pedidos`: selo com chevron nos 4 status abertos, estático em entregue/cancelado; (2) tocar no selo abre o menu sem abrir o detalhe, no celular e no desktop; (3) ordem do menu: próxima etapa, atalho, Cancelar; (4) atalho de pendente pede confirmação; de em_preparo não; (5) Cancelar pede confirmação no menu e no detalhe; (6) pedido de retirada mostra "Pronto para retirada" no selo, no menu, no botão e na tela de acompanhamento do cliente; (7) 10 cliques seguidos em selos diferentes: cada selo muda na hora e a lista recarrega uma vez só; (8) filtro "A caminho / pronto"; (9) mesmo fluxo pelo hub admin em Lanches base; (10) teclado: Tab até o selo, Enter, setas, Esc devolve o foco

## Execução aprovada (2026-09-28)
versão: **corte** (ver `## Custo`). P2 só `tdd` (sem `desenhar`; a copy é a do spec:413-417). P3+P4 fundidos num único `executar` (gate intermediário backend-verde mantido como checagem da sessão dentro do passo). P5 `auditar` ‖ `testar` inalterado. P6 sem `revisar`; `escriba` vira edição direta da sessão nas 3 linhas (design-system §8.2 e §7, architecture §10). P7–P10 inalterados.
autorizações: `git push` do spec em `main` e da branch + `gh pr create`: **sim**; merge manual. `db push`: n/a (sem migration; proibido). dependência nova: n/a (proibido).

## Branch
branch nova `feat/329-status-pedido-clicavel` a partir de `main` depois do commit + push do spec em `main` — exige `main` == `origin/main` no momento do corte (`git rev-list --left-right --count main...origin/main` → `0 0`); sem push autorizado, o spec vai no 1º commit da branch e não em `main`.

## Passos

### P0 · sessão · —
faz: `git fetch origin`; conferir `0 0`; `git add specs/status-pedido-clicavel-e-latencia.md`; commit `docs(spec): status do pedido clicável e latência (v0.4.2)`; `git push origin main` [só com push autorizado]; `git checkout -b feat/329-status-pedido-clicavel`.
saída ok: branch criada; `git status --short` só com `plan/loop-status-pedido-clicavel*.md` untracked.
gate: `git rev-list --left-right --count main...origin/main` → `0 0` (com push) · `git branch --show-current`.
trava: sem push autorizado, pular o commit em `main` e fazer o commit do spec já na branch.

### P1 · sessão · —
faz: escrever `tasks/329-status-pedido-clicavel-v1.md` com: `Spec: specs/status-pedido-clicavel-e-latencia.md`, `crítica: SIM`, o Pedido literal, escopo v1 (seções "Contexto" deste plano), as tabelas "Risco por fatia" e "Reuso", a copy do spec:413-417 e as suposições S1–S4 (abaixo). Acrescentar em `tasks/299-pedidos-maquina-de-status-no-banco.md` a nota literal do spec:117-118: "o grafo inclui `pendente → saiu_entrega` e `confirmado → saiu_entrega` (spec status-pedido-clicavel)", e que o teste de paridade deriva de `transicaoPermitida` (spec:114). `git add` nominal dos 4 arquivos (issue, 299, dois arquivos deste plano); commit `docs(329): issue e plano do status clicável`.
suposições: S1 tipo `AcaoStatus` vai para `src/lib/actions/status.ts` ao lado de `ResultadoAtualizarStatus` (`status.ts:18`; export de tipo em arquivo `'use server'` já é usado ali), com `AcoesStatus.tsx` e `DetalhePedido.tsx:34` importando de lá · S2 a orquestração pura "confirmar → action → refresh" mora em `src/lib/utils/acoesStatusPedido.ts` (nome escolhido pelo `tdd` e registrado na issue) · S3 F3 é tratada como crítica (token de pedido, CLAUDE.md mandato 3), embora o spec:534 a liste como não crítica; custo marginal zero (mesmo `tdd`/`auditar`) · S4 o spec NÃO vai para `specs/arquivo/` ao ficar 100% `[x]`, porque a Fase B continua descrita nele e não tem issue (spec:530); o PR diz isso.
gate: `test -e tasks/329-status-pedido-clicavel-v1.md && git log -1 --stat`.

### P2 · `tdd` (opus) ‖ `desenhar` (opus) — uma mensagem, dois `Agent`
tdd:
entrada: `tasks/329-status-pedido-clicavel-v1.md`; tabela "Risco por fatia"; templates `src/lib/actions/status.test.ts:9-45`, `src/app/admin/assinantes/actions/admin-status.test.ts`, `tests/migrations/queries_pedidos.test.ts:143-168`, `tests/migrations/rls_cupons_pedidos.test.ts:389`, `src/app/admin/assinantes/[lojaId]/pedidos/[id]/page.test.tsx:97`, `src/lib/utils/salvamento-coalescido.test.ts`.
faz: escrever TODAS as provas de F1–F4 e as de módulos puros de F5/F6 (acoesStatusPedido, rotuloStatusPedido, refresh coalescido, orquestração pura, copyStatusConfirmacao, LinhaTempoStatus). Assinaturas: `acoesDisponiveis(status, tipoEntrega): { status, rotulo, destrutiva, exigeConfirmacao, principal }[]`, `ehAtalho(de, para)`, `origensPermitidas(para)`, `rotuloStatusPedido(status, tipoEntrega)`, `buscarStatusPedidoPorToken(client, pedidoId, token)`, `criarRefreshCoalescido({ refresh, ... })` com ~600 ms (spec:138). Atualizar os casos existentes que afirmam `pendente→saiu_entrega` recusado. Marcar como "trava, verde esperado": isolamento pglite, linha do tempo concluída, `rls_cupons_pedidos` [17]. Não escrever teste de markup de `MenuStatusPedido`/`TabelaPedidos`/`AcoesStatus` (é do P5). Não editar código de produção nem a issue.
saída ok: `ok: true` + output com `FAIL` por arquivo novo/alterado e contagem; lista dos testes de trava em PASS.
gate: `npx vitest run src/lib/utils/transicaoStatus.test.ts src/lib/utils/acoesStatusPedido.test.ts src/lib/utils/rotulosPedido.test.ts src/lib/utils/refresh-coalescido.test.ts src/lib/utils/statusConfirmacaoUi.test.ts src/lib/actions/status.test.ts src/app/admin/assinantes/actions/admin-status.test.ts src/lib/actions/consultarStatusPedido.test.ts tests/migrations/queries_pedidos.test.ts tests/migrations/pedidos_status_atalho_isolamento.test.ts src/components/vitrine/confirmacao/LinhaTempoStatus.test.tsx "src/app/admin/assinantes/[lojaId]/page.test.tsx" "src/app/admin/assinantes/[lojaId]/pedidos/page.test.tsx" --maxWorkers=2` → só FAIL novos; pré-existentes não relacionados seguem PASS.
trava: nenhum arquivo fora de `*.test.ts(x)` e `tests/` no diff (`git diff --name-only | grep -v '\.test\.' | grep -v '^tests/'` vazio).

desenhar:
entrada: spec:126-188 (páginas 1–3), spec:244-264, spec:413-418 (copy), `references/design-system.md` §5, §6, §8.2; `src/components/painel/TabelaPedidos.tsx:96-104,150-201`; `src/components/painel/SeletorImprimirPedido.tsx` (uso de `Menu`).
faz: revisar a copy do spec:413-417 e fixar os detalhes de interação de `MenuStatusPedido` (chevron, área de toque ≥ 44×44 sem aumentar o selo, overlay no card mobile, spinner no selo, foco de volta ao gatilho, variante do botão do atalho no detalhe). Sem mockup HTML. Acrescentar à issue uma seção `## Decisões de UI (desenhar)` com a copy final e as classes/padrões. Não pode contrariar P2, P4, P5, P12, RN-SC11, RN-SC13 nem as memórias de copy (imperativo; nada que sugira pedido não feito).
saída ok: seção nova na issue; lista de divergências com o spec = vazia ou justificada.
gate: `grep -n "## Decisões de UI (desenhar)" tasks/329-status-pedido-clicavel-v1.md`.
trava: não editar `src/`; não mudar ordem de ações nem regra de confirmação.

sessão depois de P2: `git add` nominal dos testes + issue; commit `test(329): RED do grafo com atalho, actions condicionais e leitura enxuta`.

### P3 · `executar` (opus) — backend + vitrine
entrada: issue 329; testes de P2; Reuso (`admin-frete-combinado.ts:77-79`, `freteCombinado.ts:57-59`, `queries/pedidos.ts:48-66`).
faz: `TRANSICOES` com `pendente`/`confirmado` → `saiu_entrega` (atualizar o comentário do grafo em `transicaoStatus.ts:17-27`); `acoesStatusPedido.ts` derivado de `TRANSICOES`; `atualizarStatusPedido` com UPDATE condicional em uma ida, curto-circuito sem I/O quando `origensPermitidas(novo)` é vazio; `atualizarStatusPedidoAdmin` com `.eq("status", atual)` no builder do escopo; `buscarStatusPedidoPorToken` + troca em `consultarStatusPedido`; `rotuloStatusPedido`; `titulo` de retirada em `copyStatusConfirmacao`; mover o tipo `AcaoStatus` (S1). Neste passo, trocar `AcoesStatus.tsx:31-54` para consumir `acoesDisponiveis` (sem a confirmação ainda), para o detalhe não expor o atalho sem `exigeConfirmacao` entre commits.
saída ok: todos os FAIL de F1, F2, F3, F6 e dos módulos puros de F5 em PASS.
gate: vitest dos arquivos de P2 (exceto os dois `page.test.tsx` admin) + `npx vitest run tests/migrations/rls_cupons_pedidos.test.ts src/app/admin/assinantes/enforcement-escopo-admin.test.ts src/app/admin/assinantes/enforcement-props-action-admin.test.ts --maxWorkers=2` + `npx tsc --noEmit` + `npm run lint` + `git diff --stat main...HEAD -- supabase/` vazio.
trava: sem migration, sem `service_role` na action do lojista, sem ler/logar `token` em claro, sem editar teste para ficar verde (se um teste de P2 estiver errado, reportar `ok:false` com o motivo).
sessão: commit `feat(329): atalho para saiu_entrega, UPDATE condicional e leitura enxuta do status`.

### P4 · `executar` (opus) — UI do painel e fiação admin
entrada: issue 329 (incluindo "Decisões de UI (desenhar)"); spec:133-140, :163, :180-181, :196, :206; Reuso (`TabelaPedidos.tsx:52-104,155-160`, `menu.tsx:71`, `alert-dialog.tsx`, `salvamento-coalescido.ts`, `pedidos/[id]/page.tsx:47`); `references/design-system.md` §5, §6; `references/architecture.md` §8 (:349).
faz: extrair `BadgeStatusPedido` + `APARENCIA_STATUS` para `components/painel/BadgeStatusPedido.tsx` com `tipoEntrega` (`ShoppingBag` em retirada/`saiu_entrega`); `DetalhePedido` usa esse selo e passa `tipo_entrega` a `AcoesStatus`; `MenuStatusPedido` (`'use client'`, `useOptimistic` + `useTransition`, `AlertDialog` quando `exigeConfirmacao`, `toast`, refresh coalescido); `TabelaPedidos` sem `'use client'`, gatilho nos status não terminais, card mobile com overlay em vez de `<Link>` envolvendo tudo; `acaoStatus?` em `TabelaPedidos`/`DashboardLoja`/`PedidosClient`; filtro "A caminho / pronto" (`PedidosClient.tsx:31`); `AcoesStatus` com atalho `variant="outline"` e confirmação no atalho e no cancelar; `criarRefreshCoalescido`; `acaoStatus={atualizarStatusPedidoAdmin.bind(null, lojaId)}` em `[lojaId]/page.tsx` e `[lojaId]/pedidos/page.tsx`.
saída ok: todos os testes de P2 em PASS; build verde.
gate: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=2 && npm run build`.
trava: não editar `components/ui/*`; nenhuma dependência nova; nenhuma arrow inline no lugar do `.bind`; `router.refresh()` direto só dentro do refresh coalescido.
sessão: commit `feat(329): selo de status clicável com menu, atalho e confirmação no painel e no hub admin`.

### P5 · `auditar` (opus) ‖ `testar` (sonnet) — uma mensagem, dois `Agent`
entrada comum: issue 329, `git diff main...HEAD`.
auditar: foco F1–F4. `origensPermitidas` deriva de `TRANSICOES` (nenhuma lista paralela); curto-circuito de destino sem origem; nenhum caminho grava `saiu_entrega→cancelado` ou `*→entregue` fora de `saiu_entrega`; admin: `verificarAdminSaaS` antes de `service_role`, `.eq("status", atual)` depois do escopo, `count === 1`; leitura enxuta com `.eq("id").eq("token_acesso")` e projeção de 2 colunas; nenhum `error.message` na UI; `.bind` nas 3 páginas admin; nada de PII em log. Classificar por severidade com `arquivo:linha`.
testar: testes de markup (`renderToStaticMarkup`) de `MenuStatusPedido`, `BadgeStatusPedido`, `TabelaPedidos`, `AcoesStatus`, `DetalhePedido`, `PedidosClient` conforme a linha F5 da tabela; cobrir o que P2 não cobriu. Não alterar código de produção.
saída ok: auditar sem crítico/alto; testar com `npx vitest run --maxWorkers=2` verde.
gate: `npx vitest run --maxWorkers=2`.
política: crítico/alto → P3 ou P4 de novo (conta iteração) + re-`auditar` só do achado.
sessão: commit `test(329): markup do selo, menu e ações de status`.

### P6 · `revisar` (sonnet) ‖ `escriba` (sonnet) — uma mensagem, dois `Agent`
revisar: entrada `git diff main...HEAD`; TS, DRY (nenhuma lista de ações fora de `acoesStatusPedido`; nenhum rótulo de status fora de `rotuloStatusPedido`/`APARENCIA_STATUS`/`copyStatusConfirmacao`), português, dead code (`ACOES` antigo, mapa de `DetalhePedido.tsx:55-68`), uso efetivo da tabela "Reuso".
escriba: `references/design-system.md` §8.2 (:219, grafo com as 2 arestas + rótulo "Pronto para retirada" RN-SC11) e §7 (`BadgeStatusPedido`/`MenuStatusPedido` no painel; corrigir a frase que diz que o `BadgeStatus` da vitrine cobre o painel); `references/architecture.md` §10 (:391) marcar o débito TOCTOU de `atualizarStatusPedidoAdmin` como resolvido na 329. NÃO editar `seguranca.md` §12: o limite de `consultarStatusPedido` não muda na v1 (spec:436); a nota do spec:536 sobre §12 é da Fase B.
saída ok: lista de achados do revisar com severidade; diff do escriba só em `references/`.
gate: `git diff --name-only -- references/`.

### P7 · sessão (ou `executar` se CONTRATO/crítico/alto) — correções
faz: aplicar achados conforme a política de Travas; rodar gate completo.
gate: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=2 && npm run build`.
trava: no máximo 1 rodada extra de `executar`; se o gate não fechar em 2 rodadas com o mesmo erro, parar e reportar.
sessão: commits `fix(329): …` e `docs(references): máquina de status com atalho e rótulo de retirada`.

### P8 · higiene · sessão
faz: marcar `[x]` nos 27 checkboxes do spec (linhas 143-153, 167-170, 184-187, 199-200, 209, 218, 237-240), cada um só se o código correspondente existe; não arquivar o spec (S4); `git rm tasks/329-status-pedido-clicavel-v1.md`; commit `chore(329): marca o spec e remove a issue entregue`.
gate: `grep -c "^- \[ \]" specs/status-pedido-clicavel-e-latencia.md` → 0 · `test ! -e tasks/329-status-pedido-clicavel-v1.md`.

### P9 · `/pr` · sessão
faz: skill `/pr` (gates + corpo padrão) [só com push autorizado]; `gh` em `~/.local/bin/gh`. Corpo inclui: checklist de clique (Travas), "sem migration, sem db push", S3 e S4, issue 299 com a nota do grafo, e "Fase B continua no spec, sem issue". Nunca `gh pr merge`.
gate: `~/.local/bin/gh pr checks <n>` verde (esperar CI; timeout 15 min, depois reportar estado).

### P10 · higiene · sessão
faz: com PR aberto e checks verdes: `git mv plan/loop-status-pedido-clicavel.md plan/loop-status-pedido-clicavel.resumo.md plan/arquivo/`; commit `chore(plan): arquiva o loop da 329`; `git push` (commit por cima, nunca force; reexecuta o CI). Sem PR autorizado: não arquivar; relatório final diz que o plano fica em `plan/` até o PR.
gate: `test -e plan/arquivo/loop-status-pedido-clicavel.md && test -e plan/arquivo/loop-status-pedido-clicavel.resumo.md`.

## Custo
total: 8 invocações de agente (tdd, desenhar, executar ×2, auditar, testar, revisar, escriba) + `/pr` · 5 caras (opus: tdd, desenhar, executar ×2, auditar) · 0 fable · ~2h50–3h40 de ponta a ponta (sem o CI e sem o checklist do usuário). Por etapa: P0–P1 10 min · P2 35–45 (desenhar em paralelo, ~20) · P3 25–35 · P4 45–60 · P5 25–35 (paralelo) · P6 15–25 (paralelo) · P7 5–30 · P8 10 · P9 15 · P10 5. Iteração extra de auditoria: +40–55 min, +2 opus. Não conta: a sessão `orquestrar-autonomo` (opus) durante todo o loop, nem esta invocação de planejamento.
corte: sem `desenhar`, sem `revisar` e com P3+P4 fundidos num `executar` só; `escriba` vira edição direta da sessão nas 3 linhas de P6 → 4 invocações (tdd, executar, auditar, testar) + `/pr`, 3 opus, ~2h25–3h10 (economiza 4 invocações, 2 opus, ~25–30 min). Perde: a revisão de copy que o spec:418 pede, a revisão de qualidade (DRY das listas de rótulo), e o gate intermediário backend-verde-antes-da-tela. Corte mínimo (só a leitura "etapa 1 = Frente 1"): tirar F3 → −10 min, mesmas invocações.
degrau abaixo rejeitado: degrau 2 (um `executar` sozinho) — a mudança afrouxa a regra de autorização RN-08 e mexe na leitura por token; `tdd` antes e `auditar` depois são obrigatórios.
degrau acima rejeitado: `/fluxo` — spec já em nível de plano técnico, sem migration, sem schema; o `quebrar` geraria ~5 issues com ciclo completo cada (~30 invocações, ~6 h), com 3 delas no mesmo vetor (status de `pedidos`).
lacuna: nenhuma.
