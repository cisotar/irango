# Spec: Vínculo cliente ↔ pedido (checkout logado, histórico, cupom por cliente)

**Versão:** 0.1.0 | **Atualizado:** 2026-10-02

> Origem: passo P23 de `plan/loop-cadastro-de-clientes.md` (Marco C). Depende do Marco B
> (`specs/cliente-identidade.md`, migration `20261002120000_clientes.sql`, `src/lib/actions/cliente.ts`),
> ainda não mesclado no `main` quando este spec foi escrito.
> As decisões 1–22 do plano e as alterações 23–27 são restrições e não são rediscutidas aqui. Este spec aplica
> literalmente as decisões 2, 3, 6, 9, 9-A, 16, 20, 21 e a alteração 25.
> Linhas marcadas **[aprovado pelo usuário, 2026-10-03]** são escolhas que o P23 delegou a este spec. Cada uma traz uma
> opção e o motivo.

## Visão Geral

Liga a conta de cliente (Marco B) ao pedido. Com isso:

1. **Checkout logado (opcional, decisão 6).** Cliente logado tem nome, telefone e endereço pré-preenchidos e o
   pedido nasce com `cliente_id`. Convidado fecha o pedido **exatamente como hoje** (zero regressão).
2. **"Entrar" na vitrine (alteração 25, decisão 21).** O checkout ganha um link "Entrar" junto do campo de cupom.
   Ele leva à tela neutra do iRango (`/conta/entrar`) com "Voltar para <loja>" e devolve o cliente ao checkout com o
   carrinho intacto.
3. **Histórico** em `/minha-conta/pedidos`: só pedidos fechados com o cliente logado. O histórico começa do zero
   (decisão 20).
4. **Cupom com limite por cliente (decisões 9 e 9-A).** Nova coluna `cupons.limite_por_cliente`. Quando está
   preenchida, o cupom só dá desconto a cliente logado e até o limite. Convidado recebe `desconto = 0` e a
   orientação "Entre na sua conta para usar este cupom".
5. **Anonimização vista do pedido (decisão 3)** e **expurgo de 5 anos (decisão 4)**.
6. **Exclusão de conta bloqueada com pedido em aberto (decisão 16).**

Mundos: **vitrine pública** (checkout), **cliente** (`/minha-conta/pedidos`), **painel** (formulário de cupom) e
**banco** (RPC, RLS, funções).

O SaaS não processa pagamento. Todo valor (desconto, total, uso de cupom) é **autoritativo no servidor**. O
`cliente_id` vem de `auth.uid()` da sessão e nunca do payload.

## Atores Envolvidos

| Ator | Nesta feature |
|---|---|
| **iRango (SaaS)** | Server Actions `criarPedido` / `revisarCarrinho` (recalculam desconto e limite), RPC `criar_pedido` (grava `cliente_id` e trava o uso por cliente), funções `anonimizar_cliente` e `expurgar_pedidos_antigos`. |
| **Cliente logado** | Fecha pedido com dados pré-preenchidos, usa cupom com limite por cliente, vê o próprio histórico. A exclusão de conta é recusada enquanto houver pedido em aberto. |
| **Cliente convidado** | Fecha pedido como hoje. Cupom com limite por cliente dá `desconto = 0` e mostra a orientação de entrar. Nunca vê pedido de ninguém além do próprio, e só pelo `token_acesso`. |
| **Lojista** | Cria cupom com ou sem limite por cliente e vê o aviso de que só vale para cliente logado. Continua vendo só os pedidos da própria loja. **Não** ganha acesso a `cliente_id` além do que já lê na linha (a base de clientes é Marco D). |

---

## Páginas e Rotas

### Checkout — `/loja/[slug]/pedido`
**Mundo:** vitrine pública (sem auth obrigatório; sessão de cliente é opcional)
**Descrição:** O wizard atual (`CheckoutWizard`) não muda para o convidado. Se houver sessão com perfil de cliente
completo, o servidor entrega o perfil e os até 3 endereços. A etapa de entrega mostra um seletor entre esses
endereços, com o endereço padrão já escolhido. A etapa de identificação vem com nome e telefone preenchidos e
editáveis. Junto do campo de cupom há um link "Entrar" (só sem sessão de cliente).

**Componentes:**
- `CheckoutWizard`, `EtapaEntrega`, `EtapaPagamento`, `ResumoValores` (`src/components/vitrine/checkout/`) — **reuso**,
  ganham só props opcionais (`perfilCliente?`, `enderecosCliente?`). Sem prop = comportamento de hoje.
