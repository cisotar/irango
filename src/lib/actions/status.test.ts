import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `atualizarStatusPedido` (lojista) — issue 033, reescrita na fase RED da issue
 * 329 (crítica: SIM; spec `specs/status-pedido-clicavel-e-latencia.md` RN-SC2,
 * RN-SC4, Frente 2 item 3).
 *
 * CONTRATO NOVO (GREEN):
 *   - UMA ida ao banco, sem SELECT prévio do status:
 *       from("pedidos").update({ status }).eq("id", id)
 *         .in("status", origensPermitidas(novo)).select("id")
 *   - 0 linhas afetadas → `{ ok:false, erro: <genérico> }` (RLS de outra loja,
 *     status atual não é origem permitida, ou corrida — indistinguíveis).
 *   - erro de banco → `{ ok:false, erro: <genérico> }` + log, sem `error.message`.
 *   - destino sem origem (`"pendente"`) → `{ ok:false }` SEM criar client.
 *   - `pendente → saiu_entrega` (atalho RN-SC2) com 1 linha → `{ ok:true }`.
 *
 * O client AUTENTICADO é mockado (server.ts é server-only) por um AVALIADOR em
 * memória: guarda a linha do pedido e aplica os filtros encadeados, então a
 * decisão "grava ou não" vem do predicado que a action MANDA ao banco — não de
 * uma resposta fixa. `visivelParaUsuario = false` simula a RLS
 * `pedidos_acesso_lojista` de outra loja (a linha existe, o USING não casa).
 * O caminho antigo (SELECT + UPDATE sem condição) também é suportado pelo
 * avaliador, para que a implementação atual falhe por ASSERÇÃO, não por
 * TypeError.
 */

const ERRO_GENERICO = "Não foi possível atualizar o status do pedido.";
const PEDIDO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type Filtro = { col: string; op: "eq" | "in"; val: unknown };
type Chamada = [metodo: string, ...args: unknown[]];
type Consulta = { chamadas: Chamada[] };

const banco = {
  linha: null as null | { id: string; status: string },
  visivelParaUsuario: true,
  erroEscrita: null as null | { message: string },
  consultas: [] as Consulta[],
};

function casa(linha: Record<string, unknown>, f: Filtro): boolean {
  if (f.op === "eq") return linha[f.col] === f.val;
  return (f.val as unknown[]).includes(linha[f.col]);
}

function projetar(linha: Record<string, unknown>, colunas: string | undefined) {
  if (!colunas || colunas.trim() === "*") return { ...linha };
  return Object.fromEntries(
    colunas.split(",").map((c) => c.trim()).map((c) => [c, linha[c]]),
  );
}

function makeFakeClient() {
  return {
    from: (tabela: string) => {
      fromSpy(tabela);
      const consulta: Consulta = { chamadas: [] };
      banco.consultas.push(consulta);
      const q = {
        op: "select" as "select" | "update",
        patch: undefined as Record<string, unknown> | undefined,
        filtros: [] as Filtro[],
        colunas: undefined as string | undefined,
        unica: false,
      };
      const b: Record<string, unknown> = {};
      const registra = (m: string, args: unknown[]) => consulta.chamadas.push([m, ...args]);
      b.select = (...a: unknown[]) => {
        registra("select", a);
        q.colunas = a[0] as string | undefined;
        return b;
      };
      b.update = (...a: unknown[]) => {
        registra("update", a);
        q.op = "update";
        q.patch = a[0] as Record<string, unknown>;
        return b;
      };
      b.eq = (...a: unknown[]) => {
        registra("eq", a);
        q.filtros.push({ col: a[0] as string, op: "eq", val: a[1] });
        return b;
      };
      b.in = (...a: unknown[]) => {
        registra("in", a);
        q.filtros.push({ col: a[0] as string, op: "in", val: a[1] });
        return b;
      };
      b.single = (...a: unknown[]) => {
        registra("single", a);
        q.unica = true;
        return b;
      };
      b.maybeSingle = b.single;
      b.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => executar())
          .then(ok, falha);

      function executar() {
        const l = banco.linha;
        const visiveis =
          l && banco.visivelParaUsuario ? [l as Record<string, unknown>] : [];
        const casadas = visiveis.filter((x) => q.filtros.every((f) => casa(x, f)));
        if (q.op === "update") {
          if (banco.erroEscrita) return { data: null, error: banco.erroEscrita };
          for (const x of casadas) Object.assign(x, q.patch);
          return { data: casadas.map((x) => projetar(x, q.colunas)), error: null };
        }
        if (q.unica) {
          return casadas.length === 1
            ? { data: projetar(casadas[0], q.colunas), error: null }
            : { data: null, error: { code: "PGRST116", message: "0 rows" } };
        }
        return { data: casadas.map((x) => projetar(x, q.colunas)), error: null };
      }
      return b;
    },
  };
}

