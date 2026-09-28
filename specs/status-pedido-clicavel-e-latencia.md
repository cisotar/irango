# Spec: Status do pedido clicável, atalho "Pronto para retirada / Saiu para entrega" e latência da atualização do cliente

**Versão:** 0.4.2 | **Atualizado:** 2026-09-27

## Visão Geral

Duas frentes pedidas juntas pelo usuário, mais um ajuste de rótulo que atravessa as duas:

**Frente 1: status clicável e atalho para a etapa que o cliente espera (painel e hub admin).**
Nas listas "Pedidos recentes" (dashboard) e "Pedidos" (`/painel/pedidos`), o status aparece
como um selo (`BadgeStatusPedido`, `src/components/painel/TabelaPedidos.tsx:96-104`), mas o
selo não faz nada ao ser clicado. Hoje, para mudar o status, o lojista abre o detalhe do
pedido e avança uma etapa por vez (`AcoesStatus.tsx`). Esta frente torna o selo um gatilho
de menu com as ações válidas e cria o **atalho para `saiu_entrega`**: com um clique o pedido
vai de `pendente`, `confirmado` ou `em_preparo` direto para **"Pronto para retirada"**
(retirada) ou **"Saiu para entrega"** (entrega), sem passar pelas etapas intermediárias. É o
momento que o cliente espera. **O atalho é secundário:** a ação principal continua sendo
avançar uma etapa, e o atalho aparece em segundo lugar, para quando o atendimento empilhar
pedidos. O atalho existe nas duas listas e no detalhe do pedido.

> **Mudança em relação à v0.2.0:** o atalho "Finalizar pedido" (salto direto para
> `entregue`) **saiu** do spec e foi substituído pelo atalho para `saiu_entrega`. Com o
> pedido em `saiu_entrega`, "Marcar entregue" é o passo normal seguinte, como hoje.

**Frente 2: latência (prioridade baixa, decisão do usuário em 2026-09-27).** Depois que o
lojista muda o status, a tela de confirmação do cliente (`/loja/[slug]/confirmacao`) leva
até ~4 s para mudar. O usuário mediu nos dois cenários (P9) e o tempo **não é um problema
hoje**, então não há urgência. A v1 fica só com o que é barato e já vale por outro motivo:
leitura enxuta do polling (LGPD, menos banco), UPDATE condicional (fecha corrida, e o atalho
precisa dele) e painel otimista com refresh coalescido (UX do lojista em pico). O **sinal em
tempo real** fica desenhado, mas vai para a **Fase B (adiada)**. Volta à mesa quando houver
reclamação de lentidão ou quando o volume se aproximar da meta de 20 lojas (ver "Volume alto").

**Ajuste de rótulo: retirada não "sai para entrega".** Em pedido de retirada
(`tipo_entrega = 'retirada'`), a etapa `saiu_entrega` passa a se chamar **"Pronto para
retirada"** em todo lugar onde aparece: selo, menu do selo, botão de ação, linha do tempo e
título da confirmação do cliente. O status gravado no banco continua `saiu_entrega` (só o
rótulo muda). Ver "Rótulo da etapa `saiu_entrega` por modalidade".

**Mundos:** painel (auth obrigatório), hub admin (auth + `verificarAdminSaaS`), vitrine
pública (confirmação do cliente, sem login, leitura por token).

### O que já foi confirmado no código (2026-09-27)

| Fato | Evidência |
|---|---|
| Os "bullets de status" das imagens são um `<Badge>` único por linha, só de apresentação, sem `onClick`. Não existe stepper no painel | `TabelaPedidos.tsx:96-104`, usado em `:170` (desktop) e `:191` (mobile) |
| No desktop, a linha inteira é um link: `<Link>` com `after:absolute after:inset-0` cobre a `<tr>` | `TabelaPedidos.tsx:155-160` |
| No mobile, o card inteiro está dentro de `<Link>`, então um botão dentro dele seria HTML inválido (elemento interativo dentro de `<a>`) | `TabelaPedidos.tsx:185-201` |
| Não existe rota chamada "pedidos abertos". `/painel/pedidos` filtra por um status de cada vez (`PedidosClient.tsx` `FILTROS`) e não tem aba "em aberto". Interpretação adotada: "tela dos pedidos abertos" = **detalhe do pedido** `/painel/pedidos/[id]`. Ver P1 | `PedidosClient.tsx:24-32`, `pedidos/[id]/AcoesStatus.tsx` |
| RN-08 permite avançar **um** passo por vez ou cancelar (de `pendente`/`confirmado`/`em_preparo`). A action recusa salto | `transicaoStatus.ts:28-35`, `status.ts:56-58`, `admin-status.ts:89-91` |
| `saiu_entrega` só tem saída para `entregue`: **não dá para cancelar** um pedido depois que ele chega em `saiu_entrega` | `transicaoStatus.ts:32` |
| O banco não guarda horário por etapa, só o `status` atual | `schema.md` `pedidos` |
| Na linha do tempo do cliente, um passo aparece concluído quando `i < indiceAtual`. Com o pedido em `saiu_entrega`, `pendente`, `confirmado` e `em_preparo` já aparecem concluídos, sem código novo | `LinhaTempoStatus.tsx` (`const concluido = indiceAtual !== -1 && i < indiceAtual`) |
| As duas listas e o detalhe do hub admin reusam `DashboardLoja`, `PedidosClient` e `DetalhePedido`/`AcoesStatus`. O admin injeta `atualizarStatusPedidoAdmin.bind(null, lojaId)` | `admin/assinantes/[lojaId]/page.tsx`, `.../pedidos/page.tsx`, `.../pedidos/[id]/page.tsx:47` |
| A action do lojista faz duas idas ao banco (SELECT do status atual, depois UPDATE) e o UPDATE devolve a linha inteira (`.select()` sem colunas) | `status.ts:43-62` |
| Depois do sucesso, `AcoesStatus` chama `router.refresh()`, que refaz o layout (`getUser` + loja + assinatura) e, na lista, `listarPedidosDoDono`, que carrega **todos** os pedidos da loja com itens | `AcoesStatus.tsx:65-72`, `architecture.md` (débito de paginação) |
| O polling do cliente usa `DELAY_BASE_MS = 8_000`, backoff até 30 s e timeout de 5 s. Pausa com a aba oculta e consulta na hora quando a aba volta a ficar visível | `StatusPedidoLive.tsx:42-44, 219-231` |
| `consultarStatusPedido` devolve só `{status, tipo_entrega}`, mas para isso lê o pedido inteiro com itens e opcionais (`"*, itens_pedido(*, itens_pedido_opcionais(*))"`) | `consultarStatusPedido.ts:76`, `queries/pedidos.ts:21,58-63` |
| Rate limit do polling: 30 por minuto por IP (Upstash, uma ida de rede a cada consulta) | `lib/utils/rateLimit.ts:39`, `seguranca.md` §12 |
| O middleware roda `supabase.auth.getUser()` em **toda** request, inclusive no polling da vitrine. Sem sessão (cliente anônimo) não há chamada de rede. Com sessão (dono testando no mesmo navegador em que está logado no painel), cada consulta faz `GET /auth/v1/user` | `src/middleware.ts`, `lib/supabase/middleware.ts`, `@supabase/auth-js` `_getUser` |
| O Next 16 despacha Server Actions **uma de cada vez** a partir do mesmo cliente. Cliques seguidos em vários selos entram numa fila | `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md:207` |
| Não há Supabase Realtime, WebSocket nem SSE no código. O client browser do Supabase já existe | `grep channel(\|realtime\|EventSource` vazio em `src/`; `lib/supabase/client.ts` (`createBrowserClient`) |
| Supabase Pro é custo fixo; Realtime está incluído até a cota do plano | `architecture.md` §9 e §"Custo previsível" |
| Pedido de retirada em `saiu_entrega`: o cliente vê a **mensagem** "Seu pedido está pronto para retirada.", mas o **título** e o rótulo do passo na linha do tempo continuam "Saiu para entrega". Só o ícone do passo já varia (`ShoppingBag`) | `statusConfirmacaoUi.ts:42-45, 85-87`, `LinhaTempoStatus.tsx:121, 164-166` |
| O painel mostra "Saiu pra entrega" sem olhar `tipo_entrega` em 4 lugares: selo da tabela, selo do detalhe, botão de ação e aba de filtro. `tipo_entrega` já chega à tabela e ao detalhe | `TabelaPedidos.tsx:71`, `DetalhePedido.tsx:64`, `AcoesStatus.tsx:34`, `PedidosClient.tsx:31`, `paraLinhaPedido.ts:18` |
| O repositório não fixa região de deploy. Se app, Supabase e Upstash estiverem em regiões diferentes, cada ida ao servidor custa 120-160 ms | `performance/2026-09-07-159-paralelizar-leituras-criarpedido.md:105-114` |

