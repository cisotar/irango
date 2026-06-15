import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

/**
 * Fase RED (TDD) da issue 075 — Server Action `enviarFotoProduto(formData)`.
 *
 * A action AINDA NÃO EXISTE com este nome/contrato em `src/lib/actions/upload.ts`
 * (hoje há `uploadFotoProduto`, produtoId-based, que será REMOVIDA na fase GREEN).
 * Logo o `import { enviarFotoProduto }` resolve para `undefined` e toda chamada
 * `enviarFotoProduto(...)` lança `TypeError: ... is not a function`. Esse é o RED.
 *
 * Novo contrato (plano da issue 075):
 *   export const CAMPO_ARQUIVO = "file";
 *   export async function enviarFotoProduto(formData: FormData): Promise<ResultadoUpload>
 *
 * Invariantes de segurança provadas aqui (seguranca.md §13/§14/§18):
 *  - loja_id é DERIVADO de buscarLojaDoDono (auth.uid()), NUNCA do payload —
 *    um loja_id alheio no FormData é IGNORADO.
 *  - dupla validação server-side: metadado (validarImagem 2MB/tipo) E conteúdo
 *    real (validarMagicBytes) — Content-Type mentido / não-imagem é barrado, nada
 *    é gravado.
 *  - ext + contentType vêm do CONTEÚDO real (tipoRealPorConteudo), nunca do
 *    declarado nem de file.name (Blob nem tem nome).
 *  - path = `{loja_id}/{uuid}.{ext}`, SEM prefixo `produtos/` (1º segmento ===
 *    loja.id — exigência da policy RLS `produtos_insert_propria`).
 *  - erro de Storage → genérico, sem vazar e.message; console.error no servidor.
 *  - exceção de infra (buscarLojaDoDono lança) PROPAGA — não vira ok:false mudo.
 */

const LOJA_DONO = "11111111-1111-1111-1111-111111111111"; // loja do auth.uid()
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja de outro dono

// Magic bytes reais (espelham ASSINATURAS de validarImagem.ts).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
// WEBP (container RIFF): "RIFF" no offset 0 + "WEBP" no offset 8.
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x00, 0x00, 0x00, 0x00, // tamanho (irrelevante)
  0x57, 0x45, 0x42, 0x50, // "WEBP"
  0x00, 0x00, 0x00, 0x00,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]); // "GIF89a" — NÃO reconhecido

// Captura de cada upload ao Storage.
type UploadCall = {
  bucket: string;
  path: string;
  fileBytes: Uint8Array;
  opts?: Record<string, unknown>;
};
let uploads: UploadCall[];
let uploadResposta: { data: unknown; error: unknown };
// Permite que testes individuais substituam a resposta de getPublicUrl.
let publicUrlResposta: string | null = null; // null = comportamento padrão (URL derivada do path)

function makeClient() {
  const client: Record<string, unknown> = {
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          file: ArrayBuffer | Uint8Array | Blob,
          opts?: Record<string, unknown>,
        ) => {
          let fileBytes: Uint8Array = new Uint8Array();
          if (file instanceof Uint8Array) fileBytes = file;
          else if (file instanceof ArrayBuffer) fileBytes = new Uint8Array(file);
          uploads.push({ bucket, path, fileBytes, opts });
          return uploadResposta;
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl:
              publicUrlResposta !== null
                ? publicUrlResposta
                : `https://cdn.fake/${bucket}/${path}`,
          },
        }),
      }),
    },
  };
  return client;
}

const authClient = makeClient();
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// service_role NÃO deve ser usado: upload do lojista passa pela RLS autenticada.
const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { enviarFotoProduto } from "./upload";

function lojaDoDono(): Partial<Tables<"lojas">> {
  return { id: LOJA_DONO, dono_id: "dono-1", slug: "minha-loja", ativo: true };
}

