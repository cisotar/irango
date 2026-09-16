# Spec: Endereço da loja na retirada (checkout + confirmação)

**Versão:** 0.3.0 | **Atualizado:** 2026-09-15

---

## Decisões do dono do produto (2026-09-15)

Registradas por cima das decisões de 2026-09-06 abaixo — leia as duas seções,
nesta ordem, porque a de 2026-09-15 **reverte parte** da anterior.

Pedido literal do dono do produto:

> "1 - quando comprador seleciona retirar na loja, exibir na tela mensagem com o
> endereço da loja (rua, número e bairro). Na página de confirmação do pedido que
> comprador vê, exibir o endereço no mesmo formato. Na mensagem que vai pelo
> whatsapp, exibir o endereço da loja no mesmo formato. Assim fica fácil do
> cliente ver o endereço.
> 2 - quando comprador seleciona receber em casa, nos endereços que são exibidos
> na confirmação da compra e na mensagem pelo whtsapp, cidade e estado e CEP são
> desnecessários, bastam rua, número e bairro."

**Consequências, fechadas:**

- **D1 revertida.** A mensagem de WhatsApp **passa a levar** o endereço da loja
  em retirada — exatamente a "Etapa 2" que a v0.1.0 propunha e a v0.2.0 cancelou.
  Ver D1 revisada abaixo e RN-R7.
- **RN-R1 encurtada.** O formato exibido cai para `{rua}, {numero} · {bairro}` —
  sem cidade, estado ou CEP — tanto para o endereço da loja quanto para o do
  cliente. As colunas continuam coletadas e gravadas; muda só a exibição.
- **D2 retomada.** O link do Google Maps na confirmação (aprovado em 2026-09-06,
  nunca entregue) segue como escopo ativo desta entrega — o dono confirmou
  explicitamente em 2026-09-15 ("peça") depois de a sessão levantar o custo.
- **D3 e D4 (abaixo) não mudam.**

---

## Decisões do dono do produto (2026-09-06)

Registradas aqui porque mudaram o escopo depois da primeira análise do código.
Quem for implementar deve tratar estas quatro como fechadas.

**D1 — REVERTIDA em 2026-09-15.** ~~A mensagem de WhatsApp NÃO leva o endereço da
loja.~~ Decisão original (2026-09-06): *"na mensagem aparece que é retirada, mas
não precisa escrever o endereço da loja."*

> **Histórico (válido até 2026-09-15):** `montarLinkWhatsappPedido`
> (`whatsappPedido.ts:99`) já escreve a linha `Entrega: Retirada no local` para
> todo pedido de retirada, via `rotuloTipoEntrega`. A "Etapa 2" que a versão 0.1.0
> desta spec propunha (acrescentar `Retirar em: <endereço>`) estava **cancelada**:
> `whatsappPedido.ts` ficava **intocado**.

**Decisão nova (2026-09-15):** o dono do produto pediu explicitamente a etapa
cancelada. A mensagem de retirada **passa a levar** `Retirar em: <endereço
curto>` quando a loja tem endereço (RN-R5). `whatsappPedido.ts` **entra** no
escopo desta entrega — ver RN-R7 (reescrita) e a seção "Mensagem de WhatsApp"
abaixo. O restante da mensagem permanece byte a byte igual.

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
> agora é a Etapa 2. A antiga Etapa 2 (endereço na mensagem de WhatsApp) foi
> cancelada por decisão D1 em 2026-09-06 e **revertida em 2026-09-15** — ver
> "Decisões do dono do produto (2026-09-15)" e RN-R7. A mensagem de WhatsApp
> volta a fazer parte do escopo, como Etapa 3.

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
| **Cliente** | Vê o endereço no checkout antes de confirmar, na confirmação (com link de rota) e **na mensagem de WhatsApp** de retirada (D1 revertida em 2026-09-15, RN-R7). |

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
da Etapa 1). **Um componente novo, pequeno:**
`src/components/vitrine/confirmacao/LinkMapsLoja.tsx` (~12 linhas,
apresentacional) — extraído porque a página é Server Component `async` (lê
Supabase) e não é alcançável por `renderToStaticMarkup`; extrair o link torna
`target`/`rel` mecanicamente testáveis (ver Testes).

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
- [ ] **Continuar vendo o botão manual "Avisar a loja no WhatsApp"** na mesma
  condição de hoje; a mensagem que ele abre **muda apenas nas duas linhas da
  RN-R7** (endereço da loja em retirada; endereço do cliente encurtado em
  entrega) — todo o resto do texto e a condição de renderização do botão
  permanecem inalterados (spec 3 RN-W3 / spec 5 RN-A3).

