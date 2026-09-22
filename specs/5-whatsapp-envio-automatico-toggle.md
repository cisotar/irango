# Spec: Toggle de envio automático da mensagem de WhatsApp ao confirmar o pedido

**Versão:** 0.3.0 | **Atualizado:** 2026-09-22

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

## Status da revisão v0.3.0 (2026-09-22)

Issue 287 (`plan/loop-aviso-envio-whatsapp-v2.md`) redesenhou a mecânica de disparo automático a
pedido do usuário: um modal de aviso, com contagem regressiva de 5s e saída em dois passos, agora
mora na **página de confirmação** — não mais no handler de clique do checkout. RN-A5 (pré-abrir
aba em branco no checkout) foi **aposentada**; ver RN-A5 e RN-A7 abaixo. O host do link também
mudou, de `api.whatsapp.com/send` para `wa.me` (RN-A6). As descrições de "Checkout" e
"Confirmação do pedido" abaixo foram atualizadas para o desenho novo; os 4 behaviors do checkout
seguem `[ ]` pelo mesmo motivo de antes (falta de Playwright/MCP de browser — issue 176), não por
falta de implementação: 33 testes de `avisoWhatsapp.ts`/`.test.ts` (fase RED do `tdd` + bordas do
`testar`) e a suíte inteira (5623 testes) cobrem a lógica; falta só o clique real.

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

