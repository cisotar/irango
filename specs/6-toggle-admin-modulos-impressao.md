# Spec: Toggle admin dos módulos de impressão (A4 e Térmica) por loja

**Versão:** 0.1.0 | **Atualizado:** 2026-07-08

> **Cross-reference obrigatório:** esta spec é a **contraparte de provisionamento**
> da spec 4 (`specs/4-impressao-pedido.md`, issues 127–139, **em produção**). A
> spec 4 criou as flags `lojas.modulo_impressao_a4` / `lojas.modulo_impressao_termica`,
> o util `variantesHabilitadas(loja)` e o trigger `lojas_protege_billing()` v3, e
> **lê** o entitlement para gatear o seletor de impressão. Esta spec 6 adiciona a
> **única forma legítima de o dono do SaaS ligar/desligar essas flags** — um toggle
> manual no hub admin. **Nada aqui redefine o que a spec 4 já entregou; só o
> consome e o complementa.** Zero coluna nova.

## Visão Geral

Hoje as duas flags de módulo de impressão nascem `false` (fail-closed) e **não há
nenhuma UI que as ligue**. O trigger `lojas_protege_billing()` v3 e a constante
`CAMPOS_LOJA_SOMENTE_SERVIDOR` bloqueiam o lojista de setá-las (por design), e a
action admin genérica `escopo.atualizarLoja` **descarta** essas chaves em runtime
(também por design — spec 4, RN-M3). Resultado: hoje só um `UPDATE` manual no banco
liga um módulo. Isso não escala.

Esta feature entrega o **override manual do dono do SaaS**: dois `Switch` no hub
admin da loja-alvo ("Módulo Impressão A4/PDF" e "Módulo Impressão Térmica"), ligados
a uma **Server Action admin dedicada** que sete a flag via `service_role`, fora do
filtro de `atualizarLoja`. É o mesmo padrão das ações de billing já existentes
(`concederCortesia`/`suspenderLoja` em `admin/assinantes/actions.ts`), que também
escrevem colunas somente-servidor de `lojas` por um caminho dedicado.

**É override MANUAL de provisão, SEM cobrança/checkout.** O fluxo de venda/billing
do módulo (oferta, pagamento, webhook) continua **fora de escopo** — outra spec
(spec 4 §"Fora do Escopo"). Aqui o admin simplesmente decide: esta loja tem/não tem
o módulo.

**Em qual mundo vive:** **painel admin do SaaS** (`/admin/*`, guard
`verificarAdminSaaS()`). Não é vitrine pública nem painel do lojista. O lojista
**nunca** vê nem opera este controle.

---

## Atores Envolvidos

- **iRango (SaaS / admin):** único ator que opera esta feature. No hub admin da
  loja-alvo, liga/desliga cada módulo de impressão. A decisão é
  **server-autoritativa** (`verificarAdminSaaS()` + `service_role`); a UI é só
  gesto + feedback otimista.
- **Lojista:** **não participa.** Não há rota, componente nem action de lojista que
  toque essas flags. Mesmo forjando request, é barrado em três camadas
  (`CAMPOS_LOJA_SOMENTE_SERVIDOR`, trigger `lojas_protege_billing()`, ausência de
  action). É **consumidor passivo** do efeito: ao ligar o módulo, o seletor de
  impressão da spec 4 passa a mostrar as variantes correspondentes no painel dele.
- **Cliente:** não participa e não é afetado diretamente.

---

## Páginas e Rotas

### Configuração da loja-alvo (hub admin) — `/admin/assinantes/[lojaId]/configuracoes`

**Mundo:** painel admin (auth admin — `verificarAdminSaaS()`). O guard vive em
`admin/assinantes/layout.tsx` (subárvore) e é re-provado por request nos loaders
`service_role` (`carregarLojaAdmin` → `carregarCabecalhoLojaAdmin`). Layout
`[lojaId]/layout.tsx` é `force-dynamic` (dados da loja-alvo mudam a qualquer ação
admin — nunca cachear).

