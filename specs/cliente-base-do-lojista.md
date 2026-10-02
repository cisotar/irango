# Spec: Base de clientes do lojista (lista, detalhe, aniversariantes do mês)

**Versão:** 0.1.0 | **Atualizado:** 2026-10-02

> Origem: passo P36 de `plan/loop-cadastro-de-clientes.md` (Marco D). Depende dos Marcos B e C já em produção:
> `specs/cliente-identidade.md` (tabela `clientes`, migration `20261002120000_clientes.sql`) e
> `specs/cliente-vinculo-pedido.md` (`pedidos.cliente_id`, migration `20261003120000_pedidos_cliente_id.sql`).
> As decisões 1–22 e as alterações 23–27 do plano são restrições e não são rediscutidas aqui. Este spec aplica
> literalmente as decisões 2, 3, 5 (só dados), 11 e 20.
> Linhas marcadas **[aprovado pelo usuário, 2026-10-03]** são escolhas que o P36 delegou a este spec: uma opção e o motivo.
> Dúvidas que o plano não delega estão em `## Perguntas ao usuário`.

## Visão Geral

O lojista passa a ver, no painel, quem são os clientes com conta iRango que já compraram na loja dele: uma lista
com nome, telefone, quantidade de pedidos, data do último pedido, aniversário (dia/mês) e se aceita receber
promoções; um detalhe por cliente com esses dados e o histórico de pedidos **daquela loja**; e um filtro
"Aniversariantes do mês". É a base de dados para promoções futuras (decisão 5). O envio de promoção não faz parte
desta entrega.

Mundo: **painel** (`/painel/*`, auth obrigatório, guard no layout — `architecture.md` §5).

Hoje a RLS de `clientes` só deixa cada cliente ler a própria linha (`schema.md`, "Lojista e anon não leem"). Esta
feature abre ao lojista uma **projeção mínima** dessa tabela, só para clientes que pediram na loja dele, sem
ampliar a RLS da tabela.

## Atores Envolvidos

| Ator | Papel nesta feature |
|---|---|
| **Lojista** | Vê a lista e o detalhe dos clientes que têm ≥1 pedido com `cliente_id` na própria loja. Só leitura. |
| **Cliente** | Não interage. Os dados dele aparecem para uma loja só depois que ele faz um pedido logado nela (decisões 2 e 20). Quando exclui a conta ou é anonimizado, some da base de todas as lojas, porque `pedidos.cliente_id` vira null (decisão 3). |
| **iRango (SaaS)** | Garante o isolamento por loja no banco. O hub admin não ganha tela nova (fora do escopo). |

## Páginas e Rotas

### Clientes — `/painel/clientes`

**Mundo:** painel (auth obrigatório, lojista). Arquivo: `src/app/(painel)/painel/(bloqueavel)/clientes/page.tsx`,
no mesmo grupo `(bloqueavel)` de `/painel/pedidos` (loja com assinatura bloqueada não acessa, como as demais telas
de gestão).

**Descrição:** Server Component no padrão de `pedidos/page.tsx`: cria o client da sessão, chama
`buscarLojaDoDono` (sem loja → `redirect("/painel")`) e lê a base por `listarClientesDaLoja`. Um componente cliente
(`ClientesClient.tsx`) recebe as linhas já projetadas e cuida só de exibição e do link de filtro.
Ordem: último pedido mais recente primeiro.

Colunas exibidas (ver allowlist em Modelos de Dados): **Nome** (link para o detalhe) · **Telefone** · **Pedidos** ·
**Último pedido** (data no fuso da loja) · **Aniversário** (`dd/mm`) · **Promoções** ("Aceita" / "Não aceita").

**Componentes:**
- `CabecalhoPagina` (`components/painel/CabecalhoPagina.tsx`, reuso) — título "Clientes", `voltarHref="/painel"`.
- `Card`/`CardContent` (`components/ui/card`, shadcn, reuso) — a tabela vive dentro de card (`design-system.md` §10.2 regra 4).
- `Table` do shadcn (`components/ui/table`) se já existir em `components/ui/`; senão, a mesma marcação de
  `TabelaPedidos`. Não criar primitivo à mão em `components/ui/` (gerado pelo CLI).
