# 329 — Status do pedido clicável, atalho para `saiu_entrega` e leitura enxuta do status (v1)

Spec: specs/status-pedido-clicavel-e-latencia.md
crítica: SIM (autorização da transição de status — RN-08 afrouxada; token de pedido)

## Pedido

> Loop de execução autônoma (sem intervenção humana, do início ao fim) da ETAPA 1 inteira do spec
> specs/status-pedido-clicavel-e-latencia.md. Ler o documento inteiro, não inventar nada.

## Escopo (v1 do spec)

- **Frente 1 inteira** (páginas 1 a 6 do spec): selo de status clicável (`MenuStatusPedido`) nas
  listas do painel e do hub admin; atalho para `saiu_entrega` a partir de `pendente` e
  `confirmado` (P3 opção A: arestas novas em `TRANSICOES`); atalho no detalhe (`AcoesStatus`);
  confirmação no atalho que pula etapa e no "Cancelar" (P4, P5, RN-SC6); ordem RN-SC13;
  UPDATE condicional em uma ida (lojista) e trava `.eq("status", atual)` (admin); painel otimista
  com refresh coalescido; filtro "A caminho / pronto" (P12).
- **Frente 2, itens 2, 3 e 4 do "Plano"** (spec:300): leitura enxuta do polling
  (`buscarStatusPedidoPorToken`, só `status` + `tipo_entrega`), UPDATE condicional e
  refresh coalescido (os dois últimos já estão na Frente 1).
- **RN-SC11** nas duas partes: `rotuloStatusPedido` + `BadgeStatusPedido` + `AcoesStatus` no painel;
  título de `copyStatusConfirmacao` e trava de teste do `LinhaTempoStatus` na vitrine.
- **Fora:** Fase B inteira (sinal em tempo real, polling de reserva, novo rate limit, medições).
  Sem migration, sem `db push`.

## Copy (spec:413-417, usada literal)

- Confirmação do atalho, retirada. Título: "Marcar o pedido #XXXX como pronto para retirada?" Corpo: "Confirme só se o pedido já está pronto no balcão. O cliente é avisado na hora, e o pedido não pode mais ser cancelado." Botões: "Pronto para retirada" / "Voltar".
- Confirmação do atalho, entrega. Título: "Marcar o pedido #XXXX como saiu para entrega?" Corpo: "Confirme só se o pedido já saiu com o entregador. O cliente é avisado na hora, e o pedido não pode mais ser cancelado." Botões: "Saiu pra entrega" / "Voltar".
- Confirmação de cancelar. Título: "Cancelar o pedido #XXXX?" Corpo: "Confirme só se o pedido não vai ser preparado. O cliente vê o pedido como cancelado. Não dá para desfazer." Botões: "Cancelar pedido" (destrutivo) / "Voltar".
- Sucesso: `toast.success("Status atualizado.")` (texto atual). Erro: a mensagem genérica atual da action.

O spec:418 pede revisão da copy pelo `desenhar`; o usuário escolheu a versão do loop sem
`desenhar` (2026-09-28), então a copy acima vale como está.