**Descrição:** página já existente (Server Component `ConfiguracaoAdminPage`) que
hoje carrega o agregado da loja via `carregarLojaAdmin(lojaId)` e renderiza
`ConfiguracaoAdminClient` (espelho dos painéis editáveis pelo lojista: perfil,
horários, tema, entregas, pagamentos). Passa a **também** renderizar um **card
admin-only dedicado "Módulos pagos (controle do SaaS)"** com os dois switches.

> **Onde inserir (decisão firme).** O card **NÃO** entra dentro de
> `ConfiguracaoAdminClient` — aquele componente é estritamente o espelho dos painéis
> que o **próprio lojista edita**; misturar um controle de billing/entitlement
> admin-only ali confunde as duas naturezas. Em vez disso, a page renderiza um
> **novo Client Component `ModulosImpressaoAdmin`** irmão de `ConfiguracaoAdminClient`
> (acima dele), visualmente distinto (tratamento âmbar/admin, como a faixa de
> contexto do `layout.tsx`), deixando claro que é poder do SaaS, não config do
> lojista.

> **Custo de dado: zero query nova.** `carregarLojaAdmin` já devolve
> `loja: LojaCompleta` (`= Tables<"lojas">`) via `buscarLojaAdminPorId` com
> `select("*")` — as colunas `modulo_impressao_a4`/`modulo_impressao_termica` **já
> chegam** ao Server Component. A page só passa `loja.modulo_impressao_a4` /
> `loja.modulo_impressao_termica` como estado inicial dos switches. Nenhum loader
> novo, nenhuma política RLS nova.

**Componentes:**
- `ConfiguracaoAdminPage` (`.../configuracoes/page.tsx`) — **Server Component
  existente, alteração mínima.** Passa `modulos={{ a4: loja.modulo_impressao_a4,
  termica: loja.modulo_impressao_termica }}` (já em mãos) ao novo card. Sem query
  extra.
- `ModulosImpressaoAdmin` (`.../configuracoes/ModulosImpressaoAdmin.tsx`) —
  **componente novo, Client Component** (`'use client'` — `useTransition` + handler
  DOM + `toast`). Recebe `lojaId` e o estado inicial das flags. Renderiza dois
  `Switch` (label + descrição curta). Espelha **exatamente** o padrão do toggle de
  cortesia em `AcoesAssinante.tsx` (`Switch checked=… disabled={pendente}
  onCheckedChange={…}` + `useTransition` + `toast.success/error`). Ao alternar,
  chama a Server Action dedicada. Sem I/O próprio, sem valor calculado.
- `Switch` (`components/ui/switch.tsx`) — **reuso**, primitivo base-ui já existente
  (o mesmo usado por `AcoesAssinante`). **Não** gerar via `npx shadcn add`
  (puxaria Radix errado — ver memória do projeto).
- `Label` (`components/ui/label.tsx`), `Card`/`Separator`/`Badge` (`components/ui/`)
  — reuso, sem mudança de contrato.
- `alternarModuloImpressao` (`admin/assinantes/actions/admin-modulos-impressao.ts`)
  — **Server Action nova** (detalhe em Regras de Negócio + Segurança).
- `variantesHabilitadas` (`lib/utils/variantesHabilitadas.ts`) — **reuso** (spec 4).
  Não é chamado nesta page; é o consumidor a jusante que reflete a flag. Citado para
  deixar explícita a fonte única do mapa módulo→variante.

**Behaviors:** _(✅ implementado + testado; verificado end-to-end contra cloud com
browser real em 2026-07-08 — issues 142/143/144)_
- [x] Ver os dois switches ("Módulo Impressão A4/PDF" e "Módulo Impressão Térmica")
  com o **estado atual** (ligado/desligado) de cada módulo da loja-alvo. Garantido
  em: **Server (loader `service_role` escopado por `lojaId`)** — o estado inicial é
  a verdade do banco lida por `carregarLojaAdmin`; o cliente só renderiza. ✅ (144 +
  verificado: `aria-checked` refletiu o banco)
