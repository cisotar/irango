import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 090 (crítica: SIM, red-first). Server Action admin
 * `enviarFotoProdutoAdmin(formData)` em `./admin-upload`.
 *
 * Por que é RED de verdade HOJE: a action existe apenas como STUB que lança
 * `Error("TODO: GREEN")` — sem nenhuma lógica de produção. Cada teste abaixo
 * asserta o COMPORTAMENTO/efeito esperado; contra o stub, a chamada ou rejeita
 * com "TODO: GREEN" (onde se esperava `{ ok:... }`) ou a asserção de efeito falha
 * (NENHUM upload foi capturado). A fase GREEN (`executar`) escreve o corpo real.
 *
 * Invariante central sob service_role (spec admin-onboarding-assistido §13/§7):
 *   o service client IGNORA a RLS do bucket — o path montado SERVER-SIDE a partir
 *   do `lojaId` validado é a ÚNICA amarra de isolamento entre lojas. Logo o path
 *   SEMPRE começa por `${lojaId}/` e o `lojaId` SEMPRE é um UUID validado.
 *
 * Invariantes provadas:
 *  - MIME falso (extensão diz png, magic bytes não batem) → validarBlobImagem
 *    falha → REJEITADO, ZERO upload.
 *  - lojaId inválido (não-UUID, extraído do FormData) → REJEITADO, ZERO upload,
 *    sem nem elevar a service_role.
 *  - admin não provado (verificarAdminSaaS lança) → exceção PROPAGA (fail-closed),
 *    ZERO upload, service client NUNCA criado.
 *  - sucesso → path `${lojaId}/${uuid}.${ext}` no bucket `produtos`, retorna
 *    `foto_url` https. Prova: path.split("/")[0] === lojaId, sem prefixo produtos/.
 *
 * CONTRATO que o GREEN deve satisfazer (em ./admin-upload.ts):
 *   enviarFotoProdutoAdmin(formData: FormData):
 *     Promise<{ ok:true; foto_url:string } | { ok:false; erro:string }>
 */

const LOJA_ID = "33333333-3333-3333-3333-333333333333";
const LOJA_OUTRA = "44444444-4444-4444-4444-444444444444";

// Magic bytes reais (espelham ASSINATURAS de validarImagem.ts).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
// GIF "GIF89a" — NÃO reconhecido por validarMagicBytes: serve de MIME falso.
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

// ── Captura de cada upload ao Storage feito pelo SERVICE client. ──────────────
type UploadCall = {
  bucket: string;
  path: string;
  fileBytes: Uint8Array;
  opts?: Record<string, unknown>;
};
let uploads: UploadCall[];
let uploadResposta: { data: unknown; error: unknown };
let publicUrlResposta: string | null;

// [galeria] remove() de compensação + cadeia PostgREST gravada por tabela.
type Chamada = { metodo: string; args: unknown[] };
type OpTabela = { tabela: string; chamadas: Chamada[] };
let removes: { bucket: string; caminhos: string[] }[];
let opsTabela: OpTabela[];
let respostaTabela: (op: OpTabela) => { data: unknown; error: unknown; count?: number };

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

