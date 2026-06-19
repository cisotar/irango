# Spec: Correção de Dois Bugs no Checkout — Frete Fantasma + Coords NULL da Loja

**Versão:** 1.0.0 | **Atualizado:** 2026-06-19 | **Status:** ✅ IMPLEMENTADO (8 issues, 1388 testes verdes, build verde, auditoria 0 MÉDIA+, verificado contra o cloud `gdlegxatwylhkjcrusyk`)

> **Resolução (19 jun 2026):** Bug 1 (001/002) e Bug 2-c (003/005) implementados com TDD red-first; Bug 2-b (004/007/008) implementado. **Bug 2-a (006 — backfill): NO-OP** — a única loja-alvo (Pizza da Tia, `annaluciaguimaraes`) tem zona raio ativa mas **endereço TODO NULL**, logo não há o que geocodificar. O raio dessa loja só funciona depois que o lojista completar o endereço no painel (geocodifica no save, agora com aviso por motivo — 007/008). Nenhuma coord literal foi gravada (RN-2-D). Pão do Ciso (com coords) funciona: CEP 12900-000 → R$8 zona 4km (verificado).

> Bugfix de runtime do checkout. **Não inventa feature nova.** Cobre **dois bugs
> independentes** que se manifestam juntos na mesma tela (`/loja/[slug]/pedido`),
> mas têm causas separadas: um de **estado no cliente** (FormEndereco ↔ estado do
> wizard dessincronizados) e um de **dados no banco** (lojas com zona `raio_km`
> mas `latitude`/`longitude` NULL). Esta spec é acionável e **não contém código de
> implementação** — só os contratos, a fronteira cliente↔servidor e a separação
> entre correção de **código** e correção/backfill de **dados**.
>
> **Pré-requisito de contexto:** complementa, não substitui, `fix-frete-raio-cache-geocoding.md`
> (já implementado — conserta o geocoding **futuro** via cache CEP→coords no Redis).
> Aquele fix não faz **backfill** das coords já NULL; o Bug 2 desta spec cobre isso.

---

## Visão Geral

Na vitrine pública, em `/loja/[slug]/pedido`, o cliente vê dois sintomas:

1. A opção **"Entrega"** vem pré-selecionada (by-design) e a mensagem *"Entrega
   indisponível para o seu bairro. Tente outro endereço ou escolha retirada."*
   aparece **automaticamente, com o formulário visualmente vazio** — antes de o
   cliente digitar qualquer CEP.
2. Ao informar um CEP **correto** (mesmo bairro/raio que a loja atende), a mensagem
   **não some**. Alternar para retirada e voltar para entrega, redigitar o CEP — a
   mensagem persiste.

São **dois defeitos distintos** na mesma jornada:

- **Bug 1 (cliente — state desync):** `FormEndereco` renderiza em branco e nunca
  hidrata o `estado.endereco` persistido no sessionStorage; o efeito de
  `EtapaEntrega` calcula frete contra um `bairro` **fantasma** sobrevivente de uma
  tentativa anterior. Sintoma 1 inteiro vem daqui.
- **Bug 2 (dados — coords NULL):** lojas com zonas `raio_km` mas
  `latitude`/`longitude` NULL no banco. O frete por raio **nunca casa** (`distanciaKm`
  vira `undefined`), e sem `taxa_entrega_fora_zona` o resultado é **indisponível para
  qualquer CEP**, mesmo correto. Sintoma 2 inteiro vem daqui.

**Em qual mundo vive:** os dois mundos. Bug 1 é 100% **vitrine pública** (cliente,
sem auth). Bug 2 toca **vitrine pública** (cálculo de frete no checkout) e **painel**
(robustez do geocoding no `salvarPerfil`) e exige **correção de dados** no banco.

---

## Atores Envolvidos

| Ator | Papel nesta correção |
|------|---------------------|
| **iRango (SaaS)** | corrige o contrato de sincronização FormEndereco↔estado (Bug 1); executa o **backfill** das coords das lojas NULL com zona raio (Bug 2-a); endurece o `salvarPerfil` para não deixar o lojista com raio quebrado sem aviso (Bug 2-b); melhora a degradação do checkout quando coords faltam (Bug 2-c) |
| **Lojista** | nenhuma ação obrigatória; passa a (i) ter o raio funcionando após o backfill e (ii) receber aviso mais claro quando o geocoding do endereço falhar ao salvar o perfil |
| **Cliente** | nenhuma ação nova; deixa de ver a mensagem de indisponível com o form vazio e passa a receber o frete por raio correto ao informar o CEP |

