# Spec: Relatório de vendas (seção "Vendas" no painel e no hub admin)

**Versão:** 0.1.0 | **Atualizado:** 2026-10-07

> Origem: pedido do usuário + `plan/` do loop do relatório de vendas (commit `f0ecaab`). As decisões 1–11 e as
> regras complementares abaixo foram **fechadas pelo usuário** e não são rediscutidas aqui; cada uma vira uma RN
> com o caso numérico como critério de aceite. Linhas marcadas **[direção]** são escolhas de desenho fixadas pelo
> orquestrador: valem como restrição, e o `arquitetar` detalha a implementação sem mudar o resultado.
> O roadmap (`modelo-negocio.md` §8) listava "Relatórios de vendas" na Fase 3; esta entrega antecipa só a parte
> descrita aqui.

## Visão Geral

O lojista hoje só vê métricas do dia no Dashboard (`calcularMetricasDoDia`, fuso cravado em São Paulo). Não há
como responder "quanto vendi neste mês", "quanto foi frete", "quanto dei de desconto", "o que mais vende por
categoria" nem "quem são meus clientes mais fiéis".

Esta feature cria a seção **Vendas**:

1. **Faturamento** do período: bruto, descontos, líquido e frete separado, com contador de pedidos com frete a
   combinar.
2. **Gráfico de barras** por dia, semana (ISO, segunda-feira) ou mês (ciclo configurável da loja).
3. **Itens mais vendidos por categoria**, com a categoria **congelada no momento da venda**.
4. **Ranking de clientes fiéis** (só no painel do lojista), com período próprio.
5. **Ciclo mensal configurável** (dia de início 1..28), editável pelo lojista e pelo admin.

Mundos:
- **Painel** (`/painel/vendas`, auth de lojista, dentro de `(bloqueavel)`): tudo acima.
- **Hub admin** (`/admin/assinantes/[lojaId]/vendas`, auth de admin do SaaS): só a parte financeira (1, 2, 3, 5).
  **Sem ranking.**
- **Banco**: migration de snapshot de categoria em `itens_pedido`, coluna de ciclo em `lojas`, ajuste da RPC
  `criar_pedido` e funções de agregação.

O SaaS não processa pagamento. O relatório é **nominal**: soma valores já gravados e autoritativos (`subtotal`,
`desconto`, `taxa_entrega`, `total` foram recalculados no servidor no checkout, `seguranca.md` §10). Nenhum valor do
relatório é recalculado nem aceito do cliente; o cliente só escolhe **filtros**, e todos são revalidados no
servidor.

## Atores Envolvidos

| Ator | Nesta feature |
|---|---|
| **iRango (SaaS)** | Agrega os números no banco (funções SQL por dia local da loja), faz o rollup semana/mês no servidor, resolve a categoria do item na RPC `criar_pedido` a partir do `produto_id`. |
| **Lojista** | Consulta o relatório da própria loja, filtra por período e tipo de entrega, alterna "só concluídos", troca a granularidade, consulta o ranking de clientes fiéis e edita o dia de início do ciclo. Nunca lê dado de outra loja. |
| **Admin do SaaS** | Consulta a parte financeira de qualquer loja em `/admin/assinantes/[lojaId]/vendas` e edita o ciclo da loja-alvo (paridade). Não vê o ranking nem PII de cliente por esta tela. |
| **Cliente final** | Não age aqui. É afetado: o nome aparece no ranking da loja onde comprou logado. Pedido de convidado e pedido anonimizado ficam fora do ranking. |

---

## Páginas e Rotas

### 1. Item "Vendas" no menu — infra de navegação

**Mundo:** painel e hub admin (componente compartilhado).
**Descrição:** `construirItens` em `src/components/painel/NavPainel.tsx` ganha o item **Vendas** logo após
**Dashboard**, com `href = ${base}/vendas`. Como o menu é o mesmo arquivo nos dois mundos (parametrizado por
`basePath`), o item aparece no painel e no hub admin. O admin **não** adiciona `"vendas"` a `rotasAusentes`
(`src/app/admin/assinantes/[lojaId]/layout.tsx:57`); `"clientes"` continua lá.

**Componentes:**
- `SidebarPainel` / `TopbarPainel` (reuso, `NavPainel.tsx`) — só um item novo em `construirItens`. Ícone lucide
  (ex.: `ChartColumn`/`BarChart3`), já disponível pelo `lucide-react` do projeto.

**Behaviors:**
- [ ] Ver "Vendas" logo abaixo de "Dashboard" no menu do painel e no menu do hub admin, com item ativo derivado de
  `usePathname`. Garantido em: cliente (UX de navegação); a barreira real é o guard do layout de cada mundo.

---

### 2. Vendas (painel) — `/painel/vendas`

