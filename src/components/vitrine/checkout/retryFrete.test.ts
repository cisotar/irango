// RED (TDD red-first) — issue 180-B, teste nº 11 do plano.
//
// `criarRetryFrete` é um STUB (`throw TODO: GREEN`) — todas as expectativas
// abaixo são VERMELHAS por asserção, não por import quebrado.
//
// Relógio INJETADO (plan/180-B §D8): `agendar`/`cancelar` chegam por parâmetro,
// como em `aberturaWhatsapp.ts` e `criarControladorPolling`. Nada de timer real
// aqui — o repo roda `environment: node`, sem jsdom, e um teste que espera 20s
// de verdade não é teste.
//
// Decisões do usuário travadas por estes testes:
//   - a chamada que ABRIU o modal já é a tentativa 1; o cliente faz mais 2
//     (t=10s e t=20s) — 3 no total, 2 chamadas EXTRAS no máximo;
//   - motivo `esgotado` NÃO retenta (nem consome tentativa, nem exibe spinner):
//     pula direto ao passo do WhatsApp;
//   - `nao_encontrado` idem — só `transitorio` retriável faz retry.
//
// O servidor NÃO valida nada disso: não conta tentativa, não guarda estado de
// retry, não confia em contador do cliente. O único efeito deste módulo é
// QUANDO o cliente pede de novo — nunca QUANTO ele paga.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  criarRetryFrete,
  ATRASOS_RETRY_MS,
  type DepsRetryFrete,
  type EstadoRetry,
  type ResultadoTentativaFrete,
} from "./retryFrete";
import {
  VEREDITO_A_COMBINAR_RETRIAVEL,
  VEREDITO_A_COMBINAR_ESGOTADO,
  VEREDITO_A_COMBINAR_CEP,
} from "@/lib/utils/freteDegradado";

/** Relógio falso: guarda os agendamentos e dispara sob demanda. */
function relogioFalso() {
  let proximoId = 1;
  const pendentes = new Map<number, { fn: () => void; ms: number }>();
  return {
    pendentes,
    agendar: vi.fn((fn: () => void, ms: number) => {
      const id = proximoId++;
      pendentes.set(id, { fn, ms });
      return id;
    }),
    cancelar: vi.fn((id: number) => {
      pendentes.delete(id);
    }),
    /** Dispara o agendamento mais antigo ainda pendente. */
    async avancar() {
      const [id, alvo] = [...pendentes.entries()][0] ?? [];
      if (id == null || alvo == null) throw new Error("nenhum timer pendente");
      pendentes.delete(id);
      alvo.fn();
      // Deixa a microtask da tentativa assíncrona resolver.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    /** Atrasos agendados, na ordem. */
    atrasos(): number[] {
      return this.agendar.mock.calls.map((c) => c[1] as number);
    },
  };
}

const SUCESSO: ResultadoTentativaFrete = {
  ok: true,
  taxa_preview: 3,
  zona_nome: "Zona Raio 5km",
};
const AINDA_A_COMBINAR: ResultadoTentativaFrete = {
  ok: true,
  a_combinar: true,
  veredito: VEREDITO_A_COMBINAR_RETRIAVEL,
};
const AGORA_ESGOTADO: ResultadoTentativaFrete = {
  ok: true,
  a_combinar: true,
  veredito: VEREDITO_A_COMBINAR_ESGOTADO,
};

let relogio: ReturnType<typeof relogioFalso>;
let tentar: ReturnType<typeof vi.fn>;
let estados: EstadoRetry[];

function deps(): DepsRetryFrete {
  return {
    tentar: tentar as unknown as DepsRetryFrete["tentar"],
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
    aoEstado: (e) => estados.push(e),
  };
}

beforeEach(() => {
  relogio = relogioFalso();
  estados = [];
  tentar = vi.fn(async () => AINDA_A_COMBINAR);
});

describe("[180-B] ATRASOS_RETRY_MS — t=10s e t=20s", () => {
  it("são exatamente dois atrasos de 10s (a 1ª tentativa já aconteceu fora daqui)", () => {
    expect([...ATRASOS_RETRY_MS]).toEqual([10_000, 10_000]);
  });
});

describe("[180-B] criarRetryFrete — motivo retriável", () => {
  it("iniciar() NÃO tenta imediatamente: a chamada que abriu o modal já é a tentativa 1", () => {
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_RETRIAVEL);

    expect(tentar).not.toHaveBeenCalled();
    expect(relogio.atrasos()).toEqual([10_000]);
  });

  it("agenda em t=10s e, se falhar de novo, em t=20s — no máximo 2 chamadas EXTRAS", async () => {
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_RETRIAVEL);

    await relogio.avancar(); // tentativa 2
    expect(tentar).toHaveBeenCalledTimes(1);

    await relogio.avancar(); // tentativa 3
    expect(tentar).toHaveBeenCalledTimes(2);

    expect(relogio.atrasos()).toEqual([10_000, 10_000]);
    // Esgotadas as 3 tentativas, NADA mais é agendado.
    expect(relogio.pendentes.size).toBe(0);
  });

  it("sucesso na 2ª tentativa cancela a 3ª (nenhum timer pendente, nenhuma chamada extra)", async () => {
    tentar.mockResolvedValueOnce(SUCESSO);
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_RETRIAVEL);

    await relogio.avancar();

    expect(tentar).toHaveBeenCalledTimes(1);
    expect(relogio.pendentes.size).toBe(0);
    expect(estados.at(-1)).toEqual({ tentativa: 2, fase: "sucesso" });
  });

  it("sucesso na 3ª tentativa (a 2ª ainda falhando) cancela qualquer timer pendente e reporta sucesso na tentativa 3", async () => {
    tentar
      .mockResolvedValueOnce(AINDA_A_COMBINAR) // tentativa 2: continua a combinar
      .mockResolvedValueOnce(SUCESSO); // tentativa 3: resolve
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_RETRIAVEL);

    await relogio.avancar(); // dispara tentativa 2 (falha, agenda a 3ª)
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(relogio.pendentes.size).toBe(1); // t=20s agendado

    await relogio.avancar(); // dispara tentativa 3 (sucesso)
    expect(tentar).toHaveBeenCalledTimes(2);
    expect(relogio.pendentes.size).toBe(0);
    expect(estados.at(-1)).toEqual({ tentativa: 3, fase: "sucesso" });
  });

  it("uma retentativa que volta 'esgotado' NÃO agenda a próxima", async () => {
    tentar.mockResolvedValueOnce(AGORA_ESGOTADO);
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_RETRIAVEL);

    await relogio.avancar();

    expect(tentar).toHaveBeenCalledTimes(1);
    expect(relogio.pendentes.size).toBe(0);
    expect(estados.at(-1)).toEqual({ tentativa: 2, fase: "esgotado" });
  });

  it("reporta o estado para a UI ('tentativa 2 de 3') antes de cada retentativa", async () => {
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_RETRIAVEL);
    await relogio.avancar();

    expect(estados).toContainEqual({ tentativa: 2, fase: "tentando" });
    expect(estados.every((e) => e.tentativa >= 1 && e.tentativa <= 3)).toBe(true);
  });
});