- `Button` (shadcn, reuso) — filtro "Aniversariantes do mês" / "Todos" e "Carregar mais".
- `TabelaClientes` (novo, `components/painel/TabelaClientes.tsx`) — só apresentação; espelha `TabelaPedidos`. Em
  telas estreitas vira lista de cards (responsividade de `design-system.md` §9).
- Empty state: "Nenhum cliente com conta pediu na sua loja ainda." e, com o filtro ligado, "Nenhum aniversariante
  neste mês." (`design-system.md` §6, empty states).
- Item "Clientes" na `NavPainel` (`components/painel/NavPainel.tsx`), ao lado de "Pedidos", ícone `Users` do lucide.

**Behaviors:**
- [x] Lojista abre `/painel/clientes` e vê só clientes com ≥1 pedido com `cliente_id` na própria loja. Comprador
  convidado (pedido com `cliente_id` null) não aparece, nem os antigos (decisão 20). Garantido em: **função no banco
  escopada por `auth.uid()` → loja do dono** (nunca `loja_id` do payload) + guard do layout.
- [x] Lojista A nunca vê cliente que só pediu na loja B. Garantido em: **função no banco** (filtro
  `pedidos.loja_id = loja do dono da sessão`) — teste RED em `tests/migrations/clientes_base_do_lojista_escopo.test.ts` (P40).
- [x] Cada linha traz só as colunas da allowlist; e-mail, senha, ano de nascimento, data de nascimento completa,
  endereços cadastrados, consentimento e `ultimo_acesso_em` nunca saem do banco. Garantido em: **retorno tipado da
  função** (`RETURNS TABLE` fechado) — teste de allowlist de colunas no mesmo arquivo de P40.
- [x] Visitante sem sessão em `/painel/clientes` → redirect 30x para `/login`. Garantido em: guard do layout do
  painel; e no banco `EXECUTE` revogado de `anon` (`asAnon` → erro/0 linhas).
- [x] Usuário logado sem loja (só cliente) → `redirect("/painel")`, que segue o fluxo de papel de hoje; a função
  devolve 0 linhas para quem não é dono de loja. Garantido em: Server Component + função no banco.
- [ ] Lojista clica em "Aniversariantes do mês" e a lista mostra só clientes cujo mês de nascimento é o mês corrente
  **no fuso da loja** (`lojas.timezone`). O estado do filtro vive na URL (`?aniversariantes=1`), validado com zod
  (qualquer outro valor = sem filtro). Garantido em: servidor (mês calculado no Server Component por função pura;
  o filtro é aplicado no SQL). Não é dado sensível: só restringe um conjunto já escopado.
  **[aprovado pelo usuário, 2026-10-03]** mês calculado no servidor, no fuso da loja, por função pura
  `mesDeReferencia(agora: Date, timezone: string): number` em `src/lib/utils/` (teste unitário D2 ao lado, conforme a
  tabela de risco), e passado como `p_mes` à função do banco. Motivo: a lista é paginada (abaixo), então filtrar no
  cliente sobre uma página mostraria aniversariantes incompletos; e "mês corrente" num servidor em UTC erra na
  virada do mês (noite de 31 em São Paulo já é dia 1 em UTC). O teste D2 sai de `queries/clientes.test.ts` para o
  teste da função pura; o arquivo de teste de queries cobre só o repasse de parâmetros.
- [x] Lojista clica em "Carregar mais" e recebe as próximas 50 linhas.
  **[aprovado pelo usuário, 2026-10-03]** paginação de 50 por página com "Carregar mais", mesmo padrão de
  `/minha-conta/pedidos` (`architecture.md`, 20 por página). Motivo: a base cresce sem teto e a lista é agregada;
  carregar tudo é o N+1/payload que o `acelerar` de P42 vai procurar. `p_limite` tem teto no banco (≤ 100) e no zod.
- [ ] Lojista clica no nome do cliente e vai para `/painel/clientes/[id]`. Garantido em: cliente (navegação); a
  autorização é do detalhe.

---

### Detalhe do cliente — `/painel/clientes/[id]`

**Mundo:** painel (auth obrigatório, lojista). Arquivo: `src/app/(painel)/painel/(bloqueavel)/clientes/[id]/page.tsx`.