**Mundo:** painel (auth obrigatório). Arquivo em `src/app/(painel)/painel/(bloqueavel)/vendas/page.tsx`: herda
o guard de sessão/loja de `painel/layout.tsx` e o bloqueio de assinatura de `(bloqueavel)/layout.tsx`
(`architecture.md` §5).

**Descrição:** Server Component. Lê a loja da sessão (`buscarLojaDoDono`), valida os `searchParams` com zod,
calcula os limites do período no fuso da loja e chama as funções de agregação com o **client da sessão**. Renderiza,
em cards brancos (`design-system.md` §10.2 regras 4 e 5):

1. Cabeçalho (`CabecalhoPagina`, `voltarHref="/painel"`).
2. Avisos fixos: "Este relatório cobre só as vendas feitas pelo iRango." e "Os valores são nominais: o iRango não
   registra se o pedido foi pago." (RN-V22).
3. Filtros: período (presets + personalizado), tipo de entrega, alternador "só concluídos".
4. Ciclo mensal: intervalo explícito do ciclo atual e controle para editar o dia de início.
5. Números do período: bruto, descontos, líquido, frete e contador de frete a combinar.
6. Gráfico de barras com abas internas Diário / Semanal / Mensal.
7. Itens mais vendidos por categoria, com nota de que o desconto do pedido não é rateado por item.
8. Ranking de clientes fiéis, com seletor de período próprio.

**Componentes:**
- `CabecalhoPagina` (reuso, `components/painel/CabecalhoPagina.tsx`).
- `Card`, `CardContent`, `CardHeader` (reuso shadcn/ui).
- `RelatorioVendas` (**novo, compartilhado**, `components/painel/RelatorioVendas.tsx`) — avisos, filtros, ciclo,
  números, gráfico e itens por categoria. Recebe os dados prontos + `basePath` + `acoes.salvarCiclo` (padrão de
  parametrização do `paridade-hub-admin-painel.md`). Default = lojista. Consumido pelas duas pages, sem cópia de
  markup.
- `FiltrosVendas` (novo, dentro do `RelatorioVendas`) — escreve os filtros na URL (`useRouter`/`Link` com
  `searchParams`); nenhum cálculo. Presets e tipo de entrega em `ToggleGroup` (reuso `components/ui/toggle-group`);
  datas do personalizado em `Input type="date"` (reuso `components/ui/input`). Componente shadcn ausente (ex.:
  `tabs`, `select`) entra **só pelo shadcn CLI**, nunca à mão.
- `CicloMensal` (novo) — mostra "Ciclo atual: 05/out a 04/nov" e edita o dia (1..28) com `react-hook-form` +
  schema zod compartilhado com a Server Action.
- `ResumoFaturamento` (novo) — os quatro números + contador de frete a combinar. Valores com `formatarMoeda`.
- `GraficoBarrasVendas` (novo) — barras em CSS/SVG, sem dependência nova (RN-V24). Abas Diário / Semanal / Mensal
  como estado interno do componente (dados das três granularidades já chegam do servidor).
- `ItensPorCategoria` (novo) — lista por categoria, com quantidade e valor bruto por item.
- `RankingClientesFieis` (**novo, exclusivo do painel**, `components/painel/RankingClientesFieis.tsx`) — **não** é
  prop nem flag do `RelatorioVendas`: a page do painel o compõe ao lado; a page admin simplesmente não o renderiza
  nem carrega seus dados (RN-V20).
- Utilitários reusados: `formatarMoeda`, `arredondar`, `instanteNoFuso`/`diaNoFuso`/`partesNoFusoCompletas`
  (`lib/utils/fusoLoja.ts`, fonte única de fuso), `buscarLojaDoDono`. `calcularMetricasDoDia`/`chaveDia`
  (`metricasPedidos.ts`) ficam **intocados**.
- Utilitários novos (puros, em `lib/utils/`, com teste ao lado) **[direção]**: limites de período no fuso da loja
  (presets, ciclo, semana ISO) e rollup dia → semana/ciclo. Schema zod dos filtros e do ciclo em
  `lib/validacoes/vendas.ts`.

**Behaviors:**
- [ ] Ver os avisos "só vendas feitas pelo iRango" e "faturamento nominal, sem status de pago". Garantido em:
  cliente (copy fixa) — RN-V22.
- [ ] Escolher o período por preset (hoje, esta semana, este mês, mês anterior, este ano). Garantido em: servidor —
  o preset na URL é validado por zod e os limites são calculados no servidor no fuso da loja (RN-V07, RN-V08,
  RN-V09); a UI só escreve a URL.
- [ ] Escolher um intervalo personalizado de/até. Garantido em: **Server Component (zod)** — de ≤ até e teto de
  366 dias; inválido nunca vira erro 500 nem consulta sem limite (RN-V09).
