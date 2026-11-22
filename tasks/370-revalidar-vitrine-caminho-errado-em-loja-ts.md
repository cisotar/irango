# [370] `revalidarVitrine` de `loja.ts` revalida `/${slug}`, que não é a rota da vitrine

**crítica:** NÃO — higiene de código; sem valor monetário, RLS ou autorização.
**Mundo:** painel do lojista (Server Actions de perfil)
**Origem:** achado do `arquitetar` no P2 da issue 368 (branch `feat/368-primeiros-passos-da-loja`, commit 535a850).

## Problema

`src/lib/actions/loja.ts:59` define `revalidarVitrine` chamando `revalidatePath(\`/${slug}\`)`.
A vitrine pública vive em `/loja/[slug]`, então a chamada nunca invalidou nada. Hoje não
há efeito visível porque a vitrine carrega dado vivo (sem ISR, ver comentário em
`src/app/(publica)/loja/[slug]/page.tsx:52`), mas o código engana quem lê e quebraria
silenciosamente se a vitrine passasse a usar cache.

`src/lib/actions/logo.ts:41` tem a mesma função com o caminho certo (`/loja/${slug}`);
`produto.ts` chama `revalidatePath(\`/loja/${loja.slug}\`)` direto.

## Escopo

1. Corrigir o caminho em `loja.ts` para `/loja/${slug}`.
2. Teste que afirma o caminho passado a `revalidatePath` em `salvarPerfil` (slug antigo e novo quando o slug muda).
3. Avaliar se `loja.ts` e `logo.ts` podem compartilhar uma única implementação (a razão do duplicado, "não exportável de módulo `'use server'`", pede um helper fora de `actions/`).

## Critério de aceite

- [ ] `revalidarVitrine` revalida `/loja/${slug}`.
- [ ] Teste trava o caminho.
- [ ] Sem duplicata de `revalidarVitrine` entre `loja.ts` e `logo.ts`, ou nota dizendo por que ficou.