---

## Páginas e Rotas

> Nenhuma rota nova e nenhuma página nova. As páginas abaixo já existem; listadas
> para mapear os behaviors afetados e a fronteira cliente↔servidor. Behaviors
> marcados `[~]` já existem e esta correção muda **o comportamento/confiabilidade**;
> `[ ]` é behavior novo (ajuste de gate/aviso).

### Checkout — `/loja/[slug]/pedido` (Etapa Entrega)

**Mundo:** vitrine pública (sem auth)

**Descrição:** o cliente escolhe tipo de entrega, informa endereço (CEP via ViaCEP)
e vê o **preview** de frete. Hoje a mensagem de indisponível aparece com form vazio
(Bug 1) e nunca some mesmo com CEP correto quando a loja tem coords NULL (Bug 2).

**Componentes:** (todos existentes — reuso, sem componente novo)
- `CheckoutWizard.tsx` — hidrata `estado.endereco` do sessionStorage; **fonte de
  verdade** do estado que dispara o cálculo
- `FormEndereco.tsx` — formulário de endereço; **único ponto de mudança do Bug 1**:
  passa a aceitar/hidratar um endereço inicial e a manter paridade com o estado do pai
- `EtapaEntrega.tsx` — efeito que chama `calcularFreteAction`; revisar o **gate** que
  decide quando calcular (Bug 1) e o **mapeamento** do resultado `indisponivel` (Bug 2-c)
- `estado.ts` — `ESTADO_INICIAL.tipoEntrega = "entrega"` (entrega pré-selecionada é
  by-design — **não muda**); `EnderecoEntrega`; `podeConfirmar` (gate de confirmação)
- `calcularFreteAction` (`lib/actions/frete.ts`) — **não muda**; valor autoritativo de
  preview no servidor
- `distanciaDaLojaAoCep` / `buscarCoordsLoja` / `calcularFrete` — **não mudam**; herdam
  o backfill de dados

**Behaviors:**
- [~] **Abrir o checkout com o form de endereço vazio** — ação do cliente. Com Bug 1
  corrigido: form vazio ⇒ `estado.endereco` vazio ⇒ **nenhum** cálculo de frete
  disparado ⇒ **nenhuma** mensagem de indisponível antes de o cliente preencher.
  Garantido em: **cliente (UX)** — gate do efeito de `EtapaEntrega` + sincronização
  FormEndereco↔estado. (Não toca dinheiro: é só a decisão de *quando* pedir o preview.)
- [~] **Retornar ao checkout com endereço persistido** (refresh / voltar) — ação do
  cliente. O `FormEndereco` passa a **refletir** o `estado.endereco` hidratado (campos
  preenchidos) em vez de renderizar em branco; o cálculo de frete roda contra o que o
  cliente **vê**, não contra um fantasma. Garantido em: **cliente (UX)**.
- [~] **Informar CEP e ver preview de frete por raio** — ação do cliente. Com Bug 2
  corrigido (coords da loja preenchidas): a zona `raio_km` casa e o preview mostra a
  taxa correta em vez de "indisponível". Garantido em: **Server Action
  `calcularFreteAction`** (geocoding + haversine + `calcularFrete` no servidor a partir
  do banco). **Preview de UX — nunca autoritativo.** O cliente nunca envia `distanciaKm`,
  `taxa_preview` nem `total`.
- [~] **Trocar entrega → retirada → entrega e redigitar CEP** — ação do cliente. Com
  Bug 1 corrigido, o estado e o form ficam consistentes a cada alternância e o recálculo
  reflete o CEP atual (não um bairro velho). Garantido em: **cliente (UX)** para o gate;
  **Server Action** para o valor.