- [ ] Filtrar por tipo de entrega: Entrega / No local / Ambos. Garantido em: servidor — `tipo_entrega` validado
  contra a allowlist `entrega | retirada | ambos` antes de virar parâmetro SQL (RN-V10).
- [ ] Alternar "só concluídos". Garantido em: **função SQL** — o cliente envia só um booleano; o conjunto de status
  é fixado no banco, nunca uma lista vinda da URL (RN-V01, RN-V02).
- [ ] Ver bruto, descontos, líquido e frete do período. Garantido em: **função SQL (agregação autoritativa sobre
  valores gravados) + RLS/reconferência de posse** — o cliente só exibe (RN-V03, RN-V04, RN-V13).
- [ ] Ver "N pedidos com frete a combinar, não somados" quando houver. Garantido em: função SQL (contagem de
  `taxa_entrega IS NULL` no mesmo conjunto filtrado) — RN-V05.
- [ ] Ver o gráfico e trocar entre Diário / Semanal / Mensal. Garantido em: servidor (linhas diárias do SQL +
  rollup em TS puro no servidor); a troca de aba é só UX no cliente (RN-V11, RN-V12).
- [ ] Ver o intervalo explícito do ciclo atual (ex.: "05/out a 04/nov"). Garantido em: servidor (cálculo no fuso da
  loja a partir de `lojas.dia_inicio_ciclo`) — RN-V07.
- [ ] Editar o dia de início do ciclo (1..28). Garantido em: **Server Action (zod) + RLS `lojas_update_proprio` +
  CHECK no banco** (RN-V08).
- [ ] Ver itens mais vendidos por categoria, com valor bruto por linha e a nota "O desconto é do pedido e não é
  dividido entre os itens". Garantido em: **função SQL** sobre os snapshots de `itens_pedido` /
  `itens_pedido_opcionais` + categoria congelada (RN-V14, RN-V15, RN-V16).
- [ ] Ver mensagem genérica quando a carga falha, sem detalhe técnico. Garantido em: servidor (erro logado, UI
  genérica) — RN-V23.

#### 2.1 Ranking de clientes fiéis (seção da mesma página, só painel)

**Descrição:** card próprio com seletor de período **independente** do filtro global (Semana, Mês, Ano, Desde o
início). Tabela com nome, nº de pedidos, total gasto e último pedido; cada linha mostra os até 3 itens mais
comprados pelo cliente no período. Abaixo, "N pedidos de convidados fora do ranking".

**Behaviors:**
- [ ] Escolher o período do ranking (semana, mês, ano, desde o início) sem mexer no filtro global. Garantido em:
  servidor — parâmetro próprio na URL, validado por zod; limites calculados no fuso da loja (RN-V18).
- [ ] Ver o ranking ordenado por nº de pedidos (padrão). Garantido em: **função SQL `SECURITY DEFINER` escopada
  por `auth.uid()`** (RN-V17, RN-V19).
- [ ] Ordenar por nº de pedidos, total gasto ou último pedido. Garantido em: **função SQL** — a ordenação é
  parâmetro da função (allowlist) e o limite de linhas é aplicado **depois** de ordenar no banco; nunca reordenar
  no cliente um top-N já cortado (RN-V19).
- [ ] Ver os 3 itens mais comprados de cada cliente. Garantido em: função SQL (mesmo escopo) — RN-V19.
- [ ] Ver "N pedidos de convidados fora do ranking". Garantido em: função SQL (mesmo escopo e mesmo período) —
  RN-V17.
- [ ] Não ver telefone nem e-mail do cliente no ranking. Garantido em: **função SQL (allowlist de colunas no
  `RETURNS TABLE`)** — RN-V20.

---

### 3. Vendas (hub admin) — `/admin/assinantes/[lojaId]/vendas`

**Mundo:** hub admin (auth de admin do SaaS). Guard autoritativo em `src/app/admin/assinantes/layout.tsx`
(`verificarAdminSaaS()` fail-closed); o `[lojaId]/layout.tsx` monta o shell com o banner de "editando loja de
outro lojista".

**Descrição:** mesma parte financeira da rota 2 (avisos, filtros, ciclo, números, gráfico, itens por categoria),
renderizada pelo **mesmo** `RelatorioVendas` com `basePath` admin e `acoes.salvarCiclo` admin. **Sem ranking.**
Dados por loader server-only `src/app/admin/assinantes/[lojaId]/carga-vendas.ts`, no molde de `carga-pedidos.ts`:
`validarLojaIdAdmin(lojaId)` → `notFound()` se inválido → `verificarAdminSaaS()` (falha propaga) →
`createServiceClient()` → funções financeiras com `p_loja_id` validado.

