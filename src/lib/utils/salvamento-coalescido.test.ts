/**
 * Regressão dos dois bugs achados na revisão da issue 175, contra o núcleo puro
 * extraído de `ReordenarCategorias` (ver o cabeçalho de
 * `salvamento-coalescido.ts` para o porquê da extração).
 *
 * Ambiente: vitest `environment: node`, sem jsdom e sem @testing-library. Os
 * timers falsos do vitest substituem `setTimeout`/`clearTimeout` globais, que é
 * tudo de que o módulo depende — nenhum ciclo de render é necessário.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  criarSalvamentoCoalescido,
  type ResultadoSalvamento,
  type StatusSalvamento,
} from "./salvamento-coalescido";

const ATRASO = 500;

/** Promise que o teste resolve na hora que quiser — simula rede lenta. */
function adiado<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

describe("criarSalvamentoCoalescido (issue 175)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ─────────────────────────────────────────────── comportamento já esperado
  it("coalesce toques rápidos numa ÚNICA escrita, com a sequência final", () => {
    const chamadas: string[][] = [];
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a", "b", "c"],
      atrasoMs: ATRASO,
      salvar: async (v) => {
        chamadas.push(v);
        return { ok: true };
      },
    });

    m.agendar(["b", "a", "c"]);
    vi.advanceTimersByTime(100);
    m.agendar(["b", "c", "a"]);
    vi.advanceTimersByTime(100);
    m.agendar(["c", "b", "a"]);
    vi.advanceTimersByTime(ATRASO);

    expect(chamadas).toEqual([["c", "b", "a"]]);
  });

  it("não escreve nada enquanto a janela de coalescência não vence", () => {
    const salvar = vi.fn(async (): Promise<ResultadoSalvamento> => ({ ok: true }));
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a"],
      atrasoMs: ATRASO,
      salvar,
    });

    m.agendar(["b"]);
    vi.advanceTimersByTime(ATRASO - 1);
    expect(salvar).not.toHaveBeenCalled();
  });

  it("emite salvando → salvo, e só anuncia 'salvo' quando a fila esvazia", async () => {
    const status: StatusSalvamento[] = [];
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a"],
      atrasoMs: ATRASO,
      salvar: async () => ({ ok: true }),
      aoStatus: (s) => status.push(s),
    });

    m.agendar(["b"]);
    expect(status).toEqual(["salvando"]);
    await vi.advanceTimersByTimeAsync(ATRASO);
    expect(status).toEqual(["salvando", "salvo"]);
  });

  // ══════════════════════════════════════════════════════════════════ BUG 1
  // "o último movimento se perde ao sair rápido do modo"
  //
  // Antes: o cleanup de desmontagem só fazia `clearTimeout` — o `salvar`
  // agendado nunca acontecia, e o `router.refresh()` do pai trazia a ordem
  // ANTIGA. Contrato de interação §5: "sem risco de perda — cada movimento já
  // foi persistido".

  it("[BUG 1] finalizar() DISPARA o salvamento pendente do debounce, não o cancela", async () => {
    const chamadas: string[][] = [];
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a", "b"],
      atrasoMs: ATRASO,
      salvar: async (v) => {
        chamadas.push(v);
        return { ok: true };
      },
    });

    // O lojista move uma categoria e toca "Concluir" ANTES dos 500ms.
    m.agendar(["b", "a"]);
    vi.advanceTimersByTime(50);
    await m.finalizar();

    // O movimento foi persistido, e com a sequência final.
    expect(chamadas).toEqual([["b", "a"]]);
    // E é essa ordem que o servidor confirma — o `router.refresh()` que vem
    // depois lê o que acabou de ser gravado, não a ordem velha.
    expect(m.confirmada()).toEqual(["b", "a"]);
    expect(m.temPendencia()).toBe(false);
  });

  it("[BUG 1] finalizar() só RESOLVE depois que a rede responde (o refresh não corre junto)", async () => {
    const rede = adiado<ResultadoSalvamento>();
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a", "b"],
      atrasoMs: ATRASO,
      salvar: () => rede.promessa,
    });

    m.agendar(["b", "a"]);
    let finalizou = false;
    const saida = m.finalizar().then(() => {
      finalizou = true;
    });

    // A rede ainda não respondeu: quem sai do modo continua esperando. É esta
    // ordem — flush ANTES do refresh — que impede o servidor de devolver a
    // ordem antiga por cima do movimento recém-feito.
    await vi.advanceTimersByTimeAsync(ATRASO * 4);
    expect(finalizou).toBe(false);

    rede.resolver({ ok: true });
    await saida;
    expect(finalizou).toBe(true);
    expect(m.confirmada()).toEqual(["b", "a"]);
  });

  it("[BUG 1] finalizar() sem nada pendente resolve na hora e não escreve", async () => {
    const salvar = vi.fn(async (): Promise<ResultadoSalvamento> => ({ ok: true }));
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a"],
      atrasoMs: ATRASO,
      salvar,
    });

    await m.finalizar();
    expect(salvar).not.toHaveBeenCalled();
  });

  it("[BUG 1] finalizar() drena também o valor que ficou na FILA atrás de uma chamada em voo", async () => {
    const chamadas: string[][] = [];
    const primeira = adiado<ResultadoSalvamento>();
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a", "b", "c"],
      atrasoMs: ATRASO,
      salvar: async (v) => {
        chamadas.push(v);
        return chamadas.length === 1 ? primeira.promessa : { ok: true };
      },
    });

    m.agendar(["b", "a", "c"]);
    await vi.advanceTimersByTimeAsync(ATRASO); // 1ª sai, fica em voo
    m.agendar(["c", "b", "a"]); // enfileira enquanto a 1ª não voltou

    const saida = m.finalizar();
    primeira.resolver({ ok: true });
    await saida;

    expect(chamadas).toEqual([
      ["b", "a", "c"],
      ["c", "b", "a"],
    ]);
    expect(m.confirmada()).toEqual(["c", "b", "a"]);
  });

  // ══════════════════════════════════════════════════════════════════ BUG 2
  // "o revert pode restaurar um estado que não é o do banco"
  //
  // Antes: o debounce cancelava o TIMER mas nunca a PROMISE já disparada. Em
  // rede lenta duas chamadas ficavam em voo; se A gravava com SUCESSO e
  // respondia depois de B começar, o guard de resposta obsoleta descartava esse
  // sucesso sem atualizar a ordem confirmada — e o revert de uma falha em B
  // voltava para o snapshot de ANTES de A, um estado que nunca existiu no banco.

  it("[BUG 2] NUNCA há duas chamadas em voo: a segunda só sai quando a primeira responde", async () => {
    let emVoo = 0;
    let maximoSimultaneo = 0;
    const primeira = adiado<ResultadoSalvamento>();
    const chamadas: string[][] = [];

    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a", "b", "c"],
      atrasoMs: ATRASO,
      salvar: async (v) => {
        chamadas.push(v);
        emVoo += 1;
        maximoSimultaneo = Math.max(maximoSimultaneo, emVoo);
        try {
          return chamadas.length === 1 ? await primeira.promessa : { ok: true };
        } finally {
          emVoo -= 1;
        }
      },
    });

    m.agendar(["b", "a", "c"]);
    await vi.advanceTimersByTimeAsync(ATRASO); // A parte e trava na rede
    m.agendar(["c", "b", "a"]);
    await vi.advanceTimersByTimeAsync(ATRASO); // o debounce de B vence...

    // ...mas B NÃO parte enquanto A não responde.
    expect(chamadas).toEqual([["b", "a", "c"]]);
    expect(maximoSimultaneo).toBe(1);

    primeira.resolver({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(chamadas).toEqual([
      ["b", "a", "c"],
      ["c", "b", "a"],
    ]);
    expect(maximoSimultaneo).toBe(1);
  });

  it("[BUG 2] falha DEPOIS de um sucesso reverte para o que o BANCO tem, não para o snapshot anterior", async () => {
    const revertidoPara: string[][] = [];
    const primeira = adiado<ResultadoSalvamento>();
    const chamadas: string[][] = [];

    const INICIAL = ["a", "b", "c"];
    const APOS_A = ["b", "a", "c"]; // gravada com SUCESSO
    const APOS_B = ["c", "b", "a"]; // falha

    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: INICIAL,
      atrasoMs: ATRASO,
      salvar: async (v) => {
        chamadas.push(v);
        if (chamadas.length === 1) return primeira.promessa;
        return { ok: false, erro: "Não foi possível salvar a ordem." };
      },
      aoFalhar: (confirmada) => revertidoPara.push([...confirmada]),
    });

    // A parte e demora (rede 3G). B é agendada no meio da viagem.
    m.agendar(APOS_A);
    await vi.advanceTimersByTimeAsync(ATRASO);
    m.agendar(APOS_B);
    await vi.advanceTimersByTimeAsync(ATRASO);

    // A responde com SUCESSO — o banco passa a ter APOS_A.
    primeira.resolver({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(m.confirmada()).toEqual(APOS_A);

    // B então falha. O revert TEM que ir para APOS_A (o que está no banco),
    // nunca para INICIAL — que é o bug: um estado que nunca existiu no banco.
    await vi.advanceTimersByTimeAsync(0);
    expect(revertidoPara).toEqual([APOS_A]);
    expect(revertidoPara[0]).not.toEqual(INICIAL);
    expect(m.confirmada()).toEqual(APOS_A);
  });

  it("[BUG 2] a falha descarta a fila — nada é reenviado por cima do revert", async () => {
    const chamadas: string[][] = [];
    const primeira = adiado<ResultadoSalvamento>();
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a", "b"],
      atrasoMs: ATRASO,
      salvar: async (v) => {
        chamadas.push(v);
        return chamadas.length === 1
          ? primeira.promessa
          : ({ ok: true } as ResultadoSalvamento);
      },
      aoFalhar: () => {},
    });

    m.agendar(["b", "a"]);
    await vi.advanceTimersByTimeAsync(ATRASO);
    m.agendar(["a", "b"]); // enfileirada atrás da 1ª
    await vi.advanceTimersByTimeAsync(ATRASO);

    primeira.resolver({ ok: false, erro: "Não foi possível salvar a ordem." });
    await vi.advanceTimersByTimeAsync(0);

    expect(chamadas).toEqual([["b", "a"]]);
    expect(m.temPendencia()).toBe(false);
  });

  it("[BUG 2] o revert leva a mensagem genérica da action, nunca o detalhe do banco", async () => {
    const erros: string[] = [];
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a"],
      atrasoMs: ATRASO,
      salvar: async () => ({ ok: false, erro: "Não foi possível salvar a ordem." }),
      aoFalhar: (_confirmada, erro) => erros.push(erro),
    });

    m.agendar(["b"]);
    await vi.advanceTimersByTimeAsync(ATRASO);
    expect(erros).toEqual(["Não foi possível salvar a ordem."]);
    // A ordem confirmada NÃO avança numa falha.
    expect(m.confirmada()).toEqual(["a"]);
  });

  it("[BUG 2] exceção de transporte é tratada como falha genérica, sem vazar detalhe", async () => {
    const erros: string[] = [];
    const m = criarSalvamentoCoalescido<string[]>({
      confirmada: ["a"],
      atrasoMs: ATRASO,
      salvar: async () => {
        throw new Error("ECONNRESET host interno 10.0.0.4");
      },
      aoFalhar: (_confirmada, erro) => erros.push(erro),
    });

    m.agendar(["b"]);
    await vi.advanceTimersByTimeAsync(ATRASO);

    expect(erros).toEqual(["Não foi possível salvar a ordem."]);
    expect(erros[0]).not.toContain("ECONNRESET");
    expect(m.confirmada()).toEqual(["a"]);
  });
});
