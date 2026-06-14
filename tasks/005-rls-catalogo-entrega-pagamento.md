# [005] RLS de catálogo, entrega e pagamento

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 004
**Spec:** specs/spec_irango_mvp.md (RN-02, RN-03)

## Objetivo
Habilitar RLS e políticas de `produtos`, `categorias`, `zonas_entrega`, `taxas_entrega`, `bairros_zona`, `formas_pagamento`: leitura pública filtrada + escrita restrita ao dono.

## Escopo
- [ ] Criar `supabase/migrations/0005_rls_catalogo_entrega_pagamento.sql`
- [ ] `ENABLE ROW LEVEL SECURITY` nas 6 tabelas
- [ ] `produtos_leitura_publica` (disponivel = true AND loja ativa), `produtos_leitura_propria`, `produtos_escrita_propria`
- [ ] `categorias_leitura_publica` (loja ativa), `categorias_escrita_propria`
- [ ] `zonas_leitura_publica` (ativo = true), `zonas_escrita_propria`
- [ ] `taxas_leitura_publica` (zona ativa), `taxas_escrita_propria` (via zona → loja)
- [ ] `bairros_leitura_publica` (zona ativa), `bairros_escrita_propria` (via zona → loja)
- [ ] `pagamentos_leitura_publica` (true), `pagamentos_escrita_propria`

## Fora de escopo
RLS de cupons/pedidos/itens (006), `lojas` (004).

## Reuso esperado
- `references/seguranca.md` §2 — DDL literal de cada policy

## Segurança
- Produto indisponível ou de loja inativa não vaza ao público
- Tabelas-filhas (taxas/bairros) filtram pela zona ativa — não vazam zona inativa

## Critério de aceite
- [ ] (crítica) Teste vermelho: anon não lê produto indisponível; anon não lê taxa de zona inativa; lojista B não escreve em produto/zona/forma de pagamento de A
