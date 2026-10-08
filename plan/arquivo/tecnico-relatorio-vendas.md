# Plano técnico — relatório de vendas (issues 353–358)

Produzido pelo `arquitetar` no passo P3 de `plan/loop-relatorio-vendas.md`. Spec: `specs/relatorio-vendas.md`.
Base conferida: branch `feat/relatorio-vendas` @ `fbdabce`. A issue 359 (export CSV) está fora deste plano.

Consumo previsto (uma fatia por agente, nesta ordem):

| Fatia | Agente | O que faz | Seção |
|---|---|---|---|
| RED | `tdd` (um só) | escreve **todos** os testes vermelhos das críticas 353–357 (pglite + unit), roda e captura `FAIL` | §8 |
| A | `executar` | banco: 6 migrations (353–356), wrappers de query, `lib/vendas/tipos.ts`, patch de `database.types.ts` e dos fixtures que o patch quebra | §9.A |
| push | sessão | `migration list` → `db push` → `gen types` → diff contra o patch → tsc | §9.push |
| B | `executar` | TS + UI: 354 (actions), 357 (período, rollup, zod, montagem, loader admin), 358 (páginas, componentes, nav) | §9.B |

As decisões 1–11 do usuário e as linhas **[direção]** do spec são restrição. Onde este plano diverge do texto do
spec ou de uma issue, a divergência está marcada **[DESVIO]** com o motivo. São seis, todas listadas em §12.

---

## 1. Diagnóstico

**Causa raiz.** O iRango não tem um modelo de leitura de vendas. O único agregado (`calcularMetricasDoDia`,
`src/lib/utils/metricasPedidos.ts`) roda em TS sobre **todos** os pedidos da loja (`listarPedidosDoDono`, sem
faixa de data), com o fuso cravado em São Paulo. O item vendido também não guarda a categoria: `itens_pedido`
tem snapshot de `nome`/`preco`/`preco_original` (`20261003122000_rpc_criar_pedido_cliente.sql:200-210`), mas a
categoria só pode ser lida pelo `produto_id`, que muda ou some depois da venda. Sem esse fato gravado no momento
da venda não existe "o que vendeu por categoria em março" correto.

**O remendo rejeitado.** Estender `metricasPedidos.ts` ou somar em TS a lista de `listarPedidosDoDono` com um
`join` em `produtos`: soma em float no cliente do banco, consulta sem limite, fuso errado, categoria "de hoje"
aplicada ao passado e, no admin, uma segunda cópia da conta. Isso resolveria a tela e quebraria as quatro
invariantes que importam (valor autoritativo, faixa obrigatória, dia local da loja e categoria congelada).

**O conserto.** Três fontes únicas, uma por invariante:
1. **Categoria congelada** é gravada pela RPC `criar_pedido` no servidor, a partir de `produto_id` + `p_loja_id`
   (nunca do payload), com backfill dos itens antigos.
2. **Valores e dia local** saem de funções SQL que somam em `numeric` os valores já gravados no checkout,
   agrupando por `(criado_em AT TIME ZONE lojas.timezone)::date`, com faixa obrigatória e trava de posse no corpo.
3. **Calendário** (presets, ciclo, semana ISO, rótulos) sai de um módulo TS puro sobre `fusoLoja.ts`, que já é a
   fonte única de fuso do projeto. O rollup semana/ciclo soma as linhas diárias do SQL, nada mais.

**Por que é complexo.**
- Republica a RPC de checkout (`criar_pedido`, caminho de dinheiro). Qualquer regressão em dedupe, cupom,
  `cliente_id` ou valor é bug de dinheiro.
- A RLS de `pedidos` soma `pedidos_acesso_lojista` e `pedidos_select_cliente` por OR (`seguranca.md` §2,
  "Leitura pelo cliente com conta"). Uma função `SECURITY INVOKER` que confie só na RLS deixa um lojista que
  também é cliente agregar as próprias compras numa loja alheia passando `p_loja_id` dela. A trava de posse no
  corpo é necessária, não estética.
- Dois mundos (lojista com client da sessão e admin com `service_role`) consomem as mesmas funções.
- Mexe em contrato de dados (`itens_pedido`, `lojas`, 6 funções novas) que precisa de `db push` antes do código.

---

## 2. Mapa de Impacto

```
CHECKOUT (escrita — muda só o que a RPC grava)
src/lib/actions/pedido.ts criarPedido            [NÃO muda: payload sem campo novo]
  └─ rpc criar_pedido (18 args)                   [migration B: create or replace, corpo literal + bloco 353]
       ├─ lê produtos(id, loja_id, categoria_id) + categorias(id, loja_id, nome)   [novo, escopo p_loja_id]
       └─ INSERT itens_pedido(..., categoria_id_snapshot, categoria_nome_snapshot)  [colunas novas, migration A1]
backfill (migration A2) ─ UPDATE itens_pedido ← produtos ← categorias (mesma loja do pedido)

PAINEL /painel/vendas  (client da SESSÃO)
(bloqueavel)/vendas/page.tsx [novo]
  ├─ lerParamsVendas(searchParams)                 lib/validacoes/vendas.ts [novo]  ── zod, nunca lança
  ├─ buscarLojaDoDono(supabase)                    queries/lojas.ts [reuso] → lê lojas.timezone, dia_inicio_ciclo
  ├─ carregarRelatorioVendas(supabase, loja, …)    lib/vendas/carregarRelatorioVendas.ts [novo, server-only]
  │    ├─ montarContextoVendas(...)                lib/utils/periodoVendas.ts [novo, puro] → fusoLoja.ts [reuso]
  │    ├─ buscarVendasPorDia / buscarItensPorCategoria   queries/vendas.ts [novo]
  │    │     └─ rpc vendas_por_dia / vendas_itens_por_categoria  [INVOKER + T2 posse] → pedidos, itens_pedido,
  │    │        itens_pedido_opcionais (RLS do dono) → status_faturamento() → vendas_preparar_consulta()
  │    └─ preencherDias / agruparPorSemana / agruparPorCiclo / agruparItensPorCategoria   lib/utils/agregarVendas.ts [novo]
  ├─ carregarRankingClientes(supabase, loja, …)    lib/vendas/carregarRankingClientes.ts [novo, só painel]
  │    └─ rpc ranking_clientes_da_loja + pedidos_convidados_da_loja [DEFINER, escopo auth.uid()] → clientes(nome)
  └─ <RelatorioVendas> + <RankingClientesFieis>    components/painel/* [novos]
       └─ <CicloMensal salvar={salvarCicloVendas}> → lib/actions/vendas.ts [novo 'use server']
            └─ UPDATE lojas(dia_inicio_ciclo) — RLS lojas_update_proprio + CHECK lojas_dia_inicio_ciclo_check

ADMIN /admin/assinantes/[lojaId]/vendas  (service_role)
[lojaId]/vendas/page.tsx [novo]
  ├─ lerParamsVendas(searchParams)                 (o mesmo)
  ├─ carregarVendasLojaAdmin(lojaId, filtros, agora)   [lojaId]/carga-vendas.ts [novo]
  │    validarLojaIdAdmin → notFound | verificarAdminSaaS (propaga) → createServiceClient
  │    → buscarLojaAdminPorId (reuso) → carregarRelatorioVendas(svc, loja, …)  (p_loja_id = id validado)
  │    ✗ NUNCA importa carregarRankingClientes
  └─ <RelatorioVendas salvarCiclo={salvarCicloVendasAdmin.bind(null, lojaId)}>
       └─ actions/admin-vendas.ts [novo] → prepararContextoAdmin → escopo.atualizarLoja({dia_inicio_ciclo})

NAV  components/painel/NavPainel.tsx construirItens (:119; item Dashboard em :161) → + "Vendas" após Dashboard,
     nos dois mundos. admin [lojaId]/layout.tsx:57 rotasAusentes NÃO muda.
```

### Onde cada invariante é garantida

```
Conjunto de status do faturamento (RN-V01/02):
  ├── URL: só o booleano `concluidos` — [cliente — só escolhe]
  ├── lib/validacoes/vendas.ts — [zod: "1" → true, resto → false]
  └── public.status_faturamento(bool) — [AUTORITATIVO, fonte única; vendas_* e ranking leem dela]

Valores bruto/descontos/líquido/frete (RN-V03..05, V13):
  ├── ResumoFaturamento.tsx — [cliente — só formata]
  ├── agregarVendas.ts — [servidor, só soma linhas diárias já agregadas, com arredondar]
  └── vendas_por_dia (SQL numeric sobre subtotal/desconto/taxa_entrega gravados) — [AUTORITATIVO]

Valor bruto da linha (RN-V16):
  ├── calcularTotal.ts totalDaLinha — [fórmula de referência do checkout]
  └── vendas_itens_por_categoria — [AUTORITATIVO na leitura; paridade travada por teste]

Categoria congelada (RN-V14/15):
  ├── payload do item — [IGNORADO: nenhuma chave de categoria é lida]
  └── criar_pedido (service_role, escopo p_loja_id) + backfill A2 — [AUTORITATIVO] + CHECK de par (defesa)

Escopo de loja (RN-V21):
  ├── lojista: T2 no corpo (dono_id = auth.uid()) + RLS de pedidos/itens — [AUTORITATIVO]
  ├── admin: validarLojaIdAdmin → verificarAdminSaaS → service_role + WHERE loja_id = p_loja_id — [AUTORITATIVO]
  ├── ranking: SECURITY DEFINER, lojas.dono_id = auth.uid(), sem parâmetro de loja — [AUTORITATIVO]
  └── anon: REVOKE ALL … FROM public, anon — [AUTORITATIVO]

Ciclo 1..28 (RN-V08):
  ├── CicloMensal.tsx (safeParse do mesmo schema) — [cliente — UX]
  ├── salvarCicloVendas / salvarCicloVendasAdmin (zod .strict()) — [Server Action]
  ├── RLS lojas_update_proprio / escopo.atualizarLoja — [posse]
  └── CHECK lojas_dia_inicio_ciclo_check — [AUTORITATIVO final]

Faixa de período (RN-V09):
  ├── FiltrosVendas (form GET) — [cliente — só escreve a URL]
  ├── lerParamsVendas (zod; inválido → "este mês" + aviso) — [Server Component]
  └── vendas_preparar_consulta (faixa obrigatória, p_fim > p_inicio, ≤ 367 dias) — [AUTORITATIVO]
```

---

## 3. Análise do Codebase (conferida)

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `supabase/migrations/20261003122000_rpc_criar_pedido_cliente.sql` | última `criar_pedido`, 18 args (`:35-54`), INVOKER, `search_path = public` (`:57-58`), INSERT de itens `:200-210`, grants `:230-237` | **nada** (nunca editar migration aplicada); a migration B copia o corpo |
| `src/lib/actions/pedido.ts` | `criarPedido`; snapshot de item `:346-358`, subtotal = `calcularSubtotal` das mesmas linhas `:372-375` | nada |
| `src/lib/utils/calcularTotal.ts:39-51` | `totalDaLinha` (opcional uma vez por linha, regra 090) | nada; é a referência do teste de paridade |
| `src/lib/utils/precoEfetivo.ts:121` | preço efetivo já arredondado a centavo | nada; garante que `itens_pedido.preco` é centavo exato |
| `src/lib/utils/fusoLoja.ts` | `instanteNoFuso` `:103`, `diaNoFuso` `:160`, `partesNoFusoCompletas` `:47` | nada; reuso |
| `src/lib/utils/mesDeReferencia.ts` | `nomeDoMes(1..12)` | nada; reuso (`slice(0, 3)` → `out`, `nov`, `mar`) |
| `src/lib/utils/arredondar.ts` | arredondamento monetário único | nada; reuso no rollup |
| `src/lib/utils/metricasPedidos.ts` | métricas do dia do Dashboard (fuso SP) | **NÃO tocar** |
| `src/lib/supabase/queries/pedidos.ts` | `listarPedidosDoDono` (sem faixa) | **NÃO tocar**, não usar |
| `src/lib/supabase/queries/lojas.ts:62,122` | `buscarLojaDoDono` (RLS) e `buscarLojaAdminPorId` (svc) com `select("*")` | nada; passam a trazer `dia_inicio_ciclo` sozinhos |
| `src/lib/supabase/queries/clientes.ts:69-90` | molde de wrapper de RPC tipado (`client`, args condicionais) | nada; molde |
| `src/lib/supabase/queries/enforcement-escopo-queries.test.ts:44` | exige `.eq("loja_id", lojaId)` em toda função `(svc, lojaId: string)` | nada. Os wrappers novos nomeiam o parâmetro `client` e recebem objeto: **não** caem na descoberta (precedente `imagens.ts:127` `buscarUsoDasImagens(client, lojaId)`) |
| `src/lib/actions/admin-loja.ts` | `validarLojaIdAdmin` `:30`, `CAMPOS_LOJA_SOMENTE_SERVIDOR` `:51`, `escopo.atualizarLoja` `:205-213`, `prepararContextoAdmin` `:236`, `registrarAcessoAdmin` | nada; `dia_inicio_ciclo` fica **fora** da blocklist |
| `src/lib/actions/patches-loja.ts:70` | `montarPatchModalidades` (allowlist coluna a coluna, paridade painel/admin) | **+ `montarPatchCiclo`** |
| `src/lib/actions/entrega.ts:37-67` / `admin-entrega.ts:51-84` | par lojista/admin que grava preferência em `lojas` | nada; molde das actions do ciclo |
| `src/components/painel/ModalidadesEntrega.tsx` | form de preferência com `useState` + `safeParse` + `useTransition` + `toast` + `router.refresh()`, action injetada | nada; molde do `CicloMensal` |
| `src/app/admin/assinantes/[lojaId]/carga-pedidos.ts` / `carga.ts:53-78` | loader admin fail-closed | nada; molde do `carga-vendas.ts` |
| `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` | todo `export async function` de `carga*.ts` e `actions/*.ts` precisa citar `verificarAdminSaaS`/`prepararContextoAdmin` | nada; os arquivos novos obedecem |
| `src/app/admin/assinantes/[lojaId]/layout.tsx:57` | `rotasAusentes: ["configuracoes/promocoes", "clientes"]` | **NÃO muda** |
| `src/components/painel/NavPainel.tsx:119,161` | `construirItens`, item Dashboard | + item Vendas |
| `src/app/(painel)/painel/(bloqueavel)/clientes/page.tsx` | molde de page: `searchParams` Promise, filtros por `<Link>` com `aria-current`, erro genérico com só o código no log | nada; molde |
| `src/lib/database.types.ts` | tipos gerados | patch determinístico (§6.7) |
| `src/types/supabase.ts` | morto | **NÃO tocar** |
| `tests/helpers/pglite.ts` | `auth.role()` fiel ao cloud (NULL sem JWT) | nada |
| `supabase/migrations/20260614008500_grants_roles_supabase.sql` | `ALTER DEFAULT PRIVILEGES … GRANT ALL ON ROUTINES TO anon, authenticated, service_role` | nada. Consequência: **toda função nova nasce executável por `anon`**; o `REVOKE … FROM public, anon` é obrigatório |
| `supabase/migrations/20260708120000_lojas_protege_billing_v4_consentimento.sql:55-92` | trigger de billing compara 14 colunas nomeadas | nada; coluna nova passa |
| view `vitrine_lojas` (`20260925120000_lojas_modalidades_entrega.sql`) | projeção com colunas explícitas | nada; não expõe a coluna nova |

