# [053] Seed de dados fictícios

**crítica:** NÃO
**Mundo:** infra
**Depende de:** 001, 004, 005, 006
**Spec:** specs/spec_irango_mvp.md (seguranca.md §8)

## Objetivo
Criar `supabase/seed.sql` com uma loja de teste completa (catálogo, zonas, cupom, formas de pagamento) usando apenas dados fictícios.

## Escopo
- [ ] Criar `supabase/seed.sql`
- [ ] Loja `loja-teste` com produtos, categorias, zona de bairro com taxa, cupom de exemplo, formas de pagamento
- [ ] Apenas dados fictícios — nenhum email/telefone/chave Pix real

## Fora de escopo
Migrations (001). Dados de produção.

## Reuso esperado
- Schema (001) e estrutura de RLS (004-006)

## Segurança
- PROIBIDO hardcodar dado pessoal real (seguranca.md §8) — só fictício e marcado como teste

## Critério de aceite
- [ ] Seed roda sem erro; vitrine `/loja/loja-teste` exibe catálogo
- [ ] Nenhum dado pessoal real no arquivo
