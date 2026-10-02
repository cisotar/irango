# [341] Banco do vínculo cliente ↔ pedido: `pedidos.cliente_id`, RPC de 18 args, RLS de leitura do cliente, `cupons.limite_por_cliente`, anonimização e expurgo

**crítica:** SIM (TDD red-first)
**vetor:** V4 (RLS de pedido · valor de cupom · PII no pedido)
**Mundo:** infra
**Depende de:** 335 (tabela `clientes`, `anonimizar_cliente`, `anonimizar_clientes_inativos` — Marco B, ainda não no `main`)
**Spec:** specs/cliente-vinculo-pedido.md
**Branch:** feat/clientes-pedidos
**Plano:** `plan/loop-cadastro-de-clientes.md` P25 (migrar) → P26 (seed) → P27 (RED C1/C2/C4)

## Objetivo
Entregar toda a camada de banco do Marco C, só expand: coluna `cliente_id` imutável em `pedidos`, nova versão
de `criar_pedido` com `p_cliente_id` e limite de cupom por cliente travado na transação, policies SELECT do
cliente, coluna `cupons.limite_por_cliente`, extensão de `anonimizar_cliente` (decisões 3 e 16) e
`expurgar_pedidos_antigos()`.

## Escopo
- [ ] Migration `<ts>_pedidos_cliente_id.sql` (após `20261002120000_clientes.sql`): `cliente_id uuid null references public.clientes(id) on delete set null`; índice parcial `pedidos_cliente_id_criado_em_idx (cliente_id, criado_em desc) where cliente_id is not null`; trigger BEFORE UPDATE no molde de `pedidos_transicao_status` (SECURITY INVOKER, whitelist `service_role`/`postgres`/`supabase_admin`) recusando `new.cliente_id is distinct from old.cliente_id`.
- [ ] Policies **só SELECT** `to authenticated`: `pedidos_select_cliente`, `itens_pedido_select_cliente`, `itens_pedido_opcionais_select_cliente` (tabela do spec). Não tocar `pedidos_acesso_lojista`; nenhuma policy de escrita nova; `anon` sem SELECT.
- [ ] Migration `<ts>_cupons_limite_por_cliente.sql`: `limite_por_cliente int null check (limite_por_cliente is null or limite_por_cliente between 1 and 1000)`. RLS de `cupons` inalterada.
- [ ] Migration `<ts>_rpc_criar_pedido_cliente.sql`: `criar_pedido` de **18** argumentos (17 atuais + `p_cliente_id uuid` por último), `security invoker`. **A versão de 17 NÃO é dropada** (resposta P1 do usuário; remoção na issue 344). Ordem: (1) dedupe `idempotency_key`; (2) loja ativa; (3) cupom por cliente — `p_cliente_id` null + cupom com limite → anula desconto, zera `p_cupom_id`/`cupom_codigo`, recalcula total; senão `pg_advisory_xact_lock(hashtext(p_cupom_id::text || p_cliente_id::text))` + `count(*)` em `pedidos` por `loja_id`+`cliente_id`+`cupom_codigo` (todos os status, inclusive cancelado — RN-C06); `>= limite` → anula desconto (D5); (4) trava global `usos_contagem` (sem mudança); (5) INSERT com `cliente_id`. `p_cliente_id` não nulo inexistente em `clientes` → `raise 'cliente_inexistente'`.
- [ ] Estender `anonimizar_cliente(p_usuario)`: `raise 'pedido_em_aberto'` se houver pedido com status fora de `entregue`/`cancelado`; senão `update pedidos set nome_cliente='Cliente removido', telefone_cliente=null, endereco_entrega=null, observacoes=null, cliente_id=null`; zerar `itens_pedido.observacao` desses pedidos; depois o delete do Marco B. Valores, status, itens, `cupom_codigo` intactos.
- [ ] `anonimizar_clientes_inativos()` captura `pedido_em_aberto` por cliente e segue o laço.
- [ ] `expurgar_pedidos_antigos()` SECURITY DEFINER, `search_path = ''`: apaga pedidos em status final com `criado_em < now() - interval '5 years'` (cliente ou convidado — P2); conferir cascade de itens/opcionais; retorna a quantidade. `revoke execute from public, anon, authenticated`. Sem agendador.
- [ ] Seed fictício (P26): pedidos de cliente A, um de convidado, cupom com `limite_por_cliente = 1`.
- [ ] Atualizar `references/schema.md` (`pedidos`, `cupons`, funções) — via `escriba`.

## Fora de escopo
- Server Actions, queries e UI (342, 343). Remoção da RPC de 17 args (344).
- Correções da `tasks/330` (só não ampliar). Tabela de usos por cliente (P3: aceito como limite conhecido). Devolver uso no cancelamento. `db push` (gate P31, autorização humana).