**Fatos verificados que o plano usa:**
- Não existe nenhum `CREATE TRIGGER` em `itens_pedido` em `supabase/migrations/` (grep). O `UPDATE` do backfill
  não dispara trigger nenhum. `itens_pedido_opcionais` não é tocado.
- `pedidos.tipo_entrega text NOT NULL CHECK (tipo_entrega IN ('retirada','entrega'))`
  (`20260614005500_pedidos_tipo_entrega_troco.sql:20-21`).
- RLS de leitura do dono: `itens_pedido_lojista` e `ipo_leitura_lojista` (`20260614007500_opcionais.sql:213`).
- pglite aceita fuso nomeado: `('2026-10-06T02:30Z'::timestamptz at time zone 'America/Sao_Paulo')::date` →
  `2026-10-05`; `America/Manaus` com `03:30Z` → `2026-10-05` (rodado nesta sessão).
- Sufixos de migration lidos por testes existentes: `_clientes.sql` (`anonimizar_cliente.test.ts:24`,
  `clientes_rls_isolamento.test.ts:31`), `_rpc_criar_pedido_cliente.sql` (`cupons_limite_por_cliente.test.ts:44`),
  `_papel_cliente.sql`, `_pedidos_cliente_id.sql`, `_cupons_limite_por_cliente.sql`. Nenhum nome novo termina
  assim.
- `vitest.config` fixa `TZ=UTC` e o alias `@/` vale em `tests/`.

---

## 4. Decisões de Design

**D1 — Funções financeiras: `SECURITY INVOKER` + T2 de posse no corpo.**
(a) DEFINER + T1..T7 (molde 215): tira a RLS do lojista sem ganho. (b) INVOKER só com RLS: aberto pelo OR de
`pedidos_select_cliente`. (c) **Escolhida:** INVOKER (desvio D6 do `seguranca.md`, "Quarta instância"): o corpo já
filtra `loja_id = p_loja_id`, então o admin (`service_role`, BYPASSRLS) fica escopado pelo `WHERE`, e o lojista
fica com RLS **e** T2. A T2 roda **antes** de qualquer leitura, no molde da galeria
(`20261006121000_rpc_galeria.sql:39-53`): `v_e_servico` = `coalesce(auth.role(), '') = 'service_role'` **e**
`current_setting('role')` fora de `authenticated`/`anon`. Sem JWT (postgres, pg_cron) → nega.

**D2 — Recusa de posse: `raise 42501 'vendas: sem posse da loja'` em vez de "zero linhas". [DESVIO]**
A issue 355 e a RN-V21 dizem "resultado vazio/zero". Recusar é mais forte (nenhuma linha de Y sai nos dois casos)
e evita sucesso silencioso, que é a razão de existir da T2 na Quinta/Sexta instância do `seguranca.md`. Não vira
oráculo: a mensagem é a mesma para loja alheia e para loja inexistente. A UI nunca chega lá (o painel passa
`loja.id` da sessão). O critério de aceite passa a ser: "chamada com `p_loja_id` alheio → `42501` com fragmento
`sem posse da loja`; nenhuma linha devolvida".

**D3 — Conjunto de status num só lugar: `public.status_faturamento(boolean) returns text[]`.**
(a) Lista redigitada nas três funções: viola a issue 356 ("nunca redigitar"). (b) Tabela de configuração: peso
sem ganho. (c) **Escolhida:** função SQL `IMMUTABLE STRICT`, nasce na migration D1 (355) e o ranking (356) a
chama. `STRICT`: `null` devolve `null`, `= any(null)` não casa nada (fail-closed). Os chamadores leem o array
numa variável (`v_status`) uma vez, fora do `WHERE`. Um teste estático trava que a migration do ranking não
contém o literal `'em_preparo'`.

**D4 — Validação e posse num helper único: `public.vendas_preparar_consulta(...) returns text` (timezone).**
As duas financeiras têm a mesma T1/T2. Duplicar seria a "lista de guards em N caminhos" que o mandato proíbe.
O helper valida, prova posse e devolve `lojas.timezone` (lido no banco, nunca do cliente). Fica exposto via
PostgREST a `authenticated`/`service_role`: chamado direto, devolve só o fuso da própria loja ou recusa.

**D5 — Contagem de convidados: função irmã `pedidos_convidados_da_loja(p_inicio, p_fim) returns integer`.**
(a) Coluna repetida no `RETURNS TABLE` do ranking: com zero clientes logados não há linha para carregar o número
(o caso "loja só com convidados" some). (b) `count` em TS pela RLS da sessão: obrigaria redigitar o conjunto de
status em TS. (c) `RETURNS jsonb` único: perde o `RETURNS TABLE` como allowlist verificável. (d) **Escolhida:**
função irmã, mesmo molde DEFINER, mesmo escopo, mesmas validações de período; o painel chama as duas em paralelo.

**D6 — Ranking: `SECURITY DEFINER`, todos os parâmetros com default.**
Molde `20261003124000_clientes_da_loja.sql`. Defaults em todos (`p_inicio null`, `p_fim null` → `22023`,
`p_ordem 'pedidos'`, `p_limite 20`) porque o `supabase gen types` só marca opcional o argumento com default; sem
isso `p_inicio: string` não aceitaria "desde o início". Ordenação e `limit` dentro do SQL; `itens_top` calculado
**depois** do corte (só para as ≤ 20 linhas). Nome do cliente vem de `clientes.nome` (anonimizado já virou
convidado, então nunca aparece). Grants: `REVOKE ALL … FROM public, anon` + `GRANT EXECUTE … TO authenticated`.
O `service_role` mantém o EXECUTE que os default privileges dão a toda rotina (fato de `20260614008500`), como
em `clientes_da_loja`; sob ele `auth.uid()` é nulo e a função devolve vazio/0, que é o critério da issue 356.

**D7 — Contrato da invariante "Σ linhas = bruto" (RN-V16) e o "1 centavo".**
Fatos: `itens_pedido.preco` e `itens_pedido_opcionais.preco_snapshot` são `numeric(10,2)`; `precoEfetivo` já
arredonda a centavo (`precoEfetivo.ts:121`); `pedidos.subtotal` = `calcularSubtotal` das mesmas linhas
(`pedido.ts:372-375`). Para entradas em centavo exato × inteiro, `arredondar` em float devolve o centavo exato:
conferido nesta sessão por varredura (1,7 milhão de pares preço×qtd e 200 mil somas de 5 linhas, zero
divergências). Contrato escrito:
- **Faturamento (bruto, descontos, líquido, frete) tem uma fonte só: `vendas_por_dia`**, que soma
  `pedidos.subtotal`. Nenhuma tela soma linhas de item para mostrar faturamento.
- `ItensPorCategoria` mostra valor por item e subtotal por categoria (colunas de janela do SQL), **sem total
  geral**, para que nenhum número da tela contradiga o bruto.
- A igualdade exata Σ linhas = Σ subtotal vale para todo pedido gravado pela RPC desde a regra 090
  (`071be4c`, 2026-06-16). Pedido anterior pode divergir (opcional multiplicado pela quantidade); não é
  reprocessado. O teste de propriedade monta o pedido com `subtotal = calcularSubtotal(itens)`.

**D8 — Corrigir a RN-V04. [DESVIO de texto]**
Lida ao pé da letra ("líquido + frete = Σ total dos pedidos **sem** `frete_a_combinar`"), a RN-V04 falha no
próprio caso da RN-V05: líquido 80 + frete 5 = 85, mas Σ total sem a combinar = 55. Para pedido a combinar,
`total = greatest(0, subtotal − desconto)` (RPC `:133,150`; trigger `pedidos_protege_valor` recalcula ao
registrar o frete). A invariante correta, testada: **Σ líquido + Σ frete = Σ `total` do conjunto inteiro**
(equivalente à forma restrita quando os dois lados excluem os a combinar).

**D9 — Ordem das migrations do snapshot: A1 (colunas) → B (RPC) → A2 (backfill).**
(a) Backfill antes da RPC: pedido criado entre o backfill e a troca da RPC fica com snapshot NULL para sempre.
(b) **Escolhida:** RPC antes do backfill. O backfill só toca `categoria_id_snapshot IS NULL`, então cobre o que
nasceu antes e durante a janela e não reescreve o que a RPC nova gravou. Separar o backfill num arquivo só com o
`UPDATE` também o torna reexecutável no teste (precedente `frequencia_migracao_dados.test.ts`, D9 da 320). O
checkout não para em momento nenhum: o payload não muda.

**D10 — Filtros por `<Link>` e `<form method="get">`, sem estado de cliente.**
(a) `ToggleGroup` + `useRouter().push` (sugestão do spec): JavaScript para escrever URL, não testável sem jsdom.
(b) **Escolhida:** molde de `clientes/page.tsx`: presets, tipo de entrega, "só concluídos", período e ordem do
ranking são `<Link>` com `href` montado no servidor por `hrefVendas` e `aria-current`; o personalizado é um
`<form method="get">` com dois `<Input type="date">` e os demais filtros em `hidden`. Renderiza sem JS e é
testável por `renderToStaticMarkup`. As abas do gráfico seguem no cliente (`ToggleGroup`), porque não vão à URL.

**D11 — `CicloMensal` com `useState` + `safeParse`, não `react-hook-form`. [DESVIO]**
Não há `@hookform/resolvers` no `package.json`; o molde de preferência do painel com action injetada é
`ModalidadesEntrega.tsx` (`useState` + mesmo schema zod do servidor + `useTransition` + `toast` +
`router.refresh()`). Um campo só. O schema continua o mesmo da action (`schemaCicloVendas`).

**D12 — `salvarCiclo` e `baseVendas` são props obrigatórias do `RelatorioVendas`. [DESVIO]**
O spec diz "Default = lojista". Um default faria a page admin que esquecer a prop cair na action do lojista
(bug já descrito em `admin/.../[lojaId]/page.tsx`, issue 329: "Sem a prop o selo cairia na action do lojista").
Obrigatória = impossível esquecer (tsc). Painel passa `salvarCicloVendas`; admin passa
`salvarCicloVendasAdmin.bind(null, lojaId)` (padrão `.bind`, `seguranca.md` §7 issue 140).

**D13 — Montagem compartilhada em `src/lib/vendas/` (server-only), ranking em módulo separado.**
`lib/utils` é puro; `lib/actions` é de helpers de action. Domínios com I/O server-only já vivem em pastas
próprias (`lib/assinatura/`, `lib/billing/`, `lib/auth/`). `carregarRelatorioVendas.ts` (financeiro, usado pelos
dois mundos) e `carregarRankingClientes.ts` (só painel) em arquivos separados: o admin não importa nem
transitivamente o ranking, e o teste estático do admin consegue provar isso.

**D14 — Teto da faixa: 366 dias locais no zod, 367 dias de intervalo no SQL.**
O zod é a regra de produto (366 dias inclusivos, RN-V09). O SQL é a cerca: `[de 00:00, ate+1 00:00)` de 366 dias
pode medir 366 dias + 1 h numa virada de horário de verão; `> interval '367 days'` recusa sem falso positivo.

**D15 — Gráfico: barra = líquido, `bg-primary`.**
O spec não fixa a métrica. Líquido (Σ `greatest(0, subtotal − desconto)`) é o que a loja faturou com produto, sem
frete, e é o número central do resumo. `--primary` é `oklch(0.205 0 0)` (`globals.css:58`), ~17:1 contra o card
branco; `--chart-1` (`oklch(0.87 0 0)`) dá ~1,4:1 e é **proibido** aqui. Uma prop `metrica` não entra (escopo).

**D16 — Nullability dos `RETURNS TABLE` no TS.**
O `gen types` tipa coluna de `RETURNS TABLE` como não nula (ex.: `clientes_da_loja.telefone: string`, que é
nullable no banco). `categoria_id`/`categoria_nome` de `vendas_itens_por_categoria` são NULL no balde "Sem
categoria": o wrapper reexporta o tipo com essas duas colunas `string | null`.

**D17 — Tipos de domínio num módulo puro de fatia A: `src/lib/vendas/tipos.ts`.**
Constantes (`TIPOS_ENTREGA_FILTRO`, `ORDENS_RANKING`, `LIMITE_RANKING`, `PRESETS_VENDAS`, `PERIODOS_RANKING`) e
os tipos derivados. Queries (fatia A), zod e utils (fatia B) importam daqui; nenhum ciclo de import
(`validacoes` → `utils` → `tipos`; `queries` → `tipos`).

---

## 5. Cenários

**Caminho feliz (painel).** Lojista abre `/painel/vendas` sem parâmetro → preset "este mês" (ciclo atual) no fuso
da loja → `vendas_por_dia` + `vendas_itens_por_categoria` com o client da sessão → resumo, barras das três
granularidades, itens por categoria; ranking com período "mês" e ordem "pedidos" em paralelo.

**Caminho feliz (admin).** Admin abre `/admin/assinantes/<uuid>/vendas` → `carga-vendas` valida, prova admin,
eleva, lê a loja-alvo → mesma montagem com `svc` e `p_loja_id` validado. Sem ranking.