const fromSpy = vi.fn();
let fakeClient: ReturnType<typeof makeFakeClient>;
const createClient = vi.fn(async () => fakeClient);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

import { atualizarStatusPedido } from "./status";

/** Todas as chamadas feitas a partir de `from("pedidos")` que contêm um UPDATE. */
function consultasDeEscrita(): Consulta[] {
  return banco.consultas.filter((c) => c.chamadas.some(([m]) => m === "update"));
}
function consultasDeLeitura(): Consulta[] {
  return banco.consultas.filter((c) => !c.chamadas.some(([m]) => m === "update"));
}
/** Argumento de `.in("status", …)` do UPDATE, ordenado (a ordem não é contrato). */
function origensDoUpdate(): string[] | undefined {
  const escrita = consultasDeEscrita()[0];
  const chamadaIn = escrita?.chamadas.find(([m, col]) => m === "in" && col === "status");
  return chamadaIn ? [...(chamadaIn[2] as string[])].sort() : undefined;
}
function statusNoBanco(): string | undefined {
  return banco.linha?.status;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient = makeFakeClient();
  createClient.mockResolvedValue(fakeClient);
  banco.linha = { id: PEDIDO, status: "pendente" };
  banco.visivelParaUsuario = true;
  banco.erroEscrita = null;
  banco.consultas = [];
});