- `FormEndereco` — **reuso**. Pré-preenchido a partir do endereço escolhido; o cliente pode editar só para este
  pedido. A edição **não** altera o endereço salvo.
- `SeletorEnderecoCliente` (novo, pequeno) — shadcn `RadioGroup` com os ≤3 rótulos e "Usar outro endereço".
- `LinkEntrarCheckout` (novo, pequeno) — monta `/conta/entrar?next=/loja/<slug>/pedido`. O `next` é sanitizado no
  servidor pelo Marco B (`sanitizarNext`, RN-15/RN-21 do spec B).
- `useEnviarPedido` / `useCarrinho` — **reuso**, sem mudança. O carrinho continua em `sessionStorage` (decisão 21).
- Mensagem do cupom: o mesmo slot de `VereditoCupom { valido: false; mensagem }` já usado em `EtapaPagamento`
  (`revisarCarrinho-contrato.ts:49`). **Nenhum estado novo de cupom.**

**Behaviors:**
- [ ] Convidado fecha pedido exatamente como hoje: mesmos campos, mesmo payload, mesmos testes verdes, sem teste
  existente alterado (gate C3). Garantido em: Server Action (`schemaPayloadPedido` `.strict()` não muda) + suíte.
- [ ] Cliente logado abre o checkout e vê nome, telefone e endereço padrão pré-preenchidos. Garantido em: servidor
  (Server Component lê o perfil com o client da sessão + **RLS** de `clientes`/`clientes_enderecos` do Marco B). É
  só preenchimento de UX: o que vale é o que o payload envia, validado como hoje.
- [ ] Cliente logado troca o endereço entre os ≤3 salvos ou escolhe "Usar outro endereço". Garantido em: cliente
  (UX). O frete continua recalculado no servidor a partir do CEP enviado (`seguranca.md` §10).
- [ ] Pedido de cliente logado nasce com `cliente_id = auth.uid()`. Garantido em: **Server Action** (`getUser()`
  da sessão; o payload não tem campo `cliente_id`; `.strict()` recusa se vier) + **RPC** (`p_cliente_id`). Só é
  gravado se a conta tem perfil em `clientes` e e-mail confirmado (decisão 18). Caso contrário o pedido é de
  convidado (`cliente_id` null).
- [ ] Lojista ou admin com perfil de cliente que compra em qualquer loja (inclusive a própria) recebe `cliente_id`
  como qualquer cliente (decisão 15). Garantido em: Server Action (mesma regra).
  **[aprovado pelo usuário, 2026-10-03]** comprar na própria loja não é bloqueado: a decisão 15 diz "pode comprar em
  qualquer loja como cliente". O cupom com limite por cliente vale para ele como para qualquer cliente.
- [ ] Clicar "Entrar" (visível só sem sessão de cliente, junto do campo de cupom) leva a `/conta/entrar` com
  "Voltar para <loja>". Depois de entrar (e-mail ou Google, na mesma aba), o cliente volta ao checkout com o
  carrinho intacto e os dados pré-preenchidos. Garantido em: servidor (`sanitizarNext`) + cliente (`sessionStorage`).
  Limite aceito (decisão 21): link de confirmação aberto em outra aba não traz o carrinho.
- [ ] Digitar cupom **sem** `limite_por_cliente` (convidado ou logado) → comportamento de hoje (só `usos_maximos`
  global). Garantido em: **Server Action** (`revisarCarrinho` e `criarPedido`) + **RPC**.
- [ ] Convidado digita cupom **com** `limite_por_cliente` → a revisão mostra "Entre na sua conta para usar este
  cupom" com o link "Entrar"; o resumo mostra desconto zero; o pedido pode ser fechado sem desconto, sem bloqueio.
  Garantido em: **Server Action + RPC** (decisão 9-A). `desconto = 0`, `p_cupom_id` null, `usos_contagem` não
  incrementa, `cupom_codigo` não é gravado.
- [ ] Cliente logado digita cupom com `limite_por_cliente = N` e ainda tem usos → desconto aplicado como hoje.
  Garantido em: **Server Action + RPC (contagem e trava na mesma transação) + RLS**.
- [ ] Cliente logado que já atingiu `N` usos daquele cupom naquela loja → desconto zero, o pedido segue sem
  desconto, com a mensagem "Você já usou este cupom o máximo de vezes permitido."
  **[aprovado pelo usuário, 2026-10-03]** (copy; mesmo padrão de "cupom esgotado" que hoje segue sem desconto, D5).
  Garantido em: **Server Action + RPC**.