/** Cria um Blob com magic bytes e type, forçando size quando necessário. */
function blob(
  bytes: Uint8Array,
  over: { type?: string; size?: number } = {},
): Blob {
  const b = new Blob([bytes as BlobPart], { type: over.type ?? "image/png" });
  if (over.size !== undefined) {
    Object.defineProperty(b, "size", { value: over.size });
  }
  return b;
}

/** FormData com o arquivo no campo `file` (CAMPO_ARQUIVO). */
function fd(
  arquivo: Blob,
  extras: Record<string, string> = {},
): FormData {
  const f = new FormData();
  f.append("file", arquivo);
  for (const [k, v] of Object.entries(extras)) f.append(k, v);
  return f;
}

/** A primeira (e única) op de upload capturada, se houve. */
function opEscrita(): UploadCall | undefined {
  return uploads[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  uploads = [];
  uploadResposta = { data: { path: "ok" }, error: null };
  publicUrlResposta = null;
  buscarLojaDoDono.mockResolvedValue(lojaDoDono());
});

describe("enviarFotoProduto (Server Action — issue 075, FormData)", () => {
  it("caso 1 — caminho feliz: WEBP válido sobe e retorna foto_url; service_role nunca usado", async () => {
    const r = await enviarFotoProduto(fd(blob(WEBP, { type: "image/webp" })));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.foto_url).toContain(LOJA_DONO);
    expect(opEscrita()).toBeDefined();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("caso 2 — ATAQUE: GIF disfarçado de image/png é barrado por magic bytes, SEM upload", async () => {
    const r = await enviarFotoProduto(
      fd(blob(GIF, { type: "image/png" })),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("caso 3 — arquivo > 2MB é REJEITADO por tamanho, SEM upload", async () => {
    const r = await enviarFotoProduto(
      fd(blob(PNG, { size: 2 * 1024 * 1024 + 1 })),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("caso 4 — loja_id é DERIVADO do auth: path 1º segmento === loja.id, sem prefixo produtos/", async () => {
    await enviarFotoProduto(fd(blob(PNG)));
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    const path = opEscrita()?.path ?? "";
    expect(path.split("/")[0]).toBe(LOJA_DONO);
    expect(path.startsWith("produtos/")).toBe(false);
  });

  it("caso 5 — ATAQUE: loja_id de OUTRA loja no FormData é IGNORADO", async () => {
    await enviarFotoProduto(fd(blob(PNG), { loja_id: LOJA_OUTRA }));
    const path = opEscrita()?.path ?? "";
    expect(path).toContain(LOJA_DONO);
    expect(path).not.toContain(LOJA_OUTRA);
  });

  it("caso 6 — dono sem loja (buscarLojaDoDono → null) → ok:false, SEM upload", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await enviarFotoProduto(fd(blob(PNG)));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("caso 7 — FormData sem campo file → ok:false ('Imagem inválida.'), SEM upload", async () => {
    const r = await enviarFotoProduto(new FormData());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("Imagem inválida.");
    expect(opEscrita()).toBeUndefined();
    // Nem chega a derivar loja / criar client de upload válido.
    expect(opEscrita()).toBeUndefined();
  });

  it("caso 8 — campo file é string (não Blob) → ok:false, SEM upload", async () => {
    const f = new FormData();
    f.append("file", "texto-nao-e-arquivo");
    const r = await enviarFotoProduto(f);
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("caso 9 — Blob vazio (size 0) → ok:false, SEM upload", async () => {
    const r = await enviarFotoProduto(fd(blob(new Uint8Array(), { size: 0 })));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("caso 10 — nome de saída é UUID, path tem 2 segmentos {loja_id}/{uuid}.{ext}, sem path traversal", async () => {
    await enviarFotoProduto(fd(blob(PNG)));
    const path = opEscrita()?.path ?? "";
    expect(path).not.toContain("..");
    const partes = path.split("/");
    expect(partes).toHaveLength(2);
    expect(partes[0]).toBe(LOJA_DONO);
    const nomeArquivo = partes[1] ?? "";
    const semExt = nomeArquivo.replace(/\.[a-z0-9]+$/i, "");
    expect(semExt).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("caso 11 — MIME mentido (image/jpeg) + bytes PNG → tipo real (PNG) prevalece: .png + contentType image/png", async () => {
    const r = await enviarFotoProduto(fd(blob(PNG, { type: "image/jpeg" })));
    expect(r.ok).toBe(true);
    const op = opEscrita();
    expect(op).toBeDefined();
    expect(op?.path).toMatch(/\.png$/);
    expect(op?.opts?.contentType).toBe("image/png");
  });

  it("caso 12 — simétrico: MIME mentido (image/png) + bytes JPEG → .jpg + contentType image/jpeg", async () => {
    const r = await enviarFotoProduto(fd(blob(JPEG, { type: "image/png" })));
    expect(r.ok).toBe(true);
    const op = opEscrita();
    expect(op).toBeDefined();
    expect(op?.path).toMatch(/\.jpg$/);
    expect(op?.opts?.contentType).toBe("image/jpeg");
  });

  it("caso 13 — erro de Storage → ok:false genérico (não vaza e.message), console.error chamado", async () => {
    uploadResposta = {
      data: null,
      error: { message: "bucket secret key XYZ", statusCode: "500" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await enviarFotoProduto(fd(blob(PNG)));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("caso 14 — buscarLojaDoDono lança → a promise PROPAGA o erro (não vira ok:false mudo), SEM upload", async () => {
    buscarLojaDoDono.mockRejectedValue(new Error("conexão perdida"));
    await expect(enviarFotoProduto(fd(blob(PNG)))).rejects.toThrow(
      "conexão perdida",
    );
    expect(opEscrita()).toBeUndefined();
  });

  // Borda: limite exato de tamanho (2MB === TAMANHO_MAXIMO_BYTES).
  // validarImagem usa `>` (não `>=`), então exatamente 2MB deve PASSAR.
  // Pega regressão se o operador mudar de `>` para `>=`.
  it("caso 15 — arquivo com size exatamente 2MB (no limite) é ACEITO, sobe normalmente", async () => {
    const DOIS_MB = 2 * 1024 * 1024;
    const r = await enviarFotoProduto(fd(blob(PNG, { size: DOIS_MB })));
    expect(r.ok).toBe(true);
    expect(opEscrita()).toBeDefined();
  });

  // Caminho feliz para os outros dois MIME reais (além do WEBP do caso 1).
  // Garante que ext + contentType corretos são produzidos para JPEG e PNG nativos
  // (sem MIME mentido) — casos 11/12 cobrem cruzamento, não o caso direto.
  it("caso 16 — caminho feliz JPEG nativo: .jpg + contentType image/jpeg na escrita", async () => {
    const r = await enviarFotoProduto(fd(blob(JPEG, { type: "image/jpeg" })));
    expect(r.ok).toBe(true);
    const op = opEscrita();
    expect(op?.path).toMatch(/\.jpg$/);
    expect(op?.opts?.contentType).toBe("image/jpeg");
  });

  it("caso 17 — caminho feliz PNG nativo: .png + contentType image/png na escrita", async () => {
    const r = await enviarFotoProduto(fd(blob(PNG, { type: "image/png" })));
    expect(r.ok).toBe(true);
    const op = opEscrita();
    expect(op?.path).toMatch(/\.png$/);
    expect(op?.opts?.contentType).toBe("image/png");
  });

  // getPublicUrl: a action retorna EXATAMENTE a URL produzida pelo Storage,
  // sem transformar. Pega bug se a action processar ou ignorar o retorno.
  it("caso 18 — foto_url retorna a URL exata de getPublicUrl, sem transformação", async () => {
    publicUrlResposta = "https://cdn.supabase.io/storage/v1/object/public/produtos/loja/uuid.png";
    const r = await enviarFotoProduto(fd(blob(PNG)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.foto_url).toBe(publicUrlResposta);
  });
});
