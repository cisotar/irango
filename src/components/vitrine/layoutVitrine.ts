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

/**
 * Altura mínima do slot que a barra sticky da vitrine troca entre trilho de
 * categorias (`NavCategorias`) e resumo de busca (`ResumoBusca`) — issue 202,
 * achado acelerar/202. Os dois têm quase a mesma altura de conteúdo (ambos
 * usam alvo de toque de 44px), mas não EXATAMENTE a mesma: a diferença de
 * ~4px fazia `--altura-barra` oscilar a cada ciclo buscar/limpar e o
 * `IntersectionObserver` do scrollspy (203) ser reconstruído em cima de um
 * `rootMargin` errado por um frame. Uma altura mínima compartilhada elimina a
 * oscilação sem mudar o alvo de toque de nenhum dos dois.
 */
export const ALTURA_SLOT_BARRA = "min-h-[60px]";

/**
 * `id` do `<main>` da vitrine. Existe porque o `<main>` é renderizado pelo
 * `CatalogoVitrine` (ou pela própria `page.tsx`, no catálogo vazio) enquanto
 * quem precisa de uma referência a ele — o `destinoFoco` do `ModalPromocoes`,
 * issue 234 — vive no `VitrineClient`, que é IRMÃO e não ancestral. Dois
 * clientes irmãos sob um Server Component não compartilham ref, e um contexto
 * só para isso seria mais peça do que o problema tem.
 *
 * O `<main>` também leva `tabIndex={-1}`: é o alvo do foco quando o modal
 * fecha, e elemento não focável não recebe foco programático.
 */
export const ID_MAIN_VITRINE = "conteudo-vitrine";