| Borda | Comportamento |
|---|---|
| Loja inativa (não publicada) | relatório funciona normalmente (é dado interno do painel) |
| Assinatura bloqueada | `(bloqueavel)/layout.tsx` redireciona para `/painel/assinatura-bloqueada` antes da page |
| Sessão expirada | `painel/layout.tsx` redireciona para `/login`; action do ciclo: `buscarLojaDoDono` → null → erro genérico, sem UPDATE |
| Lojista que também é cliente de outra loja | `vendas_*` com `p_loja_id` alheio → `42501`; ranking só enxerga a loja de `auth.uid()` como dono |
| `p_loja_id` inexistente sob `service_role` | helper devolve timezone NULL → função devolve zero linhas |
| Parâmetro de URL inválido (preset, datas, 367 dias, `de > ate`, entrega, `concluidos=true`, array) | cai no padrão daquele grupo (`mes`/`ambos`/`false`) + aviso discreto; nunca exceção, nunca consulta sem faixa |
| Período sem vendas | resumo zerado, barras zeradas preenchidas, "Nenhuma venda no período." nos itens |
| Pedido de frete a combinar | conta em bruto/descontos/líquido, fora do frete, contador "1 pedido com frete a combinar, não somado" |
| Desconto maior que o subtotal | líquido da linha = 0 (`greatest`) |
| Item de produto apagado / sem categoria | balde "Sem categoria", sempre por último |
| Categoria renomeada ou apagada depois da venda | snapshot não muda (sem FK) |
| Ranking só com convidados | lista vazia + "N pedidos de convidados fora do ranking" (função irmã) |
| Duplo submit do ciclo | idempotente (mesmo valor); `useTransition` desabilita o botão |
| Lojista e admin editam o ciclo juntos | última escrita vence; os dois caminhos gravam só a coluna |
| Ciclo 29/0/5.5/"5" | zod recusa no cliente e na action; CHECK recusa no banco |
| `lojas.timezone` inválido | `AT TIME ZONE` lança `22023` / `Intl` lança `RangeError` → `carregarRelatorioVendas` captura → `{ ok: false }` |
| Falha de RPC | log `"[vendas] <etapa>"` só com o código do erro; UI "Não foi possível carregar o relatório. Tente de novo." |
| Ranking falha, financeiro ok | card do ranking mostra a mensagem genérica; o resto da tela segue |

---

## 6. Contratos de Dados

Nomes em ordem de dependência (todas > `20261006123000`, a última existente):

| # | Arquivo | Issue |
|---|---|---|
| A1 | `supabase/migrations/20261007120000_itens_pedido_categoria_snapshot.sql` | 353 |
| B | `supabase/migrations/20261007121000_rpc_criar_pedido_categoria_snapshot.sql` | 353 |
| A2 | `supabase/migrations/20261007122000_itens_pedido_categoria_backfill.sql` | 353 |
| C | `supabase/migrations/20261007123000_lojas_dia_inicio_ciclo.sql` | 354 |
| D1 | `supabase/migrations/20261007124000_relatorio_vendas_funcoes.sql` | 355 |
| D2 | `supabase/migrations/20261007125000_ranking_clientes_fieis.sql` | 356 |

Toda migration tem cabeçalho com issue, spec, dependência, decisão citada e bloco de rollback comentado, no
estilo de `20260920126000_itens_pedido_preco_original.sql`.

**SQL conferido nesta sessão.** Os blocos de §6.1–§6.6 (com a migration B montada pelas regras de §6.2) foram
aplicados num pglite com o bootstrap de `tests/helpers/pglite.ts` sobre todas as migrations existentes. Resultado:
as seis aplicam; snapshot `'Bebidas'` congelado após mover a Coca; payload forjado ignorado; produto de outra loja
→ NULL; comparação de corpo do T353-15 = igual; backfill preenche `'Refrigerantes'` e deixa cross-loja NULL; CHECK
do ciclo recusa 29 com o nome da constraint; dono grava (1 linha) e outro dono não (0); pedido `02:30Z` cai em
`2026-10-05`; RN-V04 fecha (150 + 8 = 158 = Σ total); dono alheio e claim forjado → `42501 sem posse da loja`;
anon → `permission denied for function`; 368 dias → `faixa acima do teto`; ranking ordena A,B / B,A / B,A com
`itens_top` Coca 5, X-Burger 3, Batata 2 (pendente fora); `asService` no ranking → 0 linhas. Isso não substitui o
RED: o `tdd` escreve os testes e o `executar` cria os arquivos.

### 6.1 A1 — colunas de snapshot (expand, idempotente)

```sql
alter table public.itens_pedido
  add column if not exists categoria_id_snapshot   uuid,
  add column if not exists categoria_nome_snapshot text;

-- Sem FK de propósito: snapshot imutável, mesma família de nome/preco/preco_original.
alter table public.itens_pedido
  drop constraint if exists itens_pedido_categoria_snapshot_par_check;
alter table public.itens_pedido
  add constraint itens_pedido_categoria_snapshot_par_check
  check ((categoria_id_snapshot is null) = (categoria_nome_snapshot is null));

comment on column public.itens_pedido.categoria_id_snapshot is
  'RN-V14: id da categoria do produto NO MOMENTO da venda, resolvido pela RPC criar_pedido a partir de produto_id + p_loja_id (nunca do payload). Sem FK: snapshot imutavel. NULL = Sem categoria.';
comment on column public.itens_pedido.categoria_nome_snapshot is
  'RN-V14: nome da categoria no momento da venda. Par com categoria_id_snapshot (itens_pedido_categoria_snapshot_par_check).';
```
RLS: nenhuma policy nova. Escrita só pela RPC (INSERT deny-all para `anon`/`authenticated` desde
`20260708130000`). Rollback: `alter table public.itens_pedido drop constraint if exists
itens_pedido_categoria_snapshot_par_check, drop column if exists categoria_nome_snapshot, drop column if exists
categoria_id_snapshot;` (só depois de reverter B).

### 6.2 B — `criar_pedido` grava o snapshot

Arquivo novo contendo **só** `create or replace function public.criar_pedido(...)` + o mesmo bloco de
`revoke`/`grant` de `20261003122000:230-237`. **Sem `drop function`.** Regras de cópia:

1. Copiar **literalmente** as linhas `35-228` de `20261003122000_rpc_criar_pedido_cliente.sql` (assinatura,
   `returns table`, `language plpgsql`, `security invoker`, `set search_path = public`, corpo inteiro com os
   comentários) e aplicar **apenas** as duas edições abaixo (indentação dos blocos abaixo é a do arquivo: 2 espaços no `declare`, 4 no corpo do loop). Nenhum espaço, comentário ou linha a mais fora delas:
   o teste T353-15 compara o `prosrc` aplicado com o arquivo antigo.

**Edição 1**, no `declare`, logo após `  v_usos_cliente    bigint;` (`:73`), duas linhas terminadas em `-- [353]`:
```
  v_categoria_id    uuid;    -- [353]
  v_categoria_nome  text;    -- [353]
```

**Edição 2**: substituir o statement `insert into public.itens_pedido (...) values (...) returning id into
v_item_id;` (`:200-210`, de `    insert into` até `returning id into v_item_id;` inclusive) por este bloco,
delimitado pelos marcadores exatos `    -- >>> [353]` e `    -- <<< [353]`:
```sql
    -- >>> [353] RN-V14: categoria CONGELADA na venda, resolvida aqui a partir de
    -- produto_id + p_loja_id. Nenhuma chave de categoria do jsonb é lida: payload
    -- forjado não escolhe categoria, e produto/categoria de outra loja dá NULL.
    v_categoria_id := null;
    v_categoria_nome := null;
    select c.id, c.nome
      into v_categoria_id, v_categoria_nome
      from public.produtos pr
      join public.categorias c
        on c.id = pr.categoria_id
       and c.loja_id = p_loja_id
     where pr.id = (v_item->>'produto_id')::uuid
       and pr.loja_id = p_loja_id;
    insert into public.itens_pedido (
      pedido_id, produto_id, nome, preco, quantidade, observacao, preco_original,
      categoria_id_snapshot, categoria_nome_snapshot
    )
    values (
      v_pedido_id,
      (v_item->>'produto_id')::uuid,
      v_item->>'nome',
      (v_item->>'preco')::numeric,
      (v_item->>'quantidade')::int,
      left(nullif(trim(v_item->>'observacao'), ''), 200),
      (v_item->>'preco_original')::numeric,
      v_categoria_id,
      v_categoria_nome
    )
    returning id into v_item_id;
    -- <<< [353]
```

**Grants** idênticos (o `create or replace` preserva o ACL; reemitir é defesa):
`revoke all … from public, anon, authenticated;` `grant execute … to service_role;` com a lista de 18 tipos.

Fato a registrar: a RPC **não** valida que `produto_id` pertence à loja (quem valida é `criarPedido`,
`pedido.ts`). O bloco novo não muda isso; só garante que um produto de outra loja gera snapshot NULL.
Rollback: reexecutar `20261003122000:35-237`.

### 6.3 A2 — backfill (só o UPDATE, reexecutável)

```sql
update public.itens_pedido ip
   set categoria_id_snapshot   = c.id,
       categoria_nome_snapshot = c.nome
  from public.pedidos p
  join public.produtos pr
    on pr.loja_id = p.loja_id
  join public.categorias c
    on c.id = pr.categoria_id
   and c.loja_id = p.loja_id
 where p.id = ip.pedido_id
   and pr.id = ip.produto_id
   and ip.categoria_id_snapshot is null;
```
Categoria **atual** (limite aceito, RN-V15). `produto_id` NULL, produto sem categoria ou cadeia que cruza loja →
fica NULL. Nenhum trigger em `itens_pedido` (fato conferido). Rollback: nenhum necessário (dado só nas colunas
novas; reverter A1 apaga).

### 6.4 C — ciclo mensal em `lojas`

```sql
alter table public.lojas
  add column if not exists dia_inicio_ciclo smallint not null default 1;

alter table public.lojas drop constraint if exists lojas_dia_inicio_ciclo_check;
alter table public.lojas
  add constraint lojas_dia_inicio_ciclo_check check (dia_inicio_ciclo between 1 and 28);

comment on column public.lojas.dia_inicio_ciclo is
  'RN-V08: dia (1..28) em que comeca o ciclo mensal do relatorio de vendas. Nao e billing nem PII: fora de CAMPOS_LOJA_SOMENTE_SERVIDOR e do trigger lojas_protege_billing; gravavel pelo dono (lojas_update_proprio) e pelo admin (escopo.atualizarLoja). Nao entra em vitrine_lojas.';
```
`ADD COLUMN … NOT NULL DEFAULT <constante>` é metadata-only. Trigger de billing v4 compara colunas nomeadas
(`20260708120000:76-92`) e não bloqueia; `lojas_exige_dono_lojista_trg` é `UPDATE OF dono_id`; RLS
`lojas_update_proprio` (`20260614001000_rls_lojas.sql:35`) `USING/WITH CHECK auth.uid() = dono_id` permite ao
dono. Rollback: `alter table public.lojas drop constraint if exists lojas_dia_inicio_ciclo_check, drop column if
exists dia_inicio_ciclo;`.

### 6.5 D1 — funções financeiras

