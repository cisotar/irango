# [086] Testes de integração — recálculo + validações cruzadas de opcionais

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 085
**Spec:** specs/spec_opcionais.md

## Objetivo
Suíte de integração RED-first que prova, end-to-end (action → RPC → banco), que o recálculo com opcionais é autoritativo e que as validações anti-cross-tenant, por-categoria, ativo e snapshot funcionam.

## Escopo
- [ ] Teste: total recalculado com opcionais bate com `(produto + Σ op×qtd) × qtd_item`, ignorando qualquer valor do cliente
- [ ] Teste: opcional de outra loja → pedido recusado, nada persistido
- [ ] Teste: opcional cuja categoria de opcional não está associada à categoria do produto → recusado
- [ ] Teste: opcional `ativo=false` → recusado
- [ ] Teste: snapshot persistido com `nome_snapshot`/`preco_snapshot` do banco; reprecificar opcional depois não altera o pedido
- [ ] Teste: `ON DELETE SET NULL` mantém o snapshot após deletar o opcional
- [ ] Teste: pedido sem opcionais segue funcionando (regressão do checkout)

## Fora de escopo
- Testes de UI (cobertos por verificação manual nas issues de UI).
- Re-testar unidades já cobertas em 080/082/083/085 (este foca na integração).

## Reuso esperado
- Harness de teste de integração existente (`pedido.test.ts`, `frete.test.ts`) — mesma infra de DB local/seed.
- Fixtures de loja/produto/categoria existentes.

## Segurança
- Estes testes SÃO a rede de segurança do recálculo monetário e do isolamento entre lojas (seguranca.md §10) — devem falhar (RED) antes da implementação de 085 e passar (GREEN) depois.

## Critério de aceite
- [ ] (crítica) Todos os cenários acima escritos RED-first e verdes após 085.
- [ ] Cobrem dinheiro (recálculo) + permissão (cross-tenant) + imutabilidade (snapshot).