## Atores Envolvidos

- **Lojista:** clica no selo de status em qualquer das duas listas e escolhe a próxima etapa (uso normal), o atalho "Pronto para retirada"/"Saiu para entrega" ou "Cancelar". No detalhe, usa os botões de ação, que também ganham o atalho. Quando os pedidos empilham, usa o atalho para pular etapas e muda o status de vários pedidos seguidos.
- **iRango (dono do SaaS, hub admin):** as mesmas ações na loja-alvo, pela action admin (paridade: `specs/paridade-hub-admin-painel.md`).
- **Cliente (comprador):** acompanha o pedido na confirmação. O que mais importa para ele é saber que o pedido está **pronto para retirar** ou **saiu para entrega**. Vê a mudança em menos de 1 s e, quando o pedido pula etapas, vê as anteriores marcadas.

## Decisão de regra de negócio: como "pular etapas" (muda a RN-08)

O atalho **não é só UI**: a RN-08 proíbe salto, e a action recusa `pendente → saiu_entrega`.
Alternativas:

| | A: atalho sancionado na máquina de estados (**recomendada**) | B: N chamadas seguidas da action atual | C: action nova com grafo intacto |
|---|---|---|---|
| O que muda | `TRANSICOES` ganha `saiu_entrega` como saída de `pendente` e `confirmado` (`em_preparo → saiu_entrega` já existe). Uma chamada `atualizarStatusPedido(id, "saiu_entrega")`, um UPDATE | O cliente chama a action 1 a 3 vezes em sequência (`confirmado` → `em_preparo` → `saiu_entrega`) | Action separada que grava `saiu_entrega` a partir de qualquer origem permitida. `transicaoPermitida` continua estrita para os botões de passo |
| Atomicidade | total (um UPDATE) | **nenhuma**: se a 2ª chamada falhar, o pedido fica parado no meio e o lojista vê erro | total |
| Latência (lojista e cliente) | 1 ida ao servidor, **1 sinal** ao cliente | até 3 idas + fila serial de Server Actions; o cliente recebe 3 sinais e pode ver etapas piscando | 1 ida ao servidor |
| Banco (trigger da 299) | o trigger precisa aceitar as 2 arestas novas | o trigger fica como está | **igual a A**: o banco não distingue "action oficial" de PATCH direto (mesmo papel `authenticated`), então o trigger também precisa aceitar as arestas. C só mantém a restrição no TypeScript |
| Superfície de API | nenhuma action nova. `AcaoStatus` e o `bind` do admin ficam como estão | nenhuma | 2 actions novas (lojista + admin), duas vias para a mesma escrita |

**Recomendação: A.** Uma fonte de verdade do grafo, um UPDATE, um sinal, sem estado parcial.
A injeção `acao` do lojista e do admin continua funcionando sem mudança. **A decisão é do
usuário (P3).**

**Consequência que precisa ser vista (P4):** `saiu_entrega` não aceita `cancelado`. Um toque
por engano no atalho de um pedido que acabou de chegar deixa o pedido **sem como cancelar**,
e o cliente recebe "Pronto para retirada" e pode sair de casa. O spec trata isso na UI com
confirmação só quando o atalho pula etapa (RN-SC6), e não muda a regra de cancelamento.

Efeito colateral de A que precisa ser tratado: `AcoesStatus` filtra `ACOES` por
`transicaoPermitida`, então o botão "Saiu pra entrega" passaria a aparecer em `pendente` e
`confirmado` sem confirmação. A issue troca a lista por `acoesDisponiveis` (abaixo), que
marca `exigeConfirmacao` no salto.

## Dependência: issue 299 (trigger de máquina de status no banco)

`tasks/299-pedidos-maquina-de-status-no-banco.md` está no `main` (veio com o PR #157, mesclado
em 2026-09-25, `e8997a5`), mas **ainda não foi implementada**: não existe migration de
máquina de status em `supabase/migrations/`. A 299 propõe um trigger que impõe a RN-08 a
autores que não são sistema. A action do lojista usa o client autenticado, o mesmo papel de
um PATCH direto no PostgREST, então **um trigger com o grafo antigo recusaria
`pendente → saiu_entrega` do lojista**. O admin (`service_role`) fica fora do trigger e
continuaria passando. Resultado: o admin conseguiria usar o atalho e o lojista não.

Ordem recomendada (P10): **esta feature primeiro, a 299 depois.**
1. Esta feature altera `TRANSICOES` (só TypeScript; sem trigger ainda, nada no banco muda).
2. A 299 é implementada depois, com o **teste de paridade** em pglite que percorre os 36 pares `(de, para)` e afirma: o trigger aceita o par `asUser(dono)` ⇔ `transicaoPermitida(de, para)`, afirmando também o fragmento da mensagem de recusa (memória: SQLSTATE não basta). Como o teste deriva de `transicaoPermitida`, o trigger nasce **já com o atalho** e o teste fica vermelho se alguém codificar o grafo antigo.

Assim o trigger é escrito uma vez só, sem `CREATE OR REPLACE` de correção. A issue gerada pelo
`quebrar` registra na 299 a nota: "o grafo inclui `pendente → saiu_entrega` e
`confirmado → saiu_entrega` (spec status-pedido-clicavel)". Se a 299 for implementada antes,
esta feature passa a incluir o `CREATE OR REPLACE FUNCTION` do trigger no mesmo PR que muda
`TRANSICOES`.

---

## Páginas e Rotas

### 1. Dashboard: "Pedidos recentes" — `/painel`
**Mundo:** painel (auth obrigatório)
**Descrição:** o bloco "Pedidos recentes" (`DashboardLoja`, os 20 mais novos) mostra o selo
de status como gatilho de menu nos pedidos não finalizados. Clicar em qualquer outro ponto
da linha continua abrindo o detalhe.

**Componentes:**
- `TabelaPedidos` (`components/painel/TabelaPedidos.tsx`): **modificado**. A coluna Status passa a renderizar `MenuStatusPedido` quando o status não é terminal e o selo estático quando é. Recebe `acaoStatus?: AcaoStatus` (padrão: action do lojista) e repassa. Continua sem `'use client'`: a interatividade fica numa ilha client. O card mobile troca o `<Link>` que envolve tudo pelo mesmo padrão de sobreposição do desktop (`<Link>` com `after:absolute after:inset-0` e o gatilho do selo com `relative z-10`), porque um `<button>` dentro de `<a>` é HTML inválido e o toque navegaria.
- `BadgeStatusPedido` + `APARENCIA_STATUS`: **extraídos** de `TabelaPedidos.tsx` para `components/painel/BadgeStatusPedido.tsx`, para o selo estático e o gatilho do menu compartilharem cor, ícone e rótulo (design-system §8.2). Recebe `tipoEntrega` e usa `rotuloStatusPedido`. Sem mudança visual no selo de pedido de entrega. `DetalhePedido` deixa o mapa próprio (`DetalhePedido.tsx:55-68`) e usa o mesmo selo (DRY).
- `MenuStatusPedido` (**novo**, `components/painel/MenuStatusPedido.tsx`, `'use client'`): o selo vira `MenuTrigger` e ganha um chevron (`ChevronDown` do lucide) como pista visual de clique. Usa `Menu`/`MenuTrigger`/`MenuPortal`/`MenuPositioner`/`MenuPopup`/`MenuItem` de `components/ui/menu.tsx` (Base UI, já usado em `SeletorImprimirPedido`, `LinhaItemOpcional` e outros), `AlertDialog` de `components/ui/alert-dialog.tsx`, `toast` do `sonner` e `useOptimistic` + `useTransition` do React. A action vem por prop `acao` (padrão `atualizarStatusPedido`), no mesmo contrato do `AcoesStatus`. O refresh depois do sucesso passa pelo refresh coalescido (abaixo), não por `router.refresh()` direto.
- `acoesStatusPedido` (**novo**, `lib/utils/acoesStatusPedido.ts`, puro): `acoesDisponiveis(status, tipoEntrega)` devolve `{ status, rotulo, destrutiva, exigeConfirmacao, principal }[]`, **já na ordem de exibição** (RN-SC13), derivado de `transicaoPermitida`. É a **fonte única** da lista de ações. `AcoesStatus` deixa de ter `ACOES` próprio e passa a consumir este módulo (DRY). `ehAtalho(de, para)` indica se a ação pula etapas. `origensPermitidas(para)` devolve os status de onde `para` é alcançável (usado no UPDATE condicional). Ordem: 1º a próxima etapa (`principal: true`), 2º o atalho para `saiu_entrega` (só quando é diferente da próxima etapa, ou seja, em `pendente` e `confirmado`), 3º "Cancelar". Em `em_preparo`, a próxima etapa já é `saiu_entrega`: aparece uma ação só, sem duplicar.
- `rotuloStatusPedido` (**novo**, em `lib/utils/rotulosPedido.ts`, junto de `ROTULO_TIPO_ENTREGA`, puro): `rotuloStatusPedido(status, tipoEntrega)` devolve o rótulo do painel. `saiu_entrega` + `"retirada"` → "Pronto para retirada"; qualquer outro `tipoEntrega` (inclusive `null`/desconhecido) → "Saiu pra entrega". Fonte única do rótulo no painel: selo, `aria-label`, menu e `AcoesStatus`.
- `criarRefreshCoalescido` (**novo**, `lib/utils/refresh-coalescido.ts`, puro, `refresh` e timers injetados, mesmo padrão de `salvamento-coalescido.ts`): junta os `router.refresh()` de uma rajada de mudanças de status num só, disparado quando a fila de actions esvazia e passa ~600 ms sem clique novo. Ver "Volume alto".
- `AcaoStatus` (tipo): sai de `app/(painel)/.../AcoesStatus.tsx` e vai para um módulo neutro importável por `components/painel/`. Hoje `components/` importa de `app/`, e isso piora com um segundo consumidor.
- `DashboardLoja`: **modificado**, recebe `acaoStatus?: AcaoStatus` e repassa para `TabelaPedidos`.

