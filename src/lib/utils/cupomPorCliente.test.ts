import { describe, it, expect } from "vitest";

/**
 * Fase RED (TDD) da issue 342 — regra ÚNICA de cupom por cliente (decisões 9 e 9-A),
 * usada por `criarPedido` E `revisarCarrinhoAction` (sem duplicar a lógica — tasks/342 §Escopo).
 *
 * Autoridade: specs/cliente-vinculo-pedido.md RN-C06/C08/C09/C10 · copy aprovada.
 *
 * Contrato (alvo: `src/lib/utils/cupomPorCliente.ts`, função PURA):
 *   avaliarCupomPorCliente({ limitePorCliente, clienteId, usosDoCliente })
 *     → { permitido: true }
 *     | { permitido: false; motivo: "entrar_na_conta" | "limite_atingido"; mensagem: string }
 *
 * Por que é RED: o módulo não existe. O import é por especificador em variável (sem
 * stub em código de produção, a pedido do orquestrador); `carregar()` falha com `[RED 342]`.
 */

const ESPECIFICADOR = "@/lib/utils/cupomPorCliente";

type Veredito =
  | { permitido: true }
  | { permitido: false; motivo: "entrar_na_conta" | "limite_atingido"; mensagem: string };
type Avaliar = (e: {
  limitePorCliente: number | null | undefined;
  clienteId: string | null;
  usosDoCliente: number;
}) => Veredito;

async function carregar(): Promise<Avaliar> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ ESPECIFICADOR)) as Record<string, unknown>;
  } catch {
    throw new Error("[RED 342] src/lib/utils/cupomPorCliente.ts ainda não existe (P28 cria).");
  }
  if (typeof mod.avaliarCupomPorCliente !== "function") {
    throw new Error("[RED 342] avaliarCupomPorCliente não exportada.");
  }
  return mod.avaliarCupomPorCliente as Avaliar;
}

const CLIENTE = "c3420000-0000-4000-8000-0000000000ca";
const MSG_ENTRAR = "Entre na sua conta para usar este cupom";
const MSG_LIMITE = "Você já usou este cupom o máximo de vezes permitido.";

describe("342 avaliarCupomPorCliente — tabela de decisão", () => {
  it("sem limite_por_cliente (null) + convidado → permitido (só a regra global, RN-C09)", async () => {
    const f = await carregar();
    expect(f({ limitePorCliente: null, clienteId: null, usosDoCliente: 0 })).toEqual({ permitido: true });
  });

  it("sem limite_por_cliente (undefined: linha antiga, antes do regen de tipos) + convidado → permitido", async () => {
    const f = await carregar();
    expect(f({ limitePorCliente: undefined, clienteId: null, usosDoCliente: 0 })).toEqual({ permitido: true });
  });

  it("sem limite_por_cliente + logado com muitos usos → permitido (contagem por cliente não se aplica)", async () => {
    const f = await carregar();
    expect(f({ limitePorCliente: null, clienteId: CLIENTE, usosDoCliente: 50 })).toEqual({ permitido: true });
  });

  it("com limite + convidado → recusado, motivo entrar_na_conta, copy da decisão 9-A", async () => {
    const f = await carregar();
    expect(f({ limitePorCliente: 1, clienteId: null, usosDoCliente: 0 })).toEqual({
      permitido: false,
      motivo: "entrar_na_conta",
      mensagem: MSG_ENTRAR,
    });
  });

  it("com limite 2 + logado com 1 uso → permitido", async () => {
    const f = await carregar();
    expect(f({ limitePorCliente: 2, clienteId: CLIENTE, usosDoCliente: 1 })).toEqual({ permitido: true });
  });

  it("com limite 2 + logado com 2 usos (borda: >= limite) → recusado, motivo limite_atingido", async () => {
    const f = await carregar();
    expect(f({ limitePorCliente: 2, clienteId: CLIENTE, usosDoCliente: 2 })).toEqual({
      permitido: false,
      motivo: "limite_atingido",
      mensagem: MSG_LIMITE,
    });
  });

  it("com limite 1 + logado com 3 usos (acima, ex.: limite reduzido depois) → limite_atingido", async () => {
    const f = await carregar();
    expect(f({ limitePorCliente: 1, clienteId: CLIENTE, usosDoCliente: 3 })).toMatchObject({
      permitido: false,
      motivo: "limite_atingido",
    });
  });
});
