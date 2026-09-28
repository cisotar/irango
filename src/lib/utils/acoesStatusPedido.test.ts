/**
 * Fase RED (TDD) — issue 329 (crítica: SIM), spec
 * `specs/status-pedido-clicavel-e-latencia.md` (RN-SC2, RN-SC5, RN-SC6, RN-SC11,
 * RN-SC13, "Testabilidade").
 *
 * `src/lib/utils/acoesStatusPedido.ts` ainda NÃO existe. Cada teste importa o
 * módulo dinamicamente (padrão de `faixasEntrega.test.ts`/`freteCombinado.test.ts`)
 * e falha individualmente até a fase GREEN criá-lo.
 *
 * CONTRATO que o GREEN deve satisfazer (módulo PURO, sem React, sem I/O):
 *
 *   acoesDisponiveis(status, tipoEntrega): {
 *     status: StatusPedido; rotulo: string; destrutiva: boolean;
 *     exigeConfirmacao: boolean; principal: boolean;
 *   }[]                         — já na ordem de exibição (RN-SC13)
 *   ehAtalho(de, para): boolean — a ação pula etapa (pendente|confirmado → saiu_entrega)
 *   origensPermitidas(para): StatusPedido[] — de onde `para` é alcançável
 *                                (usado no UPDATE condicional `.in("status", …)`)
 *   executarAcaoStatus(acao, deps): Promise<boolean>
 *                              — orquestração pura "confirmar → action → refresh"
 *                                (S2 da issue; padrão `alternarAssociacaoOpcional`)
 *
 * Tudo DERIVA de `transicaoPermitida` (fonte única do grafo, `TRANSICOES`). Os
 * testes de derivação cruzam as três funções com `transicaoPermitida` nos 36
 * pares, então uma segunda lista de arestas que divergir do grafo cai aqui.
 */

import { describe, it, expect, vi } from "vitest";

import {
  STATUS_VALIDOS,
  transicaoPermitida,
  type StatusPedido,
} from "./transicaoStatus";
import type { ResultadoAtualizarStatus } from "@/lib/actions/status";

async function mod() {
  return import("./acoesStatusPedido");
}

const TODOS: StatusPedido[] = [...STATUS_VALIDOS];
const NAO_TERMINAIS: StatusPedido[] = ["pendente", "confirmado", "em_preparo", "saiu_entrega"];

type Acao = {
  status: StatusPedido;
  rotulo: string;
  destrutiva: boolean;
  exigeConfirmacao: boolean;
  principal: boolean;
};

const ordenado = (xs: readonly string[]) => [...xs].sort();

// ─────────────────────────────────────────────────────────── origensPermitidas
describe("origensPermitidas(para) — derivada do grafo (usada no UPDATE condicional)", () => {
  it.each(TODOS)(
    "para=%s: `de` está em origensPermitidas(para) ⇔ transicaoPermitida(de, para), nos 6 `de`",
    async (para) => {
      const { origensPermitidas } = await mod();
      const origens = origensPermitidas(para);
      for (const de of TODOS) {
        expect({ de, para, contido: origens.includes(de) }).toEqual({
          de,
          para,
          contido: transicaoPermitida(de, para),
        });
      }
    },
  );

  it("origensPermitidas('saiu_entrega') = {pendente, confirmado, em_preparo} (atalho + passo normal)", async () => {
    const { origensPermitidas } = await mod();
    expect(ordenado(origensPermitidas("saiu_entrega"))).toEqual([
      "confirmado",
      "em_preparo",
      "pendente",
    ]);
  });

  it("origensPermitidas('pendente') = [] — nenhum status volta para pendente", async () => {
    const { origensPermitidas } = await mod();
    expect(origensPermitidas("pendente")).toEqual([]);
  });

  it("origensPermitidas('entregue') = ['saiu_entrega'] — não se pula para entregue", async () => {
    const { origensPermitidas } = await mod();
    expect(origensPermitidas("entregue")).toEqual(["saiu_entrega"]);
  });

  it("origensPermitidas('cancelado') = {pendente, confirmado, em_preparo} — saiu_entrega não cancela", async () => {
    const { origensPermitidas } = await mod();
    expect(ordenado(origensPermitidas("cancelado"))).toEqual([
      "confirmado",
      "em_preparo",
      "pendente",
    ]);
  });

  it("nenhum status terminal aparece como origem de nada", async () => {
    const { origensPermitidas } = await mod();
    for (const para of TODOS) {
      const origens = origensPermitidas(para);
      expect(origens).not.toContain("entregue");
      expect(origens).not.toContain("cancelado");
    }
  });
});