**Descrição:** cabeçalho com os mesmos dados da linha da lista (nome, telefone, aniversário dia/mês, aceita
promoções, nº de pedidos, último pedido) e, abaixo, a lista dos pedidos **desse cliente nesta loja**, do mais recente
ao mais antigo: número/data, status, modalidade e total, cada um com link para o detalhe que já existe
(`/painel/pedidos/[id]`).

**Componentes:**
- `CabecalhoPagina` (reuso) — título = nome do cliente, `voltarHref="/painel/clientes"`.
- `Card`/`CardContent` (reuso) — bloco de dados do cliente.
- `TabelaPedidos` (`components/painel/TabelaPedidos.tsx`, reuso) com `paraLinhaPedido` (reuso) e
  `BadgeStatusPedido` (reuso, estático — esta tela não muda status; mudar status continua em `/painel/pedidos`).
- `notFound()` do Next para id inválido ou cliente fora da base da loja.

**Behaviors:**
- [ ] Lojista abre o detalhe de um cliente da própria base e vê os dados da allowlist. Garantido em: **função no
  banco** `cliente_da_loja(p_cliente_id)` escopada pela loja do dono da sessão.
- [ ] Lojista abre `/painel/clientes/<id>` de cliente que nunca pediu na loja dele (mesmo que tenha pedido em outra
  loja, ou que seja um `auth.users` qualquer) → 404, sem distinguir "não existe" de "não é seu" (anti-IDOR). Garantido
  em: **função no banco** (0 linhas) + `notFound()`.
- [ ] `[id]` que não é UUID → 404 sem bater no banco. Garantido em: `schemaUuid` (`src/lib/validacoes/`, reuso) no
  Server Component.
- [ ] A lista de pedidos do detalhe mostra só pedidos com `loja_id` da loja do dono e `cliente_id = [id]`. Garantido
  em: **RLS `pedidos_acesso_lojista`** (já existente; client da sessão, sem `service_role`) + filtro
  `.eq("cliente_id", id)`. Nenhum pedido do cliente em outra loja aparece (o cliente pode ler os dele por
  `pedidos_select_cliente`, mas o lojista não é esse cliente).
- [ ] Lojista que também é cliente abre o próprio cadastro na base da loja (comprou na própria loja, decisão 15) e
  vê os mesmos campos da allowlist, nada além. Garantido em: função no banco (mesma projeção para todos).
- [ ] Lojista clica em um pedido e vai para `/painel/pedidos/[id]` (tela e autorização existentes).

---

## Modelos de Dados

**Nenhuma tabela nova. Nenhuma coluna nova. Nenhuma policy nova em `clientes`.** A migration de P39
(`<ts>_clientes_da_loja.sql`) cria duas funções e um índice.

### Fonte: função escopada, não view

**[aprovado pelo usuário, 2026-10-03]** fonte = **funções `SECURITY DEFINER` que resolvem a loja pelo `auth.uid()`**, não
view `security_invoker`. Motivo:

1. Uma view `security_invoker = true` (`seguranca.md` §19) roda com a RLS de quem consulta. A RLS de `clientes` só
   libera a própria linha, então a view devolveria **0 linhas** ao lojista. Para funcionar seria preciso uma policy
   nova de SELECT em `clientes` para o lojista.
2. Essa policy abriria a **tabela inteira** ao papel `authenticated`. Policy filtra linhas, não colunas; o grant de
   coluna vale para o papel, não para a policy. O lojista passaria a ler, via PostgREST direto (`from("clientes")`),
   `data_nascimento` com ano, `consentimento_*` e `ultimo_acesso_em`, fora da allowlist. Restringir o grant de
   coluna quebraria o próprio cliente, que lê a linha dele inteira (`buscarPerfilCliente`).
3. A função com `RETURNS TABLE` fechado é a allowlist: a projeção é o tipo de retorno e o teste trava os nomes.
   O escopo vem de `lojas.dono_id = auth.uid()` dentro da função, sem parâmetro `loja_id`, o que cumpre "nunca
   `loja_id` do payload" no próprio contrato.
4. Uma view `security_invoker = false` (definer) não serve: não tem `auth.uid()` como filtro natural e seria a
   armadilha do §19.

Regras das duas funções (padrão das funções de `clientes` em `schema.md`): `SECURITY DEFINER`,
`SET search_path = ''`, nomes qualificados (`public.`), `STABLE`, `REVOKE EXECUTE ... FROM public, anon`,
`GRANT EXECUTE ... TO authenticated`. Sem `auth.uid()` → 0 linhas.

