# Auditoria de performance — vitrine pública + checkout

**Data:** 2026-07-09
**Escopo:** caminho crítico da vitrine `/loja/[slug]` (catálogo, produto, carrinho) e checkout `/loja/[slug]/pedido`
**Branch:** `fix/teto-cardinalidade-itens-pedido`
**Agente:** acelerar (revisor de performance)

## Contexto

Auditoria sob demanda do caminho crítico consumido pelo cliente final no celular, em rede móvel.
Premissa: tempo de carregamento dita conversão; LCP < 2.5s / INP < 200ms / CLS ~0.

### Arquivos lidos (completos)
- `references/schema.md`, `references/architecture.md`
- `src/app/(publica)/loja/[slug]/page.tsx`
- `src/app/(publica)/loja/[slug]/pedido/page.tsx`
- `src/lib/supabase/queries/lojas.ts`
- `src/lib/supabase/queries/produtos.ts`
- `src/lib/supabase/queries/categorias.ts`
- `src/components/vitrine/CardProduto.tsx`, `SecaoCatalogo.tsx`, `VitrineClient.tsx`, `HeaderLoja.tsx`, `ProdutoModal.tsx` (imports)
- `src/lib/actions/upload-imagem.ts`
- `next.config.ts`
- migration `20260614002000_rls_catalogo.sql` (função `loja_esta_ativa`, policies)

## Medições

- **EXPLAIN ANALYZE:** NÃO executado. Supabase local sem containers de pé (`supabase_db_irango-1` inexistente); subir a stack com disco em 96% (3.7G livres) foi avaliado como risco de esgotar o disco. Análise de banco feita estaticamente sobre `schema.md` + migrations.
- **`next build` (bundle por rota):** NÃO executado pelo mesmo motivo (disco). Análise de bundle feita por leitura de imports.
- **Payload:** avaliado por leitura dos `select()` e do shape serializado ao client.

### Achados estáticos de banco (sem gargalo)
- Lookups de tenant indexados: `lojas(slug)` UNIQUE, `produtos(loja_id, disponivel, ordem)`, `categorias(loja_id, ordem)`, `categoria_produto_opcionais(loja_id, categoria_id)`, `opcionais(loja_id, categoria_opcional_id, ativo, ordem)`.
- RLS pública usa `public.loja_esta_ativa(loja_id)` — função `STABLE SECURITY DEFINER` que faz `EXISTS` sobre `lojas` pela PK (`id`, indexada). `STABLE` + argumento único por query (mesma loja) permite o planner avaliar uma vez. Sem RLS cara por linha.
- Vitrine e checkout usam `Promise.all` onde as queries são independentes (checkout: zonas + formas). Catálogo → opcionais é dependência real (opcionais derivam das categorias do catálogo), sequência justificada.

## Findings

### GARGALO 1 — loja buscada 3x na vitrine / 2x no checkout, sem dedupe
`src/app/(publica)/loja/[slug]/page.tsx:56,85,99` (e `pedido/page.tsx:24,64`)
`buscarLojaPorSlug` roda uma vez em `generateMetadata`, outra em `generateViewport` e outra no corpo da página — 3 round-trips idênticos (`SELECT * FROM vitrine_lojas WHERE slug = $1`) ao Supabase **cloud**, serializados no caminho de render antes do LCP. `React cache()` não é usado em nenhuma query (confirmado por grep). supabase-js não é deduplicado pela memoização de `fetch` do Next.
**Impacto:** 2 round-trips extras à rede por page load na rota mais quente do produto; some direto no TTFB/LCP em rede móvel.
**Fix:** envolver o acesso em `cache()` do React (`import { cache } from "react"`) — ex. um `buscarLojaPorSlugCache = cache(buscarLojaPorSlug)` usado por metadata/viewport/page, ou memoizar a chamada por request. Colapsa para 1 query. Mecanismo nativo, sem lib.

### GARGALO 2 — imagens da vitrine em resolução cheia no mobile (`unoptimized` + upload sem resize)
`src/components/vitrine/CardProduto.tsx:50`, `ProdutoModal.tsx:162`, `HeaderLoja.tsx:52`, `checkout/EtapaItens.tsx:134`; upload em `src/lib/actions/upload-imagem.ts` (valida magic bytes e cap ~2MB, **não redimensiona**).
Todo `next/image` usa `unoptimized` (decisão de custo — evitar cobrança variável da Image Optimization da Vercel, coerente com o princípio "custo previsível $25 fixo"). Consequência: o arquivo original (até ~2MB, formato original, sem WebP/AVIF) é servido a um card exibido a ~180px de largura num grid 2 colunas no celular. `remotePatterns` já aponta para o Storage do Supabase mas a otimização é desligada em todo lugar.
**Impacto:** maior peso de bytes na tela do cliente = principal alavanca do LCP em rede móvel. Magnitude depende do tamanho real das fotos já armazenadas (não medido — Supabase local fora do ar); estruturalmente há desperdício garantido em toda foto.
**Fix (respeitando custo fixo):** usar a transformação de imagem do **Supabase Storage** (incluída no plano Pro, sem custo variável Vercel) via `loader` custom do `next/image` — servir `.../render/image/...?width=&quality=` dimensionado ao slot e em WebP; alternativamente, redimensionar/comprimir no upload antes de gravar no bucket. Não remover `unoptimized` cru (reintroduziria custo variável).
**Encaminhamento:** confirmar magnitude medindo o tamanho real das fotos no bucket quando o ambiente permitir.

### POLIMENTO 3 — sem `priority` na imagem LCP above-the-fold
`src/components/vitrine/HeaderLoja.tsx:47`, `CardProduto.tsx:45`
Nenhum `next/image` marca `priority`. O elemento LCP provável (logo do header ou primeira foto de card) não recebe preload hint; compete com o resto do carregamento.
**Impacto:** marginal, mas custo de aplicar é trivial.
**Fix:** `priority` na primeira imagem above-the-fold (logo do header e/ou primeiro card).

## Considerado e rejeitado (não é finding)
- **ISR/cache da página de catálogo:** rejeitado. O payload mistura dado pouco mutável (nome/foto/categoria) com dado vivo (`produtos.disponivel`). Cachear a página venderia produto esgotado — exatamente o anti-padrão da instrução. Não recomendado.
- **`dynamic()` no `ProdutoModal`:** imports leves (Base UI dialog + lucide + utils locais); ganho marginal e não mensurável sem `next build`. Não flagado.
- **`select("*")` em `vitrine_lojas`:** a view já projeta só colunas públicas e a página consome quase todas (tema, horarios, timezone, whatsapp, logo_url, nome, id, assinatura_*, taxa_entrega_fora_zona). Sem payload gordo relevante.

## Nota de contexto conhecido
Frete por raio (rate-limiter de geocoding fail-closed 1 req/s global; fix pendente = cache de CEP no Redis) NÃO foi tocado nesta auditoria — fora do caminho de render medido (vitrine/checkout SSR). Permanece como débito de UX registrado no projeto.

## Status dos findings
| # | Severidade | Status |
|---|-----------|--------|
| 1 | GARGALO | issue aberta (fix trivial: `cache()`) |
| 2 | GARGALO | issue aberta (fix: Supabase Storage transform / resize no upload) |
| 3 | POLIMENTO | opcional |
