# [006] RLS de `cupons`, `pedidos` e `itens_pedido`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 004
**Spec:** specs/spec_irango_mvp.md (RN-02, RN-03, RN-06)

## Objetivo
RLS das tabelas mais sensíveis: cupons sem leitura pública (anti-vazamento de estratégia), pedidos com INSERT público mas leitura só do dono (cliente lê via token em Server Component), itens idem.

## Escopo
- [ ] Criar `supabase/migrations/0006_rls_cupons_pedidos_itens.sql`
- [ ] `ENABLE ROW LEVEL SECURITY` nas 3 tabelas
- [ ] `cupons_acesso_proprio` (FOR ALL, só dono) — **NÃO criar SELECT público**
- [ ] `pedidos_insert_publico` (INSERT `WITH CHECK true`)
- [ ] `pedidos_acesso_lojista` (FOR ALL, via loja → dono)
- [ ] **NÃO criar SELECT público em `pedidos`** (leitura do cliente é por token, em Server Component)
- [ ] `itens_pedido_insert_publico` (INSERT `WITH CHECK true`)
- [ ] `itens_pedido_lojista` (SELECT via pedido → loja → dono)

## Fora de escopo
Validação de negócio do cupom (Server Action 013), leitura por token (query 011 + página 028).

## Reuso esperado
- `references/seguranca.md` §2 (cupons, pedidos, itens_pedido) — DDL literal

## Segurança
- Cupom NUNCA tem SELECT público — concorrente baixaria a tabela inteira
- Pedido NUNCA tem SELECT público — vazaria nome/telefone/endereço de todos os clientes

## Critério de aceite
- [ ] (crítica) Teste vermelho: anon NÃO lê nenhum cupom; anon NÃO lê nenhum pedido via SELECT; anon CONSEGUE inserir pedido + itens; lojista B não lê pedidos de A
