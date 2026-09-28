/**
 * Fase RED (TDD) — issue 329, spec `specs/status-pedido-clicavel-e-latencia.md`
 * (página 1 "criarRefreshCoalescido", spec:138; página 2 "10 pedidos em 10 s";
 * "Volume alto").
 *
 * `src/lib/utils/refresh-coalescido.ts` ainda NÃO existe: cada teste importa o
 * módulo dinamicamente e falha individualmente até a fase GREEN.
 *
 * CONTRATO (GREEN) — núcleo puro, mesmo padrão de `salvamento-coalescido.ts`
 * (sem React, sem DOM; `refresh` injetado; timers globais, trocados pelos fake
 * timers do vitest):
 *
 *   criarRefreshCoalescido({ refresh: () => void, atrasoMs?: number /* 600 *\/ })
 *     → { iniciar(): void; concluir(): void }
 *
 *   - `iniciar()`: uma mudança de status entrou na fila (clique). Cancela um
 *     refresh já agendado — clique novo reinicia a espera.
 *   - `concluir()`: a action daquela mudança terminou (sucesso ou falha).
 *   - O `refresh` roda UMA vez quando a fila esvazia (nada em voo) e passam
 *     `atrasoMs` (~600 ms) sem clique novo. Enquanto houver action em voo, nunca
 *     roda — o refresh não briga com a fila serial de Server Actions do Next.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function mod() {
  return import("./refresh-coalescido");
}

describe("criarRefreshCoalescido — rajada de mudanças vira UM refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rajada de 10 cliques (cada action termina antes do próximo clique) → 1 refresh só, no fim", async () => {
    const { criarRefreshCoalescido } = await mod();
    const refresh = vi.fn();
    const r = criarRefreshCoalescido({ refresh, atrasoMs: 600 });

    for (let i = 0; i < 10; i++) {
      r.iniciar();
      vi.advanceTimersByTime(150); // action em voo
      r.concluir();
      vi.advanceTimersByTime(300); // próximo clique antes de 600 ms
    }
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("10 cliques enfileirados (fila serial do Next) → nenhum refresh com action em voo; 1 refresh depois da última", async () => {
    const { criarRefreshCoalescido } = await mod();
    const refresh = vi.fn();
    const r = criarRefreshCoalescido({ refresh, atrasoMs: 600 });

    for (let i = 0; i < 10; i++) r.iniciar();
    // cada action da fila termina a cada 700 ms — mais que a janela, mas ainda
    // há action em voo, então o refresh NÃO pode rodar no meio.
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(700);
      r.concluir();
    }
    vi.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();

    r.concluir(); // a 10ª termina: fila vazia
    vi.advanceTimersByTime(600);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("não roda antes da janela vencer (599 ms)", async () => {
    const { criarRefreshCoalescido } = await mod();
    const refresh = vi.fn();
    const r = criarRefreshCoalescido({ refresh, atrasoMs: 600 });

    r.iniciar();
    r.concluir();
    vi.advanceTimersByTime(599);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("janela padrão é ~600 ms (spec:138) quando atrasoMs é omitido", async () => {
    const { criarRefreshCoalescido } = await mod();
    const refresh = vi.fn();
    const r = criarRefreshCoalescido({ refresh });

    r.iniciar();
    r.concluir();
    vi.advanceTimersByTime(599);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clique novo dentro da janela cancela o refresh agendado e reinicia a espera", async () => {
    const { criarRefreshCoalescido } = await mod();
    const refresh = vi.fn();
    const r = criarRefreshCoalescido({ refresh, atrasoMs: 600 });

    r.iniciar();
    r.concluir();
    vi.advanceTimersByTime(500);
    r.iniciar(); // clique novo antes de 600 ms
    vi.advanceTimersByTime(1_000); // action lenta, ainda em voo
    expect(refresh).not.toHaveBeenCalled();
    r.concluir();
    vi.advanceTimersByTime(600);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("duas rajadas separadas por mais que a janela → 2 refreshes (um por rajada)", async () => {
    const { criarRefreshCoalescido } = await mod();
    const refresh = vi.fn();
    const r = criarRefreshCoalescido({ refresh, atrasoMs: 600 });

    r.iniciar();
    r.concluir();
    vi.advanceTimersByTime(600);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    r.iniciar();
    r.concluir();
    vi.advanceTimersByTime(600);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("sem nenhuma mudança, nunca faz refresh", async () => {
    const { criarRefreshCoalescido } = await mod();
    const refresh = vi.fn();
    criarRefreshCoalescido({ refresh, atrasoMs: 600 });
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
