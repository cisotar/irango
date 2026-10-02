# [343] Vitrine e telas: checkout logado, "Entrar" junto do cupom, `/minha-conta/pedidos`, campo de limite no `FormCupom`

**crítica:** SIM (TDD red-first)
**vetor:** V4 (regressão de valor no checkout do convidado · exposição de pedido)
**Mundo:** vitrine pública | painel
**Depende de:** 342; 339 (telas do cliente, `/conta/entrar`, layout de `/minha-conta` — Marco B)
**Spec:** specs/cliente-vinculo-pedido.md
**Plano:** P29 (executar, fatia C-vitrine)

## Objetivo
Pré-preencher o checkout para o cliente logado sem mudar nada para o convidado, levar ao login e voltar com o
carrinho intacto, mostrar o histórico e expor o limite por cliente no painel de cupons.

## Escopo
- [ ] `src/app/(publica)/loja/[slug]/pedido/page.tsx`: Server Component lê perfil + ≤3 endereços (query de 342, client da sessão) e passa props opcionais.
- [ ] `CheckoutWizard`, `EtapaEntrega`, `EtapaPagamento`, `ResumoValores`: props opcionais `perfilCliente?`, `enderecosCliente?`; sem prop = hoje. Nome/telefone pré-preenchidos e editáveis.
- [ ] `SeletorEnderecoCliente` (shadcn `RadioGroup`): ≤3 rótulos, padrão pré-selecionado, "Usar outro endereço"; preenche `FormEndereco` (edição vale só para o pedido).
- [ ] `LinkEntrarCheckout`: só sem sessão de cliente, junto do campo de cupom e na mensagem 9-A; `/conta/entrar?next=/loja/<slug>/pedido` (sanitizado pelo Marco B); "Voltar para <loja>". Carrinho segue em `sessionStorage`.
- [ ] `src/app/(cliente)/minha-conta/pedidos/page.tsx`: data, loja, status, total, "Ver pedido" (`/loja/[slug]/confirmacao?pedido=…&token=…`); vazio "Você ainda não fez pedidos com sua conta."; 20 por página + "Carregar mais"; link "Pedidos" em `/minha-conta`.
- [ ] `FormCupom`: campo "Limite de usos por cliente" (vazio = sem limite) + aviso inline "Este cupom só vale para clientes que entrarem na conta. Quem compra sem conta não recebe o desconto."; `CuponsClient`: "Limite por cliente: N".

## Fora de escopo
- "Salvar este endereço", recompra, cupom no admin, base de clientes (Marco D). Lógica de cupom/valor (342).

## Reuso esperado
- `useEnviarPedido`, `useCarrinho` sem mudança; `FormEndereco`; slot `VereditoCupom` em `EtapaPagamento`.
- `BadgeStatusPedido` e formatadores de moeda/data existentes (grep em `components/` e `lib/utils/` antes de criar); shadcn `Card`, `Button`, `RadioGroup` (via CLI, não editar `components/ui/`).

## Segurança
- Pré-preenchimento é só UX; payload revalidado no servidor, frete recalculado do CEP.
- Sem `dangerouslySetInnerHTML`. Histórico com client da sessão.

## RED / gate
- [ ] Teste (Vitest, sem jsdom) da montagem do `next` do `LinkEntrarCheckout` e da paginação/mapeamento do histórico, vermelho antes.
- [ ] **Gate C3:** suíte de checkout verde sem teste existente alterado (`git diff --stat main -- 'src/lib/actions/pedido*.test.ts' 'tests/migrations/pedidos_*.test.ts'` só adições).
- [ ] `grep -r dangerouslySetInnerHTML src/` sem ocorrência nova.

## Critério de aceite
- [ ] Convidado: mesmo fluxo, campos e payload de hoje.
- [ ] Logado: dados pré-preenchidos, troca de endereço, pedido nasce com `cliente_id`.
- [ ] "Entrar" → login → volta ao checkout com carrinho intacto (mesma aba).
- [ ] `/minha-conta/pedidos` sem sessão → `/conta/entrar?next=/minha-conta/pedidos`; com sessão → só os próprios.
- [ ] 4 comandos verdes (tsc, lint, test, build).

## Behaviors do spec que fecha
Checkout: pré-preenchimento, troca de endereço, "Entrar". Meus pedidos: os quatro. Cupons (painel): aviso e listagem. Com 341/342, marca `[x]` em todos os behaviors restantes do spec.