- [ ] O preview do desconto na tela (`ResumoValores`) nunca é autoritativo. Se o servidor zerar o desconto entre a
  revisão e o envio (corrida, limite atingido em outra aba), o pedido é gravado com o valor do servidor. Garantido
  em: **Server Action + RPC**.

---

### Meus pedidos — `/minha-conta/pedidos`
**Mundo:** cliente · área logada (guard do Marco B em `src/app/(cliente)/minha-conta/layout.tsx`)
**Descrição:** Lista dos pedidos do cliente, do mais recente ao mais antigo, de todas as lojas: data, nome da loja,
status, total e link "Ver pedido" para a confirmação por token que já existe (`/loja/[slug]/confirmacao?pedido=…&token=…`).
Estado vazio: "Você ainda não fez pedidos com sua conta."
**[aprovado pelo usuário, 2026-10-03]** (copy). Ela evita sugerir que pedidos antigos de convidado vão aparecer (decisão 20).
Paginação: 20 por página, com "Carregar mais".
**[aprovado pelo usuário, 2026-10-03]** (mesmo tamanho de página da lista do painel; o índice `(cliente_id, criado_em desc)` atende).

**Componentes:**
- `listarPedidosDoCliente` (nova, em `src/lib/supabase/queries/pedidos.ts`, ao lado de `listarPedidosDoDono`) — client
  da **sessão**, sem `service_role`. Seleciona só `id, loja_id, status, total, criado_em, token_acesso` + `lojas(nome, slug)`.
- `BadgeStatusPedido` / formatação de moeda e data — **reuso** do que o painel e a confirmação já usam (o
  `executar` faz grep em `components/` e `lib/utils/` antes de criar).
- shadcn `Card`, `Button`.
- Link "Minha conta → Pedidos" em `/minha-conta`.

**Behaviors:**
- [ ] Ver só os próprios pedidos. Pedido de convidado, mesmo com o mesmo telefone ou nome, nunca aparece (decisão
  20). Garantido em: **RLS** (`cliente_id = auth.uid()`) + query com o client da sessão.
- [ ] Abrir um pedido pelo link de confirmação por token. Garantido em: fluxo atual (`buscarPedidoPorToken`, sem
  mudança). O `token_acesso` só é lido pelo dono do pedido via RLS.
- [ ] Sem sessão → redireciona para `/conta/entrar?next=/minha-conta/pedidos`. Garantido em: guard (layout) do Marco B.
- [ ] Pedido anonimizado nunca aparece: após a anonimização o `cliente_id` é null. Garantido em: banco.

---

### Minha conta — exclusão (extensão do Marco B) — `/minha-conta`
**Mundo:** cliente · área logada
**Descrição:** O bloco "Excluir conta" do Marco B passa a respeitar a decisão 16.

**Behaviors:**
- [ ] Com pedido em aberto (status fora de `entregue`/`cancelado`), excluir conta é recusado, com a mensagem
  "Aguarde a entrega dos seus pedidos em aberto para excluir a conta." Nada é apagado nem anonimizado. Garantido
  em: **função `anonimizar_cliente`** (o banco recusa, então nenhum caminho a contorna) + Server Action `excluirConta`
  (traduz o erro na mensagem). Vale também para lojista/admin + cliente (que perdem só o perfil).
- [ ] Sem pedido em aberto → exclusão como no Marco B, agora anonimizando também os pedidos (ver Regras). Garantido
  em: `anonimizar_cliente` (`service_role`).
- [ ] Quando o último pedido termina, a exclusão volta a funcionar sem fila nem agendador. Garantido em: a checagem
  roda no momento da chamada.
- [ ] O aviso é só resposta da action. A tela **não** pré-checa nem esconde o botão.
  **[aprovado pelo usuário, 2026-10-03]**: um único caminho de verdade (servidor) e nada a manter em sincronia na UI.

---

### Cupons (painel) — `/painel/cupons`
**Mundo:** painel (auth obrigatório, lojista)
**Descrição:** `FormCupom` ganha o campo opcional "Limite de usos por cliente" (inteiro ≥ 1; vazio = sem limite).
Quando o campo está preenchido, aparece abaixo dele o aviso fixo (não modal): "Este cupom só vale para clientes que
entrarem na conta. Quem compra sem conta não recebe o desconto."
**[aprovado pelo usuário, 2026-10-03]** (aviso inline e não bloqueante, igual às dicas que o form já mostra. Um modal de
confirmação a cada salvamento seria atrito sem ganho de segurança).
A listagem (`CuponsClient`) mostra "Limite por cliente: N" quando houver.

