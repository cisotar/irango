import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// =============================================================================
// Issue 349 — agendador das funções de retenção (LGPD).
//
// Teste de UNIDADE do Route Handler GET /api/cron/retencao, com o service client
// MOCKADO. Prova as invariantes:
//   - fail-closed: sem header, header errado, sem prefixo `Bearer` ou
//     CRON_SECRET ausente → 401 e ZERO chamada de rotina;
//   - as duas rotinas são INDEPENDENTES: falha numa não impede a outra;
//   - falha de qualquer rotina → 500 (o cron da Vercel precisa ver o erro);
//   - a resposta e o log só carregam contagem — nunca PII.
//
// pg_cron ficou fora (ver cabeçalho de route.ts): a extension não existe no
// pglite e o projeto veda `create extension` em migration, o que deixaria o
// agendamento sem cobertura. Aqui a trava é testável de verdade.
// =============================================================================

const SEGREDO = "segredo-de-cron-para-teste";

const rpc = vi.fn();
const createServiceClient = vi.fn(() => ({ rpc }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

import { GET } from "./route";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.irango.local/api/cron/retencao", {
    method: "GET",
    headers,
  });
}

const autorizado = () => req({ authorization: `Bearer ${SEGREDO}` });

/** Por padrão as duas rotinas respondem com uma contagem distinta. */
function rpcOk(): void {
  rpc.mockImplementation((rotina: string) =>
    Promise.resolve({
      data: rotina === "anonimizar_clientes_inativos" ? 3 : 7,
      error: null,
    }),
  );
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // `clearAllMocks` zera CHAMADAS, não implementações: sem re-armar as duas
  // abaixo, o mock que lança de [2d] vaza para os testes seguintes.
  vi.clearAllMocks();
  process.env.CRON_SECRET = SEGREDO;
  createServiceClient.mockImplementation(() => ({ rpc }));
  rpcOk();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe("349 [1] autorização — fail-closed", () => {
  it("[1a] sem header Authorization → 401 e ZERO rotina executada", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[1b] segredo errado → 401 e ZERO rotina", async () => {
    const res = await GET(req({ authorization: "Bearer segredo-errado" }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("[1c] segredo certo SEM o prefixo 'Bearer' → 401", async () => {
    const res = await GET(req({ authorization: SEGREDO }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("[1d] CRON_SECRET ausente → 401 mesmo com header plausível (nunca autoriza às cegas)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ authorization: "Bearer qualquer-coisa" }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("[1e] CRON_SECRET vazio → 401", async () => {
    process.env.CRON_SECRET = "";
    const res = await GET(autorizado());
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("[1f] header só com o prefixo, sem segredo → 401", async () => {
    const res = await GET(req({ authorization: "Bearer " }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("349 [2] execução das duas rotinas", () => {
  it("[2a] autorizado → chama as DUAS rotinas e devolve as contagens em 200", async () => {
    const res = await GET(autorizado());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ anonimizados: 3, expurgados: 7 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("anonimizar_clientes_inativos");
    expect(rpc).toHaveBeenCalledWith("expurgar_pedidos_antigos");
  });

  it("[2b] falha na anonimização NÃO impede o expurgo; status 500", async () => {
    rpc.mockImplementation((rotina: string) =>
      rotina === "anonimizar_clientes_inativos"
        ? Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } })
        : Promise.resolve({ data: 7, error: null }),
    );

    const res = await GET(autorizado());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ anonimizados: null, expurgados: 7 });
    // a prova de independência: o expurgo rodou mesmo com a anonimização falhando
    expect(rpc).toHaveBeenCalledWith("expurgar_pedidos_antigos");
  });

  it("[2c] falha no expurgo → 500, anonimização preservada na resposta", async () => {
    rpc.mockImplementation((rotina: string) =>
      rotina === "expurgar_pedidos_antigos"
        ? Promise.resolve({ data: null, error: { code: "XX000", message: "deadlock" } })
        : Promise.resolve({ data: 3, error: null }),
    );

    const res = await GET(autorizado());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ anonimizados: 3, expurgados: null });
  });

  it("[2d] service client indisponível (env ausente) → 500 sem executar rotina", async () => {
    createServiceClient.mockImplementation(() => {
      throw new Error("createServiceClient: SUPABASE_SERVICE_ROLE_KEY ausente.");
    });

    const res = await GET(autorizado());

    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("349 [3] sem PII no log nem na resposta", () => {
  it("[3a] log de sucesso carrega só as contagens", async () => {
    await GET(autorizado());

    expect(logSpy).toHaveBeenCalledWith("[cron-retencao]", { anonimizados: 3, expurgados: 7 });
  });

  it("[3b] log de falha carrega só code e message — nunca details/hint do Postgres", async () => {
    // `details`/`hint` ecoam valor de linha; estas rotinas varrem nome, telefone
    // e endereço, então o log não pode repassá-los.
    rpc.mockImplementation((rotina: string) =>
      rotina === "anonimizar_clientes_inativos"
        ? Promise.resolve({
            data: null,
            error: {
              code: "23505",
              message: "duplicate key",
              details: "Key (telefone)=((11) 99999-0000) already exists.",
              hint: "cliente joao@exemplo.local",
            },
          })
        : Promise.resolve({ data: 7, error: null }),
    );

    await GET(autorizado());

    const registrados = errSpy.mock.calls.flat().map((a: unknown) => JSON.stringify(a));
    expect(registrados.join(" ")).not.toContain("99999-0000");
    expect(registrados.join(" ")).not.toContain("joao@exemplo.local");
    expect(errSpy).toHaveBeenCalledWith("[cron-retencao] anonimizar_clientes_inativos falhou", {
      code: "23505",
      message: "duplicate key",
    });
  });

  it("[3c] corpo da resposta não tem chave além das contagens", async () => {
    const res = await GET(autorizado());
    expect(Object.keys(await res.json()).sort()).toEqual(["anonimizados", "expurgados"]);
  });
});
