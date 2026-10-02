# [346] Base de clientes do lojista: funções no banco + lista `/painel/clientes`

**crítica:** SIM (TDD red-first)
**vetor:** V5 (escopo de loja é autorização; PII de cliente cross-loja)
**Mundo:** painel
**Depende de:** — (Marcos B e C em produção: `clientes`, `pedidos.cliente_id`)
**Spec:** specs/cliente-base-do-lojista.md

## Objetivo
Migration com `clientes_da_loja` e `cliente_da_loja` (`SECURITY DEFINER`, escopo por `auth.uid()`, `RETURNS TABLE` fechado = allowlist) + índice, queries de RPC e a lista paginada em `/painel/clientes`, sem filtro de aniversariantes.

## Escopo
- [ ] `supabase/migrations/<ts>_clientes_da_loja.sql`: as duas funções conforme spec (8 colunas; `SET search_path = ''`; `STABLE`; `REVOKE EXECUTE FROM public, anon`; `GRANT EXECUTE TO authenticated`; loja via `lojas.dono_id = auth.uid()`, sem parâmetro de loja; `p_mes` já aceito, fora de 1..12 → 22023; `LIMIT least(p_limite,100) OFFSET greatest(p_offset,0)`; agregados excluem `cancelado`, cliente só com cancelados fica com 0 / null; ordem `ultimo_pedido_em DESC, c.id`)
- [ ] Índice parcial `pedidos_loja_id_cliente_id_idx ON pedidos(loja_id, cliente_id) WHERE cliente_id IS NOT NULL`
- [ ] Regenerar `src/lib/database.types.ts`
- [ ] `src/lib/supabase/queries/clientes.ts`: `listarClientesDaLoja(client, { mes?, limite, offset })` e `buscarClienteDaLoja(client, clienteId)` via `client.rpc`, client da sessão; erro logado só com código
- [ ] Zod de paginação (`pagina`, teto 100) em `src/lib/validacoes/`
- [ ] `src/app/(painel)/painel/(bloqueavel)/clientes/page.tsx` + `ClientesClient.tsx` + `components/painel/TabelaClientes.tsx` (colunas Nome-link, Telefone, Pedidos, Último pedido no fuso da loja, Aniversário dd/mm, Promoções), empty state, "Carregar mais" de 50
- [ ] Item "Clientes" (ícone `Users`) na `NavPainel`

## Fora de escopo
Filtro "Aniversariantes do mês" e `mesDeReferencia` (347); página de detalhe (347); Política de Privacidade (345); entrada em `seguranca.md` (escriba).

## Reuso esperado
- `buscarLojaDoDono`, padrão de `pedidos/page.tsx`, `TabelaPedidos` (marcação), `CabecalhoPagina`, `Card`, `Button`, `Table` do shadcn se existir
- Padrão das funções de `clientes` em `schema.md`; padrão VIEW-COLS de `pentest_area2` para o teste de allowlist
- `createTestDb()` / `asAnon` / `asUser` de `tests/helpers/pglite.ts`

## Segurança
- PII sai do banco só pela função; RLS de `clientes` NÃO é ampliada; sem `service_role`; sem `dangerouslySetInnerHTML`
- Nenhum valor monetário

## RED (D1) — `tests/migrations/clientes_base_do_lojista_escopo.test.ts`, capturar `FAIL` antes do código
- [ ] Lojista X: `clientes_da_loja()` → 0 linhas de cliente que só pediu em Y; `cliente_da_loja(<cliente de Y>)` → 0 linhas
- [ ] Convidado (`cliente_id` null) não entra
- [ ] Colunas retornadas = allowlist exata (`cliente_id, nome, telefone, dia_aniversario, mes_aniversario, aceita_marketing, total_pedidos, ultimo_pedido_em`), sem `email`/ano/`data_nascimento`
- [ ] `asAnon` → erro de permissão ou 0 linhas (ambas as funções)
- [ ] Usuário só-cliente (sem loja) → 0 linhas
- [ ] Cliente anonimizado (cliente_id zerado pelo trigger) some
- [ ] `from("clientes")` como lojista continua 0 linhas
- [ ] Cancelados excluídos de `total_pedidos`/`ultimo_pedido_em`; cliente só com cancelados permanece com 0
- [ ] `p_limite` > 100 é truncado a 100; `p_mes` = 13 → erro 22023

## Behaviors do spec que fecha
Lista: "só clientes com ≥1 pedido…", "Lojista A nunca vê…", "só as colunas da allowlist…", "Visitante sem sessão…", "Usuário logado sem loja…", "Carregar mais…", "clica no nome… vai para o detalhe". Detalhe: "abre o detalhe… vê os dados da allowlist" e "cliente que nunca pediu… 404" ficam garantidos no banco aqui, mas o checkbox é marcado em 347 (junto com `notFound()`).

## Critério de aceite
- [ ] Testes D1 vermelhos capturados, depois verdes
- [ ] tsc, lint, test, build verdes
- [ ] Migration aplicada no cloud só com autorização (`npx supabase migration list`)

## Respostas do usuário (2026-10-03)
- **D4 (telefone)** — formatado `(DD) NNNNN-NNNN` e clicável, abrindo conversa no WhatsApp (`wa.me`) — reusar o padrão de `linkWhatsappLoja` (só dígitos, `urlHttpsSegura`, fail-closed). Vale para a lista e o detalhe (347).
- **D4b (DDD obrigatório)** — o telefone do cliente passa a exigir DDD de 2 dígitos ao ser gravado. Com 55 prefixado, todo telefone novo vira link `wa.me`. Abrangência (b): zod do perfil do cliente (`cliente.ts`) e do checkout (`pedido.ts`/`checkout.ts`); CHECK do banco inalterado. Telefone legado sem DDD é exibido como gravado, sem link.
- **D9 (cancelados)** — aprovado: cancelados são EXIBIDOS mas NÃO contabilizados, de forma explícita.
  - `RETURNS TABLE` ganha `total_cancelados` (int) e `ultimo_pedido_status` (status do pedido mais recente de qualquer status); `ultimo_pedido_em` passa a ser o mais recente de QUALQUER status. `total_pedidos` segue excluindo cancelados.
  - Lista: "N pedidos · M cancelados" (o "· M cancelados" só quando M>0); "Último pedido" só data `dd/mm/aaaa`, com "(cancelado)" quando `ultimo_pedido_status = 'cancelado'`. Coluna sempre tem data para quem tem ≥1 pedido.
  - RED adicional: cliente só com cancelados → `total_pedidos=0`, `total_cancelados=N`, `ultimo_pedido_em` preenchido, status `cancelado`; cliente sem pedido algum não entra na base.