describe("[180-B] criarRetryFrete — motivos que NÃO retentam", () => {
  it("'esgotado' não agenda NADA e não consome tentativa (vai direto ao passo do WhatsApp)", () => {
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_ESGOTADO);

    expect(relogio.agendar).not.toHaveBeenCalled();
    expect(tentar).not.toHaveBeenCalled();
    expect(estados.at(-1)).toEqual({ tentativa: 1, fase: "esgotado" });
  });

  it("'nao_encontrado' (a_combinar_cep) não agenda nada — retentar um CEP inválido não resolve", () => {
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_CEP);

    expect(relogio.agendar).not.toHaveBeenCalled();
    expect(tentar).not.toHaveBeenCalled();
  });
});

describe("[180-B] criarRetryFrete — parar()", () => {
  it("parar() limpa o timer pendente (unmount / voltar etapa / fechar aba)", () => {
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_RETRIAVEL);
    expect(relogio.pendentes.size).toBe(1);

    c.parar();

    expect(relogio.cancelar).toHaveBeenCalledTimes(1);
    expect(relogio.pendentes.size).toBe(0);
  });

  it("parar() é idempotente e não lança se nada estiver agendado", () => {
    const c = criarRetryFrete(deps());
    expect(() => {
      c.parar();
      c.parar();
    }).not.toThrow();
  });

  it("depois de parar(), o timer que já tinha disparado não produz nova tentativa", async () => {
    const c = criarRetryFrete(deps());
    c.iniciar(VEREDITO_A_COMBINAR_RETRIAVEL);
    c.parar();

    expect(relogio.pendentes.size).toBe(0);
    expect(tentar).not.toHaveBeenCalled();
  });
});

describe("[180-B] o relógio não é autoridade sobre dinheiro", () => {
  it("o módulo não importa nada de servidor/valor — só mecânica e o enum de veredito", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./retryFrete.ts", import.meta.url), "utf8");
    // Nenhum acesso a timer/janela global: tudo injetado (sem jsdom no repo).
    expect(src).not.toMatch(/\bwindow\b|\bsetTimeout\(|\bclearTimeout\(/);
    // Nenhum campo monetário é calculado ou guardado aqui.
    expect(src).not.toMatch(/taxa_entrega|p_total|calcularFrete\(/);
  });
});
