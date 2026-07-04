# Spec: Status automático na página de confirmação do pedido

**Versão:** 0.1.0 | **Atualizado:** 2026-07-04

## Visão Geral

A página de confirmação (`/loja/[slug]/confirmacao?pedido=<uuid>&token=<uuid>`)
hoje é estática: o `ConfirmacaoClient.tsx` só limpa o carrinho do `sessionStorage`
ao montar e nunca mais consulta o servidor. O cliente que acabou de pedir não tem
como saber se a loja já confirmou, começou a preparar, saiu para entrega ou
cancelou — precisa ficar dando F5 ou perguntar no WhatsApp.

Esta feature faz a página **refletir e atualizar automaticamente o status do
pedido** conforme o lojista o avança pela máquina de estados já existente
(`src/lib/utils/transicaoStatus.ts`): `pendente → confirmado → em_preparo →
saiu_entrega → entregue`, ou `cancelado`.

**Mundo:** vitrine pública (sem auth). O acesso ao pedido é autorizado pelo par
`(id, token_acesso)` na URL — o token funciona como senha do pedido. Não há
sessão de cliente.

## Atores Envolvidos

- **Cliente (sem login):** abre a confirmação após checkout, acompanha o status
  atualizar sozinho. Só enxerga o próprio pedido (posse do token).
- **Lojista:** avança o status pelo painel (`atualizarStatusPedido`, fora do
  escopo desta feature). É a única fonte que muda o `status` no banco.
- **iRango (SaaS):** provê a rota/Server Action de leitura por token sob
  `service_role`, sem alterar a RLS deny-all de `pedidos`.

## Decisão de arquitetura: polling, não Realtime

**Escolha: (a) polling client-side chamando uma Server Action que reusa
`buscarPedidoPorToken` sob `service_role`.**

Justificativa explícita:

1. **RLS deny-all para anon é uma decisão de segurança deliberada.** A migration
   `20260614002500_rls_cupons_pedidos.sql` documenta que `pedidos` **não tem
   policy de SELECT anon** para não vazar nome/telefone/endereço de clientes. A
   leitura da confirmação é feita por `id + token_acesso` via `service_role`
   (BYPASSRLS) — o isolamento vive **na query**, não na RLS.
2. **Supabase Realtime client-side roda sob a RLS do papel do cliente.** Para o
   cliente anônimo (que é deny-all), Realtime simplesmente não entrega linha de
   `pedidos`. Habilitá-lo exigiria a opção (b): uma RPC/view filtrada por
   `token_acesso` expondo só `status`, com **nova policy** cuidadosamente escrita
   — mais superfície de risco, sem infra de Realtime existente no projeto.
3. **Não há NENHUM uso de Realtime no projeto hoje** (greenfield nesse aspecto).
   Introduzir a dependência, o canal, o gerenciamento de conexão e uma policy
   nova para um único caso de uso é desproporcional.
4. **`architecture.md` já assume polling** como estratégia de fase 1 para
   notificação de pedido ("fase 1 usa polling manual", linha 337).

Polling é o caminho de **menor atrito e menor risco de segurança**. A opção (b)
com Realtime fica registrada em "Fora do Escopo (v1)" como evolução de fase 2.

## Páginas e Rotas

### Confirmação do pedido — `/loja/[slug]/confirmacao`

**Mundo:** vitrine pública (sem auth). Autorização por `(pedido, token)` na URL.

**Descrição:** o cliente vê o resumo do pedido (já existente) **mais um bloco de
status ao vivo** que se atualiza sozinho enquanto o pedido está em andamento. Ao
entrar em estado terminal (`entregue` ou `cancelado`), o polling para e a UI
mostra o estado final.

O carregamento inicial permanece **server-side** (`page.tsx` já busca o pedido
por token e renderiza o resumo). O status inicial vem desse render autoritativo —
sem "flash" de loading. O polling só cuida das **atualizações subsequentes**.

**Componentes:** (reuso de shadcn/ui e componentes existentes)

- `Card` / `CardHeader` / `CardContent` / `Separator` — já usados na página.
- `Badge` (shadcn/ui) — pílula do status atual.
- **`StatusPedidoLive` (novo, client component)** — recebe `pedidoId`, `token` e
  `statusInicial` (vindo do server render). Faz o polling, renderiza a linha do
  tempo/badge e para em status terminal. Substitui/absorve o atual
  `ConfirmacaoClient` (que também limpa o `sessionStorage`).
- **`LinhaTempoStatus` (novo, apresentacional puro)** — dado um `StatusPedido`,
  desenha os passos (pendente → … → entregue) destacando o atual; caso especial
  visual para `cancelado`. Reusa `STATUS_VALIDOS`/ordem da máquina de estados.
- `Button` — CTA "Avisar a loja no WhatsApp" e "Voltar à loja" (já existem).