**Behaviors:**
- [ ] Ver o selo de status com chevron (indicação de clique) nos pedidos `pendente`, `confirmado`, `em_preparo` e `saiu_entrega`. Pedidos `entregue` e `cancelado` mostram o selo estático, sem chevron e sem foco de teclado. Garantido em: cliente (UX). A terminalidade vem de `ehStatusTerminal`, a mesma função usada pelo servidor.
- [ ] Clicar ou tocar no selo abre o menu **sem** navegar para o detalhe. Clicar no resto da linha continua abrindo o detalhe. Garantido em: cliente (UX).
- [ ] Ver no menu só as ações válidas para o status atual (`acoesDisponiveis`), nesta ordem: **1º a próxima etapa** (ex.: "Confirmar" em `pendente`), **2º o atalho** "Pronto para retirada" (pedido de retirada) ou "Saiu pra entrega" (pedido de entrega), **3º "Cancelar"**. O atalho só aparece em `pendente` e `confirmado`; em `em_preparo` a próxima etapa já é `saiu_entrega` e aparece uma vez só. Em `saiu_entrega`, a única ação é "Marcar entregue". Garantido em: cliente (UX). **A lista na UI não é barreira**: a autoridade é a Server Action (próximo item).
- [ ] Avançar para a próxima etapa pelo menu. **Garantido em: Server Action + RLS** (`atualizarStatusPedido` grava só se o status atual for origem permitida, sob a RLS `pedidos_acesso_lojista`), além do trigger da 299 quando existir.
- [ ] Clicar no atalho "Pronto para retirada"/"Saiu pra entrega": em `em_preparo` grava na hora (é o passo normal); em `pendente` ou `confirmado`, abre a confirmação (`AlertDialog`) e grava ao confirmar (P4). O pedido vai direto para `saiu_entrega`. **Garantido em: Server Action + RLS** (a aresta de atalho é validada no servidor), além do trigger da 299. Pedido de outra loja não casa nenhuma linha (RLS), e a action responde com a mensagem genérica.
- [ ] Clicar em "Cancelar" abre a confirmação (`AlertDialog`, variante destrutiva) e cancela ao confirmar. **Garantido em: Server Action + RLS.**
- [ ] Ver o selo trocar na hora para o novo status (preview otimista, com spinner no selo e menu desabilitado enquanto espera). Se o servidor recusar, o selo volta ao status anterior e aparece `toast.error` com a mensagem genérica. Garantido em: **cliente (preview de UX)**. O valor autoritativo é o que o refresh traz do banco depois do sucesso.
- [ ] Em pedido de retirada em `saiu_entrega`, ver o selo "Pronto para retirada" com ícone `ShoppingBag` (em vez de "Saiu pra entrega" com `Bike`), na mesma cor ciano. Pedido de entrega continua como hoje. Garantido em: cliente (apresentação derivada de `status` + `tipo_entrega` lidos do banco). Não muda o status gravado.
- [ ] Ver os cartões de métrica ("Pendentes", "Pedidos hoje") atualizados depois da mudança (refresh coalescido). Garantido em: Server Component (métricas derivadas do banco por `calcularMetricasDoDia`).
- [ ] Operar tudo por teclado e leitor de tela: o gatilho é `<button>` com `aria-label` "Alterar status do pedido #XXXX, atual: Pendente". O menu segue o padrão ARIA do Base UI (setas, Enter, Esc). O foco volta ao gatilho quando o menu ou a confirmação fecham. Garantido em: cliente (UX/WCAG, design-system §5).
- [ ] No mobile, o alvo de toque do selo tem no mínimo 44×44 px (área de toque estendida, sem aumentar o selo visível). Garantido em: cliente (UX).

---

### 2. Pedidos — lista — `/painel/pedidos`
**Mundo:** painel (auth obrigatório)
**Descrição:** mesma tabela, com as abas de filtro por status (segunda imagem). O selo
clicável se comporta igual ao dashboard.

**Componentes:**
- `PedidosClient`: **modificado**, recebe `acaoStatus?: AcaoStatus` e repassa para `TabelaPedidos`. O botão de filtro `saiu_entrega` passa a se chamar **"A caminho / pronto"** (P12).
- `TabelaPedidos`, `MenuStatusPedido`, `BadgeStatusPedido`: reuso (página 1).

**Behaviors:**
- [ ] Todos os behaviors da página 1 (selo clicável, atalho, próxima etapa, cancelar, otimista, teclado, toque). Mesmas garantias: **Server Action + RLS**.
- [ ] Ver o botão de filtro `saiu_entrega` com o nome **"A caminho / pronto"**, porque ele lista juntos os pedidos de entrega a caminho e os de retirada prontos no balcão (P12). Garantido em: cliente (UX).
- [ ] Com uma aba de filtro ativa (ex.: "Pendentes"), um pedido que muda de status sai da aba depois do refresh. A aba selecionada continua a mesma, porque é estado de UI do `PedidosClient`. Garantido em: cliente (UX de apresentação). A lista já chega filtrada pela RLS.
- [ ] Mudar o status de 10 pedidos seguidos em menos de 10 s sem travar a tela: cada selo tem seu próprio estado otimista e troca na hora; as Server Actions entram na fila serial do Next (docs 07-mutating-data.md:207), e **um só** refresh roda quando a rajada termina. Nenhum clique se perde. A mudança de cada pedido é gravada assim que a action dele termina, sem esperar o refresh do painel. Garantido em: cliente (UX). Cada escrita é revalidada no servidor de forma independente.

---

### 3. Pedido — detalhe — `/painel/pedidos/[id]` ("tela do pedido aberto")
**Mundo:** painel (auth obrigatório)
**Descrição:** o cartão "Ações" (`AcoesStatus`) ganha o atalho como botão secundário, depois
da próxima etapa.

**Componentes:**
- `AcoesStatus` (`app/(painel)/painel/(bloqueavel)/pedidos/[id]/AcoesStatus.tsx`): **modificado**. Passa a consumir `acoesDisponiveis(status, tipoEntrega)`, mantém a próxima etapa como botão primário, mostra o atalho logo depois como botão secundário (`variant="outline"`) e a confirmação `AlertDialog` nas ações com `exigeConfirmacao`. Mantém o prop `acao` (injeção do admin).
- `DetalhePedido` (`components/painel/DetalhePedido.tsx`): passa `tipo_entrega` a `AcoesStatus` e usa `BadgeStatusPedido` no cabeçalho. Sem mudança de contrato externo.

