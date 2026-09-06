# Spec: Notificar o lojista do novo pedido via WhatsApp (link api.whatsapp.com/send)

**Versão:** 0.1.0 | **Atualizado:** 2026-07-04

## Visão Geral

Hoje, quando o cliente finaliza um pedido, ele cai na tela de confirmação
(`/loja/[slug]/confirmacao`) e o pedido fica salvo no banco — mas **o lojista
não recebe nenhum aviso**. Ele só descobre o pedido se abrir o painel e olhar a
lista (`modelo-negocio.md` §8 — fase 1 é "pedidos manuais"; `architecture.md` §10
lista "Notificação de pedido ao lojista → não implementado, fase 1 usa polling
manual"). Isso gera atraso e pedidos perdidos.

Esta feature adiciona um **botão "Avisar a loja no WhatsApp"** na tela de
confirmação. O botão abre uma conversa no WhatsApp da loja (`api.whatsapp.com/send?phone=<numero>`)
já com uma **mensagem-resumo do pedido pré-preenchida**, para o cliente enviar
com um toque. É o mesmo padrão client-driven já usado no contato do
`HeaderLoja.tsx` — link `api.whatsapp.com/send`, sem API paga, sem envio server-side.

> **Decisão de produto (fase 1):** notificação por **link `api.whatsapp.com/send` acionado pelo
> cliente**, não envio automático server-side. Envio automático exigiria WhatsApp
> Business API (custo variável por mensagem — proibido por `architecture.md` §9
> "custo previsível") e um número/gateway próprio do SaaS. Fica para uma fase
> futura junto com Realtime/push (`modelo-negocio.md` §8 fase 2).

**Mundo:** vitrine pública (`/loja/[slug]/confirmacao`) — sem login.

## Atores Envolvidos

- **iRango (SaaS):** monta a mensagem-resumo a partir do pedido autoritativo
  (server-side) e renderiza o link. Não envia nada, não intermedeia o WhatsApp.
- **Cliente:** toca no botão e envia a mensagem pela própria conta de WhatsApp.
  O envio parte do WhatsApp **dele**, para o número da loja.
- **Lojista:** recebe a mensagem no WhatsApp cadastrado (`lojas.whatsapp`),
  lê o resumo e localiza o pedido no painel pelo número curto (nº do pedido).

> **Fronteira de autoridade (importante):** a mensagem de WhatsApp é uma
> **conveniência de notificação, nunca a fonte de verdade**. O pedido já foi
> persistido autoritativamente pela Server Action de checkout (RPC
> `criar_pedido_idempotente`). O lojista **sempre confirma e opera pelo painel**,
> onde o pedido é lido do banco por `id`. A mensagem só ajuda a avisar e a
> localizar — se o texto for adulterado no cliente, isso não altera nem o pedido
> salvo nem o valor a receber. Ver Segurança.

## Páginas e Rotas

### Confirmação do pedido — `/loja/[slug]/confirmacao?pedido=<id>&token=<token>`

**Mundo:** vitrine pública (sem auth) — leitura escopada por `token_acesso`.

**Descrição:** página já existente (Server Component). Hoje mostra o resumo do
pedido confirmado. Passa a exibir também um bloco de ação **"Avisar a loja"** com
o botão que abre o WhatsApp da loja com a mensagem-resumo pré-preenchida.

O pedido autoritativo (`PedidoComItens`) já é carregado server-side via
`buscarPedidoPorToken(svc, pedidoId, token)` (`page.tsx:125`). Falta apenas
carregar o **WhatsApp e o nome da loja** (`lojas.whatsapp`, `lojas.nome`) —
uma query server-side por `ped.loja_id` — e montar a URL `api.whatsapp.com/send`.

**Componentes:**
- `Card` / `CardContent` / `Separator` / `Button` (shadcn/ui) — já em uso na página.
- **Bloco novo "Avisar a loja"** — renderizado como âncora externa estilizada de
  `Button` (mesmo recurso `render={<Link .../>}` já usado no botão "Voltar à
  loja", mas apontando para um `<a href={api.whatsapp.com/send...} target="_blank" rel="noopener
  noreferrer">`). **Não precisa de Client Component** — o `href` é montado
  server-side e o clique é o próprio gesto do usuário. Ícone `MessageCircle`
  (lucide-react), consistente com `HeaderLoja.tsx`.
- `montarLinkWhatsappPedido(pedido, loja)` — **util novo puro** em
  `src/lib/utils/whatsappPedido.ts`. Recebe o `PedidoComItens` autoritativo + os
  dados da loja e devolve `{ href: string } | null` (null quando a loja não tem
  WhatsApp). Reusa `formatarMoeda` (`lib/utils/formatarMoeda.ts`) e as helpers de
  rótulo já existentes na page (`rotuloForma`, `rotuloTipoEntrega`,
  `formatarEndereco`, `numeroCurto`) — extrair as que forem reaproveitadas para o
  módulo, sem duplicar. Normalização do número reusa a mesma regra de
  `HeaderLoja.tsx` (`whatsapp.replace(/\D/g, "")`).

**Behaviors:**
- [ ] Ver o botão "Avisar a loja no WhatsApp" quando a loja tem WhatsApp
  cadastrado. Garantido em: cliente (UX) — visibilidade condicional a partir de
  dado carregado server-side (`lojas.whatsapp`).
- [ ] Tocar no botão → abre o WhatsApp (`api.whatsapp.com/send?phone=<numero>&text=<resumo>`) em nova
  aba/app com a mensagem pré-preenchida. Garantido em: cliente (gesto do
  usuário; `target="_blank" rel="noopener noreferrer"`).
- [ ] O conteúdo da mensagem reflete o pedido real (itens, opcionais, total,
  endereço, pagamento, nº do pedido). Garantido em: **Server Action / SSR** — o
  texto é montado a partir do pedido lido do banco por token, nunca de valores do
  carrinho do cliente. (A mensagem é notificação, não recálculo de dinheiro; a
  autoridade do valor já foi garantida no checkout — ver Segurança.)
- [ ] Não ver o botão (ou ver um aviso alternativo) quando a loja **não** tem
  WhatsApp. Garantido em: cliente (UX) — fallback descrito em Regras de Negócio.

## Modelos de Dados

**Nenhuma migration nova.** A feature é 100% de leitura + renderização.

Tabelas lidas (todas já existentes, ver `schema.md`):
- `pedidos` (+ `itens_pedido` + `itens_pedido_opcionais`) — via
  `buscarPedidoPorToken` (service_role, escopo por `id`+`token_acesso`). Campos
  usados na mensagem: `id`, `nome_cliente`, `telefone_cliente`,
  `endereco_entrega` (JSONB), `subtotal`, `desconto`, `taxa_entrega`, `total`,
  `forma_pagamento`, `troco_para`, `tipo_entrega`, `cupom_codigo`, `observacoes`,
  e os snapshots de item (`nome`, `preco`, `quantidade`, opcionais
  `nome_snapshot`/`preco_snapshot`/`quantidade`).
- `lojas` — `whatsapp` e `nome`, buscados por `ped.loja_id` **server-side** com
  service_role (a página já roda com service_role para ler o pedido; a leitura de
  `whatsapp`/`nome` da loja pode reusar uma query de `queries/lojas.ts` por id —
  não escrever `.from('lojas')` inline, `architecture.md` §8 DRY).

> `lojas.whatsapp` já é validado por `^55\d{10,11}$` (`lib/validacoes/loja.ts`) e
> é obrigatório para publicar a loja (`lib/actions/loja.ts`). Ainda assim tratamos
> a ausência defensivamente (loja em rascunho, dado legado, número limpo depois).

## Regras de Negócio

**RN-W1 — Conteúdo exato da mensagem.** Montada server-side, nesta ordem
(quebras de linha reais; emojis leves para leitura no WhatsApp):

```
Novo pedido iRango
Loja: {loja.nome}
Pedido nº {numeroCurto(id)}

Itens:
- {quantidade}x {nome} — {formatarMoeda(totalItem)}
  + {opcional.nome} ({quantidade}x) — {formatarMoeda(preco_snapshot)}   <- por opcional, quando houver
...

Subtotal: {formatarMoeda(subtotal)}
Desconto ({cupom_codigo}): -{formatarMoeda(desconto)}   <- só se desconto > 0
{ "Taxa de entrega" | "Entrega" }: {formatarMoeda(taxa_entrega) | "Grátis"}
Total: {formatarMoeda(total)}

Entrega: {rotuloTipoEntrega(tipo_entrega)}
Endereço: {formatarEndereco(endereco_entrega)}    <- só quando tipo_entrega = "entrega"
Cliente: {nome_cliente}{ " — " + telefone_cliente se houver }

Pagamento: {rotuloForma(forma_pagamento)}
Troco para {formatarMoeda(troco_para)}    <- só dinheiro com troco_para > 0
Obs.: {observacoes}                        <- só se preenchido

Localize este pedido no painel pelo nº {numeroCurto(id)}.
```

  Regras de composição:
  - `numeroCurto(id)` = primeiros 8 chars do `id`, maiúsculo — **igual ao que a
    própria página já exibe** (`page.tsx:32`), para o lojista casar mensagem ↔
    painel. Reusar a helper, não recriar.
  - `totalItem` = `(item.preco + Σ opcionais.preco_snapshot*qtd) * item.quantidade`
    — **mesma fórmula já usada na página** (`page.tsx:166-170`). Reusar.
  - **O `token_acesso` NUNCA entra na mensagem.** É capability tipo-senha do
    pedido (`schema.md` §pedidos; `seguranca.md`). O lojista localiza pelo nº
    curto (não-sensível), não pelo token. Camada: garantido no util (server) por
    omissão explícita.
  - Camada: **SSR/Server** — todo o texto deriva do pedido autoritativo do banco.

**RN-W2 — Número do WhatsApp.** Usa `lojas.whatsapp` limpo com
`.replace(/\D/g, "")` (mesma normalização de `HeaderLoja.tsx:75`). URL final:
`https://api.whatsapp.com/send?phone=<numeroLimpo>&text=<encodeURIComponent(mensagem)>`
— mesmo endpoint já validado em produção pelo projeto irmão `lojinhaonline`
(`js/envio.js`), preferido a `wa.me` por ser o formato usado pelo app oficial
de envio com texto pré-preenchido. Camada: server (montagem do `href`).

**RN-W3 — Fallback sem WhatsApp.** Se `lojas.whatsapp` for `null`/vazio,
`montarLinkWhatsappPedido` retorna `null`. A página **não renderiza o botão** e
mostra no lugar um texto neutro: "Seu pedido já foi registrado. A loja
acompanhará pelo painel." (não inventar canal que não existe). Camada: cliente
(UX condicional) sobre dado server-side.

**RN-W4 — Não é canal autoritativo.** A mensagem é notificação de cortesia. O
cliente pode nunca enviá-la (ou editá-la no app do WhatsApp antes de enviar) —
o pedido continua salvo e válido no painel. A verdade do pedido e do valor a
receber é **sempre** o registro do banco lido no painel. Camada: por design —
não há dependência do envio para o pedido existir.

## Segurança (obrigatório)

- **Dado sensível que sai:** a mensagem contém PII do cliente (nome, telefone,
  endereço) e o resumo financeiro. Isso é **aceitável e desejado** aqui porque:
  (a) o destinatário é a própria loja dona do pedido; (b) quem dispara o envio é
  o **cliente**, dono desses dados, num gesto explícito; (c) o texto é montado na
  página já autenticada por `token_acesso` (só quem tem o token do pedido vê a
  confirmação). Nenhuma PII é exposta a terceiros pelo iRango — o transporte é o
  WhatsApp do próprio cliente.
- **`token_acesso` não vaza:** proibido incluir o token na mensagem
  (RN-W1). Só o `numeroCurto` (não-reversível ao token) aparece.
- **Valor monetário:** os valores exibidos/mensagem **não são recalculados aqui
  nem definidos pelo cliente** — são o snapshot autoritativo já gravado pela
  Server Action de checkout (`seguranca.md` §10; `architecture.md` §6). O util só
  formata (`formatarMoeda`). Não há caminho para o cliente alterar quanto a loja
  cobra via essa mensagem — a autoridade está no banco.
- **Tabela nova?** Não. Nenhuma política RLS nova. A leitura do pedido continua
  pela via existente (service_role + `id`+`token_acesso`); a leitura de
  `lojas.whatsapp`/`nome` é server-side por `loja_id` do pedido já resolvido.
- **API externa com key?** Não. `api.whatsapp.com/send` é link público, sem chave, sem custo.
  Nada de WhatsApp Business API nesta fase.
- **XSS:** o texto vai para `encodeURIComponent` (na URL) e o `href` é
  `https://api.whatsapp.com/send?phone=...&text=...`. Não há `dangerouslySetInnerHTML`. O `whatsapp` da loja é
  normalizado a só-dígitos antes de entrar na URL (RN-W2), então não injeta
  esquema/host.

## Fora do Escopo (v1)

- **Envio automático server-side** (WhatsApp Business API / Twilio / gateway) —
  custo variável, fase futura junto de Realtime/push (`modelo-negocio.md` §8
  fase 2). Nada de abrir aba automaticamente sem gesto do usuário (bloqueio de
  popup + experiência ruim no desktop).
- **Notificação em tempo real / push ao painel do lojista** — issue separada
  (`architecture.md` §10; a spec `1-status-automatico-confirmacao.md` trata do
  lado do cliente por polling).
- **Confirmação de leitura / status de entrega da mensagem** — o iRango não tem
  visibilidade do WhatsApp do cliente.
- **Botão de WhatsApp no painel do lojista** (ex.: responder o cliente) — não faz
  parte desta feature de notificação de novo pedido.
- **Personalizar o texto da mensagem pelo lojista** — mensagem fixa na v1.
