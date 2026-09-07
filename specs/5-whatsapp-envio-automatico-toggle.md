# Spec: Toggle de envio automático da mensagem de WhatsApp ao confirmar o pedido

**Versão:** 0.1.0 | **Atualizado:** 2026-09-06

## Status atual (2026-09-06)

**Só a base de dados foi feita.** A migration
`supabase/migrations/20260704120000_lojas_whatsapp_envio_automatico.sql` já
criou a coluna `lojas.whatsapp_envio_automatico` (`boolean NOT NULL DEFAULT
true`), e ela já aparece nos tipos gerados (`src/lib/database.types.ts`) e em
mocks de teste (`manifestPainel.test.ts`, `assinatura.test.ts`, rotas de
manifest). **Nenhum outro behavior desta spec foi implementado ainda:**

- Nenhum toggle (`Switch`) existe em `PerfilClient.tsx` nem no admin
  (`/admin/assinantes/[lojaId]/configuracao`).
- `schemaPerfil`, `DadosPerfil` e `montarPatchPerfil`
  (`src/lib/actions/loja.ts`) não conhecem o campo — o lojista não consegue
  ligar/desligar nada hoje.
- `atualizarPerfilAdmin` (admin) também não referencia o campo.
- `criarPedido` (`src/lib/actions/pedido.ts`) não devolve `whatsappHref`.
- `useEnviarPedido.ts` não tem a mecânica de pré-abrir aba (RN-A5) nem
  qualquer lógica de disparo automático — continua só chamando `criarPedido`
  e navegando para a confirmação.

Ou seja: a coluna existe no banco, mas está "morta" — nada lê nem escreve
nela fora dos testes. Todos os behaviors abaixo seguem `[ ]` até essa fiação
ser feita.

## Status da verificação (2026-09-06)

Implementação completa e commitada (issues 122, 123, 124, 125, 126).

**Verificado em navegador, com clique e digitação reais** — os 5 behaviors do
painel marcados `[x]`:
- Toggle desabilitado com a dica quando a loja não tem WhatsApp.
- Habilita ao cadastrar WhatsApp.
- **Desligar, salvar e recarregar do zero mantém `false`** — o caso que a
  implementação quase errou (com spread condicional o `false` seria omitido do
  payload e o lojista nunca conseguiria desligar). Confirmado também no banco.
- Paridade admin provada com DUAS lojas de donos distintos: a escrita foi para a
  loja-alvo e a loja do próprio admin ficou intacta.

**Os 4 behaviors do checkout seguem `[ ]` por falta de verificação em navegador,
não por falta de implementação.** O código está pronto e coberto por 47 testes,
incluindo um que trava a ORDEM da pré-abertura (mover a abertura para depois do
`await` deixa vermelho) e o fix de reverse tabnabbing. O que faltou foi o
ambiente:
- O dev local aponta para o Supabase de PRODUÇÃO, que tem contas de pessoas reais.
- A `loja-smoke` tem trial vencido em 28/06/2026, então o gate de assinatura fecha
  a vitrine antes do checkout.
- Estender `assinatura_fim_periodo` é escrita em coluna de billing em produção, e
  está corretamente bloqueada pelo classificador de permissão.

Fechar esses 4 exige subir o Supabase LOCAL (`npx supabase start` + `db reset`),
onde a loja de teste é descartável. Depende de acesso ao Docker na máquina.

## Visão Geral

O spec `3-whatsapp-envio-pedido.md` (commit `eb220b5`) entregou o botão manual
**"Avisar a loja no WhatsApp"** na tela de confirmação — o cliente toca e o link
`api.whatsapp.com/send` abre com o resumo do pedido pré-preenchido. O disparo é
sempre um gesto manual do cliente.

Esta feature adiciona uma **preferência da loja**: um toggle no painel do lojista
(**"Enviar a mensagem de WhatsApp automaticamente ao confirmar o pedido"**) que,
quando ligado, dispara a abertura do WhatsApp **assim que o cliente confirma o
pedido**, sem precisar clicar no botão manual. O botão manual continua **sempre
visível** quando a loja tem WhatsApp (o cliente pode reenviar). Default do
toggle: **LIGADO**.