- [x] Ligar/desligar o **Módulo A4/PDF** → chama `alternarModuloImpressao(lojaId,
  "a4", ativo)`. Garantido em: **Server Action + trigger/allowlist no banco**
  (`verificarAdminSaaS()` → `service_role` → `UPDATE ... .eq("id", lojaId)`,
  nome de coluna vindo de mapa server-side fixo). Cliente: switch otimista + toast
  (preview de UX, **não autoritativo**). ✅ (142/143)
- [x] Ligar/desligar o **Módulo Térmica** → chama `alternarModuloImpressao(lojaId,
  "termica", ativo)`. Garantido em: **Server Action + trigger/allowlist no banco**
  (idem acima). Cliente: switch otimista + toast (preview de UX). ✅ (142/143 +
  verificado: persistiu pós-reload; seletor da spec 4 colapsou p/ botão único A4)
- [x] Ver **toast de sucesso** ao concluir e o switch refletindo o novo estado; em
  falha, **toast de erro** e o switch volta ao estado anterior (rollback otimista).
  Garantido em: cliente (UX) a partir do `{ ok }` retornado pela Server Action
  (autoridade no servidor). ✅ (toasts verificados no browser; rollback visual coberto
  por replay de erro — `{ok:false}` sem crash; limite do renderToStaticMarkup
  documentado no teste)
- [x] Durante a ação, os dois switches ficam `disabled` (`useTransition`) — sem
  duplo-clique/corrida no gesto. Garantido em: cliente (UX). A defesa real contra
  escrita concorrente é o banco (`UPDATE` idempotente por `id`). ✅ (143, teste de
  duplo toggle sequencial)
- [x] **Não** conseguir operar o toggle como lojista — a rota `/admin/*` é barrada
  por `verificarAdminSaaS()` antes de renderizar; a Server Action reprova admin
  antes de qualquer efeito. Garantido em: **Server (guard admin) + Server Action**
  (RLS **não** é a defesa aqui — `service_role` bypassa; o gate é `verificarAdminSaaS()`).
  ✅ (verificado: sessão de lojista real → 307 /painel; sem cookie → 307; replays de
  injeção `"dono_id"`/não-UUID → `{ok:false}` sem efeito)

---

### Consumidores a jusante (referência — spec 4, sem behavior novo aqui)

Ligar/desligar a flag **muda imediatamente** o resultado de `variantesHabilitadas(loja)`
nas páginas que já consomem o entitlement (spec 4), **sem código novo nesta spec**:

- `/painel/pedidos/[id]` (painel do lojista) — seletor "Imprimir" passa a
  mostrar/esconder as variantes. Rota lida por request (query sob RLS), reflete a
  flag na próxima navegação/refresh.
- `/admin/assinantes/[lojaId]/pedidos/[id]` (espelho admin) — idem, via loader
  `service_role`.

Nenhum behavior novo é adicionado a essas páginas. `revalidarLojaAdmin(lojaId)` (ver
Regras de Negócio) cobre a re-renderização das rotas admin cacheáveis + a vitrine.

---

## Modelos de Dados

**Nenhuma coluna nova. Nenhuma tabela nova. Nenhuma política RLS nova.** Esta feature
**reusa** o que a spec 4 já colocou em produção:

| Artefato | Origem (spec 4) | Papel nesta spec |
|---|---|---|
| `lojas.modulo_impressao_a4` `boolean not null default false` | migration `20260707120000` | flag que o toggle A4 escreve |
| `lojas.modulo_impressao_termica` `boolean not null default false` | migration `20260707120000` | flag que o toggle Térmica escreve |
| Trigger `lojas_protege_billing()` v3 (`BEFORE INSERT OR UPDATE`) | migration `20260707121000` | **backstop no banco**: bloqueia lojista; `service_role`/`postgres`/`supabase_admin` **bypassam** (caminho legítimo do toggle admin) |
| `CAMPOS_LOJA_SOMENTE_SERVIDOR` (15 colunas, inclui as duas flags) | `lib/actions/admin-loja.ts` | mantém as flags **fora** de `escopo.atualizarLoja` — por isso o toggle precisa de action dedicada |
| `variantesHabilitadas(loja)` | `lib/utils/variantesHabilitadas.ts` | consumidor a jusante — reflete a flag no seletor de impressão |
| RLS de `lojas` (já existente) | schema/seguranca.md §2 | inalterada — `service_role` bypassa; a defesa é `verificarAdminSaaS()` |