**Componentes:** `FormCupom`, `CuponsClient` — **reuso** (campo novo). Schema do cupom em `src/lib/validacoes/` ganha
`limite_por_cliente: z.number().int().min(1).max(1000).nullable()`.
**[aprovado pelo usuário, 2026-10-03]** teto 1000: o mesmo tipo de trava de input do projeto (`tasks/165`/`198`). Um número
sem teto não tem uso real.

**Behaviors:**
- [ ] Criar ou editar cupom com ou sem limite por cliente. Garantido em: **Server Action** `criarCupom`/`atualizarCupom`
  (zod `.strict()`, escopo por `loja_id` do dono) + **RLS** `cupons_acesso_proprio` + **CHECK** no banco
  (`limite_por_cliente is null or limite_por_cliente >= 1`).
- [ ] Lojista não define limite em cupom de outra loja. Garantido em: Server Action + RLS (sem mudança).
- [ ] Mudar o limite de um cupom já usado vale para os próximos pedidos. Os usos passados continuam contando
  (a contagem lê `pedidos`). Garantido em: RPC.
- [ ] O admin (`admin-cupom`) não muda nesta entrega.
  **[aprovado pelo usuário, 2026-10-03]**: o painel admin de cupom continua sem o campo. Se ele salvar um cupom, preserva o
  valor existente (o `update` não toca a coluna).

---

## Modelos de Dados

Migrations novas (P25), todas depois de `20261002120000_clientes.sql`. Tudo é só **expand**: nenhum backfill, porque
pedidos antigos são de convidado e continuam assim para sempre (decisão 20).

### `pedidos` — coluna nova

| Coluna | Tipo | Regra |
|---|---|---|
| `cliente_id` | `uuid null` | `references public.clientes(id) on delete set null`. Gravado **só na criação**, pela RPC. Nunca por UPDATE. |

- Índice `pedidos_cliente_id_criado_em_idx on pedidos (cliente_id, criado_em desc) where cliente_id is not null`.
  **[aprovado pelo usuário, 2026-10-03]** índice parcial: a maioria das linhas é de convidado (null), e o parcial é menor
  sem perder nenhuma consulta (o histórico e a contagem de cupom sempre filtram `cliente_id = X`).
- **Imutabilidade de `cliente_id`** para autor não-sistema: trigger BEFORE UPDATE no molde de
  `pedidos_transicao_status` (SECURITY INVOKER, whitelist `service_role`/`postgres`/`supabase_admin`) recusa
  `new.cliente_id is distinct from old.cliente_id`. Ele fecha "lojista reescreve `cliente_id`" (a policy
  `pedidos_acesso_lojista` é `FOR ALL`, `tasks/330`) e "cliente se apropria de pedido de convidado" (decisão 20).
  O `service_role` passa, para a anonimização.
- `cupom_codigo` passa a ser também a chave da contagem por cliente (ver Regras RN-C06). Nenhuma mudança de tipo.

### `cupons` — coluna nova

| Coluna | Tipo | Regra |
|---|---|---|
| `limite_por_cliente` | `int null` | `check (limite_por_cliente is null or limite_por_cliente between 1 and 1000)`. Null = sem limite por cliente (comportamento de hoje). |

A RLS de `cupons` não muda (`cupons_acesso_proprio`, só o dono).

### RLS nova — leitura do cliente

Policies **só de SELECT**, `to authenticated`:

| Tabela | Policy | USING |
|---|---|---|
| `pedidos` | `pedidos_select_cliente` | `cliente_id = (select auth.uid())` |
| `itens_pedido` | `itens_pedido_select_cliente` | `exists (select 1 from pedidos p where p.id = itens_pedido.pedido_id and p.cliente_id = (select auth.uid()))` |
| `itens_pedido_opcionais` | `itens_pedido_opcionais_select_cliente` | mesmo padrão, via `itens_pedido` → `pedidos` |

- Nenhuma policy de INSERT/UPDATE/DELETE para o cliente. O pedido só nasce pela RPC (`20260923060457`).
- **Não amplia o que a `tasks/330` restringe:** as policies novas são `FOR SELECT` e não tocam
  `pedidos_acesso_lojista`. Elas não dão DELETE nem UPDATE a ninguém. Como policies permissivas se somam por
  `OR`, um lojista que também é cliente lê os pedidos da loja (como hoje) **e** os próprios pedidos de cliente em
  outras lojas. Isso é intencional (decisão 15), e o lojista nunca ganha escrita sobre pedido de outra loja.
