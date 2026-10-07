import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});

/**
 * Fase RED (TDD) — Server Actions ADMIN da galeria
 * (`src/app/admin/assinantes/actions/admin-galeria.ts`, `'use server'`):
 * enviarImagemGaleriaAdmin(formData), listarImagensGaleriaAdmin(lojaId, cursor?),
 * consultarUsoImagensAdmin(lojaId, ids), removerImagensGaleriaAdmin(lojaId, ids).
 *
 * RED hoje: `./admin-galeria` não existe — o import falha na coleta.
 *
 * Sob service_role (BYPASSRLS) a defesa NÃO é RLS (spec §Segurança item 4,
 * página 2, RN-G19, `seguranca.md` §7 "Padrão admin"):
 *  - `validarLojaIdAdmin` ANTES de qualquer efeito (lojaId inválido ⇒ nada,
 *    nem `createServiceClient`);
 *  - `prepararContextoAdmin` prova admin ANTES de elevar; se lança, PROPAGA:
 *    nenhum service client, nenhum `remove`, nenhuma RPC;
 *  - a RPC recebe `p_loja_id` = lojaId VALIDADO; antes do `remove`, cada caminho
 *    é conferido contra `${lojaId}/` (sob service_role o caminho é a única amarra
 *    no Storage); DELETE com `.eq("loja_id", lojaId)`;
 *  - `admin_acessos` registra `galeria_remover` com `{ quantidade }`;
 *  - sem rate limit (um operador).
 *
 * `admin-loja.ts` (validarLojaIdAdmin, prepararContextoAdmin, escopo,
 * registrarAcessoAdmin, revalidarLojaAdmin) roda DE VERDADE, como em
 * admin-logo.test.ts.
 */

const LOJA_A = "33333333-3333-3333-3333-333333333333";
const LOJA_B = "44444444-4444-4444-4444-444444444444";
const ADMIN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function guid(n: number): string {
  return `bbbbbbbb-bbbb-bbbb-bbbb-${n.toString().padStart(12, "0")}`;
}

const WEBP_ORIGINAL = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x01, 0x02, 0x03, 0x04,
]);
const WEBP_MINI = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x09,
]);
const PNG_MINI = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]); // PNG válido: a miniatura precisa ser webp (galeria-upload.ts)
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

type Chamada = { metodo: string; args: unknown[] };
type Op = { tabela: string; chamadas: Chamada[] };
type Resposta = { data: unknown; error: unknown; count?: number | null };

let ops: Op[];
let rpcs: { nome: string; args: Record<string, unknown> }[];
let uploads: { bucket: string; caminho: string }[];
let removes: { bucket: string; caminhos: string[] }[];
let respostaRpc: Record<string, Resposta>;
let respostaRemove: Resposta;
let respostaTabela: (op: Op) => Resposta;

function thenavel(resolver: () => Resposta, gravar?: (c: Chamada) => void): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
            Promise.resolve().then(resolver).then(ok, falha);
        }
        return (...args: unknown[]) => {
          gravar?.({ metodo: String(prop), args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function criarServico() {
  return {
    from(tabela: string) {
      const op: Op = { tabela, chamadas: [] };
      ops.push(op);
      return thenavel(
        () => respostaTabela(op),
        (c) => op.chamadas.push(c),
      );
    },
    rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      return thenavel(() => respostaRpc[nome] ?? { data: null, error: null });
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (caminho: string) => {
          uploads.push({ bucket, caminho });
          return { data: { path: "ok" }, error: null };
        },
        remove: async (caminhos: string[]) => {
          removes.push({ bucket, caminhos });
          return respostaRemove;
        },
        getPublicUrl: (caminho: string) => ({
          data: {
            publicUrl: `https://projeto-teste.supabase.co/storage/v1/object/public/${bucket}/${caminho}`,
          },
        }),
      }),
    },
  };
}

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: () => ADMIN_ID,
}));

