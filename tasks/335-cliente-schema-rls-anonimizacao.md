# [335] Schema de cliente: `clientes`, `clientes_enderecos`, RLS e funções de perfil/anonimização

**crítica:** SIM (TDD red-first)
**vetor:** V2 (dados · RLS · PII)
**Mundo:** infra
**Depende de:** — (Marco A já no `main`: `papeis_usuario`, `atribuir_papel_inicial`, trigger `lojas_exige_dono_lojista`)
**Spec:** specs/cliente-identidade.md
**Branch:** feat/clientes-identidade
**Plano:** `plan/loop-cadastro-de-clientes.md` P12 (migrar) → P13 (seed) → P14 (RED B1/B2)

## Objetivo
Criar as tabelas do perfil de cliente com RLS fail-closed e as quatro funções `SECURITY DEFINER` que são a única
via de criar perfil, acrescentar papel `cliente` e anonimizar. Base de dados de todo o Marco B.

## Behaviors do spec que esta issue fecha
- §Modelos de Dados: `public.clientes`, `public.clientes_enderecos`, funções `adicionar_papel_cliente`,
  `criar_perfil_cliente`, `anonimizar_cliente`, `anonimizar_clientes_inativos`.
- Camada banco de: "Ver os próprios dados e nenhum dado de outro cliente" (RLS); "Tentar mudar `id`, `criado_em`,
  `ultimo_acesso_em`, `consentimento_*` … → sem efeito/erro" (grant por coluna); "4º endereço → recusado" (trigger);
  "Editar endereço próprio; id alheio → 0 linhas" (RLS); "O primeiro endereço nasce padrão" (RPC); "último endereço
  não pode ser removido" (trigger BEFORE DELETE, exceto cascade/service_role); índice único parcial `padrao`;
  "Lojista/admin ativando o perfil continua com `lojista`" e "Ativar perfil nunca concede `lojista`"
  (`adicionar_papel_cliente` só acrescenta `cliente`); "Sem aceite → nenhuma linha" e "Sem endereço → recusado"
  (camada RPC); trigger de idade 18+ (camada banco do behavior de nascimento).
- RN-02, RN-04, RN-08 (banco), RN-10, RN-11, RN-12, RN-17.

## Escopo
- [ ] Migration `supabase/migrations/<ts>_clientes.sql` (depois de `20261001120000_papel_cliente.sql`):
  `clientes` (colunas, CHECKs de nome 1–120 e telefone regex de `pedido.ts:112`, defaults) e
  `clientes_enderecos` (CHECKs de tamanho iguais a `schemaEnderecoCheckout`; rótulo 1–30 sem `\n`/`\r`; uf 2;
  complemento ≤100; índice único parcial `(cliente_id) where padrao`).
- [ ] Trigger BEFORE INSERT/UPDATE de idade em `clientes`: ≥18 em `current_date`, não futura, ≤120 anos, com
  mensagem estável ("Você precisa ter 18 anos ou mais…").
- [ ] Trigger BEFORE INSERT de teto 3 com `pg_advisory_xact_lock` por `cliente_id`
  (molde `20260927124000_modais_sazonais_teto_por_loja.sql`).
- [ ] Trigger BEFORE DELETE que recusa remover o último endereço quando o autor é usuário final
  (cascade de `clientes` e `service_role` passam).
- [ ] RLS ligada + `revoke all … from anon, authenticated` em ambas; `clientes`: SELECT/UPDATE próprio,
  `grant update (nome, telefone, data_nascimento, aceita_marketing)`, INSERT/DELETE sem grant;
  `clientes_enderecos`: CRUD próprio com USING e WITH CHECK `cliente_id = (select auth.uid())`.
- [ ] Funções com `set search_path = ''` e `revoke execute … from public, anon, authenticated`:
  `adicionar_papel_cliente` (idempotente, mesmo lock de `atribuir_papel_inicial`, só `cliente`),
  `criar_perfil_cliente` (transação única: papel + perfil + 1º endereço `padrao = true`; recusa perfil existente;
  `p_versao_termos` obrigatório), `anonimizar_cliente` (DELETE em `clientes`, não toca `papeis_usuario`/`lojas`/`auth`),
  `anonimizar_clientes_inativos` (24 meses de `ultimo_acesso_em`).
