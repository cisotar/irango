# Spec: Onboarding Assistido pelo Admin do SaaS

**Versão:** 0.1.0 | **Atualizado:** 2026-06-27

## Visão Geral

O dono do SaaS (admin único) oferece **assistência remota de onboarding** aos lojistas: cadastrar novas lojas, montar cardápios (categorias + produtos) e configurar a loja (endereço, horários, tema, zonas/formas de entrega, formas de pagamento) **em nome** de clientes que não têm tempo ou familiaridade técnica para fazer isso sozinhos.

A feature estende a área admin existente (`/admin/assinantes`, rota `src/app/admin/assinantes/`) com uma **tela de gestão por loja** (`/admin/assinantes/[lojaId]`) onde o admin opera sobre os dados internos de **qualquer** loja, usando `service_role` (que bypassa RLS) **somente após** `verificarAdminSaaS()`.

**Problema que resolve:** hoje o admin só faz operações de billing reversíveis (cortesia/suspender/reativar) e o hard delete na linha do assinante. Não há como ele **criar** uma loja para um cliente nem **montar/editar** o cardápio e a configuração dela — toda essa lógica vive no painel do lojista, atrás do guard de auth do próprio dono (`buscarLojaDoDono`, escopo `auth.uid() = dono_id`). O onboarding assistido inverte esse escopo: o `loja_id` passa a ser **explícito** (o admin escolhe a loja), e a autoridade deixa de ser RLS e passa a ser `verificarAdminSaaS()` + `service_role`.

**Mundo:** painel administrativo do SaaS — **auth obrigatório + admin do SaaS**. Não é vitrine pública nem painel do lojista. A única prova de identidade é `verificarAdminSaaS()` (compara `user.id` do cookie HttpOnly com `SAAS_ADMIN_USER_ID`).

### Decisão de arquitetura (já tomada — não reabrir)

**Opção A** — estender a área admin para o admin gerenciar os dados internos das lojas diretamente, via `service_role` (BYPASSRLS), depois de `verificarAdminSaaS()`. Rejeitadas:

- **Opção B (impersonation / logar como lojista)** — suja o rastro de auditoria.
- **Opção C (colaboração multi-usuário por loja, tabela de colaboradores + RLS nova)** — esforço alto; fica como evolução futura possível.

### Base legal LGPD (premissa registrada)

Cobertura nos **Termos de Uso** ("o iRango pode acessar dados da loja para suporte/onboarding, a pedido ou com ciência do lojista") + execução de contrato + legítimo interesse (`seguranca.md` §20). O acesso administrativo a dados da loja (incl. PII de clientes em `pedidos`, chave Pix em `formas_pagamento`) é coberto por essa premissa. Revisão jurídica do texto dos Termos é pré-condição de operação comercial (`modelo-negocio.md` §7).

---

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (dono do SaaS)** | único que opera. Cria a loja, associa ao usuário do lojista, monta cardápio e configura. Toda ação passa por `verificarAdminSaaS()` + `service_role`. |
| **Lojista** | alvo passivo no MVP — a loja dele é criada/configurada pelo admin. Não participa do fluxo da tela admin. Continua acessando sua loja pelo painel normal (`/painel`, escopo RLS por `dono_id`) — as duas vias escrevem na mesma loja. |
| **Cliente** | indireto — consome a vitrine da loja configurada pelo admin. Não interage com a área admin. |

---

## Páginas e Rotas

### Tela de Assinantes — `/admin/assinantes` (já existe — só ganha entrada de navegação)

**Mundo:** painel admin do SaaS (auth obrigatório + `verificarAdminSaaS()` no guard `layout.tsx`)
**Descrição:** lista todas as lojas (`listarAssinantes` → `AssinanteLinha[]`) com ações de billing e hard delete. Esta feature **acrescenta** (a) um botão "Nova loja" no topo e (b) um link "Gerenciar" por linha que leva à tela de gestão da loja.

