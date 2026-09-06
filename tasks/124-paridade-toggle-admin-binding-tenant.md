# [124] Paridade admin: toggle na configuração da loja-alvo (binding por tenant)

**crítica:** SIM (TDD red-first)
**Mundo:** painel (admin SaaS)
**Depende de:** [122], [123] *(corrigido pelo Plano Técnico — D4: sem 123 o campo não existe em `PerfilInicial` e a única linha de produção desta issue não compila)*
**Spec:** specs/5-whatsapp-envio-automatico-toggle.md

## Objetivo
Espelhar o mesmo Switch em `/admin/assinantes/[lojaId]/configuracoes/perfil`, gravando a
flag na LOJA-ALVO (`lojaId` da rota), reusando `salvarPerfilAdmin` + `escopo.atualizarLoja`.

> **Nota do Plano Técnico:** o espelhamento é obtido por REUSO, não por cópia de JSX —
> o admin já renderiza o mesmo `PerfilClient.tsx` do lojista via `PerfilAdminClient`.
> Ver `## Plano Técnico` → Diagnóstico.

## Escopo
- [ ] ~~`ConfiguracaoAdminClient.tsx`: adicionar o mesmo bloco `Switch` + `Label`~~
  **OBSOLETO** — esse arquivo não existe (aposentado em 152/154) e duplicar markup é
  regressão explícita de `specs/paridade-hub-admin-painel.md`. Substituído por:
- [ ] `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/page.tsx`: repassar
  `whatsapp_envio_automatico: loja.whatsapp_envio_automatico` no objeto `inicial`
  (única mudança de produção). O `Switch` vem por herança do `PerfilClient` compartilhado
  (issue 123; visual em `plan/design-toggle-whatsapp-envio-automatico.md`).
- [ ] Confirmar que `salvarPerfilAdmin` já flui a flag via `CHAVES_PERFIL` (122) +
  `montarPatchPerfil` + `escopo.atualizarLoja` — sem escrita nova fora do wrapper.
- [ ] `npm run build` antes de fechar (o repo usa npm, não pnpm).

## Fora de escopo
- Toggle do lojista (123).
- Checkout / disparo (125/126).
- Migração blocklist→allowlist da task 115 (dependência leve, não bloqueante).

## Reuso esperado
- `salvarPerfilAdmin` + `prepararContextoAdmin` + `escopo.atualizarLoja` — reuso.
- `montarPatchPerfil` / `CHAVES_PERFIL` (122).
- Padrão de teste `src/lib/actions/admin-loja.binding.test.ts` — reusar, não recriar.