```sql
-- D3: fonte única do conjunto de status do faturamento.
create or replace function public.status_faturamento(p_so_concluidos boolean)
returns text[]
language sql
immutable
strict
set search_path = ''
as $$
  select case
           when p_so_concluidos then array['entregue']::text[]
           else array['confirmado', 'em_preparo', 'saiu_entrega', 'entregue']::text[]
         end
$$;

-- D4: T1 (forma) + T2 (posse) + fuso da loja, uma vez para as duas financeiras.
create or replace function public.vendas_preparar_consulta(
  p_loja_id       uuid,
  p_inicio        timestamptz,
  p_fim           timestamptz,
  p_tipo_entrega  text    default null,
  p_so_concluidos boolean default false
)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
  v_tz          text;
begin
  -- T1: forma. Nada é lido antes daqui.
  if p_loja_id is null then
    raise exception 'vendas: loja obrigatória' using errcode = '22023';
  end if;
  if p_inicio is null or p_fim is null then
    raise exception 'vendas: faixa obrigatória' using errcode = '22023';
  end if;
  if p_fim <= p_inicio then
    raise exception 'vendas: faixa invertida' using errcode = '22023';
  end if;
  if p_fim - p_inicio > interval '367 days' then
    raise exception 'vendas: faixa acima do teto' using errcode = '22023';
  end if;
  if p_tipo_entrega is not null and p_tipo_entrega not in ('entrega', 'retirada') then
    raise exception 'vendas: tipo_entrega inválido' using errcode = '22023';
  end if;
  if p_so_concluidos is null then
    raise exception 'vendas: so_concluidos obrigatório' using errcode = '22023';
  end if;

  -- T2: posse ANTES de qualquer leitura de pedido. A RLS sozinha não basta:
  -- pedidos_select_cliente soma por OR e entregaria ao lojista-cliente os
  -- próprios pedidos numa loja alheia. coalesce(auth.role(), '') é fail-closed
  -- (20260918130000).
  if not (
       v_e_servico
    or exists (select 1 from public.lojas l where l.id = p_loja_id and l.dono_id = auth.uid())
  ) then
    raise exception 'vendas: sem posse da loja' using errcode = '42501';
  end if;

  select l.timezone into v_tz from public.lojas l where l.id = p_loja_id;
  return v_tz;   -- NULL = loja inexistente (só alcançável pela via de serviço)
end;
$$;

create or replace function public.vendas_por_dia(
  p_loja_id       uuid,
  p_inicio        timestamptz,
  p_fim           timestamptz,
  p_tipo_entrega  text    default null,
  p_so_concluidos boolean default false
)
returns table (
  dia                  date,
  qtd_pedidos          integer,
  bruto                numeric,
  descontos            numeric,
  liquido              numeric,
  frete                numeric,
  qtd_frete_a_combinar integer
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tz     text;
  v_status text[];
begin
  v_tz := public.vendas_preparar_consulta(p_loja_id, p_inicio, p_fim, p_tipo_entrega, p_so_concluidos);
  if v_tz is null then
    return;
  end if;
  v_status := public.status_faturamento(p_so_concluidos);

  return query
  select (p.criado_em at time zone v_tz)::date,
         count(*)::integer,
         sum(p.subtotal),
         sum(p.desconto),
         sum(greatest(0, p.subtotal - p.desconto)),
         coalesce(sum(p.taxa_entrega), 0),
         (count(*) filter (where p.taxa_entrega is null))::integer
    from public.pedidos p
   where p.loja_id = p_loja_id
     and p.criado_em >= p_inicio
     and p.criado_em <  p_fim
     and p.status = any (v_status)
     and (p_tipo_entrega is null or p.tipo_entrega = p_tipo_entrega)
   group by 1
   order by 1;
end;
$$;

create or replace function public.vendas_itens_por_categoria(
  p_loja_id       uuid,
  p_inicio        timestamptz,
  p_fim           timestamptz,
  p_tipo_entrega  text    default null,
  p_so_concluidos boolean default false
)
returns table (
  categoria_id          uuid,
  categoria_nome        text,
  item_nome             text,
  quantidade            integer,
  valor_bruto           numeric,
  categoria_quantidade  integer,
  categoria_valor_bruto numeric
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tz     text;
  v_status text[];
begin
  v_tz := public.vendas_preparar_consulta(p_loja_id, p_inicio, p_fim, p_tipo_entrega, p_so_concluidos);
  if v_tz is null then
    return;
  end if;
  v_status := public.status_faturamento(p_so_concluidos);

  -- Valor bruto da LINHA = espelho de totalDaLinha (calcularTotal.ts:39-51):
  -- round(preco × qtd, 2) + Σ round(opcional.preco × opcional.qtd, 2); opcional
  -- soma UMA vez por linha (regra 090). Desconto é do pedido: não é rateado.
  -- Toda coluna qualificada: os OUT params (quantidade, categoria_id…) são variáveis.
  return query
  with linhas as (
    select ip.categoria_id_snapshot  as cat_id,
           ip.categoria_nome_snapshot as cat_nome,
           ip.nome                    as item,
           ip.quantidade              as qtd,
           round(ip.preco * ip.quantidade, 2)
             + coalesce((select sum(round(o.preco_snapshot * o.quantidade, 2))
                           from public.itens_pedido_opcionais o
                          where o.item_pedido_id = ip.id), 0) as valor
      from public.itens_pedido ip
      join public.pedidos p on p.id = ip.pedido_id
     where p.loja_id = p_loja_id
       and p.criado_em >= p_inicio
       and p.criado_em <  p_fim
       and p.status = any (v_status)
       and (p_tipo_entrega is null or p.tipo_entrega = p_tipo_entrega)
  ),
  por_item as (
    select l.cat_id, l.cat_nome, l.item,
           sum(l.qtd)::integer as qtd,
           sum(l.valor)        as valor
      from linhas l
     group by l.cat_id, l.cat_nome, l.item
  ),
  com_categoria as (
    select x.cat_id, x.cat_nome, x.item, x.qtd, x.valor,
           (sum(x.qtd) over w)::integer as cat_qtd,
           sum(x.valor) over w          as cat_valor
      from por_item x
    window w as (partition by x.cat_id, x.cat_nome)
  )
  select c.cat_id, c.cat_nome, c.item, c.qtd, c.valor, c.cat_qtd, c.cat_valor
    from com_categoria c
   order by (c.cat_id is null), c.cat_valor desc, c.cat_nome, c.cat_id, c.qtd desc, c.valor desc, c.item;
end;
$$;

revoke all on function public.status_faturamento(boolean) from public, anon;
revoke all on function public.vendas_preparar_consulta(uuid, timestamptz, timestamptz, text, boolean) from public, anon;
revoke all on function public.vendas_por_dia(uuid, timestamptz, timestamptz, text, boolean) from public, anon;
revoke all on function public.vendas_itens_por_categoria(uuid, timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.status_faturamento(boolean) to authenticated, service_role;
grant execute on function public.vendas_preparar_consulta(uuid, timestamptz, timestamptz, text, boolean) to authenticated, service_role;
grant execute on function public.vendas_por_dia(uuid, timestamptz, timestamptz, text, boolean) to authenticated, service_role;
grant execute on function public.vendas_itens_por_categoria(uuid, timestamptz, timestamptz, text, boolean) to authenticated, service_role;
```
Índices: `pedidos(loja_id, criado_em DESC)`, `itens_pedido(pedido_id)`, `itens_pedido_opcionais(item_pedido_id)`
já existem (`schema.md` §3). Nenhum índice novo. Rollback: `drop function if exists` das quatro, na ordem
inversa.

### 6.6 D2 — ranking e convidados

```sql
create or replace function public.ranking_clientes_da_loja(
  p_inicio timestamptz default null,   -- NULL = desde o início
  p_fim    timestamptz default null,   -- obrigatório na prática (NULL → 22023)
  p_ordem  text        default 'pedidos',
  p_limite integer     default 20
)
returns table (
  cliente_id       uuid,
  nome             text,
  total_pedidos    integer,
  total_gasto      numeric,
  ultimo_pedido_em timestamptz,
  itens_top        jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text[] := public.status_faturamento(false);
begin
  if p_fim is null then
    raise exception 'ranking_clientes_da_loja: p_fim obrigatório' using errcode = '22023';
  end if;
  if p_inicio is not null and p_fim <= p_inicio then
    raise exception 'ranking_clientes_da_loja: faixa invertida' using errcode = '22023';
  end if;
  if p_ordem is null or p_ordem not in ('pedidos', 'total', 'ultimo') then
    raise exception 'ranking_clientes_da_loja: p_ordem inválido' using errcode = '22023';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 20 then
    raise exception 'ranking_clientes_da_loja: p_limite fora de 1..20' using errcode = '22023';
  end if;

  -- Escopo = a loja de auth.uid(); sem parâmetro de loja. Sob service_role,
  -- auth.uid() é NULL e nada casa. Toda coluna qualificada (OUT params).
  return query
  with base as (
    select p.cliente_id as cid, p.id as pid, p.total as tot, p.criado_em as em
      from public.pedidos p
      join public.lojas l on l.id = p.loja_id
     where l.dono_id = (select auth.uid())
       and p.cliente_id is not null
       and p.status = any (v_status)
       and (p_inicio is null or p.criado_em >= p_inicio)
       and p.criado_em < p_fim
  ),
  agg as (
    select b.cid, count(*)::integer as n, sum(b.tot) as gasto, max(b.em) as ultimo
      from base b
     group by b.cid
  ),
  corte as (                      -- ordena e corta NO BANCO (RN-V19)
    select a.cid, a.n, a.gasto, a.ultimo
      from agg a
     order by case when p_ordem = 'pedidos' then a.n end desc nulls last,
              case when p_ordem = 'ultimo' then a.ultimo end desc nulls last,
              a.gasto desc,
              a.cid asc
     limit p_limite
  )
  select t.cid,
         c.nome,
         t.n,
         t.gasto,
         t.ultimo,
         coalesce((
           select jsonb_agg(jsonb_build_object('nome', x.nome, 'quantidade', x.qtd)
                            order by x.qtd desc, x.nome asc)
             from (select ip.nome, sum(ip.quantidade)::integer as qtd
                     from public.itens_pedido ip
                     join base b2 on b2.pid = ip.pedido_id
                    where b2.cid = t.cid
                    group by ip.nome
                    order by sum(ip.quantidade) desc, ip.nome asc
                    limit 3) x
         ), '[]'::jsonb)
    from corte t
    join public.clientes c on c.id = t.cid
   order by case when p_ordem = 'pedidos' then t.n end desc nulls last,
            case when p_ordem = 'ultimo' then t.ultimo end desc nulls last,
            t.gasto desc,
            t.cid asc;
end;
$$;

create or replace function public.pedidos_convidados_da_loja(
  p_inicio timestamptz default null,
  p_fim    timestamptz default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text[] := public.status_faturamento(false);
begin
  if p_fim is null then
    raise exception 'pedidos_convidados_da_loja: p_fim obrigatório' using errcode = '22023';
  end if;
  if p_inicio is not null and p_fim <= p_inicio then
    raise exception 'pedidos_convidados_da_loja: faixa invertida' using errcode = '22023';
  end if;
  -- Convidado = cliente_id NULL; pedido anonimizado também (RN-V17).
  return (
    select count(*)::integer
      from public.pedidos p
      join public.lojas l on l.id = p.loja_id
     where l.dono_id = (select auth.uid())
       and p.cliente_id is null
       and p.status = any (v_status)
       and (p_inicio is null or p.criado_em >= p_inicio)
       and p.criado_em < p_fim
  );
end;
$$;

revoke all on function public.ranking_clientes_da_loja(timestamptz, timestamptz, text, integer) from public, anon;
revoke all on function public.pedidos_convidados_da_loja(timestamptz, timestamptz) from public, anon;
grant execute on function public.ranking_clientes_da_loja(timestamptz, timestamptz, text, integer) to authenticated;
grant execute on function public.pedidos_convidados_da_loja(timestamptz, timestamptz) to authenticated;
```
A migration D2 **não** pode conter o literal `'em_preparo'` (teste T356-14). Índices `pedidos_loja_cliente_idx`
e `lojas_dono_unico` atendem. Rollback: `drop function if exists` das duas.

### 6.7 Patch determinístico de `src/lib/database.types.ts` (fatia A)

Ordem alfabética de chaves, como o gerador faz.
- `Tables.itens_pedido` (`:583`): `Row` + `categoria_id_snapshot: string | null`, `categoria_nome_snapshot: string | null`
  (primeiras chaves, antes de `id`); `Insert`/`Update` + `categoria_id_snapshot?: string | null`,
  `categoria_nome_snapshot?: string | null`.
- `Tables.lojas` (`:680`): `Row` + `dia_inicio_ciclo: number` (após `criado_em`); `Insert`/`Update`
  + `dia_inicio_ciclo?: number`.
- `Functions.loja_por_email_dono.Returns` e `Functions.loja_por_subscription_id.Returns` (setof `lojas`):
  + `dia_inicio_ciclo: number`.
- `Functions`, novas entradas:
```ts
      pedidos_convidados_da_loja: {
        Args: { p_fim?: string; p_inicio?: string }
        Returns: number
      }
      ranking_clientes_da_loja: {
        Args: { p_fim?: string; p_inicio?: string; p_limite?: number; p_ordem?: string }
        Returns: {
          cliente_id: string
          itens_top: Json
          nome: string
          total_gasto: number
          total_pedidos: number
          ultimo_pedido_em: string
        }[]
      }
      status_faturamento: { Args: { p_so_concluidos: boolean }; Returns: string[] }
      vendas_itens_por_categoria: {
        Args: {
          p_fim: string
          p_inicio: string
          p_loja_id: string
          p_so_concluidos?: boolean
          p_tipo_entrega?: string
        }
        Returns: {
          categoria_id: string
          categoria_nome: string
          categoria_quantidade: number
          categoria_valor_bruto: number
          item_nome: string
          quantidade: number
          valor_bruto: number
        }[]
      }
      vendas_por_dia: {
        Args: {
          p_fim: string
          p_inicio: string
          p_loja_id: string
          p_so_concluidos?: boolean
          p_tipo_entrega?: string
        }
        Returns: {
          bruto: number
          descontos: number
          dia: string
          frete: number
          liquido: number
          qtd_frete_a_combinar: number
          qtd_pedidos: number
        }[]
      }
      vendas_preparar_consulta: {
        Args: {
          p_fim: string
          p_inicio: string
          p_loja_id: string
          p_so_concluidos?: boolean
          p_tipo_entrega?: string
        }
        Returns: string
      }
```
**Fixtures que o patch quebra no tsc** (literal completo de `LojaCompleta`/`Tables<"lojas">` sem cast) — adicionar
`dia_inicio_ciclo: 1` no mesmo commit do patch: `src/lib/utils/manifestPainel.test.ts:18`,
`src/app/(painel)/painel/manifest.webmanifest/route.test.ts:38`, `src/lib/actions/assinatura.test.ts:114`.
Rodar `npx tsc --noEmit` logo depois do patch e corrigir qualquer outro literal completo que apareça (só em
teste; os de `PedidoComItens` já usam `as unknown as`).

---

## 7. Contratos TypeScript

### 7.1 `src/lib/vendas/tipos.ts` (novo, puro, fatia A)
```ts
export const TIPOS_ENTREGA_FILTRO = ["entrega", "retirada", "ambos"] as const;
export type TipoEntregaFiltro = (typeof TIPOS_ENTREGA_FILTRO)[number];
export const ORDENS_RANKING = ["pedidos", "total", "ultimo"] as const;
export type OrdemRanking = (typeof ORDENS_RANKING)[number];
export const LIMITE_RANKING = 20;
export const PRESETS_VENDAS = ["hoje", "semana", "mes", "mes_anterior", "ano", "personalizado"] as const;
export type PresetVendas = (typeof PRESETS_VENDAS)[number];
export const PERIODOS_RANKING = ["semana", "mes", "ano", "tudo"] as const;
export type PeriodoRanking = (typeof PERIODOS_RANKING)[number];
/** "YYYY-MM-DD" no calendário local da loja. */
export type DiaLocal = string;
export type IntervaloDias = { deDia: DiaLocal; ateDia: DiaLocal };   // inclusivo
export type ResultadoCiclo = { ok: true } | { ok: false; erro: string };
```

### 7.2 `src/lib/supabase/queries/vendas.ts` (novo, `import "server-only"`, fatia A)
```ts
type Client = SupabaseClient<Database>;
type Fn = Database["public"]["Functions"];
export type FaixaVendas = {
  lojaId: string; inicio: string; fim: string;          // ISO UTC, [inicio, fim)
  tipoEntrega: TipoEntregaFiltro; soConcluidos: boolean;
};
export type LinhaVendasDia = Fn["vendas_por_dia"]["Returns"][number];
export type LinhaItemCategoria =
  Omit<Fn["vendas_itens_por_categoria"]["Returns"][number], "categoria_id" | "categoria_nome">
  & { categoria_id: string | null; categoria_nome: string | null };   // D16
export type LinhaRankingCliente = Fn["ranking_clientes_da_loja"]["Returns"][number];

export async function buscarVendasPorDia(client: Client, faixa: FaixaVendas): Promise<LinhaVendasDia[]>;
export async function buscarItensPorCategoria(client: Client, faixa: FaixaVendas): Promise<LinhaItemCategoria[]>;
export async function buscarRankingClientes(
  client: Client,
  f: { inicio: string | null; fim: string; ordem: OrdemRanking; limite: number },
): Promise<LinhaRankingCliente[]>;
export async function contarPedidosConvidados(
  client: Client, f: { inicio: string | null; fim: string },
): Promise<number>;
```
Regras: args = `{ p_loja_id, p_inicio, p_fim, p_so_concluidos }` + `p_tipo_entrega` **só** quando
`tipoEntrega !== "ambos"` (ambos → chave omitida → NULL no SQL); ranking/convidados omitem `p_inicio` quando
`null`. `if (error) throw error;` `return data ?? []` (convidados: `data ?? 0`). Sem `.eq` (RPC escopa no corpo).
Parâmetro chama `client`, nunca `svc` (§3, enforcement).