**Componentes:**
- `CabecalhoPagina` (reuso, `voltarHref` da loja-alvo no admin).
- `RelatorioVendas` (reuso do componente da rota 2) com `acoes.salvarCiclo = salvarCicloVendasAdmin` fixado em
  closure com `lojaId` (padrão dos wrappers `*AdminClient`).

**Behaviors:**
- [ ] Ver a parte financeira (faturamento, frete, filtro de retirada/entrega, itens por categoria, gráfico) da
  loja-alvo. Garantido em: **loader `service_role` escopado por `lojaId` validado + `verificarAdminSaaS()` antes
  de elevar** (RN-V21).
- [ ] Filtrar período, tipo de entrega e "só concluídos" com as mesmas regras do painel. Garantido em: servidor
  (mesmo schema zod da rota 2).
- [ ] Editar o dia de início do ciclo da loja-alvo. Garantido em: **Server Action admin
  (`prepararContextoAdmin(lojaId)` → `escopo.atualizarLoja`) + CHECK no banco** (RN-V08).
- [ ] Não ver o ranking de clientes fiéis nem a rota de clientes. Garantido em: estrutura — a page admin não importa
  `RankingClientesFieis` nem chama a função do ranking (que, sob `service_role`, não tem `auth.uid()` e devolveria
  vazio); `"clientes"` segue em `rotasAusentes` (RN-V20).
- [ ] Ver mensagem genérica quando a carga falha. Garantido em: servidor (RN-V23).

---

### 4. Banco (sem UI)

**Mundo:** banco (migrations + funções). Toda mudança em `supabase/migrations/`; teste em `tests/migrations/` com
`createTestDb()` (`asAnon`/`asUser`/`asService`).

**Behaviors:**
- [ ] Migration adiciona o snapshot de categoria em `itens_pedido` (id + nome, nullable). Garantido em: migration.
- [ ] Backfill dos itens existentes com a categoria **atual** do produto; item com `produto_id` NULL ou produto sem
  categoria fica NULL ("Sem categoria"). Garantido em: migration (RN-V15).
- [ ] `criar_pedido` grava o snapshot de categoria resolvido **no servidor** a partir de `produto_id` + `p_loja_id`,
  ignorando qualquer chave de categoria no jsonb do item; assinatura de 18 argumentos inalterada. Garantido em:
  **RPC (servidor)** — RN-V14.
- [ ] Migration adiciona `lojas.dia_inicio_ciclo` (default 1, CHECK 1..28). Garantido em: **CHECK no banco** —
  RN-V08.
- [ ] Funções financeiras de agregação (por dia local e itens por categoria) com escopo de loja. Garantido em:
  **função SQL + RLS + reconferência de posse no corpo** (RN-V21).
- [ ] Função do ranking no molde de `clientes_da_loja`. Garantido em: **função SQL `SECURITY DEFINER` +
  `auth.uid()` + allowlist** (RN-V17 a RN-V20).
- [ ] `anon` não executa nenhuma função nova. Garantido em: `REVOKE ALL … FROM public, anon` (RN-V21).

---

## Modelos de Dados

Referência: `schema.md` §`lojas`, `categorias`, `produtos`, `pedidos`, `itens_pedido`, `itens_pedido_opcionais`.

### Migration A — snapshot de categoria em `itens_pedido` (expand + backfill)

```sql
-- nomes [direção]; o arquitetar/migrar confirma
ALTER TABLE itens_pedido
  ADD COLUMN categoria_id_snapshot   uuid,   -- sem FK: snapshot puro, mesma família de nome/preco
  ADD COLUMN categoria_nome_snapshot text;   -- NULL = "Sem categoria"
```

- **Sem FK** **[direção]**: categoria apagada depois não pode alterar o histórico (snapshot imutável, como
  `itens_pedido.nome`/`preco`). Par coerente: `(categoria_id_snapshot IS NULL) = (categoria_nome_snapshot IS NULL)`
  como CHECK de defesa em profundidade **[direção]**.
- **Backfill** na mesma migration: `UPDATE itens_pedido` com `produtos.categoria_id` e `categorias.nome` atuais,
  via `produto_id`, **restrito a `categorias.loja_id = produtos.loja_id = pedidos.loja_id`** (nunca cruzar loja).
  Item sem `produto_id` ou produto sem categoria fica NULL.
- RLS: nenhuma policy nova. `itens_pedido` mantém `itens_pedido_lojista` (SELECT do dono),
  `itens_pedido_select_cliente` e INSERT deny-all (só a RPC sob `service_role`).
- Escrita: só a RPC. Nenhum caminho de UPDATE para lojista/cliente existe hoje; manter assim.

### Migration B — `criar_pedido` resolve a categoria no servidor

