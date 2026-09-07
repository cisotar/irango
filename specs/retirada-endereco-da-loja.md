# Spec: Endereço da loja na retirada (checkout + confirmação)

**Versão:** 0.2.0 | **Atualizado:** 2026-09-06

---

## Decisões do dono do produto (2026-09-06)

Registradas aqui porque mudaram o escopo depois da primeira análise do código.
Quem for implementar deve tratar estas quatro como fechadas.

**D1 — A mensagem de WhatsApp NÃO leva o endereço da loja.** Decisão: *"na
mensagem aparece que é retirada, mas não precisa escrever o endereço da loja."*

> **Isso já é o comportamento de hoje** — nada a implementar. `montarLinkWhatsappPedido`
> (`whatsappPedido.ts:99`) já escreve a linha `Entrega: Retirada no local` para
> todo pedido de retirada, via `rotuloTipoEntrega`. A "Etapa 2" que a versão 0.1.0
> desta spec propunha (acrescentar `Retirar em: <endereço>`) está **cancelada**:
> `whatsappPedido.ts` fica **intocado**, e com ele `criarPedido`, `useEnviarPedido`
> e o botão manual da confirmação. Ver *Fora do escopo*.

**D2 — A tela de confirmação mostra o endereço E um link para abrir o Google Maps.**
A "Etapa 1-B", que era sugestão, está **aprovada e ampliada** com o link. Ver a
seção da página de confirmação e a RN-R6 (reescrita para permitir o link).

**D3 — Complemento / ponto de referência: não fazer agora.** Registrado como
débito em **`specs/_debito-produto-2026-09-06.md` §1**, com o motivo e o critério
de reabertura. Não é esquecimento — é adiamento consciente.

**D4 — A regra de dinheiro da retirada está correta e não se mexe nela.**
Confirmado pelo dono: *"se retirada, cliente não precisa informar endereço, então
taxa é zero."* É exatamente o que o servidor já faz. Vira invariante protegida por
teste de regressão (RN-R4).

---

## O que a análise do código mudou no escopo

**1. Nenhuma migration. Nenhuma view recriada. Nenhuma decisão nova de exposição pública.**
As seis colunas de endereço já existem em `lojas` (`endereco_rua`,
`endereco_numero`, `endereco_bairro`, `endereco_cidade`, `endereco_estado`,
`endereco_cep` — `schema.md` §lojas) **e já são projetadas na view pública
`vitrine_lojas`** desde a migration `20260615013000_logo_url_lojas.sql`,
preservadas na recriação mais recente (`20260704120000_lojas_whatsapp_envio_automatico.sql`).
O endereço da loja **já é legível pelo `anon`** desde junho — esta feature não
expõe nada novo, só passa a **renderizar** um dado que já trafega. Confirmado
lendo o `create view` vigente, não presumido.

**2. Os dois caminhos de leitura já trazem o endereço sem tocar em query.**
`buscarLojaPorSlug` (checkout, role anon) lê `vitrine_lojas` com `.select("*")`;
`buscarLojaParaPedido` (confirmação, service_role) lê a tabela base `lojas` com
`.select("*")`. Zero mudança em `queries/lojas.ts`.

**3. Um único artefato novo.** `formatarEnderecoLoja` — fonte única das duas
telas. Todo o resto é ponto de inserção em código existente.

**4. 🔴 Regra de dinheiro vigente — intocável (confirma D4).** `criarPedido` RN-C2
(`pedido.ts:204-206`): em `tipo_entrega = "retirada"` o servidor **força
`taxa_entrega = 0` e ignora qualquer endereço enviado pelo cliente**; e no INSERT
(`pedido.ts:313-316`) grava `p_endereco_entrega: null` por minimização de PII
(LGPD, `seguranca.md` §20). **Consequência direta para esta feature:** em retirada
o pedido **não tem endereço nenhum gravado** — a loja é a única fonte possível do
"onde ir". Já coberto pelos testes `[071]` de `pedido.test.ts` — a issue deve
**rodar esses testes como regressão**, não reescrevê-los.