---

### Mensagem de WhatsApp — Etapa 3 — REVERTIDA em 2026-09-15 (D1)

**A "Etapa 2" cancelada pela v0.2.0 volta ao escopo**, por pedido explícito do
dono do produto — ver "Decisões do dono do produto (2026-09-15)".

A mensagem de um pedido de retirada **já informa que é retirada** hoje:
`whatsappPedido.ts:99` escreve `Entrega: Retirada no local` (via
`rotuloTipoEntrega`, `whatsappPedido.ts:21`). Passa a acrescentar, logo abaixo, a
linha `Retirar em: <endereço curto>` (RN-R1) quando a loja tem endereço (RN-R5).
Em entrega, a linha `Endereço:` do cliente encurta para o mesmo formato (RN-R1),
sem cidade, estado ou CEP.

**O que muda:** `montarLinkWhatsappPedido` (`whatsappPedido.ts`) e seu teste.
**O que NÃO muda — a troca de assinatura é só de tipo:** `pedido.ts` e
`useEnviarPedido.ts` já passam a `loja` completa para `montarLinkWhatsappPedido`
hoje; alargar o `Pick` de parâmetros não altera nenhuma chamada. `criarPedido`,
`aberturaWhatsapp.ts` e o botão manual da confirmação ficam **intocados** —
nenhum decide o texto, só disparam a abertura do link já montado. Todo o resto da
mensagem permanece byte a byte igual, travado por teste de regressão **antes** da
edição (RN-R7).

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

**Por que um util novo, e reuso parcial — REVISTO em 2026-09-15.**
`formatarEndereco` (duplicada em `whatsappPedido.ts:33` e
`confirmacao/page.tsx:60`) formata o **JSONB `endereco_entrega` do cliente** —
shape diferente (`rua`/`uf` vs `endereco_rua`/`endereco_estado` da loja) — por
isso o endereço da loja precisa de formatador próprio. Mas os itens 1 e 2 pedem
**o mesmo formato curto** (RN-R1) para os dois lados: a saída é **um util único**
com dois adaptadores (colunas de `lojas` × JSONB do cliente), o que também
resolve a duplicação de `formatarEndereco` — antes débito em
`specs/_debito-produto-2026-09-06.md` §2, **resolvido nesta entrega** (ver Fora
do escopo).

`montarConsultaGeocoding` (`patches-loja.ts:64`) continua **não reaproveitado
para exibição** (acrescenta `"Brasil"`, que polui a tela) — mas passa a ser
**reusado para a consulta do link do Maps** (RN-R6), onde `"Brasil"` ajuda e o
veto ao CEP é exatamente o comportamento desejado. Ver RN-R6 para o override
explícito.

---

## Regras de Negócio

**RN-R1 — Formato exibido — REESCRITA em 2026-09-15 (encurtada).** Uma linha, só
com o essencial para localizar fisicamente o ponto — cidade, estado e CEP são
desnecessários na tela e na mensagem, e **saem da exibição**:

```
{rua}, {numero} · {bairro}
```

Cada parte entra só se for string não vazia após `trim()`. Separadores nunca
sobram (uma parte ausente não deixa `", "` ou `· ·` órfãos). Vale para o endereço
da loja (Etapas 1 e 2) **e** para o endereço do cliente exibido na confirmação e
na mensagem de WhatsApp (mesma regra, dois lados).

**As seis colunas continuam sendo coletadas e gravadas sem alteração** — só a
**exibição** encurta. Em especial o CEP: continua obrigatório para o cálculo de
frete (`calcularFreteAction`); esta regra não toca coleta, cadastro nem cálculo,
só o texto mostrado ao cliente. Formato anterior (histórico, até 2026-09-15):
`{rua}, {numero} · {bairro} — {cidade}/{estado} · CEP {cep}`.

Camada: **util puro**, chamado no servidor em todos os pontos de uso.

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

