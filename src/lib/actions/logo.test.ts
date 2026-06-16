import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

// Issue 003: STORAGE_URL_PREFIX deriva de NEXT_PUBLIC_SUPABASE_URL (indefinida no
// runner). vi.hoisted roda ANTES dos imports ESM → storage.ts é avaliado com a
// base correta, e podemos montar URLs válidas/ inválidas de Storage nos casos.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});

import { STORAGE_URL_PREFIX } from "@/lib/validacoes/storage";
import { CAMPO_ARQUIVO } from "./upload-contrato";

/**
 * Fase RED (TDD) da issue 003 — Server Actions `salvarLogoLoja(formData)` e
 * `removerLogoLoja()` em `src/lib/actions/logo.ts`.
 *
 * Por que é RED de verdade: o módulo `./logo` AINDA NÃO EXISTE (fase GREEN o
 * cria). O `import { salvarLogoLoja, removerLogoLoja } from "./logo"` falha a
 * resolução do módulo → todo o arquivo de teste quebra na coleta. Output real
 * anexado na issue. Cada asserção é sobre o COMPORTAMENTO esperado da action
 * implementada (validar tipo/tamanho/conteúdo real no servidor, loja_id do auth,
 * path escopado `{loja_id}/logo/`, schemaStorageUrl antes do UPDATE, erro
 * genérico sem vazar e.message).
 *
 * Invariantes de segurança provadas aqui (seguranca.md §10/§13/§14/§18):
 *  - loja_id DERIVADO de buscarLojaDoDono (auth.uid), NUNCA do FormData — um
 *    loja_id alheio injetado é IGNORADO; o path usa sempre loja.id do auth.
 *  - dupla validação server-side: metadado (validarImagem tipo/2MB) E conteúdo
 *    real (validarMagicBytes) — .exe/gif disfarçado de png é barrado, nada sobe.
 *  - URL persistida passa por schemaStorageUrl ANTES do UPDATE: getPublicUrl
 *    apontando para domínio externo → NÃO persiste.
 *  - erro de Storage → genérico, sem vazar e.message; console.error no servidor.
 */

const LOJA_DONO = "11111111-1111-1111-1111-111111111111"; // loja do auth.uid()
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja de outro dono

// next/headers e rate limit: indisponíveis fora de request scope — fail-open.
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-real-ip": "127.0.0.1" })),
}));
// Mock controlável — o beforeEach repõe { permitido: true }; testes de rate limit
// sobrescrevem com mockResolvedValueOnce({ permitido: false }).
const verificarRateLimitMock = vi.fn().mockResolvedValue({ permitido: true });
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: (_headers: Headers) => "127.0.0.1",
  verificarRateLimit: (...args: unknown[]) => verificarRateLimitMock(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ── Magic bytes reais (espelham ASSINATURAS de validarImagem.ts) ──────────────
// WEBP (container RIFF): "RIFF" no offset 0 + "WEBP" no offset 8.
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x00, 0x00, 0x00, 0x00, // tamanho (irrelevante)
  0x57, 0x45, 0x42, 0x50, // "WEBP"
  0x00, 0x00, 0x00, 0x00,
]);
// MZ ("MZ" = 0x4d 0x5a) — header de PE/EXE; nenhuma assinatura de imagem bate.
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
// GIF89a — tipo não-whitelisted no validarMagicBytes (e gif não está na allowlist).
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

// ── Captura de cada upload ao Storage ─────────────────────────────────────────
type UploadCall = {
  bucket: string;
  path: string;
  opts?: Record<string, unknown>;
};
let uploads: UploadCall[];
let uploadResposta: { data: unknown; error: unknown };
// Permite que testes substituam a resposta de getPublicUrl.
let publicUrlResposta: string | null = null; // null → URL Storage derivada do path

// ── client AUTENTICADO: storage + UPDATE de lojas sob RLS ─────────────────────
const fromTabela = vi.fn();
const updatePatch = vi.fn();
const updateEq = vi.fn();
let updateResposta: { error: unknown };