**5. 🟡 Uma loja publicada pode não ter endereço.** Todas as seis colunas são
`text` nullable e `podePublicarLoja` (`lib/utils/publicacao.ts`) só exige **nome +
WhatsApp**. Logo existe loja ativa, com retirada, sem endereço cadastrado. Isso
**não pode bloquear o checkout** (RN-R5) — precisa de fallback.

**6. 🟡 A tela do checkout é montada duas vezes no código.** O `CheckoutWizard`
renderiza `EtapaEntrega` em **duas árvores**: uma para celular (`etapa === 2`) e
outra para computador (empilhada). São `CheckoutWizard.tsx:229` e `:292`.

> **Isto não tem relação com a taxa.** A taxa zero da retirada é decidida no
> servidor e vale igual nas duas telas — nada aqui encosta nela. O risco é só de
> **acabamento**: colocar o aviso de endereço em uma árvore e esquecer a outra
> deixa o aviso invisível no computador (ou no celular). É um lembrete para quem
> implementa e para quem verifica: **conferir nas duas larguras de tela.**

---

## Visão Geral

Hoje o cliente que escolhe **retirar na loja** confirma o pedido sem ver, em
momento nenhum do fluxo, **onde fica a loja**. A vitrine não renderiza o endereço
da loja em lugar algum (verificado por varredura em `components/vitrine/` e
`app/(publica)/`), e o pedido de retirada nem grava endereço (achado 4). O cliente
decide às cegas e sai de casa sem referência.

A feature entrega isso em duas telas, alimentadas por uma **fonte única de
endereço formatado**:

- **Etapa 1 — decisão informada (checkout).** Ao marcar "Retirada no local",
  aparece um bloco com o endereço da loja, **antes** de confirmar — para o cliente
  poder recuar para entrega se for longe demais.
- **Etapa 2 — referência depois de confirmar (confirmação).** A tela de
  confirmação mostra o mesmo endereço **e um link para abrir o Google Maps**, para
  o cliente traçar a rota na hora de sair de casa.

> A numeração mudou em relação à versão 0.1.0 desta spec: o que era "Etapa 1-B"
> agora é a Etapa 2, e a antiga Etapa 2 (endereço na mensagem de WhatsApp) foi
> **cancelada** por decisão D1.

**Mundos:** vitrine pública (`/loja/[slug]/pedido` e `/loja/[slug]/confirmacao`,
sem login) para tudo que é visível ao cliente; painel (auth) apenas como **origem
do dado** — o lojista já cadastra o endereço em `/painel/configuracoes/perfil`.

**Há dinheiro nesta feature? Não.** Nenhum valor é calculado, exibido como novo
ou alterado. A feature é 100% leitura + renderização de um dado já público. O
risco real é o oposto do usual: **não regredir** a regra de dinheiro vigente da
retirada (achado 4 / RN-R4).

---

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (SaaS)** | Formata o endereço da loja server-side a partir do banco (`vitrine_lojas` no checkout, `lojas` na confirmação) e o injeta nas duas telas. Não valida, não geocodifica, não chama API externa. |
| **Lojista** | Já é o dono do dado: cadastra/edita o endereço em `/painel/configuracoes/perfil` (ou o admin SaaS em nome dele). **Nenhuma tela nova, nenhum campo novo.** Passa a ter consequência visível: endereço vazio = cliente de retirada sem referência. |
| **Cliente** | Vê o endereço no checkout antes de confirmar, e de novo na confirmação, com link de rota. **Não recebe o endereço pelo WhatsApp** (D1) — a mensagem apenas informa que o pedido é de retirada, como já faz hoje. |

> **Fronteira de autoridade (herdada dos specs 3 e 5, reafirmada):** o endereço
> exibido é **informativo** — não entra em payload, não influencia frete, não vira
> campo do pedido. A verdade do pedido e do valor permanece o registro do banco
> lido no painel.

---