### 7.3 `src/lib/utils/periodoVendas.ts` (novo, puro, fatia B)
```ts
export const TETO_DIAS_PERSONALIZADO = 366;
export function ehDiaLocalValido(dia: string): boolean;              // /^\d{4}-\d{2}-\d{2}$/ + round-trip Date.UTC
export function somarDias(dia: DiaLocal, n: number): DiaLocal;      // aritmética de calendário em UTC (sem fuso)
export function diasInclusivos(de: DiaLocal, ate: DiaLocal): number; // ate − de + 1
export function inicioDaSemanaIso(dia: DiaLocal): DiaLocal;          // segunda-feira
export function cicloQueContem(dia: DiaLocal, diaInicioCiclo: number): IntervaloDias;
export function rotuloDia(dia: DiaLocal): string;                    // "05/out" (nomeDoMes(m).slice(0,3))
export function rotuloIntervalo(i: IntervaloDias): string;           // "05/out a 04/nov" | "05/dez/2026 a 04/jan/2027" (anos diferentes)
export function janelaDeDias(i: IntervaloDias, timezone: string): IntervaloDias & { inicio: string; fim: string };
//   inicio = instanteNoFuso(`${deDia}T00:00`, tz); fim = instanteNoFuso(`${somarDias(ateDia,1)}T00:00`, tz)
export function intervaloDoPreset(
  f: { periodo: PresetVendas; de: DiaLocal | null; ate: DiaLocal | null }, hoje: DiaLocal, diaInicioCiclo: number,
): IntervaloDias;
//   hoje → {hoje,hoje}; semana → [segunda, segunda+6]; mes → cicloQueContem(hoje); mes_anterior →
//   cicloQueContem(somarDias(cicloAtual.deDia, −1)); ano → [AAAA-01-01, AAAA-12-31]; personalizado → {de, ate}
export function janelaDoRanking(
  periodo: PeriodoRanking, agora: Date, timezone: string, diaInicioCiclo: number,
): { inicio: string | null; fim: string; rotulo: string };
//   tudo → inicio null, fim = início de amanhã local, rotulo "desde o início"; demais → janelaDeDias(intervalo)
export type ContextoVendas = {
  janela: IntervaloDias & { inicio: string; fim: string };
  rotuloPeriodo: string;
  cicloAtual: IntervaloDias & { rotulo: string };
  diaInicioCiclo: number;
};
export function montarContextoVendas(
  loja: { timezone: string; dia_inicio_ciclo: number }, filtros: FiltrosVendas, agora: Date,
): ContextoVendas;   // hoje = diaNoFuso(agora, tz)
```
`cicloQueContem`: dia do mês ≥ `diaInicioCiclo` → começa no mesmo mês; senão no mês anterior (com virada de
ano); termina na véspera do mesmo dia no mês seguinte. Com 1..28 todo mês tem o dia de início.

### 7.4 `src/lib/utils/agregarVendas.ts` (novo, puro, fatia B)
```ts
export type TotaisVendas = { pedidos: number; bruto: number; descontos: number; liquido: number; frete: number; freteACombinar: number };
export type LinhaDiariaVendas = TotaisVendas & { dia: DiaLocal };
export type BarraVendas = TotaisVendas & { chave: DiaLocal; rotulo: string };   // chave = 1º dia do balde
export type CategoriaVendas = {
  categoriaId: string | null; nome: string;   // "Sem categoria" quando null
  quantidade: number; valorBruto: number;
  itens: { nome: string; quantidade: number; valorBruto: number }[];
};
export const ROTULO_SEM_CATEGORIA = "Sem categoria";
export function preencherDias(linhas: LinhaDiariaVendas[], i: IntervaloDias): LinhaDiariaVendas[]; // zera os ausentes; lança se linha fora de i
export function somarLinhas(linhas: readonly TotaisVendas[]): TotaisVendas;   // arredondar a cada soma
export function barrasDiarias(linhas: LinhaDiariaVendas[]): BarraVendas[];     // rotulo "05/out"
export function agruparPorSemana(linhas: LinhaDiariaVendas[]): BarraVendas[];  // chave = inicioDaSemanaIso; rotulo "28/set a 04/out"
export function agruparPorCiclo(linhas: LinhaDiariaVendas[], diaInicioCiclo: number): BarraVendas[]; // rotulo do ciclo inteiro
export function agruparItensPorCategoria(linhas: LinhaItemCategoria[]): CategoriaVendas[]; // preserva a ordem do SQL
```

### 7.5 `src/lib/validacoes/vendas.ts` (novo, fatia B)
```ts
export const schemaDiaInicioCiclo = z.int().min(1).max(28);
export const schemaCicloVendas = z.object({ dia_inicio_ciclo: schemaDiaInicioCiclo }).strict();
export type DadosCicloVendas = z.infer<typeof schemaCicloVendas>;
export const MSG_CICLO_INVALIDO = "Escolha um dia entre 1 e 28.";
export type FiltrosVendas = { periodo: PresetVendas; de: DiaLocal | null; ate: DiaLocal | null; entrega: TipoEntregaFiltro; concluidos: boolean };
export type FiltrosRanking = { periodo: PeriodoRanking; ordem: OrdemRanking };
export const FILTROS_PADRAO: FiltrosVendas = { periodo: "mes", de: null, ate: null, entrega: "ambos", concluidos: false };
export const RANKING_PADRAO: FiltrosRanking = { periodo: "mes", ordem: "pedidos" };
export const schemaItensTop = z.array(z.object({ nome: z.string(), quantidade: z.int().min(1) })).max(3);
export function lerParamsVendas(sp: Record<string, string | string[] | undefined>): {
  filtros: FiltrosVendas; ranking: FiltrosRanking; avisoFiltros: boolean; avisoRanking: boolean;
};  // nunca lança
export function hrefVendas(base: string, filtros: FiltrosVendas, ranking: FiltrosRanking | null): string;
```
Parâmetros de URL: `periodo`, `de`, `ate` (só com `periodo=personalizado`), `entrega`, `concluidos` (`"1"`),
`ranking`, `ordem`. `hrefVendas` omite valores padrão e escreve na ordem `periodo, de, ate, entrega, concluidos,
ranking, ordem`; sem parâmetro devolve `base`. Regras de `lerParamsVendas`: cada grupo cai no padrão
independente (período → `mes`, entrega → `ambos`, concluídos → `false`, ranking/ordem → `RANKING_PADRAO`);
`avisoFiltros` liga se período/entrega/concluídos foi trocado, `avisoRanking` se ranking/ordem foi trocado. Valor
array é inválido. Personalizado exige `ehDiaLocalValido(de)`, `ehDiaLocalValido(ate)`, `de <= ate` e
`diasInclusivos(de, ate) <= 366`; `de`/`ate` com outro preset são ignorados sem aviso.

### 7.6 Montagem, ranking e loader admin (fatia B)
```ts
// src/lib/vendas/carregarRelatorioVendas.ts — import "server-only"
export type LojaVendas = Pick<LojaCompleta, "id" | "timezone" | "dia_inicio_ciclo">;
export type DadosVendas = {
  totais: TotaisVendas;
  barras: { diario: BarraVendas[]; semanal: BarraVendas[]; mensal: BarraVendas[] };
  categorias: CategoriaVendas[];
};
export type ResultadoRelatorioVendas = { ok: true; contexto: ContextoVendas; dados: DadosVendas } | { ok: false };
export async function carregarRelatorioVendas(
  client: SupabaseClient<Database>, loja: LojaVendas, filtros: FiltrosVendas, agora: Date,
): Promise<ResultadoRelatorioVendas>;
// tudo dentro de try: contexto → Promise.all(buscarVendasPorDia, buscarItensPorCategoria) com a MESMA FaixaVendas
// → preencherDias(contexto.janela) → totais = somarLinhas(diárias) → barras → categorias.
// catch: console.error("[vendas] carregar relatório", codigo) (codigo = e.code ?? "erro"), return { ok: false }.

// src/lib/vendas/carregarRankingClientes.ts — import "server-only"; NUNCA importado pelo admin
export type ClienteRanking = { clienteId: string; nome: string; totalPedidos: number; totalGasto: number; ultimoPedidoEm: string; itensTop: { nome: string; quantidade: number }[] };
export type ResultadoRanking = { ok: true; rotuloPeriodo: string; clientes: ClienteRanking[]; convidados: number } | { ok: false };
export async function carregarRankingClientes(
  client: SupabaseClient<Database>, loja: Pick<LojaCompleta, "timezone" | "dia_inicio_ciclo">,
  ranking: FiltrosRanking, agora: Date,
): Promise<ResultadoRanking>;
// janelaDoRanking → Promise.all(buscarRankingClientes({…, limite: LIMITE_RANKING}), contarPedidosConvidados)
// → mapeia SEM reordenar; itens_top via schemaItensTop.safeParse (falha → []). catch → log só código → { ok: false }.

// src/app/admin/assinantes/[lojaId]/carga-vendas.ts — import "server-only"; único export
export async function carregarVendasLojaAdmin(
  lojaId: string, filtros: FiltrosVendas, agora: Date,
): Promise<{ loja: LojaCompleta; relatorio: ResultadoRelatorioVendas }>;
// validarLojaIdAdmin → !ok notFound() → await verificarAdminSaaS() (propaga) → createServiceClient()
// → buscarLojaAdminPorId(svc, id) → null notFound() → carregarRelatorioVendas(svc, loja, filtros, agora)
```

### 7.7 Actions do ciclo (fatia B)
```ts
// src/lib/actions/patches-loja.ts (+)
export function montarPatchCiclo(d: DadosCicloVendas): DadosCicloVendas {
  return { dia_inicio_ciclo: d.dia_inicio_ciclo };   // allowlist coluna a coluna
}

// src/lib/actions/vendas.ts — "use server"; só exporta async function + type
export async function salvarCicloVendas(payload: unknown): Promise<ResultadoCiclo>;
// schemaCicloVendas.safeParse → falha: { ok:false, erro: MSG_CICLO_INVALIDO } SEM I/O
// try: createClient → buscarLojaDoDono → null: erro genérico
//   → supabase.from("lojas").update(montarPatchCiclo(d), { count: "exact" }).eq("id", loja.id)
//   → error: log código + genérico; count !== 1: log + genérico → revalidatePath("/painel/vendas") → { ok: true }
// ERRO_GENERICO = "Não foi possível salvar o ciclo. Tente de novo."

// src/app/admin/assinantes/actions/admin-vendas.ts — "use server"
export async function salvarCicloVendasAdmin(lojaId: string, payload: unknown): Promise<ResultadoCiclo>;
// validarLojaIdAdmin → !ok { ok:false, erro:"Loja inválida." } → schemaCicloVendas.safeParse (falha SEM elevar)
// → const { svc, escopo } = await prepararContextoAdmin(id)  (FORA do try: falha propaga)
// → try: escopo.atualizarLoja(montarPatchCiclo(d)) → error/count !== 1 → genérico
//   → registrarAcessoAdmin(svc, { lojaId, acao: "salvar_ciclo_vendas", metadados: { dia_inicio_ciclo } })
//   → revalidatePath(`/admin/assinantes/${id}/vendas`) → { ok: true }
```
Sem rate limit: o padrão do painel para gravar preferência (`salvarModalidadesEntrega`) não tem, e a tabela do
`seguranca.md` §12 só limita endpoints públicos e loops de paginação.

### 7.8 UI (fatia B, issue 358)