// ─────────────────────────────────────────────────────────────────── ehAtalho
describe("ehAtalho(de, para) — a ação pula etapa (RN-SC6)", () => {
  it("pendente → saiu_entrega é atalho", async () => {
    const { ehAtalho } = await mod();
    expect(ehAtalho("pendente", "saiu_entrega")).toBe(true);
  });

  it("confirmado → saiu_entrega é atalho", async () => {
    const { ehAtalho } = await mod();
    expect(ehAtalho("confirmado", "saiu_entrega")).toBe(true);
  });

  it("em_preparo → saiu_entrega NÃO é atalho (é o passo normal)", async () => {
    const { ehAtalho } = await mod();
    expect(ehAtalho("em_preparo", "saiu_entrega")).toBe(false);
  });

  it("entre as 9 transições permitidas, só as 2 arestas da RN-SC2 são atalho", async () => {
    const { ehAtalho } = await mod();
    const atalhos: string[] = [];
    for (const de of TODOS) {
      for (const para of TODOS) {
        if (transicaoPermitida(de, para) && ehAtalho(de, para)) atalhos.push(`${de}>${para}`);
      }
    }
    expect(ordenado(atalhos)).toEqual(["confirmado>saiu_entrega", "pendente>saiu_entrega"]);
  });

  it("cancelar e avançar uma etapa não são atalho", async () => {
    const { ehAtalho } = await mod();
    expect(ehAtalho("pendente", "cancelado")).toBe(false);
    expect(ehAtalho("pendente", "confirmado")).toBe(false);
    expect(ehAtalho("confirmado", "em_preparo")).toBe(false);
    expect(ehAtalho("saiu_entrega", "entregue")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────── acoesDisponiveis
const CONFIRMAR: Acao = {
  status: "confirmado",
  rotulo: "Confirmar",
  destrutiva: false,
  exigeConfirmacao: false,
  principal: true,
};
const INICIAR_PREPARO: Acao = {
  status: "em_preparo",
  rotulo: "Iniciar preparo",
  destrutiva: false,
  exigeConfirmacao: false,
  principal: true,
};
const CANCELAR: Acao = {
  status: "cancelado",
  rotulo: "Cancelar",
  destrutiva: true,
  exigeConfirmacao: true,
  principal: false,
};
const MARCAR_ENTREGUE: Acao = {
  status: "entregue",
  rotulo: "Marcar entregue",
  destrutiva: false,
  exigeConfirmacao: false,
  principal: true,
};
const atalho = (rotulo: string): Acao => ({
  status: "saiu_entrega",
  rotulo,
  destrutiva: false,
  exigeConfirmacao: true,
  principal: false,
});
const passoSaiu = (rotulo: string): Acao => ({
  status: "saiu_entrega",
  rotulo,
  destrutiva: false,
  exigeConfirmacao: false,
  principal: true,
});

describe("acoesDisponiveis — ordem RN-SC13 (próxima etapa, atalho, Cancelar) por status × modalidade", () => {
  it("pendente + entrega → [Confirmar (principal), atalho 'Saiu pra entrega' (confirma), Cancelar (destrutiva, confirma)]", async () => {
    const { acoesDisponiveis } = await mod();
    expect(acoesDisponiveis("pendente", "entrega")).toEqual([
      CONFIRMAR,
      atalho("Saiu pra entrega"),
      CANCELAR,
    ]);
  });

  it("pendente + retirada → atalho com o rótulo 'Pronto para retirada' (RN-SC11)", async () => {
    const { acoesDisponiveis } = await mod();
    expect(acoesDisponiveis("pendente", "retirada")).toEqual([
      CONFIRMAR,
      atalho("Pronto para retirada"),
      CANCELAR,
    ]);
  });

  it("confirmado + entrega → [Iniciar preparo (principal), atalho 'Saiu pra entrega', Cancelar]", async () => {
    const { acoesDisponiveis } = await mod();
    expect(acoesDisponiveis("confirmado", "entrega")).toEqual([
      INICIAR_PREPARO,
      atalho("Saiu pra entrega"),
      CANCELAR,
    ]);
  });

  it("confirmado + retirada → atalho 'Pronto para retirada'", async () => {
    const { acoesDisponiveis } = await mod();
    expect(acoesDisponiveis("confirmado", "retirada")).toEqual([
      INICIAR_PREPARO,
      atalho("Pronto para retirada"),
      CANCELAR,
    ]);
  });

  it("em_preparo + entrega → [Saiu pra entrega (principal, SEM confirmação), Cancelar] — sem atalho duplicado", async () => {
    const { acoesDisponiveis } = await mod();
    expect(acoesDisponiveis("em_preparo", "entrega")).toEqual([
      passoSaiu("Saiu pra entrega"),
      CANCELAR,
    ]);
  });

  it("em_preparo + retirada → [Pronto para retirada (principal, SEM confirmação), Cancelar]", async () => {
    const { acoesDisponiveis } = await mod();
    expect(acoesDisponiveis("em_preparo", "retirada")).toEqual([
      passoSaiu("Pronto para retirada"),
      CANCELAR,
    ]);
  });

  it.each(["entrega", "retirada"])(
    "saiu_entrega + %s → [Marcar entregue] (única ação, sem confirmação, sem Cancelar)",
    async (tipo) => {
      const { acoesDisponiveis } = await mod();
      expect(acoesDisponiveis("saiu_entrega", tipo)).toEqual([MARCAR_ENTREGUE]);
    },
  );

  it.each(["entregue", "cancelado"] as const)("%s (terminal) → [] em qualquer modalidade", async (s) => {
    const { acoesDisponiveis } = await mod();
    expect(acoesDisponiveis(s, "entrega")).toEqual([]);
    expect(acoesDisponiveis(s, "retirada")).toEqual([]);
  });

  it.each([null, "", "drone"])(
    "tipoEntrega %j cai no rótulo de entrega (default seguro, RN-SC11)",
    async (tipo) => {
      const { acoesDisponiveis } = await mod();
      const rotulos = acoesDisponiveis("pendente", tipo).map((a: Acao) => a.rotulo);
      expect(rotulos).toContain("Saiu pra entrega");
      expect(rotulos).not.toContain("Pronto para retirada");
      const doPreparo = acoesDisponiveis("em_preparo", tipo).map((a: Acao) => a.rotulo);
      expect(doPreparo[0]).toBe("Saiu pra entrega");
    },
  );
});

describe("acoesDisponiveis — derivada do grafo (RN-SC5: menu = ações válidas)", () => {
  it.each(TODOS.flatMap((s) => [[s, "entrega"], [s, "retirada"]] as const))(
    "%s + %s: o conjunto de destinos é EXATAMENTE o que transicaoPermitida aceita",
    async (status, tipo) => {
      const { acoesDisponiveis } = await mod();
      const destinos = acoesDisponiveis(status, tipo).map((a: Acao) => a.status);
      const esperado = TODOS.filter((para) => transicaoPermitida(status, para));
      expect(ordenado(destinos)).toEqual(ordenado(esperado));
      // sem destino repetido (em_preparo não duplica saiu_entrega)
      expect(new Set(destinos).size).toBe(destinos.length);
    },
  );

  it.each(NAO_TERMINAIS)("%s: exatamente UMA ação principal, e ela é a primeira", async (s) => {
    const { acoesDisponiveis } = await mod();
    const acoes: Acao[] = acoesDisponiveis(s, "entrega");
    expect(acoes.filter((a) => a.principal)).toHaveLength(1);
    expect(acoes[0].principal).toBe(true);
  });

  it.each(NAO_TERMINAIS)(
    "%s: exigeConfirmacao ⇔ (ehAtalho(status, destino) || destino === 'cancelado'); destrutiva ⇔ cancelado; Cancelar é a última",
    async (s) => {
      const { acoesDisponiveis, ehAtalho } = await mod();
      const acoes: Acao[] = acoesDisponiveis(s, "entrega");
      for (const a of acoes) {
        expect({ destino: a.status, exige: a.exigeConfirmacao }).toEqual({
          destino: a.status,
          exige: ehAtalho(s, a.status) || a.status === "cancelado",
        });
        expect(a.destrutiva).toBe(a.status === "cancelado");
      }
      const iCancelar = acoes.findIndex((a) => a.status === "cancelado");
      if (iCancelar !== -1) expect(iCancelar).toBe(acoes.length - 1);
    },
  );
});

// ───────────────────────────────────── orquestração pura: confirmar → action → refresh
const ERRO_GENERICO = "Não foi possível atualizar o status do pedido.";

type Chamada = string;

function criarDeps(opcoes: {
  confirmacao?: Promise<boolean>;
  resultado?: ResultadoAtualizarStatus | Promise<ResultadoAtualizarStatus>;
  lancar?: unknown;
}) {
  const ordem: Chamada[] = [];
  const deps = {
    confirmar: vi.fn((acao: Acao) => {
      ordem.push(`confirmar:${acao.status}`);
      return opcoes.confirmacao ?? Promise.resolve(true);
    }),
    aplicarOtimista: vi.fn((status: StatusPedido) => {
      ordem.push(`otimista:${status}`);
    }),
    executar: vi.fn(async (status: StatusPedido): Promise<ResultadoAtualizarStatus> => {
      ordem.push(`executar:${status}`);
      if (opcoes.lancar !== undefined) throw opcoes.lancar;
      return opcoes.resultado ?? { ok: true, status };
    }),
    avisarSucesso: vi.fn(() => {
      ordem.push("sucesso");
    }),
    avisarErro: vi.fn((mensagem: string) => {
      ordem.push(`erro:${mensagem}`);
    }),
    refresh: vi.fn(() => {
      ordem.push("refresh");
    }),
    registrarErro: vi.fn(),
  };
  return { deps, ordem };
}

/** Deixa as microtarefas pendentes rodarem, sem resolver a confirmação. */
const drenar = () => new Promise((r) => setTimeout(r, 0));

describe("executarAcaoStatus — orquestração pura (confirmar → otimista → action → refresh)", () => {
  it("ação SEM confirmação (avançar etapa): não pergunta; otimista → action → sucesso → refresh, nessa ordem", async () => {
    const { executarAcaoStatus } = await mod();
    const { deps, ordem } = criarDeps({});
    const ok = await executarAcaoStatus(CONFIRMAR, deps);

    expect(ok).toBe(true);
    expect(deps.confirmar).not.toHaveBeenCalled();
    expect(ordem).toEqual(["otimista:confirmado", "executar:confirmado", "sucesso", "refresh"]);
  });

  it("CONFIRMAÇÃO PENDENTE não chama a action, não aplica otimista e não faz refresh", async () => {
    const { executarAcaoStatus } = await mod();
    const nuncaResolve = new Promise<boolean>(() => {});
    const { deps } = criarDeps({ confirmacao: nuncaResolve });

    void executarAcaoStatus(atalho("Saiu pra entrega"), deps);
    await drenar();

    expect(deps.confirmar).toHaveBeenCalledTimes(1);
    expect(deps.executar).not.toHaveBeenCalled();
    expect(deps.aplicarOtimista).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("confirmação RECUSADA ('Voltar') → action nunca chamada, nada muda, devolve false", async () => {
    const { executarAcaoStatus } = await mod();
    const { deps, ordem } = criarDeps({ confirmacao: Promise.resolve(false) });

    const ok = await executarAcaoStatus(CANCELAR, deps);

    expect(ok).toBe(false);
    expect(ordem).toEqual(["confirmar:cancelado"]);
    expect(deps.executar).not.toHaveBeenCalled();
    expect(deps.avisarErro).not.toHaveBeenCalled();
  });

  it("atalho CONFIRMADO → confirmar vem ANTES de otimista/action; depois sucesso → refresh", async () => {
    const { executarAcaoStatus } = await mod();
    const { deps, ordem } = criarDeps({ confirmacao: Promise.resolve(true) });

    const ok = await executarAcaoStatus(atalho("Pronto para retirada"), deps);

    expect(ok).toBe(true);
    expect(ordem).toEqual([
      "confirmar:saiu_entrega",
      "otimista:saiu_entrega",
      "executar:saiu_entrega",
      "sucesso",
      "refresh",
    ]);
  });

  it("servidor RECUSA ({ ok:false }) → avisa a mensagem genérica da action, sem toast de sucesso", async () => {
    const { executarAcaoStatus } = await mod();
    const { deps } = criarDeps({ resultado: { ok: false, erro: ERRO_GENERICO } });

    const ok = await executarAcaoStatus(CONFIRMAR, deps);

    expect(ok).toBe(false);
    expect(deps.avisarErro).toHaveBeenCalledWith(ERRO_GENERICO);
    expect(deps.avisarSucesso).not.toHaveBeenCalled();
  });

  it("action LANÇA (rede caiu) → mensagem genérica, sem vazar o erro, registra o detalhe, devolve false", async () => {
    const { executarAcaoStatus } = await mod();
    const falha = new Error("fetch failed: segredo interno XYZ");
    const { deps } = criarDeps({ lancar: falha });

    const ok = await executarAcaoStatus(CONFIRMAR, deps);

    expect(ok).toBe(false);
    expect(deps.avisarErro).toHaveBeenCalledTimes(1);
    expect(deps.avisarErro).toHaveBeenCalledWith(ERRO_GENERICO);
    expect(JSON.stringify(deps.avisarErro.mock.calls)).not.toContain("segredo");
    expect(deps.registrarErro).toHaveBeenCalledWith(falha);
    expect(deps.avisarSucesso).not.toHaveBeenCalled();
  });

  it("a action recebe o DESTINO da ação escolhida (nunca outro status)", async () => {
    const { executarAcaoStatus } = await mod();
    const { deps } = criarDeps({});
    await executarAcaoStatus(MARCAR_ENTREGUE, deps);
    expect(deps.executar).toHaveBeenCalledTimes(1);
    expect(deps.executar).toHaveBeenCalledWith("entregue");
  });
});