## Reuso esperado
- Molde do trigger `pedidos_transicao_status` (`20260930130000`) e whitelist de sistema.
- Corpo atual da RPC (`20260920127000_rpc_criar_pedido_preco_original.sql`) e precedente de overload da `tasks/266`.
- `anonimizar_cliente` / `anonimizar_clientes_inativos` do Marco B (estender, não recriar).
- `tests/helpers/pglite.ts` (`createTestDb`, `asAnon`/`asUser`/`asService`); `tests/migrations/pedidos_protege_valor.test.ts` como modelo.

## Segurança
- Valor monetário: desconto/total recalculados e travados na RPC; contagem + consumo na mesma transação (RN-C07).
- `cliente_id` imutável para usuário (RN-C03/C04). Policies novas só SELECT; não ampliam a 330.
- SECURITY DEFINER só `service_role`, `set search_path = ''`.

## RED obrigatório (P27) — capturar `FAIL` antes de qualquer migration de produção
**C1 — `tests/migrations/pedidos_cliente_id_rls.test.ts`**
- [ ] `asUser(A)` lê só `pedidos`/`itens_pedido`/`itens_pedido_opcionais` com `cliente_id = A`; nada de B.
- [ ] pedido de convidado invisível a qualquer cliente, inclusive ao que tem o mesmo telefone.
- [ ] `asUser(A)` UPDATE de `cliente_id` em pedido de convidado → 0 rows/erro; lojista UPDATE de `cliente_id` → recusado pelo trigger.
- [ ] lojista continua lendo só a própria loja; `anon` = 0 linhas; nada do que a 330 restringe é ampliado.
**C2 — `tests/migrations/cupons_limite_por_cliente.test.ts`**
- [ ] 2º pedido do mesmo `cliente_id` com `limite_por_cliente = 1` → `desconto = 0`, `usos_contagem` não incrementa.
- [ ] convidado + cupom com limite → `desconto = 0`, `cupom_codigo` null, `usos_contagem` não incrementa, pedido criado.
- [ ] convidado + cupom sem limite → regra global idêntica a hoje.
- [ ] pedido cancelado conta como uso; retry com mesma `idempotency_key` não conta outro uso; contagem filtrada por `loja_id`.
- [ ] CHECK recusa `limite_por_cliente` 0 e 1001; `p_cliente_id` inexistente → `cliente_inexistente`.
- [ ] RPC de 17 args continua existindo e funcionando (convidado).
**C4 — `tests/migrations/anonimizar_cliente.test.ts` (estendido, só adição de caso)**
- [ ] após `anonimizar_cliente(uid)`: `nome_cliente = 'Cliente removido'`; telefone, endereço, observações, `cliente_id` null; `subtotal`/`total`/`itens_pedido` intactos; trigger de status não bloqueia.
- [ ] com pedido em status não final → `pedido_em_aberto`, nada muda.
- [ ] `anonimizar_clientes_inativos` pula quem tem pedido em aberto e processa os demais.
- [ ] `expurgar_pedidos_antigos`: apaga só final > 5 anos; `asUser` → permission denied.

## Critério de aceite
- [ ] RED acima capturado vermelho e depois verde; `npx vitest run tests/migrations` verde.
- [ ] Gate C3: `git diff --stat main -- 'tests/migrations/pedidos_*.test.ts'` só adições; nenhuma asserção existente alterada.
- [ ] `npx supabase migration list` mostra as migrations novas só-local (deploy é P31).

## Behaviors do spec que fecha (marcar `[x]` no PR junto com 342/343)
Parciais de banco de: cliente_id na criação; cupom com/sem limite; RLS do histórico; "pedido anonimizado nunca aparece"; exclusão bloqueada (lado banco); "mudar o limite vale para os próximos pedidos".

## Dúvidas
- **Três overloads vivos.** `tasks/266` (aberta) mostra que a versão de **16** args ainda existe ao lado da de 17. Com a de 18, serão três. A resolução por nome do Postgres prefere a assinatura com menos defaults: se `p_cliente_id` tiver `default null`, uma chamada que o omita cai na de 17 e perde o vínculo/limite em silêncio. Proposta: `p_cliente_id` **sem default** e a action sempre envia o argumento (null explícito para convidado), + caso de teste que chama com os 18 nomes e confere que a de 18 foi usada (`cliente_id` gravado). Confirmar com o usuário.
- O spec ("Modelos de Dados" e "Código afetado") ainda diz `drop` da de 17 na mesma migration; a seção "Respostas do usuário" (P1) prevalece. O spec precisa ser corrigido no texto pelo `escriba`/autor.