## Páginas e Rotas

### Checkout — `/loja/[slug]/pedido`  *(Etapa 1)*

**Mundo:** vitrine pública (sem auth).

**Descrição:** o wizard de checkout (`CheckoutWizard` → `EtapaEntrega`) já tem o
`RadioGroup` "Entrega / Retirada no local". Quando o cliente marca **Retirada no
local**, passa a aparecer, logo abaixo do grupo de opções, um bloco de destaque
com o endereço da loja. É o espelho simétrico do bloco "Endereço de entrega", que
hoje só aparece no ramo `entrega` (`EtapaEntrega.tsx:219-257`).

A prop nova precisa ser passada **nas duas instâncias** de `EtapaEntrega`
(`CheckoutWizard.tsx:229` e `:292`) — ver achado 6.

**Sem link de mapa nesta tela (decisão de UX, não técnica):** um link externo no
meio do checkout tira o cliente do fluxo **antes** de o pedido existir; se ele não
voltar, o pedido se perde. Na confirmação o pedido já está salvo, e aí o link é
seguro. O link do Maps entra só na Etapa 2.

**Componentes:**

| Componente | Reuso / novo | Nota |
|---|---|---|
| `EtapaEntrega.tsx` | **reuso — estender** | recebe prop nova `enderecoLoja?: string \| null`; renderiza o bloco quando `tipoEntrega === "retirada"` |
| `CheckoutWizard.tsx` | **reuso — estender** | prop `enderecoLoja` repassada às **duas** instâncias de `EtapaEntrega` |
| `pedido/page.tsx` (SSR) | **reuso — estender** | deriva `enderecoLoja` de `loja` (já carregada por `buscarLojaPorSlug`); mesmo lugar onde `preAbrirWhatsapp` é derivado (`page.tsx:100`) |
| bloco de aviso | **novo, inline — sem componente novo** | reusa as classes do aviso já existente em `EtapaEntrega.tsx:174` (`rounded-lg bg-cinza-claro px-3 py-2 text-xs text-texto-muted`). Uma ocorrência só → não extrair (`architecture.md` §8: extrai a partir de 2 lugares) |
| ícone `MapPin` (lucide-react) | **reuso** | lucide já é dependência; `EtapaEntrega` já importa de `lucide-react` |
| `formatarEnderecoLoja` | **NOVO util puro** | `src/lib/utils/enderecoLoja.ts` — ver Modelos de Dados |
| `Alert` do shadcn | **não existe no projeto** | `components/ui/` não tem `alert.tsx`. **Não instalar** por um bloco de texto — usar o padrão inline já vigente na tela |

**Behaviors:**

- [ ] **Ver o endereço da loja ao marcar "Retirada no local".** O bloco aparece
  no mesmo instante da seleção, sem request. Garantido em: **SSR (dado) + cliente
  (UX)** — a string vem pronta do servidor no primeiro render da página
  (`buscarLojaPorSlug` → `vitrine_lojas`); o cliente só decide **mostrar ou não**
  conforme o rádio. Nenhuma chamada de rede no toggle.
- [ ] **Não ver o bloco ao marcar "Entrega"** (ou sem tipo escolhido). Garantido
  em: cliente (UX) — condicional sobre `tipoEntrega === "retirada"`.