**Componentes:** (reuso)
- `TabelaAssinantes.tsx` (existente) — recebe a coluna/ação "Gerenciar" (link para `/admin/assinantes/[lojaId]`).
- `Button` (shadcn/ui) — gatilho "Nova loja" abrindo `FormNovaLoja` (dialog ou rota `/admin/assinantes/nova`).

**Behaviors:**
- [x] Visualizar botão "Nova loja" no topo da lista. Garantido em: cliente (UX).
- [x] Visualizar link "Gerenciar" por linha → navega para `/admin/assinantes/[lojaId]`. Garantido em: cliente (UX).
- [x] Abrir formulário/rota de criação de loja. Garantido em: cliente (UX).

---

### Criar Loja para Cliente — `/admin/assinantes/nova` (ou dialog em `/admin/assinantes`)

**Mundo:** painel admin do SaaS (auth obrigatório + admin)
**Descrição:** o admin cadastra uma nova loja e a **associa ao usuário do lojista**. O usuário-dono é identificado por **e-mail** (o admin digita o e-mail do lojista); o servidor resolve `dono_id` a partir desse e-mail em `auth.users` via Admin API. A loja nasce alinhada ao fluxo de cadastro existente: `ativo=false`, `assinatura_status='trial'`, consentimento gravado server-side.

**Componentes:** (reuso)
- `react-hook-form` + `zod` — schema dedicado `schemaNovaLojaAdmin` em `lib/validacoes/` (e-mail do dono + nome + slug). Reusar regras de slug já existentes em `lib/validacoes/loja.ts` (`[a-z0-9-]`, derivação do nome).
- `Input`, `Button`, `Label` (shadcn/ui).
- `slugExiste(client, slug)` (existente, `queries/lojas.ts`) — checagem de unicidade server-side.

**Behaviors:**
- [x] Digitar **e-mail do lojista** (dono da loja). Garantido em: cliente (UX) — validação de formato; a **resolução para `dono_id` é server-side**.
- [x] Digitar **nome** da loja; slug é derivado e editável. Garantido em: cliente (preview) + Server Action (`zod` + `slugExiste`).
- [x] Preview de disponibilidade de slug. Garantido em: cliente (UX, estética); **unicidade autoritativa em: Server Action (`slugExiste` + UNIQUE no banco)**.
- [x] Submeter → cria a loja associada ao dono. **Garantido em: Server Action + verificarAdminSaaS + service_role.** O servidor: resolve `dono_id` pelo e-mail (Admin API), valida que esse dono ainda não tem loja (RN-01: 1 conta = 1 loja, índice único `lojas(dono_id)`), insere a loja com `ativo=false`/`trial`/consentimento server-side.
- [x] Em sucesso → `toast.success` + redireciona para `/admin/assinantes/[lojaId]` (tela de gestão da loja recém-criada). Garantido em: Server Action (`revalidatePath`) + cliente (navegação).
- [x] Em falha (e-mail sem usuário, dono já tem loja, slug em uso, falha de admin) → `toast.error` genérico; nada criado. Garantido em: Server Action (fail-closed) + cliente (toast).

---

### Gestão da Loja (hub) — `/admin/assinantes/[lojaId]`

**Mundo:** painel admin do SaaS (auth obrigatório + admin)
**Descrição:** hub de onboarding de **uma** loja específica. O `[lojaId]` da URL identifica a loja-alvo; **toda** carga de dados e **toda** Server Action recebe esse `lojaId` explícito e re-prova admin antes de qualquer efeito. Apresenta abas/seções espelhando o painel do lojista, mas operando sobre a loja escolhida:

1. **Cardápio** — categorias + produtos
2. **Configuração** — perfil/endereço, horários, tema, entregas, pagamentos

A página é Server Component: carrega os dados da loja via `service_role` (escopado por `eq("id", lojaId)`) **depois** do guard de admin. Cada seção é um Client Component que reusa o componente equivalente do painel.