**RN-R5 — Loja sem endereço ou sem âncora geográfica: degrada, não bloqueia —
REESCRITA em 2026-09-15 (unifica fallback de texto e de link).**
`formatarEnderecoLoja` retorna `null` quando não há nenhuma parte preenchida.
- Etapa 1 e Etapa 2: renderizam um texto neutro — *"Combine o local de retirada
  com a loja pelo WhatsApp."* — e **nunca** desabilitam "Confirmar pedido". Não
  inventar canal que não existe (mesmo princípio do RN-W3 do spec 3).
- Mensagem de WhatsApp (RN-R7): **nenhuma linha `Retirar em:` é escrita** —
  nunca `—`, nunca linha vazia.
- Etapa 2: o **link do Maps só é renderizado quando há âncora geográfica**
  (cidade **e** estado preenchidos) — é exatamente o que `montarConsultaGeocoding`
  garante (RN-R6). Endereço parcial sem cidade/estado exibe o texto curto que
  tiver (RN-R1) e **não** gera link: uma busca sem cidade levaria o cliente a uma
  tela inútil do Maps, o problema que este fallback existe para evitar. Substitui
  a regra da v0.2.0 ("gerar o link com o que houver").

Camada: **util puro** (decisão) + SSR/cliente (UX do fallback).

**RN-R6 — Link do Maps sim; geocoding, coordenadas e mapa embutido não.**
Reescrita em relação à v0.1.0 por decisão D2; **conferida e alinhada em
2026-09-15** ao formato de exibição curto (RN-R1).

- **Permitido:** um link de texto para
  `https://www.google.com/maps/search/?api=1&query=<consulta codificada>` na tela
  de **confirmação apenas**. A origem (`https://www.google.com/maps/search/?api=1&query=`)
  é **literal no código**; só a consulta é interpolada, sempre por
  `encodeURIComponent`. Sem chave, sem custo, sem backend.
- **Consulta ≠ exibição, de propósito.** A tela mostra o endereço **curto**
  (RN-R1: `rua, numero · bairro`); a busca do Maps usa o endereço **completo, com
  cidade e UF** — sem cidade o Maps fica ambíguo. **Isto não contradiz a RN-R1**,
  que trata de exibição, não de busca.
- **🛑 O CEP não entra na consulta.** Decisão já provada no projeto:
  `patches-loja.ts` documenta (issues 185/186) que o CEP cru é token envenenador
  em busca livre — `q=12914-190` chegou a resolver para uma estrada na República
  Tcheca. A consulta reusa **`montarConsultaGeocoding`**
  (`src/lib/actions/patches-loja.ts`), que já monta `"{rua}, {numero}, {bairro},
  {cidade} - {estado}, Brasil"` sem CEP e devolve `null` sem cidade **e** estado.
- **Override explícito da nota em "Modelos de Dados":** "não reaproveitar
  `montarConsultaGeocoding`" vale para **formatação de exibição** (ela acrescenta
  `"Brasil"`, que polui a tela) e continua valendo para isso. Para **consulta de
  busca** o raciocínio se inverte: `"Brasil"` ancora o país e ajuda. Reusar
  `montarConsultaGeocoding` para montar a query do link é a decisão certa.
- **Proibido, inalterado:** mapa embutido (iframe/SDK), `latitude`/`longitude` (a
  view `vitrine_lojas` deliberadamente não as expõe), qualquer chamada de
  geocoding feita pelo iRango, e link externo **no checkout** (tiraria o cliente
  do fluxo antes de o pedido existir).

Camada: por design + revisão de código.

**RN-R7 — A mensagem de WhatsApp muda em dois pontos — REESCRITA em 2026-09-15
(reverte D1).** O texto montado por `montarLinkWhatsappPedido` muda **apenas**:
- em retirada, acrescenta a linha `Retirar em: <endereço curto>` (RN-R1) logo
  após `Entrega: Retirada no local`, só quando a loja tem endereço (RN-R5);
- em entrega, a linha `Endereço:` do cliente passa a usar o formato curto
  (RN-R1), sem cidade, estado ou CEP.

Todo o resto do texto permanece **byte a byte igual** ao de hoje — travado por
teste de regressão **antes** da edição (fase RED do `tdd`). Camada: **util puro**
(formatação) + `whatsappPedido.ts` (montagem) + teste de regressão obrigatório.

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
`null`/vazias → `null`; strings só com espaços tratadas como vazias. Cobre também
o adaptador do endereço do cliente (RN-R1), para os dois lados usarem o mesmo
formato curto.

