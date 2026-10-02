# [342] Servidor: `cliente_id` no `criarPedido`, regra 9-A e limite por cliente, `limite_por_cliente` no cupom, histórico e trava de exclusão

**crítica:** SIM (TDD red-first)
**vetor:** V4 (valor de cupom · autorização · PII)
**Mundo:** vitrine pública | painel | auth
**Depende de:** 341; 336/337 (`src/lib/actions/cliente.ts`, `excluirConta`, `queries/clientes.ts`, `sanitizarNext` — Marco B)
**Spec:** specs/cliente-vinculo-pedido.md
**Plano:** P27 (caso em `pedido.test.ts`) → P28 (executar, fatia C-servidor)

## Objetivo
Server Actions e queries passam a derivar `cliente_id` da sessão, aplicar a regra 9-A e o limite por cliente
com a mesma verdade da RPC, aceitar `limite_por_cliente` no cupom, listar o histórico do cliente e traduzir
`pedido_em_aberto` na exclusão de conta.

## Escopo
- [ ] `src/lib/actions/pedido.ts` (`criarPedido`): `getUser()` (nunca `getSession`/payload); `cliente_id` só se há perfil em `clientes` e e-mail confirmado (decisão 18), senão null; lojista/admin com perfil recebe `cliente_id` normalmente (decisão 15). Chamar a RPC de 18 args com `p_cliente_id`. Após `validarUsoCupom` (`pedido.ts:~501`): cupom com `limite_por_cliente` + convidado → `desconto = 0`, `p_cupom_id` null, sem `cupom_codigo`, pedido segue; logado → contar usos (loja+cliente+código) e zerar se atingido. Desconto anulado pela RPC detectado como hoje no esgotamento global.
- [ ] `src/lib/actions/revisarCarrinho.ts`: mesma regra no `VereditoCupom { valido: false; mensagem }` — "Entre na sua conta para usar este cupom" (convidado) e "Você já usou este cupom o máximo de vezes permitido." (limite). Nenhum estado novo de cupom.
- [ ] Utilitário único da regra (ex.: `src/lib/utils/cupomPorCliente.ts` ou em `lib/validacoes/`) usado por `criarPedido` **e** `revisarCarrinho` — sem duplicar a lógica.
- [ ] Schema do cupom em `src/lib/validacoes/`: `limite_por_cliente: z.number().int().min(1).max(1000).nullable()`; `criarCupom`/`atualizarCupom` em `src/lib/actions/cupom.ts` gravam a coluna (`.strict()`, escopo `loja_id`). `admin-cupom` não muda e seu update não toca a coluna.
- [ ] `listarPedidosDoCliente` em `src/lib/supabase/queries/pedidos.ts`: client da sessão, `id, loja_id, status, total, criado_em, token_acesso, lojas(nome, slug)`, `order criado_em desc`, 20 por página.
- [ ] Perfil + até 3 endereços para o checkout em `src/lib/supabase/queries/clientes.ts` (reusar a query do Marco B se já existir).
- [ ] `excluirConta` (`src/lib/actions/cliente.ts`): erro `pedido_em_aberto` → "Aguarde a entrega dos seus pedidos em aberto para excluir a conta."; outros erros genéricos, detalhe só no log.
- [ ] Regenerar `src/lib/database.types.ts` só após o gate de migration (P31); até lá, tipagem local mínima documentada.

## Fora de escopo
- UI do checkout, `FormCupom`/`CuponsClient`, página `/minha-conta/pedidos` (343). Banco (341).

## Reuso esperado
- `buscarCupomPorCodigo(svc, loja_id, …)`, `validarUsoCupom`, bloco de cupom `pedido.ts:494-518`.
- `VereditoCupom` (`revisarCarrinho-contrato.ts:49`), `schemaPayloadPedido` **inalterado**.
- `listarPedidosDoDono` como modelo de query; `excluirConta` do Marco B (estender).

## Segurança
- `cliente_id` só de `getUser()`; `schemaPayloadPedido` `.strict()` recusa `cliente_id` no payload.
- Desconto e total recalculados no servidor; RPC é a palavra final (corrida → valor do servidor).
- Histórico sem `service_role`; RLS de 341 é a barreira.

## RED obrigatório (P27, antes do código)
- [ ] `src/lib/actions/pedido.test.ts` (só casos novos): convidado + cupom com limite → `desconto = 0` e resposta com o motivo de entrar; logado no limite → `desconto = 0`, pedido criado; logado com usos → desconto aplicado; payload com `cliente_id` → recusado; RPC recebe `p_cliente_id = getUser().id` (ou null sem perfil / e-mail não confirmado); cupom da loja X na loja Y → sem desconto.
- [ ] `revisarCarrinho` test: mensagens 9-A e de limite no slot `valido: false`.
- [ ] `src/lib/actions/cliente.test.ts` (estendido): pedido em aberto → recusa com a mensagem, nada apagado; todos finais → exclui.
- [ ] schema do cupom: 0 e 1001 recusados, null aceito.

## Critério de aceite
- [ ] RED vermelho capturado, depois verde; `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes.
- [ ] **Gate C3:** `git diff --stat main -- 'src/lib/actions/pedido*.test.ts' 'tests/migrations/pedidos_*.test.ts'` mostra só adição de caso; `schemaPayloadPedido`/`schemaCheckout` sem diff.

## Behaviors do spec que fecha
Checkout: convidado como hoje (servidor); `cliente_id = auth.uid()`; lojista/admin com perfil; cupom sem limite; convidado com cupom com limite; logado com usos; logado no limite; preview não autoritativo. Exclusão: as quatro. Cupons (painel): criar/editar com limite (servidor), outra loja, mudar limite, admin não muda.
