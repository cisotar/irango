import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

/**
 * Fase RED (TDD) da issue 018 — Server Action `uploadFotoProduto`.
 * A action AINDA NÃO EXISTE (`src/lib/actions/upload.ts`), logo TODO o módulo
 * falha ao importar (MODULE NOT FOUND) ou, com stub, nas asserções. Esse é o RED.
 * A implementação (validar magic bytes, gerar uuid, escopar pasta) é da fase GREEN.
 *
 * 4 cenários CRÍTICOS (critério de aceite + seguranca.md §13/§14):
 *  1. Upload de gif → REJEITADO no servidor por magic bytes (não basta a extensão
 *     /Content-Type do client: gif NÃO está nas ASSINATURAS reconhecidas).
 *  2. Arquivo > 2MB (TAMANHO_MAXIMO_BYTES) → REJEITADO por tamanho, SEM upload.
 *  3. Nome de saída é um UUID — NUNCA o nome original enviado pelo client
 *     (evita path traversal / colisão / vazamento de nome).
 *  4. Lojista NÃO escreve na pasta de outra loja: o `loja_id` do path é DERIVADO
 *     de buscarLojaDoDono (auth.uid()), nunca do payload do client. Payload com
 *     loja_id alheio é IGNORADO — o upload cai em produtos/{loja_do_dono}/...
 *
 * Padrão de mocks: espelha produto.test.ts. O client raiz resolvido por
 * `await createClient()` NÃO é thenável; aqui o que importa é `.storage.from(
 * 'produtos').upload(path, file, opts)` — capturamos `path` e o conteúdo.
 */

const LOJA_DONO = "11111111-1111-1111-1111-111111111111"; // loja do auth.uid()
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja de outro dono
const PRODUTO_ID = "99999999-9999-9999-9999-999999999999";

// Magic bytes reais (espelham ASSINATURAS de validarImagem.ts).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
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
          let fileBytes = new Uint8Array();
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

import { uploadFotoProduto } from "./upload";

function lojaDoDono(): Partial<Tables<"lojas">> {
  return { id: LOJA_DONO, dono_id: "dono-1", slug: "minha-loja", ativo: true };
}

/** Monta um File-like (a action lê arrayBuffer + size + type do File do form). */
function arquivo(
  bytes: Uint8Array,
  over: { type?: string; name?: string; size?: number } = {},
): File {
  const f = new File([bytes], over.name ?? "foto-original.png", {
    type: over.type ?? "image/png",
  });
  if (over.size !== undefined) {
    Object.defineProperty(f, "size", { value: over.size });
  }
  return f;
}

/** Op de upload na pasta de uma loja específica (prefixo produtos/{loja}/). */
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