### Dependência de auditoria (registrar, NÃO construir nesta spec)

Esta é uma ação **billing-relevant** (liga/desliga recurso pago). O ideal é gerar
**trilha de auditoria** (quem/quando/qual loja/qual flag/liga-desliga). Hoje
`registrarAcessoAdmin` (`admin-loja.ts`) é **no-op** (débito pré-existente,
`architecture.md` §10 → issue 146 = "tabela de auditoria + retenção"). Decisão desta
spec:

- **v1 (nesta spec):** a Server Action **chama** `registrarAcessoAdmin(svc, { lojaId,
  acao: "alternar_modulo_impressao", metadados: { modulo, ativo } })` — ponto de
  extensão já cabeado, hoje no-op. **Não** construímos a tabela de auditoria aqui.
- **Dependência registrada:** quando a issue 146 criar a tabela de auditoria (**nova
  tabela → exige política RLS própria antes de produção**, `seguranca.md` §2:
  deny-all ao lojista, acesso só `service_role`/admin), esta ação já estará
  emitindo o evento. Marcar 146 como consumidora deste `acao`.

---

## Regras de Negócio

**RN-1 — Server Action dedicada, fora do filtro de `atualizarLoja`.**
`alternarModuloImpressao(lojaId, modulo, ativo)` (`admin/assinantes/actions/admin-modulos-impressao.ts`,
`'use server'`) **espelha o padrão de `concederCortesia`/`suspenderLoja`**
(`admin/assinantes/actions.ts`) — a via já provada de escrever coluna somente-servidor
de `lojas` via `service_role`. Ordem fail-closed obrigatória:
1. `validarLojaIdAdmin(lojaId)` (`z.guid`) **antes de qualquer efeito** — inválido →
   `{ ok:false, erro:"Loja inválida." }` sem tocar admin/service/update.
2. Validar `modulo` contra **union fixo** `"a4" | "termica"` e `ativo` como `boolean`
   (zod). Mapear `modulo` → **nome de coluna por constante server-side**
   (`{ a4: "modulo_impressao_a4", termica: "modulo_impressao_termica" }`) — **nunca**
   interpolar string do cliente como nome de coluna (ver Segurança).
3. `verificarAdminSaaS()` **fora do `try`** → a exceção **propaga** (fail-closed,
   D-4); `createServiceClient()` só depois.
4. `UPDATE lojas SET <coluna> = <ativo> WHERE id = lojaId` com `count:"exact"`, via
   helper dedicado (não `escopo.atualizarLoja`, que descartaria a chave). `.eq("id",
   lojaId)` satisfaz o enforcement de escopo (`enforcement-escopo-admin.test.ts`
   camada 3: `.from(...).update()` cru exige `.eq(...)`). `linhasAfetadas === 0` →
   `{ ok:false, erro:"Loja não encontrada." }`.
5. `registrarAcessoAdmin(svc, { lojaId, acao:"alternar_modulo_impressao",
   metadados:{ modulo, ativo } })` (no-op hoje) → `revalidarLojaAdmin(lojaId)` →
   `{ ok:true }`. `catch` genérico com mensagem neutra (`seguranca.md` §14).

Camada: **Server Action (autoridade) + banco (backstop)**.

> **Por que não `escopo.atualizarLoja`:** ele filtra em runtime toda chave de
> `CAMPOS_LOJA_SOMENTE_SERVIDOR` — as duas flags de módulo estão lá (por design da
> spec 4, para barrar o lojista). Passar o patch por ele viraria no-op silencioso. O
> toggle é **caminho explícito de billing/admin**, exceção legítima documentada —
> exatamente como `aplicarStatusAdmin` (assinatura) e `persistirAssinaturaLoja`
> (billing) já fazem `svc.from("lojas").update(...).eq("id", lojaId)` direto.