- [ ] **Ver mensagem de degradação correta quando a loja tem raio mas está sem coords**
  — comportamento novo (Bug 2-c). Hoje, loja mal configurada e endereço fora de área
  produzem a **mesma** mensagem genérica "indisponível", escondendo a misconfiguração.
  Decisão de produto na §Regras de Negócio (RN-2-C). Garantido em: **Server Action**
  (decide o veredito) + **cliente (UX)** (renderiza a mensagem). **Nunca** aceita frete
  do cliente.
- [~] **Confirmar pedido** — ação do cliente. O gate `podeConfirmar` continua exigindo
  frete `status === "ok"` em entrega; valor recalculado do zero no servidor. Garantido
  em: **Server Action `criarPedido` + RPC `criar_pedido` + RLS** — valor autoritativo;
  `taxa_entrega`/`total` do cliente ignorados (`seguranca.md` §10).

---

### Configurações › Perfil da Loja — `/painel/configuracoes/perfil`

**Mundo:** painel (auth obrigatório)

**Descrição:** o lojista salva o endereço completo da loja; `salvarPerfil` geocodifica
(2º UPDATE, best-effort) e persiste `latitude`/`longitude`. Quando o geocoding falha,
hoje grava o par NULL e exibe um toast não-bloqueante (`PerfilClient.tsx:189`). O
problema do Bug 2-b: a falha pode ser **transitória** (rate-limit do Nominatim no
momento do save — exatamente o que aconteceu com as 3 lojas com coords NULL), e o
lojista fica com o raio quebrado dependendo de **re-salvar** o perfil sem nenhum gatilho.

**Componentes:** (existentes)
- `PerfilClient.tsx` — toast de aviso já existe; revisar **wording/acionabilidade**
- `salvarPerfil` (`lib/actions/loja.ts`) — geocoding best-effort; avaliar **retry curto**
  e/ou **distinção** entre "endereço não encontrado" (erro real do lojista) e "geocoding
  temporariamente indisponível" (transitório) — ver RN-2-B
- `geocodificarEndereco` (`lib/utils/geocodificarEndereco.ts`) — **não muda** (já tem o
  cache CEP→coords do fix anterior; mas `salvarPerfil` usa endereço completo, não CEP,
  então não passa pelo cache — RN-F6 do fix anterior)

**Behaviors:**
- [~] **Salvar perfil com endereço** — dispara geocoding server-side e persiste coords.
  Garantido em: **Server Action `salvarPerfil`** + RLS (`lojas_update_proprio`,
  `auth.uid()=dono_id`); coords **nunca** vêm do cliente (`schemaPerfil.strict()` não
  declara `latitude`/`longitude`).
- [ ] **Distinguir falha transitória de endereço inválido no aviso** — comportamento novo
  (Bug 2-b). O retorno da action passa a permitir ao cliente exibir um aviso que diferencie
  "não localizamos seu endereço" de "tente salvar novamente em instantes". Garantido em:
  **Server Action** (decide a razão) + **cliente (UX)** (toast).
- [ ] **(Opcional) Retry curto de geocoding no save** — comportamento novo (Bug 2-b),
  ver RN-2-B. Garantido em: **Server Action `salvarPerfil`** (respeitando a trava
  anti-ban 1 req/s — `seguranca.md` §12-A). **Não** no cliente.

---

## Modelos de Dados

### Bug 1 — nenhuma mudança de schema

É 100% estado de cliente (sessionStorage + React state). Nenhuma tabela, coluna ou
migration. `estado.ts` (`EstadoWizard`, `EnderecoEntrega`) é o contrato; nenhuma
alteração de shape persistido é estritamente necessária.

### Bug 2 — correção de **dados**, não de schema

**Nenhuma migration de schema. Nenhuma coluna nova.** As colunas envolvidas já existem:

- `lojas.latitude` / `lojas.longitude` — `float8` nullable, par tudo-ou-nada
  (`lojas_coords_par_check`), faixas validadas por CHECK (`schema.md` §lojas). Migration
  `20260616194631_lojas_coordenadas.sql`.
- `lojas.taxa_entrega_fora_zona` — `numeric(10,2)` nullable. **Já existe** no banco
  (migration `20260614006000_lojas_taxa_fora_zona_view.sql`) e na view `vitrine_lojas`,
  mas **ainda não está documentada em `schema.md`** — esta spec sinaliza a divergência
  para o `documentar` sincronizar (não é trabalho de código desta spec).
