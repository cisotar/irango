/**
 * Classe do `DialogContent` de TELA CHEIA no mobile e janela centralizada a
 * partir de `md:`. Fonte única: `ProdutoModal` (vitrine) e `SeletorGaleria`
 * (painel) consomem esta constante em vez de copiar a string.
 *
 * MOBILE (parece página nova): sobrescreve o box do primitivo — `top-0/left-0`
 * + translate zerado, `w-screen/h-dvh` + `max-w/max-h-none`, `rounded-none`
 * (full-bleed). `h-dvh` acompanha o viewport dinâmico do mobile (barra do
 * browser).
 *
 * DESKTOP (`md:`): janela centralizada (`top/left-1/2` + translate), altura
 * `100dvh - 2rem`, `max-w-lg`, `rounded-2xl`. Quem precisa de outra largura
 * acrescenta a própria `md:max-w-*` via `cn` (o `tailwind-merge` resolve o
 * conflito a favor da última).
 *
 * Sem padding no container: header/corpo/footer controlam o próprio
 * espaçamento. `[&>button.absolute]:hidden` esconde o ✕ padrão do primitivo
 * quando o consumidor desenha o próprio.
 */
export const CLASSE_DIALOG_TELA_CHEIA =
  "gap-0 p-0 top-0 left-0 translate-x-0 translate-y-0 h-dvh max-h-none w-screen max-w-none rounded-none md:top-1/2 md:left-1/2 md:h-[calc(100dvh-2rem)] md:max-h-[calc(100dvh-2rem)] md:w-[calc(100vw-2rem)] md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl [&>button.absolute]:hidden";