**Behaviors:**
- [ ] Ver, nesta ordem: a próxima etapa como botão primário, o atalho **"Pronto para retirada"** (retirada) ou **"Saiu pra entrega"** (entrega) como botão secundário, e "Cancelar". O atalho aparece em `pendente` e `confirmado`. Em `em_preparo`, o botão primário já é "Pronto para retirada"/"Saiu pra entrega" e não há atalho separado. Em `saiu_entrega`, aparece um único botão, "Marcar entregue", sem confirmação, como hoje. Garantido em: cliente (UX).
- [ ] Usar o atalho a partir de `pendente` ou `confirmado` pela confirmação (P4); a partir de `em_preparo`, direto. **Garantido em: Server Action + RLS** (mesma action e aresta da página 1), além do trigger da 299.
- [ ] Cancelar pela confirmação (hoje o cancelamento no detalhe não pede confirmação). **Garantido em: Server Action + RLS.**
- [ ] Depois do sucesso, ver o selo do cabeçalho no novo status ("Pronto para retirada" em pedido de retirada) e os botões da etapa seguinte, via refresh. Garantido em: Server Component (status lido do banco).

---

### 4. Hub admin: dashboard da loja-alvo — `/admin/assinantes/[lojaId]`
**Mundo:** hub admin (auth + `verificarAdminSaaS`)
**Descrição:** mesmo `DashboardLoja`, agora com a action admin injetada.

**Componentes:**
- `admin/assinantes/[lojaId]/page.tsx`: **modificado**, passa `acaoStatus={atualizarStatusPedidoAdmin.bind(null, lojaId)}` a `DashboardLoja` (mesmo padrão de `.../pedidos/[id]/page.tsx:47`, `bind` e não arrow inline).

**Behaviors:**
- [ ] Todos os behaviors da página 1 na loja-alvo. **Garantido em: Server Action admin + escopo** (`verificarAdminSaaS` antes de elevar a `service_role`, `EscopoLoja` com `.eq("loja_id").eq("id")`, `transicaoPermitida` revalidada). Mudança de status em pedido de outra loja não casa nenhuma linha (`count !== 1`), e a action responde com a mensagem genérica.
- [ ] Cada mudança fica registrada em `admin_acessos` (`registrarAcessoAdmin`, `acao: "pedido.status"`, `metadados: { de, para }`). O par `{de: "pendente", para: "saiu_entrega"}` já registra o salto. Garantido em: Server Action admin (best-effort, como hoje).

---

### 5. Hub admin: pedidos — lista — `/admin/assinantes/[lojaId]/pedidos`
**Mundo:** hub admin
**Componentes:** `.../pedidos/page.tsx`: **modificado**, passa `acaoStatus` com o `bind` para `PedidosClient`.

**Behaviors:**
- [ ] Todos os behaviors da página 2 na loja-alvo. **Garantido em: Server Action admin + escopo**, como na página 4.

---

### 6. Hub admin: pedido — detalhe — `/admin/assinantes/[lojaId]/pedidos/[id]`
**Mundo:** hub admin
**Componentes:** nenhuma mudança própria. Herda o `AcoesStatus` modificado (página 3) por `DetalhePedido`.

**Behaviors:**
- [ ] Todos os behaviors da página 3 na loja-alvo. **Garantido em: Server Action admin + escopo**, como na página 4.

---

### 7. Confirmação do cliente — `/loja/[slug]/confirmacao?pedido=<id>&token=<token>`
**Mundo:** vitrine pública (sem auth; leitura por posse do token)
**Descrição:** o bloco "Acompanhe seu pedido" (`StatusPedidoLive` + `LinhaTempoStatus`)
continua com o polling de hoje (8 s), mas cada consulta fica mais leve. Pedido de retirada
passa a mostrar "Pronto para retirada". Quando o pedido pula etapas, as anteriores aparecem
concluídas. O sinal em tempo real está em "Fase B (adiada)".

**Componentes:**
- `StatusPedidoLive`: **sem mudança** na v1 (polling de 8 s mantido).
- `consultarStatusPedido` (`lib/actions/consultarStatusPedido.ts`): **modificado**, passa a usar a leitura enxuta abaixo. Contrato de retorno inalterado (`ResultadoStatusPedido`).
- `buscarStatusPedidoPorToken` (**novo**, em `lib/supabase/queries/pedidos.ts`): `select("status, tipo_entrega")` com `.eq("id").eq("token_acesso")`, sob `service_role`, e o mesmo guard de uuid de `buscarPedidoPorToken`. `buscarPedidoPorToken` continua existindo para a página de confirmação, que precisa do pedido completo.
- `copyStatusConfirmacao` (`lib/utils/statusConfirmacaoUi.ts`): **modificado**. Em `saiu_entrega` + `"retirada"`, troca o `titulo` também, além da `mensagem`: "Pronto para retirada". O default seguro continua sendo o texto de entrega.
- `LinhaTempoStatus`: **sem mudança de código** (já usa `copy.titulo` como rótulo do passo, então herda o novo título). Ganha testes que travam o comportamento.

**Behaviors:**
- [ ] Em pedido de retirada, ver **"Pronto para retirada"** no título do status e no passo da linha do tempo (hoje só a mensagem diz isso). O passo aparece com esse rótulo também antes de ser alcançado ("a seguir") e depois ("concluído"). Pedido de entrega continua "Saiu para entrega". Garantido em: cliente (apresentação derivada de `status` + `tipo_entrega` devolvidos por `consultarStatusPedido`). Teste: `copyStatusConfirmacao("saiu_entrega", "retirada").titulo` e `renderToStaticMarkup(<LinhaTempoStatus status="em_preparo" tipoEntrega="retirada"/>)` sem "Saiu para entrega".
- [ ] Ver `pendente`, `confirmado` e `em_preparo` marcados como concluídos quando o pedido chega em `saiu_entrega` direto de `pendente` ou `confirmado`. Garantido em: cliente (apresentação derivada do status autoritativo). **Já funciona hoje.** Falta o teste que trava isso: `renderToStaticMarkup(<LinhaTempoStatus status="saiu_entrega" …/>)` com os 3 passos anteriores em estado "concluído".
- [ ] O polling para ao chegar em `entregue` ou `cancelado` (existente, `ehStatusTerminal`). O atalho não muda isso, porque `saiu_entrega` não é terminal. Garantido em: cliente sobre o status autoritativo. Teste existente continua verde.
- [ ] Nenhum dado pessoal nem valor é lido para responder o polling: a consulta lê só `status` e `tipo_entrega`. **Garantido em: Server Action** (projeção na query, `service_role` escopado por `(id, token_acesso)`). Par errado ou inexistente continua indistinguível (anti-enumeração).

---

## Rótulo da etapa `saiu_entrega` por modalidade

O status continua um só (`saiu_entrega`), e o que muda por modalidade é o rótulo. Não se
cria status novo nem coluna nova: o CHECK do banco e o trigger da 299 não ganham nada por
causa disso.

| Onde | Entrega | Retirada | Fonte |
|---|---|---|---|
| Selo (tabela desktop/mobile, cabeçalho do detalhe) | Saiu pra entrega · `Bike` | **Pronto para retirada** · `ShoppingBag` | `rotuloStatusPedido` |
| Próxima etapa (em `em_preparo`) e atalho (em `pendente`/`confirmado`), no menu do selo e em `AcoesStatus` | Saiu pra entrega | **Pronto para retirada** | `acoesDisponiveis(status, tipoEntrega)` → `rotuloStatusPedido` |
| `aria-label` do gatilho ("…, atual: …") | Saiu pra entrega | **Pronto para retirada** | `rotuloStatusPedido` |
| Botão de filtro de `/painel/pedidos` (lista mista) | A caminho / pronto | A caminho / pronto | `PedidosClient` `FILTROS` |
| Cliente: título do status e passo da linha do tempo | Saiu para entrega | **Pronto para retirada** | `copyStatusConfirmacao` |
| Cliente: mensagem | Seu pedido está a caminho. | Seu pedido está pronto para retirada. (já existe) | `copyStatusConfirmacao` |

Default seguro nos dois módulos: `tipoEntrega` fora de `"retirada"` (`"entrega"`, `null`,
`""`, valor desconhecido) usa o rótulo de entrega. É o mesmo contrato que
`copyStatusConfirmacao` e `iconeDoPasso` já seguem.