```sql
-- Loja do dono da sessão: mesma regra de buscarLojaDoDono (ver Pergunta P1).
public.clientes_da_loja(p_mes smallint DEFAULT NULL, p_limite int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (
  cliente_id        uuid,
  nome              text,
  telefone          text,
  dia_aniversario   smallint,   -- extract(day  from data_nascimento)
  mes_aniversario   smallint,   -- extract(month from data_nascimento)
  aceita_marketing  boolean,
  total_pedidos     int,
  ultimo_pedido_em  timestamptz
)
-- FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
-- WHERE p.loja_id = <loja do dono de auth.uid()> AND p.cliente_id IS NOT NULL
--   AND (p_mes IS NULL OR extract(month from c.data_nascimento) = p_mes)
-- GROUP BY c.id ORDER BY ultimo_pedido_em DESC, c.id LIMIT least(p_limite, 100) OFFSET greatest(p_offset, 0)
-- p_mes fora de 1..12 → erro 22023 (também barrado no zod).

public.cliente_da_loja(p_cliente_id uuid)
RETURNS TABLE (mesmas 8 colunas)   -- 0 linhas se o cliente não tem pedido na loja do dono
```

O agregado é feito no SQL (P41: "agregado em SQL, não em JS").

### Allowlist de colunas — decisão por coluna

**[aprovado pelo usuário, 2026-10-03]** cada coluna, com o motivo (minimização, LGPD art. 6º III):

| Coluna exposta | Origem | Entra? | Motivo |
|---|---|---|---|
| `cliente_id` | `clientes.id` | Sim | Chave da rota `[id]`. O lojista já a vê em `pedidos.cliente_id` da própria loja (`cliente-vinculo-pedido.md`). Não é exibida na tela. |
| `nome` | `clientes.nome` (perfil atual) | Sim | Identifica o cliente na lista. O lojista já recebe o nome em cada pedido. Vem do perfil, não do snapshot do pedido, para refletir a correção que o cliente fizer. |
| `telefone` | `clientes.telefone` (perfil atual) | Sim | Contato operacional (o lojista já recebe em cada pedido e usa para a entrega). Mesmo motivo do perfil atual. |
| `dia_aniversario`, `mes_aniversario` | derivados de `data_nascimento` | Sim | Necessários para o filtro de aniversariantes (decisão 5). **Sem o ano:** idade não é necessária à finalidade. |
| `aceita_marketing` | `clientes.aceita_marketing` | Sim | Diz ao lojista se pode mandar promoção para aquele cliente. Sem ele, a base convida a contatar quem não consentiu. Ver Pergunta P2 sobre o alcance do consentimento. |
| `total_pedidos` | `count(pedidos)` na loja | Sim | Dado comercial da própria loja. |
| `ultimo_pedido_em` | `max(pedidos.criado_em)` na loja | Sim | Dado comercial da própria loja; ordena a lista. |
| e-mail | `auth.users.email` | **Nunca** | Pedido explícito do P36. O lojista não precisa e o e-mail é a credencial de login. Nem a função lê `auth.users`. |
| senha / hash | `auth.users` | **Nunca** | Idem. |
| `data_nascimento` completa / ano / idade | `clientes` | **Não** | Minimização: a finalidade é só o aniversário. |
| endereços | `clientes_enderecos` | **Não** | O endereço usado em cada entrega já aparece no pedido (`endereco_entrega`). Endereços salvos que nunca foram usados nesta loja não dizem respeito a ela. |
| `consentimento_em`, `consentimento_versao`, `criado_em`, `ultimo_acesso_em` | `clientes` | **Não** | Uso interno de compliance e retenção; sem finalidade para o lojista. `ultimo_acesso_em` ainda revelaria atividade do cliente em outras lojas. |
| totais em dinheiro (ticket médio, soma gasta) | `pedidos.total` | **Não (v1)** | Fora do pedido do P36; ver Fora do Escopo. |