**Descrição [rev v0.3.0]:** o botão manual "Avisar a loja no WhatsApp" (spec 3)
continua **sempre visível quando a loja tem WhatsApp**, independente do toggle
(requisito fixo 2). O disparo automático **agora acontece aqui**, via
`ModalAvisoWhatsapp` (RN-A7): a decisão (`avisoHabilitado`) e o `href` vêm prontos
do SSR desta própria página (`buscarLojaParaPedido` já traz
`whatsapp_envio_automatico` e `whatsapp`; nenhuma query nova). O modal abre uma vez
por pedido, mostra spinner + contagem regressiva de 5s, e navega para o WhatsApp
automaticamente ao fim da contagem (`window.location.href`, navegação top-level —
não exige gesto do usuário) ou por gesto explícito ("Enviar agora"/"Enviar
mensagem", `window.open(..., "noopener")`, mantém a confirmação aberta).

**Componentes:**
- Bloco "Avisar a loja" do spec 3 — inalterado.
- `ModalAvisoWhatsapp.tsx` (novo) — dois passos dentro do mesmo `Dialog` do shadcn
  (molde: `ModalFreteIndisponivel.tsx`).
- `avisoWhatsapp.ts` (novo, módulo puro) — decisão de exibir, gate
  "uma vez por pedido" (`sessionStorage`, chave `aviso-wpp:<pedidoId>`, storage e
  timer injetados por parâmetro), contagem regressiva e guard `https://`
  (`urlHttpsSegura`, reuso — fonte única, `seguranca.md` §15).

**Behaviors:**
- [x] Ver o botão manual sempre que a loja tem WhatsApp, com ou sem envio
  automático ligado. Garantido em: cliente (UX) sobre dado server-side
  (`lojas.whatsapp`). (Comportamento já existente do spec 3; esta feature apenas
  **não o remove**.)
- [ ] Ver o modal de aviso quando o envio automático está ligado, com spinner e
  contagem regressiva de 5s. Garantido em: **servidor** (decisão `avisoHabilitado`)
  + cliente (mecânica de contagem, `avisoWhatsapp.test.ts` cobre a lógica —
  clique real pendente, issue 176).
- [ ] Contagem esgotada sem interação leva ao WhatsApp automaticamente
  (`window.location.href`). Garantido em: módulo puro `avisoWhatsapp.ts`
  (33 testes) — clique real pendente, issue 176.
- [ ] "Agora não" para a contagem e não deixa religar (WCAG 2.2.1); "Enviar
  agora"/"Enviar mensagem" abre o WhatsApp numa aba nova sem tirar o cliente da
  confirmação. Garantido em: `avisoWhatsapp.test.ts` +
  `ModalAvisoWhatsapp.test.tsx` — clique real pendente, issue 176.
- [ ] Voltar do WhatsApp para a confirmação não reabre o modal (gate de uma vez
  por pedido). Garantido em: `sessionStorage` por pedido, testado com fake
  injetado — clique real pendente, issue 176.

---

### Checkout — confirmar pedido — `/loja/[slug]/pedido`

**Mundo:** vitrine pública (sem auth).

**Descrição [rev v0.3.0]:** o checkout **não dispara mais nada de WhatsApp**. O
botão "Confirmar pedido" (`CheckoutWizard` / `useEnviarPedido`) só chama
`criarPedido` e navega para a confirmação (`router.push`) — nenhuma pré-abertura
de aba, nenhuma prop `preAbrirWhatsapp`. O disparo automático se mudou inteiro
para a página de confirmação (ver seção acima e RN-A7); a razão é que navegação
top-level (`window.location.href`) não exige user activation, então a mecânica
anti-bloqueio de popup do checkout deixou de ser necessária (RN-A5, aposentada).

**Componentes:**
- `useEnviarPedido.ts` — handler `enviar` simplificado: `criarPedido` →
  `router.push`, sem ramificação de WhatsApp.
- `criarPedido` (`src/lib/actions/pedido.ts`) — **inalterado nesta revisão**;
  continua devolvendo `whatsappHref` (ver dívida registrada em `tasks/288-*`, o
  campo segue no retorno mesmo sem consumidor no checkout).
- `montarLinkWhatsappPedido` — **reuso**, consumido agora só pela página de
  confirmação (SSR) e pelo botão manual do spec 3.

**Behaviors:**
- [x] O checkout não abre nem tenta abrir WhatsApp — só cria o pedido e navega
  para a confirmação. Garantido em: `useEnviarPedido.test.ts` +
  `.semSchema.test.ts` (ordem `criarPedido:inicio → criarPedido:fim →
  router.push`, nenhuma janela aberta no gesto).
- [x] O conteúdo da mensagem reflete o pedido real recém-criado. Garantido em:
  **Server Action** — `criarPedido` grava o pedido; `montarLinkWhatsappPedido`
  monta o `href` a partir do pedido autoritativo lido no SSR da confirmação,
  nunca dos valores do carrinho do cliente.

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

**RN-A5 — [APOSENTADA em v0.3.0, issue 287].** Mecânica anti-bloqueio de popup do
checkout (pré-abrir `window.open("", "_blank")` sincronamente, antes do `await
criarPedido`, para preservar o gesto do usuário e só depois apontar
`janela.location.href`). Existiu porque o disparo automático vivia no handler de
clique de "Confirmar pedido", onde o `await` mataria a user activation. **Deixou
de ser necessária** quando o disparo se mudou para a página de confirmação
(RN-A7): lá a navegação automática usa `window.location.href` (top-level, não
exige gesto), e a navegação por gesto real usa `window.open(destino, "_blank",
"noopener")` diretamente — sem gap assíncrono no meio, porque `href` já chega
pronto do SSR da confirmação. O teste que travava a ORDEM da pré-abertura
(`useEnviarPedido.test.ts`) foi removido **deliberadamente**: a invariante que
ele protegia não existe mais. `aberturaWhatsapp.ts`/`.test.ts` foram removidos do
código (código morto).

**RN-A6 — Conteúdo da mensagem inalterado; host trocado em v0.3.0.** Mesma
composição de texto do spec 3 (RN-W1), montada por `montarLinkWhatsappPedido`
server-side a partir do pedido autoritativo. `token_acesso` nunca entra na
mensagem. **[rev v0.3.0]** O host do link mudou de `https://api.whatsapp.com/send`
para `https://wa.me` (issue 287, entrega B) — pula a intersticial "Continue to
chat" da Meta, reduzindo a latência sentida pelo comprador antes do WhatsApp
carregar. Mesmo esquema `https://` (passa no guard `urlHttpsSegura`, §15 de
`seguranca.md`); só o host muda, o corpo codificado (`encodeURIComponent`) é
idêntico. Medido no pedido mais longo do `supabase/seed.sql`: URL final ~1,1KB,
bem abaixo do limite prático de navegador (~2000 chars) — não é motivo para
encurtar a mensagem. Camada: **Server Action**.

**RN-A7 — [NOVA, v0.3.0, issue 287] Aviso com contagem regressiva antes da
navegação automática.** Quando `avisoHabilitado` (RN-A2), a página de
confirmação abre `ModalAvisoWhatsapp` uma vez por pedido
(`sessionStorage`, chave `aviso-wpp:<pedidoId>`, por aba — reabrir o link de
confirmação em outra aba reabre o aviso, aceito por design). Passo 1: spinner +
contador de 5s, botão "Enviar agora", saída "Agora não". Contador esgotado sem
interação → `window.location.href = destino` (navegação top-level, sem gesto).
"Enviar agora"/"Enviar mensagem" (gesto real) → `window.open(destino, "_blank",
"noopener")`; se o navegador bloquear o popup (retorno `null`), cai para
`window.location.href` — mesmo destino, sem perder o aviso. "Agora não" **para a
contagem e ela não volta a correr** (WCAG 2.2.1 — Timing Adjustable) e leva ao
passo 2, com a copy:

> **Envie a mensagem no WhatsApp e acelere seu pedido.**

e os botões **[ Enviar mensagem ]** / **[ Sair mesmo assim ]**. **Trava de copy,
obrigatória para qualquer edição futura deste texto:** o pedido **já está
gravado** quando o modal aparece (`criarPedido` já retornou `pedidoId` +
`token_acesso` — é por isso que a confirmação renderiza). A mensagem de WhatsApp
é aviso, **nunca** a fonte de verdade do pedido (RN-W4, spec 3). Nenhuma copy do
modal, em nenhum dos dois passos, pode sugerir cancelamento ou que o pedido não
foi feito/enviado — "cancelar", "pedido não foi feito", "pedido não enviado" são
proibidos por decisão de produto (não é gosto de estilo). O guard `https://`
(`urlHttpsSegura`) é aplicado uma única vez, na criação da contagem
(`criarContagemAviso`), e nenhum dos dois caminhos de navegação ocorre para um
destino reprovado. Se `sessionStorage` estiver indisponível/lançar (aba privada,
storage particionado), o gate falha **fechado**: a contagem não é armada e a
navegação automática não acontece — só os botões manuais funcionam (issue 287,
achado do `auditar`, corrigido antes do PR). Camada: decisão (`avisoHabilitado`,
`href`) é do **servidor**; mecânica de contagem e navegação é **cliente**, sobre
módulo puro testável (`avisoWhatsapp.ts`).

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
- **API externa com key? Não.** **[rev v0.3.0]** `wa.me` no lugar de
  `api.whatsapp.com/send` (RN-A6) — ainda link público, sem chave, sem custo.
  Nada de WhatsApp Business API.
- **XSS/injeção:** `href` montado por `montarLinkWhatsappPedido` (número
  normalizado a dígitos, texto em `encodeURIComponent`) — corpo inalterado do
  spec 3, só o host mudou. O `whatsappHref` trafega do servidor (SSR da
  confirmação, RN-A7) para o cliente como string já pronta, sempre revalidada por
  `urlHttpsSegura` (guard `https://` — `seguranca.md` §15) antes de qualquer
  navegação; o cliente nunca usa `dangerouslySetInnerHTML`.
- **[rev v0.3.0] Anti reverse-tabnabbing.** O hack manual `janela.opener = null`
  (RN-A5, aposentada) foi substituído por `noopener` real em
  `window.open(destino, "_blank", "noopener")` — mitigação equivalente, aplicada
  no ponto de abertura em vez de depois. O caminho sem gesto
  (`window.location.href`) navega na própria aba: não há segunda aba nem
  `opener`, logo nenhum vetor de reverse-tabnabbing ali.

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
