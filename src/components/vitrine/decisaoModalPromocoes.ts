/**
 * A decisão de abrir o modal de promoções — módulo NEUTRO (sem `'use client'`),
 * fora do componente, testável em `environment: node` sem jsdom.
 *
 * Existe separado por causa do PR #139: o carrinho abria sozinho e interceptava
 * o gesto de navegação do cliente. A regra que impede o mesmo erro aqui
 * (`scrollY > 0` ⇒ não abre, decisão única na montagem, "já viu hoje") é
 * aritmética pura — dentro de um componente ela seria invisível em revisão e
 * não teria teste. Aqui tem (RN-16, RN-17, design §5.2).
 *
 * Nada de `window` lá dentro: `scrollY` e o `Storage` entram por parâmetro,
 * padrão já usado 4× no projeto (`architecture.md` §8).
 */

/** Prefixo da chave por loja. A chave é POR SLUG: um dispositivo visita várias
 *  lojas no mesmo dia e cada uma tem o seu "1× por dia" (RN-18, D6). */
const PREFIXO_CHAVE = "irango:promo:";

/** Chave de `localStorage` do "já mostrei hoje" desta loja. */
export function chaveModalPromocoes(slug: string): string {
  return `${PREFIXO_CHAVE}${slug}`;
}

/**
 * Lê o dia da última visualização. Storage ausente (SSR), bloqueado (aba
 * privativa, política do navegador) ou lançando ⇒ `null`. Nunca propaga
 * exceção: pior caso o modal reabre, nunca uma vitrine em branco (RN-18).
 */
export function lerUltimaVisualizacao(
  storage: Storage | null,
  slug: string,
): string | null {
  if (storage === null) return null;
  try {
    return storage.getItem(chaveModalPromocoes(slug));
  } catch {
    return null;
  }
}

/**
 * Grava o dia em que o modal foi mostrado. Falha (cota estourada, storage
 * bloqueado) é ENGOLIDA pelo mesmo motivo da leitura: o "1× por dia" é
 * preferência de UX, não permissão e não dinheiro.
 */
export function marcarVisualizado(
  storage: Storage | null,
  slug: string,
  dia: string,
): void {
  if (storage === null) return;
  try {
    storage.setItem(chaveModalPromocoes(slug), dia);
  } catch {
    // Silêncio proposital (RN-18).
  }
}

export type EntradaDecisaoModal = {
  /** `lojas.modal_promocoes` — decidido no SSR, via `vitrine_lojas`. */
  toggleDaLoja: boolean;
  /** Existe produto com `temDesconto` NESTE request — SSR (RN-15). */
  temPromocaoAtiva: boolean;
  /** "YYYY-MM-DD" no fuso da LOJA, derivado no servidor (`fusoLoja.diaNoFuso`). */
  diaDeHojeNaLoja: string;
  /** O que o dispositivo gravou da última vez; `null` = nunca viu / storage falhou. */
  ultimaVisualizacao: string | null;
  /** Rolagem da janela no instante da decisão. > 0 ⇒ o cliente já está navegando. */
  scrollY: number;
};

/**
 * `true` ⟺ as quatro condições valem. As duas primeiras são do servidor; a
 * terceira é a única que vive no cliente; a quarta é a trava anti-gesto.
 */
export function decidirModalPromocoes({
  toggleDaLoja,
  temPromocaoAtiva,
  diaDeHojeNaLoja,
  ultimaVisualizacao,
  scrollY,
}: EntradaDecisaoModal): boolean {
  // 1. O lojista desligou o modal.
  if (!toggleDaLoja) return false;
  // 2. Sem promoção vigente NÃO abre — mesmo com o toggle ligado (RN-16).
  if (!temPromocaoAtiva) return false;
  // 3. Quem já começou a rolar já está navegando: a janela de abrir passou.
  //    `> 0` e não `>= 0`: `scrollY` negativo é overscroll de iOS no topo.
  if (scrollY > 0) return false;
  // 4. Já viu HOJE (no dia da loja, não no dia do dispositivo).
  return ultimaVisualizacao !== diaDeHojeNaLoja;
}
