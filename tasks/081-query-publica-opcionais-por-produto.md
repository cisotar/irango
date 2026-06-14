# [081] Query pública — opcionais disponíveis por produto/categoria (SSR vitrine)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 080
**Spec:** specs/spec_opcionais.md

## Objetivo
Estender a leitura SSR do catálogo (`lib/supabase/queries/produtos.ts`) para trazer, por produto, os opcionais disponíveis derivados da `categoria_id` via `categoria_produto_opcionais → opcionais_categorias → opcionais` (apenas `ativo = true`), agrupados e ordenados.

## Escopo
- [ ] Função/leitura que, dado um produto (ou catálogo da loja), retorna opcionais por `categoria_id` do produto
- [ ] JOIN `categoria_produto_opcionais` (categoria de produto) → `opcionais_categorias` → `opcionais WHERE ativo = true`
- [ ] Agrupar por categoria de opcional, ordenar grupos por `opcionais_categorias.ordem` e itens por `opcionais.ordem`
- [ ] Produto sem `categoria_id` ou sem associação → retorna lista vazia (sem opcionais)
- [ ] Tipos de retorno derivados de `Tables<...>` (sem `any`)

## Fora de escopo
- Renderização no modal (084).
- Recálculo autoritativo no pedido (083).
- Leitura de snapshot na confirmação (086).

## Reuso esperado
- `lib/supabase/queries/produtos.ts` — estender a leitura SSR existente, não criar query paralela.
- Cliente Supabase server-side existente das queries de vitrine.

## Segurança
- Leitura pública depende exclusivamente da RLS (080): só loja ativa e só `opcionais.ativo = true` — a query NÃO reimplementa o filtro de segurança, apenas o JOIN.
- Nenhum preço é calculado aqui; preços são apenas dados de exibição (preview no cliente).

## Critério de aceite
- [ ] (crítica) Teste vermelho/verde:
  - produto da categoria X retorna só os opcionais das categorias de opcional associadas a X;
  - opcional `ativo=false` não aparece;
  - opcional de loja inativa não aparece (RLS pública);
  - produto sem `categoria_id` retorna lista vazia;
  - grupos e itens vêm ordenados por `ordem`.