- [ ] `supabase/seed.sql`: clientes fictícios A (3 endereços) e B (1), sem dado real (P13).
- [ ] Regenerar `src/lib/database.types.ts`.

## Fora de escopo
- Server Actions e zod (336/337). Nenhum `cliente_id` em `pedidos` (Marco C). Agendador da anonimização.
- `npx supabase db push` — só com autorização humana explícita, antes do merge (ver CLAUDE.md).

## Reuso esperado
- Molde de revoke/grant: `20260923060457_pedidos_remove_insert_publico.sql`.
- Molde de teto com lock: `20260927124000_modais_sazonais_teto_por_loja.sql`.
- Lock e convenções de `atribuir_papel_inicial` (`20261001120000_papel_cliente.sql`) — não recriar lógica de papel.
- `tests/helpers/pglite.ts` (`createTestDb`, `asAnon`/`asUser`/`asService`); padrão de
  `tests/migrations/pentest_area2_isolamento.test.ts`.

## Segurança
- PII nova (nome, telefone, nascimento, endereços): RLS antes de produção (`seguranca.md` §2). anon = 0, lojista = 0.
- Default privileges do projeto dão EXECUTE a todos (`20260614008500:31`): o revoke é obrigatório e testado.

## RED (fatias B1/B2 do plano — escrever antes da migration, capturar `FAIL`)
`tests/migrations/clientes_rls_isolamento.test.ts`:
- [ ] `asUser(A)` SELECT `clientes` → 1 linha (a própria); `asUser(B)` → 0 linhas de A; `asAnon` → 0; lojista autenticado → 0.
- [ ] UPDATE/DELETE cross-cliente em `clientes` e `clientes_enderecos` → 0 rows; UPDATE de `id`/`criado_em`/
  `ultimo_acesso_em`/`consentimento_*` por `asUser` → erro de permissão.
- [ ] INSERT direto em `clientes` por `asUser` → negado (só RPC).
- [ ] INSERT em `clientes_enderecos` com `cliente_id` ≠ `auth.uid()` → erro.
- [ ] 4º INSERT em `clientes_enderecos` do mesmo cliente → erro; 2º `padrao = true` → erro.
- [ ] DELETE do último endereço por `asUser` → erro; cascade de `anonimizar_cliente` → passa.
- [ ] `asUser(A)` UPDATE `data_nascimento` para 17 anos e 364 dias → erro com fragmento da mensagem afirmado;
  exatamente 18 anos hoje → aceito; data futura e >120 anos → erro.
- [ ] `criar_perfil_cliente` sem endereço ou sem versão → erro e 0 linhas em `clientes` e sem papel novo (atomicidade);
  em conta só-lojista → papéis = {lojista, cliente}; nunca acrescenta `lojista` a conta só-cliente.
`tests/migrations/anonimizar_cliente.test.ts`:
- [ ] `anonimizar_cliente`, `criar_perfil_cliente`, `adicionar_papel_cliente`, `anonimizar_clientes_inativos`
  por `asUser`/`asAnon` → permission denied.
- [ ] Após `anonimizar_cliente(uid)`: 0 linhas em `clientes`/`clientes_enderecos` para `uid`; `papeis_usuario` e
  `lojas` intactos.
- [ ] `anonimizar_clientes_inativos()` remove só perfis com `ultimo_acesso_em` > 24 meses.

## Critério de aceite
- [ ] RED capturado com `FAIL` antes da migration; depois `npx vitest run tests/migrations` verde.
- [ ] `npx supabase migration list` mostra a migration com Remote vazia até o push autorizado.
- [ ] `tsc`, lint, suíte e build verdes; nenhum teste existente alterado.

## Dúvidas
- Trigger BEFORE DELETE "exceto quando o autor é usuário final": o spec não fixa o mecanismo (ex.: `current_user`/
  `auth.role()` vs `pg_trigger_depth()` para o cascade). Decidir no `planejar`/`migrar`; o RED só fixa o comportamento.
