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

// [galeria] Captura de remove() (compensação) e da cadeia PostgREST em tabelas
// (INSERT da linha-cópia em imagens_loja). Qualquer método da cadeia é gravado.
type Chamada = { metodo: string; args: unknown[] };
type OpTabela = { tabela: string; chamadas: Chamada[] };
let removes: { bucket: string; caminhos: string[] }[];
let opsTabela: OpTabela[];
let respostaTabela: (op: OpTabela) => { data: unknown; error: unknown };

function cadeia(op: OpTabela): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
            Promise.resolve().then(() => respostaTabela(op)).then(ok, falha);
        }
        return (...args: unknown[]) => {
          op.chamadas.push({ metodo: String(prop), args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function makeClient() {
  const client: Record<string, unknown> = {
    from: (tabela: string) => {
      const op: OpTabela = { tabela, chamadas: [] };
      opsTabela.push(op);
      return cadeia(op);
    },
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
        remove: async (caminhos: string[]) => {
          removes.push({ bucket, caminhos });
          return { data: [], error: null };
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

// [galeria] Origem do recorte: tabela em memória que a query MOCKADA respeita
// do jeito que a real deve respeitar (loja_id + original + não pendente). Assim
// uma origem de OUTRA loja só "passa" se a action consultar com a loja errada.
type LinhaImagem = {
  id: string;
  loja_id: string;
  origem_id: string | null;
  remocao_pendente_em: string | null;
  caminho: string;
};
let imagens: LinhaImagem[];
const buscarOriginalDaLoja = vi.fn(
  async (_client: unknown, lojaId: string, id: string) =>
    imagens.find(
      (i) =>
        i.id === id &&
        i.loja_id === lojaId &&
        i.origem_id === null &&
        i.remocao_pendente_em === null,
    ) ?? null,
);
vi.mock("@/lib/supabase/queries/imagens", () => ({
  buscarOriginalDaLoja: (...a: unknown[]) =>
    buscarOriginalDaLoja(...(a as [unknown, string, string])),
  contarOriginaisDaLoja: vi.fn(),
  listarImagensDaLoja: vi.fn(),
  listarImagensDaLojaAdmin: vi.fn(),
}));

// [galeria] Rate limit `recorteImagem` por loja.id (fail-open no real).
const verificarRateLimit = vi.fn();
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "127.0.0.1",
  verificarRateLimit: (...a: unknown[]) => verificarRateLimit(...a),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-real-ip": "127.0.0.1" })),
}));

import { enviarFotoProduto } from "./upload";

// Literais do contrato da galeria (galeria-contrato.ts ainda não existe; usar
// o literal mantém este arquivo coletável e o RED por asserção).
const CAMPO_ORIGEM = "origem_id";
const MSG_ORIGEM_REMOVIDA = "Essa imagem foi removida da galeria.";
const ORIGEM = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001"; // original da loja do dono
const ORIGEM_ALHEIA = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002"; // original de OUTRA loja
const ORIGEM_PENDENTE = "aaaaaaaa-aaaa-aaaa-aaaa-000000000003"; // original em remoção
const ORIGEM_INEXISTENTE = "aaaaaaaa-aaaa-aaaa-aaaa-000000000004";

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

/**
 * FormData com o arquivo no campo `file` (CAMPO_ARQUIVO) e, desde a galeria,
 * o `origem_id` OBRIGATÓRIO (original da própria loja). `extras` sobrescreve.
 */
function fd(
  arquivo: Blob,
  extras: Record<string, string> = {},
): FormData {
  const f = new FormData();
  f.append("file", arquivo);
  const campos = { [CAMPO_ORIGEM]: ORIGEM, ...extras };
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

/** FormData SEM origem_id (contrato antigo, agora recusado). */
function fdSemOrigem(arquivo: Blob): FormData {
  const f = new FormData();
  f.append("file", arquivo);
  return f;
}

function insertsImagens(): Record<string, unknown>[] {
  return opsTabela
    .filter((o) => o.tabela === "imagens_loja")
    .flatMap((o) => o.chamadas.filter((c) => c.metodo === "insert"))
    .map((c) => c.args[0] as Record<string, unknown>);
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
  removes = [];
  opsTabela = [];
  respostaTabela = () => ({ data: null, error: null });
  imagens = [
    { id: ORIGEM, loja_id: LOJA_DONO, origem_id: null, remocao_pendente_em: null, caminho: `${LOJA_DONO}/galeria/${ORIGEM}.webp` },
    { id: ORIGEM_ALHEIA, loja_id: LOJA_OUTRA, origem_id: null, remocao_pendente_em: null, caminho: `${LOJA_OUTRA}/galeria/${ORIGEM_ALHEIA}.webp` },
    { id: ORIGEM_PENDENTE, loja_id: LOJA_DONO, origem_id: null, remocao_pendente_em: "2026-10-06T12:00:00Z", caminho: `${LOJA_DONO}/galeria/${ORIGEM_PENDENTE}.webp` },
  ];
  verificarRateLimit.mockResolvedValue({ permitido: true });
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

// ═════════════════════════════════════════════════════════════════════════════
// Fase RED — galeria de imagens (specs/galeria-imagens-loja.md, página 3,
// RN-G3, casos-limite "original removida em outra aba" e "INSERT da cópia
// falha"). `enviarFotoProduto` passa a EXIGIR `origem_id`: valida no servidor
// que é original NÃO pendente DA LOJA da sessão ANTES de qualquer upload, sobe o
// recorte em `{loja}/{uuid}.{ext}` e registra a linha-cópia em imagens_loja.
// ═════════════════════════════════════════════════════════════════════════════
describe("enviarFotoProduto — origem_id obrigatório (galeria)", () => {
  it("sem origem_id → recusa, ZERO upload, sem consultar a origem", async () => {
    const r = await enviarFotoProduto(fdSemOrigem(blob(PNG)));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
    expect(insertsImagens()).toHaveLength(0);
    expect(buscarOriginalDaLoja).not.toHaveBeenCalled();
  });

  it("origem_id não-uuid → recusa, ZERO upload, sem consultar a origem", async () => {
    const r = await enviarFotoProduto(fd(blob(PNG), { [CAMPO_ORIGEM]: "../../etc" }));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
    expect(buscarOriginalDaLoja).not.toHaveBeenCalled();
  });

  it("ATAQUE: origem_id de OUTRA loja → MSG_ORIGEM_REMOVIDA, ZERO upload; consulta na loja da sessão", async () => {
    const r = await enviarFotoProduto(fd(blob(PNG), { [CAMPO_ORIGEM]: ORIGEM_ALHEIA }));
    expect(r).toEqual({ ok: false, erro: MSG_ORIGEM_REMOVIDA });
    expect(opEscrita()).toBeUndefined();
    expect(insertsImagens()).toHaveLength(0);
    expect(buscarOriginalDaLoja).toHaveBeenCalledWith(authClient, LOJA_DONO, ORIGEM_ALHEIA);
  });

  it("ATAQUE: loja_id alheio no FormData não muda a loja da consulta da origem", async () => {
    await enviarFotoProduto(fd(blob(PNG), { [CAMPO_ORIGEM]: ORIGEM_ALHEIA, loja_id: LOJA_OUTRA }));
    expect(buscarOriginalDaLoja).toHaveBeenCalledWith(authClient, LOJA_DONO, ORIGEM_ALHEIA);
    expect(opEscrita()).toBeUndefined();
  });

  it("origem com remoção pendente → MSG_ORIGEM_REMOVIDA, ZERO upload", async () => {
    const r = await enviarFotoProduto(fd(blob(PNG), { [CAMPO_ORIGEM]: ORIGEM_PENDENTE }));
    expect(r).toEqual({ ok: false, erro: MSG_ORIGEM_REMOVIDA });
    expect(opEscrita()).toBeUndefined();
  });

  it("origem inexistente → MSG_ORIGEM_REMOVIDA, ZERO upload", async () => {
    const r = await enviarFotoProduto(fd(blob(PNG), { [CAMPO_ORIGEM]: ORIGEM_INEXISTENTE }));
    expect(r).toEqual({ ok: false, erro: MSG_ORIGEM_REMOVIDA });
    expect(opEscrita()).toBeUndefined();
  });

  it("feliz: sobe o recorte em {loja}/{uuid}.{ext} e registra a linha-cópia com origem_id e bytes do buffer", async () => {
    const r = await enviarFotoProduto(fd(blob(WEBP, { type: "image/webp" })));
    expect(r.ok).toBe(true);
    const path = opEscrita()?.path ?? "";
    expect(path).toMatch(
      /^11111111-1111-1111-1111-111111111111\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/,
    );
    const linhas = insertsImagens();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      loja_id: LOJA_DONO,
      origem_id: ORIGEM,
      caminho: path,
      bytes: WEBP.byteLength,
    });
    expect(linhas[0].miniatura_caminho ?? null).toBeNull();
  });

  it("INSERT da linha-cópia falha → compensação remove([caminho]) e erro genérico sem vazar o banco", async () => {
    respostaTabela = (op) =>
      op.chamadas.some((c) => c.metodo === "insert")
        ? { data: null, error: { message: "duplicate key imagens_loja_caminho_unico", code: "23505" } }
        : { data: null, error: null };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await enviarFotoProduto(fd(blob(PNG)));

    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/imagens_loja|23505|duplicate/);
    const path = opEscrita()?.path;
    expect(removes).toEqual([{ bucket: "produtos", caminhos: [path] }]);
    spy.mockRestore();
  });

  it("corrida: origem ficou pendente entre a checagem e o INSERT (trigger 23503) → compensação + MSG_ORIGEM_REMOVIDA", async () => {
    respostaTabela = (op) =>
      op.chamadas.some((c) => c.metodo === "insert")
        ? { data: null, error: { message: "imagens_loja: origem indisponível", code: "23503" } }
        : { data: null, error: null };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await enviarFotoProduto(fd(blob(PNG)));

    expect(r).toEqual({ ok: false, erro: MSG_ORIGEM_REMOVIDA });
    expect(removes).toEqual([{ bucket: "produtos", caminhos: [opEscrita()?.path] }]);
    spy.mockRestore();
  });

  it("rate limit recorteImagem por loja.id; estourado → recusa sem upload", async () => {
    verificarRateLimit.mockResolvedValue({ permitido: false });
    const r = await enviarFotoProduto(fd(blob(PNG)));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
    expect(verificarRateLimit).toHaveBeenCalledWith("recorteImagem", LOJA_DONO);
  });
});