**Componentes:** (reuso forte — ver tabela "Reuso de componentes")
- Cabeçalho com nome/slug/status da loja-alvo (deixa explícito "você está editando a loja de outro lojista").
- Navegação por abas (`components/ui/tabs` shadcn, ou sub-rotas `/admin/assinantes/[lojaId]/cardapio`, `/configuracao`).
- Wrappers admin dos clients do painel (ver abaixo) — recebem `lojaId` explícito e chamam as Server Actions admin.

**Behaviors:**
- [x] Carregar dados da loja-alvo (perfil, categorias, produtos, zonas, formas de pagamento). Garantido em: Server Component + verificarAdminSaaS + service_role (escopado por `eq("id", lojaId)`).
- [x] Navegar entre abas Cardápio / Configuração. Garantido em: cliente (UX).
- [x] Loja inexistente (`lojaId` não casa) → `notFound()`. Garantido em: Server Component (após guard).

---

### Aba Cardápio — `/admin/assinantes/[lojaId]` (seção/sub-rota `cardapio`)

**Mundo:** painel admin do SaaS (auth obrigatório + admin)
**Descrição:** gerenciar categorias e produtos da loja-alvo. Espelha `/painel/produtos` + `/painel/produtos/opcionais`, mas com `loja_id` vindo da URL, não de `buscarLojaDoDono`.

**Componentes:** (reuso)
- `GerenciarCategorias.tsx`, `FormProduto.tsx`, `UploadFotoProduto.tsx`, `ProdutosClient.tsx` (existentes em `components/painel/`) — adaptados para receber `lojaId` e invocar as Server Actions admin (ver "Reuso de componentes").
- Schemas `lib/validacoes/produto.ts` reusados sem mudança (validam só campos do produto, não `loja_id`).

**Behaviors:**
- [x] Criar categoria na loja-alvo. Garantido em: **Server Action admin + verificarAdminSaaS + service_role** (`loja_id` = `lojaId` da URL, validado UUID; nunca do payload do produto).
- [x] Editar / reordenar / remover categoria. Garantido em: **Server Action admin + verificarAdminSaaS + service_role** (escopo `eq("loja_id", lojaId)`).
- [x] Criar produto (nome, descrição, **preço**, categoria, disponibilidade). Garantido em: **Server Action admin + verificarAdminSaaS + service_role**. Preço é dado de catálogo da loja, gravado server-side a partir do payload validado por `zod` — não é valor de checkout do cliente, mas a **autoridade de escrita é o servidor** (admin define o preço da loja).
- [x] Editar / reordenar / alternar disponibilidade / remover produto. Garantido em: **Server Action admin + verificarAdminSaaS + service_role**.
- [x] Enviar foto de produto. Garantido em: **Server Action admin + verificarAdminSaaS + service_role** — upload no bucket `produtos` sob prefixo `{lojaId}/...`; `lojaId` da URL, MIME real validado server-side (`validarBlobImagem`/magic bytes, `seguranca.md` §13). **A RLS de storage NÃO protege sob service_role** → o path `{lojaId}/` é montado server-side a partir do `lojaId` validado, nunca do client.
- [x] Preview de imagem/ordenação no cliente. Garantido em: cliente (UX, estética).

---

### Aba Configuração — `/admin/assinantes/[lojaId]` (seção/sub-rota `configuracao`)

**Mundo:** painel admin do SaaS (auth obrigatório + admin)
**Descrição:** configurar perfil/endereço, horários, tema, zonas de entrega e formas de pagamento da loja-alvo. Espelha `/painel/configuracoes/*`.

**Componentes:** (reuso)
- `PerfilClient.tsx` (endereço, telefone, whatsapp), `HorariosClient.tsx`, `TemaClient.tsx`, `EntregasClient.tsx` (`FormZona.tsx`), `PagamentosClient.tsx` (`FormPagamento.tsx`, `UploadQrPix.tsx`) — todos existentes, adaptados para `lojaId` explícito.
- Schemas `lib/validacoes/loja.ts`, `entrega.ts`, `pagamento.ts` reusados.
- `react-colorful` (tema), `react-imask` (CEP/telefone), ViaCEP (autocomplete) — reuso direto.