- `zonas_entrega.tipo = 'raio_km'`, `taxas_entrega.raio_max_km` — já existem.

#### Backfill de dados (Bug 2-a) — sem cerimônia expand/backfill/contract

> **Pré-condição explícita do usuário:** o SaaS **ainda não está em produção** — não há
> dados reais de cliente. Logo, o backfill é uma operação de dados pontual, **não** uma
> migration de schema com janela expand→backfill→contract para dados vivos.

**Alvo:** lojas onde existe ao menos uma `zonas_entrega.tipo = 'raio_km'` **ativa** e
`lojas.latitude IS NULL` (par NULL). Confirmadas no cloud:

| Loja | slug | id | Situação |
|------|------|----|----------|
| Pizza da Tia | `annaluciaguimaraes` | `69f2541c-1d13-44eb-8fc2-4017248f368a` | zonas raio (Centro 5km, Atibaia 20km) + 1 zona bairro; coords NULL; `taxa_entrega_fora_zona` NULL ⇒ raio totalmente quebrado |
| Pão do Ciso | `paodociso` | `48e5418e-6006-4cfa-b37d-2c18e81f9b14` | coords OK (`-22.9610457, -46.5422615`); funciona — **não** é alvo |
| (demais com coords NULL) | — | — | 3 de 4 lojas com coords NULL no total |

**Mecanismo do backfill (decisão de produto — escolher na quebra em issues):**

- **Opção A (recomendada): re-geocodificar via Server Action existente.** Disparar o
  caminho `salvarPerfil` (endereço completo → `geocodificarEndereco` → 2º UPDATE) para
  cada loja-alvo, agora que o geocoding funciona (Nominatim retorna 200 com o UA `iRango/1.0`).
  **Vantagens:** reusa a fonte única de geocoding e a validação existentes; respeita a
  trava anti-ban (`seguranca.md` §12-A); coords gravadas pelo **mesmo** caminho que as
  futuras (consistência). **Restrição:** roda server-side, escopado por `loja_id` via
  `service_role` ou re-save autenticado; **nunca** com coords vindas do cliente. Como são
  poucas lojas e a trava é 1 req/s, é uma operação de minutos.
- **Opção B (rejeitada): UPDATE manual com coords digitadas à mão.** Viola
  `seguranca.md` §8 (PII/endereço não hardcoded) e a regra "coords derivadas no servidor,
  nunca literais". Só admissível como último recurso para uma loja cujo endereço o
  Nominatim genuinamente não geocodifica — e ainda assim a fonte do par deve ser o
  geocoding, não um literal no código/migration.

> **O backfill NÃO é uma migration SQL versionada com dados literais.** É um script/Server
> Action operacional que **chama o geocoding** — nenhum endereço ou coordenada de loja
> entra no repositório (`seguranca.md` §8). Pode ser um endpoint/route admin protegido,
> uma Server Action restrita, ou um one-off rodado localmente com `service_role`.

#### Higiene de dados (saneamento, não obrigatório do fix)

Sinalizar ao lojista (fora do escopo de código desta spec, ver Fora do Escopo) que uma
loja com zona `raio_km` mas **sem** `taxa_entrega_fora_zona` e **sem** coords entrega
"indisponível" para todo mundo — combinação que o backfill resolve, mas que pode
recorrer se o geocoding falhar de novo no futuro (mitigado pelo Bug 2-b).

---

## Regras de Negócio

### Bug 1 — sincronização FormEndereco ↔ estado do wizard

