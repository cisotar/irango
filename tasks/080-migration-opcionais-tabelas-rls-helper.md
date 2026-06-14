# [080] Migration — tabelas de opcionais + RLS + helper `item_pedido_aceita_opcionais`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/spec_opcionais.md

## Objetivo
Criar as 4 tabelas da feature de opcionais (`opcionais_categorias`, `opcionais`, `categoria_produto_opcionais`, `itens_pedido_opcionais`) com índices, RLS por loja e o helper `security definer` `public.item_pedido_aceita_opcionais`.

## Escopo
- [ ] Criar `supabase/migrations/20260614XXXXXX_opcionais.sql`
- [ ] `opcionais_categorias` (id, loja_id FK lojas ON DELETE CASCADE, nome, ordem int default 0, criado_em) + índice `(loja_id, ordem)`
- [ ] `opcionais` (id, loja_id FK, categoria_opcional_id FK opcionais_categorias ON DELETE CASCADE, nome, `preco numeric(10,2) CHECK (preco >= 0)`, ativo bool default true, ordem, criado_em, atualizado_em) + índice `(loja_id, categoria_opcional_id, ativo, ordem)`
- [ ] `categoria_produto_opcionais` (id, loja_id FK, categoria_id FK categorias ON DELETE CASCADE, categoria_opcional_id FK opcionais_categorias ON DELETE CASCADE, `UNIQUE (categoria_id, categoria_opcional_id)`) + índice `(loja_id, categoria_id)`
- [ ] `itens_pedido_opcionais` (id, item_pedido_id FK itens_pedido ON DELETE CASCADE, `opcional_id FK opcionais ON DELETE SET NULL`, nome_snapshot text NOT NULL, `preco_snapshot numeric(10,2) CHECK (preco_snapshot >= 0)`, `quantidade int CHECK (quantidade > 0)`) + índice `(item_pedido_id)`
- [ ] `ENABLE ROW LEVEL SECURITY` nas 4 tabelas
- [ ] RLS leitura pública (via `public.loja_esta_ativa`) + escrita do dono em `opcionais_categorias` e `categoria_produto_opcionais` (spec §Segurança)
- [ ] RLS em `opcionais`: leitura pública só `ativo = true` + loja ativa; leitura própria do dono inclui inativos; escrita do dono
- [ ] Helper `public.item_pedido_aceita_opcionais(uuid)` `STABLE SECURITY DEFINER SET search_path = public`, com `REVOKE ALL` + `GRANT EXECUTE` a anon/authenticated/service_role
- [ ] RLS `itens_pedido_opcionais`: INSERT público via helper; SELECT do lojista dono
- [ ] Regenerar `src/types/supabase.ts` (`supabase gen types typescript`)

## Fora de escopo
- Query pública que monta a seção (081).
- Schema zod do payload (082) e emenda RPC/action (083).
- Override por produto individual — fora do MVP (decisão confirmada).

## Reuso esperado
- Helper `public.loja_esta_ativa()` (existente) — reusar nas policies de leitura pública, nunca `EXISTS` direto em `lojas`.
- Padrão do helper `public.pedido_aceita_itens` (existente) — espelhar para o novo `item_pedido_aceita_opcionais`.
- Convenção de migration `references/schema.md` §6 (CHECK inline, FK explícita, RLS na mesma migration).

## Segurança
- 4 tabelas novas → todas exigem RLS antes de produção (seguranca.md §2).
- `opcionais.preco`, `nome_snapshot`, `preco_snapshot` são valores autoritativos do servidor — schema garante CHECK `>= 0`.
- `item_pedido_aceita_opcionais` não pode expor pedidos ao anon: `SECURITY DEFINER` com `search_path` fixo, só checa pendente + loja ativa.
- Cross-tenant: `UNIQUE (categoria_id, categoria_opcional_id)` + `loja_id` em todas as tabelas para RLS direta; integridade "ambas da mesma loja" reforçada na action (087).

## Critério de aceite
- [ ] Migration aplica em DB limpo e em DB com dados.
- [ ] (crítica) Teste vermelho/verde:
  - INSERT de `opcionais.preco = -1` falha no CHECK;
  - INSERT de `itens_pedido_opcionais.quantidade = 0` falha;
  - cliente anon NÃO lê `opcionais` com `ativo=false`;
  - cliente anon NÃO lê `opcionais_categorias` de loja inativa;
  - dono de loja A NÃO escreve `opcionais` da loja B;
  - `UNIQUE (categoria_id, categoria_opcional_id)` rejeita duplicata;
  - tipos regenerados expõem as 4 tabelas.
