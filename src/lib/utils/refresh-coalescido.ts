/**
 * Refresh coalescido do painel (issue 329, spec
 * `specs/status-pedido-clicavel-e-latencia.md` spec:138 e "Volume alto").
 *
 * Puro: sem React, sem DOM. `refresh` é injetado (no app, `router.refresh()`) e
 * os timers são os globais, trocados pelos fake timers do vitest — mesmo padrão
 * de `salvamento-coalescido.ts`.
 *
 * Por que existe: cada `router.refresh()` refaz o layout e recarrega a lista
 * inteira de pedidos. Numa rajada de mudanças de status (10 cliques em 10 s), um
 * refresh por clique brigaria com a fila serial de Server Actions do Next. Aqui a
 * rajada vira UM refresh: ele só roda quando nada está em voo e a janela
 * (`atrasoMs`, ~600 ms) passou sem clique novo.
 */

export type OpcoesRefreshCoalescido = {
  refresh: () => void;
  /** Janela sem clique novo antes do refresh. Padrão: 600 ms. */
  atrasoMs?: number;
};

export type RefreshCoalescido = {
  /** Uma mudança entrou na fila. Cancela o refresh agendado (reinicia a espera). */
  iniciar: () => void;
  /** A action daquela mudança terminou (sucesso ou falha). */
  concluir: () => void;
};

const ATRASO_PADRAO_MS = 600;

export function criarRefreshCoalescido({
  refresh,
  atrasoMs = ATRASO_PADRAO_MS,
}: OpcoesRefreshCoalescido): RefreshCoalescido {
  let emVoo = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelarAgendado(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    iniciar(): void {
      cancelarAgendado();
      emVoo += 1;
    },
    concluir(): void {
      // Nunca negativo: um `concluir` sem `iniciar` não pode liberar o refresh
      // com uma action ainda em voo.
      emVoo = Math.max(0, emVoo - 1);
      if (emVoo > 0) return;
      cancelarAgendado();
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, atrasoMs);
    },
  };
}
