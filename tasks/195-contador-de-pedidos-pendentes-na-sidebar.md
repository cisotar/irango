# [195] Contador de pedidos pendentes na sidebar

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 194 (redesenho da sidebar)
**Origem:** atrito F9 de `mockups/sidebar-painel.md`, adiado da issue 194.

## Problema

Pedido novo não tem sinal no shell do painel. O lojista precisa abrir
`/painel/pedidos` para descobrir que existe pedido pendente — em horário de
pico, isso é atraso de comanda.

## Por que foi adiado da 194

É o único atrito da sidebar que exige **query nova** (não existe contagem de
pedidos pendentes em `src/lib/supabase/queries/` hoje) mais plumbing nos dois
layouts (lojista e hub admin) mais uma história de **revalidação** — um
contador vencido em tela é pior que nenhum contador.

## Escopo

- [ ] Decidir a estratégia de atualização antes de qualquer código: polling,
      `revalidatePath`/`revalidateTag`, ou Realtime do Supabase. Provavelmente
      merece `arquitetar`, não implementação direta — é uma decisão com
      trade-off de custo (queries repetidas) vs. atraso de sinal.
- [ ] Query escopada por `loja_id`, contando pedidos em estado pendente.
- [ ] `Badge` ao lado de "Pedidos" no `NavPainel.tsx`, com o número também no
      nome acessível (`aria-label="Pedidos, 3 pendentes"` — nunca só cor/ponto,
      design-system §5).
- [ ] Contrato de estado: zero pendentes não renderiza badge; acima de 99
      mostra "99+" com o valor real no `aria-label`.

## Critério de aceite

- [ ] Contador correto por loja (RLS/escopo testado em pglite).
- [ ] Sem contador vencido além do intervalo de revalidação decidido.
- [ ] `aria-label` nunca omite o número.