- `CREATE OR REPLACE` da **mesma** função de 18 argumentos (última versão em
  `supabase/migrations/20261003122000_rpc_criar_pedido_cliente.sql`, INSERT de itens nas linhas 200-210, que hoje
  lê `nome`/`preco`/`preco_original` do jsonb montado pela Server Action). Assinatura, `SECURITY INVOKER`,
  `search_path` e grants **inalterados**.
- No loop dos itens, antes do INSERT, buscar `produtos.categoria_id` e `categorias.nome` por
  `(v_item->>'produto_id')::uuid` **e** `produtos.loja_id = p_loja_id` (e `categorias.loja_id = p_loja_id`). Produto
  sem categoria → NULL. Nenhuma chave de categoria do jsonb é lida.
- A Server Action `criarPedido` (`src/lib/actions/pedido.ts`) **não muda**: o payload não ganha campo.

### Migration C — ciclo mensal em `lojas`

```sql
ALTER TABLE lojas
  ADD COLUMN dia_inicio_ciclo smallint NOT NULL DEFAULT 1
    CONSTRAINT lojas_dia_inicio_ciclo_check CHECK (dia_inicio_ciclo BETWEEN 1 AND 28);
```

- Não é billing nem PII: **fora** de `CAMPOS_LOJA_SOMENTE_SERVIDOR` (`src/lib/actions/admin-loja.ts:51`) e do
  trigger de billing; gravável pelo lojista (`lojas_update_proprio`) e pelo admin (`escopo.atualizarLoja`).
- **Não** entra na view `vitrine_lojas` (dado interno do painel).

### Migration D — funções de agregação **[direção]**

| Função | Segurança | Escopo | Devolve |
|---|---|---|---|
| `vendas_por_dia(p_loja_id, p_inicio, p_fim, p_tipo_entrega, p_so_concluidos)` | `SECURITY INVOKER` (molde D6 de `aplicar_frequencia_em_produtos`), `search_path` fixo | `WHERE loja_id = p_loja_id` explícito; para autor não-`service_role`, reconfere `lojas.dono_id = auth.uid()` no corpo com `coalesce(auth.role(), '')` fail-closed (molde `20260918130000`) | uma linha por **dia local** (`(criado_em AT TIME ZONE lojas.timezone)::date`): nº de pedidos, bruto, descontos, líquido, frete, nº de pedidos com frete a combinar |
| `vendas_itens_por_categoria(…mesmos parâmetros…)` | idem | idem, `itens_pedido` via `pedidos` | por (categoria snapshot, item): quantidade e valor bruto da linha (RN-V16) |
| `ranking_clientes_da_loja(p_inicio, p_fim, p_ordem, p_limite)` | `SECURITY DEFINER`, `search_path = ''`, molde `clientes_da_loja` (`20261003124000`) | `lojas.dono_id = (select auth.uid())`, **sem parâmetro de loja** | `cliente_id`, `nome`, `total_pedidos`, `total_gasto`, `ultimo_pedido_em`, `itens_top` (até 3: nome + quantidade), mais a contagem de pedidos de convidados no período |

- Grants: `REVOKE ALL … FROM public, anon`; financeiras `GRANT EXECUTE TO authenticated, service_role`; ranking
  `GRANT EXECUTE TO authenticated`.
- Faixa de data **sempre** obrigatória nas financeiras (`p_inicio`/`p_fim` não nulos, `[inicio, fim)`), servida
  pelo índice `pedidos(loja_id, criado_em DESC)`. O ranking aceita `p_inicio` nulo só para "desde o início";
  `pedidos_loja_cliente_idx` atende.
- `p_tipo_entrega` aceita só `entrega | retirada | NULL` (ambos); `p_ordem` só `pedidos | total | ultimo`;
  `p_limite` com teto (ex.: 20) — valor fora → `22023`.
- **Não usar `listarPedidosDoDono`** (traz todos os pedidos sem limite): toda agregação é SQL com faixa de data.
- Somas em `numeric` no banco; o TS só formata (`formatarMoeda`) e soma linhas diárias no rollup com `arredondar`.

### Drift a corrigir pelo `escriba`

`itens_pedido.preco_original` (issue 221, migration `20260920127000`) já existe no banco e não está em
`schema.md`. Entrará junto com as colunas novas.

---

## Regras de Negócio