## Segurança
- Superfície REAL: escrita cross-tenant em `lojas`. O `lojaId` vem da rota validada
  (`validarLojaIdAdmin`), NUNCA do payload; `escopo.atualizarLoja` injeta `.eq("id", lojaId)`
  por construção (PRs #99/#100/#101; incidente 2026-07-03).
- `whatsapp_envio_automatico` fica FORA de `CAMPOS_LOJA_SOMENTE_SERVIDOR` (permitida por design).

## Critério de aceite
- [ ] (RED-first) Teste de binding: `salvarPerfilAdmin(lojaId, { whatsapp_envio_automatico })`
  grava a flag na loja-alvo e o UPDATE é escopado por `.eq("id", lojaId)` — nunca em outra loja.
- [ ] (RED-first) Teste: um `lojaId` no payload/hostil não redireciona a escrita para outra loja.
- [ ] Vermelho escrito e confirmado ANTES do código; depois verde.
- [ ] Admin liga/desliga o toggle da loja-alvo; a flag da loja do próprio admin permanece intacta.
- [ ] `npm run build` passa.

---

## Plano Técnico

### Diagnóstico

**Causa raiz.** O Escopo desta issue foi escrito contra um mapa do repositório que
não existe mais. Ele manda "adicionar o mesmo bloco `Switch` em
`ConfiguracaoAdminClient.tsx`" — esse arquivo **não existe** (`find . -name
"ConfiguracaoAdmin*"` → vazio; foi aposentado pelas issues 152/153/154). Hoje o
admin **não tem front de perfil próprio**: `PerfilAdminClient.tsx` é um wrapper de
~70 linhas que renderiza o **mesmo** `PerfilClient.tsx` do painel do lojista,
apenas injetando as actions admin com o `lojaId` da rota fixado por closure. Logo,
o toggle que a issue 123 adicionar ao `PerfilClient` **aparece no admin
automaticamente, sem nenhuma linha de JSX nova aqui**.

Executar a issue como escrita produziria exatamente o remendo que
`specs/paridade-hub-admin-painel.md` proíbe: *"Duplicar JSX/markup de área entre
painel e admin é regressão deste spec"* — dois fluxos paralelos do mesmo controle,
livres para divergir. O trabalho real de produção desta issue é **uma linha de
plumbing SSR** (a page admin repassar o valor da loja-alvo) e o **restante é
prova por teste** de que o binding por tenant do campo está correto.

**Segunda causa raiz, de dependência.** O cabeçalho diz `Depende de: [122]`. Isso
está **errado**: o campo `whatsapp_envio_automatico` só existe no tipo
`PerfilInicial` (exportado por `PerfilClient.tsx`) depois da **issue 123**. Sem
123, a linha que esta issue precisa escrever em `perfil/page.tsx` **não compila**
(`.strict` de TypeScript sobre `PerfilInicial`). Reescopo obrigatório:
`Depende de: [122], [123]`.

**Por que é complexo mesmo assim.** A superfície tocada é a única escrita
**cross-tenant** em `lojas` do produto (admin gravando loja de terceiro sob
`service_role`, que bypassa RLS). O vetor real não é o valor do campo — é *em qual
loja ele cai*. Existe precedente de incidente exatamente aqui (2026-07-03, PRs
#99/#100/#101) e um bug de mesmo formato na issue 119 (o wrapper admin caindo no
default do lojista e gravando a **logo do admin**). O contrato de dados
(`PerfilInicial`) é compartilhado entre dois mundos de autorização diferentes
(RLS por `dono_id` × escopo por `id` sob `service_role`), e é essa
compartilhação que precisa de prova, não de guard novo.

### Mapa de Impacto

Árvore real (verificada arquivo a arquivo), com a camada que **garante** cada
invariante:

```
/admin/assinantes/[lojaId]/configuracoes/perfil
  └─ page.tsx  (Server Component)
     ├─ params.lojaId  ──────────────────────── [ÚNICA fonte do tenant]
     ├─ carregarLojaAdminBase(lojaId)          (carga.ts, server-only)
     │    ├─ validarLojaIdAdmin (z.guid) → notFound()   [fail-closed, ANTES de I/O]
     │    ├─ verificarAdminSaaS()  ────────────  [AUTORIZAÇÃO — fora do try, propaga]
     │    ├─ createServiceClient()             [elevação SÓ aqui, nunca na page]
     │    └─ buscarLojaAdminPorId(svc, id) → .select("*").eq("id", lojaId)
     │         └─ traz whatsapp_envio_automatico  [SEM mudança de query — MODIFICAR NADA]
     └─ <PerfilAdminClient lojaId={loja.id} inicial={{...}} />   ← ★ ÚNICA MUDANÇA DE PRODUÇÃO
          └─ PerfilAdminClient.tsx  ('use client', wrapper fino)
               └─ <PerfilClient
                     inicial={inicial}                       [preview de UX]
                     onSalvar={(p) => salvarPerfilAdmin(lojaId, p)}  ← lojaId por CLOSURE
                   />
                    └─ PerfilClient.tsx  (COMPARTILHADO lojista ↔ admin)
                         └─ Switch do toggle  ← ENTREGUE PELA ISSUE 123, não aqui
                              (visual: plan/design-toggle-whatsapp-envio-automatico.md)

salvarPerfilAdmin(lojaId, payload)   src/app/admin/assinantes/actions/admin-perfil.ts
  ├─ validarLojaIdAdmin(lojaId)                       [z.guid, fail-closed]
  ├─ pick por CHAVES_PERFIL = Object.keys(schemaPerfil.shape)   [1ª barreira — 122]
  ├─ schemaPerfil.safeParse (.strict)                 [2ª barreira — 122]
  ├─ prepararContextoAdmin(lojaId) → verificarAdminSaaS() ANTES de createServiceClient()
  ├─ montarPatchPerfil(dados)   patches-loja.ts       [3ª barreira — allowlist coluna-a-coluna]
  │    └─ if (d.whatsapp_envio_automatico !== undefined) patch.whatsapp_envio_automatico = ...
  └─ escopo.atualizarLoja(patch)   admin-loja.ts:140
       ├─ filtro runtime CAMPOS_LOJA_SOMENTE_SERVIDOR (descarta `id`, `dono_id`, billing…)
       └─ .from("lojas").update(seguro,{count:"exact"}).eq("id", lojaId)  ← ★ AUTORITATIVO
```

**Onde cada invariante é garantida (regra cliente ↔ servidor):**

```
Valor da flag exibido no admin:
  ├── PerfilClient.tsx (Switch)                — [cliente — só UX/preview]
  └── page.tsx → carregarLojaAdminBase → lojas.whatsapp_envio_automatico
                                              — [SSR, service_role escopado por id — FONTE DE VERDADE]

Qual loja recebe a escrita da flag (a invariante REAL desta issue):
  ├── PerfilAdminClient.tsx (closure sobre lojaId da rota)  — [cliente — conveniência; NÃO é o guard]
  ├── validarLojaIdAdmin(lojaId)                            — [Server Action — forma]
  └── escopo.atualizarLoja → .eq("id", lojaId)              — [Server Action — AUTORITATIVO,
                                                                ignora `id`/`loja_id` do payload]

Quais colunas podem ser gravadas por esta via:
  ├── schemaPerfil.strict()                    — [isomórfico — client é só preview]
  ├── CHAVES_PERFIL pick (derivado do schema)  — [Server Action]
  ├── montarPatchPerfil (allowlist)            — [Server Action — barreira principal]
  └── CAMPOS_LOJA_SOMENTE_SERVIDOR             — [Server Action — backstop de runtime]
      (+ trigger lojas_protege_billing no banco, NÃO aplicável a service_role)
```

**Assimetria declarada e justificada:** esta issue não adiciona **nenhuma** RLS
nem CHECK. Não é omissão: (a) o caminho admin roda sob `service_role`, que
bypassa RLS por definição — a política que substitui a RLS aqui é o `.eq("id",
lojaId)` injetado por construção pelo wrapper (`seguranca.md` §7 "Wrapper
`EscopoLoja`"); (b) o caminho do lojista já é coberto por `lojas_update_proprio`
(`auth.uid() = dono_id`), inalterado; (c) a coluna é `boolean NOT NULL DEFAULT
true` — o tipo já é o CHECK (sem tri-estado); (d) **não há dinheiro** nesta issue
(`spec 5` §Segurança), logo não há recálculo monetário a exigir.

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/page.tsx` | Server Component da sub-rota; chama `carregarLojaAdminBase(lojaId)` e monta o objeto `inicial` campo a campo (10 campos hoje) | **★ Única mudança de produção:** adicionar `whatsapp_envio_automatico: loja.whatsapp_envio_automatico` ao literal `inicial` |
| `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/PerfilAdminClient.tsx` | Wrapper `'use client'` de 70 linhas; injeta `onSalvar={(p) => salvarPerfilAdmin(lojaId, p)}` + actions de logo/publicação, `lojaId` por closure | **NADA.** `inicial` já é repassado inteiro (`inicial={inicial}`); o campo novo flui por construção |
| `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient.tsx` | Client COMPARTILHADO lojista↔admin; exporta `PerfilInicial`; `montarPayload()` monta o payload de `onSalvar` | **NADA nesta issue** — o `Switch`, o campo em `PerfilInicial` e a inclusão no `montarPayload()` são entrega da **issue 123** |
| `src/app/admin/assinantes/actions/admin-perfil.ts` | Server Action admin; `CHAVES_PERFIL` derivada de `schemaPerfil.shape`; `montarPatchPerfil` + `escopo.atualizarLoja` | **NADA.** A flag já flui por construção (122). Verificado linha a linha |
| `src/lib/validacoes/loja.ts` | `schemaPerfil.strict()` com `whatsapp_envio_automatico: z.boolean().optional()` (sem `.default`) | **NADA** (122 pronto) |
| `src/lib/actions/patches-loja.ts` | `montarPatchPerfil` grava a coluna quando `!== undefined` | **NADA** (122 pronto) |
| `src/lib/actions/admin-loja.ts` | `criarEscopoLoja`/`atualizarLoja`; `CAMPOS_LOJA_SOMENTE_SERVIDOR` (15 colunas) | **NADA.** `whatsapp_envio_automatico` fica FORA da blocklist — permitida por design (spec 5 §Segurança) |
| `src/lib/supabase/queries/lojas.ts` | `buscarLojaAdminPorId` faz `.select("*")` | **NADA** — coluna já vem |
| `supabase/migrations/` | coluna criada em `20260704120000_lojas_whatsapp_envio_automatico.sql` | **NADA. NÃO criar migration** |
| `src/lib/actions/admin-loja.binding.test.ts` | Regressão do incidente 2026-07-03: fake com `from` no **protótipo** lendo `this.rest` (forma real do supabase-js) | **★ Estender** com o bloco de binding da flag (ver Cenários) |
| `.../configuracoes/perfil/page.test.tsx` | Prova o roteamento loader→wrapper; `lojaFake` sem a flag | **★ Estender** `lojaFake` + 1 asserção de SSR |
| `.../configuracoes/perfil/PerfilAdminClient.test.tsx` | Prova a fiação das actions de **logo** (issue 119). **Não testa `onSalvar` hoje** | **★ Estender** com a fiação de `onSalvar` (lacuna real) |
| `src/app/admin/assinantes/actions/admin-perfil.test.ts` | Já tem o bloco "Caso 5 (issue 122)" com 4 casos da flag | **NÃO duplicar** — ver Cenários §Delta |

### Decisões de Design

**D1 — Onde nasce o toggle no admin.**
- (a) Duplicar o bloco `Switch` num client admin próprio. *Prós:* independência.
  *Contras:* o arquivo alvo não existe; viola `paridade-hub-admin-painel.md`
  explicitamente ("duplicar markup é regressão deste spec"); cria dois pontos de
  verdade para o mesmo controle, livres para divergir na próxima mudança de copy.
- (b) **Reusar `PerfilClient` já compartilhado** e só alimentar `inicial` no SSR
  admin. *Prós:* zero JSX novo; paridade visual garantida **por construção**, não
  por revisão; qualquer ajuste futuro de 123 reflete no admin sozinho.
  *Contras:* acopla a issue 124 à 123 (dependência declarada).
- **Escolhida: (b).** É o padrão vigente já provado por 5 áreas (`PerfilClient`,
  `HorariosClient`, `EntregasClient`, `PagamentosClient`, `TemaClient`). O JSX do
  toggle é responsabilidade do agente `desenhar` em
  `plan/design-toggle-whatsapp-envio-automatico.md`, consumido pela issue 123 —
  **este plano não especifica visual**.

**D2 — Onde escrever o teste de binding.**
- (a) Novo arquivo `admin-perfil.binding.test.ts`. *Prós:* co-locação com a action.
  *Contras:* recria o fake de client real-shape (~90 linhas duplicadas) — o Escopo
  da issue proíbe explicitamente ("reusar, não recriar"); um segundo fake sai de
  sincronia com o real.
- (b) **Estender `src/lib/actions/admin-loja.binding.test.ts`** com um `describe`
  novo. *Prós:* o fake com `from` no protótipo lendo `this.rest` já existe e é o
  único do repo fiel ao supabase-js; `salvarPerfilAdmin` passa a herdar de graça a
  regressão do incidente 2026-07-03. *Contras:* o fake precisa ganhar `neq`
  (exigido por `slugExiste`) — mudança **aditiva**, não altera nenhum caso atual.
- **Escolhida: (b).**

**D3 — Como neutralizar o geocoding no teste de binding.** `salvarPerfilAdmin`
faz um 2º UPDATE com coords derivadas via `geocodificarEnderecoComMotivo` (rede).
- (a) Só omitir endereço do payload (`montarConsultaGeocoding` retorna `null` sem
  cidade+estado → não chama a rede). *Contras:* invariante implícita; uma mudança
  futura no gate reabre a rede no CI.
- (b) Só mockar o módulo. *Contras:* mock a mais quando o gate já resolve.
- **Escolhida: (a) + (b) juntas** — payload sem `endereco_cidade`/`endereco_estado`
  **e** `vi.mock("@/lib/utils/geocodificarEndereco")` retornando
  `{ coords: null, motivo: "nao_encontrado" }`. Determinismo total, zero rede,
  `updates` sempre com exatamente 2 registros (perfil + par NULL).

**D4 — `Depende de` da issue.** Reescopado para `[122], [123]` (ver Diagnóstico).
Não é reescopo de conteúdo, é correção de ordem: sem 123 o TypeScript rejeita a
única linha de produção desta issue.

**D5 — Nenhuma migration, nenhuma RLS, nenhum tipo gerado novo.** A coluna já
existe no cloud e em `src/lib/database.types.ts`. `supabase gen types` **não** deve
ser rodado por esta issue.

### Cenários

Ambiente: `environment: "node"` (vitest.config.ts) — sem jsdom, sem
`@testing-library`. Comando: `npx vitest run <arquivo>`.

Constantes fixas em todos os cenários:
```
LOJA_ALVO   = "5ec21485-e58a-4071-a41c-f8963076ae00"   (já existe no binding.test.ts)
LOJA_HOSTIL = "99999999-9999-4999-8999-999999999999"
PAYLOAD_MIN = { nome: "Pizzaria Alvo", slug: "pizzaria-alvo", whatsapp: "5511999998888" }
              (SEM endereco_cidade/endereco_estado — ver D3)
```

#### Delta vs. o que a issue 122 JÁ cobriu — NÃO duplicar

`src/app/admin/assinantes/actions/admin-perfil.test.ts`, bloco
`describe("salvarPerfilAdmin — whatsapp_envio_automatico (issue 122)")`
(linhas ~283-337) **já prova**:

| Caso já coberto (122) | Critério de aceite desta issue |
|---|---|
| `"flag false sobrevive ao pick CHAVES_PERFIL e chega ao 1º UPDATE escopado por lojaId"` — assere `patch.whatsapp_envio_automatico === false`, `eqCol === "id"`, `eqVal === LOJA_ID` | Cobre a **maior parte** do AC-1 |
| `"payload SEM a flag não emite a chave no patch"` | Preservação — fora dos ACs, mas relevante |
| `"payload hostil + flag: só a flag e os campos de perfil sobrevivem"` — assere que `ativo`/`dono_id`/`assinatura_status`/`latitude`/`longitude`/`id` **não** entram no patch | Cobre a metade **de coluna** do AC-2 |
| `"flag não-booleana ('true') reprova no schema → zero UPDATE"` | Validação de tipo |

**O que NÃO está coberto (o delta real desta issue):**

1. O fake de `admin-perfil.test.ts` é um **objeto literal** (`from` como
   propriedade própria, `update().eq()` devolvendo promise direto) — é exatamente
   a forma de dublê que **não pegou** o incidente 2026-07-03, conforme o cabeçalho
   de `admin-loja.binding.test.ts`. Não há prova com client real-shape para
   `salvarPerfilAdmin`.
2. O caso hostil da 122 assere só a **ausência de colunas no patch** — não assere
   o **destino** do UPDATE (`eqVal`) nem que `LOJA_HOSTIL` não aparece em `.eq`
   algum. O AC-2 desta issue ("`lojaId` hostil no payload não redireciona a
   escrita") **não tem teste hoje**.
3. Nenhum teste prova que a page admin repassa a flag **da loja-alvo** ao cliente.
4. Nenhum teste prova a fiação de `onSalvar` no `PerfilAdminClient` — o vetor
   "cair no default do lojista e gravar na loja DO ADMIN" (bug real da issue 119
   com a logo) está aberto para o perfil.

#### C1 — Binding da flag na loja-alvo, com client real-shape (AC-1 + AC-2)

*Arquivo:* `src/lib/actions/admin-loja.binding.test.ts`, novo `describe`
`"salvarPerfilAdmin — binding por tenant da flag whatsapp_envio_automatico (124)"`.

*Dublês (todos já no arquivo, exceto os 2 primeiros itens):*
- **[adicionar ao fake existente]** `criarEncadeavel` ganha
  `neq(coluna, valor) { eqs.push([coluna, valor]); return encadeavel; }` — exigido
  por `slugExiste(svc, slug, lojaId)`, que faz
  `.from("lojas").select("id").eq("slug", …).neq("id", lojaId)`. Aditivo: nenhum
  caso existente chama `neq`.
- **[adicionar mock de módulo]** `vi.mock("@/lib/utils/geocodificarEndereco", () =>
  ({ geocodificarEnderecoComMotivo: vi.fn(async () => ({ coords: null, motivo:
  "nao_encontrado" })) }))`.
- Já existentes e reusados: `@/lib/auth/admin` (`verificarAdminSaaS` resolve),
  `next/cache` (`revalidatePath` no-op), `@/lib/supabase/service`
  (`ServiceClientFake` com `from` no **protótipo** lendo `this.rest`),
  `capturado.{updates,inserts,selects}` + `beforeEach` que zera.
- **Não mockar** `slugExiste`, `montarPatchPerfil`, `schemaPerfil`,
  `prepararContextoAdmin` nem `escopo` — são o objeto do teste. O fake devolve
  `data: null` → `slugExiste` = `false` (slug livre).

*Import a adicionar:* `import { salvarPerfilAdmin } from
"@/app/admin/assinantes/actions/admin-perfil";`

**C1.1 — flag `false` grava na loja-alvo, escopada por `id`**
- Entrada: `await salvarPerfilAdmin(LOJA_ALVO, { ...PAYLOAD_MIN,
  whatsapp_envio_automatico: false })`
- Asserções:
  - retorno `toMatchObject({ ok: true })`
  - `capturado.updates` tem **exatamente 2** registros (perfil + par de coords NULL)
  - `capturado.updates[0].tabela === "lojas"`
  - `capturado.updates[0].patch` → `toHaveProperty("whatsapp_envio_automatico", false)`
  - `capturado.updates[0].eqs` → `toEqual([["id", LOJA_ALVO]])` (**igualdade
    exata**, não `toContainEqual`: prova que não há segundo `.eq` afrouxando/
    redirecionando o escopo)
  - `capturado.updates[1].eqs` → `toEqual([["id", LOJA_ALVO]])`
  - nenhum `TypeError` — o fake protótipo/`this.rest` prova que `from` não foi
    desacoplado (regressão 2026-07-03 herdada de graça)

**C1.2 — flag `true` idem** (mesma forma, `whatsapp_envio_automatico: true`,
`toHaveProperty(..., true)`). Guarda contra qualquer implementação futura que
trate a flag por truthiness em vez de `!== undefined`.

**C1.3 — `lojaId` hostil DENTRO do payload não redireciona a escrita (AC-2)**
- Entrada:
  ```
  await salvarPerfilAdmin(LOJA_ALVO, {
    ...PAYLOAD_MIN,
    whatsapp_envio_automatico: false,
    id: LOJA_HOSTIL,
    loja_id: LOJA_HOSTIL,
    dono_id: LOJA_HOSTIL,
  })
  ```
- Asserções (**todas obrigatórias**):
  - `capturado.updates[0].eqs` → `toEqual([["id", LOJA_ALVO]])`
  - `capturado.updates[0].patch` → `not.toHaveProperty("id")`,
    `not.toHaveProperty("loja_id")`, `not.toHaveProperty("dono_id")`
  - `capturado.updates[0].patch` → `toHaveProperty("whatsapp_envio_automatico", false)`
    (a flag legítima **sobrevive** ao mesmo payload hostil — prova que o hardening
    não é um "rejeita tudo")
  - **`LOJA_HOSTIL` não aparece em NENHUM `.eq`/`.neq` de nenhum UPDATE**:
    `expect(capturado.updates.flatMap(u => u.eqs).map(([,v]) => v))
     .not.toContain(LOJA_HOSTIL)`
  - `JSON.stringify(capturado.updates)` → `not.toContain(LOJA_HOSTIL)` (rede de
    segurança sobre patch **e** escopo de uma vez)

**C1.4 — a loja do próprio admin permanece intacta (AC-4, metade servidor)**
- Entrada: mesma de C1.1.
- Asserções: `capturado.updates.filter(u => u.tabela === "lojas")` → todos os
  `eqs` iguais a `[["id", LOJA_ALVO]]`; nenhum UPDATE em `lojas` sem `.eq`
  (`expect(u.eqs.length).toBeGreaterThan(0)` para cada um). Um UPDATE em `lojas`
  sem escopo atingiria **todas** as lojas, inclusive a do admin — este é o
  cenário-catástrofe que a asserção fecha.

**C1.5 — `lojaId` de rota inválido é fail-closed, zero efeito**
- Entrada: `await salvarPerfilAdmin("nao-e-uuid", { ...PAYLOAD_MIN,
  whatsapp_envio_automatico: false })`
- Asserções: retorno `toMatchObject({ ok: false })`; `capturado.updates` →
  `toHaveLength(0)`; `capturado.selects` → `toHaveLength(0)` (nem `slugExiste`
  roda). Prova que `validarLojaIdAdmin` corta **antes** de qualquer I/O.

#### C2 — SSR: a page admin repassa a flag DA LOJA-ALVO

*Arquivo:* `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/page.test.tsx`
(estender; padrão já estabelecido — invoca o default export async e inspeciona
`elemento.props` com `PerfilAdminClient` mockado como `() => null`).

*Dublê:* adicionar `whatsapp_envio_automatico: false` ao `lojaFake` existente e
estender o `type Props` local com
`inicial: { …; whatsapp_envio_automatico: boolean }`.

- **C2.1** — `(await renderizar()).props.inicial.whatsapp_envio_automatico` →
  `toBe(false)`.
  **Escolha deliberada de `false`:** a coluna tem `DEFAULT true`, então um teste
  com `true` passaria mesmo se a page esquecesse o campo e o cliente caísse num
  default — `false` é o único valor que só pode ter vindo da loja-alvo.
- **C2.2** — `expect(carregarLojaAdminBase).toHaveBeenCalledWith(LOJA_ID)` e
  `props.lojaId === LOJA_ID` (já coberto pelo arquivo; **não reescrever**, só não
  quebrar).

#### C3 — Fiação de `onSalvar`: admin nunca cai no default do lojista

*Arquivo:* `.../configuracoes/perfil/PerfilAdminClient.test.tsx` (estender). Novo
`describe("PerfilAdminClient — fiação de onSalvar (issue 124)")`. Lacuna real: o
arquivo hoje só cobre logo.

*Dublês:*
- `capturado` (via `vi.hoisted`) ganha
  `onSalvar: undefined as ((p: unknown) => unknown) | undefined`; o stub de
  `PerfilClient` passa a capturá-lo junto com os de logo.
- `@/app/admin/assinantes/actions/admin-perfil` já é mockado no arquivo
  (`salvarPerfilAdmin: vi.fn()`) — trocar por
  `vi.fn(async () => ({ ok: true, geocodificado: false }))`.
- **Adicionar** `vi.mock("@/lib/actions/loja", () => ({ salvarPerfil: vi.fn(),
  definirPublicacao: vi.fn() }))` — os defaults do **lojista**, que derivariam a
  loja pelo `auth` do admin (`buscarLojaDoDono`) e gravariam na loja **DO ADMIN**.
- Render por `renderToStaticMarkup` (helper `renderizar()` já existe no arquivo).

- **C3.1** — após `renderizar()`, `capturado.onSalvar` → `toBeTypeOf("function")`.
  Se a prop sumir, `PerfilClient` cai no default do lojista: é **este** o vetor
  cross-tenant (mesma forma do bug de logo da 119).
- **C3.2** — `await capturado.onSalvar!({ ...PAYLOAD_MIN,
  whatsapp_envio_automatico: false })`:
  - `expect(salvarPerfilAdmin).toHaveBeenCalledTimes(1)`
  - `expect(salvarPerfilAdmin).toHaveBeenCalledWith(LOJA_ALVO, { ...PAYLOAD_MIN,
    whatsapp_envio_automatico: false })` — o 1º argumento é o `lojaId` da **URL**,
    e o payload chega **intacto** (o wrapper não filtra nem reescreve nada)
  - `expect(salvarPerfil).not.toHaveBeenCalled()` (AC-4, metade cliente)
- **C3.3** — `renderizar(LOJA_ALVO)` com um payload carregando
  `id: LOJA_HOSTIL` / `loja_id: LOJA_HOSTIL`: o 1º argumento de
  `salvarPerfilAdmin` continua `LOJA_ALVO`. O wrapper **não** lê tenant do
  payload; a defesa final é C1.3 no servidor.

#### Bordas e erros

| Situação | Comportamento esperado | Camada |
|---|---|---|
| Loja-alvo inativa / em onboarding | Toggle **editável** normalmente — `buscarLojaAdminPorId` lê a **tabela base**, não a view `vitrine_lojas`, então enxerga loja inativa. Nenhum gate de `ativo` nesta escrita | SSR + Server Action |
| `lojaId` da rota não é UUID | `carregarLojaAdminBase` → `notFound()` antes de `createServiceClient()`; `salvarPerfilAdmin` → `{ ok:false, erro: ERRO_VALIDACAO }` sem I/O | fail-closed |
| Loja-alvo inexistente | `notFound()` no loader; o UPDATE do action, se chamado, afeta 0 linhas (`count:"exact"`) | loader |
| Sessão de admin expirada durante a edição | `verificarAdminSaaS()` lança **fora do try** → propaga; **sem** `createServiceClient`, **sem** `slugExiste`, **sem** UPDATE. Nunca degrada para "salvar na loja do usuário logado" | Server Action (D-4) |
| Slug da loja-alvo colidindo com outra loja | `{ ok:false, erro: ERRO_SLUG_OCUPADO }`; **zero UPDATE** — a flag também não é gravada (save é atômico do ponto de vista da UX) | Server Action |
| Duplo submit / race de dois admins | Idempotente: `UPDATE … SET whatsapp_envio_automatico = <bool> WHERE id = <lojaId>`, last-write-wins sobre um booleano. Sem incremento, sem contador, sem dinheiro → **não** exige lock nem RPC transacional | banco |
| Loja-alvo **sem** WhatsApp cadastrado | Switch desabilitado + dica (UX de 123, herdada por construção). **Não é guard de segurança:** RN-A2 já barra a emissão do link no servidor quando não há WhatsApp | cliente (UX) |
| Erro do PostgREST no UPDATE | `throw` → `catch` → `console.error("salvarPerfilAdmin:", e)` no servidor + `{ ok:false, erro: "Não foi possível salvar. Tente novamente." }` ao usuário. Detalhe interno **nunca** vaza (`seguranca.md` §14) | Server Action |
| Geocoding indisponível | Best-effort: 2º UPDATE grava o par `NULL`; **o salvamento da flag não é rebaixado** (já provado em `admin-perfil.test.ts`) | Server Action |

### Contratos de Dados

**Sem mudança de schema.** A coluna já existe e já está nos tipos gerados:

```
lojas.whatsapp_envio_automatico  boolean NOT NULL DEFAULT true
  migration: supabase/migrations/20260704120000_lojas_whatsapp_envio_automatico.sql
  tipos:     src/lib/database.types.ts (já gerado)
```

- **NÃO criar migration.** **NÃO rodar `supabase gen types`.**
- **RLS:** nenhuma política nova. Lojista → `lojas_update_proprio`
  (`auth.uid() = dono_id`, inalterada). Admin → `service_role` (BYPASSRLS)
  escopado por `.eq("id", lojaId)` via `escopo.atualizarLoja`.
- **`CAMPOS_LOJA_SOMENTE_SERVIDOR`:** `whatsapp_envio_automatico` **permanece
  fora** (permitida por design — é preferência operacional, não billing).
  Verificado em `src/lib/actions/admin-loja.ts:51-69`.
- **Views:** nenhuma view tocada por esta issue. (Exposição de `vitrine_lojas` é
  assunto das issues 125/126, não desta.)

**Shape de props (mudança de contrato compartilhado):**

```ts
// PerfilClient.tsx — ENTREGUE PELA ISSUE 123, consumido aqui
export type PerfilInicial = {
  …10 campos atuais…
  whatsapp_envio_automatico: boolean;   // NÃO-opcional: o SSR sempre tem o valor
                                        // (coluna NOT NULL). Opcional convidaria
                                        // um default no cliente divergente do banco.
};
```

Consumidores desse tipo — **os dois devem ser atualizados no mesmo commit da 123**,
senão o build quebra:
- `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/page.tsx` (issue 123)
- `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/page.tsx` (**esta issue**)

### Recálculo no Servidor

**Não há dinheiro nesta issue** (spec 5 §Segurança). O análogo do recálculo
monetário aqui é o **recálculo do tenant**, e ele já acontece:

| O cliente envia | O que o servidor faz do zero |
|---|---|
| `payload` do form (nome, slug, telefone, whatsapp, endereço, `whatsapp_envio_automatico`) | Descarta tudo fora de `CHAVES_PERFIL`; revalida por `schemaPerfil.strict()`; remonta o patch coluna a coluna em `montarPatchPerfil`; filtra `CAMPOS_LOJA_SOMENTE_SERVIDOR` |
| **Nada sobre qual loja** (nem deveria) | O `lojaId` vem do 1º argumento da action, fixado por closure a partir de `params` da rota; revalidado por `validarLojaIdAdmin` (`z.guid`); injetado como `.eq("id", lojaId)` pelo wrapper. `id`/`loja_id`/`dono_id` presentes no payload são **descartados**, nunca promovidos a destino |
| `latitude`/`longitude` (se um payload hostil enviar) | Descartados pelo pick; recalculados server-side por `geocodificarEnderecoComMotivo` no 2º UPDATE |

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:** nenhum arquivo novo. (Um arquivo novo aqui seria sinal de violação da
regra de reuso — ver Decisão D2.)

**Modificar — produção (1 arquivo, 1 linha):**
1. `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/page.tsx`
   → dentro do literal `inicial={{ … }}`, adicionar
   `whatsapp_envio_automatico: loja.whatsapp_envio_automatico,`
   (posicionar após `whatsapp`, espelhando a ordem da page do lojista).

**Modificar — testes (3 arquivos):**
2. `src/lib/actions/admin-loja.binding.test.ts` — `neq` no `criarEncadeavel`;
   `vi.mock` de `@/lib/utils/geocodificarEndereco`; import de `salvarPerfilAdmin`;
   `describe` novo com C1.1–C1.5.
3. `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/page.test.tsx` —
   `lojaFake.whatsapp_envio_automatico = false`; `type Props` estendido; C2.1.
4. `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/PerfilAdminClient.test.tsx`
   — captura de `onSalvar`; `vi.mock("@/lib/actions/loja")`; C3.1–C3.3.

**NÃO tocar (com motivo):**

| Arquivo | Motivo |
|---|---|
| `src/app/admin/assinantes/actions/admin-perfil.ts` | A flag já flui: `CHAVES_PERFIL` é **derivada** de `schemaPerfil.shape` (122). Qualquer edição aqui é remendo — o teste C1 é a prova, não uma mudança |
| `src/lib/actions/patches-loja.ts` | `montarPatchPerfil` já grava com `!== undefined` (122) |
| `src/lib/validacoes/loja.ts` | `schemaPerfil` já aceita `z.boolean().optional()` **sem `.default`** (122). Adicionar `.default(true)` aqui seria regressão: sobrescreveria a escolha do lojista em todo save que omitisse o campo |
| `src/lib/actions/admin-loja.ts` | `CAMPOS_LOJA_SOMENTE_SERVIDOR` não muda — a flag é permitida por design |
| `PerfilClient.tsx` + a page do **lojista** | Território da issue 123. Editar aqui cria conflito e rouba escopo |
| `supabase/migrations/**` e `src/lib/database.types.ts` | Coluna já existe no cloud e nos tipos |
| `src/lib/supabase/queries/lojas.ts` | `.select("*")` já traz a coluna |
| `src/app/admin/assinantes/actions/admin-perfil.test.ts` | Bloco da 122 já cobre a via da action com dublê literal. **Não duplicar** — o delta é o client real-shape em C1 |
| `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` | Enforcement por descoberta automática; nenhuma action nova é criada |
| `useEnviarPedido.ts`, `pedido.ts`, checkout, confirmação | Issues 125/126 |
| `plan/design-toggle-whatsapp-envio-automatico.md` | Produzido pelo agente `desenhar`; é **entrada** da issue 123, consumida aqui só por herança visual. Este plano não especifica visual |

### Dependências Externas

**Nenhuma.** Nenhum pacote novo. Tudo já instalado e em uso:
`zod` (`schemaPerfil`), `vitest` + `@vitejs/plugin-react` (suíte),
`react-dom/server` (`renderToStaticMarkup`, já usado em
`PerfilAdminClient.test.tsx`), `shadcn/ui` `Switch`/`Label` (consumo é da 123),
`react-imask`, `sonner`. Ambiente: **npm** (`npm run build`), **não pnpm**.

### Ordem de Implementação

**Pré-condição bloqueante:** a issue **123** deve estar fechada — `PerfilInicial`
precisa do campo, senão o passo 3 não compila. Se 123 ainda estiver aberta,
**parar aqui** e sinalizar ao orquestrador.

1. **RED — C1** (`agente tdd`). Estender `admin-loja.binding.test.ts`: `neq` no
   fake, mock de geocoding, `describe` com C1.1–C1.5.
   `npx vitest run src/lib/actions/admin-loja.binding.test.ts`.
   *Vermelho esperado:* C1.1/C1.2/C1.3 falham **na asserção** do
   `whatsapp_envio_automatico` **somente se** algo na cadeia 122 estiver quebrado.
   **Se passarem de primeira, isso NÃO é falha do processo** — é a prova
   documental de que a via admin já está correta por construção (122). Anexar o
   output real na issue e registrar C1 como *teste de caracterização/regressão*,
   não como red-first. **Não** quebrar a implementação para forçar vermelho.
2. **RED — C2 e C3** (`agente tdd`). Estes **falham de verdade**: C2.1 falha
   porque `page.tsx` ainda não repassa o campo (`undefined !== false`); C3.1/C3.2
   falham porque `capturado.onSalvar` ainda não é capturado pelo stub.
   Anexar o output real do FAIL na issue. **Parar** — sem código de produção.
3. **GREEN** (`agente executar`). Adicionar a linha em
   `.../configuracoes/perfil/page.tsx`. É a única mudança de produção.
4. `npx vitest run src/lib/actions/admin-loja.binding.test.ts` +
   `npx vitest run "src/app/admin/assinantes/[lojaId]/configuracoes/perfil"` +
   `npx vitest run src/app/admin/assinantes/actions/admin-perfil.test.ts` (não
   regrediu).
5. `npm run build` (constraint `use-server-export-constraint` + checagem do tipo
   `PerfilInicial` nas **duas** pages consumidoras).
6. Suíte cheia (`npx vitest run`) antes de fechar.

*Justificativa da ordem:* 1 antes de 2 porque C1 é a invariante de **segurança**
(destino da escrita) e deve estar escrita antes de qualquer toque em código de
produção; 3 depois de 2 porque C2/C3 são o vermelho legítimo desta issue; 5 depois
de 4 porque o erro de tipo de `PerfilInicial` aparece no `build`, não no vitest
(vitest não faz type-check).

### Checklist de Validação Pós-Implementação

- [ ] `npm run build` sem warnings novos
- [ ] `npx vitest run` — suíte inteira verde
- [ ] C1.3: `LOJA_HOSTIL` no payload **não** aparece em nenhum `.eq`/`.neq` nem em
      nenhum patch (`JSON.stringify(capturado.updates)` limpo)
- [ ] C1.4: **todo** UPDATE em `lojas` tem `eqs === [["id", LOJA_ALVO]]` — nenhum
      UPDATE sem escopo
- [ ] C3.2: `salvarPerfil` (default do lojista) **nunca** chamado no caminho admin
- [ ] C2.1 usa `false` (não `true`) — imune ao `DEFAULT true` da coluna
- [ ] Cadeia 122 intacta: `CHAVES_PERFIL` continua derivada
      (`Object.keys(schemaPerfil.shape)`); `schemaPerfil` continua **sem** `.default`
- [ ] `whatsapp_envio_automatico` continua **fora** de `CAMPOS_LOJA_SOMENTE_SERVIDOR`
- [ ] Nenhuma migration criada; `src/lib/database.types.ts` não regenerado
- [ ] Nenhum JSX de toggle duplicado no admin (`find . -name "ConfiguracaoAdmin*"`
      continua vazio; `grep -rn "whatsapp_envio_automatico" src/app/admin --include=*.tsx`
      só acusa `perfil/page.tsx` e os testes)
- [ ] Sem secret no client; sem dado pessoal hardcoded (UUIDs de teste fictícios,
      WhatsApp `5511999998888` já é o padrão fictício do repo)
- [ ] Manual: admin desliga o toggle da loja-alvo → `/painel/configuracoes/perfil`
      da loja **do próprio admin** continua com a flag original