A preferência é editável nos **dois mundos** do painel — pelo próprio lojista
(`/painel/configuracoes/perfil`) e pelo dono do SaaS editando lojas de terceiros
(`/admin/assinantes/[lojaId]/configuracoes`) — reusando o mesmo `montarPatchPerfil`
e respeitando o enforcement de escopo por tenant (`escopo.atualizarLoja`, PRs
#99/#100/#101; `specs/paridade-hub-admin-painel.md`).

> **Fronteira de autoridade (herdada do spec 3, reforçada):** a mensagem de
> WhatsApp continua sendo **conveniência de notificação, nunca a fonte de verdade**.
> O pedido já foi persistido pela Server Action `criarPedido` (RPC
> `criar_pedido_idempotente`). O envio automático é **best-effort**: se o navegador
> bloquear o popup ou o cliente fechar a aba, o pedido segue salvo e válido no
> painel, e o botão manual continua disponível. A verdade do pedido e do valor é
> **sempre** o registro do banco lido no painel.

**Mundos:** painel (auth — o toggle) + vitrine pública (sem auth — o disparo no
checkout/confirmação). Não há dinheiro nesta feature.

## Atores Envolvidos

- **iRango (SaaS):** persiste a preferência (`lojas.whatsapp_envio_automatico`);
  monta o link do WhatsApp **server-side** a partir do pedido autoritativo
  (reuso de `montarLinkWhatsappPedido`); decide **no servidor** se o link é
  emitido (flag ligada + loja tem WhatsApp). O dono do SaaS pode editar a
  preferência de qualquer loja pelo painel admin.
- **Lojista:** liga/desliga o toggle em `/painel/configuracoes/perfil`.
- **Cliente:** ao confirmar o pedido, tem o WhatsApp aberto automaticamente (se a
  loja optou por isso) e/ou usa o botão manual. O envio parte do WhatsApp **dele**.

## Páginas e Rotas

### Configurações → Perfil (painel do lojista) — `/painel/configuracoes/perfil`

**Mundo:** painel (auth obrigatório) — escopo `auth.uid() = lojas.dono_id`.

**Descrição:** aba onde o lojista já edita nome, slug, telefone, **whatsapp** e
endereço (`PerfilClient.tsx` + Server Action `salvarPerfil`). Ganha um novo
controle **Switch** — "Enviar a mensagem de WhatsApp automaticamente ao confirmar
o pedido" — logo abaixo do campo de WhatsApp (contexto coerente: só faz sentido
quando há WhatsApp). Quando `whatsapp` está vazio, o toggle aparece desabilitado
com dica ("Cadastre um WhatsApp para ativar o envio automático").

**Componentes:**
- `Switch` (shadcn/ui) + `Label` — reuso; não criar toggle novo.
- `PerfilClient.tsx` — estender o `react-hook-form` já existente com o campo
  booleano `whatsapp_envio_automatico`.
- Server Action `salvarPerfil` (`src/lib/actions/loja.ts`) — reuso; estender
  `schemaPerfil` + `DadosPerfil` + `montarPatchPerfil`.

**Behaviors:**
- [x] Ver o estado atual do toggle (ligado por default). Garantido em: SSR — valor
  lido de `lojas.whatsapp_envio_automatico` na carga da página (`buscarLojaDoDono`).
- [x] Ligar/desligar o toggle e salvar. Garantido em: **Server Action + RLS** —
  `salvarPerfil` valida (`schemaPerfil`), monta patch por allowlist
  (`montarPatchPerfil`) e grava em `lojas` escopado por `dono_id`
  (`lojas_update_proprio`). O valor do toggle no cliente é só UX; o servidor
  regrava a coluna a partir do payload validado.
- [x] Ver o toggle desabilitado quando a loja não tem WhatsApp. Garantido em:
  cliente (UX) — condicional sobre `whatsapp` carregado no SSR. (A ausência de
  WhatsApp já impede o envio no servidor de qualquer forma — RN-A3.)

---

### Configurações da loja (painel admin SaaS) — `/admin/assinantes/[lojaId]/configuracoes`

**Mundo:** painel admin (auth obrigatório) — dono do SaaS editando loja de
terceiro; escopo por tenant via `escopo.atualizarLoja` (não RLS de dono).

**Descrição:** `ConfiguracaoAdminClient.tsx` espelha a aba de perfil do lojista
(paridade — `specs/paridade-hub-admin-painel.md`). Ganha **o mesmo Switch**,
gravando na loja-alvo (`lojaId`), não na loja do admin.