| RN | Regra (com caso numérico = critério de aceite) | Camada que garante |
|---|---|---|
| RN-V01 | **Faturamento padrão** = pedidos com `status ∈ ('confirmado','em_preparo','saiu_entrega','entregue')`; exclui `pendente` **e** `cancelado`. Caso: entregue R$50, em_preparo R$30, pendente R$20, cancelado R$40 → padrão **R$80**. | **Função SQL** (conjunto de status fixado no banco) |
| RN-V02 | **"Só concluídos"** = só `status = 'entregue'`. Mesmo caso de RN-V01 → **R$50**. O cliente envia só o booleano; a lista de status nunca vem da URL. | **Função SQL** + zod (booleano) |
| RN-V03 | **Três números + frete separado**, por pedido do conjunto: bruto = Σ `subtotal`; descontos = Σ `desconto`; líquido = Σ `max(0, subtotal − desconto)`; frete = Σ `taxa_entrega` (não nulo). Caso: subtotal 100, cupom −10, frete 8, total 98 → **bruto 100, descontos 10, líquido 90, frete 8**. | **Função SQL** sobre valores gravados (autoritativos desde o checkout) |
| RN-V04 | **Invariante:** líquido + frete = Σ `total` dos pedidos **sem** `frete_a_combinar` do mesmo conjunto. No caso de RN-V03: 90 + 8 = 98. Teste de propriedade sobre a fixture inteira. | Função SQL (teste em `tests/migrations/`) |
| RN-V05 | **Frete a combinar** (`taxa_entrega IS NULL`): fora do total de frete, com contador "N pedidos com frete a combinar, não somados". Bruto, descontos e líquido o incluem. Pedido cujo frete foi registrado depois (`frete_a_combinar` virou false) soma normalmente. Caso: A (subtotal 50, frete 5, total 55) + B (subtotal 30, frete a combinar, total 30) → bruto 80, líquido 80, frete **5**, aviso "1 pedido com frete a combinar, não somado". | **Função SQL** |
| RN-V06 | **Data do pedido = `criado_em`** (único instante do pedido), agrupada no **dia local de `lojas.timezone`**, não no `America/Sao_Paulo` cravado de `metricasPedidos.ts` (que fica intocado). Caso: pedido em `2026-10-06T02:30Z`, loja em `America/Sao_Paulo` → conta em **05/out**. Loja em `America/Manaus` (UTC−4) com pedido em `2026-10-06T03:30Z` → **05/out**. | **Função SQL** (`AT TIME ZONE lojas.timezone`) + limites em TS (`instanteNoFuso`) |
| RN-V07 | **Ciclo mensal** começa no `lojas.dia_inicio_ciclo` e vai até a véspera do mesmo dia no mês seguinte; a tela mostra o intervalo explícito. Casos: dia 5, hoje 07/out/2026 → ciclo atual **05/out a 04/nov**, mês anterior **05/set a 04/out**; dia 5, hoje 03/out → ciclo atual **05/set a 04/out**; dia 1, hoje 07/out → **01/out a 31/out**. "Este mês" = ciclo atual; "mês anterior" = ciclo anterior. | Servidor (TS puro no fuso da loja) |
| RN-V08 | **Dia de início do ciclo**: inteiro 1..28, default 1. Dia 29, 0 ou não inteiro → recusado. Lojista edita a própria loja; admin edita a loja-alvo (paridade). Não é campo de billing. | **CHECK no banco** + zod na Server Action + RLS `lojas_update_proprio` (lojista) / `prepararContextoAdmin` + `escopo.atualizarLoja` (admin) |
| RN-V09 | **Período global**: presets hoje, esta semana, este mês (ciclo atual), mês anterior (ciclo anterior), este ano (ano civil no fuso da loja), ou personalizado de/até (datas locais, inclusivas). Personalizado exige de ≤ até e **teto de 366 dias**. Caso: 01/01/2026 a 01/01/2027 (366 dias) → aceito; 01/01/2026 a 02/01/2027 (367) → recusado. Parâmetro inválido na URL cai no preset padrão **[direção: "este mês"]** com aviso discreto, nunca em consulta sem limite nem erro 500. | **Server Component (zod)** + função SQL exige faixa |
| RN-V10 | **Tipo de entrega**: Entrega (`entrega`), No local (`retirada`), Ambos. Caso: entrega R$60 + retirada R$20 no padrão → Entrega 60, No local 20, Ambos 80. | zod (allowlist) + **função SQL** |
| RN-V11 | **Semana fixa na segunda-feira (ISO)**, de segunda a domingo no fuso da loja. Caso: hoje quarta 07/out/2026 → "esta semana" = **05/out a 11/out**; na aba Semanal, 04/out (domingo) cai na semana de 28/set. | Servidor (TS puro) |
| RN-V12 | **Granularidades** Diário / Semanal / Mensal são abas internas sobre o mesmo período e filtros. O SQL devolve linhas diárias; semana (ISO) e mês (por **ciclo**) são rollup em TS puro no servidor. Invariante: Σ das barras de qualquer aba = números do período. Filtros (período, tipo_entrega **[direção: e "só concluídos"]**) vivem na URL; a aba não. | Servidor (rollup) + cliente (troca de aba, só UX) |
| RN-V13 | **Valores nunca recalculados nem aceitos do cliente.** O relatório soma `subtotal`/`desconto`/`taxa_entrega`/`total` já gravados pela RPC `criar_pedido` (`seguranca.md` §10). Somas em `numeric` no banco. | **Função SQL** |
| RN-V14 | **Categoria congelada na venda.** `criar_pedido` grava o snapshot (id + nome) resolvido **no servidor** via `produto_id` + `p_loja_id`; nunca do payload; assinatura de 18 args não muda. Caso: "Coca" vendida em março em "Bebidas", movida em abril para "Refrigerantes" → relatório de março mostra **"Bebidas"**; venda de abril mostra "Refrigerantes". Caso de ataque: jsonb do item com `categoria_id` forjado → ignorado, grava a categoria real. | **RPC (servidor)** |
| RN-V15 | **"Sem categoria"**: item cujo produto foi apagado (`produto_id` NULL) ou estava sem categoria (`produtos.categoria_id` NULL) no momento da venda — ou do backfill — cai no balde "Sem categoria". Backfill dos itens antigos usa a categoria **atual** do produto. Caso: item antigo de produto já apagado → "Sem categoria"; item antigo de "Coca" hoje em "Refrigerantes" → "Refrigerantes" (limite aceito do backfill). | Migration (backfill) + função SQL |
| RN-V16 | **Itens por categoria com valor bruto por linha**, fórmula de `totalDaLinha` (`src/lib/utils/calcularTotal.ts:39-51`): `arredondar(preco × qtd) + Σ arredondar(opcional.preco × opcional.qtd)`, opcional soma **uma vez** por linha. Soma bate com o subtotal: Σ linhas do conjunto = bruto (RN-V03). Desconto é do pedido e **não é rateado** — a tela diz isso. Caso: X-Burger R$20 × 2 + bacon R$3 × 1 → linha **R$43** (não 46). Pedido com subtotal 43 e cupom −10 → item mostra 43, bruto 43, líquido 33. | **Função SQL** (paridade com `totalDaLinha` travada em teste) |
| RN-V17 | **Ranking só com cliente logado** (`cliente_id` não nulo), com aviso "N pedidos de convidados fora do ranking" (mesmo período e status). Anonimização zera `cliente_id` → o pedido vira convidado (esperado). Caso: cliente A com 3 pedidos, 2 pedidos de convidado, 1 pedido de cliente anonimizado, todos no padrão → ranking mostra **A com 3**; aviso "**3 pedidos de convidados fora do ranking**". | **Função SQL** |
| RN-V18 | **Período próprio do ranking**: Semana (ISO), Mês (ciclo atual **[direção]**), Ano (civil), Desde o início; independente do filtro global (período, tipo de entrega e "só concluídos" não afetam o ranking). | Servidor (zod + limites em TS) |
| RN-V19 | **Métricas e ordenação do ranking**: nº de pedidos e total gasto = contagem e Σ `pedidos.total` nos **status do faturamento padrão** (RN-V01); último pedido = `max(criado_em)` no mesmo conjunto **[direção]**; ordenável por nº de pedidos (padrão), total gasto ou último pedido, **no banco**, com limite de linhas **[direção: 20]** aplicado depois de ordenar; desempate estável **[direção: total gasto, depois `cliente_id`]**. Itens mais comprados = top 3 por Σ quantidade no período. Caso: A com 5 pedidos (R$100), B com 2 (R$300) → padrão A, B; por total gasto B, A. Pedido pendente ou cancelado de A não conta. | **Função SQL** |
| RN-V20 | **Ranking só no painel e sem contato**: allowlist de colunas (`cliente_id` opaco, nome, métricas, itens); **sem telefone e sem e-mail**. O hub admin não tem ranking: a page admin não o carrega e `"clientes"` segue em `rotasAusentes`. | **Função SQL (`RETURNS TABLE` fechado)** + estrutura de componentes |
| RN-V21 | **Isolamento entre lojas.** Lojista lê só a própria loja: funções financeiras com client da sessão, RLS de `pedidos`/`itens_pedido` **e** reconferência `lojas.dono_id = auth.uid()` no corpo (a RLS sozinha não basta: `pedidos_select_cliente` soma por OR e deixaria um lojista que também é cliente ver os próprios pedidos em outra loja via `p_loja_id` alheio). Ranking escopa por `auth.uid()` sem parâmetro de loja. Admin usa `service_role` com `lojaId` validado (`validarLojaIdAdmin`) após `verificarAdminSaaS()`. `anon` não executa nada. Caso: lojista da loja X chama `vendas_por_dia(p_loja_id = Y)` → resultado vazio/zero, nenhuma linha de Y. | **Função SQL + RLS** (lojista); **Server Component/loader + escopo por `lojaId`** (admin) |
| RN-V22 | **Avisos fixos na tela**: o relatório cobre só vendas feitas pelo iRango; o faturamento é nominal (não há status "pago"). | Cliente (copy) |
| RN-V23 | **Erro interno não vaza**: mensagem genérica na UI ("Não foi possível carregar o relatório. Tente de novo."), detalhe só no log do servidor. | Servidor |
| RN-V24 | **Gráfico em CSS/SVG**, sem dependência nova no `package.json`. Acessível: cada barra com rótulo de valor legível por leitor de tela (texto + `aria-label`, nunca só cor), contraste ≥ 3:1 da barra contra o card (`design-system.md` §5 e §10). | Revisão de código + `npm ls` sem pacote novo |
| RN-V25 | **Export CSV fora desta entrega** (vira issue separada). | Escopo |

