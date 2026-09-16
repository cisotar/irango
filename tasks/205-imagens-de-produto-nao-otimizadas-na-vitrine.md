# [205] Imagens de produto sem otimização (`unoptimized`) dominam o LCP da vitrine

**crítica:** NÃO — não toca dinheiro, RLS, cupom, token nem autorização. É
débito de performance.
**Mundo:** vitrine pública (`/loja/[slug]`), mobile-first.
**Depende de:** nada.
**Origem:** achado do `acelerar`, levantado três vezes na auditoria de
performance do ciclo 199-204 (`feat/busca-e-navegacao-categorias-vitrine`) sem
nunca virar issue própria:
- `performance/2026-09-15-201-barra-sticky-vitrine.md` (achado F5 original)
- `performance/2026-09-15-200-203-realce-e-nav-categorias.md` (referenciado)
- `performance/2026-09-15-204-fechamento-busca-e-nav-categorias.md` (reafirmado
  como a alavanca dominante do LCP)

## Problema

`src/components/vitrine/CardProduto.tsx:50`, `ProdutoModal.tsx:232` e
`HeaderLoja.tsx:52` usam `<Image ... unoptimized />` **apesar de
`next.config.ts` já ter `images.remotePatterns` configurado para o host do
Storage** — ou seja, a infra de otimização existe e não está sendo usada.

Medido (Lighthouse mobile, build de produção, loja real `paodociso`): **LCP
4,2-6,7 s** (alvo < 2,5 s), **750 KiB-1,1 MiB em imagens de produto** servidas
em resolução original, sem `sizes` no HTML. É de longe a maior alavanca de LCP
da vitrine — o orçamento de JS de toda a feature 199-204 (~3,1 KB gzip) é
irrelevante perto disso.

## Hipótese a confirmar antes de implementar

O `unoptimized` pode ter sido uma decisão deliberada (custo de transformação
de imagem do Supabase/Vercel, ou incompatibilidade de formato) — **confirmar
o motivo original antes de simplesmente remover o opt-out**. Se não houver
motivo registrado, provavelmente foi copiado de um exemplo e nunca revisitado.

## Escopo sugerido

1. Investigar por que `unoptimized` foi adicionado (git blame / PR original).
2. Se não houver motivo válido: remover `unoptimized` nos três componentes,
   adicionar `sizes` adequado a cada contexto (grid de card, modal, header),
   medir o custo de transformação (Vercel Image Optimization ou equivalente).
3. Registrar antes/depois em `performance/`.

## Fora de escopo

`Cache-Control` curto no bucket público (achado F6, mesma origem) — considerar
issue separada ou o mesmo escopo, avaliar ao planejar.

## Critério de aceite

- [ ] Motivo original do `unoptimized` investigado e registrado (mesmo que a
      conclusão seja "sem motivo, remover").
- [ ] LCP da vitrine medido antes/depois em `performance/`.
- [ ] Gate completo verde: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