| Regra | Camada que garante |
|-------|--------------------|
| **RN-1-A — Fonte única de verdade do endereço.** O `estado.endereco` do wizard (hidratado do sessionStorage no `CheckoutWizard`) e os inputs visíveis do `FormEndereco` devem ser **a mesma verdade**. O `FormEndereco` passa a **hidratar** seus campos a partir de um endereço inicial recebido por prop (o `estado.endereco`); se houver endereço persistido, os campos aparecem preenchidos; se não, ficam vazios e o estado permanece vazio. | **Cliente (UX)** — contrato de props `FormEndereco` ↔ `EtapaEntrega` ↔ `CheckoutWizard` |
| **RN-1-B — Form vazio ⇒ estado vazio ⇒ sem cálculo ⇒ sem mensagem.** Quando o form de endereço está vazio (campos obrigatórios em branco), o `estado.endereco` deve ser `null` e o efeito de `EtapaEntrega` **não** deve chamar `calcularFreteAction`; nenhuma mensagem de frete (incl. "indisponível") aparece. O gate do efeito **não** pode depender de um `bairro` fantasma sobrevivente da hidratação. | **Cliente (UX)** — gate do efeito em `EtapaEntrega` + emissão de `null` pelo `FormEndereco` |
| **RN-1-C — Sem fantasma pós-hidratação.** Após o `CheckoutWizard` hidratar `estado.endereco` do sessionStorage, ou o `FormEndereco` reflete esse endereço (RN-1-A, e então o cálculo é legítimo porque o cliente vê os campos), ou o estado é considerado vazio (e nada calcula). É **proibido** o estado carregar um endereço que o form não mostra. | **Cliente (UX)** — eliminação da divergência hidratação-do-pai vs. inputs-do-filho |
| **RN-1-D — Entrega pré-selecionada permanece by-design.** `ESTADO_INICIAL.tipoEntrega = "entrega"` **não muda**. O bug não é a pré-seleção; é o cálculo disparar sem endereço. | `estado.ts` (inalterado) |
| **RN-1-E — Sem dado monetário no cliente.** A correção é puramente de *quando/se* pedir o preview; nenhum valor (`taxa`, `total`, `distanciaKm`) passa a ser decidido no cliente. O preview continua vindo da Server Action; a cobrança, de `criarPedido`. | `seguranca.md` §10 (preservado) |

> **Nota de implementação (não-vinculante):** RN-1-A pode ser satisfeita controlando o
> `FormEndereco` a partir do estado do pai (componente controlado) ou hidratando-o uma
> vez na montagem com `defaultValue`/`key`. A spec exige o **invariante** (form e estado
> são a mesma verdade), não o mecanismo — o plano técnico decide. Atenção ao loop de
> render: `onEnderecoChange`/handlers já são `useCallback` estáveis hoje (ver
> `CheckoutWizard` linhas 141-148); preservar essa estabilidade.

### Bug 2 — coords NULL e degradação do frete por raio

| Regra | Camada que garante |
|-------|--------------------|
| **RN-2-A — Backfill restaura coords das lojas-alvo.** Toda loja com zona `raio_km` ativa e coords NULL deve ter `latitude`/`longitude` repreenchidas via **geocoding server-side** (par tudo-ou-nada), nunca por literal. | Operação de dados (Server Action/route admin) + CHECK `lojas_coords_par_check` no banco |
| **RN-2-B — Save não deixa o lojista com raio quebrado silenciosamente.** Quando `salvarPerfil` geocodifica e falha, o retorno deve permitir ao cliente distinguir **falha transitória** (Nominatim/trava indisponível → re-tentar salvar resolve) de **endereço não localizável** (problema do dado do lojista). Decisão de produto: (i) **mínimo** — melhorar o wording do toast existente para ser acionável; (ii) **recomendado** — `salvarPerfil` tentar um **retry curto** do geocoding **respeitando a trava de 1 req/s** (`seguranca.md` §12-A — a trava NÃO pode ser afrouxada) antes de gravar NULL. | **Server Action `salvarPerfil`** (decide a razão / faz o retry sob a trava) + **cliente (UX)** (toast) |
| **RN-2-C — Degradação clara no checkout, sem esconder misconfiguração.** Quando a loja tem zona `raio_km` mas está **sem coords** (par NULL), `distanciaKm` é `undefined` → a zona raio não casa. Hoje isso colapsa em "indisponível" genérico. Decisão: o frete por raio com coords ausentes deve degradar para o **fallback fora-de-zona** (`taxa_entrega_fora_zona`) se houver, ou para "indisponível" se não houver — **comportamento já correto da `calcularFrete`**. O ajuste é de **clareza**: a mensagem ao cliente não deve afirmar que o *bairro* é inatendido quando a causa é coords ausentes da loja. (O cliente nunca vê detalhe interno — `seguranca.md` §14 —, mas a mensagem genérica não deve induzir o cliente a "tentar outro endereço" quando nenhum endereço resolveria.) | **Server Action** (veredito a partir do banco) + **cliente (UX)** (mensagem) |
| **RN-2-D — Coords sempre derivadas no servidor.** Nenhuma coordenada entra via cliente nem via literal no código/migration; sempre do geocoding server-side (`schemaPerfil.strict()` rejeita `latitude`/`longitude`; backfill chama o geocoding). | **Server Action** + `seguranca.md` §8 / §10 |
| **RN-2-E — Frete autoritativo inalterado.** O recálculo de frete em `criarPedido` (RPC `criar_pedido`) **não muda**: continua re-buscando zonas + coords do banco e recalculando do zero. O backfill só corrige o **insumo** (coords da loja); a fronteira de valor permanece a mesma. | `criarPedido` + RPC + RLS (`seguranca.md` §10) |