**Behaviors:**
- [x] Salvar perfil/endereço (rua, número, bairro, cidade, estado, CEP, telefone, whatsapp). Garantido em: **Server Action admin + verificarAdminSaaS + service_role** (allowlist de colunas; `dono_id`/`ativo`/`assinatura_*`/`hotmart_*`/`consentimento_*` JAMAIS no patch — ver RN-7).
- [x] Geocodificar endereço da loja → grava `latitude`/`longitude`. Garantido em: **Server Action admin + service_role**; geocoding via Nominatim segue a política fail-closed e a trava global anti-ban (`seguranca.md` §12-A) — **só servidor**.
- [x] Salvar horários (jsonb por dia). Garantido em: **Server Action admin + verificarAdminSaaS + service_role**.
- [x] Salvar tema (cores jsonb). Garantido em: **Server Action admin + verificarAdminSaaS + service_role**.
- [x] Preview de cores/horário no cliente. Garantido em: cliente (UX, estética).
- [x] Criar/editar/remover zona de entrega + taxa + bairros (tipos `bairro`/`raio_km`/`faixa_cep`). Garantido em: **Server Action admin + verificarAdminSaaS + service_role**. **Taxa é valor monetário** — gravada server-side a partir do payload validado (`numeric`, `CHECK taxa >= 0`); autoridade de escrita é o servidor.
- [x] Criar/editar/remover forma de pagamento (pix/dinheiro/link/cartao) + config jsonb (incl. **chave Pix**). Garantido em: **Server Action admin + verificarAdminSaaS + service_role**. Chave Pix é dado sensível do lojista — escrita server-side, escopada por `lojaId`.
- [x] Enviar QR Pix (imagem). Garantido em: **Server Action admin + verificarAdminSaaS + service_role** — bucket `pix-qr` sob prefixo `{lojaId}/`, MIME real validado server-side; path montado a partir do `lojaId` da URL.
- [x] Publicar a loja (alternar `ativo`). Garantido em: **Server Action admin + verificarAdminSaaS + service_role** — gate de coluna sensível; o admin pode ativar a loja após o onboarding completo. `ativo` é coluna protegida do fluxo do lojista (nasce `false`); a escrita admin é explícita e separada do `salvarPerfilAdmin` (não vai junto no allowlist do perfil).

---

## Reuso de componentes (cliente ↔ Server Action)

O painel do lojista já tem **toda** a lógica de CRUD. A diferença estrutural é **de onde vem o `loja_id`**:

| Camada | Painel do lojista (existente) | Admin onboarding (esta feature) |
|--------|-------------------------------|----------------------------------|
| Autoridade | RLS (`auth.uid() = dono_id`) | `verificarAdminSaaS()` + `service_role` (BYPASSRLS) |
| Origem do `loja_id` | derivado de `buscarLojaDoDono(client)` (a loja do próprio dono) | **explícito**, vindo do `[lojaId]` da URL, validado UUID server-side |
| Client Supabase | `createClient()` (anon/sessão, RLS ativa) | `createServiceClient()` (server-only, só após prova de admin) |
| Escopo manual | desnecessário (RLS escopa) | **obrigatório** — `eq("loja_id", lojaId)` / `eq("id", lojaId)` em toda query (RLS não protege sob service_role, `seguranca.md` §7) |

