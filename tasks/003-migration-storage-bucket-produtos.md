# [003] Storage bucket `produtos` + policies

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 001
**Spec:** specs/spec_irango_mvp.md

## Objetivo
Criar o bucket `produtos` no Supabase Storage com políticas que restringem escrita à pasta `{loja_id}/` do lojista autenticado e permitem leitura pública.

## Escopo
- [ ] Criar `supabase/migrations/0003_storage_produtos.sql`
- [ ] Criar bucket `produtos` (público para leitura)
- [ ] Policy `storage_escrita_propria` (INSERT/UPDATE/DELETE) — `bucket_id = 'produtos'` e `(storage.foldername(name))[1] IN (SELECT id::text FROM lojas WHERE dono_id = auth.uid())`
- [ ] Policy `storage_leitura_publica` (SELECT) — `bucket_id = 'produtos'`

## Fora de escopo
Lógica de upload na Server Action (016), validação de MIME (010).

## Reuso esperado
- `references/seguranca.md` §18 — DDL das policies

## Segurança
- Sem essas policies, qualquer lojista sobrescreve foto de outra loja
- Path sempre `{loja_id}/{produto_id}` — isolamento por pasta

## Critério de aceite
- [ ] Bucket `produtos` existe
- [ ] (crítica) Teste vermelho: lojista A não consegue escrever em pasta `{loja_id_B}/...`; leitura pública de qualquer objeto funciona