- `anon` continua sem nenhum SELECT direto. O convidado acessa só por `token_acesso` (fluxo atual, sem mudança).
- Grants: a lista de colunas que o cliente lê é controlada pela query (`listarPedidosDoCliente`). Não há grant de
  coluna novo, porque `pedidos` hoje concede SELECT de tabela a `authenticated` para o lojista.
  `cliente_id` passa a ser visível ao lojista na própria loja. Isso é aceitável: o lojista já vê nome, telefone e
  endereço da linha. A base de clientes (Marco D) define o que mais ele vê.

### RPC `criar_pedido` — nova versão

- **Assinatura nova** com 18 argumentos: os 17 atuais + `p_cliente_id uuid` (último). Segue o precedente da issue
  266 (overload). A MESMA migration remove as versões de 16 e de 17 argumentos (sem código morto) e cria a de 18
  com `p_cliente_id` **obrigatório, sem default** (null explícito para convidado); a action sempre envia o argumento.
  O checkout fica indisponível só entre o `db push` e o deploy do código. **[aprovado pelo usuário, 2026-10-03 —
  substitui a resposta P1]** Fecha também a issue 266.
- Continua `security invoker`, chamada pelo `service_role` da Server Action. `p_cliente_id` é **sempre** o
  `auth.uid()` que a Server Action obtém de `getUser()`, ou null. Nunca vem do payload.
- Defesa em profundidade dentro da RPC: se `p_cliente_id` não é null e não existe em `public.clientes`, a RPC
  levanta `cliente_inexistente`. A FK também recusa.
- **Ordem nova dentro da RPC** (mantendo o dedupe `(0)` primeiro):
  1. dedupe por `idempotency_key` (sem mudança: o retry devolve o mesmo pedido e não consome nada);
  2. loja ativa;
  3. **cupom por cliente:** se `p_cupom_id` não é null e o cupom tem `limite_por_cliente` não nulo:
     - `p_cliente_id` null → anula o desconto, zera `p_cupom_id`/`v_cupom_codigo` e recalcula o total (decisão 9-A,
       defesa em profundidade; a action já manda null);
     - senão `pg_advisory_xact_lock(hashtext(p_cupom_id::text || p_cliente_id::text))` e conta
       `count(*) from pedidos where loja_id = p_loja_id and cliente_id = p_cliente_id and cupom_codigo = <codigo do cupom>`;
       se `>= limite_por_cliente`, anula o desconto como no esgotamento global (D5);
  4. trava global de `usos_contagem` (sem mudança);
  5. INSERT com `cliente_id = p_cliente_id`.
- Retorno: igual (`pedido_id`, `token_acesso`). A action descobre que o desconto foi anulado comparando com o que
  mandou, como já faz hoje no esgotamento global.

### `anonimizar_cliente(p_usuario uuid)` — extensão (SECURITY DEFINER, só `service_role`)

Numa transação:
1. **Trava da decisão 16:** se existe `pedidos` com `cliente_id = p_usuario` e `status not in ('entregue','cancelado')`,
   faz `raise exception 'pedido_em_aberto'` e nada muda.
2. `update pedidos set nome_cliente = 'Cliente removido', telefone_cliente = null, endereco_entrega = null,
   cliente_id = null where cliente_id = p_usuario`. Ficam intactos `subtotal`, `desconto`, `taxa_entrega`, `total`,
   `status`, `itens_pedido`, `itens_pedido_opcionais`, `cupom_codigo`, `forma_pagamento`, `criado_em`.
   Os triggers `pedidos_protege_valor_trg` e `pedidos_transicao_status_trg` deixam o `service_role` passar
   (`20260930130000:39`), e o UPDATE não toca valor nem status.
3. `delete from clientes where id = p_usuario` (Marco B, cascade nos endereços).

Detalhes:
- Ele zera `observacoes`?
  **[aprovado pelo usuário, 2026-10-03]**: **sim**, `observacoes = null`. É texto livre do cliente e pode conter PII
  ("portão azul, falar com Maria"). A decisão 3 apaga a PII e mantém itens e valores. `itens_pedido.observacao`
  segue a mesma lógica e também é zerada.
- `anonimizar_clientes_inativos()` (Marco B) passa a **pular** quem tem pedido em aberto (captura
  `pedido_em_aberto` por cliente e segue o laço), para que um cliente não aborte o lote inteiro.
  **[aprovado pelo usuário, 2026-10-03]**
- Pedido de convidado nunca é tocado por `anonimizar_cliente`. Não há vínculo (decisão 20).

### `expurgar_pedidos_antigos()` — nova (SECURITY DEFINER, só `service_role`, sem agendador)