- [ ] **Trocar de retirada para entrega depois de ver o endereço** ("é longe
  demais"). Garantido em: cliente (UX) — comportamento já existente do
  `RadioGroup`; esta feature **não pode** alterar o gate `podeConfirmar`
  (`estado.ts:67`) nem o gate de frete `chaveFrete` (`estado.ts:89`), que continua
  retornando `null` em retirada.
- [ ] **Confirmar o pedido normalmente quando a loja não tem endereço
  cadastrado.** O bloco mostra o fallback (RN-R5) e o checkout segue. Garantido
  em: por design — o aviso é informativo e **nunca** entra em `podeConfirmar`.
- [ ] **Ver o mesmo bloco no celular e no computador.** Garantido em: cliente
  (UX) — prop passada nas duas instâncias de `EtapaEntrega` (achado 6).
  Verificação obrigatória nas duas larguras.

---

### Confirmação do pedido — `/loja/[slug]/confirmacao?pedido=<id>&token=<token>`  *(Etapa 2)*

**Mundo:** vitrine pública (sem auth) — leitura escopada por `token_acesso`.

**Descrição:** a página já exibe "Tipo: Retirada no local" (`page.tsx:235`) e, só
em entrega, o endereço **do cliente** (`page.tsx:239-244`). Ganha o bloco
simétrico: em retirada, o **endereço da loja** e, abaixo dele, um **link "Abrir no
Google Maps"**. Custo baixo — a página já carrega a loja completa
(`buscarLojaParaPedido`, `page.tsx:138`).

**Link do Google Maps — como (aprovado em D2):**

```
https://www.google.com/maps/search/?api=1&query=<endereço formatado, encodeURIComponent>
```

Formato oficial de URL do Google Maps: **sem chave de API, sem custo, sem
coordenadas** — abre o app no celular e o site no computador. Não viola a decisão
de não expor `latitude`/`longitude` (a view `vitrine_lojas` continua sem essas
colunas): a busca é feita pelo texto do endereço.

Abre em nova aba com `target="_blank"` **e `rel="noopener noreferrer"`** — o mesmo
cuidado da issue 126 (reverse tabnabbing); ver Segurança. O link **não aparece**
quando a loja não tem endereço (RN-R5) — link de busca vazia levaria o cliente a
uma tela inútil do Maps.

**Componentes:** `Card`/`CardContent`/`Separator` (shadcn, já em uso), ícone
`MapPin`/`ExternalLink` (lucide, já em uso) + `formatarEnderecoLoja` (mesmo util
da Etapa 1). Sem componente novo.

**Behaviors:**

- [ ] **Ver o endereço de retirada na confirmação.** Garantido em: **SSR** — a
  loja é lida server-side por `ped.loja_id` (service_role) na página já protegida
  por `token_acesso`.
- [ ] **Abrir o Google Maps a partir da confirmação**, em nova aba, já com o
  endereço da loja buscado. Garantido em: **SSR (a URL é montada no servidor a
  partir do endereço do banco)** + cliente (o clique). Nenhuma API externa é
  chamada pelo iRango — quem chama o Google é o navegador do cliente, se ele
  clicar.
- [ ] **Não ver o bloco nem o link quando o pedido é de entrega.** Garantido em:
  **SSR** — condicional sobre `pedidos.tipo_entrega`, coluna gravada pelo servidor.
- [ ] **Não ver o link quando a loja não tem endereço** — vê só o texto de
  fallback (RN-R5). Garantido em: **SSR** — `formatarEnderecoLoja` devolve `null`.
- [ ] **Continuar vendo o botão manual "Avisar a loja no WhatsApp"** exatamente
  como hoje, com a mensagem inalterada. Garantido em: por design — esta feature
  não toca a condição de renderização do botão nem o montador da mensagem
  (spec 3 RN-W3 / spec 5 RN-A3; D1).

---

### Mensagem de WhatsApp — **sem mudança** *(era a Etapa 2 da v0.1.0)*

**Cancelada por decisão D1.** Registrada aqui para quem for implementar não
"completar" a feature por conta própria.

A mensagem de um pedido de retirada **já informa que é retirada** hoje:
`whatsappPedido.ts:99` escreve `Entrega: Retirada no local` (via
`rotuloTipoEntrega`, `whatsappPedido.ts:21`). O dono do produto decidiu que isso
basta e que o endereço **não** deve entrar no texto.

Portanto ficam **intocados**: `montarLinkWhatsappPedido`, `criarPedido`,
`useEnviarPedido`, `aberturaWhatsapp.ts` e o botão manual da confirmação. Nenhum
arquivo de WhatsApp entra no diff desta feature. Se um deles aparecer no diff, é
sinal de que o escopo vazou.

---

### Perfil da loja — `/painel/configuracoes/perfil` e `/admin/assinantes/[lojaId]/configuracoes/perfil`

**Mundo:** painel (auth obrigatório — RLS `lojas_update_proprio`) e painel admin
SaaS (auth + escopo por tenant via `escopo.atualizarLoja`).

**Descrição:** **nenhuma mudança obrigatória.** Estas páginas são listadas porque
são a **origem do dado** que a feature passa a exibir publicamente, e porque o
achado 5 (loja publicada sem endereço) nasce aqui. Os campos de endereço já
existem em `PerfilClient.tsx`, `schemaPerfil` e `montarPatchPerfil` — a allowlist
já cobre as seis colunas (`patches-loja.ts:42-48`).

**Behaviors:**

- [ ] *(opcional — RN-R8)* **Ver uma nota abaixo do bloco de endereço** dizendo
  que o endereço aparece para clientes que escolhem retirada. Garantido em:
  cliente (UX puro) — texto estático, zero lógica. Corte limpo se quiser a entrega
  mínima.
- [ ] **Salvar o endereço continua gravando exatamente as mesmas colunas, pela
  mesma allowlist.** Garantido em: **Server Action + RLS** (lojista) e **Server
  Action + binding por tenant** (admin, `escopo.atualizarLoja` com `lojaId` da
  rota validada, nunca do payload). Esta feature **não adiciona nenhuma escrita**
  — é o comportamento vigente, listado aqui como invariante a não regredir.

---

## Modelos de Dados

**Nenhuma migration. Nenhuma view recriada. Nenhuma coluna nova. Nenhuma policy RLS nova.**
A feature é 100% leitura e renderização.

### Tabelas e views lidas (todas existentes — `schema.md`)

| Fonte | Colunas usadas | Caminho | Role |
|---|---|---|---|
| view `vitrine_lojas` | `endereco_rua`, `endereco_numero`, `endereco_bairro`, `endereco_cidade`, `endereco_estado`, `endereco_cep` | `buscarLojaPorSlug` (checkout SSR) | `anon` |
| tabela `lojas` | as mesmas seis | `buscarLojaParaPedido` (confirmação) | `service_role` |
| tabela `pedidos` | `tipo_entrega` (só leitura, para decidir o bloco) | `buscarPedidoPorToken` | `service_role` |

`vitrine_lojas` mantém `security_invoker = false` e `where ativo = true`
(`seguranca.md` §19) — inalterado. Os `select("*")` de ambas as queries já trazem
as colunas; **nenhuma query é editada**.

### Artefato novo — `src/lib/utils/enderecoLoja.ts`

```ts
/**
 * Endereço da loja em uma linha, para exibição ao cliente (retirada).
 * Fonte ÚNICA compartilhada pelo checkout (Etapa 1) e pela confirmação (Etapa 2).
 * Pura, sem I/O — testável em vitest node.
 * `null` quando não há partes suficientes (RN-R5) — nunca "—", nunca string vazia.
 */
export function formatarEnderecoLoja(
  loja: Pick<
    LojaPublica,
    | "endereco_rua" | "endereco_numero" | "endereco_bairro"
    | "endereco_cidade" | "endereco_estado" | "endereco_cep"
  >,
): string | null
```

**Por que um util novo e não reuso:** foi verificado que nenhuma função existente
serve. `formatarEndereco` (duplicada em `whatsappPedido.ts:33` e
`confirmacao/page.tsx:60`) formata o **JSONB `endereco_entrega` do cliente**, não
as colunas da loja — shape diferente (`rua`/`uf` vs `endereco_rua`/`endereco_estado`).
`montarConsultaGeocoding` (`patches-loja.ts:64`) monta a query do Nominatim:
acrescenta `"Brasil"` e retorna `null` sem cidade+estado — semântica de
geocoding, não de exibição. **Não reaproveitar nenhuma das duas.**

A duplicação de `formatarEndereco` é débito **pré-existente**, registrado em
`specs/_debito-produto-2026-09-06.md` §2 — não se resolve nesta feature.

---

## Regras de Negócio

**RN-R1 — Formato exibido.** Uma linha, do mais específico ao mais geral, partes
vazias omitidas:

```
{rua}, {numero} · {bairro} — {cidade}/{estado} · CEP {cep}
```

Cada parte entra só se for string não vazia após `trim()`. Separadores nunca
sobram (uma parte ausente não deixa `", "` ou `· ·` órfãos). Mesma estética do
`formatarEndereco` já usado na confirmação, para o cliente reconhecer o padrão.
Camada: **util puro**, chamado no servidor nos dois pontos de uso.

**RN-R2 — Fonte única.** Etapa 1 e Etapa 2 chamam `formatarEnderecoLoja`. É
proibido reformatar o endereço inline em qualquer um dos dois pontos, e a mesma
string formatada alimenta o texto exibido **e** a busca do link do Maps. Camada:
convenção de código (`architecture.md` §8 DRY), verificável por revisão e pelo
teste do util.

**RN-R3 — Só em retirada.** O bloco (Etapas 1 e 2) e o link do Maps aparecem
**apenas** quando o tipo de entrega é retirada. Em entrega nada muda.
Camada: **cliente (UX)** na Etapa 1, sobre `tipoEntrega` do estado local (é
intenção do cliente, não valor — não precisa de servidor); **SSR** na Etapa 2,
sobre `pedidos.tipo_entrega`, coluna gravada pelo servidor.

**RN-R4 — 🔴 A regra de dinheiro da retirada é intocável (D4).** Continua valendo,
sem alteração de uma linha:
- `criarPedido` força `taxa_entrega = 0` em retirada e **ignora qualquer endereço
  enviado pelo cliente** (`pedido.ts:204-206`);
- o INSERT grava `p_endereco_entrega: null` em retirada, por minimização de PII
  (`pedido.ts:313-316`; `seguranca.md` §20);
- `chaveFrete` continua devolvendo `null` em retirada — **nenhuma** chamada a
  `calcularFreteAction` é disparada pelo novo bloco.

O endereço da loja é **exibição pura**: não entra em `montarPayloadPedido`, não é
persistido em `pedidos`, não influencia frete, cupom ou total. Camada: **Server
Action** (regra vigente) + **teste de regressão obrigatório** (ver Testes).

**RN-R5 — Loja sem endereço: degrada, não bloqueia.** `formatarEnderecoLoja`
retorna `null` quando não há nenhuma parte preenchida.
- Etapa 1 e Etapa 2: renderizam um texto neutro — *"Combine o local de retirada
  com a loja pelo WhatsApp."* — e **nunca** desabilitam "Confirmar pedido". Não
  inventar canal que não existe (mesmo princípio do RN-W3 do spec 3).
- Etapa 2: o **link do Maps não é renderizado** neste caso.

Endereço **parcial** (ex.: só cidade/estado) é exibido como está, e o link do Maps
é gerado com o que houver — meia informação é melhor que nenhuma, e o cliente tem
o WhatsApp da loja para completar. Camada: **util puro** (decisão) + SSR/cliente
(UX do fallback).

**RN-R6 — Link do Maps sim; geocoding, coordenadas e mapa embutido não.**
Reescrita em relação à v0.1.0 por decisão D2.
- **Permitido:** um link de texto para `https://www.google.com/maps/search/?api=1&query=<endereço>`
  na tela de **confirmação apenas**, com o endereço passando por
  `encodeURIComponent`. Sem chave, sem custo, sem backend.
- **Proibido:** mapa embutido (iframe/SDK), `latitude`/`longitude` (a view
  `vitrine_lojas` deliberadamente não as expõe), qualquer chamada de geocoding
  feita pelo iRango, e link externo **no checkout** (tiraria o cliente do fluxo
  antes de o pedido existir).

Camada: por design + revisão de código.

**RN-R7 — A mensagem de WhatsApp não muda (D1).** O texto montado por
`montarLinkWhatsappPedido` permanece byte a byte igual ao de hoje, incluindo a
linha `Entrega: Retirada no local` que já existe. Nenhuma linha de endereço da
loja é acrescentada. Camada: por design + teste de regressão do formato, se a
issue tocar qualquer arquivo vizinho.

**RN-R8 — (opcional) Nota ao lojista no painel.** Texto estático abaixo do bloco
de endereço em `/painel/configuracoes/perfil` (e no espelho admin, por paridade —
`specs/paridade-hub-admin-painel.md`) informando que o endereço é exibido a
clientes de retirada. Camada: cliente (UX), zero lógica, zero risco.

---

## Segurança (obrigatório)

**Criticidade: baixa.** Os dois riscos reais desta feature são **regressão** na
regra de dinheiro da retirada (RN-R4) e o **link externo** novo (RN-R6). Ponto a
ponto:

- **Que dado sensível entra ou sai?** Sai o **endereço comercial da loja**, que
  **já é público**: projetado em `vitrine_lojas` para `anon` desde a migration
  `20260615013000` (achado 1), na mesma classe de `whatsapp`, `telefone` e
  `logo_url` — dado de contato de estabelecimento comercial, **não é PII de pessoa
  física** (`seguranca.md` §20 trata PII de cliente; endereço de loja é dado de
  negócio, exibido justamente para ser encontrado). **Nenhum dado novo é exposto
  ao `anon`.**
- **PII do cliente:** **inalterada**. Nenhuma coluna de cliente é lida, exibida ou
  transportada a mais. Em retirada, o pedido continua **sem** endereço do cliente
  gravado (RN-R4) — a feature **preserva** essa minimização, não a contorna.
  O link do Maps carrega o endereço **da loja**, nunca o do cliente.
- **Algum valor monetário?** **Nenhum.** Nada é calculado, exibido como novo, nem
  recalculado. O endereço da loja não é input, é output. O recálculo autoritativo
  de `criarPedido` segue idêntico (`seguranca.md` §10).
- **Tabela nova?** Não. **Coluna nova?** Não. **Policy RLS nova?** Não. **View
  recriada?** Não — e é justamente por isso que o risco de `drop view` (janela em
  que a vitrine anônima perderia o `select`) **não existe** aqui.
- **API externa com key?** Não. O link do Maps é uma URL pública clicada **pelo
  navegador do cliente**; o iRango não faz request algum ao Google, não tem chave
  e não incorre em custo (`architecture.md` §9 — custo previsível).
- **🔴 Reverse tabnabbing (link externo novo).** O link do Maps abre em nova aba e
  **precisa** de `rel="noopener noreferrer"` junto de `target="_blank"`. É
  exatamente a falha corrigida na issue 126 para a aba do WhatsApp — não reintroduzir
  pela porta do Maps. Vale teste ou revisão explícita.
- **Construção do `href`.** A origem é **literal no código**
  (`https://www.google.com/maps/search/?api=1&query=`) e só o endereço, vindo do
  banco, é interpolado — sempre por `encodeURIComponent`. Assim um lojista não
  consegue transformar o link em `javascript:` nem em outro destino: o esquema e o
  domínio nunca vêm de dado. **Nunca** montar esse href concatenando um valor de
  banco na posição do esquema/domínio.
- **XSS:** o endereço vem do banco como `text` e é renderizado como **filho de
  JSX** (escapado pelo React) — nunca `dangerouslySetInnerHTML`. Um lojista que
  escrevesse `<script>` no campo de rua veria o texto literal, não execução.
  `seguranca.md` §15 preservado.
- **`token_acesso`:** continua **proibido** em qualquer texto ou URL externa. O
  link do Maps carrega **apenas** o endereço da loja — conferir que nenhum
  parâmetro da rota de confirmação vaza para a query do Google.
- **Escrita cross-tenant:** **nenhuma escrita nova**. Esta feature não toca a
  superfície de UPDATE de `lojas`. Se o RN-R8 opcional for aceito, ainda assim é
  texto estático — sem campo, sem patch, sem action.

---

## Testes e regressão

**Obrigatório — regressão da regra de dinheiro (RN-R4 / D4).** Rodar e manter
verdes os testes `[071]` de `src/lib/actions/pedido.test.ts`, em especial:
- `"[071] RN-C2 retirada com endereço enviado → p_taxa_entrega=0 e p_tipo_entrega='retirada'"`
- a asserção de `p_endereco_entrega: null` em retirada.

Se algum deles ficar vermelho, **a feature quebrou dinheiro ou LGPD** — parar e
reverter. Nenhum desses testes pode ser editado por esta entrega.

**Novo — `src/lib/utils/enderecoLoja.test.ts`** (util puro, `environment: node`):
todas as partes; partes faltando (sem separador órfão); **todas** as partes
`null`/vazias → `null`; strings só com espaços tratadas como vazias.

**Link do Maps:** cobrir que a URL é montada com `encodeURIComponent` (endereço
com `&`, `#`, espaço e acento não quebra o link) e que o link **não** é renderizado
quando o endereço é `null`. Se a montagem virar uma função pura, testar junto do
util; se ficar inline no componente, cobrir na verificação em navegador.

**`whatsappPedido.ts` não é tocado (D1)** — não há teste novo a escrever ali. Se
alguma issue acabar mexendo nesse arquivo, é sinal de escopo vazado (RN-R7);
nesse caso, travar o formato da mensagem com teste antes de qualquer edição.
Observação para o futuro: esse montador **não tem teste unitário próprio** hoje,
só é exercitado de lado por `pedido.test.ts` — débito conhecido, fora desta
entrega.

**Componentes:** o repositório não usa jsdom. A cobertura de `EtapaEntrega` fica
na verificação em navegador — obrigatoriamente **nas duas larguras de tela**
(achado 6) — e o link do Maps deve ser clicado de verdade uma vez, conferindo que
abre em nova aba e cai no endereço certo.

---

## Fora do escopo (primeira entrega)

- **Endereço da loja na mensagem de WhatsApp** — **cancelado por decisão D1**, não
  adiado. A mensagem já diz que é retirada e o dono do produto decidiu que basta.
- **Complemento / ponto de referência** — adiado por decisão D3; motivo, custo e
  critério de reabertura em **`specs/_debito-produto-2026-09-06.md` §1**.
- **Mapa embutido, coordenadas e geocoding** (RN-R6) — só o link de busca por
  texto está aprovado. Mapa embutido ou rota calculada exigiria SDK e/ou
  `latitude`/`longitude`, que a view pública não expõe por decisão anterior.
- **Link do Maps no checkout** — deliberado: tiraria o cliente do fluxo antes de o
  pedido existir.
- **Distância / tempo estimado até a loja** — exigiria geocodificar o cliente na
  retirada (hoje nem endereço é coletado nesse ramo) e chamada externa por
  visita: custo variável, proibido por `architecture.md` §9.
- **Tornar o endereço obrigatório para publicar a loja** — mudaria
  `podePublicarLoja` (`lib/utils/publicacao.ts`), que é gate autoritativo de
  publicação, e travaria lojas já publicadas. Decisão de produto separada.
- **Endereço da loja na vitrine (`/loja/[slug]`), no rodapé ou no `HeaderLoja`** —
  desejável, mas é outra superfície e outro público (todo visitante, não só quem
  escolhe retirada).
- **Consolidar a duplicação de `formatarEndereco`** — débito pré-existente,
  registrado em `specs/_debito-produto-2026-09-06.md` §2.
- **Personalizar o texto da mensagem pelo lojista** — mensagem segue fixa (spec 3
  e spec 5, Fora do Escopo).
- **Horário de retirada / janela de retirada** — fase futura, junto de agendamento
  (`modelo-negocio.md` §8).
