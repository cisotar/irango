import type { CategoriaComProdutos } from "@/components/vitrine/SecaoCatalogo";

/**
 * Util puro de busca no catalogo da vitrine (specs/busca-e-navegacao-categorias-vitrine.md).
 * Unico lugar do projeto que sabe normalizar termo de busca, filtrar o catalogo
 * por substring e localizar o trecho casado. Sem 'use client', sem 'server-only':
 * puro e isomorfico. Nunca constroi RegExp a partir do termo (ReDoS/metacaractere)
 * e nunca devolve HTML — so `string`, montada como no React por quem consome.
 */

/**
 * RN-2: trim -> NFD -> remove diacritico -> lowercase.
 *
 * Prima de `normalizarBairro` (`calcularFrete.ts`), mas **nao colapsa espaco
 * interno**: o colapso quebraria o alinhamento indice-normalizado -> indice-original
 * de `partirPorTermo`. Duplicacao deliberada de 4 linhas — nao unificar sem um
 * terceiro caso de uso.
 */
export function normalizarBusca(s: string): string {
  return dobrar(s.trim());
}

/**
 * Nucleo da normalizacao, SEM `trim` — usado tambem code point a code point por
 * `normalizarComMapa`, onde aparar um code point de espaco o apagaria do alvo e
 * quebraria tanto o casamento quanto o mapa de indices.
 */
function dobrar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Normaliza code point a code point, construindo o mapa `indice no alvo` ->
 * `indice na string original`. Necessario porque a normalizacao NAO preserva
 * comprimento: "Pão" (4) -> "pao" (3). Um match em `alvo[a..b)` vira
 * `texto.slice(mapa[a], mapa[b])`. O ultimo elemento e sentinela (`texto.length`).
 */
function normalizarComMapa(texto: string): { alvo: string; mapa: number[] } {
  let alvo = "";
  const mapa: number[] = [];
  let indiceOriginal = 0;
  for (const cp of texto) {
    // Sem trim aqui: um unico code point de espaco deve sobreviver ao mapa.
    const n = dobrar(cp);
    for (let k = 0; k < n.length; k++) {
      alvo += n[k];
      mapa.push(indiceOriginal);
    }
    indiceOriginal += cp.length;
  }
  mapa.push(texto.length);
  // Nada antes do primeiro indice sobrevivente pode ser perdido: um code point
  // que normaliza para vazio na posicao 0 nao tem caractere anterior que o
  // absorva (achado auditar/199: sem isto, `partirPorTermo` cortava o primeiro
  // combinante solto e quebrava a invariante join("") === texto).
  mapa[0] = 0;
  return { alvo, mapa };
}

/**
 * Verdadeiro se `texto` contem `termoNormalizado` (ja normalizado pelo chamador).
 * Usa `normalizarBusca`, nao `normalizarComMapa`: aqui so o boolean importa, e o
 * mapa indice-a-indice (alocado por code point) seria construido e descartado a
 * cada tecla/produto — o mapa so vale a pena em `partirPorTermo`, que opera sobre
 * a string curta e isolada do match.
 */
function casaTexto(texto: string | null, termoNormalizado: string): boolean {
  if (!texto) return false;
  return normalizarBusca(texto).includes(termoNormalizado);
}

/**
 * RN-3: mantem so os produtos cujo `nome` ou `descricao` casam o termo; categoria
 * sem nenhum match e removida. Ordem de categorias e de produtos preservada (RN-1).
 * Nunca muta a entrada. Termo vazio/so-espacos/so-acento -> devolve a MESMA
 * referencia de `categorias` (deixa o `useMemo` do consumidor comparar por identidade).
 * Estritamente subtrativo: jamais faz aparecer produto ausente do payload do SSR.
 */
export function filtrarCatalogo(
  categorias: CategoriaComProdutos[],
  termo: string,
): CategoriaComProdutos[] {
  const alvo = normalizarBusca(termo);
  if (alvo === "") return categorias;

  const resultado: CategoriaComProdutos[] = [];
  for (const categoria of categorias) {
    const produtos = categoria.produtos.filter(
      (produto) =>
        casaTexto(produto.nome, alvo) || casaTexto(produto.descricao, alvo),
    );
    if (produtos.length > 0) resultado.push({ ...categoria, produtos });
  }
  return resultado;
}

/**
 * Quebra `texto` nos pedacos da string ORIGINAL (acentuacao preservada), marcando
 * quais casaram o termo. Todas as ocorrencias, nao-sobrepostas, da esquerda para a
 * direita. Invariante: `partirPorTermo(t, q).map(p => p.texto).join("") === t`.
 * Devolve `string`, nunca HTML — o `<mark>` e montado como no React (seguranca.md §15).
 */
export function partirPorTermo(
  texto: string,
  termo: string,
): { texto: string; casa: boolean }[] {
  if (texto === "") return [];
  const busca = normalizarBusca(termo);
  if (busca === "") return [{ texto, casa: false }];

  const { alvo, mapa } = normalizarComMapa(texto);
  const partes: { texto: string; casa: boolean }[] = [];
  let cursor = 0; // indice no alvo ja consumido
  let inicio = alvo.indexOf(busca, cursor);

  while (inicio !== -1) {
    const fim = inicio + busca.length;
    const antes = texto.slice(mapa[cursor], mapa[inicio]);
    if (antes !== "") partes.push({ texto: antes, casa: false });
    const casado = texto.slice(mapa[inicio], mapa[fim]);
    if (casado !== "") partes.push({ texto: casado, casa: true });
    cursor = fim;
    inicio = alvo.indexOf(busca, cursor);
  }

  const resto = texto.slice(mapa[cursor]);
  if (resto !== "") partes.push({ texto: resto, casa: false });
  return partes;
}
