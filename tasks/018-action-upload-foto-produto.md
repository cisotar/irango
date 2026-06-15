# [018] Server Action `uploadFotoProduto`

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** 003, 010
**Spec:** specs/spec_irango_mvp.md (RN-11)

## Objetivo
Server Action que valida e envia a foto do produto para o bucket `produtos/{loja_id}/{produto_id}`, retornando a URL pública.

## Escopo
- [ ] Criar `src/lib/actions/upload.ts` (`'use server'`)
- [ ] Validar MIME real (magic bytes) e tamanho via `validarImagem` (010)
- [ ] Gerar nome por uuid — nunca usar nome original do client
- [ ] Path `produtos/{loja_id}/...` — verificar que `loja_id` pertence ao lojista autenticado
- [ ] Retornar `foto_url` pública
- [ ] Erros genéricos (seguranca.md §14)

## Fora de escopo
Salvar `foto_url` no produto (faz parte do `salvarProduto` — 031). Policies de Storage (003).

## Reuso esperado
- `validarImagem` (010), policies de Storage (003)
- `src/lib/supabase/server.ts`

## Segurança
- Não confiar no `Content-Type` do client — magic bytes no servidor (seguranca.md §13)
- Escrita restrita à pasta da própria loja (Storage RLS + checagem na action)

## Critério de aceite
- [ ] (crítica) Teste vermelho: upload de gif rejeitado; arquivo > 2MB rejeitado; nome de saída é uuid; lojista não escreve na pasta de outra loja