function makeClient() {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _file: unknown, opts?: Record<string, unknown>) => {
          uploads.push({ bucket, path, opts });
          return uploadResposta;
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl:
              publicUrlResposta !== null
                ? publicUrlResposta
                : `${STORAGE_URL_PREFIX}${bucket}/${path}`,
          },
        }),
      }),
    },
    from: (tabela: string) => {
      fromTabela(tabela);
      return {
        update: (patch: Record<string, unknown>) => {
          updatePatch(patch);
          // PostgREST exige WHERE (.eq) no UPDATE — a action encadeia .eq("id", …).
          return {
            eq: (coluna: string, valor: unknown) => {
              updateEq(coluna, valor);
              return Promise.resolve(updateResposta);
            },
          };
        },
      };
    },
  };
}

let authClient: ReturnType<typeof makeClient>;
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// service_role NÃO deve ser usado: tudo passa pela RLS autenticada do lojista.
const createServiceClient = vi.fn(() => ({ __role: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

import { salvarLogoLoja, removerLogoLoja } from "./logo";

function lojaDoDono(): Partial<Tables<"lojas">> {
  return { id: LOJA_DONO, dono_id: "dono-1", slug: "minha-loja", ativo: true };
}

/** Blob com magic bytes + type; força size quando necessário. */
function blob(bytes: Uint8Array, over: { type?: string; size?: number } = {}): Blob {
  const b = new Blob([bytes as BlobPart], { type: over.type ?? "image/webp" });
  if (over.size !== undefined) {
    Object.defineProperty(b, "size", { value: over.size });
  }
  return b;
}

/** FormData com o arquivo no campo CAMPO_ARQUIVO + extras opcionais. */
function fd(arquivo: Blob, extras: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.append(CAMPO_ARQUIVO, arquivo);
  for (const [k, v] of Object.entries(extras)) f.append(k, v);
  return f;
}

function opEscrita(): UploadCall | undefined {
  return uploads[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  uploads = [];
  uploadResposta = { data: { path: "ok" }, error: null };
  updateResposta = { error: null };
  publicUrlResposta = null;
  authClient = makeClient();
  buscarLojaDoDono.mockResolvedValue(lojaDoDono());
  verificarRateLimitMock.mockResolvedValue({ permitido: true });
});

describe("salvarLogoLoja (Server Action — issue 003)", () => {
  it("caso 1 — ATAQUE: .exe renomeado .png (magic bytes inválidos) é barrado, SEM upload nem update", async () => {
    const r = await salvarLogoLoja(fd(blob(EXE, { type: "image/png" })));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("caso 2 — arquivo acima de TAMANHO_MAXIMO_BYTES (>2MB) é rejeitado antes de I/O", async () => {
    const r = await salvarLogoLoja(
      fd(blob(WEBP, { type: "image/webp", size: 2 * 1024 * 1024 + 1 })),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("caso 3 — tipo não-whitelisted (image/gif) é rejeitado, SEM upload", async () => {
    const r = await salvarLogoLoja(fd(blob(GIF, { type: "image/gif" })));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("caso 4 — loja_id alheio no FormData é IGNORADO: path usa sempre loja.id do auth", async () => {
    await salvarLogoLoja(fd(blob(WEBP, { type: "image/webp" }), { loja_id: LOJA_OUTRA }));
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    const path = opEscrita()?.path ?? "";
    expect(path.startsWith(`${LOJA_DONO}/logo/`)).toBe(true);
    expect(path).not.toContain(LOJA_OUTRA);
    expect(path.startsWith("produtos/")).toBe(false);
    // UPDATE escopado por id da loja do auth.
    expect(updateEq).toHaveBeenCalledWith("id", LOJA_DONO);
  });

  it("caso 5 — sem loja (buscarLojaDoDono → null) → ok:false, SEM upload nem update", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await salvarLogoLoja(fd(blob(WEBP, { type: "image/webp" })));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("caso 6 — feliz: webp válido → upload em {loja_id}/logo/<uuid>.webp + UPDATE logo_url + ok:true", async () => {
    const r = await salvarLogoLoja(fd(blob(WEBP, { type: "image/webp" })));
    expect(r.ok).toBe(true);

    const op = opEscrita();
    expect(op).toBeDefined();
    expect(op?.bucket).toBe("produtos");
    expect(op?.path).toMatch(
      /^11111111-1111-1111-1111-111111111111\/logo\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i,
    );

    // UPDATE da coluna logo_url na tabela lojas, escopado por id.
    expect(fromTabela).toHaveBeenCalledWith("lojas");
    const patch = updatePatch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(patch ?? {})).toEqual(["logo_url"]);
    expect(updateEq).toHaveBeenCalledWith("id", LOJA_DONO);

    // Retorno carrega a URL persistida (a mesma do UPDATE).
    if (r.ok) {
      expect(r.logo_url).toBe(patch.logo_url);
      expect(r.logo_url.startsWith(STORAGE_URL_PREFIX)).toBe(true);
    }
    // service_role nunca usado.
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("caso 7 — schemaStorageUrl barra URL não-Storage (getPublicUrl externo) → NÃO persiste, genérico", async () => {
    publicUrlResposta = "https://evil.com/storage/v1/object/public/produtos/x.webp";
    const r = await salvarLogoLoja(fd(blob(WEBP, { type: "image/webp" })));
    expect(r.ok).toBe(false);
    // O upload pode ter ocorrido, mas a URL externa NUNCA pode ser persistida.
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("caso 9 — erro de storage.upload → ok:false genérico (não vaza e.message), console.error chamado", async () => {
    uploadResposta = {
      data: null,
      error: { message: "bucket secret key XYZ", statusCode: "500" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await salvarLogoLoja(fd(blob(WEBP, { type: "image/webp" })));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(spy).toHaveBeenCalled();
    expect(updatePatch).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // ── Regressão: gate de rate limit (finding MÉDIA da auditoria) ────────────────

  it("caso 10 — rate limit bloqueado → ok:false SEM chamar storage.upload NEM update de lojas", async () => {
    verificarRateLimitMock.mockResolvedValueOnce({ permitido: false });
    const r = await salvarLogoLoja(fd(blob(WEBP, { type: "image/webp" })));
    expect(r.ok).toBe(false);
    // O gate deve rejeitar antes de qualquer I/O.
    expect(opEscrita()).toBeUndefined();
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("caso 11 — caminho feliz mantém ok:true quando rate limit permitido (regressão do gate)", async () => {
    // Garante que { permitido: true } não quebra o fluxo normal após a mudança.
    verificarRateLimitMock.mockResolvedValueOnce({ permitido: true });
    const r = await salvarLogoLoja(fd(blob(WEBP, { type: "image/webp" })));
    expect(r.ok).toBe(true);
    expect(opEscrita()).toBeDefined();
    expect(updatePatch).toHaveBeenCalledOnce();
  });

  // ── Bordas de input ───────────────────────────────────────────────────────────

  it("caso 12 — FormData sem campo 'file' → ok:false SEM upload nem update", async () => {
    const vazio = new FormData(); // nenhum campo
    const r = await salvarLogoLoja(vazio);
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("caso 13 — Blob vazio (size 0) → ok:false SEM upload nem update", async () => {
    const b = new Blob([], { type: "image/webp" });
    // size já é 0 por construção; confirma a guarda `value.size <= 0`.
    expect(b.size).toBe(0);
    const r = await salvarLogoLoja(fd(b));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("caso 14 — patch do UPDATE contém SOMENTE a coluna logo_url (allowlist)", async () => {
    await salvarLogoLoja(fd(blob(WEBP, { type: "image/webp" })));
    const patch = updatePatch.mock.calls[0]?.[0] as Record<string, unknown>;
    // Qualquer coluna extra (ativo, dono_id, etc.) no patch seria um bug.
    expect(Object.keys(patch)).toEqual(["logo_url"]);
  });
});

describe("removerLogoLoja (Server Action — issue 003)", () => {
  it("caso 8 — UPDATE logo_url = NULL escopado por id, retorna ok:true", async () => {
    const r = await removerLogoLoja();
    expect(r.ok).toBe(true);
    expect(fromTabela).toHaveBeenCalledWith("lojas");
    const patch = updatePatch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch).toEqual({ logo_url: null });
    expect(updateEq).toHaveBeenCalledWith("id", LOJA_DONO);
    // Nenhum upload em remoção.
    expect(opEscrita()).toBeUndefined();
  });

  it("caso 9b — sem loja (buscarLojaDoDono → null) → ok:false, SEM update", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await removerLogoLoja();
    expect(r.ok).toBe(false);
    expect(updatePatch).not.toHaveBeenCalled();
  });
});
