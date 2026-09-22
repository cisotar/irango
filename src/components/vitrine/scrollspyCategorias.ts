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
// ativo sai inteiramente do IntersectionObserver. A trava de alvo (issue do
// flicker) usa apenas `setTimeout` como fallback — nunca `scroll`/`scrollend`.

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
  /** Janela máxima da trava de alvo (clique num chip). Default 1200ms. */
  timeoutAlvoMs?: number;
};

/** Controlador devolvido por `criarScrollspy` (flicker do chip, issue 289+). */
export type ControladorScrollspy = {
  /** Desconecta o observer e cancela a trava pendente (unmount/troca de seções). */
  desligar(): void;
  /** Trava o chip de `ancora` como ativo até ele ficar visível ou o timeout expirar. */
  irPara(ancora: string): void;
};

/** Recorte inferior do viewport: só a metade de cima decide quem está "em tela". */
const RECORTE_INFERIOR = "-55%";

const TIMEOUT_ALVO_MS_PADRAO = 1200;

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
 * Decide o chip ativo considerando a trava de alvo (clique num chip).
 *
 * Com `alvo` travado: nenhuma seção intermediária marca chip (RN-1) — só o
 * próprio alvo, quando ele entra no conjunto de visíveis, e aí sinaliza
 * `destravar` para o chamador liberar a trava. Sem alvo, o comportamento é o
 * da 203, inalterado: reusa `escolherAtivo` (RN-2/RN-3), sem duplicar a regra.
 */
export function decidirAtivo({
  ordem,
  visiveis,
  alvo,
}: {
  ordem: readonly string[];
  visiveis: ReadonlySet<string>;
  alvo: string | null;
}): { ativo: string | null; destravar: boolean } {
  if (alvo !== null) {
    if (visiveis.has(alvo)) return { ativo: alvo, destravar: true };
    return { ativo: null, destravar: false };
  }
  return { ativo: escolherAtivo(ordem, visiveis), destravar: false };
}

/**
 * Liga o observer sobre as seções de `ordem` e devolve o controlador.
 *
 * Sem `IntersectionObserverCtor` (browser antigo, SSR) degrada em SILÊNCIO:
 * `desligar`/`irPara` no-op, nenhum chip marcado dinamicamente, links âncora
 * intactos. Nunca lança.
 */
export function criarScrollspy(deps: DepsScrollspy): ControladorScrollspy {
  const {
    ordem,
    obterSecao,
    IntersectionObserverCtor,
    rootMargin,
    aoAtivar,
    timeoutAlvoMs = TIMEOUT_ALVO_MS_PADRAO,
  } = deps;

  if (!IntersectionObserverCtor) {
    return { desligar: () => {}, irPara: () => {} };
  }

  const visiveis = new Set<string>();
  let alvo: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelarTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  const observador = new IntersectionObserverCtor(
    (entradas) => {
      for (const entrada of entradas) {
        if (entrada.isIntersecting) visiveis.add(entrada.target.id);
        else visiveis.delete(entrada.target.id);
      }
      const decisao = decidirAtivo({ ordem, visiveis, alvo });
      if (decisao.ativo) aoAtivar(decisao.ativo);
      if (decisao.destravar) {
        alvo = null;
        cancelarTimer();
      }
    },
    { rootMargin, threshold: 0 },
  );

  for (const ancora of ordem) {
    const secao = obterSecao(ancora);
    if (secao) observador.observe(secao);
  }

  return {
    desligar: () => {
      cancelarTimer();
      observador.disconnect();
    },
    // Segundo `irPara` antes de o primeiro assentar cancela o timer anterior
    // e substitui o alvo — nunca há dois alvos em disputa.
    irPara: (ancora: string) => {
      cancelarTimer();
      alvo = ancora;
      timer = setTimeout(() => {
        alvo = null;
        timer = null;
      }, timeoutAlvoMs);
    },
  };
}