describe("uploadFotoProduto (Server Action — issue 018)", () => {
  it("caminho feliz: PNG válido sobe e retorna foto_url pública", async () => {
    const r = await uploadFotoProduto(PRODUTO_ID, arquivo(PNG));
    expect(r.ok).toBe(true);
    expect(opEscrita()).toBeDefined();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("CENÁRIO 1 — ATAQUE: gif é REJEITADO por magic bytes, SEM upload", async () => {
    // Mesmo declarando image/png (Content-Type mentido), o conteúdo é GIF.
    const r = await uploadFotoProduto(
      PRODUTO_ID,
      arquivo(GIF, { type: "image/png", name: "malicioso.png" }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("CENÁRIO 2 — arquivo > 2MB é REJEITADO por tamanho, SEM upload", async () => {
    const r = await uploadFotoProduto(
      PRODUTO_ID,
      arquivo(PNG, { size: 2 * 1024 * 1024 + 1 }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("CENÁRIO 3 — nome de saída é UUID, NUNCA o nome original do client", async () => {
    await uploadFotoProduto(
      PRODUTO_ID,
      arquivo(PNG, { name: "../../etc/passwd.png" }),
    );
    const path = opEscrita()?.path ?? "";
    const nomeArquivo = path.split("/").pop() ?? "";
    // Não contém o nome original nem fragmentos de path traversal.
    expect(path).not.toContain("passwd");
    expect(path).not.toContain("..");
    // O nome (sem extensão) bate com o formato UUID v4.
    const semExt = nomeArquivo.replace(/\.[a-z0-9]+$/i, "");
    expect(semExt).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("CENÁRIO 4 — path é escopado na pasta da PRÓPRIA loja (derivada do auth)", async () => {
    await uploadFotoProduto(PRODUTO_ID, arquivo(PNG));
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    // O 1º segmento do NOME do objeto (relativo ao bucket) é a loja_id — é o que
    // a policy RLS `produtos_insert_propria` (foldername(name)[1]) exige. NÃO deve
    // ser prefixado com "produtos/" (isso faria foldername[1] = "produtos" e a RLS
    // recusaria todo upload).
    expect((opEscrita()?.path ?? "").split("/")[0]).toBe(LOJA_DONO);
  });

  it("CENÁRIO 4 — ATAQUE: loja_id de OUTRA loja no payload é IGNORADO", async () => {
    // Cliente tenta forçar a pasta de outra loja passando loja_id alheio.
    await uploadFotoProduto(PRODUTO_ID, arquivo(PNG), { loja_id: LOJA_OUTRA });
    const path = opEscrita()?.path ?? "";
    expect(path).toContain(LOJA_DONO);
    expect(path).not.toContain(LOJA_OUTRA);
  });

  it("ATAQUE: dono sem loja (buscarLojaDoDono → null) → erro, SEM upload", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await uploadFotoProduto(PRODUTO_ID, arquivo(PNG));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("erro de Storage → genérico, sem vazar e.message", async () => {
    uploadResposta = {
      data: null,
      error: { message: "bucket secret key XYZ", statusCode: "500" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await uploadFotoProduto(PRODUTO_ID, arquivo(PNG));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret");
    spy.mockRestore();
  });

  // ── Novos casos de cobertura ────────────────────────────────────────────────

  it("MIME mentido (image/jpeg) + magic bytes de PNG → tipo real (PNG) prevalece no path e contentType", async () => {
    // Cliente declara MIME jpeg mas o conteúdo tem magic bytes de PNG.
    // O tipo REAL (derivado do conteúdo) deve prevalecer: extensão .png, contentType image/png.
    const r = await uploadFotoProduto(
      PRODUTO_ID,
      arquivo(PNG, { type: "image/jpeg" }), // MIME declarado mentido
    );
    expect(r.ok).toBe(true);
    const op = opEscrita();
    expect(op).toBeDefined();
    // Extensão do path deve refletir o tipo REAL (png), não o declarado (jpg).
    expect(op?.path).toMatch(/\.png$/);
    // contentType enviado ao Storage deve ser o tipo REAL.
    expect(op?.opts?.contentType).toBe("image/png");
  });

  it("MIME mentido (image/png) + magic bytes de JPEG → tipo real (JPEG) prevalece no path e contentType", async () => {
    // Simétrico ao anterior: conteúdo é JPEG mas MIME declara PNG.
    const r = await uploadFotoProduto(
      PRODUTO_ID,
      arquivo(JPEG, { type: "image/png" }),
    );
    expect(r.ok).toBe(true);
    const op = opEscrita();
    expect(op).toBeDefined();
    expect(op?.path).toMatch(/\.jpg$/);
    expect(op?.opts?.contentType).toBe("image/jpeg");
  });

  it("buscarLojaDoDono lança exceção → action propaga o erro (não swallowa silenciosamente)", async () => {
    // O código não tem try/catch em torno de buscarLojaDoDono.
    // A promise deve rejeitar — não retornar ok:false silenciosamente, o que
    // ocultaria falhas de infra como perda de conexão.
    buscarLojaDoDono.mockRejectedValue(new Error("conexão perdida"));
    await expect(uploadFotoProduto(PRODUTO_ID, arquivo(PNG))).rejects.toThrow(
      "conexão perdida",
    );
    // O upload não deve ter ocorrido.
    expect(opEscrita()).toBeUndefined();
  });

  it("getPublicUrl retorna publicUrl vazio → foto_url retornada é string vazia (comportamento atual documentado)", async () => {
    // A implementação não valida se publicUrl está vazio antes de retornar ok:true.
    // Este teste documenta o comportamento atual. Se o time corrigir para retornar
    // ok:false quando publicUrl é vazio, altere o expect abaixo para ok:false.
    publicUrlResposta = "";
    const r = await uploadFotoProduto(PRODUTO_ID, arquivo(PNG));
    // Comportamento atual: retorna ok:true com foto_url vazia (bug silencioso).
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.foto_url).toBe("");
    }
  });

  it("produtoId NUNCA entra no path do Storage", async () => {
    const produtoIdUnico = "produto-especial-nao-deve-aparecer-no-path";
    await uploadFotoProduto(produtoIdUnico, arquivo(PNG));
    const path = opEscrita()?.path ?? "";
    expect(path).not.toContain(produtoIdUnico);
    // Path relativo ao bucket deve ter 2 segmentos: loja_id / uuid.ext
    // (o bucket é passado via storage.from(bucket), nunca no path)
    const partes = path.split("/");
    expect(partes).toHaveLength(2);
    expect(partes[0]).toBe(LOJA_DONO);
  });
});
