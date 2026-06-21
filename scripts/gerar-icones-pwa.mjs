// Gerador one-shot dos ícones PWA de fallback do iRango.
//
// Roda em dev-time (não em runtime): rasteriza um SVG inline -> PNG via `sharp`
// (já presente como dependência transitiva do Next 16, traz librsvg embutido).
// Output: os 5 PNGs em public/icons/, que são o artefato consumido pelos
// manifests (issues 002-005). Sem pacote novo, sem .svg separado.
//
// Cores reusadas de src/app/globals.css (tokens, sem inventar cor nova):
//   --cor-primaria #332616 (marrom espresso) -> fundo VITRINE
//   --marrom-cafe  #2e2610 (marrom café)      -> fundo PAINEL (sidebar do painel)
//   --cor-destaque #2d3a27 (verde militar)    -> barra-acento do monograma
//   --branco       #ffffff                    -> lettering "iR"
//
// Uso: node scripts/gerar-icones-pwa.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error(
    'sharp não encontrado. Rode `pnpm install` (vem como dependência transitiva do Next 16).',
  );
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const dirSaida = join(__dirname, '..', 'public', 'icons');

const BRANCO = '#ffffff';
const ACENTO = '#2d3a27';

/**
 * Monta o SVG master 512x512 do monograma "iR" para um contexto.
 * Único SVG parametrizado por cor de fundo; vitrine e painel só diferem nela.
 */
function svgMonograma(corFundo) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" ry="96" fill="${corFundo}"/>
  <text x="50%" y="50%" dy="0.02em"
        font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="248" font-weight="900" letter-spacing="-12"
        fill="${BRANCO}" text-anchor="middle" dominant-baseline="central">iR</text>
  <rect x="156" y="394" width="200" height="20" rx="10" fill="${ACENTO}"/>
</svg>`;
}

/** Renderiza um SVG num PNG de `tamanho`x`tamanho` (downscale do master 512). */
async function gravarPng(svg, tamanho, nomeArquivo) {
  const caminho = join(dirSaida, nomeArquivo);
  await sharp(Buffer.from(svg)).resize(tamanho, tamanho).png().toFile(caminho);
  console.log(`  ${nomeArquivo}  ${tamanho}x${tamanho}`);
}

async function main() {
  mkdirSync(dirSaida, { recursive: true });

  const svgVitrine = svgMonograma('#332616'); // --cor-primaria
  const svgPainel = svgMonograma('#2e2610'); // --marrom-cafe

  console.log('Gerando ícones PWA em public/icons/:');
  await gravarPng(svgVitrine, 512, 'vitrine-512.png');
  await gravarPng(svgVitrine, 192, 'vitrine-192.png');
  await gravarPng(svgPainel, 512, 'painel-512.png');
  await gravarPng(svgPainel, 192, 'painel-192.png');
  await gravarPng(svgVitrine, 180, 'apple-touch-icon.png'); // iOS: monograma vitrine, fundo opaco

  console.log('Pronto.');
}

main().catch((erro) => {
  console.error('Falha ao gerar ícones:', erro);
  process.exit(1);
});