---

## Segurança (obrigatório)

- **Dado sensível que sai:** nome do cliente final no ranking (PII mínima, só no painel do dono da loja onde ele
  comprou logado). Telefone e e-mail **não** saem (allowlist, RN-V20). O admin não vê o ranking. Nenhum dado de
  pagamento existe no SaaS.
- **Valor monetário:** o relatório **só lê** valores autoritativos já gravados (RN-V13). Não há recálculo de preço
  porque não há cobrança; a única aritmética nova é soma (SQL `numeric`) e o valor bruto por linha (RN-V16), cuja
  paridade com `totalDaLinha` é travada por teste. Nenhum valor vem do cliente; filtros são revalidados por zod no
  servidor e o conjunto de status é fixado no banco (RN-V02).
- **Snapshot de categoria (RN-V14):** resolvido na RPC sob `service_role` a partir do `produto_id` **com
  `p_loja_id`**, nunca do jsonb. Teste de ataque: payload com categoria forjada e produto de outra loja.
- **Tabelas novas:** nenhuma. Colunas novas em `itens_pedido` (escrita só pela RPC, INSERT deny-all para
  usuário — inalterado) e em `lojas` (gravável pelo dono via `lojas_update_proprio`, fora de
  `CAMPOS_LOJA_SOMENTE_SERVIDOR`, não exposta em `vitrine_lojas`).
