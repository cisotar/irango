# [010] Util `validarImagem` (MIME + tamanho)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/spec_irango_mvp.md (RN-11)

## Objetivo
Função pura que valida tipo e tamanho de uma imagem de produto. Reusada no client (UX) e na Server Action de upload (segurança).

## Escopo
- [ ] Criar `src/lib/utils/validarImagem.ts`
- [ ] Whitelist MIME: `image/jpeg`, `image/png`, `image/webp`
- [ ] Tamanho máximo 2 MB
- [ ] `validarImagem({ tipo, tamanho }): { valido: boolean; erro?: string }`
- [ ] (servidor) Helper para checar magic bytes do buffer — não confiar só no `Content-Type` do client

## Fora de escopo
Upload em si para o Storage (016).

## Reuso esperado
- `references/seguranca.md` §13 — regras de whitelist e tamanho

## Segurança
- Não confiar na extensão nem no `Content-Type` do client — checar magic bytes no servidor
- Nome do arquivo gerado por uuid na Server Action (016), nunca o nome original

## Critério de aceite
- [ ] (crítica) Teste vermelho: jpeg de 1MB válido; gif rejeitado; arquivo de 3MB rejeitado; buffer com magic bytes de executável rejeitado mesmo com Content-Type image/png
