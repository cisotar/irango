// Mecânica do scrollspy da nav de categorias da vitrine (issue 203, RN-6).
//
// Módulo NEUTRO (sem "use client"/"use server"), mesmo padrão de
// `medicaoBarraVitrine.ts` / `criarControladorPolling`
// (`confirmacao/StatusPedidoLive.tsx`) / `prepararAbaWhatsapp`
// (`checkout/aberturaWhatsapp.ts`): o `IntersectionObserver` e a busca das
// <section> são INJETADOS por parâmetro, nunca lidos direto de
// `window`/`document` aqui dentro — é o que permite cobrir a lógica em
// `environment: node` (o repo não tem jsdom) com fakes.
//
// `NavCategorias.tsx` é só o fio entre este módulo e o `useEffect` do React.
//
// PROIBIDO listener de `scroll` (critério de aceite da 203): a marcação do chip
// ativo sai inteiramente do IntersectionObserver.

/** Superfície mínima de uma <section> observada. */
export type SecaoObservavel = { id: string };

/** Superfície mínima de uma entrada de interseção. */
export type EntradaInterseccao = {
  target: SecaoObservavel;
  isIntersecting: boolean;
};

/** Superfície mínima do observer usado aqui. */
export type ObservadorInterseccao = {
  observe(alvo: SecaoObservavel): void;
  disconnect(): void;
};

/** Construtor injetável — `undefined` simula browser sem suporte. */
export type ConstrutorIntersectionObserver = new (
  callback: (entradas: EntradaInterseccao[]) => void,
  opcoes: { rootMargin: string; threshold: number },
) => ObservadorInterseccao;

export type DepsScrollspy = {
  /** Âncoras das seções na ORDEM do catálogo — é ela que faz o desempate. */
  ordem: readonly string[];
  /** Resolve a âncora para o elemento real (no componente: `getElementById`). */
  obterSecao: (ancora: string) => SecaoObservavel | null;
  IntersectionObserverCtor?: ConstrutorIntersectionObserver;
  rootMargin: string;
  aoAtivar: (ancora: string) => void;
};

/** Recorte inferior do viewport: só a metade de cima decide quem está "em tela". */
const RECORTE_INFERIOR = "-55%";

/**
 * Monta o `rootMargin` a partir da altura MEDIDA da barra sticky (a var
 * `--altura-barra` da 201 — RN-6 proíbe valor fixo). Altura vazia (var ainda
 * não publicada) cai em `0px`: string vazia geraria `rootMargin` inválido e o
 * construtor lançaria.
 */
export function montarRootMargin(alturaBarra: string): string {
  const topo = alturaBarra.trim() || "0px";
  return `-${topo} 0px ${RECORTE_INFERIOR} 0px`;
}

/**
 * Desempate quando mais de uma seção está visível: vence a PRIMEIRA na ordem do
 * catálogo — determinístico, sem depender de `intersectionRatio` (que oscila a
 * cada frame e faz o chip piscar).
 *
 * Nenhuma visível (entre duas seções, topo/rodapé extremos) → `null`, e quem
 * chama MANTÉM o ativo anterior: chip nenhum marcado é pior que chip atrasado.
 */
export function escolherAtivo(
  ordem: readonly string[],
  visiveis: ReadonlySet<string>,
): string | null {
  for (const ancora of ordem) {
    if (visiveis.has(ancora)) return ancora;
  }
  return null;
}

/**
 * Liga o observer sobre as seções de `ordem` e devolve o cleanup.
 *
 * Sem `IntersectionObserverCtor` (browser antigo, SSR) degrada em SILÊNCIO:
 * cleanup no-op, nenhum chip marcado dinamicamente, links âncora intactos.
 * Nunca lança.
 */
export function criarScrollspy(deps: DepsScrollspy): () => void {
  const { ordem, obterSecao, IntersectionObserverCtor, rootMargin, aoAtivar } =
    deps;

  if (!IntersectionObserverCtor) return () => {};

  const visiveis = new Set<string>();

  const observador = new IntersectionObserverCtor(
    (entradas) => {
      for (const entrada of entradas) {
        if (entrada.isIntersecting) visiveis.add(entrada.target.id);
        else visiveis.delete(entrada.target.id);
      }
      const ativo = escolherAtivo(ordem, visiveis);
      if (ativo) aoAtivar(ativo);
    },
    { rootMargin, threshold: 0 },
  );

  for (const ancora of ordem) {
    const secao = obterSecao(ancora);
    if (secao) observador.observe(secao);
  }

  return () => observador.disconnect();
}
