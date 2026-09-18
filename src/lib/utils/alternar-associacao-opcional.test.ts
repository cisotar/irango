import { describe, it, expect, vi } from "vitest";

import {
  alternarAssociacaoOpcional,
  proximaSelecao,
  ERRO_GENERICO_ASSOCIACAO,
  type DepsAlternarAssociacao,
} from "./alternar-associacao-opcional";

/**
 * O que estes testes existem para travar é a ORDEM: o flush do reorder pendente
 * TEM que resolver antes de a seleção mudar e antes de a gravação sair. Essa era
 * a única lógica de risco da issue 213 sem cobertura possível — dentro do
 * componente ela só roda a partir de um `onCheckedChange`, e este projeto não
 * tem jsdom para disparar evento.
 *
 * A prova não é "as funções foram chamadas": é um `finalizar` que só resolve
 * quando o teste manda, provando que `salvar` fica esperando.
 */

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function deps(over: Partial<DepsAlternarAssociacao> = {}) {
  const chamadas: string[] = [];
  const base: DepsAlternarAssociacao = {
    finalizarReordenacao: () => {
      chamadas.push("finalizar");
      return Promise.resolve();
    },
    salvar: async (ids) => {
      chamadas.push(`salvar:${ids.join(",")}`);
      return { ok: true };
    },
    aplicarSelecao: (s) => chamadas.push(`selecao:${[...s].sort().join(",")}`),
    definirStatus: (st) => chamadas.push(`status:${st}`),
    avisarErro: (m) => chamadas.push(`erro:${m}`),
    anunciar: (f) => chamadas.push(`anuncio:${f}`),
    aoSucesso: () => chamadas.push("sucesso"),
    registrarErro: () => {},
    ...over,
  };
  return { deps: base, chamadas };
}

describe("proximaSelecao", () => {
  it("marcar adiciona sem mutar o conjunto recebido (o anterior é o revert)", () => {
    const atuais = new Set([A]);
    const r = proximaSelecao(atuais, B, true);
    expect([...r].sort()).toEqual([A, B].sort());
    expect([...atuais]).toEqual([A]);
  });

  it("desmarcar remove sem mutar o recebido", () => {
    const atuais = new Set([A, B]);
    const r = proximaSelecao(atuais, B, false);
    expect([...r]).toEqual([A]);
    expect([...atuais].sort()).toEqual([A, B].sort());
  });
});

describe("alternarAssociacaoOpcional — a ORDEM é a trava da corrida", () => {
  it("salvar NÃO sai enquanto o flush do reorder não resolve", async () => {
    let liberarFlush: () => void = () => {};
    const flushPendente = new Promise<void>((res) => {
      liberarFlush = res;
    });
    const { deps: d, chamadas } = deps({
      finalizarReordenacao: () => flushPendente,
    });

    const promessa = alternarAssociacaoOpcional(new Set([A]), B, true, "ok", d);

    // Gira o microtask queue: se a ordem estivesse invertida, `salvar` e
    // `selecao` já teriam acontecido aqui, com o flush ainda pendente.
    await Promise.resolve();
    await Promise.resolve();
    expect(chamadas.some((c) => c.startsWith("salvar"))).toBe(false);
    expect(chamadas.some((c) => c.startsWith("selecao"))).toBe(false);

    liberarFlush();
    await promessa;
    expect(chamadas.some((c) => c.startsWith("salvar"))).toBe(true);
  });

  it("a sequência completa do caminho feliz, em ordem", async () => {
    const { deps: d, chamadas } = deps();
    const ok = await alternarAssociacaoOpcional(
      new Set([A]),
      B,
      true,
      "B incluído. Posição 2 de 2.",
      d,
    );
    expect(ok).toBe(true);
    expect(chamadas).toEqual([
      "status:salvando",
      "finalizar",
      `selecao:${[A, B].sort().join(",")}`,
      `salvar:${A},${B}`,
      "status:salvo",
      "anuncio:B incluído. Posição 2 de 2.",
      "sucesso",
    ]);
  });

  it("a seleção só muda DEPOIS do flush — nunca antes", async () => {
    const { deps: d, chamadas } = deps();
    await alternarAssociacaoOpcional(new Set([A]), B, true, "f", d);
    expect(chamadas.indexOf("finalizar")).toBeLessThan(
      chamadas.findIndex((c) => c.startsWith("selecao")),
    );
  });

  it("sem lista montada (finalizar devolve undefined) o fluxo segue", async () => {
    const { deps: d, chamadas } = deps({
      finalizarReordenacao: () => undefined,
    });
    const ok = await alternarAssociacaoOpcional(new Set(), A, true, "f", d);
    expect(ok).toBe(true);
    expect(chamadas).toContain("sucesso");
  });
});