**[aprovado pelo usuário, 2026-10-03]** `total_pedidos` e `ultimo_pedido_em` contam **todos os pedidos com `cliente_id` na
loja, exceto `cancelado`**. Motivo: a coluna se chama "Pedidos" na leitura do lojista e um pedido cancelado não foi
uma compra. Um cliente cujos únicos pedidos foram cancelados **continua na base** (teve ≥1 pedido, regra do P36), com
"0 pedidos" e "Último pedido —". Alternativa recusada: contar cancelados, que inflaria o número; e tirar o cliente
da base, que contraria o "≥1 pedido" do P36.

### Índice

```sql
CREATE INDEX pedidos_loja_id_cliente_id_idx ON pedidos(loja_id, cliente_id) WHERE cliente_id IS NOT NULL;
```

`pedidos_cliente_id_criado_em_idx` já existe, mas começa por `cliente_id`; a lista parte de `loja_id`. Parcial porque
a base ignora convidados.

### Código afetado (para o `quebrar`)

- `supabase/migrations/<ts>_clientes_da_loja.sql` (P39) e `src/lib/database.types.ts` regenerado.
- `src/lib/supabase/queries/clientes.ts`: `listarClientesDaLoja(client, { mes?, limite, offset })` e
  `buscarClienteDaLoja(client, clienteId)` via `client.rpc(...)`, client da sessão (nunca `service_role`).
- `src/lib/supabase/queries/pedidos.ts`: `listarPedidosDoClienteNaLoja(client, clienteId)` reusando
  `SELECT_PEDIDO_COM_ITENS` ou um select menor, sob a RLS do lojista.
- `src/lib/validacoes/`: zod dos parâmetros (`aniversariantes`, `pagina`), reuso de `schemaUuid`.
- `src/lib/utils/mesDeReferencia.ts` (+ teste).
- `src/app/(painel)/painel/(bloqueavel)/clientes/` (lista e `[id]`), `components/painel/TabelaClientes.tsx`,
  `components/painel/NavPainel.tsx` (item "Clientes").

## Regras de Negócio

| # | Regra | Camada que garante |
|---|---|---|
| RN-D01 | A base da loja contém só clientes com ≥1 pedido com `cliente_id` naquela loja (decisões 2 e 20). Convidado não entra, nem por telefone ou nome. | **Função no banco** (JOIN por `pedidos.cliente_id`) |
| RN-D02 | A loja vem sempre da sessão (`lojas.dono_id = auth.uid()`), nunca de parâmetro. | **Função no banco** (sem parâmetro `loja_id`) |
| RN-D03 | Só as colunas da allowlist saem do banco. | **Função no banco** (`RETURNS TABLE`) + teste de allowlist |
| RN-D04 | Detalhe de cliente fora da base da loja = 404, igual a id inexistente. | **Função no banco** (0 linhas) + `notFound()` |
| RN-D05 | Os pedidos do detalhe são só da loja do dono. | **RLS** `pedidos_acesso_lojista` (existente) |
| RN-D06 | Cliente excluído ou anonimizado some da base de todas as lojas; os pedidos dele seguem em `/painel/pedidos` como "Cliente removido". | **Banco** (trigger `clientes_anonimizar_pedidos` zera `cliente_id`, Marco C) |
| RN-D07 | Aniversariante do mês = mês de `data_nascimento` igual ao mês corrente no fuso da loja. Nascido em 29/02 aparece em fevereiro. | **Servidor** (`mesDeReferencia`) + **função no banco** (`p_mes`) |
| RN-D08 | `total_pedidos` e `ultimo_pedido_em` excluem `cancelado`. | **Função no banco** |
| RN-D09 | Tela só leitura: nenhuma Server Action de escrita nesta feature. | Ausência de action + `clientes` sem UPDATE para lojista (RLS existente) |
| RN-D10 | `p_limite` ≤ 100, `p_mes` em 1..12. | **zod** no servidor + **função no banco** |

## Segurança (obrigatório)

- **Dado sensível que sai:** PII de cliente (nome, telefone, dia/mês de aniversário, opt-in de marketing) para o
  lojista da loja onde o cliente comprou logado. Entra: nada (tela só leitura).
- **Valor monetário:** nenhum cálculo novo. O total de cada pedido no detalhe é o valor gravado em `pedidos.total`,
  lido do banco. Não há recálculo nem preview.