A ordem das palavras no painel ("Saiu **pra** entrega") e na vitrine ("Saiu **para**
entrega") continua como está. Unificar é `/polir`, fora deste spec.

---

## Frente 2: latência

> **Prioridade baixa (usuário, 2026-09-27):** medido em outro celular e na mesma máquina, o
> tempo atual não é um problema. A v1 leva só os itens 2 a 4 do plano abaixo. O resto é a
> Fase B, adiada.

### Orçamento de tempo, do clique à tela do cliente (com a Fase B)

| Trecho | Hoje | com Fase B | Como |
|---|---|---|---|
| Clique → selo muda no painel | espera a action **e** o `router.refresh()` | instantâneo | `useOptimistic` |
| Clique → status gravado | 2 idas ao banco (SELECT + UPDATE com linha inteira) | 1 ida | UPDATE condicional `.in("status", origensPermitidas(novo)).select("id")` |
| Gravado → tela do cliente fica sabendo | 0 a 8 s (espera o próximo polling; média ~4 s) | ~0,1-0,3 s | Broadcast disparado pelo trigger no commit |
| Consulta do cliente | pedido + itens + opcionais | 2 colunas | `buscarStatusPedidoPorToken` |
| **Total com a tela visível** | **até ~4 s relatado, até 8 s possível** | **< 1 s (mediana), ≤ 2 s (p95)** | |

Os valores são estimativa; a meta de < 1 s só vale para a Fase B e depois de medida.

### De onde vêm os ~4 s (hipóteses a medir, não conclusões)

| # | Hipótese | Evidência | Como confirmar | Ataca |
|---|---|---|---|---|
| H1 | A medição foi feita em `npm run dev`, que compila sob demanda e roda sem otimização contra o Supabase cloud | CLAUDE.md: dev roda contra o cloud | Repetir o teste no deploy de produção | nada a mudar no código |
| H2 | Intervalo de 8 s: com a tela do cliente parada, a espera até a próxima consulta é de 0 a 8 s (média ~4 s, compatível com o relato) | `DELAY_BASE_MS = 8_000` | Cronometrar com a tela do cliente parada e visível | sinal em tempo real |
| H3 | Teste no **mesmo navegador**, trocando de aba: a volta de foco consulta na hora, então o tempo é a duração da própria consulta. Com o lojista logado nesse navegador, cada consulta ainda paga `GET /auth/v1/user` no middleware | `StatusPedidoLive.tsx:219-231`, `lib/supabase/middleware.ts` | DevTools → Network: duração do POST da Server Action, logado e em janela anônima | H4, H5 |
| H4 | Leitura pesada: pedido + itens + opcionais (join de 3 tabelas) para devolver 2 campos | `queries/pedidos.ts:21` | Comparar o tempo da query antes e depois | leitura enxuta |
| H5 | App, Supabase e Upstash em regiões diferentes: cada consulta faz ≥ 2 idas entre regiões, 120-160 ms cada | `performance/2026-09-07-159…:105-114` | Conferir as regiões no painel Vercel/Supabase/Upstash | fixar região (Fora do Escopo) |
| H6 | Lado do painel: a action faz 2 idas ao banco e depois `router.refresh()` refaz layout + lista inteira antes de mostrar o novo status. A fila serial soma cliques seguidos | `status.ts:43-62`, `AcoesStatus.tsx:65-72` | Cronometrar do clique até o selo mudar | otimista + UPDATE condicional + refresh coalescido |
| H7 | Cold start da função serverless | plano Vercel Hobby | Primeira consulta depois de ociosidade vs. seguintes | fora do caminho crítico com o sinal: o sinal não passa pela função |

### Plano

**v1 (entra agora):** itens 2, 3 e 4. **Fase B (adiada):** itens 1, 5, 6, 7 e 8.

1. **(Fase B) Medir antes.** Baseline em produção: tempo do clique no painel até a tela do cliente mudar (cronômetro, dois aparelhos), duração do POST de `consultarStatusPedido` e de `atualizarStatusPedido` (DevTools, ~10 amostras de cada, logado e em janela anônima). Se houver volume, usar spans do Sentry, que já está instalado (`tracesSampleRate: 0.1` no servidor). Sem lib nova. O resultado é anotado na issue.
2. **Leitura enxuta** (`buscarStatusPedidoPorToken`, 2 colunas): menos tempo de banco e de serialização, e minimização de PII (LGPD, `seguranca.md` §20).
3. **UPDATE condicional em uma ida só** na action do lojista: `.update({status}).eq("id", id).in("status", origensPermitidas(novo)).select("id")`, sem o SELECT prévio. Zero linhas = recusa genérica. Isso também fecha a janela TOCTOU (dois cliques ou dois dispositivos). Na action admin, o SELECT fica (o log precisa do `de`) e o UPDATE ganha `.eq("status", atual)`, o que fecha o débito TOCTOU de `atualizarStatusPedidoAdmin` (architecture §10, issue 133).
4. **Painel otimista + refresh coalescido:** o selo e o `AcoesStatus` mostram o novo status antes da resposta (`useOptimistic`), e uma rajada de cliques gera um só refresh.
5. **(Fase B) Sinal em tempo real (Broadcast from Database):** trigger `AFTER UPDATE OF status ON pedidos … WHEN (OLD.status IS DISTINCT FROM NEW.status)` chama `realtime.send('{}'::jsonb, 'status', 'pedido:' || encode(sha256(convert_to(NEW.token_acesso::text, 'UTF8')), 'hex'), false)`. Detalhes:
   - A payload vai **vazia**: o cliente, ao receber o sinal, chama `consultarStatusPedido`, que continua sendo a única fonte do status.
   - O trigger cobre lojista e admin por igual e roda no mesmo commit do UPDATE (a mensagem sai depois do commit).
   - A função do trigger é `SECURITY DEFINER` com `SET search_path = ''` e nomes qualificados, porque `authenticated` não tem `EXECUTE` em `realtime.send`. `REVOKE EXECUTE … FROM PUBLIC` na função.
   - **Falha do Realtime nunca derruba a mudança de status**: a chamada fica dentro de `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING … END`. O polling de reserva cobre o cliente.
   - Tópico derivado do token por hash: só quem tem o token consegue calcular o nome do canal, e o token cru nunca aparece em log do Realtime.
   - **Não** usar Realtime Postgres Changes: exigiria SELECT anon em `pedidos`, o que é proibido (`seguranca.md` §pedidos).
   - Pré-condição de configuração do projeto Supabase: canais públicos de Broadcast permitidos (configuração de Realtime "somente canais privados" desligada). Conferir antes do deploy.
6. **(Fase B) Polling como reserva:** 30 s com o canal conectado; intervalo base (P8) sem canal.
7. **(Fase B) Rate limit recalibrado** (P8).
8. **(Fase B) Medir depois**, com o mesmo protocolo do passo 1, e registrar o ganho na issue e em `performance/`.

**Descartado: SSE via Route Handler.** A conexão longa ocupa tempo de função no Vercel, e o
servidor ainda teria de consultar o banco em loop. É o mesmo polling movido de lugar, com
custo maior.

**Componentes da Fase B** (sem checkbox neste spec; viram issue própria quando a Fase B for aprovada):
- `page.tsx` da confirmação calcula `topicoStatusPedido(token)` (`lib/utils/topicoStatusPedido.ts`, `server-only`, `"pedido:" + sha256hex(token)`) e passa a `StatusPedidoLive`.
- `StatusPedidoLive` assina o canal Broadcast com o client de `lib/supabase/client.ts`, carregado por `import()` dinâmico depois da hidratação. Sinal → consulta na hora. `SUBSCRIBED` → uma consulta. Canal conectado → polling de reserva a 30 s. Canal caído ou sem conexão em 5 s → intervalo base (P8). Status terminal → sai do canal.
- `criarControladorPolling` ganha `consultarAgora()` e `definirModo("tempo-real" | "reserva")`, com o canal como dependência injetada (`DepsCanal`), testável com fake timers.
- `lib/utils/rateLimit.ts`: `statusPedido` recalibrado (P8).
- Metas da Fase B: < 1 s (mediana) e ≤ 2 s (p95) com o canal; uma mudança = um sinal = uma consulta; sem canal, o intervalo base mais a duração da consulta.

**Descartado: só encurtar o polling para 2 s.** Chega perto da meta (média ~1 s + consulta),
mas o custo cresce linearmente com os pedidos abertos (tabela abaixo) e bate no rate limit de
redes compartilhadas. Não se sustenta com volume alto.

### Volume alto

**Projeção real (usuário, 2026-09-27):** hoje 1 loja com ~50 pedidos/dia em 6 h de serviço;
meta de **20 lojas do mesmo porte até dezembro** → ~1.000 pedidos/dia, ~30 mil/mês. Premissa
de acompanhamento: o cliente fica com a tela visível **10 min** por pedido (realista) ou
**30 min** (teto). Com a aba oculta o polling pausa, então o teto é folgado.

| Consultas de status por mês (20 lojas) | Polling 8 s (hoje e v1) | Polling 4 s | Polling 2 s | **Sinal + reserva 30 s (Fase B)** |
|---|---|---|---|---|
| Por pedido (10 min / 30 min visível) | 75 / 225 | 150 / 450 | 300 / 900 | **~25 / ~65** |
| Por mês, realista (10 min) | ~2,3 mi | ~4,5 mi | ~9 mi | **~0,75 mi** |
| Por mês, teto (30 min) | ~6,8 mi | ~13,5 mi | ~27 mi | **~2 mi** |

Cada consulta custa 1 invocação de função no Vercel, comandos no Upstash (rate limit) e 1
query no Supabase. Encurtar o polling **dobra ou quadruplica** esse tráfego; o sinal em tempo
real **reduz ~65-70%** em relação a hoje e ainda entrega a meta de < 1 s. **Gatilho para a Fase B:** reclamação de lentidão, ou o tráfego do polling de 8 s pesar na cota (ver alertas abaixo).

Realtime com 20 lojas: pico de ~10 telas abertas por loja no almoço (≈ 17 pedidos/h) dá
**~200 conexões simultâneas** se todas as lojas estiverem no pico ao mesmo tempo, abaixo das
500 do Pro. Mensagens: ~30 mil pedidos × ~4 mudanças × envio + entrega ≈ **~0,25 mi/mês**,
abaixo das 5 mi do Pro. Custo adicional do Realtime: zero dentro da cota.

**Alertas de infraestrutura que valem com ou sem esta feature** (fora do escopo de código,
decisão do usuário):
- O plano Vercel Hobby **proíbe uso comercial**: um SaaS com lojas pagantes precisa do Pro. O Hobby também limita a 1 mi de invocações/mês, e o polling de hoje já passa disso no teto com 20 lojas.
- O plano gratuito do Upstash tem 500 mil comandos/mês. Com 20 lojas, até a Fase B passa disso; o excedente é pago por uso e fica na casa de poucos dólares por mês com o sinal. Com polling de 2 s ficaria perto de dez vezes mais.

Caso de referência para o painel: **40 pedidos em acompanhamento ao mesmo tempo**, com a
tela do cliente ligada, e o lojista mudando o status de 10 deles em 10 s.

| | Polling 8 s (hoje) | Polling 4 s | Polling 2 s | **Sinal + reserva 30 s (Fase B)** |
|---|---|---|---|---|
| Consultas por segundo no servidor (40 telas) | 5 | 10 | 20 | **~1,3** + 1 por mudança de status |
| Consultas por hora | ~18 mil | ~36 mil | ~72 mil | **~4,8 mil** + mudanças |
| Espera média do cliente | ~4 s | ~2 s | ~1 s | **< 0,5 s** |
| Conexões Realtime simultâneas | 0 | 0 | 0 | 40 |

Cada consulta passa pela função do Vercel, pelo Upstash e pelo Supabase. Com o sinal, o
custo passa a crescer com as **mudanças de status**, não com o tempo que a tela fica aberta.
O Realtime conta conexões simultâneas e mensagens na cota do Supabase Pro (500 conexões e
5 milhões de mensagens por mês no plano Pro; **conferir na página de preços** antes do
deploy). Uma mensagem por mudança de status fica muito abaixo disso.

No painel, com volume alto:
- A fila serial de Server Actions do Next é mantida (não há como paralelizar actions do mesmo cliente). Com o UPDATE em uma ida, cada action custa ~0,1-0,3 s; 10 cliques seguidos gravam em ~1-3 s, e cada pedido fica gravado quando a sua action termina, não no fim da fila (com a Fase B, é nesse momento que o cliente recebe o sinal).
- O selo troca na hora (otimista), então o lojista não espera a fila para seguir clicando.
- O `router.refresh()` de hoje recarrega a lista inteira de pedidos com itens (`listarPedidosDoDono`) a cada mudança. Com 10 cliques, seriam 10 recargas brigando com as actions. O refresh coalescido faz **uma** recarga no fim da rajada.
- A paginação de `/painel/pedidos` continua fora deste spec, mas vira risco com volume alto: recomendação de abrir issue própria (ver Fora do Escopo).

---

## Modelos de Dados

- **`pedidos`** (`schema.md`): nenhuma coluna nova. O `CHECK` de `status` não muda (continua com os mesmos 6 valores). "Pronto para retirada" é rótulo de `saiu_entrega`, sem status novo.
- **Sem tabela nova**, portanto sem política RLS nova.
- **Migration nova (só na Fase B):** função `pedidos_sinaliza_status()` (`SECURITY DEFINER`, `search_path = ''`) + trigger `AFTER UPDATE OF status ON pedidos FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)`, chamando `realtime.send` com payload vazia e tópico `'pedido:' || sha256hex(token_acesso)`. Exceção capturada: nunca aborta o UPDATE.
- **Migration da 299 (só se a 299 já existir):** `CREATE OR REPLACE FUNCTION` da função do trigger da 299 com as 2 arestas de atalho (`pendente → saiu_entrega`, `confirmado → saiu_entrega`), e o teste de paridade de 36 pares em `tests/migrations/`. Se a 299 não existir, esta parte não entra (ver "Dependência").
- `pedidos_protege_valor_trg` **não é afetado**: um UPDATE que mexe só em `status` sai no passo 2 do trigger ("nenhuma coluna de valor mudou → libera", `20260925130000_pedidos_protege_valor.sql:35`).
- Índices: a leitura enxuta e o UPDATE condicional filtram pela PK `id`. Nenhum índice novo.
- **A v1 não tem migration própria** (só a atualização do trigger da 299, se ele existir). Deploy de migration (`npx supabase db push`) é irreversível: pede autorização (CLAUDE.md).

## Regras de Negócio

| Regra | Descrição | Garantida em |
|---|---|---|
| **RN-SC2**: atalho para `saiu_entrega` (altera a RN-08) | Além de `em_preparo → saiu_entrega`, passam a valer `pendente → saiu_entrega` e `confirmado → saiu_entrega`. `entregue` e `cancelado` continuam terminais; `saiu_entrega` continua só com saída para `entregue`. Continua proibido: reverter, sair de um status terminal, pular para `entregue` sem passar por `saiu_entrega`, e qualquer outro salto (ex.: `pendente → em_preparo`) | Server Action (`transicaoPermitida`, lojista e admin) + RLS/escopo; trigger da 299 quando existir |
| **RN-SC3**: etapas marcadas são derivadas | Não existe registro por etapa. "Etapas anteriores marcadas" é a linha do tempo derivando "concluído" da posição do status atual | cliente (apresentação) sobre o status autoritativo do servidor |
| **RN-SC4**: escrita condicionada ao status atual | O UPDATE só acontece se o status no banco ainda for uma origem permitida para o destino. Zero linhas afetadas = recusa com mensagem genérica, nunca `ok: true` | Server Action (lojista: `.in("status", …)`; admin: `.eq("status", atual)` + `count === 1`) |
| **RN-SC5**: menu = ações válidas | O menu do selo e os botões do detalhe mostram só `acoesDisponiveis(status, tipoEntrega)`, a mesma função que deriva o grafo usado pelo servidor. Selo de pedido terminal não é clicável | cliente (UX). **Não é barreira**: a Server Action revalida |
| **RN-SC6**: confirmação quando o atalho pula etapa | O atalho a partir de `pendente` ou `confirmado` (`ehAtalho`) e "Cancelar" pedem confirmação em `AlertDialog`. O atalho a partir de `em_preparo`, o avanço de uma etapa e `saiu_entrega → entregue` não pedem (P4) | cliente (UX, design-system §6). Não é segurança |
| **RN-SC7**: otimista é só preview | O selo mostra o destino antes da resposta. Recusa reverte e mostra a mensagem genérica. O estado final exibido vem do banco (refresh) | cliente (preview de UX) / Server Action (autoritativo) |
| **RN-SC8**: paridade admin | Hub admin tem as mesmas ações e regras, pela action admin, com log em `admin_acessos` | Server Action admin + `verificarAdminSaaS` + `EscopoLoja` |
| **RN-SC9**: leitura mínima do polling | A consulta do cliente lê só `status` e `tipo_entrega`, por `(id, token_acesso)` sob `service_role` | Server Action + query |
| **RN-SC10**: ritmo do polling e limite | Intervalo base, reserva, backoff e timeout são UX. O limite por IP é server-side e calibrado para não atingir o uso legítimo | cliente (intervalo) / servidor (rate limit) |
| **RN-SC11**: rótulo de `saiu_entrega` por modalidade | Em pedido de retirada, a etapa `saiu_entrega` se chama "Pronto para retirada" no painel, no hub admin e na confirmação do cliente. Nenhum texto diz que um pedido de retirada "saiu para entrega". O status gravado não muda | cliente (apresentação sobre `status` + `tipo_entrega` do banco), em `rotuloStatusPedido` e `copyStatusConfirmacao` |
| **RN-SC13**: ordem das ações | A próxima etapa é sempre a primeira ação e a principal (botão primário no detalhe, 1º item no menu). O atalho para `saiu_entrega` vem em segundo, como ação secundária, e só existe quando difere da próxima etapa. "Cancelar" vem por último | cliente (UX), ordem definida em `acoesDisponiveis`. Não é segurança |
| **RN-SC12** (Fase B): sinal não é dado | O sinal em tempo real só avisa "mudou". Não carrega status, valor nem dado pessoal. O status exibido vem sempre de `consultarStatusPedido`. Falha do sinal não impede a gravação do status | banco (trigger monta payload vazia e captura exceção) + Server Action (fonte do status) |

(RN-SC1 da v0.2.0, "finalizado = entregue", saiu junto com o atalho "Finalizar pedido".)

**Copy (verbo no imperativo, sem sugerir que o pedido "não foi feito"; memórias do projeto):**
- Confirmação do atalho, retirada. Título: "Marcar o pedido #XXXX como pronto para retirada?" Corpo: "Confirme só se o pedido já está pronto no balcão. O cliente é avisado na hora, e o pedido não pode mais ser cancelado." Botões: "Pronto para retirada" / "Voltar".
- Confirmação do atalho, entrega. Título: "Marcar o pedido #XXXX como saiu para entrega?" Corpo: "Confirme só se o pedido já saiu com o entregador. O cliente é avisado na hora, e o pedido não pode mais ser cancelado." Botões: "Saiu pra entrega" / "Voltar".
- Confirmação de cancelar. Título: "Cancelar o pedido #XXXX?" Corpo: "Confirme só se o pedido não vai ser preparado. O cliente vê o pedido como cancelado. Não dá para desfazer." Botões: "Cancelar pedido" (destrutivo) / "Voltar".
- Sucesso: `toast.success("Status atualizado.")` (texto atual). Erro: a mensagem genérica atual da action.
- A copy final passa pelo `desenhar`.

## Segurança (obrigatório)

- **Valor monetário:** nenhum. A mudança de status não toca `subtotal`, `desconto`, `taxa_entrega`, `total` nem `frete_a_combinar`, e o `pedidos_protege_valor_trg` libera UPDATE só de status. Nenhum recálculo novo. O total exibido nas listas continua sendo o valor gravado.
- **Permissão (a parte crítica desta feature):**
  - A lista de ações do menu é UX. **A autoridade é a Server Action**: `atualizarStatusPedido` (client autenticado + RLS `pedidos_acesso_lojista`) e `atualizarStatusPedidoAdmin` (`verificarAdminSaaS` antes de `service_role` + `EscopoLoja`). Esconder ou mostrar um item no menu nunca é controle de acesso.
  - Afrouxar o grafo (RN-SC2) é **regra de autorização**. A issue que altera `TRANSICOES` é **crítica (TDD red-first)**: o teste vermelho cobre as 2 arestas novas aceitas e afirma que continuam recusados `entregue → *`, `cancelado → *`, `saiu_entrega → cancelado`, `pendente → entregue`, `confirmado → entregue`, `em_preparo → entregue`, `pendente → em_preparo` e as reversões. Precisa cobrir lojista e admin.
  - Edição de pedido de outra loja: **garantido em: Server Action + RLS** (lojista) e **Server Action + escopo `loja_id`** (admin). Teste de isolamento: dono A tenta mudar para `saiu_entrega` o pedido da loja B → `ok: false`, e o `status` de B fica inalterado quando lido por `asService`.
  - PATCH direto no PostgREST: com a opção A, `pendente → saiu_entrega` por PATCH direto passa a ser aceito, **o mesmo que a UI permite**. Não abre capacidade nova além da regra decidida. Sem a 299, o PATCH direto já permite qualquer transição hoje (achado BAIXO registrado na 299).
- **Canal em tempo real (Fase B; issue crítica, `auditar` obrigatório):**
  - Canal público de Broadcast com tópico = `"pedido:" + sha256(token)`. O token é uuid v4 (122 bits), então o tópico não é adivinhável. O token cru nunca vira nome de canal.
  - Payload vazia (RN-SC12). Teste pglite: capturar a chamada a `realtime.send` e afirmar `payload = '{}'` e o tópico esperado.
  - Quem tem o token pode, em tese, **enviar** um sinal falso no próprio canal (canal público aceita broadcast do cliente). O efeito é só disparar uma consulta extra, limitada pelo rate limit, e o status continua vindo do servidor. Risco aceito.
  - Sem Postgres Changes, sem SELECT anon em `pedidos`, sem policy nova em `realtime.messages`.
  - A função do trigger é `SECURITY DEFINER` com `search_path = ''` e `EXECUTE` revogado de `PUBLIC` (`seguranca.md`, funções privilegiadas).
  - `topicoStatusPedido` é `server-only`; o client recebe só o tópico pronto.
- **Dados sensíveis:** a leitura enxuta **reduz** a PII tocada pelo polling (antes nome, telefone, endereço e itens eram lidos do banco a cada consulta e descartados). O token continua trafegando só como argumento da Server Action, nunca em log. Nenhuma PII nova entra ou sai.
- **Rate limit:** na v1, o limite de `statusPedido` não muda. Na Fase B (P8), continua como contenção de custo. Com o sinal, o volume legítimo cai (reserva de 30 s), então o limite só precisa folgar para o modo sem canal. `extrairIp` fica como está (anti-bypass, §12). O token é uuid v4: força bruta é inviável em qualquer limite plausível.
- **Tabela nova:** nenhuma. Nenhuma política RLS nova.
- **API externa com key:** nenhuma nova. O client browser usa a anon key, que já é pública. Upstash continua só no servidor (`import "server-only"`).
- **Erro interno:** mensagem genérica na UI, detalhe só no log (`seguranca.md` §14). O caminho otimista não expõe `error.message`. Erro do canal em tempo real não aparece para o cliente: vira polling silenciosamente.

## Testabilidade (sem jsdom, `environment: node`)

- A lógica de menu e confirmação fica em `lib/utils/acoesStatusPedido.ts` (puro): `acoesDisponiveis`, `ehAtalho`, `origensPermitidas`. Testes unitários ao lado do módulo, incluindo a ordem (RN-SC13): em `pendente`, `[confirmado (principal), saiu_entrega, cancelado]`; em `em_preparo`, `[saiu_entrega (principal), cancelado]`, sem atalho duplicado. `rotuloStatusPedido` idem.
- `MenuStatusPedido`, `TabelaPedidos` e `AcoesStatus`: `renderToStaticMarkup` para garantir que o selo terminal não vira gatilho, que o gatilho não fica dentro de `<a>` (mobile), que o `aria-label` está presente e que o atalho aparece com o rótulo da modalidade. O disparo de `onClick` não é testável sem jsdom. Por isso a ordem "confirmar → action → refresh" fica numa função pura com a action injetada (padrão `criarSalvamentoCoalescido`/`alternarAssociacaoOpcional`, architecture §8). `criarRefreshCoalescido` é testado com fake timers (rajada de 10 → 1 refresh). Clique real e toque são validados pelo `verificar` no app.
- Actions: testes de `status.ts` e `admin-status.ts` com client mockado (padrão existente), incluindo o UPDATE condicional devolvendo zero linhas. Isolamento e triggers em `tests/migrations/` via `createTestDb()` (`asUser`/`asService`).
- (Fase B) Trigger do sinal em pglite: o pglite não tem o schema `realtime`. O teste cria um stub `realtime.send(payload jsonb, event text, topic text, private boolean)` que grava os argumentos numa tabela de captura, e afirma: um UPDATE de status gera exatamente uma chamada, com payload `'{}'`, evento `'status'`, `private = false` e tópico igual a `topicoStatusPedido(token)` calculado em TypeScript (paridade SQL ↔ TS); UPDATE que não muda `status` não gera chamada; o stub lançando erro não aborta o UPDATE. O teste também afirma que o papel `authenticated` não executa a função diretamente.
- (Fase B) Polling + canal: `criarControladorPolling` com fake timers e `DepsCanal` falso: sinal → uma consulta; dois sinais seguidos → nunca duas consultas em voo; `SUBSCRIBED` → uma consulta e intervalo de reserva; queda do canal → intervalo base; status terminal → cancela canal e polling. O teste existente parametriza `delayBaseMs`, então a troca da constante não quebra a mecânica.

## Perguntas em aberto

**P1. O que é a "tela dos pedidos abertos"?** Não existe tela com esse nome. Caso: o pedido
#A1B2 está em "Confirmado". Leitura (a): você abre o pedido #A1B2 (detalhe) e quer o atalho
ali. Leitura (b): você quer uma aba nova "Em aberto" na tela Pedidos, listando juntos todos
os pedidos que ainda não foram entregues nem cancelados. **Decidido (usuário, 2026-09-27):
(a)**, a tela de um pedido aberto (detalhe).

**P2. O que o clique no selo mostra?** **Decidido (usuário, 2026-09-27):** um menu com as
ações daquele pedido, na ordem de RN-SC13: próxima etapa, atalho, "Cancelar".

**P3. Como liberar o salto para `saiu_entrega` (muda a regra RN-08)?** Ver a tabela
"Decisão de regra de negócio". Caso: pedido #E5F6 em "Pendente". Com A, um clique grava
"Pronto para retirada" de uma vez e o cliente recebe um aviso. Com B, o sistema faz 3
gravações seguidas, e se a 2ª falhar o pedido fica parado em "Confirmado" com uma mensagem
de erro. **Decidido: A** (o usuário pediu o salto num clique, 2026-09-27; B e C não atendem sem estado parcial ou duas vias de escrita).

**P4. Pedir confirmação no atalho?** Caso: em horário de pico, o lojista toca por engano no
atalho do pedido #G7H8, que acabou de chegar ("Pendente"). Sem confirmação, o cliente recebe
"Pronto para retirada" na hora e pode sair de casa, e o pedido não pode mais ser cancelado.
Com confirmação, cada pedido que vai direto de "Pendente" para "Pronto" custa um toque a
mais. **Decidido (usuário, 2026-09-27): pedir confirmação** quando o atalho pula etapa (a
partir de "Pendente" ou "Confirmado"). A partir de "Em preparo" é o passo normal e grava com
um toque.

**P5. "Cancelar" também no menu do selo, e com confirmação?** Hoje o detalhe cancela com um
clique, sem perguntar. Caso: toque errado em "Cancelar" no pedido #J9K0 e o pedido é
cancelado na hora, sem volta. **Decidido (usuário, 2026-09-27): sim para os dois.** "Cancelar"
entra no menu do selo, e passa a pedir confirmação no menu e no detalhe (design-system §6).

**P8 (Fase B). Intervalo do polling de reserva e limite por IP.** Com o canal conectado, o polling é
só reserva. Casos:

| Situação | Intervalo | Limite por IP necessário (4 telas na mesma Wi-Fi) |
|---|---|---|
| Canal conectado | 30 s | 8/min |
| Sem canal, **4 s** | ~2 s de espera média / ~4 s máxima | 60/min |
| Sem canal, 8 s (hoje) | ~4 s / ~8 s | 30/min (hoje) |

**Recomendação: 30 s com canal, 4 s sem canal, limite de 60/min.** Conferir a cota de
requisições do plano Vercel e do Upstash antes de fixar.

**P9. Como você mediu os ~4 segundos?** **Respondida (usuário, 2026-09-27):** nos dois
cenários. Em outro celular o tempo é um pouco maior que na mesma máquina, e nos dois casos
não é um problema hoje. Por isso a Frente 2 virou prioridade baixa e o sinal em tempo real
foi para a Fase B.

**P10. Ordem com a issue 299.** O PR #157 já foi mesclado (2026-09-25). A 299 ainda não foi
implementada. **Recomendação: esta feature primeiro, a 299 depois**, com o teste de paridade
derivado de `transicaoPermitida` (ver "Dependência"). O trigger nasce com o atalho e é escrito
uma vez só.

**P12. Nome da aba de filtro `saiu_entrega` em `/painel/pedidos`.** A aba mistura pedidos
de entrega e de retirada. Caso: a loja tem o pedido #N3P4 (entrega, a caminho) e o #Q5R6
(retirada, esperando no balcão). Os dois aparecem no mesmo filtro. **Decidido (usuário,
2026-09-27): "A caminho / pronto".**

(Da v0.2.0 saíram "finalizado = entregue" e "finalizar com frete a combinar", junto com o
atalho "Finalizar", e "antecipar o tempo real", que virou a Fase B (adiada). P2 a P5 foram renumeradas; P8 a P12 mantêm o número.)

## Fora do Escopo (v1)

- Atalho "Finalizar pedido" (salto direto para `entregue`). Substituído pelo atalho para `saiu_entrega`; se voltar, é mais uma aresta em `TRANSICOES` com o mesmo mecanismo.
- Cancelar a partir de `saiu_entrega`. A regra atual fica; a confirmação do atalho avisa que o pedido não pode mais ser cancelado.
- Histórico ou horário por etapa (tabela `pedidos_status_historico`). "Etapas marcadas" é só visual (RN-SC3).
- Trilha de bolinhas (stepper) no painel. O selo continua sendo selo (P2).
- Desfazer ou reabrir pedido finalizado ou cancelado.
- Ações em lote (marcar vários pedidos como prontos de uma vez). Candidata forte para horário de pico; issue própria se quiser.
- Aviso ao cliente com a tela desligada ou o navegador fechado (Web Push, som, vibração). O sinal só chega com a página aberta.
- Notificação em tempo real **ao lojista** de pedido novo (fase 2, architecture §10, `modelo-negocio.md` §8), e atualização automática da lista do painel. O canal desta feature é só do cliente.
- **Fase B: sinal em tempo real** (Realtime Broadcast, polling de reserva, novo rate limit, medição antes e depois). Desenho completo em "Frente 2"; adiada por decisão do usuário (P9). SSE descartado.
- Fixar região de deploy (Vercel ↔ Supabase ↔ Upstash): decisão de infraestrutura, não de código. Se a medição apontar H5, abrir issue separada.
- Tirar `/loja/*` do matcher do middleware (evitaria o `getUser` só para quem está logado, sem ganho para o cliente real anônimo; mexe no fluxo de sessão).
- Paginação de `/painel/pedidos` (`listarPedidosDoDono` carrega todos os pedidos com itens a cada refresh). Com volume alto vira gargalo do painel: **recomendado abrir issue própria** logo depois desta.
- Rótulo de `entregue` em pedido de retirada ("Retirado" em vez de "Entregue"). Se quiser, é o mesmo mecanismo de RN-SC11.
- Unificar "Saiu pra entrega" (painel) com "Saiu para entrega" (vitrine).
- Contador de pendentes na sidebar (issue 195).
- Mensagem de WhatsApp ao cliente quando o status muda.

## Notas para o `quebrar`

- **Frente 2 na v1 = leitura enxuta** (`consultarStatusPedido.ts`, `queries/pedidos.ts`), junto da parte da vitrine do rótulo por modalidade. **A Fase B não vira issue agora.**
- **O PR #157 já está no `main`**: nenhuma frente depende mais dele. Branch nova a partir de `main` atualizado. A 299 vem **depois** desta feature (P10), com a nota de grafo registrada nela.
- **Rótulo por modalidade (RN-SC11)** se divide em duas partes. A parte da vitrine (`copyStatusConfirmacao` + testes do `LinhaTempoStatus`) vai junto da Frente 2. A parte do painel (`rotuloStatusPedido` + `BadgeStatusPedido` + `AcoesStatus`) vai junto da extração do `BadgeStatusPedido` na Frente 1.
- Issues críticas (TDD red-first): grafo `TRANSICOES` com o atalho para `saiu_entrega` + action do lojista com UPDATE condicional; action admin com trava de status; trigger da 299 com paridade só se ela for implementada antes desta feature. (Fase B, quando aprovada: trigger do sinal em tempo real.)
- Issues não críticas: extração de `BadgeStatusPedido` e de `acoesStatusPedido` (refactor com comportamento preservado); `MenuStatusPedido` + fiação em `TabelaPedidos`, `DashboardLoja` e `PedidosClient` + páginas admin; confirmação no `AcoesStatus`; refresh coalescido; leitura enxuta; teste de trava do `LinhaTempoStatus`.
- `acelerar` opcional na leitura enxuta. (Fase B: `migrar` no trigger do sinal, `auditar` obrigatório no canal.)
- `escriba` depois: RN-08 em `design-system.md` §8.2 (texto da máquina de estados e rótulo "Pronto para retirada", RN-SC11), a tabela §7 (`BadgeStatusPedido`/`MenuStatusPedido` no painel; hoje a tabela diz que o `BadgeStatus` da vitrine cobre o painel, o que já não bate com o código), `seguranca.md` §12 (novo limite de `consultarStatusPedido`) (e, só na Fase B, uma entrada em `seguranca.md` e `architecture.md` para o primeiro uso de Realtime).