describe("atualizarStatusPedido — UPDATE condicional em uma ida (RN-SC4, issue 329)", () => {
  it("forma EXATA do UPDATE: update({status}).eq('id', id).in('status', origens).select('id')", async () => {
    await atualizarStatusPedido(PEDIDO, "confirmado");

    const escritas = consultasDeEscrita();
    expect(escritas).toHaveLength(1);
    expect(escritas[0].chamadas).toEqual([
      ["update", { status: "confirmado" }],
      ["eq", "id", PEDIDO],
      ["in", "status", ["pendente"]],
      ["select", "id"],
    ]);
  });

  it("SEM SELECT prévio do status: uma única consulta a `pedidos`, e ela é o UPDATE", async () => {
    await atualizarStatusPedido(PEDIDO, "confirmado");

    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(fromSpy).toHaveBeenCalledWith("pedidos");
    expect(consultasDeLeitura()).toHaveLength(0);
    const selects = banco.consultas.flatMap((c) => c.chamadas.filter(([m]) => m === "select"));
    expect(selects).not.toContainEqual(["select", "status"]);
  });

  it("origens do .in para saiu_entrega = {pendente, confirmado, em_preparo} (atalho + passo normal)", async () => {
    await atualizarStatusPedido(PEDIDO, "saiu_entrega");
    expect(origensDoUpdate()).toEqual(["confirmado", "em_preparo", "pendente"]);
  });

  it("origens do .in para cancelado = {pendente, confirmado, em_preparo} (saiu_entrega não cancela)", async () => {
    await atualizarStatusPedido(PEDIDO, "cancelado");
    expect(origensDoUpdate()).toEqual(["confirmado", "em_preparo", "pendente"]);
  });

  it("origens do .in para entregue = {saiu_entrega}", async () => {
    await atualizarStatusPedido(PEDIDO, "entregue");
    expect(origensDoUpdate()).toEqual(["saiu_entrega"]);
  });

  it("ATALHO pendente → saiu_entrega com 1 linha afetada → { ok:true, status:'saiu_entrega' } e o banco muda", async () => {
    banco.linha = { id: PEDIDO, status: "pendente" };

    const r = await atualizarStatusPedido(PEDIDO, "saiu_entrega");

    expect(r).toEqual({ ok: true, status: "saiu_entrega" });
    expect(statusNoBanco()).toBe("saiu_entrega");
  });

  it("ATALHO confirmado → saiu_entrega com 1 linha afetada → { ok:true }", async () => {
    banco.linha = { id: PEDIDO, status: "confirmado" };

    const r = await atualizarStatusPedido(PEDIDO, "saiu_entrega");

    expect(r).toEqual({ ok: true, status: "saiu_entrega" });
    expect(statusNoBanco()).toBe("saiu_entrega");
  });

  it("destino SEM origem ('pendente') → { ok:false } genérico SEM criar client", async () => {
    const r = await atualizarStatusPedido(PEDIDO, "pendente");

    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(createClient).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("0 linhas afetadas → { ok:false } com a mensagem genérica (nunca ok:true)", async () => {
    // status no banco não é origem de 'entregue' → o predicado não casa.
    banco.linha = { id: PEDIDO, status: "em_preparo" };

    const r = await atualizarStatusPedido(PEDIDO, "entregue");

    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(statusNoBanco()).toBe("em_preparo");
  });

  it("erro de banco na escrita → { ok:false } genérico + log [atualizarStatusPedido], sem vazar error.message", async () => {
    banco.erroEscrita = { message: "connection refused: senha postgres XYZ" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await atualizarStatusPedido(PEDIDO, "confirmado");

    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(JSON.stringify(r)).not.toContain("senha");
    expect(spy).toHaveBeenCalledWith("[atualizarStatusPedido]", expect.anything());
    spy.mockRestore();
  });
});

describe("atualizarStatusPedido — máquina de estados imposta PELO PREDICADO do UPDATE", () => {
  it("transição válida pendente → confirmado → { ok:true, status }", async () => {
    const r = await atualizarStatusPedido(PEDIDO, "confirmado");
    expect(r).toEqual({ ok: true, status: "confirmado" });
    expect(statusNoBanco()).toBe("confirmado");
  });

  it("usa o client AUTENTICADO (createClient), nunca service_role", async () => {
    await atualizarStatusPedido(PEDIDO, "confirmado");
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("salto pendente → entregue → { ok:false } genérico; status intacto", async () => {
    const r = await atualizarStatusPedido(PEDIDO, "entregue");
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(statusNoBanco()).toBe("pendente");
  });

  it("salto pendente → em_preparo → { ok:false }; status intacto", async () => {
    const r = await atualizarStatusPedido(PEDIDO, "em_preparo");
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(statusNoBanco()).toBe("pendente");
  });

  it("terminal entregue → saiu_entrega (atalho NÃO reabre terminal) → { ok:false }; intacto", async () => {
    banco.linha = { id: PEDIDO, status: "entregue" };
    const r = await atualizarStatusPedido(PEDIDO, "saiu_entrega");
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(statusNoBanco()).toBe("entregue");
  });

  it("terminal cancelado → saiu_entrega → { ok:false }; intacto", async () => {
    banco.linha = { id: PEDIDO, status: "cancelado" };
    const r = await atualizarStatusPedido(PEDIDO, "saiu_entrega");
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(statusNoBanco()).toBe("cancelado");
  });

  it("reversão entregue → pendente → { ok:false } SEM tocar no banco (destino sem origem)", async () => {
    banco.linha = { id: PEDIDO, status: "entregue" };
    const r = await atualizarStatusPedido(PEDIDO, "pendente");
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(fromSpy).not.toHaveBeenCalled();
    expect(statusNoBanco()).toBe("entregue");
  });

  it("cancelar a partir de saiu_entrega → { ok:false }; intacto", async () => {
    banco.linha = { id: PEDIDO, status: "saiu_entrega" };
    const r = await atualizarStatusPedido(PEDIDO, "cancelado");
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(statusNoBanco()).toBe("saiu_entrega");
  });

  it("ATAQUE RLS: pedido de OUTRA loja (linha invisível ao auth.uid()) → { ok:false } genérico; intacto", async () => {
    banco.linha = { id: PEDIDO, status: "pendente" };
    banco.visivelParaUsuario = false;

    const r = await atualizarStatusPedido(PEDIDO, "saiu_entrega");

    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(statusNoBanco()).toBe("pendente");
  });

  it("pedido inexistente → { ok:false } genérico (mesma resposta de outra loja)", async () => {
    banco.linha = null;
    const r = await atualizarStatusPedido(PEDIDO, "confirmado");
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
  });
});

describe("atualizarStatusPedido — validação de input antes de qualquer I/O", () => {
  it("novoStatus fora do enum → { ok:false } SEM tocar no banco", async () => {
    const r = await atualizarStatusPedido(PEDIDO, "voando");
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(createClient).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("pedidoId não-UUID → { ok:false } SEM tocar no banco", async () => {
    const r = await atualizarStatusPedido("não-uuid", "confirmado");
    expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
    expect(createClient).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