describe("alternarAssociacaoOpcional — falhas", () => {
  it("{ ok:false } reverte a seleção, limpa o status e mostra a mensagem da action", async () => {
    const { deps: d, chamadas } = deps({
      salvar: async () => ({ ok: false, erro: "Não foi possível salvar a ordem." }),
    });
    const ok = await alternarAssociacaoOpcional(new Set([A, C]), B, true, "f", d);
    expect(ok).toBe(false);
    // último `selecao` volta ao conjunto anterior
    const selecoes = chamadas.filter((c) => c.startsWith("selecao:"));
    expect(selecoes.at(-1)).toBe(`selecao:${[A, C].sort().join(",")}`);
    expect(chamadas).toContain("status:");
    expect(chamadas).toContain("erro:Não foi possível salvar a ordem.");
    expect(chamadas).not.toContain("sucesso");
  });

  it("EXCEÇÃO na gravação não deixa o status preso em 'salvando'", async () => {
    // Era o bug: sem catch, o status ficava "Salvando…" para sempre e o
    // lojista não recebia aviso nenhum.
    const { deps: d, chamadas } = deps({
      salvar: async () => {
        throw new Error("rede caiu");
      },
    });
    const ok = await alternarAssociacaoOpcional(new Set([A]), B, true, "f", d);
    expect(ok).toBe(false);
    expect(chamadas.at(-1)).toBe(`erro:${ERRO_GENERICO_ASSOCIACAO}`);
    expect(chamadas).toContain("status:");
    expect(chamadas).not.toContain("sucesso");
  });

  it("EXCEÇÃO no flush é tratada igual — não vaza para quem chamou", async () => {
    const { deps: d, chamadas } = deps({
      finalizarReordenacao: () => Promise.reject(new Error("flush falhou")),
    });
    await expect(
      alternarAssociacaoOpcional(new Set([A]), B, true, "f", d),
    ).resolves.toBe(false);
    expect(chamadas).not.toContain("sucesso");
    expect(chamadas.at(-1)).toBe(`erro:${ERRO_GENERICO_ASSOCIACAO}`);
  });

  it("a mensagem de erro é genérica e única — nunca vaza detalhe do banco", async () => {
    const { deps: d, chamadas } = deps({
      salvar: async () => {
        throw new Error("duplicate key value violates unique constraint");
      },
    });
    await alternarAssociacaoOpcional(new Set(), A, true, "f", d);
    const erros = chamadas.filter((c) => c.startsWith("erro:"));
    expect(erros).toEqual([`erro:${ERRO_GENERICO_ASSOCIACAO}`]);
    expect(erros[0]).not.toContain("duplicate key");
  });

  it("registra a exceção real para o log do servidor", async () => {
    const registrarErro = vi.fn();
    const { deps: d } = deps({
      salvar: async () => {
        throw new Error("boom");
      },
      registrarErro,
    });
    await alternarAssociacaoOpcional(new Set(), A, true, "f", d);
    expect(registrarErro).toHaveBeenCalledTimes(1);
  });
});