## Risco por fatia (provas exigidas)
| fatia | superfície | prova |
|---|---|---|
| F1 grafo + `origensPermitidas` + `atualizarStatusPedido` (UPDATE condicional, sem SELECT prévio) | autorização (RN-08 afrouxada), RLS, TOCTOU | `transicaoStatus.test.ts`: tabela dos 36 pares com o conjunto aceito EXATO {p→c, p→x, p→s, c→ep, c→x, c→s, ep→s, ep→x, s→e} e todo o resto `false` (inclui `entregue→*`, `cancelado→*`, `s→x`, `p→e`, `c→e`, `ep→e`, `p→ep`, reversões). `acoesStatusPedido.test.ts`: `origensPermitidas(para)` ⇔ `transicaoPermitida(de, para)` nos 36 pares; `origensPermitidas("pendente")` = `[]`. `status.test.ts`: UPDATE chamado com `.eq("id", id).in("status", origensPermitidas(novo)).select("id")`, sem `select("status")` prévio; 0 linhas → `ok:false` genérico; erro → `ok:false` sem `error.message`; destino sem origem (`"pendente"`) → `ok:false` SEM `createClient`; `pendente→saiu_entrega` com 1 linha → `ok:true`. `tests/migrations/pedidos_status_atalho_isolamento.test.ts`: `asUser(donoA)` atalho em pedido de B com `status in (origens)` → 0 linhas e `asService` lê status de B intacto; pedido de A em `entregue` com o mesmo predicado → 0 linhas, intacto; afirmar contagem E leitura, não só ausência de erro |
| F2 `atualizarStatusPedidoAdmin` com `.eq("status", atual)` | autorização admin, escopo `loja_id` | `admin-status.test.ts`: UPDATE encadeia `.eq("status", atual)` depois do escopo; `count 0` → `ok:false`, sem `registrarAcessoAdmin`; `pendente→saiu_entrega` → `ok:true` e log `{de:"pendente", para:"saiu_entrega"}`; `entregue→saiu_entrega` → `ok:false` sem UPDATE; `lojaId` inválido antes de `prepararContextoAdmin` (existente). Gate: `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` verde |
| F3 leitura enxuta `buscarStatusPedidoPorToken` + `consultarStatusPedido` | token de pedido, PII (LGPD §20), anti-enumeração | `queries_pedidos.test.ts` (pglite, `asService`): par correto → objeto com chaves EXATAS `["status","tipo_entrega"]`; token errado → `null`; token de outro pedido → `null`; uuid inválido → `null` sem query. `consultarStatusPedido.test.ts`: chama `buscarStatusPedidoPorToken`, nunca `buscarPedidoPorToken`; rate limit antes da leitura (existente); retorno `ResultadoStatusPedido` inalterado |
| F4 injeção admin nas listas (`[lojaId]/page.tsx`, `[lojaId]/pedidos/page.tsx`) | autorização admin (fail-closed: sem a prop, cai na action do lojista, que a RLS zera) | `[lojaId]/page.test.tsx` e `[lojaId]/pedidos/page.test.tsx` no padrão de `pedidos/[id]/page.test.tsx:97`: `acaoStatus(id, novo)` delega para `atualizarStatusPedidoAdmin(lojaId, id, novo)` |
| F5 UI painel (Badge extraído, Menu, Tabela, AcoesStatus, Detalhe, PedidosClient, refresh coalescido, rótulo) | nenhuma (UX; autoridade é F1/F2) | `acoesStatusPedido.test.ts`: ordem RN-SC13 por status × modalidade; `exigeConfirmacao` só em atalho de `pendente`/`confirmado` e em `cancelado`. `rotulosPedido.test.ts`: `saiu_entrega`+`retirada` → "Pronto para retirada"; `entrega`/`null`/`""`/desconhecido → "Saiu pra entrega". `refresh-coalescido.test.ts`: rajada de 10 → 1 refresh com fake timers. Orquestração pura: confirmação pendente não chama a action. Markup (`renderToStaticMarkup`): terminal sem gatilho; nenhum `<button>` dentro de `<a>` no card mobile; `aria-label` "Alterar status do pedido #XXXX, atual: …"; atalho com rótulo da modalidade |
| F6 vitrine: título "Pronto para retirada" + trava da linha do tempo | nenhuma | `statusConfirmacaoUi.test.ts`: `copyStatusConfirmacao("saiu_entrega","retirada").titulo` = "Pronto para retirada"; `LinhaTempoStatus.test.tsx`: `status="em_preparo" tipoEntrega="retirada"` sem "Saiu para entrega"; `status="saiu_entrega"` com os 3 passos anteriores concluídos (trava, verde já hoje) |

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

## Suposições

- **S1** O tipo `AcaoStatus` vai para `src/lib/actions/status.ts`, ao lado de `ResultadoAtualizarStatus`; `AcoesStatus.tsx` e `DetalhePedido.tsx` importam de lá.
- **S2** A orquestração pura "confirmar → action → refresh" mora em `src/lib/utils/acoesStatusPedido.ts` (nome final escolhido pelo `tdd` e registrado aqui).
  - Nome final (tdd, 2026-09-28): `executarAcaoStatus(acao, deps): Promise<boolean>` em `src/lib/utils/acoesStatusPedido.ts`, com `deps = { confirmar, aplicarOtimista, executar, avisarSucesso, avisarErro, refresh, registrarErro? }`. O refresh coalescido é `criarRefreshCoalescido({ refresh, atrasoMs? })` → `{ iniciar(), concluir() }` em `src/lib/utils/refresh-coalescido.ts`.
- **S3** A leitura enxuta (F3) é tratada como crítica (token de pedido, mandato 3 do CLAUDE.md), embora o spec:534 não a liste; custo marginal zero.
- **S4** O spec **não** vai para `specs/arquivo/` ao ficar 100% `[x]`: a Fase B continua descrita nele, sem issue (spec:530).