### Fronteira cliente ↔ servidor (resumo monetário)

| Item | Tipo | Garantido em |
|------|------|--------------|
| Decisão de *quando* pedir o preview (gate do efeito, Bug 1) | **Cliente (UX)** — não é valor | `EtapaEntrega` + `FormEndereco` (estado consistente) |
| `taxa_preview` / mensagem de frete no checkout | **Preview de UX (cliente)** — estética, não vinculante | `calcularFreteAction` (recalcula do banco; coords vindas do backfill) |
| `taxa_entrega` / `total` do pedido | **Valor autoritativo (servidor)** | `criarPedido` + RPC `criar_pedido` + RLS — recálculo do zero |
| `distanciaKm` (insumo do raio) | **Derivado 100% no servidor** | `distanciaDaLojaAoCep` → `buscarCoordsLoja` (service_role) + `geocodificarEndereco`; jamais do cliente |
| `latitude`/`longitude` da loja (backfill) | **Derivado 100% no servidor** | geocoding server-side; nunca literal nem do cliente |

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai?**
  - Bug 1: nenhum dado novo trafega. O endereço do cliente já vive no sessionStorage e
    no payload do pedido como hoje; a correção apenas garante consistência entre o que o
    cliente **vê** e o que o estado **guarda**. Não logar endereço/CEP do cliente
    (`seguranca.md` §21 — scrubbing de PII).
  - Bug 2: o **endereço completo da loja** (não PII de cliente, mas dado da loja) é
    re-geocodificado no servidor. O par `(lat,lng)` da loja é dado de localização — **não**
    é exposto pela view `vitrine_lojas` (`seguranca.md` §19) e continua lido só via
    `service_role` (`buscarCoordsLoja`). O backfill **não** pode imprimir/commitar
    endereço ou coords (`seguranca.md` §8).
- **Algum valor monetário?** Sim — frete.
  - Recálculo no servidor **permanece obrigatório e inalterado** (`seguranca.md` §10):
    `criarPedido` recalcula `taxa_entrega`/`total` do zero. Nenhuma das duas correções
    introduz caminho em que o cliente defina valor. O Bug 1 só muda *se/quando* o preview
    é solicitado; o Bug 2 só corrige o **insumo geográfico** (coords) consumido pelo
    cálculo server-side.
- **Tabela nova?** Não → **sem RLS nova**. Nenhuma migration de schema. A postura de RLS
  de `lojas`/`zonas_entrega`/`pedidos` é inalterada. As coords continuam fora da view
  pública.
- **Backfill via `service_role`?** Se a Opção A for um one-off/route admin com
  `createServiceClient()` (BYPASSRLS): **escopar manualmente por `loja_id`**
  (`seguranca.md` §7) — RLS não protege sob service_role. Restringir o disparo a um
  caminho não exposto à vitrine pública. Idealmente reusar o caminho `salvarPerfil`
  (autenticado, RLS `auth.uid()=dono_id`) quando possível.