- **Tabela nova:** nenhuma. **Policy nova:** nenhuma; a RLS de `clientes` continua "só a própria linha". A exceção
  controlada são as duas funções `SECURITY DEFINER`, que precisam de:
  - `SET search_path = ''` e nomes qualificados;
  - `REVOKE EXECUTE FROM public, anon`; `GRANT EXECUTE TO authenticated`;
  - escopo interno por `auth.uid()`; nenhum parâmetro de loja;
  - retorno fechado (allowlist);
  - entrada no registro de funções privilegiadas de `seguranca.md` (P44, escriba).
- **Testes RED (P40, vetor V5, crítico):** em `tests/migrations/clientes_base_do_lojista_escopo.test.ts` com
  `createTestDb()`:
  - lojista X: 0 linhas de cliente que só pediu em Y; `cliente_da_loja(<cliente de Y>)` → 0 linhas;
  - convidado (`cliente_id` null) não entra;
  - conjunto de colunas igual à allowlist (padrão VIEW-COLS de `pentest_area2`), sem `email`;
  - `asAnon` → erro de permissão ou 0 linhas;
  - usuário só-cliente (sem loja) → 0 linhas;
  - cliente anonimizado some;
  - `from("clientes")` como lojista continua 0 linhas (a RLS não foi ampliada).
- **IDOR:** o `[id]` da URL nunca é confiado: a função confere o vínculo pela loja da sessão.
- **Sem `service_role`** nesta feature. Sem `dangerouslySetInnerHTML` (gate de P41). Nome e telefone renderizados como
  texto pelo React.
- **Logs:** erro da RPC registrado no servidor só com código, sem PII (`seguranca.md` §21); a UI mostra mensagem
  genérica.
- **API externa:** nenhuma.

## Fora do Escopo (v1)

- Disparo de promoção, campanha, cupom pessoal, envio automático no aniversário (decisão 5).
- Exportação (CSV, planilha) e cópia em lote de telefones.
- Busca por nome/telefone e ordenação configurável na lista.
- Métricas em dinheiro por cliente (soma gasta, ticket médio).
- Vincular compradores convidados antigos à base (decisão 20; vínculo por SMS é entrega futura, P46).
- Tela de clientes no hub admin (`/admin/*`).
- Edição de qualquer dado do cliente pelo lojista.
- Correções da `tasks/330`.

## Perguntas ao usuário

- **P1 — Dono com mais de uma loja.** `lojas.dono_id` não é `UNIQUE` em `schema.md`. A função precisa resolver "a loja
  do dono" da mesma forma que `buscarLojaDoDono`. Hoje um dono tem uma loja só na prática? Se puder ter várias, a base
  deve ser da loja ativa no painel (e como o servidor sabe qual é, sem receber `loja_id` do payload)?
- **P2 — Alcance do `aceita_marketing`.** O opt-in foi coletado uma vez, na conta iRango (conta única, decisão 1). O
  texto do consentimento em `/conta/completar` e na Política de Privacidade cobre promoções **das lojas onde o cliente
  compra**, ou só do iRango? Se cobrir só o iRango, mostrar a coluna ao lojista sugere uma permissão que o cliente não
  deu, e a proposta passa a ser: tirar a coluna nesta entrega e tratar consentimento por loja junto do motor de
  promoções.
- **P3 — Transparência ao cliente.** A Política de Privacidade (decisão 22) já diz que a loja onde o cliente comprou
  logado vê nome, telefone, aniversário (dia/mês) e opt-in? Se não, o texto precisa ser atualizado nesta entrega,
  como no Marco B.

## Respostas do usuário (2026-10-03)

- **P1** — Resolvida no código: índice único `lojas(dono_id)` (`20260614003500_unique_loja_por_dono.sql`) garante uma loja por dono; a loja sai de `auth.uid()`.
- **P2** — O opt-in `aceita_marketing` vale para promoções das lojas onde o cliente compra; a coluna fica na lista do lojista.
- **P3** — Atualizar a Política de Privacidade (a loja vê nome, telefone, aniversário dia/mês e opt-in de quem comprou logado) fica para depois: issue 345.
- Decisões propostas aprovadas como estão.
- **Atualização da allowlist (2026-10-03, aprovado pelo usuário):** cancelados são exibidos mas não contabilizados, explicitamente. Somam-se à allowlist `total_cancelados` e `ultimo_pedido_status`; `ultimo_pedido_em` passa a considerar qualquer status; `total_pedidos` continua sem cancelados. Detalhes nas issues 346/347.