**Componentes:**
- `Switch` + `Label` — o mesmo bloco do painel do lojista (paridade visual).
- Server Action `atualizarPerfilAdmin` (`src/app/admin/assinantes/actions/admin-perfil.ts`)
  — reuso; já usa `montarPatchPerfil` + `escopo.atualizarLoja`. Estender só o
  schema/dados; o patch já flui pelo mesmo `montarPatchPerfil`.

**Behaviors:**
- [x] Ver e alternar o toggle da **loja-alvo**. Garantido em: **Server Action +
  binding por tenant** — `prepararContextoAdmin(lojaId)` + `escopo.atualizarLoja`
  injeta `.eq("id", lojaId)` por construção (PRs #99/#101). O cliente admin nunca
  escolhe qual loja é gravada; o `lojaId` vem da rota validada
  (`validarLojaIdAdmin`), não do payload.
- [x] Não conseguir escrever coluna somente-servidor por essa via. Garantido em:
  Server Action — `CAMPOS_LOJA_SOMENTE_SERVIDOR` é backstop de runtime;
  `whatsapp_envio_automatico` **não** está nessa lista (é preferência, não
  billing) → é permitida por design. Ver Segurança.

---

### Confirmação do pedido — `/loja/[slug]/confirmacao?pedido=<id>&token=<token>`

**Mundo:** vitrine pública (sem auth) — leitura escopada por `token_acesso`.

**Descrição:** sem mudança visual. O botão manual "Avisar a loja no WhatsApp"
(spec 3) continua **sempre visível quando a loja tem WhatsApp**, independente do
toggle (requisito fixo 2). O disparo automático **não** acontece aqui — acontece
no handler de "Confirmar pedido" da página anterior (ver decisão técnica abaixo),
para aproveitar o gesto real do usuário e não esbarrar em bloqueio de popup.

**Componentes:** inalterados (bloco "Avisar a loja" do spec 3).

**Behaviors:**
- [ ] Ver o botão manual sempre que a loja tem WhatsApp, com ou sem envio
  automático ligado. Garantido em: cliente (UX) sobre dado server-side
  (`lojas.whatsapp`). (Comportamento já existente do spec 3; esta feature apenas
  **não o remove**.)

---

### Checkout — confirmar pedido — `/loja/[slug]/pedido`

**Mundo:** vitrine pública (sem auth).

**Descrição:** é aqui que o disparo automático nasce. O botão "Confirmar pedido"
(`CheckoutWizard` / `useEnviarPedido`) passa a, **no mesmo clique**, abrir o
WhatsApp automaticamente quando a loja optou por isso — sem bloqueio de popup,
porque a abertura acontece dentro do gesto do usuário.

**Componentes:**
- `useEnviarPedido.ts` — estender o handler `enviar`.
- `criarPedido` (`src/lib/actions/pedido.ts`) — estender o retorno para incluir o
  `whatsappHref` autoritativo (ver Modelos/Regras).
- `montarLinkWhatsappPedido` — **reuso** (já monta o link server-side a partir do
  `PedidoComItens` + loja). Nada de recriar montagem de mensagem.
- checkout `page.tsx` — expor `envioAutomatico` (flag) + presença de WhatsApp ao
  `CheckoutWizard`, para o cliente decidir se pré-abre a aba.

**Behaviors:**
- [ ] Ao confirmar, se a loja optou por envio automático e tem WhatsApp, o
  WhatsApp abre sozinho com o resumo do pedido. Garantido em: **servidor
  (autoritativo) para o CONTEÚDO e a DECISÃO de emitir o link** + cliente (UX)
  para a mecânica de abrir a aba. Detalhe abaixo.
- [ ] Se o navegador bloquear o popup (ou não for envio automático), o pedido é
  confirmado normalmente e o cliente segue para a confirmação com o botão manual.
  Garantido em: por design — envio é best-effort, não bloqueia o checkout (RN-A4).
- [ ] O conteúdo da mensagem reflete o pedido real recém-criado. Garantido em:
  **Server Action** — `criarPedido` monta o `href` com `montarLinkWhatsappPedido`
  a partir do pedido autoritativo que acabou de gravar, nunca dos valores do
  carrinho do cliente.

## Modelos de Dados

**Migration já aplicada:** `supabase/migrations/20260704120000_lojas_whatsapp_envio_automatico.sql`

```sql
ALTER TABLE lojas
  ADD COLUMN whatsapp_envio_automatico boolean NOT NULL DEFAULT true;
```

- Naming: snake_case, `boolean NOT NULL DEFAULT` — mesmo padrão de `ativo`,
  `logo_url` (`schema.md` §lojas). Default `true` cumpre o requisito 3 (ligado).
  `NOT NULL` evita tri-estado; lojas existentes já ficam ligadas (comportamento
  atual = notificar).
- **Leitura no checkout/criarPedido:** `buscarLojaParaPedido` já faz `.select("*")`
  de `lojas` com service_role — a coluna nova entra automaticamente. `criarPedido`
  já chama essa query (`pedido.ts:69`), então a flag autoritativa está disponível
  onde o link é montado. **Sem mudança de query.**
- **Leitura na aba perfil (painel):** `buscarLojaDoDono` faz `.select("*")` →
  coluna disponível.
- **Leitura no checkout page (client):** verificar a query usada por
  `buscarLojaPorSlug`. Se ela lê `lojas` via service_role (`.select("*")`), a
  coluna já vem. Se ler a **view `vitrine_lojas`**, adicionar a coluna à view na
  mesma migration (a flag não é PII/sensível — ver Segurança). Este valor do
  cliente é usado **só** para decidir pré-abrir a aba; a decisão real é do servidor.
- **RLS:** nenhuma política nova. `lojas` já tem UPDATE do dono
  (`lojas_update_proprio`) e escrita admin via service_role escopada por `id`
  (`escopo.atualizarLoja`). A coluna nova cai sob essas políticas existentes.

## Regras de Negócio

**RN-A1 — Persistência e default.** `lojas.whatsapp_envio_automatico`, `NOT NULL
DEFAULT true`. Escrito por `montarPatchPerfil` (allowlist), nas duas vias
(lojista via `salvarPerfil`; admin via `atualizarPerfilAdmin`/`escopo.atualizarLoja`).
Camada: **Server Action** (valor validado por `schemaPerfil` — booleano opcional)
+ CHECK implícito do tipo `boolean`/`NOT NULL` no banco.

**RN-A2 — Decisão de emitir o link é do servidor.** `criarPedido` só devolve
`whatsappHref != null` quando **`loja.whatsapp_envio_automatico === true` E a loja
tem WhatsApp** (`montarLinkWhatsappPedido` já retorna `null` sem WhatsApp — RN-W3
do spec 3). O cliente **não** decide se dispara; ele só reage ao que o servidor
devolveu. Camada: **Server Action**.

**RN-A3 — Botão manual independe do toggle.** A confirmação sempre mostra o botão
manual quando `lojas.whatsapp` existe, ligado ou não o automático (requisito 2).
Camada: cliente (UX) sobre dado server-side; sem acoplamento com a flag.

**RN-A4 — Envio automático é best-effort.** O checkout **nunca falha** por causa
do WhatsApp. Se o popup for bloqueado, se o `href` vier `null`, ou se a aba não
abrir, o fluxo segue para a confirmação normalmente. Camada: por design (o
`router.push` para a confirmação não depende do resultado do `window.open`).

**RN-A5 — Mecânica anti-bloqueio de popup (decisão técnica).** Navegadores
bloqueiam `window.open` fora de um gesto do usuário, e Safari invalida o gesto
após um `await`. Padrão escolhido, dentro do handler de clique de "Confirmar
pedido" (`useEnviarPedido.enviar`):
  1. **Síncrono, antes do `await criarPedido`:** se o cliente sabe (via flag
     exposta no SSR do checkout) que é envio automático e a loja tem WhatsApp,
     abre uma aba em branco: `const janela = window.open("", "_blank")` — isso
     preserva o gesto do usuário.
  2. `await criarPedido(payload)` → retorno passa a incluir `whatsappHref: string
     | null` (autoritativo, RN-A2).
  3. Sucesso **e** `whatsappHref` **e** `janela`: `janela.location.href =
     whatsappHref`. Caso contrário: `janela?.close()` (fecha a aba em branco).
  4. `router.push(confirmacao...)` **na mesma aba** (fluxo inalterado).
  - **Trade-off documentado:** há um flash de aba em branco antes do redirect
    dela; em falha, fechamos a aba. Alternativas descartadas: (a) `window.open`
    no `mount` da confirmação → bloqueado (sem gesto); (b) `window.location.href`
    na confirmação → tira o cliente da página e re-dispara no F5; (c) auto-clique
    no botão → não confiável. A opção escolhida é a única que sobrevive ao gap
    assíncrono do `criarPedido` mantendo o cliente na confirmação.
  - Camada: **cliente (UX/mecânica)**; o conteúdo e a permissão de emitir o link
    são do **servidor** (RN-A1/RN-A2). A flag no cliente é só um preview para
    pré-abrir a aba — se divergir do servidor (ex.: flag desligada de fato), a aba
    em branco é fechada; nada é enviado. O servidor é a verdade.

**RN-A6 — Conteúdo da mensagem inalterado.** Mesma composição do spec 3 (RN-W1),
montada por `montarLinkWhatsappPedido` server-side a partir do pedido
autoritativo. `token_acesso` nunca entra na mensagem. Camada: **Server Action**.

## Segurança (obrigatório)

- **Há dinheiro nesta feature? Não.** É preferência de notificação. Nenhum valor é
  definido pelo cliente; a mensagem só formata o snapshot autoritativo já gravado
  no checkout (`seguranca.md` §10). Nenhum recálculo monetário novo.
- **Superfície de permissão real — o update de `lojas` cross-tenant.** O ponto
  sensível **não é dinheiro, é escopo**: o painel admin edita loja de terceiro. A
  gravação usa `escopo.atualizarLoja` (injeta `.eq("id", lojaId)` por construção,
  service_role sob BYPASSRLS), com `lojaId` vindo da rota validada, nunca do
  payload (PRs #99/#100/#101; incidente 2026-07-03 coberto por
  `admin-loja.binding.test.ts`). **Nenhuma escrita nova fora desse wrapper.**
- **Débito task 115 (allowlist do `atualizarLoja`).** Estado atual: o admin usa
  **blocklist** `CAMPOS_LOJA_SOMENTE_SERVIDOR` (billing/identidade/consentimento)
  como backstop de runtime, e o patch já passa antes por `montarPatchPerfil`
  (allowlist explícita coluna-a-coluna). `whatsapp_envio_automatico` é preferência
  operacional → **fica de fora da blocklist** (é permitido gravar), e **entra na
  allowlist de `montarPatchPerfil`** (só é gravado se validado). Não requer
  reabrir a task 115; se a task migrar de blocklist→allowlist depois, a coluna
  entra na allowlist permitida — anotar como dependência leve, não bloqueante.
- **RLS nova? Não.** Coberto por `lojas_update_proprio` (dono) + escopo admin
  existente. A migration só adiciona coluna; sem policy nova.
- **Dado sensível na vitrine?** A flag `whatsapp_envio_automatico` **não é PII nem
  billing** — expor no caminho de leitura do checkout (ou na view `vitrine_lojas`,
  se for esse o caminho) é aceitável. O `whatsapp` da loja já é público (contato).
  Nenhum novo dado sensível é exposto.
- **API externa com key? Não.** Continua `api.whatsapp.com/send` (link público,
  sem chave, sem custo). Nada de WhatsApp Business API.
- **XSS/injeção:** `href` montado por `montarLinkWhatsappPedido` (número
  normalizado a dígitos, texto em `encodeURIComponent`) — inalterado do spec 3. O
  `whatsappHref` trafega do servidor para o cliente como string já pronta; o
  cliente só atribui a `janela.location.href` (URL `https://api.whatsapp.com/...`),
  sem `dangerouslySetInnerHTML`.

**Criticidade de segurança:** média. Não há dinheiro/RLS nova, mas **toca a
superfície de escrita cross-tenant de `lojas`** — a issue de painel admin deve
ser marcada crítica o suficiente para exigir teste do binding por tenant
(`escopo.atualizarLoja` grava a loja-alvo, não outra), reusando o padrão de
`admin-loja.binding.test.ts`. A issue do lojista e a do checkout não são críticas
de valor/RLS.

## Fora do Escopo (v1)

- **Envio automático server-side de verdade** (WhatsApp Business API / gateway) —
  custo variável, proibido por `architecture.md` §9; fase futura (spec 3, Fora do
  Escopo). Aqui o "automático" é só disparar o mesmo link client-side sem o
  segundo clique.
- **Personalizar o texto da mensagem pelo lojista** — mensagem fixa (spec 3).
- **Escolher o momento do disparo** (ex.: só em pedidos acima de X) — toggle é
  binário.
- **Notificação em tempo real / push ao painel** — issue separada
  (`architecture.md` §10; spec `1-status-automatico-confirmacao.md`).
- **Confirmação de leitura/entrega da mensagem** — o iRango não tem visibilidade
  do WhatsApp do cliente.
