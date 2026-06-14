# [035] Página da vitrine `/loja/[slug]`

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 023, 024, 025, 028, 029
**Spec:** specs/spec_irango_mvp.md (Vitrine)

## Objetivo
Server Component SSR da vitrine: busca loja por slug, catálogo agrupado, zonas, formas de pagamento, aplica tema e monta a página com header, catálogo e carrinho.

## Escopo
- [ ] Criar `src/app/(publica)/loja/[slug]/page.tsx` (SSR)
- [ ] `buscarLojaPorSlug` (023) → se não existir, `notFound()`
- [ ] **DELTA Hotmart** — o estado "Loja temporariamente indisponível" para assinatura inválida (RN-A7) é adicionado a esta página na **issue 058** (emenda), reusando `assinaturaPermiteAcesso` (056). Não implementar aqui; ver 058.
- [ ] `buscarCatalogoPublico` (024), `buscarZonasAtivas` (025), `buscarFormasPagamento` (025)
- [ ] Aplicar tema via CSS custom properties no `<head>` durante SSR
- [ ] Montar HeaderLoja + SecaoCatalogo (CardProduto) + Carrinho (028, 029)
- [ ] BotaoWhatsApp se loja tiver whatsapp
- [ ] Metadata SEO a partir da loja

## Fora de escopo
Checkout (036), confirmação (037).

## Reuso esperado
- Queries (023/024/025), componentes de vitrine (028/029)

## Segurança
- RLS pública garante só dados de loja ativa/produto disponível (RN-03)
- `foto_url` só `https:` (seguranca.md §15)

## Critério de aceite
- [ ] Slug inexistente → 404
- [ ] Catálogo agrupado por categoria, produtos indisponíveis ausentes
- [ ] Tema da loja aplicado na renderização SSR