**Estratégia de reuso (DRY, `architecture.md` §8):**
- **Componentes de UI** (`FormProduto`, `FormZona`, `FormPagamento`, `GerenciarCategorias`, `PerfilClient`, etc.): reusados; recebem o `lojaId` por prop e um conjunto de Server Actions injetadas (ou variantes admin), em vez de chamarem diretamente as actions do painel. Onde o acoplamento à action do painel for forte, extrair a UI pura e parametrizar o callback de submit.
- **Schemas `zod`** (`lib/validacoes/*`): reusados **sem alteração** — eles validam só os campos do recurso (produto, zona, pagamento), nunca o `loja_id`. Isso já é uma garantia: `loja_id` nunca foi campo de payload.
- **Server Actions admin novas**: criadas em `src/app/admin/assinantes/actions.ts` (ou submódulo `actions/cardapio.ts`, `actions/configuracao.ts` se o arquivo crescer), seguindo **exatamente** o molde das actions de billing existentes:
  1. validar input server-side (incl. `lojaId` UUID via `z.guid()`, reuso de `lojaIdSchema`);
  2. `await verificarAdminSaaS()` **ANTES de qualquer efeito** — fail-closed, propaga exceção (D-4), nunca vira `{ ok:false }` amigável;
  3. `const svc = createServiceClient()` — eleva para service_role só depois da prova;
  4. operar com `svc`, **sempre** escopando por `lojaId` validado (`eq("loja_id", lojaId)` / `eq("id", lojaId)`);
  5. `revalidatePath` da rota admin afetada (e da vitrine `/loja/[slug]` quando publicar/editar catálogo);
  6. `catch` genérico → mensagem neutra ao cliente (`seguranca.md` §14).
- **Queries**: as funções de leitura do painel (`buscarCategorias(client, lojaId)`, `buscarProdutosDoLojista(client, lojaId)`) **já recebem `lojaId` como parâmetro** → reusáveis passando o `svc` admin e o `lojaId` da URL, sem reescrita. As funções que derivam a loja do dono (`buscarLojaDoDono`) **não** se aplicam aqui.

---

## Modelos de Dados

Nenhuma tabela nova. Nenhuma coluna nova. Nenhuma migration de schema.

Tabelas escritas pela feature (todas em `schema.md`, todas já com FK `loja_id ... ON DELETE CASCADE`):

`lojas` (criar + configurar), `categorias`, `produtos`, `zonas_entrega`, `taxas_entrega`, `bairros_zona`, `formas_pagamento`. Opcionais (`opcionais_categorias`, `opcionais`, `categoria_produto_opcionais`) ficam fora do MVP (ver Fora do Escopo).

Storage: buckets `produtos` (fotos + logo) e `pix-qr` — escrita sob prefixo `{lojaId}/...`, igual ao painel; aqui o path é montado server-side a partir do `lojaId` da URL (não do client).

### Associação dono↔loja na criação

A loja criada pelo admin precisa de `dono_id` válido (FK para `auth.users`, NOT NULL). O admin fornece o **e-mail** do lojista; o servidor resolve `dono_id` via Admin API (`auth.admin.listUsers` / lookup por e-mail — mesmo mecanismo já usado em `mapearEmailsDosDonos` de `adminAssinatura.ts`). **RN-01 (1 conta = 1 loja)** é preservada pelo índice único `lojas(dono_id)`: tentar criar segunda loja para o mesmo dono falha no banco; a action trata como `{ ok:false, erro:"..." }`.

> Decisão de produto (MVP): o lojista-dono **já deve existir** em `auth.users` (cadastro prévio). Criar o usuário de auth pelo admin (convite/signup em nome de terceiro) é **fora do escopo** — ver abaixo.

### RLS

Nenhuma tabela nova → nenhuma política RLS nova. As policies existentes (`*_escrita_propria`, escopo `auth.uid() = dono_id`) continuam servindo o painel do lojista e são **irrelevantes** para a via admin, que usa `service_role` (BYPASSRLS). A defesa da via admin é `verificarAdminSaaS()` na Server Action + escopo manual por `lojaId`, **não** RLS (`seguranca.md` §7).

### Trigger de billing

`lojas_protege_billing_trg` (BEFORE UPDATE) só permite `service_role`/`postgres` a tocar colunas de billing e `dono_id`. O `salvarPerfilAdmin` **não** toca essas colunas (allowlist), então não depende do trigger; a criação da loja grava `dono_id` via service_role (passa pelo trigger por design). Nenhum atalho admin altera `assinatura_status` — isso continua exclusivo do webhook Hotmart (`seguranca.md` §9). Publicar (`ativo`) é UPDATE comum (não é coluna de billing), mas via service_role.