- Apaga `pedidos` com `criado_em < now() - interval '5 years'` e `status in ('entregue','cancelado')`. Os itens e
  opcionais vão por cascade (ou são apagados explicitamente se a FK não for cascade: o `executar` confere).
  Retorna a quantidade apagada.
- Vale para **todo** pedido (de cliente, anonimizado ou de convidado).
  **[aprovado pelo usuário, 2026-10-03]**: a decisão 4 fala de "pedido anonimizado guardado 5 anos". Aplicar o mesmo prazo
  ao pedido de convidado evita guardar PII de convidado para sempre, o que seria pior que a regra do cliente. Ver
  Perguntas P2: muda o que o lojista vê no painel.
- `revoke execute … from public, anon, authenticated`. Sem cron (decisão 4 / plano P23).

### Código afetado (para o `quebrar`)
- `src/lib/actions/pedido.ts` — `getUser()` + checagem de perfil, regra 9-A e `p_cliente_id` na RPC, junto do bloco de
  cupom (`:494-518`).
- `src/lib/actions/revisarCarrinho.ts` — mesma regra 9-A e limite no `VereditoCupom` (`valido: false; mensagem`).
- `src/lib/actions/cliente.ts` (Marco B) — `excluirConta` traduz `pedido_em_aberto` na mensagem da decisão 16.
- `src/lib/actions/cupom.ts` + schema em `src/lib/validacoes/` — `limite_por_cliente`.
- `src/lib/supabase/queries/pedidos.ts` — `listarPedidosDoCliente`. `src/lib/supabase/queries/clientes.ts` (Marco B) —
  perfil + endereços para o checkout.
- `src/components/vitrine/checkout/*`, `src/app/(publica)/loja/[slug]/pedido/page.tsx`,
  `src/components/painel/FormCupom.tsx`, `CuponsClient.tsx`, `src/app/(cliente)/minha-conta/pedidos/page.tsx`.
- `src/lib/database.types.ts` regenerado após o gate de migration (P31).

## Regras de Negócio

| # | Regra | Camada |
|---|---|---|
| RN-C01 | Login no checkout é opcional. O convidado fecha pedido exatamente como hoje (decisão 6) | Server Action (`schemaPayloadPedido` inalterado) + suíte sem teste alterado (gate C3) |
| RN-C02 | `cliente_id` = `auth.uid()` da sessão quando há perfil em `clientes` e e-mail confirmado. Senão null. Nunca do payload | **Server Action** (`getUser`, `.strict()`) + **RPC** (FK e checagem de existência) |
| RN-C03 | `cliente_id` é gravado só na criação e é imutável para usuário (lojista e cliente) | **Banco** (trigger BEFORE UPDATE; só sistema passa) |
| RN-C04 | Pedido de convidado nunca é vinculado depois: nem por telefone, nome, e-mail ou token (decisão 20) | **Banco** (RN-C03) + ausência de qualquer função de vínculo |
| RN-C05 | Cliente lê só os próprios pedidos e itens. Convidado só por `token_acesso`. Lojista só os da própria loja | **RLS** (SELECT novo + policies atuais) |
| RN-C06 | Uso por cliente = `count(pedidos)` com `loja_id` + `cliente_id` + `cupom_codigo` iguais, contando **todos os status, inclusive cancelado**. **[aprovado pelo usuário, 2026-10-03]**: contar a partir de `pedidos` (sem tabela nova). `cupom_codigo` só é gravado quando o desconto foi aplicado (`pedido.ts:508-515`), então ele já é o registro de "usou". O índice `(cliente_id, criado_em)` atende. Cancelado conta igual ao global, que hoje não devolve uso no cancelamento (nenhum decremento de `usos_contagem` no repositório). Isso fecha o "cancelar e repetir" que o P30 vai atacar. | **RPC** (contagem + trava) |
| RN-C07 | A contagem e o consumo são atômicos por (cupom, cliente): dois pedidos simultâneos do mesmo cliente não passam do limite | **RPC** (`pg_advisory_xact_lock` + contagem na mesma transação do INSERT) |
| RN-C08 | Cupom com `limite_por_cliente` + convidado → `desconto = 0`, nada é consumido, `cupom_codigo` não é gravado, o pedido segue. Mensagem: "Entre na sua conta para usar este cupom" (decisão 9-A) | **Server Action** (`criarPedido`, `revisarCarrinho`) + **RPC** (defesa em profundidade) |
| RN-C09 | Cupom sem `limite_por_cliente` → só `usos_maximos` global, idêntico a hoje (decisão 9) | Server Action + RPC (sem mudança) |
| RN-C10 | Limite atingido → desconto zero, o pedido segue (mesmo padrão D5 do esgotamento global) | **Server Action + RPC** |
| RN-C11 | Cupom da loja X nunca vale na loja Y | **Server Action** (`buscarCupomPorCodigo(svc, loja_id, …)`, `pedido.ts:500`) + contagem filtrada por `loja_id` |
| RN-C12 | Idempotência: retry com a mesma `idempotency_key` devolve o mesmo pedido e não conta outro uso | **RPC** (dedupe antes da trava, sem mudança) |
| RN-C13 | Status final = `entregue` ou `cancelado`. Os únicos estados sem aresta de saída na máquina de status (`20260930130000:51-59`) | **Banco** |
| RN-C14 | Exclusão de conta é recusada com pedido em status não final criado nos últimos 7 dias (decisão 16, ajustada em 2026-10-03); pedido em aberto mais antigo é anonimizado. Trigger `BEFORE DELETE` em `clientes` anonimiza os pedidos por qualquer caminho. A checagem fica dentro de `anonimizar_cliente` | **Banco** (função) + Server Action (mensagem) |
| RN-C15 | Anonimização: `nome_cliente = 'Cliente removido'`; telefone, endereço, observações e `cliente_id` ficam null; valores, itens e status intactos; faturamento histórico não muda (decisão 3) | **Banco** (`anonimizar_cliente`, `service_role`) |
| RN-C16 | Pedido em status final com mais de 5 anos pode ser expurgado por `expurgar_pedidos_antigos()`, que não tem agendador (decisão 4) | **Banco** (função) |
| RN-C17 | O "Entrar" do checkout volta ao checkout pelo `next` sanitizado. O carrinho sobrevive na mesma aba (decisão 21) | Servidor (`sanitizarNext`) + cliente (`sessionStorage`) |
| RN-C18 | Pré-preenchimento é só UX. Nome, telefone e endereço enviados são revalidados como hoje. O frete é recalculado do CEP | **Server Action** |