let servico: ReturnType<typeof criarServico>;
const createServiceClient = vi.fn(() => servico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const listarImagensDaLojaAdmin = vi.fn();
const contarOriginaisDaLoja = vi.fn();
vi.mock("@/lib/supabase/queries/imagens", () => ({
  listarImagensDaLojaAdmin: (...a: unknown[]) => listarImagensDaLojaAdmin(...a),
  contarOriginaisDaLoja: (...a: unknown[]) => contarOriginaisDaLoja(...a),
  listarImagensDaLoja: vi.fn(),
  buscarOriginalDaLoja: vi.fn(),
}));

const verificarRateLimit = vi.fn(async () => ({ permitido: true }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "127.0.0.1",
  verificarRateLimit: (...a: unknown[]) => verificarRateLimit(...(a as [])),
}));

import {
  enviarImagemGaleriaAdmin,
  listarImagensGaleriaAdmin,
  consultarUsoImagensAdmin,
  removerImagensGaleriaAdmin,
} from "./admin-galeria";
import { CAMPO_MINIATURA, MSG_IMAGEM_INVALIDA, MSG_TETO } from "@/lib/actions/galeria-contrato";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";

function blob(bytes: Uint8Array, over: { type?: string; size?: number } = {}): Blob {
  const b = new Blob([bytes as BlobPart], { type: over.type ?? "image/webp" });
  if (over.size !== undefined) Object.defineProperty(b, "size", { value: over.size });
  return b;
}

function fdEnvio(
  opcoes: { lojaId?: string | null; original?: Blob | null; miniatura?: Blob | null } = {},
): FormData {
  const f = new FormData();
  const lojaId = opcoes.lojaId === undefined ? LOJA_A : opcoes.lojaId;
  const original = opcoes.original === undefined ? blob(WEBP_ORIGINAL) : opcoes.original;
  const miniatura = opcoes.miniatura === undefined ? blob(WEBP_MINI) : opcoes.miniatura;
  if (lojaId !== null) f.append("loja_id", lojaId);
  if (original) f.append(CAMPO_ARQUIVO, original);
  if (miniatura) f.append(CAMPO_MINIATURA, miniatura);
  return f;
}

