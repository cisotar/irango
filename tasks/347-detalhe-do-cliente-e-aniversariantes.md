# [347] Detalhe do cliente + filtro "Aniversariantes do mês"

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 346
**Spec:** specs/cliente-base-do-lojista.md

## Objetivo
Página `/painel/clientes/[id]` consumindo `buscarClienteDaLoja` (autorização já no banco, 346) e o filtro de aniversariantes por `mesDeReferencia` no fuso da loja.

## Escopo
- [ ] `src/lib/utils/mesDeReferencia.ts`: `mesDeReferencia(agora: Date, timezone: string): number` + teste ao lado (D2)
- [ ] Zod de `?aniversariantes=1` (qualquer outro valor = sem filtro); Server Component da lista passa `mes = mesDeReferencia(new Date(), loja.timezone)` como `p_mes`; botão "Aniversariantes do mês"/"Todos"; empty state "Nenhum aniversariante neste mês."
- [ ] `src/lib/supabase/queries/pedidos.ts`: `listarPedidosDoClienteNaLoja(client, clienteId)` com client da sessão (RLS `pedidos_acesso_lojista`) + `.eq("cliente_id", id)`
- [ ] `src/app/(painel)/painel/(bloqueavel)/clientes/[id]/page.tsx`: `schemaUuid` → `notFound()` sem bater no banco; 0 linhas de `buscarClienteDaLoja` → `notFound()` (mesma resposta para inexistente e alheio); bloco de dados + `TabelaPedidos` com links para `/painel/pedidos/[id]`
- [ ] `queries/clientes.test.ts`: só repasse de parâmetros (`p_mes`, `p_limite`, `p_offset`, `p_cliente_id`)

## Fora de escopo
Funções/migration (346); mudar status de pedido no detalhe; busca, exportação, métricas em dinheiro.

## Reuso esperado
- `schemaUuid`, `CabecalhoPagina`, `Card`, `TabelaPedidos`, `paraLinhaPedido`, `BadgeStatusPedido` (estático), `buscarLojaDoDono`
- Utilitários de fuso existentes em `src/lib/utils/` (grep por timezone/fuso antes de criar `Intl` à mão)

## Segurança
- Sem autorização nova: escopo vem da função de 346 e da RLS existente de pedidos. Nenhum valor calculado (total lido de `pedidos.total`). Sem `service_role`.

## Testes (D2) — `src/lib/utils/mesDeReferencia.test.ts`
- [ ] Virada de mês: 31/jan 23h em `America/Sao_Paulo` (= 1/fev UTC) → 1
- [ ] Mesmo instante em `UTC` → 2
- [ ] Meio do mês trivial; dezembro → 12 (não 0)

## Behaviors do spec que fecha
Lista: "Aniversariantes do mês". Detalhe: todos os 6 (dados da allowlist, 404 anti-IDOR, não-UUID → 404, pedidos só da loja, lojista-cliente vê a mesma projeção, link para pedido). Se o spec ficar 100% `[x]`, `git mv` para `specs/arquivo/`.

## Critério de aceite
- [ ] Detalhe de cliente de outra loja e id inexistente → mesma resposta 404
- [ ] Filtro mostra só aniversariantes do mês no fuso da loja, com paginação
- [ ] tsc, lint, test, build verdes

## Dúvidas
- Criticidade: marquei NÃO porque a autorização (função + RLS de pedidos) é de 346 e aqui só se consome. Porém o detalhe é a superfície de IDOR (o `notFound()` e o `.eq("cliente_id")` vivem aqui). Se o orquestrador preferir tratar como SIM, o RED seria um teste do Server Component garantindo 404 idêntico para id alheio e inexistente.
- RN-D07 ("29/02 aparece em fevereiro") já é natural por `extract(month)`; caso de teste opcional em 346.

## Respostas do usuário (2026-10-03)
- **D1/D2 (pedidos no detalhe)** — (a): parametrizar `TabelaPedidos` com props opcionais para ocultar o `MenuStatusPedido` (status só via `BadgeStatusPedido`), ocultar a coluna Cliente e exibir a data. Defaults preservam o comportamento atual de `/painel/pedidos`.
