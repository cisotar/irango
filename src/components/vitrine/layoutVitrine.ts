/**
 * Constantes de largura da vitrine pública (issue 201, decisão D7).
 *
 * A escada de `max-w` estava literal em 3 lugares; a barra sticky criaria uma
 * quarta cópia. Módulo neutro (sem diretiva) de propósito: é importado tanto
 * pelo Server Component `page.tsx` quanto pelo client `CatalogoVitrine`. O
 * Tailwind v4 varre `.ts` e as classes aparecem literalmente aqui, então a
 * geração de CSS não muda.
 *
 * `VitrineClient.tsx` fica de fora: a barra do carrinho é `fixed` e usa a
 * escada sem `px-4`/`py-*`; unificar exigiria mexer no rodapé do carrinho, que
 * não é desta issue (follow-up).
 */

/** Centralização + escada de largura responsiva do conteúdo da vitrine. */
export const ESCADA_LARGURA_VITRINE =
  "mx-auto w-full max-w-3xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl";

/** Classes do `<main>` da vitrine: escada + respiro lateral/vertical. O `pb-28`
 *  reserva o espaço da barra fixa do carrinho (`VitrineClient`, z-40). */
export const CLASSES_MAIN_VITRINE = `${ESCADA_LARGURA_VITRINE} px-4 py-6 pb-28`;