**RN-2 — O cliente só envia `lojaId`, `modulo` e `ativo`; nenhum valor autoritativo.**
Não há valor monetário nem estado derivado no payload. `ativo` é um booleano que o
servidor grava tal-e-qual **após** provar admin — não é um "quanto paga". `modulo` é
um seletor de **qual** coluna, resolvido a nome real por mapa server-side. Camada:
**Server Action**.

**RN-3 — Estado inicial = verdade do banco, fail-closed na leitura.** Os switches
iniciam refletindo `loja.modulo_impressao_*` lido pelo loader `service_role`
escopado. `undefined`/dúvida → tratar como **desligado** (fail-closed, coerente com
`variantesHabilitadas` que só habilita em `=== true`). Camada: **Server (loader)**;
render no cliente.

**RN-4 — Feedback otimista é só UX; a autoridade é o `{ ok }` do servidor.** O switch
pode antecipar o novo estado, mas em `{ ok:false }` **volta** ao estado anterior +
`toast.error`. O estado "verdadeiro" é o que o próximo carregamento do servidor
mostrar. Camada: cliente (UX) sobre autoridade do servidor.

**RN-5 — Idempotência natural + revalidação.** Ligar um módulo já ligado (ou desligar
já desligado) é um `UPDATE` que ainda casa 1 linha por `id` → `{ ok:true }`, sem
efeito colateral. Após sucesso, `revalidarLojaAdmin(lojaId)` invalida
`/admin/assinantes`, `/admin/assinantes/${lojaId}` e `/loja/[slug]`. As rotas de
detalhe de pedido (`/painel/pedidos/[id]`, `/admin/.../pedidos/[id]`) são lidas por
request (força dinâmica/RLS), refletindo a flag na próxima navegação sem revalidate
explícito. Camada: **Server Action**.

**RN-6 — Independência dos módulos.** A4 e Térmica são flags independentes: qualquer
combinação (nenhum, um, outro, ambos) é válida — o toggle escreve **uma coluna por
vez**. Coerente com a spec 4 (RN-M2: Módulo A→`a4`; Módulo B→`cozinha`+`recibo`).
Camada: banco (colunas independentes) + Server Action (escrita atômica por coluna).

**RN-7 — Lojista jamais liga o próprio módulo.** Defesa em profundidade (herdada da
spec 4, reforçada aqui): (a) não existe rota/action de lojista para isso; (b)
`CAMPOS_LOJA_SOMENTE_SERVIDOR` mantém as flags fora de `escopo.atualizarLoja` e das
actions do lojista (`salvarPerfil`/`salvarHorarios`/`salvarTema`, patch explícito);
(c) trigger `lojas_protege_billing()` v3 no banco levanta `EXCEPTION` se qualquer
role ≠ `service_role`/`postgres`/`supabase_admin` tentar mudar a coluna — backstop
mesmo se o código falhar. Camada: **RLS/allowlist + trigger no banco + guard admin**.

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai?** Não há PII nova. O payload é `{ lojaId (UUID),
  modulo ("a4"|"termica"), ativo (bool) }`. Nenhuma chave Pix, cupom ou dado de
  cliente trafega. `lojaId` é identificador de tenant, validado como UUID
  server-side (`validarLojaIdAdmin`), **nunca** confiado cru para escopo.
- **Valor monetário?** **Não há valor calculado no cliente.** A flag é booleana,
  **server-set**: o cliente manda `ativo`, o servidor grava após provar admin. Não
  existe "quanto paga" nesta feature (a cobrança do módulo é outra spec). Logo,
  **nenhum recálculo monetário** é exigido — o análogo do "recálculo no servidor"
  aqui é a **decisão de permissão ser server-autoritativa**: `verificarAdminSaaS()` +
  `service_role`, nunca o cliente decidindo entitlement (`seguranca.md` §10 aplicado
  a permissão em vez de dinheiro).
- **Decisão de permissão/entitlement → server-autoritativa.** Só o admin do SaaS
  altera. Gate: `verificarAdminSaaS()` (fail-closed, lança se env ausente) **antes**
  de elevar a `service_role`, **fora do `try`** (D-4 — a exceção propaga, não vira
  `{ok:false}` amigável). RLS **não** é a defesa (service_role bypassa) — é o guard
  admin + o escopo por `id`.
