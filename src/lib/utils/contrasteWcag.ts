// Razão de contraste WCAG 2.x entre duas cores `#rrggbb` (luminância relativa
// sRGB). Usada pelo teste da paleta da mensagem do modal sazonal (RN-M13): toda
// cor oferecida ao lojista precisa de ≥ 4,5:1 sobre o fundo do modal.
// Função pura; hex fora do formato lança (é dado de constante, não de usuário).

const RE_HEX = /^#([0-9a-f]{6})$/i;

function canalLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminanciaRelativa(hex: string): number {
  const m = RE_HEX.exec(hex);
  if (!m) throw new Error(`Cor fora do formato #rrggbb: ${hex}`);
  const h = m[1];
  const r = canalLinear(parseInt(h.slice(0, 2), 16));
  const g = canalLinear(parseInt(h.slice(2, 4), 16));
  const b = canalLinear(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG (1 a 21), simétrica. */
export function razaoContraste(hexA: string, hexB: string): number {
  const a = luminanciaRelativa(hexA);
  const b = luminanciaRelativa(hexB);
  const [clara, escura] = a >= b ? [a, b] : [b, a];
  return (clara + 0.05) / (escura + 0.05);
}