---

## Regras de Negócio

| # | Regra | Camada que garante |
|---|-------|--------------------|
| RN-1 | Só o admin do SaaS opera qualquer ação desta feature. | `verificarAdminSaaS()` em **todo** Server Component de carga e **toda** Server Action, antes de qualquer efeito — fail-closed (env ausente bloqueia todos, D-5). |
| RN-2 | O `loja_id` é **explícito** (URL), nunca derivado da sessão nem do payload de recurso. Validado como UUID server-side. | Server Action/Component (`z.guid()`, reuso `lojaIdSchema`) + escopo manual `eq(...)`. |
| RN-3 | Toda query/escrita admin escopa manualmente por `lojaId`. RLS não protege sob service_role. | Server Action (`eq("loja_id", lojaId)` / `eq("id", lojaId)`), `seguranca.md` §7. |
| RN-4 | 1 conta = 1 loja: o admin não cria segunda loja para um dono que já tem uma. | Índice único `lojas(dono_id)` no banco + tratamento de erro na action. |
| RN-5 | A loja criada nasce `ativo=false`, `assinatura_status='trial'`, consentimento server-side — alinhada ao cadastro normal. | Server Action (constantes server-side; reuso da lógica de `garantir_loja_do_dono`/`criarLoja` onde aplicável). |
| RN-6 | Preço de produto e taxa de entrega são gravados a partir do payload **validado** server-side (`numeric`, `CHECK >= 0`). | Server Action (zod) + `CHECK` no banco. São dados de catálogo/config da loja — não valores de checkout do cliente (esses continuam recalculados em `criarPedido`, §10). |
| RN-7 | `salvarPerfilAdmin` usa **allowlist** de colunas: `dono_id`, `ativo`, `assinatura_*`, `hotmart_*`, `consentimento_*`, `id` **jamais** entram no patch de perfil. | Server Action (allowlist explícita, espelhando `salvarPerfil` do painel) + trigger `lojas_protege_billing_trg` (gate de billing/`dono_id`). |
| RN-8 | Publicar a loja (`ativo=true`) é ação admin **explícita e separada** do salvar-perfil. | Server Action dedicada (`publicarLojaAdmin`), não embutida no allowlist do perfil. |
| RN-9 | Geocoding e qualquer API externa com key rodam **só no servidor**, fail-closed/anti-ban. | Server Action; Nominatim com trava global (`seguranca.md` §12-A). ViaCEP (sem key) pode ficar no client para autocomplete. |
| RN-10 | Erro interno nunca vaza ao cliente. | Server Action `catch` genérico (`seguranca.md` §14). |

---

## Segurança (obrigatório)

- **Dado sensível que entra:** e-mail do lojista (criação), endereço da loja, **chave Pix** (config de pagamento), preços/taxas. PII de cliente em `pedidos` é **lida** indiretamente se a tela mostrar pedidos (fora do MVP — ver escopo). Todo input validado por `zod` server-side.
- **Dado sensível que sai/é escrito:** o admin escreve em loja de terceiro — coberto pela premissa LGPD dos Termos de Uso (Visão Geral). Logs de servidor seguem o scrubbing de PII do Sentry (`seguranca.md` §21).
- **Valor monetário?** Sim — **preço de produto** e **taxa de entrega**. Aqui o valor é **definido pelo admin** (config da loja), gravado server-side a partir do payload validado; **não** é o caso do §10 (cliente definindo quanto paga). O recálculo autoritativo de checkout (`criarPedido`) permanece intocado e continua sendo a defesa contra manipulação de valor pelo cliente final. O risco desta feature não é subpagamento; é escrita não autorizada — mitigado por `verificarAdminSaaS()`.
- **Tabela nova?** Não → nenhuma RLS nova. A defesa é o guard de admin + escopo manual por `lojaId`.
- **service_role:** mesmo caminho das actions admin existentes (`createServiceClient()`, módulo `server-only`). **Sempre** após `verificarAdminSaaS()`, **sempre** escopado por `lojaId` (`eq`). Nunca importado em Client Component (build quebra).
- **Storage:** path `{lojaId}/...` montado server-side a partir do `lojaId` validado da URL — **nunca** do client (a RLS de bucket não protege sob service_role; o path é a única amarra). MIME real (magic bytes) validado server-side, whitelist `image/jpeg|png|webp`, ≤2 MB (`seguranca.md` §13/§18).
- **API externa com key?** Geocoding (Nominatim) — só servidor, fail-closed, trava anti-ban (§12-A). ViaCEP — sem key, pode client.
- **Trigger de billing:** `assinatura_status` **nunca** escrito por esta feature — continua exclusivo do webhook Hotmart (§9).