## Segurança (obrigatório)

**Valor monetário: autoritativo no servidor.** Desconto, total, elegibilidade do cupom, contagem de uso por
cliente e consumo de `usos_contagem` são recalculados na Server Action e travados na RPC, a partir do banco
(`seguranca.md` §10). O cliente só envia `codigo_cupom`. O `ResumoValores` e a mensagem da revisão são preview.
Garantido em: **Server Action + RPC + RLS** em todo behavior de cupom e checkout.

**Identidade no pedido.** `cliente_id` vem de `getUser()` (nunca de `getSession()` nem do payload). O schema do
payload continua `.strict()` e sem campo `cliente_id`. A RPC confere que o id existe em `clientes`. O trigger torna
`cliente_id` imutável para usuário.

**PII que entra e sai.** Nome, telefone e endereço do perfil passam pelo checkout (lidos com o client da sessão + RLS
do Marco B). O histórico mostra só loja, data, status e total. Logs só com id e código de erro (`seguranca.md` §21).
Nenhum dado real em seed ou teste (P26 usa dados fictícios).

**RLS nova:** `pedidos_select_cliente`, `itens_pedido_select_cliente`, `itens_pedido_opcionais_select_cliente` (só
SELECT). Testes da fatia C1 (`tests/migrations/pedidos_cliente_id_rls.test.ts`):
- cliente A × B;
- pedido de convidado invisível a qualquer cliente, inclusive ao que tem o mesmo telefone;
- UPDATE de `cliente_id` por cliente e por lojista recusado;
- lojista continua só na própria loja;
- `anon` = 0;
- nada do que a 330 restringe é ampliado.

**Ataques que o `auditar` (P30) deve tentar:**
- forjar `cliente_id` no payload;
- cancelar e repetir (RN-C06);
- repetir a `idempotency_key` (RN-C12);
- dois pedidos simultâneos (RN-C07);
- alternar entre convidado e logado (RN-C08);
- reativar o perfil depois de excluí-lo (ver Perguntas P3);
- ler a PII do pedido após a anonimização.

**Funções `SECURITY DEFINER`:** `anonimizar_cliente` (estendida) e `expurgar_pedidos_antigos`. EXECUTE só para
`service_role`; `asUser` → permission denied (teste). `set search_path = ''`.

**API externa com key:** nenhuma nova.

## Fora do Escopo (v1)