**UI por estado** (o texto/ícone exibido por `status`):

| status         | título              | mensagem ao cliente                                  | polling |
| -------------- | ------------------- | ---------------------------------------------------- | ------- |
| `pendente`     | Pedido recebido     | Aguardando a loja confirmar seu pedido.              | ativo   |
| `confirmado`   | Pedido confirmado   | A loja confirmou! Logo começa o preparo.             | ativo   |
| `em_preparo`   | Em preparo          | Seu pedido está sendo preparado.                     | ativo   |
| `saiu_entrega` | Saiu para entrega   | Seu pedido está a caminho. (ou "pronto p/ retirada") | ativo   |
| `entregue`     | Pedido entregue     | Pedido entregue. Bom apetite!                        | **para**|
| `cancelado`    | Pedido cancelado    | Este pedido foi cancelado pela loja.                 | **para**|

Nota: em `saiu_entrega` o texto adapta por `tipo_entrega` (`retirada` →
"pronto para retirada"; `entrega` → "a caminho"). Puro preview de UX — o
`tipo_entrega` já veio autoritativo do server render inicial.

**Behaviors:**

- [x] Ver status inicial ao abrir a página — vem do **server render** (`page.tsx`
      já chama `buscarPedidoPorToken` sob `service_role`). **Garantido em:
      Server Component + isolamento por token na query.**
- [x] Limpar carrinho do `sessionStorage` ao montar — mantém o comportamento
      atual (`irango:carrinho`, `irango:checkout`). **Garantido em: cliente (UX).**
- [x] Poll automático a cada intervalo enquanto status não é terminal — o client
      chama a Server Action `consultarStatusPedido(pedidoId, token)`. **Garantido
      em: Server Action (reusa `buscarPedidoPorToken` + `service_role`); o status
      é dado autoritativo do servidor.**
- [x] Atualizar a badge/linha do tempo quando o status muda — re-render local a
      partir do valor retornado pelo servidor. **Garantido em: cliente (render)
      sobre dado autoritativo do servidor.**
- [x] Parar o polling ao atingir `entregue` ou `cancelado` — nenhuma nova
      requisição após estado terminal. **Garantido em: cliente**, com base no
      status **autoritativo** retornado pelo servidor (a máquina de estados define
      terminalidade — `transicaoPermitida(terminal, *) === false`).
- [x] Parar o polling quando a aba perde visibilidade e retomar ao voltar
      (`document.visibilityState`) — economiza requisição em aba de fundo.
      **Garantido em: cliente (UX).**
- [x] Exibir estado de erro de rede sem quebrar a UI — se a Server Action falhar
      (rede/timeout), mantém o último status conhecido e mostra aviso discreto
      ("Não foi possível atualizar agora, tentando de novo…"); segue tentando com
      backoff. **Garantido em: cliente (UX);** o valor exibido continua sendo o
      último status **autoritativo** recebido.
- [x] Acionar "Avisar a loja no WhatsApp" — comportamento atual, inalterado.
      **Garantido em: cliente (link `wa.me` montado no server render).**
- [x] Voltar à loja — link para `/loja/[slug]`. **Garantido em: cliente.**

---

## Modelos de Dados

Nenhuma migration nova. Reusa a tabela `pedidos` existente (`schema.md`):

- `pedidos.status text NOT NULL DEFAULT 'pendente'` com
  `CHECK (status IN ('pendente','confirmado','em_preparo','saiu_entrega','entregue','cancelado'))`
  — é o único campo autoritativo que a feature lê para atualizar.
- `pedidos.token_acesso uuid NOT NULL` — senha do pedido; filtro obrigatório da
  leitura por token.

Observação: `pedidos` **não tem** coluna `atualizado_em`. O polling compara o
`status` retornado com o status atual em memória — não depende de timestamp. Se no
futuro quisermos "última atualização às HH:MM", será migration separada (fora do
escopo).

**RLS:** nenhuma policy nova. A leitura continua por `service_role` (BYPASSRLS)
com escopo `WHERE id = $1 AND token_acesso = $2` — exatamente o que
`buscarPedidoPorToken` já faz. A escolha de polling **preserva** o deny-all de
`pedidos` para anon.

## Regras de Negócio

- **RN — token é a única autorização de leitura.** A Server Action de polling só
  retorna status quando `(id, token_acesso)` conferem; par errado/ausente → trata
  como "não encontrado", sem vazar existência do pedido. **Camada: Server Action +
  isolamento na query (`buscarPedidoPorToken`).**
- **RN — status é sempre autoritativo do servidor.** O cliente nunca infere nem
  "adianta" status; só exibe o que o servidor retornou. A máquina de estados
  (`transicaoStatus.ts`) é a fonte de verdade da ordem e da terminalidade.
  **Camada: Server Action (leitura) + função pura reusada no cliente só para
  desenhar a ordem.**