---

## Auditoria / Log de Acesso — IMPLEMENTAÇÃO FUTURA (fora do escopo desta entrega)

> Requisito **conhecido e desejável**, mas **não construído** nesta entrega. Registrado aqui para orientar a issue futura. Na v1, o único rastro é `console.error` de falha (não estruturado, não persistente).

**Contrato pretendido** de um log de acesso administrativo persistente (cada ação do admin sobre dados de loja de terceiro gera um registro):

| Campo | Conteúdo |
|-------|----------|
| `admin_id` | `user.id` do admin (cookie HttpOnly, autoritativo) |
| `loja_id` | loja-alvo da ação |
| `acao` | tipo: `criar_loja`, `criar_produto`, `editar_produto`, `remover_produto`, `salvar_perfil`, `salvar_zona`, `salvar_pagamento`, `publicar_loja`, etc. |
| `entidade_id` | id do recurso afetado (produto, zona, forma de pagamento), quando aplicável |
| `criado_em` | `timestamptz` |
| `metadados` | jsonb opcional (resumo do diff, sem PII bruta — scrubbing §21) |

**Premissas da issue futura:** tabela nova `log_acesso_admin` → exige RLS (deny-all para `anon`/`authenticated`; acesso exclusivo via `service_role`, padrão de `webhook_eventos_hotmart`). Escrita best-effort dentro de cada Server Action admin (falha do log **não** aborta a operação). Reforça a base legal LGPD (rastreabilidade do acesso de suporte). **Não implementar agora** — apenas deixar o ponto de extensão claro nas actions (um helper `registrarAcessoAdmin(...)` no-op/TODO).

---

## Fora do Escopo (v1)

- **Log de auditoria estruturado e persistente** — ver seção acima; é a evolução prioritária.
- **Criar o `auth.user` do lojista** (convite/signup em nome de terceiro). O dono já deve existir em `auth.users`. Onboarding do usuário de auth é fluxo distinto.
- **Opcionais / adicionais** (`opcionais_categorias`, `opcionais`, `categoria_produto_opcionais`) — montar a biblioteca de opcionais pela via admin fica para depois; MVP cobre categorias + produtos.
- **Gerir pedidos da loja pela via admin** (ver/alterar status de `pedidos`) — leitura de PII de cliente em massa não é necessária para onboarding; fora do MVP.
- **Cupons pela via admin** — não é parte do onboarding básico; reuso futuro trivial (mesmo padrão).
- **Colaboração multi-usuário por loja (Opção C)** — tabela de colaboradores + RLS nova; evolução futura possível, explicitamente rejeitada para esta entrega.
- **Impersonation / logar como lojista (Opção B)** — rejeitada (suja auditoria).
- **Edição/exclusão de billing** — já coberta pelas actions existentes (`/admin/assinantes`); não faz parte desta feature.
- **Painel super-admin completo** é fase 2 no roadmap (`modelo-negocio.md` §8); esta feature só estende a tela `/admin/assinantes` que já existe.
