# [014] Server Action `criarPedido` (recálculo autoritativo)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 008, 009, 011, 012, 013, 022, 024, 025
**Spec:** specs/spec_irango_mvp.md (RN-04, RN-05, RN-06, RN-09)

## Objetivo
Server Action que cria o pedido ignorando todo valor monetário do client, recalculando subtotal, frete, desconto e total a partir do banco; valida cupom e horário; insere pedido + itens (snapshot) e incrementa o uso do cupom — tudo de forma atômica.

## Escopo
- [ ] Criar `src/lib/actions/pedido.ts` (`'use server'`)
- [ ] Validar payload com `schemaPayloadPedido` (022) — descartar qualquer valor monetário do client
- [ ] Buscar produtos por id (`buscarProdutosPorIds` — 024); recusar item indisponível ou de outra loja
- [ ] `subtotal` via `calcularSubtotal` (012) com preço REAL do banco
- [ ] `taxaEntrega` via `calcularFrete` (008) com zonas do banco (025)
- [ ] Revalidar cupom via `validarCupom` (013); `desconto` recalculado
- [ ] `total` via `calcularTotal` (012)
- [ ] Bloquear se loja fechada via `lojaAberta` (011) — erro "Loja fechada no momento" (RN-09)
- [ ] **DELTA Hotmart** — o gate de assinatura inválida ("Loja indisponível no momento", RN-A7) é adicionado a esta action na **issue 058** (emenda), reusando `assinaturaPermiteAcesso` (056). Não implementar aqui; ver 058.
- [ ] INSERT em `pedidos` (com `token_acesso`) + `itens_pedido` (snapshot `nome`/`preco`) + UPDATE `cupons.usos_contagem` — atômico (RPC/transação Postgres)
- [ ] Retornar `{ id, token_acesso }` ao client
- [ ] Erros internos genéricos (seguranca.md §14)

## Fora de escopo
UI do checkout (036). Leitura da confirmação (026 + 037).

## Reuso esperado
- `calcularSubtotal`/`calcularTotal` (012), `calcularFrete` (008), `calcularDesconto` (009), `validarCupom` (013), `lojaAberta` (011), `buscarProdutosPorIds` (024), `buscarZonasAtivas`/`buscarCupom` (025), `schemaPayloadPedido` (022)

## Segurança
- 🔴 Risco mais crítico do marketplace: cliente NUNCA define quanto paga (seguranca.md §10)
- Incremento de uso do cupom na MESMA transação (condição de corrida — RN-06)
- Rate limit ~10/min por IP (seguranca.md §12)
- Snapshot de nome/preço imutável (RN-04)

## Critério de aceite
- [ ] (crítica) Teste vermelho: payload com `total: 0.01` → pedido salvo com total recalculado real; item indisponível → recusado; item de outra loja → recusado; loja fechada → recusado; cupom revalidado e `usos_contagem` incrementado uma vez; itens gravam snapshot de nome/preço