- **Funções novas e RLS:**
  - financeiras: `SECURITY INVOKER`, `search_path` fixo, `p_loja_id` explícito no `WHERE`, reconferência de posse
    para não-`service_role` com `coalesce(auth.role(), '')` fail-closed; `REVOKE` de `public`/`anon`. Testes
    pglite: `asUser` dono vê a própria loja; `asUser` de outra loja (inclusive sendo cliente dela) não vê nada
    da loja alheia; `asAnon` recebe erro de permissão; `asService` vê a loja passada.
  - ranking: `SECURITY DEFINER`, `search_path = ''`, escopo `lojas.dono_id = auth.uid()`, sem parâmetro de loja,
    `RETURNS TABLE` fechado. Testes: dono vê só os clientes com pedido na própria loja; cliente de outra loja
    não aparece; colunas devolvidas = allowlist exata; `asService` devolve vazio.
  - A RLS de `clientes` **não** é ampliada.
- **Admin:** loader `carga-vendas.ts` e action `salvarCicloVendasAdmin` seguem a ordem fail-closed
  (`validarLojaIdAdmin` → `verificarAdminSaaS()` → `createServiceClient()`), molde `carga-pedidos.ts` /
  `prepararContextoAdmin`.
- **API externa:** nenhuma.
- **TDD red-first** (código crítico): RN-V01–V05, V14, V16, V17, V19–V21.
- **Deploy:** as migrations A–D precisam de `npx supabase db push` (irreversível, com autorização) antes do código
  que as consome; senão `PGRST204`/função inexistente em runtime.

## Fora do Escopo (v1)

- **Export CSV** (decisão 11) — issue separada.
- **Ranking no hub admin** e qualquer rota de clientes no admin.
- **Rateio do desconto** por item ou categoria.
- **Status "pago"** ou conciliação financeira; vendas feitas fora do iRango.
- Comparação com período anterior, metas, projeções, margem/custo do produto.
- Lib de gráficos (Recharts etc.) e gráfico interativo além das três abas.
- Mudança no Dashboard (`metricasPedidos.ts` segue com o fuso cravado; corrigir é outra issue).
- Semana configurável (fixa na segunda) e ciclo com dia 29–31.
- Reprocessar o backfill de categoria para a categoria "da época" (não há histórico de categoria antes da migration).
- Notificação ou relatório por e-mail/WhatsApp; atualização em tempo real.