| Arquivo | Tipo | Conteúdo |
|---|---|---|
| `src/app/(painel)/painel/(bloqueavel)/vendas/page.tsx` | Server | `searchParams: Promise<Record<string, string \| string[] \| undefined>>` (Next 16, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`); `lerParamsVendas` → `createClient` → `buscarLojaDoDono` (null → `redirect("/painel")`) → `Promise.all(carregarRelatorioVendas, carregarRankingClientes)` → `CabecalhoPagina voltarHref="/painel" voltarRotulo="Painel" titulo="Vendas"` + `RelatorioVendas baseVendas="/painel/vendas" ranking={ranking} salvarCiclo={salvarCicloVendas}` + `RankingClientesFieis` |
| `src/app/admin/assinantes/[lojaId]/vendas/page.tsx` | Server | `params` e `searchParams` Promise; `lerParamsVendas` → `carregarVendasLojaAdmin` → `CabecalhoPagina voltarHref={\`/admin/assinantes/${loja.id}\`} voltarRotulo="Dashboard"` + `RelatorioVendas baseVendas={…/vendas} ranking={null} salvarCiclo={salvarCicloVendasAdmin.bind(null, loja.id)}`. **Não importa** `RankingClientesFieis` nem `carregarRankingClientes`. Não chama `createServiceClient` (fica no loader) |
| `src/components/painel/RelatorioVendas.tsx` | Server | props obrigatórias `baseVendas`, `filtros`, `ranking: FiltrosRanking \| null`, `avisoFiltros`, `diaInicioCiclo`, `relatorio: ResultadoRelatorioVendas`, `salvarCiclo`. Cards brancos: avisos fixos (RN-V22) → `FiltrosVendas` → `CicloMensal` → (ok) `ResumoFaturamento` + `GraficoBarrasVendas` + `ItensPorCategoria` / (falha) `<p role="alert">Não foi possível carregar o relatório. Tente de novo.</p>` |
| `src/components/painel/vendas/FiltrosVendas.tsx` | Server | presets e entrega como `<Link>` (Button `nativeButton={false}` `render={<Link/>}`, `min-h-[44px]`, `aria-current`), "Só concluídos" idem, `<form method="get" action={baseVendas}>` com `Input type="date"` `de`/`ate` + `Label` + hidden dos demais; aviso `<p role="status">Filtro inválido no endereço. Mostrando o ciclo atual.</p>` quando `avisoFiltros` |
| `src/components/painel/vendas/CicloMensal.tsx` | Client | molde `ModalidadesEntrega`: "Ciclo atual: 05/out a 04/nov" (quando houver rótulo), `Input type="number" min=1 max=28`, `schemaCicloVendas.safeParse({ dia_inicio_ciclo: Number(valor) })`, erro com `aria-invalid` + `aria-describedby`, `useTransition`, `toast`, `router.refresh()` |
| `src/components/painel/vendas/ResumoFaturamento.tsx` | Server | bruto, descontos, líquido, frete com `formatarMoeda`; "1 pedido com frete a combinar, não somado" / "N pedidos com frete a combinar, não somados" |
| `src/components/painel/vendas/GraficoBarrasVendas.tsx` | Client | `ToggleGroup` Diário/Semanal/Mensal (estado local, não vai à URL) → `BarrasVendas` |
| `src/components/painel/vendas/BarrasVendas.tsx` | Server-safe (sem hooks) | `<ol aria-label="Faturamento líquido por …">`; cada `<li>` com barra `bg-primary` (altura % do maior líquido), `role="img"` + `aria-label="05/out: R$ 120,00"` e o valor em texto (visível até 14 barras; `sr-only` acima); container `overflow-x-auto` dentro do card |
| `src/components/painel/vendas/ItensPorCategoria.tsx` | Server | por categoria: nome, quantidade e valor bruto; itens; "Sem categoria" por último; nota "O desconto é do pedido e não é dividido entre os itens."; sem total geral (D7); vazio "Nenhuma venda no período." |
| `src/components/painel/RankingClientesFieis.tsx` | Server | links de período (Semana/Mês/Ano/Desde o início) e ordem via `hrefVendas` preservando os filtros globais; tabela nome, nº de pedidos, total gasto, último pedido (`formatarDataHora(iso, timezone)`), até 3 itens; "N pedidos de convidados fora do ranking"; nunca reordena; falha → mensagem genérica |
| `src/components/painel/NavPainel.tsx` | Client | `+ { href: \`${base}/vendas\`, rotulo: "Vendas", icone: ChartColumn }` logo após Dashboard; import `ChartColumn` de `lucide-react` (existe na 1.18) |

Componente shadcn ausente: não usar. Os necessários (`card`, `button`, `input`, `label`, `toggle-group`) existem.

---

## 8. Testes RED (fatia `tdd`)

Convenções: banco com `createTestDb()` de `tests/helpers/pglite.ts`, um banco por arquivo (`beforeAll`), uma loja
por cenário (1 conta = 1 loja), pedidos inseridos direto via `t.db` (postgres) com `criado_em` explícito, exceto
nos testes de RPC. Todo teste de recusa afirma **SQLSTATE e fragmento da mensagem** (memória "SQLSTATE não basta
em teste de escopo"). Dados fictícios (`@teste.local`, `(11) 90000-0000`). Depois de escrever: rodar cada
arquivo, capturar `FAIL` real e rodar `npx tsc --noEmit` (erros aceitos: só módulo/export inexistente dos
arquivos novos).

### 8.1 `tests/migrations/itens_pedido_categoria_snapshot.test.ts` (353)
Fixture: loja A (dono A) com categorias "Bebidas" e "Refrigerantes" e produto "Coca" (R$ 6) em "Bebidas";
produto "Sem Cat" sem categoria; loja B (dono B) com categoria "Bebidas B" e produto "Coca B" nela. Chamada da
RPC com o helper `chamarCriarPedido` no molde de `rpc_criar_pedido.test.ts` (18 args, `asService`).

| ID | Caso | Asserção |
|---|---|---|
| T353-01 | colunas existem | `information_schema.columns`: `categoria_id_snapshot` `uuid` `YES`, `categoria_nome_snapshot` `text` `YES` |
| T353-02 | sem FK | nenhuma `pg_constraint contype='f'` em `itens_pedido` cujo `conkey` inclua as colunas novas |
| T353-03 | CHECK par (id sem nome) | INSERT direto (postgres) com `categoria_id_snapshot` não nulo e nome NULL → `code 23514`, mensagem contém `itens_pedido_categoria_snapshot_par_check` |
| T353-04 | CHECK par (nome sem id) | idem, invertido |
| T353-05 | Coca em Bebidas | pedido 1 → item com `categoria_nome_snapshot = 'Bebidas'`, `categoria_id_snapshot = id(Bebidas)` |
| T353-06 | Coca movida (RN-V14) | `update produtos set categoria_id = Refrigerantes`; pedido 2 → `'Refrigerantes'`; item do pedido 1 segue `'Bebidas'` |
| T353-07 | categoria renomeada | `update categorias set nome = 'Bebidas geladas'` → item do pedido 1 segue `'Bebidas'` |
| T353-08 | payload forjado | item jsonb com `categoria_id`=Refrigerantes, `categoria_nome`='Forjada', `categoria_id_snapshot`=uuid qualquer, `categoria_nome_snapshot`='X' → grava a categoria real do produto |
| T353-09 | cross-loja | pedido em A com `produto_id` = "Coca B" → ambos NULL (nunca `'Bebidas B'`); pedido criado |
| T353-10 | produto sem categoria | ambos NULL |
| T353-11 | item sem `produto_id` | ambos NULL |
| T353-12 | backfill (reexecuta `20261007122000_…backfill.sql`; arquivo ausente → `throw` "[RED 353] migration ausente") | semear como postgres itens com snapshot NULL: (a) item de "Coca" (hoje em Refrigerantes) → `'Refrigerantes'`; (b) item com `produto_id` NULL → NULL; (c) item de pedido em A com `produto_id` de "Coca B" → NULL; (d) item de "Sem Cat" → NULL |
| T353-13 | backfill não reescreve | item com snapshot `'Bebidas'` gravado pela RPC segue `'Bebidas'` após reexecutar; segunda reexecução não muda nada |
| T353-14 | assinatura e ACL | `count(*) from pg_proc where proname='criar_pedido'` = 1; `pg_get_function_identity_arguments` = `'p_loja_id uuid, p_nome_cliente text, p_telefone_cliente text, p_endereco_entrega jsonb, p_forma_pagamento text, p_observacoes text, p_subtotal numeric, p_taxa_entrega numeric, p_desconto numeric, p_total numeric, p_cupom_id uuid, p_cupom_codigo text, p_itens jsonb, p_tipo_entrega text, p_troco_para numeric, p_idempotency_key uuid, p_frete_a_combinar boolean, p_cliente_id uuid'`; `prosecdef = false`; `proconfig = {search_path=public}`; `has_function_privilege` anon/authenticated `false`, service_role `true` |
| T353-15 | corpo literal | `velho` = texto entre `as $$` e `$$;` de `20261003122000_rpc_criar_pedido_cliente.sql` com o statement `/    insert into public\.itens_pedido \(pedido_id[\s\S]*?returning id into v_item_id;\n/` trocado por `"<<INSERT>>\n"`; `novo` = `prosrc` de `criar_pedido` no banco com o bloco `/    -- >>> \[353\][\s\S]*?    -- <<< \[353\]\n/` trocado por `"<<INSERT>>\n"` e as linhas `/^.*-- \[353\]\n/gm` removidas → `expect(novo.trim()).toBe(velho.trim())` (o `prosrc` guarda o corpo com as quebras de linha das pontas) |
| T353-16 | bloco não lê payload | `prosrc` não casa `/v_item\s*->>?\s*'categoria/`; casa `pr.loja_id = p_loja_id` e `c.loja_id = p_loja_id` |

RED esperado: T353-01..11/13 por `42703 column … does not exist`; T353-12 por migration ausente; T353-15/16 por
`prosrc` sem o bloco. T353-14 já passa (guarda de regressão; manter).
Regressão obrigatória no GREEN: `npx vitest run tests/migrations/rpc_criar_pedido.test.ts
tests/migrations/rpc_idempotencia_criar_pedido.test.ts tests/migrations/rpc_idempotencia_bordas.test.ts
tests/migrations/rpc_pedido_e2e.test.ts tests/migrations/cupons_limite_por_cliente.test.ts
tests/migrations/itens_pedido_preco_original.test.ts tests/migrations/pentest_area2_isolamento.test.ts` verdes
sem edição: junto com T353-15, prova que o resto do corpo é o mesmo.

### 8.2 `tests/migrations/lojas_dia_inicio_ciclo.test.ts` (354)

| ID | Caso | Asserção |
|---|---|---|
| T354-01 | default | loja nova → `dia_inicio_ciclo = 1`; `data_type = 'smallint'`, `is_nullable = 'NO'` |
| T354-02 | 0 recusado | UPDATE (service) para 0 → `23514`, mensagem contém `lojas_dia_inicio_ciclo_check` |
| T354-03 | 29 recusado | idem |
| T354-04 | limites | 1 e 28 aceitos |
| T354-05 | NULL | `23502` |
| T354-06 | dono grava | `asUser(DONO_A)` `update lojas set dia_inicio_ciclo = 5 where id = A` → `affectedRows 1`; leitura = 5 |
| T354-07 | outro dono | `asUser(DONO_B)` no mesmo UPDATE em A → `affectedRows 0`; A segue com o valor anterior |
| T354-08 | não abre billing | `asUser(DONO_A)` `set dia_inicio_ciclo = 7, assinatura_status = 'ativa'` → erro do trigger de billing; `dia_inicio_ciclo` não muda |
| T354-09 | fora da vitrine | `information_schema.columns` de `vitrine_lojas` não tem `dia_inicio_ciclo` |

### 8.3 `tests/migrations/vendas_funcoes_faturamento.test.ts` (355: `vendas_por_dia`, status, segurança)
Fixture (SP, salvo indicação): DONO_X com loja X; DONO_Y com loja Y; DONO_X também cliente (criar a loja X
**antes** de `criar_perfil_cliente(DONO_X, …)`) com 2 pedidos `entregue` em Y; loja M (`timezone =
'America/Manaus'`). Janela padrão do dia `2026-10-06` local SP: `[2026-10-06T03:00Z, 2026-10-07T03:00Z)`. Cada RN
numa loja ou dia próprio. Helper `porDia(quem, loja, inicio, fim, tipo?, concluidos?)`.

| ID | Caso | Asserção |
|---|---|---|
| T355-01 | status_faturamento | `status_faturamento(false)` = `{confirmado,em_preparo,saiu_entrega,entregue}`; `(true)` = `{entregue}`; `(null)` = `null` |
| T355-02 | RN-V01 | entregue 50, em_preparo 30, pendente 20, cancelado 40 (retirada, desconto 0) → `bruto 80`, `qtd_pedidos 2` |
| T355-03 | RN-V02 | mesmo conjunto, `p_so_concluidos = true` → `bruto 50`, `qtd_pedidos 1` |
| T355-04 | RN-V03 | subtotal 100, desconto 10, taxa 8, total 98, entregue → `bruto 100, descontos 10, liquido 90, frete 8` |
| T355-05 | RN-V05 | A (50, taxa 5, total 55) + B (30, `frete_a_combinar true`, taxa NULL, total 30) → `bruto 80, liquido 80, frete 5, qtd_frete_a_combinar 1` |
| T355-06 | RN-V05 registro posterior | `update` (postgres) de B para `frete_a_combinar false, taxa 7, total 37` → `frete 12, qtd_frete_a_combinar 0` |
| T355-07 | RN-V04 (D8) | fixture mista da loja (inclui a combinar e um pedido subtotal 20 desconto 25 total 0 → líquido 0): Σ`liquido` + Σ`frete` = `select sum(total) from pedidos` com o mesmo filtro |
| T355-08 | RN-V06 SP | pedido `2026-10-06T02:30Z` → linha `dia = '2026-10-05'` |
| T355-09 | RN-V06 Manaus | `2026-10-06T03:30Z` → `'2026-10-05'`; `2026-10-06T04:30Z` → `'2026-10-06'` |
| T355-10 | RN-V10 | entrega 60 + retirada 20 → `'entrega'` 60, `'retirada'` 20, NULL 80 |
| T355-11 | tipo inválido | `p_tipo_entrega = 'x'` → `22023` + `tipo_entrega inválido` |
| T355-12 | faixa | `p_inicio` NULL → `22023` + `faixa obrigatória`; `p_fim = p_inicio` → `faixa invertida`; 368 dias → `faixa acima do teto`; 367 dias exatos → aceito; `p_loja_id` NULL → `loja obrigatória`; `p_so_concluidos` NULL → `so_concluidos obrigatório` |
| T355-13 | dono vê a própria | `asUser(DONO_X)` em X → linhas iguais às de `asService` em X |
| T355-14 | vetor real (anti-falso-verde) | `asUser(DONO_X)` `select count(*) from pedidos where loja_id = Y` → `2` (a RLS sozinha vazaria) |
| T355-15 | RN-V21 lojista-cliente | `asUser(DONO_X)` `vendas_por_dia(Y, …)` → `42501` + `sem posse da loja` |
| T355-16 | outro dono | `asUser(DONO_Y)` em X → `42501` + `sem posse da loja` |
| T355-17 | claim forjado | sessão `set local role authenticated` + claims `{sub: DONO_Y, role: 'service_role'}` em X → `42501` + `sem posse da loja` (molde `rpc_salvar_faixas_entrega.test.ts:314`) |
| T355-18 | sem JWT | `t.db` (postgres, sem claims) em X → `42501` + `sem posse da loja` |
| T355-19 | anon | `asAnon` → `42501` + `permission denied for function` |
| T355-20 | service | `asService` em X → linhas; em uuid inexistente → `[]` |
| T355-21 | ACL e segurança | para `status_faturamento`, `vendas_preparar_consulta`, `vendas_por_dia`, `vendas_itens_por_categoria`: anon `false`, authenticated `true`, service_role `true`; as três `vendas_*` com `prosecdef = false` e `proconfig` contendo `search_path=public, pg_temp` |

### 8.4 `tests/migrations/vendas_itens_por_categoria.test.ts` (355)
Fixture própria (loja Z, SP); itens com snapshot gravado direto (`categoria_id_snapshot`/`nome`); opcionais em
`itens_pedido_opcionais`.

| ID | Caso | Asserção |
|---|---|---|
| T355-30 | RN-V16 linha | "X-Burger" preco 20 × 2 + opcional bacon 3 × 1 → `valor_bruto 43` (não 46), `quantidade 2` |
| T355-31 | RN-V16 pedido | o mesmo pedido com subtotal 43, desconto 10, total 33 → itens `43`; `vendas_por_dia` `bruto 43`, `liquido 33` |
| T355-32 | paridade TS | linhas `[{preco 4.35, qtd 3, op [{0.1×3},{1.15×7}]}, {preco 0.1, qtd 3}, {preco 19.99, qtd 7, op [{2.5×2}]}]`, um nome por linha → `valor_bruto` de cada = `totalDaLinha({preco, quantidade, opcionais})` (import de `@/lib/utils/calcularTotal`) |
| T355-33 | Σ = bruto | pedido com `subtotal = calcularSubtotal(itens)` → Σ `valor_bruto` = `bruto` de `vendas_por_dia` |
| T355-34 | Sem categoria | item com snapshot NULL → linha com `categoria_id` NULL e `categoria_nome` NULL, ordenada por último |
| T355-35 | Coca congelada | pedido em `2026-03-10` com snapshot 'Bebidas' + pedido em `2026-04-10` com 'Refrigerantes' → janela de março só `'Bebidas'`; abril só `'Refrigerantes'` |
| T355-36 | agregação por categoria | dois itens da mesma categoria → `categoria_quantidade` e `categoria_valor_bruto` = soma dos dois em ambas as linhas |
| T355-37 | status e tipo | item de pedido cancelado não aparece; `p_so_concluidos` e `p_tipo_entrega` filtram como em `vendas_por_dia` |
| T355-38 | RN-V21 | `asUser(DONO_X)` com `p_loja_id = Y` → `42501` + `sem posse da loja`; `asAnon` → `permission denied for function` |

### 8.5 `tests/migrations/ranking_clientes_fieis.test.ts` (356)
Fixture: LX dono de X; LY dono de Y; clientes por `criar_perfil_cliente` (molde
`clientes_base_do_lojista_escopo.test.ts:66-75`), pedidos direto com `criado_em` em `2026-10-0x`.
Helper `ranking(quem, args)` e `convidados(quem, args)`; `p_fim = '2026-10-08T03:00Z'` salvo indicação.

| ID | Caso | Asserção |
|---|---|---|
| T356-01 | RN-V17 | em X: A com 3 pedidos (confirmado, em_preparo, entregue), 2 pedidos `cliente_id` NULL, 1 pedido `entregue` do cliente C_ANON depois anonimizado (`select public.anonimizar_cliente(C_ANON)` via `asService`, molde `tests/migrations/anonimizar_cliente.test.ts`; o pedido é `entregue`, então não cai em `pedido_em_aberto`) → ranking = `[A]` com `total_pedidos 3`; `pedidos_convidados_da_loja` = `3` |
| T356-02 | RN-V19 padrão | loja W: A 5 pedidos de 20 (total 100), B 2 de 150 (total 300) → `p_ordem 'pedidos'` → `[A, B]` |
| T356-03 | ordem total | → `[B, A]` |
| T356-04 | ordem último | último pedido de B mais recente → `'ultimo'` → `[B, A]`; `ultimo_pedido_em` = max |
| T356-05 | status | A também tem 1 `pendente` de 500 e 1 `cancelado` de 500 → A segue `total_pedidos 5`, `total_gasto 100` |
| T356-06 | corte depois de ordenar | loja V: clientes 1..5 com 3 pedidos de R$1 cada; clientes 6..25 com 1 pedido de `100 + k` → `p_ordem 'total', p_limite 20` devolve exatamente os 20 clientes 6..25, totais desc de 125 a 106, nenhum de 1..5 |
| T356-07 | itens_top | A comprou Coca 5, X-Burger 3, Batata 2, Suco 1 (somados entre pedidos) + Coca 10 num pedido cancelado → `itens_top` = `[{nome:'Coca',quantidade:5},{nome:'X-Burger',quantidade:3},{nome:'Batata',quantidade:2}]` |
| T356-08 | período | pedido de A em `2020-01-01`: `p_inicio` NULL conta; `p_inicio = '2026-10-01T03:00Z'` não conta |
| T356-09 | RN-V20 allowlist | `Object.keys(linha).sort()` = `['cliente_id','itens_top','nome','total_gasto','total_pedidos','ultimo_pedido_em']`; `pg_get_function_result` não contém `telefone` nem `email` |
| T356-10 | RN-V21 escopo | cliente que só comprou em Y não aparece no ranking de LX; LX (que é cliente em Y) não vê dados de Y |
| T356-11 | service | `asService` → ranking `[]`, convidados `0` |
| T356-12 | anon | `asAnon` → `42501` + `permission denied for function` (ranking e convidados) |
| T356-13 | 22023 | `p_ordem 'nome'` → `p_ordem inválido`; `p_limite 21` e `0` → `p_limite fora de 1..20`; `p_fim` NULL → `p_fim obrigatório`; `p_fim <= p_inicio` → `faixa invertida` (ranking e convidados) |
| T356-14 | fonte única | texto de `20261007125000_ranking_clientes_fieis.sql` sem comentários não casa `/'em_preparo'/` e casa `public.status_faturamento` |
| T356-15 | definer | `prosecdef = true`, `proconfig = {search_path=""}` nas duas; anon `false`, authenticated `true` |

### 8.6 Unit TS

**`src/lib/supabase/queries/vendas.test.ts`** (357, GREEN na fatia A) — fake client que captura `rpc(nome, args)`
(molde `clientes.test.ts`):
- `buscarVendasPorDia(c, {lojaId: L, inicio: I, fim: F, tipoEntrega: "ambos", soConcluidos: false})` → `rpc("vendas_por_dia", {p_loja_id: L, p_inicio: I, p_fim: F, p_so_concluidos: false})` e `"p_tipo_entrega" in args === false`.
- `tipoEntrega: "entrega"` → `p_tipo_entrega: "entrega"`; idem `buscarItensPorCategoria` → `"vendas_itens_por_categoria"`.
- `buscarRankingClientes(c, {inicio: null, fim: F, ordem: "total", limite: 20})` → `{p_fim: F, p_ordem: "total", p_limite: 20}` sem `p_inicio`; com `inicio` → inclui.
- `contarPedidosConvidados` → `rpc("pedidos_convidados_da_loja", …)`, `data: 3` → `3`.
- `error` → a função rejeita com o mesmo objeto de erro.

**`src/lib/validacoes/vendas.test.ts`** (354 + 357):
- ciclo: `{dia_inicio_ciclo: 5}` ok; `0`, `29`, `5.5`, `"5"`, `null`, `{}`, `{dia_inicio_ciclo: 5, loja_id: "x"}` recusados.
- `lerParamsVendas({})` → `FILTROS_PADRAO`, `RANKING_PADRAO`, avisos `false`.
- `periodo=semana` → `semana`; `periodo=xyz` → `mes` + `avisoFiltros`.
- personalizado `de=2026-01-01&ate=2027-01-01` (366) aceito; `ate=2027-01-02` (367) → `mes` + aviso; `de > ate` → aviso; `de=2026-02-30` → aviso; sem `ate` → aviso.
- `entrega=retirada` ok; `entrega=x` → `ambos` + aviso; `entrega=["a","b"]` → aviso.
- `concluidos=1` → `true`; ausente → `false` sem aviso; `concluidos=true` → `false` + aviso.
- `ranking=tudo&ordem=ultimo` ok; `ranking=dia` → `mes` + `avisoRanking` e `avisoFiltros === false`.
- `hrefVendas("/painel/vendas", FILTROS_PADRAO, RANKING_PADRAO)` = `"/painel/vendas"`; round-trip `lerParamsVendas(parse(hrefVendas(b, f, r)))` devolve `f` e `r` para 6 combinações; mudar só o ranking não altera `filtros` e vice-versa (RN-V18).

**`src/lib/utils/periodoVendas.test.ts`** (357) — `SP = "America/Sao_Paulo"`, `MAO = "America/Manaus"`,
`A = new Date("2026-10-07T15:00:00Z")` (quarta):
- `hoje` em A → janela `inicio "2026-10-07T03:00:00.000Z"`, `fim "2026-10-08T03:00:00.000Z"`.
- RN-V11 `semana` em A → `2026-10-05..2026-10-11`, `inicio "2026-10-05T03:00:00.000Z"`, `fim "2026-10-12T03:00:00.000Z"`.
- RN-V07 dia 5 em A → `mes` `2026-10-05..2026-11-04`, rótulo `"05/out a 04/nov"`, `fim "2026-11-05T03:00:00.000Z"`; `mes_anterior` → `"05/set a 04/out"`.
- dia 5 em `2026-10-03T15:00Z` → `"05/set a 04/out"`; dia 1 em A → `"01/out a 31/out"`.
- virada de ano: dia 5 em `2027-01-03T15:00Z` → `"05/dez/2026 a 04/jan/2027"`; `mes_anterior` → `"05/nov a 04/dez"`.
- dia 28 em `2026-03-10T15:00Z` → `2026-02-28..2026-03-27`; dia 28 em `2026-02-27T15:00Z` → `2026-01-28..2026-02-27`.
- `ano` em A → `inicio "2026-01-01T03:00:00.000Z"`, `fim "2027-01-01T03:00:00.000Z"`.
- RN-V06 limites: agora `2026-10-05T01:00:00Z` → `hoje` = `2026-10-04`, janela `[2026-10-04T03:00Z, 2026-10-05T03:00Z)` contém `2026-10-05T02:30Z`; a janela de `semana` em A não contém esse instante.
- Manaus: `hoje` em A → `inicio "2026-10-07T04:00:00.000Z"`.
- `inicioDaSemanaIso`: `2026-10-04` → `2026-09-28`; `2026-10-05` → `2026-10-05`; `2026-12-31` → `2026-12-28`; `2027-01-03` → `2026-12-28`.
- `diasInclusivos("2026-01-01","2027-01-01")` = 366; `("2026-01-01","2027-01-02")` = 367.
- `ehDiaLocalValido`: `2026-02-29` false, `2028-02-29` true, `2026-13-01` false, `2026-1-01` false.
- RN-V18 `janelaDoRanking` em A, dia 5: `tudo` → `inicio null`, `fim "2026-10-08T03:00:00.000Z"`; `semana` → `inicio "2026-10-05T03:00:00.000Z"`; `mes` → `inicio "2026-10-05T03:00:00.000Z"`, `fim "2026-11-05T03:00:00.000Z"`; `ano` → `inicio "2026-01-01T03:00:00.000Z"`.

**`src/lib/utils/agregarVendas.test.ts`** (357):
- `preencherDias` de `2026-09-28..2026-10-11` com 3 linhas → 14 linhas, ausentes zeradas; linha fora do intervalo → lança.
- RN-V11 rollup: linhas em `2026-10-04` e `2026-10-05` → semanas de chave `2026-09-28` (rótulo `"28/set a 04/out"`) e `2026-10-05`.
- ciclo dia 5: `2026-10-04` → chave `2026-09-05` (`"05/set a 04/out"`); `2026-10-05` → `2026-10-05` (`"05/out a 04/nov"`).
- RN-V12 propriedade: fixture de 14 dias com centavos (`10.1`, `0.2`, `33.33`, `0.07`…) → em cada métrica (`pedidos, bruto, descontos, liquido, frete, freteACombinar`) Σ diário = Σ semanal = Σ ciclo = `somarLinhas(diárias)`, com `toBe` exato.
- `agruparItensPorCategoria`: categoria NULL vira `"Sem categoria"`, fica por último, ordem do SQL preservada, totais da categoria = colunas de janela.

**`src/lib/vendas/carregarRelatorioVendas.test.ts`** (357) — mock de `@/lib/supabase/queries/vendas`:
- loja `{id: L, timezone: SP, dia_inicio_ciclo: 5}`, `{...FILTROS_PADRAO, periodo: "semana"}`, A → as duas buscas recebem `{lojaId: L, inicio: "2026-10-05T03:00:00.000Z", fim: "2026-10-12T03:00:00.000Z", tipoEntrega: "ambos", soConcluidos: false}`.
- `entrega: "entrega", concluidos: true` repassados.
- `barras.diario.length === 7`; `totais` = Σ linhas mockadas; `contexto.cicloAtual.rotulo === "05/out a 04/nov"`.
- busca rejeita `{code: "42501", message: "vendas: sem posse da loja"}` → `{ ok: false }`; `JSON.stringify(resultado)` não contém `"sem posse"`; `console.error` chamado com `"[vendas] carregar relatório"` e `"42501"`.
- timezone inválido (`"Nao/Existe"`) → `{ ok: false }`, sem lançar.
- nunca chama `buscarRankingClientes`/`contarPedidosConvidados`.

**`src/lib/vendas/carregarRankingClientes.test.ts`** (357):
- `{periodo: "tudo", ordem: "total"}` em A → `buscarRankingClientes` com `{inicio: null, fim: "2026-10-08T03:00:00.000Z", ordem: "total", limite: 20}`; `contarPedidosConvidados` com `{inicio: null, fim: …}`.
- linhas `[B, A]` → `clientes` `[B, A]` (não reordena).
- `itens_top` inválido (`{x: 1}`) → `itensTop: []`.
- erro → `{ ok: false }`.

**`src/app/admin/assinantes/[lojaId]/carga-vendas.test.ts`** (357) — molde `carga-pedidos.test.ts` (mocks de
`verificarAdminSaaS`, `createServiceClient`, `notFound`, `buscarLojaAdminPorId`, `carregarRelatorioVendas`;
`validarLojaIdAdmin` real):
- `lojaId = "x"` → lança `NEXT_NOT_FOUND`; `verificarAdminSaaS`, `createServiceClient` e a montagem não chamados.
- `verificarAdminSaaS` rejeita → propaga; `createServiceClient` não chamado.
- ordem `verificarAdminSaaS` → `createServiceClient` → `buscarLojaAdminPorId(svc, LOJA_ID)`.
- loja null → `NEXT_NOT_FOUND`.
- feliz → `carregarRelatorioVendas(svc, loja, filtros, agora)` com `loja.id === LOJA_ID` (nunca `OUTRA_LOJA`).
- `vi.mock("@/lib/vendas/carregarRankingClientes")` com spy não chamado **e** o texto de `carga-vendas.ts` não contém `ranking`.

**`src/lib/actions/patches-loja.ciclo.test.ts`** (354): `montarPatchCiclo({dia_inicio_ciclo: 7, ...hostil} as never)`
com `assinatura_status`, `dono_id`, `id` → `toEqual({ dia_inicio_ciclo: 7 })` (chaves exatas).

**`src/lib/actions/vendas.test.ts`** (354) — mocks de `@/lib/supabase/server`, `@/lib/supabase/queries/lojas`,
`next/cache` (molde `entrega.modalidades.test.ts`):
- `{dia_inicio_ciclo: 29}` → `{ok:false, erro:"Escolha um dia entre 1 e 28."}`; `createClient` não chamado.
- `{dia_inicio_ciclo: 5, loja_id: OUTRA}` → recusado, sem `update`.
- `buscarLojaDoDono` null → `{ok:false}` genérico, sem `update`.
- feliz → `from("lojas").update({dia_inicio_ciclo: 5}, {count: "exact"}).eq("id", LOJA_DA_SESSAO)`; `revalidatePath("/painel/vendas")`.
- `count: 0` → `{ok:false}` genérico; `error: {code:"42501", message:"x"}` → `{ok:false}` e o resultado não contém `"x"`.

**`src/app/admin/assinantes/actions/admin-vendas.test.ts`** (354) — molde `admin-entrega.test.ts`
(`prepararContextoAdmin` real, `verificarAdminSaaS`/`createServiceClient` mockados, fake que captura
`from/update/eq` e o insert em `admin_acessos`):
- `lojaId "x"` → `{ok:false, erro:"Loja inválida."}`; nenhum guard/service.
- payload inválido (`0`, `"5"`, chave extra `assinatura_status`) → `{ok:false}`; `verificarAdminSaaS` não chamado.
- `verificarAdminSaaS` rejeita → a action rejeita; `createServiceClient` não chamado.
- feliz → `update({dia_inicio_ciclo: 5}, {count:"exact"})` + `.eq("id", LOJA_ALVO)`; insert em `admin_acessos` com `acao: "salvar_ciclo_vendas"`; `revalidatePath("/admin/assinantes/<LOJA_ALVO>/vendas")`.
- `count: 0` → `{ok:false}` genérico.

**`src/app/admin/assinantes/actions/admin-vendas.paridade.test.ts`** (354): para o mesmo payload válido, o patch
capturado no UPDATE do lojista e no do admin é `toEqual` e igual a `{dia_inicio_ciclo: 5}`; os mesmos 4 payloads
inválidos são recusados pelos dois.

Testes da 358 (não crítica, escritos pela fatia B, §9.B): não fazem parte do RED.

---

## 9. Ordem de Implementação

### 9.RED — `tdd`
Escreve os arquivos de §8.1–§8.6, roda cada um, cola o `FAIL` real nas issues 353–357 e para. Nenhum arquivo de
produção.

### 9.A — `executar` (banco)
1. A1 → B → A2 → C → D1 → D2 (§6.1–§6.6), nesta ordem (D9; D1 antes de D2 porque o ranking chama
   `status_faturamento`). Depois de cada migration: `npx vitest run tests/migrations/<arquivo RED dela>`.
2. `src/lib/vendas/tipos.ts` (§7.1) e `src/lib/supabase/queries/vendas.ts` (§7.2).
3. Patch de `src/lib/database.types.ts` (§6.7) + `dia_inicio_ciclo: 1` nos três fixtures.
4. Gate: `npx vitest run tests/migrations` verde (inclui toda a família `rpc_criar_pedido*`, `rpc_pedido_e2e`,
   `rpc_idempotencia_*`, `pentest_area2_isolamento`); `npx vitest run src/lib/supabase/queries` verde;
   `npx tsc --noEmit` só com erros de módulo inexistente dos testes RED da fatia B.

### 9.push — sessão (autorização do usuário: irreversível)
`npx supabase migration list` (exatamente as 6 novas sem Remote) → `npx supabase db push` → `migration list` com
Remote preenchido → `npx supabase gen types typescript > src/lib/database.types.ts` → `git diff
src/lib/database.types.ts` (esperado: vazio ou só ordem; qualquer diferença de tipo vira correção do patch) →
`npx tsc --noEmit`. O checkout não fica indisponível em momento nenhum (assinatura da RPC e payload iguais).

### 9.B — `executar` (TS + UI)
1. 354: `montarPatchCiclo`, `lib/validacoes/vendas.ts` (schema do ciclo), `lib/actions/vendas.ts`,
   `actions/admin-vendas.ts` → RED §8.6 da 354 verde.
2. 357: `periodoVendas.ts` → `agregarVendas.ts` → restante de `validacoes/vendas.ts` → `carregarRelatorioVendas.ts`
   → `carregarRankingClientes.ts` → `carga-vendas.ts` → RED §8.6 da 357 verde.
3. 358: `NavPainel.tsx` → componentes de `components/painel/vendas/` → `RelatorioVendas.tsx` →
   `RankingClientesFieis.tsx` → as duas pages. Testes da 358 (`renderToStaticMarkup`, environment node):
   - `NavPainel.test.tsx` (+ describe "item Vendas"): nas duas bases, `hrefs[iDashboard + 1]` é `${base}/vendas`;
     ativo em `${base}/vendas`; com o `rotasAusentes` real do layout admin o item continua; aparece no Sheet.
   - `src/components/painel/RelatorioVendas.test.tsx`: os dois avisos com o texto exato; resumo formatado; frete a
     combinar singular/plural; estado de falha mostra só a mensagem genérica; hrefs dos presets preservam
     `entrega`/`concluidos`/ranking; aviso de filtro inválido.
   - `src/components/painel/vendas/BarrasVendas.test.tsx`: `aria-label="05/out: R$ 120,00"` por barra, classe
     `bg-primary`, nunca `bg-chart-1`, valor em texto (visível ≤ 14, `sr-only` acima); semanal e mensal com os
     rótulos de §8.6.
   - `src/components/painel/RankingClientesFieis.test.tsx`: linhas na ordem recebida; "3 pedidos de convidados
     fora do ranking" / "1 pedido de convidado fora do ranking"; markup sem `telefone`/`email`/`@`.
   - `src/app/admin/assinantes/[lojaId]/vendas/page.test.tsx`: texto do arquivo não importa
     `RankingClientesFieis` nem `carregarRankingClientes`; render com loader mockado; `layout.tsx` segue com
     `"clientes"` e sem `"vendas"` em `rotasAusentes`.
4. Gate: `npx tsc --noEmit` → `npm run lint` → `npx vitest run --maxWorkers=2` → `npm run build`;
   `git diff --stat package.json package-lock.json` vazio (RN-V24).

---

## 10. Arquivos

### Criar
- `supabase/migrations/20261007120000_itens_pedido_categoria_snapshot.sql`
- `supabase/migrations/20261007121000_rpc_criar_pedido_categoria_snapshot.sql`
- `supabase/migrations/20261007122000_itens_pedido_categoria_backfill.sql`
- `supabase/migrations/20261007123000_lojas_dia_inicio_ciclo.sql`
- `supabase/migrations/20261007124000_relatorio_vendas_funcoes.sql`
- `supabase/migrations/20261007125000_ranking_clientes_fieis.sql`
- `src/lib/vendas/tipos.ts`
- `src/lib/supabase/queries/vendas.ts`
- `src/lib/utils/periodoVendas.ts`
- `src/lib/utils/agregarVendas.ts`
- `src/lib/validacoes/vendas.ts`
- `src/lib/vendas/carregarRelatorioVendas.ts`
- `src/lib/vendas/carregarRankingClientes.ts`
- `src/lib/actions/vendas.ts`
- `src/app/admin/assinantes/actions/admin-vendas.ts`
- `src/app/admin/assinantes/[lojaId]/carga-vendas.ts`
- `src/app/(painel)/painel/(bloqueavel)/vendas/page.tsx`
- `src/app/admin/assinantes/[lojaId]/vendas/page.tsx`
- `src/components/painel/RelatorioVendas.tsx`
- `src/components/painel/RankingClientesFieis.tsx`
- `src/components/painel/vendas/FiltrosVendas.tsx`
- `src/components/painel/vendas/CicloMensal.tsx`
- `src/components/painel/vendas/ResumoFaturamento.tsx`
- `src/components/painel/vendas/GraficoBarrasVendas.tsx`
- `src/components/painel/vendas/BarrasVendas.tsx`
- `src/components/painel/vendas/ItensPorCategoria.tsx`
- testes: os 16 de §8 + os 4 novos de §9.B.3

### Modificar
- `src/lib/database.types.ts` — patch §6.7 (depois substituído pelo `gen types`)
- `src/lib/actions/patches-loja.ts` — `montarPatchCiclo`
- `src/components/painel/NavPainel.tsx` — item Vendas
- `src/components/painel/NavPainel.test.tsx` — describe "item Vendas"
- `src/lib/utils/manifestPainel.test.ts`, `src/app/(painel)/painel/manifest.webmanifest/route.test.ts`,
  `src/lib/actions/assinatura.test.ts` — `dia_inicio_ciclo: 1` no fixture

### NÃO tocar
| Arquivo | Motivo |
|---|---|
| `src/lib/utils/metricasPedidos.ts` | Dashboard fica com o fuso cravado (spec, fora de escopo) |
| `src/lib/supabase/queries/pedidos.ts` (`listarPedidosDoDono`) | sem faixa de data; proibido para agregação |
| `src/types/supabase.ts` | morto (`CLAUDE.md`) |
| `src/lib/actions/pedido.ts` | payload do checkout não muda (RN-V14) |
| `supabase/migrations/20261003122000_rpc_criar_pedido_cliente.sql` e qualquer migration existente | migration aplicada não se edita |
| `src/lib/actions/admin-loja.ts` (`CAMPOS_LOJA_SOMENTE_SERVIDOR`) | ciclo não é billing; entrar na blocklist quebraria o admin |
| trigger `lojas_protege_billing`, view `vitrine_lojas` | coluna nova fica fora dos dois |
| `src/app/admin/assinantes/[lojaId]/layout.tsx` | a rota admin existe; `rotasAusentes` não muda |
| `src/components/ui/*` | gerado pelo shadcn CLI |
| `src/components/painel/DashboardLoja.tsx` | Dashboard fora de escopo |
| `references/*`, `supabase/seed.sql` | `escriba` e `popular` (colunas novas têm default/nullable) |
| `tasks/359-*` | fora deste plano |

---

## 11. Dependências Externas

Nenhuma. `package.json` não muda (RN-V24): gráfico em CSS, datas por `Intl` via `fusoLoja.ts`, zod e
lucide-react já instalados. **Custo e quota:** nenhuma API paga; as consultas são do Postgres do Supabase já
contratado, com faixa obrigatória (≤ 367 dias) e índices existentes. O pior caso é o preset "este ano" de uma
loja grande: uma varredura por `pedidos(loja_id, criado_em)` e os itens desses pedidos, sem custo variável. Não
há comportamento de estouro a definir.

---

## 12. Divergências e riscos

### Divergências do spec/issues (decididas aqui)
1. **D2:** posse alheia nas financeiras recusa com `42501 'vendas: sem posse da loja'`, não "zero linhas".
2. **D8:** RN-V04 reescrita: Σ líquido + Σ frete = Σ `total` do conjunto inteiro.
3. **D11:** `CicloMensal` sem `react-hook-form` (sem resolvers; molde `ModalidadesEntrega`).
4. **D12:** `salvarCiclo`/`baseVendas` obrigatórios no `RelatorioVendas` (sem default de lojista).
5. **D10:** filtros por `<Link>`/form GET em vez de `ToggleGroup` + `useRouter`.
6. Ordem da action admin: zod **antes** de `prepararContextoAdmin` (a issue 354 lista o contrário); é o molde
   `salvarModalidadesEntregaAdmin` e não eleva a `service_role` com payload inválido.

### Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Regressão no checkout ao republicar `criar_pedido` | cópia literal travada por T353-15 (`prosrc` × arquivo antigo) + suíte `rpc_*` inteira verde sem edição + T353-14 (assinatura/ACL) |
| Pedido criado na janela do push sem snapshot | ordem A1 → B → A2; backfill só em NULL (D9) |
| Lojista-cliente agrega loja alheia | T2 no helper + T355-14/15 (vetor provado e fechado) |
| Função nova executável por anon (default privileges) | `REVOKE … FROM public, anon` + T355-19/21, T356-12/15 |
| Tipos gerados divergem do patch | diff obrigatório no passo push; D16 cobre a nullability que o gerador não expressa |
| Fixture de teste quebra no tsc pelo campo novo em `lojas` | três arquivos já listados; tsc logo após o patch |
| Divergência de centavo itens × bruto | D7: nenhuma tela soma itens como faturamento; prova numérica nesta sessão; T355-32/33 |
| Muitas barras no "este ano" | container `overflow-x-auto` dentro do card; a página não rola na horizontal |
| `lojas.timezone` inválido | erro capturado na montagem → mensagem genérica |

### Estimativa
Complexidade **alta**: republica a RPC de checkout, 6 migrations com `db push`, 6 funções novas com duas
variantes de segurança, dois mundos e ~26 arquivos novos.

---

## 13. Checklist de Validação Pós-Implementação
- [ ] `npm run build` sem warnings novos; nenhum `'use server'` exportando const
- [ ] `npx vitest run tests/migrations` verde, incluindo `rpc_criar_pedido*`, `rpc_pedido_e2e`, `rpc_idempotencia_*`
- [ ] RLS/posse: lojista de X recebe `42501` em Y nas financeiras; ranking de X não mostra cliente só de Y; anon recebe `permission denied`
- [ ] Nenhum valor vem do cliente: filtros revalidados por zod; status fixado em `status_faturamento`
- [ ] Payload forjado de categoria ignorado pela RPC (T353-08/09)
- [ ] Admin: `validarLojaIdAdmin` → `verificarAdminSaaS` → `createServiceClient` em `carga-vendas.ts` e `admin-vendas.ts`; `enforcement-escopo-admin.test.ts` verde
- [ ] Sem telefone/e-mail no ranking; admin não importa o ranking
- [ ] `npx supabase migration list` com as 6 migrations no Remote antes do deploy do código da fatia B
- [ ] `package.json` inalterado; sem secret no client; nenhum dado pessoal real em fixture