- Motor de promoção, cupom pessoal ou de aniversário, envio automático (decisão 5).
- Base de clientes do lojista e filtro de aniversariantes (Marco D).
- Vincular pedido antigo de convidado à conta, por qualquer meio. Verificação por SMS é uma entrega futura (decisão 20).
- Salvar no perfil um endereço digitado no checkout ("Salvar este endereço").
- Agendador de `expurgar_pedidos_antigos` e de `anonimizar_clientes_inativos`.
- Recompra ("pedir de novo") a partir do histórico.
- Devolver uso de cupom ao cancelar o pedido (nem global nem por cliente).
- Cupom por cliente no painel admin (`admin-cupom`).
- Correções da `tasks/330` (DELETE e colunas do lojista em `pedidos`). Esta entrega só não as amplia; o trigger de
  `cliente_id` cobre apenas a coluna nova.
- Troca de e-mail e senha logado (alteração 26).

## Perguntas ao usuário (respondidas em 2026-10-03 — ver seção final)

**P1 — Overload da RPC (`tasks/266`).** O histórico da 266 não está no clone: só aparece o commit de docs
`262cb3d`, e não há arquivo da issue. O spec propõe criar a `criar_pedido` de 18 argumentos e dar `drop` na de 17
na mesma migration.
- **(a, proposta)** drop na mesma migration. Nunca existem dois overloads, mas o deploy precisa subir migration e
  código juntos (a janela entre `db push` e deploy quebra o checkout).
- **(b)** manter a de 17 por um deploy e dropar numa migration seguinte. O checkout nunca quebra, mas existe uma
  janela com dois overloads (risco de ambiguidade no PostgREST se os tipos coincidirem com default).

Impacto: ordem do gate P31 e risco de checkout fora do ar por alguns minutos.

**P2 — Expurgo de 5 anos para pedido de convidado.** A decisão 4 fala de "pedido anonimizado".
- **(a, proposta)** expurgar todo pedido final com mais de 5 anos. O lojista perde, no painel, pedidos com mais
  de 5 anos.
- **(b)** expurgar só pedido anonimizado. Pedido de convidado fica para sempre, com nome, telefone e endereço.

Impacto: métricas e histórico do painel de lojas antigas × retenção de PII de convidado.

**P3 — Lojista/admin que exclui o perfil de cliente e o reativa.** Como a conta (`auth.uid()`) continua a mesma e
a anonimização zera `cliente_id` dos pedidos antigos, a contagem de uso por cliente recomeça do zero, e ele pode
usar de novo um cupom com limite. Só-cliente não tem esse caso: a conta é apagada e uma conta nova é outro
cliente, o mesmo limite de qualquer sistema baseado em conta.
- **(a)** aceitar como limite conhecido. É só para quem tem papel de lojista ou admin e exige excluir o perfil
  com todos os pedidos finalizados.
- **(b)** tabela `cupons_usos_cliente (cupom_id, usuario_id)` que sobrevive à anonimização. Guarda um
  identificador da pessoa depois da exclusão, o que entra em tensão com a decisão 3.

Impacto: complexidade e retenção de identificador × brecha estreita.

## Respostas do usuário (2026-10-03)

- **P1** — A versão antiga de `criar_pedido` (17 argumentos) NÃO é removida nesta migration: as duas convivem e uma migration pequena num deploy seguinte remove a antiga. Substitui a decisão proposta 13.
- **P2** — `expurgar_pedidos_antigos()` remove todo pedido em status final com mais de 5 anos, de cliente ou de convidado (confirma a decisão proposta 14).
- **P3** — Aceito como limite conhecido: lojista/admin que exclui e reativa o perfil de cliente tem a contagem de uso por cliente reiniciada. Sem tabela própria de usos.
- **P1 revisada (2026-10-03)** — sem código morto: as versões de 16 e 17 de `criar_pedido` saem na mesma migration da 18; `p_cliente_id` sem default; checkout parado só entre `db push` e deploy. Issue 344 cancelada; issue 266 fechada pela 341.
- Demais decisões propostas (1–12) aprovadas como estão.
- **Decisão 16 ajustada (2026-10-03, após o P30)** — Só bloqueia a exclusão pedido em status não final criado nos últimos **7 dias**. Pedido em aberto mais antigo não impede a exclusão e é anonimizado ("Cliente removido", valores intactos), para o cliente não ficar preso por inação do lojista (LGPD art. 18).
- **Achado P30** — Se o perfil em `clientes` for apagado por qualquer caminho fora de `anonimizar_cliente` (ex.: usuário removido no painel do Supabase), um trigger anonimiza os pedidos do mesmo jeito.
- **Limite conhecido** — Quem exclui a conta e cria outra com o mesmo e-mail recomeça a contagem do cupom com limite por cliente (custo alto; contar por telefone/e-mail conflitaria com a minimização de dados).