function makeServiceClient() {
  return {
    // O client real SEMPRE tem `from` (método de protótipo) — o escopo do
    // contexto admin faz `svc.from.bind(svc)` na criação. Desde a galeria, o
    // upload registra a linha-cópia em `imagens_loja` (via escopo.inserir) e o
    // log vai a `admin_acessos`; QUALQUER outra tabela é uso inesperado.
    from: (tabela: string) => {
      if (tabela !== "imagens_loja" && tabela !== "admin_acessos") {
        throw new Error(`uso inesperado de from("${tabela}") no upload admin`);
      }
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
          let fileBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
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
}

// ── next/cache: revalidatePath fora de request scope → mock no-op. A action
//    revalida as rotas admin no sucesso (revalidarLojaAdmin). ──────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS: default passa; negação via mockRejectedValueOnce. ─────
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. Prova que admin sobe service_role. ─
let serviceClient: ReturnType<typeof makeServiceClient>;
const createServiceClient = vi.fn(() => serviceClient);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// [galeria] Origem do recorte: tabela em memória respeitada pela query mockada.
type LinhaImagem = { id: string; loja_id: string; origem_id: string | null; remocao_pendente_em: string | null };
let imagens: LinhaImagem[];
const buscarOriginalDaLoja = vi.fn(
  async (_client: unknown, lojaId: string, id: string) =>
    imagens.find(
      (i) => i.id === id && i.loja_id === lojaId && i.origem_id === null && i.remocao_pendente_em === null,
    ) ?? null,
);
vi.mock("@/lib/supabase/queries/imagens", () => ({
  buscarOriginalDaLoja: (...a: unknown[]) =>
    buscarOriginalDaLoja(...(a as [unknown, string, string])),
  contarOriginaisDaLoja: vi.fn(),
  listarImagensDaLoja: vi.fn(),
  listarImagensDaLojaAdmin: vi.fn(),
}));

// 'use server' é só diretiva; o módulo é importável no runner node.
import { enviarFotoProdutoAdmin } from "./admin-upload";

// Literais do contrato da galeria (galeria-contrato.ts ainda não existe).
const CAMPO_ORIGEM = "origem_id";
const MSG_ORIGEM_REMOVIDA = "Essa imagem foi removida da galeria.";
const ORIGEM = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001"; // original da loja-alvo
const ORIGEM_ALHEIA = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002"; // original de outra loja
const ORIGEM_PENDENTE = "aaaaaaaa-aaaa-aaaa-aaaa-000000000003";

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
 * FormData com o arquivo no campo `file`, o `loja_id` informado e, desde a
 * galeria, o `origem_id` OBRIGATÓRIO (null = omitir).
 */
function fd(
  arquivo: Blob,
  lojaId: string | null = LOJA_ID,
  origemId: string | null = ORIGEM,
): FormData {
  const f = new FormData();
  f.append("file", arquivo);
  if (lojaId !== null) f.append("loja_id", lojaId);
  if (origemId !== null) f.append(CAMPO_ORIGEM, origemId);
  return f;
}

function insertsImagens(): Record<string, unknown>[] {
  return opsTabela
    .filter((o) => o.tabela === "imagens_loja")
    .flatMap((o) => o.chamadas.filter((c) => c.metodo === "insert"))
    .map((c) => c.args[0] as Record<string, unknown>);
}

function opEscrita(): UploadCall | undefined {
  return uploads[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  uploads = [];
  uploadResposta = { data: { path: "ok" }, error: null };
  publicUrlResposta = null;
  serviceClient = makeServiceClient();
  verificarAdminSaaS.mockResolvedValue(undefined);
  removes = [];
  opsTabela = [];
  respostaTabela = () => ({ data: null, error: null, count: 1 });
  imagens = [
    { id: ORIGEM, loja_id: LOJA_ID, origem_id: null, remocao_pendente_em: null },
    { id: ORIGEM_ALHEIA, loja_id: LOJA_OUTRA, origem_id: null, remocao_pendente_em: null },
    { id: ORIGEM_PENDENTE, loja_id: LOJA_ID, origem_id: null, remocao_pendente_em: "2026-10-06T12:00:00Z" },
  ];
});

describe("enviarFotoProdutoAdmin (Server Action admin — issue 090)", () => {
  // ── Caso 1: MIME FALSO (extensão png, magic bytes GIF) → rejeitado, ZERO upload ─
  it("caso 1 — ATAQUE: GIF disfarçado de image/png barrado por magic bytes, SEM upload", async () => {
    const r = await enviarFotoProdutoAdmin(fd(blob(GIF, { type: "image/png" })));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  // ── Caso 2: lojaId inválido (não-UUID) → rejeitado, ZERO upload, sem service_role ─
  it("caso 2 — lojaId não-UUID no FormData → REJEITADO, ZERO upload", async () => {
    const r = await enviarFotoProdutoAdmin(fd(blob(PNG), "nao-e-uuid"));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  it("caso 2b — lojaId ausente no FormData → REJEITADO, ZERO upload", async () => {
    const r = await enviarFotoProdutoAdmin(fd(blob(PNG), null));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
  });

  // ── Caso 3: admin não provado → exceção PROPAGA (fail-closed), ZERO upload ─────
  it("caso 3 — verificarAdminSaaS lança → a action REJEITA (propaga), ZERO upload", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));
    await expect(
      enviarFotoProdutoAdmin(fd(blob(PNG))),
    ).rejects.toThrow("acesso negado");
    expect(opEscrita()).toBeUndefined();
    // Fail-closed: o service client NUNCA é criado quando a prova de admin falha.
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  // ── Caso 4: sucesso → path server-side `${lojaId}/...`, bucket produtos, URL https ─
  it("caso 4 — sucesso: bucket produtos, path 1º segmento === lojaId, foto_url https", async () => {
    const r = await enviarFotoProdutoAdmin(fd(blob(PNG, { type: "image/png" })));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.foto_url).toMatch(/^https:\/\//);

    const op = opEscrita();
    expect(op).toBeDefined();
    expect(op?.bucket).toBe("produtos");
    // A amarra de isolamento sob service_role: 1º segmento do path === lojaId.
    expect((op?.path ?? "").split("/")[0]).toBe(LOJA_ID);
    expect((op?.path ?? "").startsWith("produtos/")).toBe(false);
  });

  // ── Caso 4b: path SEMPRE `${lojaId}/${uuid}.${ext}` — 2 segmentos, nome = UUID ──
  it("caso 4b — path = `${lojaId}/${uuid}.${ext}`: 2 segmentos, nome UUID, sem traversal", async () => {
    await enviarFotoProdutoAdmin(fd(blob(PNG)));
    const path = opEscrita()?.path ?? "";
    expect(path).not.toContain("..");
    const partes = path.split("/");
    expect(partes).toHaveLength(2);
    expect(partes[0]).toBe(LOJA_ID);
    const nome = (partes[1] ?? "").replace(/\.[a-z0-9]+$/i, "");
    expect(nome).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  // ── Caso 4c: MIME real prevalece — bytes JPEG com type mentido → .jpg + contentType ─
  it("caso 4c — MIME mentido (image/png) + bytes JPEG → tipo real (JPEG) prevalece: .jpg", async () => {
    const r = await enviarFotoProdutoAdmin(fd(blob(JPEG, { type: "image/png" })));
    expect(r.ok).toBe(true);
    const op = opEscrita();
    expect(op?.path).toMatch(/\.jpg$/);
    expect(op?.opts?.contentType).toBe("image/jpeg");
  });

  // ── Caso 5: o lojaId informado é o prefixo do path (nenhum outro segmento) ─────
  // Prova que o path é escopado pelo lojaId do FormData validado — sob service_role
  // gravar com prefixo de OUTRA loja vazaria o objeto para o namespace alheio.
  it("caso 5 — path escopado: contém o lojaId informado e não o de outra loja", async () => {
    await enviarFotoProdutoAdmin(fd(blob(PNG), LOJA_ID));
    const path = opEscrita()?.path ?? "";
    expect(path).toContain(LOJA_ID);
    expect(path).not.toContain(LOJA_OUTRA);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Fase RED — galeria de imagens (specs/galeria-imagens-loja.md, página 3 via
// admin, D2/D4, RN-G3). Mesma mudança do lojista: `origem_id` OBRIGATÓRIO,
// validado como original não pendente DA LOJA-ALVO antes de qualquer upload;
// linha-cópia registrada por `escopo.inserir` (loja_id injetado); compensação
// se o INSERT falha.
// ═════════════════════════════════════════════════════════════════════════════
describe("enviarFotoProdutoAdmin — origem_id obrigatório (galeria)", () => {
  it("sem origem_id → recusa, ZERO upload", async () => {
    const r = await enviarFotoProdutoAdmin(fd(blob(PNG), LOJA_ID, null));
    expect(r.ok).toBe(false);
    expect(opEscrita()).toBeUndefined();
    expect(insertsImagens()).toHaveLength(0);
  });

  it("ATAQUE: origem de OUTRA loja → MSG_ORIGEM_REMOVIDA, ZERO upload; consulta na loja-alvo via svc", async () => {
    const r = await enviarFotoProdutoAdmin(fd(blob(PNG), LOJA_ID, ORIGEM_ALHEIA));
    expect(r).toEqual({ ok: false, erro: MSG_ORIGEM_REMOVIDA });
    expect(opEscrita()).toBeUndefined();
    expect(buscarOriginalDaLoja).toHaveBeenCalledWith(serviceClient, LOJA_ID, ORIGEM_ALHEIA);
  });

  it("origem pendente → MSG_ORIGEM_REMOVIDA, ZERO upload", async () => {
    const r = await enviarFotoProdutoAdmin(fd(blob(PNG), LOJA_ID, ORIGEM_PENDENTE));
    expect(r).toEqual({ ok: false, erro: MSG_ORIGEM_REMOVIDA });
    expect(opEscrita()).toBeUndefined();
  });

  it("não-admin → PROPAGA antes de consultar a origem", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));
    await expect(enviarFotoProdutoAdmin(fd(blob(PNG)))).rejects.toThrow("acesso negado");
    expect(buscarOriginalDaLoja).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("feliz: linha-cópia em imagens_loja com loja_id da loja-alvo, origem_id e caminho do recorte", async () => {
    const r = await enviarFotoProdutoAdmin(fd(blob(PNG)));
    expect(r.ok).toBe(true);
    const path = opEscrita()?.path;
    const linhas = insertsImagens();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      loja_id: LOJA_ID,
      origem_id: ORIGEM,
      caminho: path,
      bytes: PNG.byteLength,
    });
  });

  it("INSERT da cópia falha → compensação remove([caminho]) e erro genérico", async () => {
    respostaTabela = (op) =>
      op.tabela === "imagens_loja" && op.chamadas.some((c) => c.metodo === "insert")
        ? { data: null, error: { message: "duplicate key imagens_loja_caminho_unico", code: "23505" } }
        : { data: null, error: null };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await enviarFotoProdutoAdmin(fd(blob(PNG)));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/imagens_loja|23505|duplicate/);
    expect(removes).toEqual([{ bucket: "produtos", caminhos: [opEscrita()?.path] }]);
    spy.mockRestore();
  });
});
