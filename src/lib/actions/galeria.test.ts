import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});

/**
 * Fase RED (TDD) — Server Actions da galeria do LOJISTA (`src/lib/actions/galeria.ts`,
 * `'use server'`): enviarImagemGaleria, listarImagensGaleria, consultarUsoImagens,
 * removerImagensGaleria.
 *
 * RED hoje: `./galeria` e `./galeria-contrato` não existem — o import falha na
 * coleta. A fase GREEN cria os módulos.
 *
 * Invariantes provadas (spec §Segurança item 5, §"Ordem das operações na
 * remoção" passos 9–13, RN-G4/G9/G10/G12/G13/G16/G21):
 *  - client AUTENTICADO, loja de `buscarLojaDoDono`; service_role nunca;
 *  - a RPC de remoção recebe `p_loja_id` da SESSÃO — `loja_id` no payload é ignorado;
 *  - `storage.remove` recebe SÓ caminhos devolvidos pela RPC e com prefixo da
 *    loja da sessão; caminho alheio é logado e não removido;
 *  - falha do Storage ⇒ sucesso com os números da RPC, linhas ficam pendentes
 *    (nenhum DELETE); erro da RPC ⇒ mensagem genérica;
 *  - envio: `validarBlobImagem` na original E na miniatura, teto contado no
 *    servidor ANTES do upload, rate limit por `loja.id`, caminhos montados no
 *    servidor, `bytes` medido do buffer, compensação se o INSERT falha.
 */

const LOJA = "11111111-1111-1111-1111-111111111111";
const OUTRA = "22222222-2222-2222-2222-222222222222";
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function guid(n: number): string {
  return `aaaaaaaa-aaaa-aaaa-aaaa-${n.toString().padStart(12, "0")}`;
}

// ── Magic bytes reais ────────────────────────────────────────────────────────
const WEBP_ORIGINAL = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x01, 0x02, 0x03, 0x04,
]); // 16 bytes
const WEBP_MINI = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x09,
]); // 20 bytes
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

// ── Client autenticado gravador ──────────────────────────────────────────────
type Chamada = { metodo: string; args: unknown[] };
type Op = { tabela: string; chamadas: Chamada[] };
type Resposta = { data: unknown; error: unknown; count?: number | null };

let ops: Op[];
let rpcs: { nome: string; args: Record<string, unknown> }[];
let uploads: { bucket: string; caminho: string; bytes: number; opts?: Record<string, unknown> }[];
let removes: { bucket: string; caminhos: string[] }[];
let respostaRpc: Record<string, Resposta>;
let respostaUpload: (caminho: string) => Resposta;
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

