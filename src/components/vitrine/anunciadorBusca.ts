// Debounce do anúncio da busca na região viva (issue 202, D4).
//
// Módulo NEUTRO (sem "use client"/"use server"), mesmo padrão de
// `criarControladorPolling` (`confirmacao/StatusPedidoLive.tsx`) e
// `medicaoBarraVitrine.ts`: só `setTimeout`/`clearTimeout`, nenhum acesso a
// `document` — cobrível em `environment: node` com `vi.useFakeTimers()`.
//
// Por que não reusar o que já existe: `salvamento-coalescido.ts` coalesce
// ESCRITA ASSÍNCRONA com guarda de in-flight (API e peso errados para "atrasar
// uma string") e `comTimeout` é corrida, não debounce.
//
// O que é debouncado é SÓ o anúncio. O `termo` nunca: a filtragem visual tem
// que sair no frame (D4).

/** 500ms — precedente das regiões vivas do projeto; ~uma parada de digitação. */
const ATRASO_PADRAO_MS = 500;

export type DepsAnunciadorBusca = {
  /** Publica o texto na região viva (no React, um `setState`). */
  aoAnunciar: (texto: string) => void;
  atrasoMs?: number;
};

export type AnunciadorBusca = {
  /** Agenda `texto`; chamadas dentro da janela substituem a pendente. */
  anunciar(texto: string): void;
  /** Cancela o pendente. Cleanup do efeito — nunca anuncia depois de desmontar. */
  parar(): void;
};

export function criarAnunciadorBusca(
  deps: DepsAnunciadorBusca,
): AnunciadorBusca {
  const atraso = deps.atrasoMs ?? ATRASO_PADRAO_MS;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  function limparTimer(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  return {
    anunciar(texto: string): void {
      // Cancela o pendente ANTES de agendar: N teclas em menos de `atraso`
      // produzem UM anúncio, com o último texto — nunca N.
      limparTimer();
      timerId = setTimeout(() => {
        timerId = null;
        deps.aoAnunciar(texto);
      }, atraso);
    },
    parar: limparTimer,
  };
}