- **API externa com key?** Nominatim — sem key, mas exige **User-Agent identificado**
  (`NOMINATIM_USER_AGENT`) e **trava anti-ban 1 req/s** (`seguranca.md` §12-A). O backfill
  (Bug 2-a) e o eventual retry (Bug 2-b) **devem** passar pela trava fail-closed: nenhuma
  chamada ao Nominatim fora dela. Como o cache CEP→coords do fix anterior cobre **CEP do
  cliente** (não endereço completo da loja — RN-F6 daquele fix), o geocoding do endereço
  da loja no backfill **não** é acelerado por cache — respeitar o 1 req/s entre lojas-alvo.
- **Erro interno não vaza** (`seguranca.md` §14): a mensagem de degradação do checkout
  (RN-2-C) e o aviso do save (RN-2-B) são genéricos/acionáveis para o usuário; detalhe
  (coords NULL, falha do Nominatim) só no log do servidor.

---

## Fora do Escopo (v1 do fix)

- **Reescrever a arquitetura responsiva do checkout** (drawer desktop + wizard mobile com
  estado compartilhado) — o débito de refator "depois" registrado em memória **permanece**;
  esta spec só corrige a sincronização FormEndereco↔estado dentro da arquitetura atual.
- **Validar bairro/CEP contra zona no cliente** — a reconciliação CEP↔bairro já é
  server-side (`seguranca.md` §10-A, issues 064/067); inalterada.
- **Cache do geocoding de endereço completo da loja** — fora de escopo (consulta não é
  CEP puro; baixa frequência). O cache CEP→coords do cliente já existe (fix anterior).
- **Validação no painel de "loja com raio mas sem coords / sem fallback"** (aviso proativo
  ao lojista de config inconsistente em `/painel/configuracoes/entregas`) — melhoria de
  produto candidata a iteração futura; o Bug 2-b já cobre o aviso **no momento do save**.
- **UI no painel para o lojista re-disparar o geocoding manualmente** ("recalcular
  localização") — candidato a follow-up; o backfill (Bug 2-a) resolve o estado atual e o
  Bug 2-b reduz a recorrência.
- **Migração para provedor de geocoding pago** (Google/Mapbox) ou **rota real** (OSRM) —
  já fora de escopo no spec base `zonas-entrega-raio-km.md`; inalterado.
- **Backfill como migration SQL versionada com coords literais** — rejeitado (RN-2-D,
  `seguranca.md` §8). O backfill chama o geocoding; não grava literais no repositório.
- **Sincronizar `schema.md` com a coluna `taxa_entrega_fora_zona`** — divergência apenas
  sinalizada aqui; trabalho do agente `documentar`, não desta spec de código.

---

## Próximos passos

Quebrar em issues com `/break` passando este spec.

**Issues críticas previstas (TDD red-first — tocam a fronteira de valor/autorização):**

- **Bug 1 — sincronização de estado (crítica):** FormEndereco↔estado é o que decide se o
  pedido pode ser **confirmado** (gate `podeConfirmar` depende de `endereco !== null` +
  frete `ok`). Um desync pode habilitar/bloquear confirmação indevidamente. Teste vermelho
  primeiro: form vazio ⇒ nenhuma chamada a `calcularFreteAction` e nenhuma mensagem;
  endereço persistido ⇒ form reflete o estado; sem fantasma após hidratação.
- **Bug 2-c — degradação do frete com coords ausentes (crítica):** toca o cálculo de
  frete (valor). Teste vermelho: loja com zona raio + coords NULL + `taxa_entrega_fora_zona`
  presente ⇒ cai no fallback (não "indisponível"); sem fallback ⇒ indisponível com
  veredito coerente. Reusa as fixtures de `frete.test.ts`/`pedido.test.ts` (já cobrem
  `taxa_entrega_fora_zona` e helper de distância `undefined`).

**Issues de dados / não-crítica:**

- **Bug 2-a — backfill (operação de dados):** re-geocodificar as lojas-alvo via caminho
  server-side, sob a trava 1 req/s. Não é TDD de unidade clássico; verificação é checar as
  coords no banco pós-execução (`buscarCoordsLoja` retorna par não-NULL para a loja-alvo).
- **Bug 2-b — robustez do save (média):** distinção transitório vs. inválido no retorno
  de `salvarPerfil` + wording do toast; retry curto opcional sob a trava anti-ban.