**Link do Maps:** cobrir que a URL é montada com `encodeURIComponent` (endereço
com `&`, `#`, espaço e acento não quebra o link); que **o CEP não aparece na
consulta** (RN-R6); que sem cidade/estado a consulta é `null` (RN-R5); e que a
consulta **não contém nenhum parâmetro de `searchParams`** da rota de confirmação
(`token`/`pedido`).

**`whatsappPedido.ts` — REVERTIDO em 2026-09-15 (D1 revertida, RN-R7).** Este
arquivo **entra** no escopo. Antes de editar: travar o formato atual da mensagem
com teste de regressão (todo o texto, byte a byte, exceto as duas linhas que
mudam), com output `FAIL` capturado — depois alterar. `whatsappPedido.test.ts`
ganha os dois casos novos (retirada com/sem endereço; entrega com formato curto).

**Componentes — CORRIGIDO em 2026-09-15: o repositório TESTA componente.** A
afirmação anterior ("não usa jsdom, cobertura fica em navegador") estava
**errada**: `vitest.config.ts` roda `environment: "node"` **com
`@vitejs/plugin-react`**, e `ListaOpcionaisItem.test.tsx`, `HeaderLoja.test.tsx` e
`StatusAssinatura.test.tsx` já testam JSX via `renderToStaticMarkup`
(`react-dom/server`). Consequência: o componente do link do Maps **é**
mecanicamente testável — **obrigatório** cobrir `target="_blank"` e
`rel="noopener noreferrer"` (copiando `StatusAssinatura.test.tsx:266-269`), **com
o motivo do `noreferrer` nomeado no teste**: a URL da confirmação carrega
`token_acesso` na query, e sem `noreferrer` o header `Referer` a entregaria ao
Google no clique. Cobrir também que `<script>` na observação/endereço sai
escapado no HTML, nunca como tag.

A verificação em navegador continua obrigatória **nas duas larguras de tela**
(achado 6), e o link do Maps deve ser clicado de verdade uma vez, conferindo que
abre em nova aba e cai no endereço certo — mas deixa de ser a **única** rede: o
teste de componente pega regressão de `target`/`rel` antes do humano precisar
clicar.

---

## Fora do escopo (primeira entrega)

- **Complemento / ponto de referência** — adiado por decisão D3; motivo, custo e
  critério de reabertura em **`specs/_debito-produto-2026-09-06.md` §1**.
- **Mapa embutido, coordenadas e geocoding** (RN-R6) — só o link de busca por
  texto está aprovado (D2). Mapa embutido ou rota calculada exigiria SDK e/ou
  `latitude`/`longitude`, que a view pública não expõe por decisão anterior.
- **Link do Maps no checkout** — deliberado: tiraria o cliente do fluxo antes de o
  pedido existir. O link entra só na confirmação (RN-R6).
- **Distância / tempo estimado até a loja** — exigiria geocodificar o cliente na
  retirada (hoje nem endereço é coletado nesse ramo) e chamada externa por
  visita: custo variável, proibido por `architecture.md` §9.
- **Tornar o endereço obrigatório para publicar a loja** — mudaria
  `podePublicarLoja` (`lib/utils/publicacao.ts`), que é gate autoritativo de
  publicação, e travaria lojas já publicadas. Decisão de produto separada — ver
  `tasks/193-endereco-obrigatorio-e-gate-de-publicacao.md`.
- **Endereço da loja na vitrine (`/loja/[slug]`), no rodapé ou no `HeaderLoja`** —
  desejável, mas é outra superfície e outro público (todo visitante, não só quem
  escolhe retirada).
- **Personalizar o texto da mensagem pelo lojista** — mensagem segue fixa (spec 3
  e spec 5, Fora do Escopo).
- **Horário de retirada / janela de retirada** — fase futura, junto de agendamento
  (`modelo-negocio.md` §8).
- **Painel do lojista (`src/components/painel/**`) não muda.** `ComandaCozinha`,
  `DetalhePedido` e `ReciboCliente` continuam exibindo o endereço do cliente no
  formato completo (com cidade, estado e CEP) — é onde o lojista precisa dele
  para entregar. Esta entrega corta só as telas do **comprador**.

**Resolvido nesta entrega (não é mais débito):** a duplicação de
`formatarEndereco` (`whatsappPedido.ts` e `confirmacao/page.tsx`, antes
registrada em `specs/_debito-produto-2026-09-06.md` §2) é consolidada num único
util com dois adaptadores — RN-R1/RN-R2.