function criarClient() {
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
        upload: async (caminho: string, corpo: unknown, opts?: Record<string, unknown>) => {
          const bytes =
            corpo instanceof Uint8Array
              ? corpo.byteLength
              : corpo instanceof ArrayBuffer
                ? corpo.byteLength
                : -1;
          uploads.push({ bucket, caminho, bytes, opts });
          return respostaUpload(caminho);
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

let authClient: ReturnType<typeof criarClient>;
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const createServiceClient = vi.fn(() => ({ __role: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

const listarImagensDaLoja = vi.fn();
const contarOriginaisDaLoja = vi.fn();
const buscarOriginalDaLoja = vi.fn();
vi.mock("@/lib/supabase/queries/imagens", () => ({
  listarImagensDaLoja: (...a: unknown[]) => listarImagensDaLoja(...a),
  contarOriginaisDaLoja: (...a: unknown[]) => contarOriginaisDaLoja(...a),
  buscarOriginalDaLoja: (...a: unknown[]) => buscarOriginalDaLoja(...a),
  listarImagensDaLojaAdmin: vi.fn(),
}));

const verificarRateLimit = vi.fn();
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "127.0.0.1",
  verificarRateLimit: (...a: unknown[]) => verificarRateLimit(...a),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-real-ip": "127.0.0.1" })),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

import {
  enviarImagemGaleria,
  listarImagensGaleria,
  consultarUsoImagens,
  removerImagensGaleria,
} from "./galeria";
import { CAMPO_MINIATURA, MSG_TETO } from "./galeria-contrato";
import { CAMPO_ARQUIVO } from "./upload-contrato";

function lojaDoDono(): Partial<Tables<"lojas">> {
  return { id: LOJA, dono_id: "dono-1", slug: "minha-loja", ativo: true };
}

function blob(bytes: Uint8Array, over: { type?: string; size?: number } = {}): Blob {
  const b = new Blob([bytes as BlobPart], { type: over.type ?? "image/webp" });
  if (over.size !== undefined) Object.defineProperty(b, "size", { value: over.size });
  return b;
}

function fdEnvio(
  opcoes: { original?: Blob | null; miniatura?: Blob | null; extras?: Record<string, string> } = {},
): FormData {
  const f = new FormData();
  const original = opcoes.original === undefined ? blob(WEBP_ORIGINAL) : opcoes.original;
  const miniatura = opcoes.miniatura === undefined ? blob(WEBP_MINI) : opcoes.miniatura;
  if (original) f.append(CAMPO_ARQUIVO, original);
  if (miniatura) f.append(CAMPO_MINIATURA, miniatura);
  for (const [k, v] of Object.entries(opcoes.extras ?? {})) f.append(k, v);
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
  authClient = criarClient();
  respostaRpc = {
    remover_imagens_loja: {
      data: { caminhos: [], removidas: 0, ignoradas: 0, produtos_limpos: 0, logo_limpa: false },
      error: null,
    },
    limpar_recortes_sem_uso: { data: [], error: null },
    uso_imagens_loja: { data: [], error: null },
  };
  respostaUpload = () => ({ data: { path: "ok" }, error: null });
  respostaRemove = { data: [], error: null };
  respostaTabela = (op) => {
    const insert = op.chamadas.find((c) => c.metodo === "insert");
    if (insert) {
      return {
        data: { ...(insert.args[0] as object), criado_em: "2026-10-06T12:00:00.000Z" },
        error: null,
      };
    }
    return { data: null, error: null };
  };
  buscarLojaDoDono.mockResolvedValue(lojaDoDono());
  contarOriginaisDaLoja.mockResolvedValue(37);
  listarImagensDaLoja.mockResolvedValue({ imagens: [], proximo_cursor: null });
  verificarRateLimit.mockResolvedValue({ permitido: true });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("enviarImagemGaleria — original + miniatura", () => {
  it("feliz: sobe original e miniatura nos caminhos do servidor e registra a linha com bytes medidos", async () => {
    const r = await enviarImagemGaleria(fdEnvio());

    expect(r.ok).toBe(true);
    expect(uploads).toHaveLength(2);
    expect(uploads.every((u) => u.bucket === "produtos")).toBe(true);

    const original = uploads.find((u) => !u.caminho.includes("/mini/"));
    const mini = uploads.find((u) => u.caminho.includes("/mini/"));
    expect(original?.caminho).toMatch(new RegExp(`^${LOJA}/galeria/(${UUID_RE})\\.webp$`));
    const id = original?.caminho.match(new RegExp(`^${LOJA}/galeria/(${UUID_RE})\\.webp$`))?.[1];
    expect(id).toBeDefined();
    expect(mini?.caminho).toBe(`${LOJA}/galeria/mini/${id}.webp`);
    expect(mini?.opts?.contentType).toBe("image/webp");

    const linhas = insertsEm("imagens_loja");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      loja_id: LOJA,
      caminho: original?.caminho,
      miniatura_caminho: mini?.caminho,
      bytes: WEBP_ORIGINAL.byteLength,
    });
    expect(linhas[0].origem_id ?? null).toBeNull();
    if (r.ok) expect(r.imagem.id).toBe(id);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("bytes vem do buffer recebido, não do size declarado pelo cliente", async () => {
    await enviarImagemGaleria(fdEnvio({ original: blob(WEBP_ORIGINAL, { size: 1_000_000 }) }));
    expect(insertsEm("imagens_loja")[0]?.bytes).toBe(WEBP_ORIGINAL.byteLength);
  });

  it("ATAQUE: loja_id no FormData é ignorado — tudo vai para a pasta da loja da sessão", async () => {
    await enviarImagemGaleria(fdEnvio({ extras: { loja_id: OUTRA } }));
    expect(uploads.length).toBeGreaterThan(0);
    for (const u of uploads) expect(u.caminho.startsWith(`${LOJA}/galeria/`)).toBe(true);
    expect(JSON.stringify(insertsEm("imagens_loja"))).not.toContain(OUTRA);
  });

  it("sem miniatura → recusa, ZERO upload, ZERO insert", async () => {
    const r = await enviarImagemGaleria(fdEnvio({ miniatura: null }));
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
    expect(insertsEm("imagens_loja")).toHaveLength(0);
  });

  it("ATAQUE: miniatura GIF disfarçada de webp → recusa (validarBlobImagem na miniatura), ZERO upload", async () => {
    const r = await enviarImagemGaleria(fdEnvio({ miniatura: blob(GIF, { type: "image/webp" }) }));
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it("miniatura acima de 2 MB → recusa, ZERO upload", async () => {
    const r = await enviarImagemGaleria(
      fdEnvio({ miniatura: blob(WEBP_MINI, { size: 2 * 1024 * 1024 + 1 }) }),
    );
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it("ATAQUE: original GIF disfarçada → recusa, ZERO upload", async () => {
    const r = await enviarImagemGaleria(fdEnvio({ original: blob(GIF, { type: "image/png" }) }));
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it("sem original → recusa, ZERO upload", async () => {
    const r = await enviarImagemGaleria(fdEnvio({ original: null }));
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it("teto atingido (200) → MSG_TETO literal, ZERO upload; contagem na loja da sessão", async () => {
    contarOriginaisDaLoja.mockResolvedValue(200);
    const r = await enviarImagemGaleria(fdEnvio());
    expect(r).toEqual({ ok: false, erro: MSG_TETO });
    expect(uploads).toHaveLength(0);
    expect(insertsEm("imagens_loja")).toHaveLength(0);
    expect(contarOriginaisDaLoja.mock.calls[0]?.[0]).toBe(authClient);
    expect(contarOriginaisDaLoja.mock.calls[0]?.[1]).toBe(LOJA);
  });

  it("199 originais → ainda aceita", async () => {
    contarOriginaisDaLoja.mockResolvedValue(199);
    const r = await enviarImagemGaleria(fdEnvio());
    expect(r.ok).toBe(true);
  });

  it("contagem falha → recusa genérica, ZERO upload (o teto não fura num erro)", async () => {
    contarOriginaisDaLoja.mockRejectedValue(new Error("falha secreta do banco"));
    const r = await enviarImagemGaleria(fdEnvio());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secreta");
    expect(uploads).toHaveLength(0);
  });

  it("rate limit por loja.id com a chave enviarImagemGaleria; estourado → recusa sem upload", async () => {
    verificarRateLimit.mockResolvedValue({ permitido: false });
    const r = await enviarImagemGaleria(fdEnvio());
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
    expect(verificarRateLimit).toHaveBeenCalledWith("enviarImagemGaleria", LOJA);
  });

  it("sem loja → não autorizado, ZERO upload", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await enviarImagemGaleria(fdEnvio());
    expect(r.ok).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it("INSERT falha → compensação: remove os DOIS objetos subidos; erro genérico sem vazar o banco", async () => {
    respostaTabela = (op) =>
      op.chamadas.some((c) => c.metodo === "insert")
        ? { data: null, error: { message: "violates check imagens_loja_caminho_da_loja", code: "23514" } }
        : { data: null, error: null };

    const r = await enviarImagemGaleria(fdEnvio());

    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/imagens_loja|23514|violates/);
    expect([...caminhosRemovidos()].sort()).toEqual(uploads.map((u) => u.caminho).sort());
    expect(caminhosRemovidos()).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("um dos uploads falha → nada é registrado e o que subiu é removido", async () => {
    respostaUpload = (caminho) =>
      caminho.includes("/mini/")
        ? { data: null, error: { message: "bucket secreto" } }
        : { data: { path: "ok" }, error: null };

    const r = await enviarImagemGaleria(fdEnvio());

    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(insertsEm("imagens_loja")).toHaveLength(0);
    const subiram = uploads.filter((u) => !u.caminho.includes("/mini/")).map((u) => u.caminho);
    for (const c of subiram) expect(caminhosRemovidos()).toContain(c);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("listarImagensGaleria — keyset, loja da sessão", () => {
  it("primeira página: consulta a loja da sessão com o client autenticado", async () => {
    const r = await listarImagensGaleria();
    expect(r.ok).toBe(true);
    expect(listarImagensDaLoja).toHaveBeenCalledTimes(1);
    expect(listarImagensDaLoja.mock.calls[0]?.[0]).toBe(authClient);
    expect(listarImagensDaLoja.mock.calls[0]?.[1]).toBe(LOJA);
    expect(listarImagensDaLoja.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("cursor válido é repassado; ele só posiciona a página", async () => {
    const cursor = { criado_em: "2026-10-06T12:00:00.000Z", id: guid(1) };
    await listarImagensGaleria(cursor);
    expect(listarImagensDaLoja.mock.calls[0]?.[1]).toBe(LOJA);
    expect(listarImagensDaLoja.mock.calls[0]?.[2]).toEqual(cursor);
  });

  it("cursor inválido → recusa sem consultar", async () => {
    const r = await listarImagensGaleria({ criado_em: "ontem", id: "x" } as never);
    expect(r.ok).toBe(false);
    expect(listarImagensDaLoja).not.toHaveBeenCalled();
  });

  it("rate limit por loja.id com a chave listarImagensGaleria; estourado → recusa sem consultar", async () => {
    verificarRateLimit.mockResolvedValue({ permitido: false });
    const r = await listarImagensGaleria();
    expect(r.ok).toBe(false);
    expect(listarImagensDaLoja).not.toHaveBeenCalled();
    expect(verificarRateLimit).toHaveBeenCalledWith("listarImagensGaleria", LOJA);
  });

  it("erro da query → mensagem genérica, sem vazar", async () => {
    listarImagensDaLoja.mockRejectedValue(new Error("relation secreta"));
    const r = await listarImagensGaleria();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secreta");
  });

  it("sem loja → recusa sem consultar", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await listarImagensGaleria();
    expect(r.ok).toBe(false);
    expect(listarImagensDaLoja).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("consultarUsoImagens — prévia do uso (não é a conta que vale)", () => {
  it("chama uso_imagens_loja com p_loja_id da sessão e devolve as linhas", async () => {
    const ids = [guid(1), guid(2)];
    const usos = [
      { imagem_id: guid(1), produtos_total: 2, produtos: [{ id: guid(9), nome: "X", oculto: false }], na_logo: true },
    ];
    respostaRpc.uso_imagens_loja = { data: usos, error: null };

    const r = await consultarUsoImagens(ids);

    expect(rpcsDe("uso_imagens_loja")).toEqual([
      { nome: "uso_imagens_loja", args: { p_loja_id: LOJA, p_ids: ids } },
    ]);
    expect(r).toEqual({ ok: true, usos });
  });

  it.each([
    ["vazio", []],
    ["51 ids", Array.from({ length: 51 }, (_, i) => guid(i + 1))],
    ["duplicata", [guid(1), guid(1)]],
    ["não-uuid", ["x"]],
  ])("ids inválidos (%s) → recusa sem RPC", async (_r, ids) => {
    const r = await consultarUsoImagens(ids as string[]);
    expect(r.ok).toBe(false);
    expect(rpcs).toHaveLength(0);
  });

  it("erro da RPC → genérica sem vazar", async () => {
    respostaRpc.uso_imagens_loja = {
      data: null,
      error: { message: "uso_imagens_loja: sem posse da loja", code: "42501" },
    };
    const r = await consultarUsoImagens([guid(1)]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/posse|42501|uso_imagens_loja/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("removerImagensGaleria — Segurança item 5 (escopo do Storage)", () => {
  const IDS = [guid(1), guid(2)];

  function rpcRemocao(caminhos: string[], extra: Partial<Record<string, unknown>> = {}) {
    respostaRpc.remover_imagens_loja = {
      data: {
        caminhos,
        removidas: 2,
        ignoradas: 0,
        produtos_limpos: 3,
        logo_limpa: true,
        ...extra,
      },
      error: null,
    };
  }

  it("feliz: RPC com p_loja_id da sessão → remove só os caminhos da RPC → DELETE escopado → números da RPC", async () => {
    const caminhos = [
      `${LOJA}/galeria/${guid(1)}.webp`,
      `${LOJA}/galeria/mini/${guid(1)}.webp`,
      `${LOJA}/${guid(7)}.webp`,
    ];
    rpcRemocao(caminhos);

    const r = await removerImagensGaleria(IDS);

    expect(rpcsDe("remover_imagens_loja")).toEqual([
      { nome: "remover_imagens_loja", args: { p_loja_id: LOJA, p_ids: IDS } },
    ]);
    expect(removes.every((x) => x.bucket === "produtos")).toBe(true);
    expect([...caminhosRemovidos()].sort()).toEqual([...caminhos].sort());

    const dels = deletesEm("imagens_loja");
    expect(dels.length).toBeGreaterThanOrEqual(1);
    for (const d of dels) {
      expect(
        d.chamadas.some((c) => c.metodo === "eq" && c.args[0] === "loja_id" && c.args[1] === LOJA),
      ).toBe(true);
    }

    expect(r).toEqual({ ok: true, removidas: 2, ignoradas: 0, produtosLimpos: 3, logoLimpa: true });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("roda a varredura limpar_recortes_sem_uso na mesma chamada, com p_loja_id da sessão (RN-G21)", async () => {
    rpcRemocao([`${LOJA}/galeria/${guid(1)}.webp`]);
    respostaRpc.limpar_recortes_sem_uso = { data: [`${LOJA}/${guid(8)}.webp`], error: null };

    await removerImagensGaleria(IDS);

    expect(rpcsDe("limpar_recortes_sem_uso")).toEqual([
      { nome: "limpar_recortes_sem_uso", args: { p_loja_id: LOJA } },
    ]);
    expect(caminhosRemovidos()).toContain(`${LOJA}/${guid(8)}.webp`);
  });

  it("ATAQUE: loja_id extra no payload é ignorado — a RPC recebe o da sessão", async () => {
    rpcRemocao([]);
    await (removerImagensGaleria as unknown as (...a: unknown[]) => Promise<unknown>)(IDS, OUTRA);
    await (removerImagensGaleria as unknown as (...a: unknown[]) => Promise<unknown>)(IDS, {
      loja_id: OUTRA,
    });
    const chamadas = rpcsDe("remover_imagens_loja");
    expect(chamadas).toHaveLength(2);
    for (const c of chamadas) expect(c.args).toEqual({ p_loja_id: LOJA, p_ids: IDS });
  });

  it("caminho ALHEIO devolvido pela RPC é descartado e logado; só os da loja chegam ao remove", async () => {
    rpcRemocao([
      `${LOJA}/galeria/${guid(1)}.webp`,
      `${OUTRA}/galeria/${guid(2)}.webp`,
      `${LOJA}/../${OUTRA}/${guid(3)}.webp`,
      `produtos/${LOJA}/${guid(4)}.webp`,
    ]);
    respostaRpc.limpar_recortes_sem_uso = { data: [`${OUTRA}/${guid(5)}.webp`], error: null };

    const r = await removerImagensGaleria(IDS);

    expect(caminhosRemovidos()).toEqual([`${LOJA}/galeria/${guid(1)}.webp`]);
    expect(JSON.stringify(removes)).not.toContain(OUTRA);
    expect(errorSpy).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it.each([
    ["0 ids", []],
    ["51 ids", Array.from({ length: 51 }, (_, i) => guid(i + 1))],
    ["duplicata", [guid(1), guid(2), guid(1)]],
    ["não-uuid", [guid(1), "nao-e-uuid"]],
    ["não é array", guid(1)],
  ])("ids inválidos (%s) → erro SEM chamar RPC nem Storage", async (_r, ids) => {
    const r = await removerImagensGaleria(ids as string[]);
    expect(r.ok).toBe(false);
    expect(rpcs).toHaveLength(0);
    expect(removes).toHaveLength(0);
  });

  it("falha do Storage → ok com os números da RPC, SEM DELETE (linhas ficam pendentes), console.error", async () => {
    rpcRemocao([`${LOJA}/galeria/${guid(1)}.webp`]);
    respostaRpc.limpar_recortes_sem_uso = { data: [`${LOJA}/galeria/${guid(1)}.webp`], error: null };
    respostaRemove = { data: null, error: { message: "storage fora do ar" } };

    const r = await removerImagensGaleria(IDS);

    expect(r).toEqual({ ok: true, removidas: 2, ignoradas: 0, produtosLimpos: 3, logoLimpa: true });
    expect(deletesEm("imagens_loja")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("erro da RPC → mensagem genérica sem vazar, ZERO Storage", async () => {
    respostaRpc.remover_imagens_loja = {
      data: null,
      error: { message: "remover_imagens_loja: sem posse da loja", code: "42501" },
    };
    const r = await removerImagensGaleria(IDS);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/posse|42501|remover_imagens_loja/);
    expect(removes).toHaveLength(0);
    expect(deletesEm("imagens_loja")).toHaveLength(0);
  });

  it("todas já removidas (D8) → ok com removidas 0, ignoradas N e nenhum objeto removido", async () => {
    respostaRpc.remover_imagens_loja = {
      data: { caminhos: [], removidas: 0, ignoradas: 2, produtos_limpos: 0, logo_limpa: false },
      error: null,
    };
    const r = await removerImagensGaleria(IDS);
    expect(r).toEqual({ ok: true, removidas: 0, ignoradas: 2, produtosLimpos: 0, logoLimpa: false });
    expect(caminhosRemovidos()).toEqual([]);
  });

  it("rate limit por loja.id com a chave removerImagensGaleria; estourado → sem RPC", async () => {
    verificarRateLimit.mockResolvedValue({ permitido: false });
    const r = await removerImagensGaleria(IDS);
    expect(r.ok).toBe(false);
    expect(rpcs).toHaveLength(0);
    expect(verificarRateLimit).toHaveBeenCalledWith("removerImagensGaleria", LOJA);
  });

  it("sem loja → recusa sem RPC", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await removerImagensGaleria(IDS);
    expect(r.ok).toBe(false);
    expect(rpcs).toHaveLength(0);
  });

  it("revalida a galeria, produtos, perfil e a vitrine (passo 13)", async () => {
    rpcRemocao([`${LOJA}/galeria/${guid(1)}.webp`]);
    await removerImagensGaleria(IDS);
    const rotas = revalidatePath.mock.calls.map((c) => c[0]);
    expect(rotas).toContain("/painel/galeria");
    expect(rotas).toContain("/painel/produtos");
    expect(rotas).toContain("/painel/configuracoes/perfil");
    expect(revalidatePath).toHaveBeenCalledWith("/loja/[slug]", "page");
  });
});
