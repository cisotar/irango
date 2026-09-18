// Mecânica de medição da barra sticky da vitrine (issue 201, RN-6).
//
// Módulo NEUTRO (sem "use client"/"use server"), mesmo padrão de
// `criarControladorPolling`/`DepsPolling` (`confirmacao/StatusPedidoLive.tsx`)
// e `prepararAbaWhatsapp`/`AbrirJanela` (`checkout/aberturaWhatsapp.ts`): o
// elemento medido e o `ResizeObserver` são INJETADOS por parâmetro, nunca
// lidos direto de `document`/`window` dentro da função — permite cobrir em
// `environment: node` (o repo não tem jsdom) com fakes.
//
// `CatalogoVitrine.tsx` é só o fio entre este módulo e o `useLayoutEffect` do
// React; toda a mecânica (arredondar pra cima, observar resize, cleanup que
// remove a var) vive aqui.

/** Nome da CSS var publicada no <html>. Lida por `SecaoCatalogo`
 *  (scroll-margin-top) e pelo scrollspy da 203 (rootMargin) — fonte única do
 *  literal. */
export const VAR_ALTURA_BARRA = "--altura-barra";

/** Superfície mínima de `HTMLElement.style` usada aqui — permite fake no teste. */
export type EstiloInjetavel = {
  setProperty(nome: string, valor: string): void;
  removeProperty(nome: string): void;
};

/** Superfície mínima de `documentElement` usada aqui. */
export type RaizInjetavel = { style: EstiloInjetavel };

/** Superfície mínima do elemento medido (a barra). */
export type ElementoMedivel = { getBoundingClientRect(): { height: number } };

/** Construtor de `ResizeObserver` injetável — `undefined` simula browser sem suporte. */
export type ConstrutorResizeObserver = new (
  callback: () => void,
) => { observe(alvo: ElementoMedivel): void; disconnect(): void };

export type DepsMedicaoBarra = {
  raiz: RaizInjetavel;
  ResizeObserverCtor?: ConstrutorResizeObserver;
  /**
   * 203: notificado só quando a altura MUDA (a guarda de `ultimaAltura` abaixo
   * já filtra as entregas redundantes do ResizeObserver). É por aqui que o
   * scrollspy reconstrói o `rootMargin` sem uma SEGUNDA medição e sem listener
   * global de `resize`/`orientationchange`.
   */
  aoMedir?: (alturaPx: number) => void;
  /**
   * Nome da CSS var a publicar. Default `--altura-barra` (a da vitrine).
   * Existe porque o painel tem o MESMO problema — barra sticky de altura
   * variável e âncoras que precisam parar embaixo dela — e a regra da 201
   * ("valor fixo de scroll-margin é proibido") não é específica da vitrine.
   * A página de opcionais (213) publica a sua própria var por aqui.
   */
  variavel?: string;
};

/**
 * Mede `barra` (altura arredondada para CIMA — `Math.ceil`, RN-6: valor fixo é
 * proibido) e publica em `--altura-barra` na `raiz` injetada. Observa resize
 * quando `ResizeObserverCtor` está disponível, remedindo a cada mudança.
 *
 * Devolve o cleanup: desconecta o observer (quando existia) e SEMPRE remove a
 * propriedade CSS — sem isso a var vaza para rotas sem barra (ex.: /checkout)
 * e desloca âncoras de outra rota (critério da 204).
 */
export function medirEObservarBarra(
  barra: ElementoMedivel,
  deps: DepsMedicaoBarra,
): () => void {
  const { raiz, ResizeObserverCtor, aoMedir, variavel = VAR_ALTURA_BARRA } = deps;
  // Achado acelerar/201: sem a guarda, toda entrega do ResizeObserver (a
  // primeira é imediata, por contrato) escreve a var mesmo com a altura
  // inalterada — cada escrita de custom property não registrada invalida o
  // estilo do documento inteiro. Hoje é 1 escrita a mais na hidratação;
  // relevante quando 202/203 fizerem a barra mudar de altura em interação.
  let ultimaAltura = -1;

  function medir(): void {
    const altura = Math.ceil(barra.getBoundingClientRect().height);
    if (altura === ultimaAltura) return;
    ultimaAltura = altura;
    raiz.style.setProperty(variavel, `${altura}px`);
    aoMedir?.(altura);
  }

  medir();

  if (!ResizeObserverCtor) {
    // Browser sem ResizeObserver: mede uma vez e degrada, nunca lança.
    return () => raiz.style.removeProperty(variavel);
  }

  const observador = new ResizeObserverCtor(medir);
  observador.observe(barra);

  return () => {
    observador.disconnect();
    raiz.style.removeProperty(variavel);
  };
}