- **Injeção de nome de coluna (vetor específico deste toggle).** `modulo` vem do
  cliente e seleciona **qual coluna** escrever. **Nunca** interpolar a string do
  cliente como identificador de coluna. Validar contra union fixo `"a4"|"termica"` e
  mapear por **constante server-side** para o nome real
  (`modulo_impressao_a4`/`modulo_impressao_termica`). Valor fora do union →
  `{ ok:false }` sem tocar o banco. Assim o cliente escolhe entre **dois alvos
  pré-aprovados**, não um alvo arbitrário.
- **Backstop no banco (defesa em profundidade).** Mesmo que o filtro de código
  falhasse, o trigger `lojas_protege_billing()` v3 só deixa `service_role`/`postgres`/
  `supabase_admin` mudar as flags — um lojista (`authenticated`) via PostgREST forjado
  recebe `EXCEPTION`. O toggle admin roda sob `service_role` (bypass legítimo), o
  lojista não.
- **Tabela/coluna nova?** **Nenhuma** nesta spec — reusa flags + trigger + RLS da
  spec 4. **Se** a auditoria (issue 146) criar tabela nova, ela **exige política RLS
  própria antes de produção** (`seguranca.md` §2): deny-all ao anon/lojista, acesso
  só `service_role`/admin. Fora de escopo desta spec.
- **API externa com key?** Não. Zero rede externa, zero chave, zero custo variável.
- **Auditoria (billing-relevant).** Ação liga/desliga recurso pago → **idealmente
  logada** (quem/quando/qual loja/qual flag/liga-desliga). v1 já **emite** o evento
  via `registrarAcessoAdmin` (no-op hoje); a persistência real é dependência da issue
  146. Marcado como débito conhecido, não silenciado.
- **Enforcement automático herdado.** O novo módulo de action em
  `admin/assinantes/actions/` é auto-descoberto por `enforcement-escopo-admin.test.ts`
  (readdirSync, sem lista manual): camada 2 exige `verificarAdminSaaS`/
  `prepararContextoAdmin` (presente); camada 3 exige `.eq(...)` em `.from(...).update()`
  cru (presente: `.eq("id", lojaId)`). Uma action nova que esqueça o padrão **quebra
  o CI** sem editar a suíte.

---

## Fora do Escopo (v1)

- **Venda/cobrança/checkout do módulo** (página de oferta, pagamento, upsell, webhook
  de billing que ligue a flag automaticamente) — esta spec cobre **só o override
  manual do admin**. A monetização reusa o billing existente e é spec separada (spec 4
  §"Fora do Escopo"). O toggle admin e o webhook são caminhos **complementares** de
  provisão, não concorrentes.
- **Tabela de auditoria + retenção** (issue 146) — a Server Action já **emite** o
  evento (`registrarAcessoAdmin`), mas construir a tabela, RLS e retenção fica para
  146. Dependência registrada, não implementada aqui.
- **CTA de upgrade / autoatendimento do lojista** — o lojista **não** liga o próprio
  módulo em v1 (nem por CTA, nem por request). Provisão é 100% admin/webhook.
- **Histórico de mudanças de flag na UI admin** ("ligado em X por Y") — depende da
  tabela de auditoria; fora de v1.
- **Migração para Opção B do DA-M1** (tabela `loja_modulos` / `planos.recursos jsonb`)
  — v1 continua nas duas colunas booleanas em `lojas` (spec 4, DA-M1 → Opção A). O
  toggle escreve as colunas; se um dia migrar para B, o toggle troca de alvo de
  escrita, não de contrato de UI.
- **Novos módulos pagos além de A4/Térmica** — o toggle cobre exatamente as duas
  flags existentes. Um módulo pago futuro segue o mesmo desenho (coluna booleana em
  `lojas` + `CAMPOS_LOJA_SOMENTE_SERVIDOR` + trigger + util puro), e ganha seu próprio
  switch — fora do escopo desta v1.
- **Bulk toggle** (ligar módulo para várias lojas de uma vez, a partir da lista
  `/admin/assinantes`) — v1 é por loja, no hub da loja-alvo.