- **RN — terminalidade encerra o polling.** `entregue` e `cancelado` são
  terminais (`TRANSICOES[status].length === 0`). Ao recebê-los, o cliente para de
  consultar. **Camada: cliente, decidido sobre o status autoritativo.**
- **RN — superfície mínima de dados.** A Server Action de polling retorna **apenas
  o `status`** (e, se necessário para copy, o `tipo_entrega` já conhecido) — não
  reenvia nome/telefone/endereço/itens a cada poll. **Camada: Server Action (shape
  de retorno enxuto).**
- **RN — sem valor monetário nesta feature.** A confirmação não recalcula nem
  reexibe totais dinâmicos; os valores do resumo já vieram autoritativos do server
  render de checkout. Nenhum preview de dinheiro no polling.

### Parâmetros de polling

- **Intervalo:** 8 segundos entre consultas enquanto o status é não-terminal.
  (Equilíbrio entre percepção de "ao vivo" e custo — pedido não muda a cada
  segundo.)
- **Backoff em erro:** em falha de rede, espera crescente (ex. 8s → 16s → 30s,
  teto 30s) e volta ao intervalo normal no primeiro sucesso.
- **Timeout por requisição:** aborta a chamada se passar de ~5s (via
  `AbortController`), contando como erro (aciona backoff), não como travamento.
- **Pausa por visibilidade:** sem polls com a aba oculta; retoma imediatamente ao
  voltar ao foco.
- **Parada dura:** nenhum poll após `entregue`/`cancelado`.

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** a Server Action recebe `(pedidoId, token)` e
  retorna **somente o `status`** (string do enum). PII do cliente (nome, telefone,
  endereço) **nunca** trafega no polling — fica só no server render inicial da
  página. Isso reduz a superfície repetida a cada 8s.
- **Autorização:** por posse do `token_acesso` (senha do pedido), validado na
  query `WHERE id AND token_acesso`. Formato de UUID inválido → `null` sem tocar o
  banco (`schemaUuid.safeParse`, já em `buscarPedidoPorToken`). Sem enumeração:
  par errado é indistinguível de pedido inexistente (mesma resposta genérica).
- **`service_role` só no servidor:** o client `service_role` é criado dentro da
  Server Action (`createServiceClient`), nunca exposto ao cliente. A anon key e a
  RLS deny-all de `pedidos` permanecem intactas.
- **Valor monetário:** não há. Nada de recálculo de dinheiro nesta feature.
- **Tabela nova / policy nova:** nenhuma. Decisão explícita de **não** introduzir
  view/RPC/policy de Realtime.
- **Erro interno:** logado no servidor, retorno genérico ao cliente
  (`seguranca.md` §14) — mesmo padrão de `validarCupomAction`/`atualizarStatusPedido`.
- **Rate limiting:** considerar teto simples (a action é barata e escopada por
  token), mas o intervalo de 8s + backoff já limita o volume por cliente. Rate
  limit dedicado fica como reforço opcional (não bloqueante para v1).

## Fora do Escopo (v1)

- **Realtime (opção b):** view/RPC filtrada por `token_acesso` expondo só status +
  nova policy. Fica para fase 2 se o polling se mostrar insuficiente
  (`architecture.md` já trata notificação ao lojista como fase 2).
- **Push notification / PWA notification** ao cliente quando o status muda.
- **Coluna `atualizado_em`** em `pedidos` e exibição de "atualizado às HH:MM".
- **Estimativa de tempo de entrega / ETA.**
- **Histórico de transições** (timeline com horário de cada mudança).
- **Notificação ao lojista** — feature separada (o toggle de WhatsApp automático
  já está em outra trilha).
- **Reabertura/reenvio do pedido** a partir da confirmação.

---

## Resumo para handoff

- **Páginas:** 1 (`/loja/[slug]/confirmacao`, vitrine pública).
- **Behaviors:** 8.
- **Server Action nova:** `consultarStatusPedido(pedidoId, token)` — `"use server"`,
  reusa `createServiceClient` + `buscarPedidoPorToken`, retorna só `{ status }`
  (ou "não encontrado"). Espelha o padrão de `validarCupomAction`.
- **Componentes novos:** `StatusPedidoLive` (client, absorve o
  `ConfirmacaoClient`), `LinhaTempoStatus` (apresentacional puro).
- **Reuso, não recriação:** `buscarPedidoPorToken`, `createServiceClient`,
  `STATUS_VALIDOS`/`transicaoPermitida` (terminalidade), `resolverAcaoConfirmacao`,
  shadcn `Card`/`Badge`/`Separator`/`Button`.
- **Sem migration, sem policy nova, sem Realtime, sem dinheiro.**