function insertsEm(tabela: string): Record<string, unknown>[] {
  return ops
    .filter((o) => o.tabela === tabela)
    .flatMap((o) => o.chamadas.filter((c) => c.metodo === "insert"))
    .map((c) => c.args[0] as Record<string, unknown>);
}
function deletesEm(tabela: string): Op[] {
  return ops.filter(
    (o) => o.tabela === tabela && o.chamadas.some((c) => c.metodo === "delete"),
  );
}
function caminhosRemovidos(): string[] {
  return removes.flatMap((r) => r.caminhos);
}
function rpcsDe(nome: string) {
  return rpcs.filter((r) => r.nome === nome);
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  ops = [];
  rpcs = [];
  uploads = [];
  removes = [];
  servico = criarServico();
  verificarAdminSaaS.mockResolvedValue(undefined);
  respostaRpc = {
    remover_imagens_loja: {
      data: { caminhos: [], removidas: 0, ignoradas: 0, produtos_limpos: 0, logo_limpa: false },
      error: null,
    },
    limpar_recortes_sem_uso: { data: [], error: null },
    uso_imagens_loja: { data: [], error: null },
  };
  respostaRemove = { data: [], error: null };
  respostaTabela = (op) => {
    const insert = op.chamadas.find((c) => c.metodo === "insert");
    if (insert) {
      return {
        data: { ...(insert.args[0] as object), criado_em: "2026-10-06T12:00:00.000Z" },
        error: null,
      };
    }
    return { data: null, error: null, count: 1 };
  };
  contarOriginaisDaLoja.mockResolvedValue(10);
  listarImagensDaLojaAdmin.mockResolvedValue({ imagens: [], proximo_cursor: null });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("removerImagensGaleriaAdmin — Segurança item 4", () => {
  const IDS_DE_B = [guid(1), guid(2), guid(3), guid(4)];

  it("verificarAdminSaaS falha → PROPAGA; nenhum createServiceClient, nenhuma RPC, nenhum remove", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(removerImagensGaleriaAdmin(LOJA_A, IDS_DE_B)).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(rpcs).toHaveLength(0);
    expect(removes).toHaveLength(0);
  });

  it.each([["nao-e-uuid"], [""], [`${LOJA_A}/..`]])(
    "lojaId inválido (%s) → { ok:false }, sem service client, sem RPC, sem remove",
    async (lojaId) => {
      const r = await removerImagensGaleriaAdmin(lojaId, IDS_DE_B);
      expect(r.ok).toBe(false);
      expect(createServiceClient).not.toHaveBeenCalled();
      expect(rpcs).toHaveLength(0);
      expect(removes).toHaveLength(0);
    },
  );

  it.each([
    ["0 ids", []],
    ["51 ids", Array.from({ length: 51 }, (_, i) => guid(i + 1))],
    ["duplicata", [guid(1), guid(1)]],
    ["não-uuid", ["x"]],
  ])("ids inválidos (%s) → { ok:false }, sem RPC, sem remove", async (_r, ids) => {
    const r = await removerImagensGaleriaAdmin(LOJA_A, ids as string[]);
    expect(r.ok).toBe(false);
    expect(rpcs).toHaveLength(0);
    expect(removes).toHaveLength(0);
  });

  it("lojaId de A com ids de B: RPC com p_loja_id = A e só caminhos com prefixo A chegam ao remove", async () => {
    // A RPC (mockada) devolve, por hipótese de bug, um caminho de B no meio.
    respostaRpc.remover_imagens_loja = {
      data: {
        caminhos: [
          `${LOJA_A}/galeria/${guid(9)}.webp`,
          `${LOJA_B}/galeria/${guid(1)}.webp`,
          `${LOJA_A}/../${LOJA_B}/${guid(2)}.webp`,
        ],
        removidas: 1,
        ignoradas: 3,
        produtos_limpos: 0,
        logo_limpa: false,
      },
      error: null,
    };
    respostaRpc.limpar_recortes_sem_uso = { data: [`${LOJA_B}/${guid(5)}.webp`], error: null };

    const r = await removerImagensGaleriaAdmin(LOJA_A, IDS_DE_B);

    expect(rpcsDe("remover_imagens_loja")).toEqual([
      { nome: "remover_imagens_loja", args: { p_loja_id: LOJA_A, p_ids: IDS_DE_B } },
    ]);
    expect(caminhosRemovidos()).toEqual([`${LOJA_A}/galeria/${guid(9)}.webp`]);
    expect(JSON.stringify(removes)).not.toContain(LOJA_B);
    expect(errorSpy).toHaveBeenCalled();
    expect(r).toEqual({ ok: true, removidas: 1, ignoradas: 3, produtosLimpos: 0, logoLimpa: false });
  });

  it("DELETE das linhas com .eq('loja_id', lojaId) e varredura com p_loja_id = lojaId", async () => {
    respostaRpc.remover_imagens_loja = {
      data: {
        caminhos: [`${LOJA_A}/galeria/${guid(9)}.webp`],
        removidas: 1,
        ignoradas: 0,
        produtos_limpos: 2,
        logo_limpa: true,
      },
      error: null,
    };

    await removerImagensGaleriaAdmin(LOJA_A, [guid(9)]);

    const dels = deletesEm("imagens_loja");
    expect(dels.length).toBeGreaterThanOrEqual(1);
    for (const d of dels) {
      expect(
        d.chamadas.some((c) => c.metodo === "eq" && c.args[0] === "loja_id" && c.args[1] === LOJA_A),
      ).toBe(true);
    }
    expect(rpcsDe("limpar_recortes_sem_uso")).toEqual([
      { nome: "limpar_recortes_sem_uso", args: { p_loja_id: LOJA_A } },
    ]);
  });

  it("registra admin_acessos: acao galeria_remover, loja A, metadados { quantidade: removidas }", async () => {
    respostaRpc.remover_imagens_loja = {
      data: {
        caminhos: [`${LOJA_A}/galeria/${guid(9)}.webp`],
        removidas: 3,
        ignoradas: 1,
        produtos_limpos: 0,
        logo_limpa: false,
      },
      error: null,
    };

    await removerImagensGaleriaAdmin(LOJA_A, IDS_DE_B);

    const logs = insertsEm("admin_acessos");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      admin_user_id: ADMIN_ID,
      loja_id: LOJA_A,
      acao: "galeria_remover",
      metadados: { quantidade: 3 },
    });
  });

  it("falha do Storage → ok com os números, SEM DELETE (pendentes), console.error", async () => {
    respostaRpc.remover_imagens_loja = {
      data: {
        caminhos: [`${LOJA_A}/galeria/${guid(9)}.webp`],
        removidas: 1,
        ignoradas: 0,
        produtos_limpos: 0,
        logo_limpa: false,
      },
      error: null,
    };
    respostaRpc.limpar_recortes_sem_uso = { data: [`${LOJA_A}/galeria/${guid(9)}.webp`], error: null };
    respostaRemove = { data: null, error: { message: "storage fora do ar" } };

    const r = await removerImagensGaleriaAdmin(LOJA_A, [guid(9)]);

    expect(r).toEqual({ ok: true, removidas: 1, ignoradas: 0, produtosLimpos: 0, logoLimpa: false });
    expect(deletesEm("imagens_loja")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("erro da RPC → genérica sem vazar, ZERO Storage", async () => {
    respostaRpc.remover_imagens_loja = {
      data: null,
      error: { message: "remover_imagens_loja: lote inválido", code: "22023" },
    };
    const r = await removerImagensGaleriaAdmin(LOJA_A, [guid(9)]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/remover_imagens_loja|22023/);
    expect(removes).toHaveLength(0);
  });

  it("revalida a loja-alvo e a galeria admin", async () => {
    await removerImagensGaleriaAdmin(LOJA_A, [guid(9)]);
    const rotas = revalidatePath.mock.calls.map((c) => c[0]);
    expect(rotas).toContain(`/admin/assinantes/${LOJA_A}`);
    expect(rotas).toContain(`/admin/assinantes/${LOJA_A}/galeria`);
  });

  it("sem rate limit no admin", async () => {
    await removerImagensGaleriaAdmin(LOJA_A, [guid(9)]);
    expect(verificarRateLimit).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("enviarImagemGaleriaAdmin — loja_id no FormData", () => {
  it("feliz: original + miniatura em `${lojaId}/galeria/…` via service client; linha com loja_id da loja-alvo", async () => {
    const r = await enviarImagemGaleriaAdmin(fdEnvio());

    expect(r.ok).toBe(true);
    expect(uploads).toHaveLength(2);
    const original = uploads.find((u) => !u.caminho.includes("/mini/"));
    const mini = uploads.find((u) => u.caminho.includes("/mini/"));
    expect(original?.caminho).toMatch(new RegExp(`^${LOJA_A}/galeria/${UUID_RE}\\.webp$`));
    expect(mini?.caminho).toMatch(new RegExp(`^${LOJA_A}/galeria/mini/${UUID_RE}\\.webp$`));

    const linhas = insertsEm("imagens_loja");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      loja_id: LOJA_A,
      caminho: original?.caminho,
      miniatura_caminho: mini?.caminho,
      bytes: WEBP_ORIGINAL.byteLength,
    });
  });

  it("registra admin_acessos da loja-alvo com ação da galeria", async () => {
    await enviarImagemGaleriaAdmin(fdEnvio());
    const logs = insertsEm("admin_acessos");
    expect(logs).toHaveLength(1);
    expect(logs[0]?.loja_id).toBe(LOJA_A);
    expect(String(logs[0]?.acao)).toMatch(/^galeria_/);
  });

  it.each([
    ["não-UUID", "nao-e-uuid"],
    ["ausente", null],
  ])("loja_id %s → { ok:false }, ZERO upload, sem service client", async (_r, lojaId) => {
    const r = await enviarImagemGaleriaAdmin(fdEnvio({ lojaId }));
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("miniatura PNG válida (não webp) → MSG_IMAGEM_INVALIDA, ZERO upload", async () => {
    const r = await enviarImagemGaleriaAdmin(fdEnvio({ miniatura: blob(PNG_MINI, { type: "image/png" }) }));
    expect(r).toEqual({ ok: false, erro: MSG_IMAGEM_INVALIDA });
    expect(uploads).toHaveLength(0);
  });

  it("não-admin → PROPAGA, ZERO upload, sem service client", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(enviarImagemGaleriaAdmin(fdEnvio())).rejects.toThrow("Acesso negado.");
    expect(uploads).toHaveLength(0);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("teto (200) vale também no admin → MSG_TETO, ZERO upload; contagem na loja-alvo", async () => {
    contarOriginaisDaLoja.mockResolvedValue(200);
    const r = await enviarImagemGaleriaAdmin(fdEnvio());
    expect(r).toEqual({ ok: false, erro: MSG_TETO });
    expect(uploads).toHaveLength(0);
    expect(contarOriginaisDaLoja.mock.calls[0]?.[0]).toBe(servico);
    expect(contarOriginaisDaLoja.mock.calls[0]?.[1]).toBe(LOJA_A);
  });

  it("miniatura ausente → recusa, ZERO upload", async () => {
    const r = await enviarImagemGaleriaAdmin(fdEnvio({ miniatura: null }));
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it("ATAQUE: miniatura GIF disfarçada → recusa, ZERO upload", async () => {
    const r = await enviarImagemGaleriaAdmin(fdEnvio({ miniatura: blob(GIF, { type: "image/webp" }) }));
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it("INSERT falha → compensação remove os dois objetos; erro genérico", async () => {
    respostaTabela = (op) =>
      op.tabela === "imagens_loja" && op.chamadas.some((c) => c.metodo === "insert")
        ? { data: null, error: { message: "violates check imagens_loja_caminho_da_loja", code: "23514" } }
        : { data: null, error: null };

    const r = await enviarImagemGaleriaAdmin(fdEnvio());

    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/imagens_loja|23514/);
    expect([...caminhosRemovidos()].sort()).toEqual(uploads.map((u) => u.caminho).sort());
    expect(caminhosRemovidos()).toHaveLength(2);
  });

  it("sem rate limit no admin", async () => {
    await enviarImagemGaleriaAdmin(fdEnvio());
    expect(verificarRateLimit).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("listarImagensGaleriaAdmin / consultarUsoImagensAdmin — escopo por lojaId", () => {
  it("listar: query admin com (svc, lojaId, cursor)", async () => {
    const cursor = { criado_em: "2026-10-06T12:00:00.000Z", id: guid(1) };
    const r = await listarImagensGaleriaAdmin(LOJA_A, cursor);
    expect(r.ok).toBe(true);
    expect(listarImagensDaLojaAdmin.mock.calls[0]?.[0]).toBe(servico);
    expect(listarImagensDaLojaAdmin.mock.calls[0]?.[1]).toBe(LOJA_A);
    expect(listarImagensDaLojaAdmin.mock.calls[0]?.[2]).toEqual(cursor);
  });

  it("listar: lojaId inválido → nada, sem service client", async () => {
    const r = await listarImagensGaleriaAdmin("x");
    expect(r.ok).toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(listarImagensDaLojaAdmin).not.toHaveBeenCalled();
  });

  it("listar: não-admin → PROPAGA, sem service client", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(listarImagensGaleriaAdmin(LOJA_A)).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("listar: cursor inválido → recusa sem consultar", async () => {
    const r = await listarImagensGaleriaAdmin(LOJA_A, { criado_em: "x", id: "y" } as never);
    expect(r.ok).toBe(false);
    expect(listarImagensDaLojaAdmin).not.toHaveBeenCalled();
  });

  it("uso: RPC uso_imagens_loja pela via de serviço com p_loja_id = lojaId validado", async () => {
    const ids = [guid(1), guid(2)];
    const r = await consultarUsoImagensAdmin(LOJA_A, ids);
    expect(r.ok).toBe(true);
    expect(rpcsDe("uso_imagens_loja")).toEqual([
      { nome: "uso_imagens_loja", args: { p_loja_id: LOJA_A, p_ids: ids } },
    ]);
  });

  it("uso: lojaId inválido → nada; ids inválidos → sem RPC", async () => {
    const r1 = await consultarUsoImagensAdmin("x", [guid(1)]);
    expect(r1.ok).toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
    const r2 = await consultarUsoImagensAdmin(LOJA_A, [guid(1), guid(1)]);
    expect(r2.ok).toBe(false);
    expect(rpcs).toHaveLength(0);
  });

  it("uso: não-admin → PROPAGA, sem service client", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(consultarUsoImagensAdmin(LOJA_A, [guid(1)])).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
