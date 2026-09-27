/**
 * A decisão de abrir o modal SAZONAL — módulo NEUTRO (sem `'use client'`), fora
 * do componente, testável em `environment: node` sem jsdom.
 *
 * Irmão de `./decisaoModalPromocoes` (RN-07): mesma forma, mesmas travas, mesma
 * aritmética de `localStorage`. A ÚNICA diferença é o eixo — aqui não há
 * `toggleDaLoja` nem `temPromocaoAtiva`: a existência do modal sazonal ativo
 * (já resolvida no SSR, dentro da janela) é a própria condição de conteúdo.
 * Por isso a chave é SEPARADA — `irango:promo-sazonal:{slug}` — para que o "já
 * vi as promoções hoje" e o "já vi o modal sazonal hoje" sejam independentes.
 *
 * Nada de `window` lá dentro: `scrollY` e o `Storage` entram por parâmetro,
 * padrão já usado no projeto (`architecture.md` §8).
 */

/** Prefixo da chave por loja. A chave é POR SLUG e SEPARADA da de promoções. */
const PREFIXO_CHAVE = "irango:promo-sazonal:";

/** Chave de `localStorage` do "já mostrei o sazonal hoje" desta loja. */
export function chaveModalSazonal(slug: string): string {
  return `${PREFIXO_CHAVE}${slug}`;
}

/**
 * Lê o dia da última visualização do modal sazonal. Storage ausente (SSR),
 * bloqueado (aba privativa, política do navegador) ou lançando ⇒ `null`. Nunca
 * propaga exceção: pior caso o modal reabre, nunca uma vitrine em branco.
 */
export function lerUltimaVisualizacaoSazonal(
  storage: Storage | null,
  slug: string,
): string | null {
  if (storage === null) return null;
  try {
    return storage.getItem(chaveModalSazonal(slug));
  } catch {
    return null;
  }
}

/**
 * Grava o dia em que o modal sazonal foi mostrado. Falha (cota estourada,
 * storage bloqueado) é ENGOLIDA pelo mesmo motivo da leitura: o "1× por dia" é
 * preferência de UX, não permissão e não dinheiro.
 */
export function marcarVisualizadoSazonal(
  storage: Storage | null,
  slug: string,
  dia: string,
): void {
  if (storage === null) return;
  try {
    storage.setItem(chaveModalSazonal(slug), dia);
  } catch {
    // Silêncio proposital (RN-07).
  }
}

export type EntradaDecisaoModalSazonal = {
  /** Existe modal sazonal ATIVO e DENTRO DA JANELA neste request — SSR (RN-02). */
  temModalSazonal: boolean;
  /** "YYYY-MM-DD" no fuso da LOJA, derivado no servidor (`fusoLoja.diaNoFuso`). */
  diaDeHojeNaLoja: string;
  /** O que o dispositivo gravou da última vez; `null` = nunca viu / storage falhou. */
  ultimaVisualizacao: string | null;
  /** Rolagem da janela no instante da decisão. > 0 ⇒ o cliente já está navegando. */
  scrollY: number;
};

/**
 * `true` ⟺ as três condições valem. A primeira é do servidor; a segunda é a
 * trava anti-gesto; a terceira é a única que vive no cliente.
 */
export function decidirModalSazonal({
  temModalSazonal,
  diaDeHojeNaLoja,
  ultimaVisualizacao,
  scrollY,
}: EntradaDecisaoModalSazonal): boolean {
  // 1. Sem modal sazonal ativo dentro da janela NÃO abre (decidido no SSR).
  if (!temModalSazonal) return false;
  // 2. Quem já começou a rolar já está navegando: a janela de abrir passou.
  //    `> 0` e não `>= 0`: `scrollY` negativo é overscroll de iOS no topo.
  if (scrollY > 0) return false;
  // 3. Já viu HOJE (no dia da loja, não no dia do dispositivo).
  return ultimaVisualizacao !== diaDeHojeNaLoja;
}
