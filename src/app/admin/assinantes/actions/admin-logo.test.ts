import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 116 (crítica: SIM, red-first). Server Actions admin
 * `salvarLogoAdmin(formData)` e `removerLogoAdmin(lojaId)` em `./admin-logo` —
 * variante admin de salvar/remover a logo da loja-ALVO (`lojaId` da URL) sob
 * `service_role`, escopada por tenant. Núcleo de autorização do fix cross-tenant
 * (specs/fix-logo-admin-cross-tenant.md §Cenários de Teste).
 *
 * Por que é RED de verdade HOJE: o módulo `./admin-logo` AINDA NÃO EXISTE — a fase
 * GREEN (`executar`) o cria. O `import { salvarLogoAdmin, removerLogoAdmin } from
 * "./admin-logo"` falha a resolução do módulo → todo o arquivo quebra na coleta
 * (mesmo precedente de `logo.test.ts` na issue 003). Output real do FAIL anexado
 * na issue. Cada asserção abaixo descreve o COMPORTAMENTO/efeito que o corpo real
 * deve satisfazer.
 *
 * Invariante central sob service_role (seguranca.md §7 "Padrão admin"):
 *   o service client BYPASSA a RLS — a defesa NÃO é RLS. O gate é
 *   `verificarAdminSaaS()` (via `prepararContextoAdmin`, fora do try, fail-closed)
 *   + escopo por `lojaId` da URL (via `escopo.atualizarLoja` → `.eq("id", lojaId)`)
 *   + path de Storage montado SERVER-SIDE (`${lojaId}/logo/${uuid}.${ext}`). O
 *   `lojaId` da URL — NUNCA o auth do admin — é a única autoridade do escopo.
 *
 * Cenários cobertos (spec §Cenários de Teste — 3 é regressão do lojista, fora):
 *  1. Bug principal: admin salva logo em loja que NÃO é dele → sucesso; path
 *     escopado por `${lojaId}/logo/...` no bucket `produtos`; patch `{ logo_url }`
 *     apontando para o Storage, escopado `.eq("id", lojaId)`.
 *  2. Cross-tenant fechado: o ÚNICO UPDATE capturado escopa por `("id", lojaId)`
 *     da URL — nada é escrito em outra loja (o admin nunca informa a própria).
 *  4. `loja_id` ausente/não-UUID (salvar) e `lojaId` inválido (remover) →
 *     `{ ok:false }`, ZERO upload, `createServiceClient` NUNCA criado.
 *  5. Não-admin: `verificarAdminSaaS` lança → exceção PROPAGA (fail-closed), sem
 *     efeito colateral, service client nunca criado.
 *  6. Remoção: `removerLogoAdmin(lojaId)` zera `logo_url` SÓ na loja-alvo, escopado
 *     `.eq("id", lojaId)`, sem chamada ao storage.
 *  Extra: imagem falsa (magic bytes) → `{ ok:false }`, sem upload; `schemaStorageUrl`
 *     barra URL externa → `{ ok:false }`, sem UPDATE.
 *  (Cenário 7 — enforcement estático — é coberto pelo `enforcement-escopo-admin.test.ts`
 *   auto-descoberto por `readdirSync`; não se duplica aqui.)
 *
 * CONTRATO que o GREEN deve satisfazer (arquivo: admin-logo.ts):
 *   salvarLogoAdmin(formData: FormData): Promise<ResultadoSalvarLogo>
 *     - validarLojaIdAdmin(formData.get("loja_id")) ANTES de qualquer efeito
 *     - presença do arquivo em CAMPO_ARQUIVO (Blob não-vazio)
 *     - prepararContextoAdmin(lojaId) FORA do try (prova admin → service_role)
 *     - validarBlobImagem(file) DEPOIS da prova de admin
 *     - path `${lojaId}/logo/${crypto.randomUUID()}.${ext}` no bucket `produtos`
 *     - schemaStorageUrl.safeParse(publicUrl) ANTES do UPDATE
 *     - escopo.atualizarLoja({ logo_url }) (allowlist, .eq("id", lojaId))
 *     - registrarAcessoAdmin + revalidarLojaAdmin → { ok:true, logo_url }
 *   removerLogoAdmin(lojaId: string): Promise<ResultadoLogo>
 *     - validarLojaIdAdmin → prepararContextoAdmin FORA do try →
 *       escopo.atualizarLoja({ logo_url: null }) → { ok:true }
 */

// STORAGE_URL_PREFIX deriva de NEXT_PUBLIC_SUPABASE_URL (indefinida no runner).
// vi.hoisted roda ANTES dos imports ESM → storage.ts é avaliado com a base correta
// e getPublicUrl monta URLs de Storage VÁLIDAS no caminho feliz.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});

import { STORAGE_URL_PREFIX } from "@/lib/validacoes/storage";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";

// Loja-ALVO (vem do `lojaId` da URL). É a única autoridade do escopo.
const LOJA_ALVO = "33333333-3333-3333-3333-333333333333";
// Loja hipotética "do admin" — NUNCA deve receber escrita nesta action.
const LOJA_ADMIN = "44444444-4444-4444-4444-444444444444";

// ── Magic bytes reais (espelham ASSINATURAS de validarImagem.ts) ──────────────
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
// GIF "GIF89a" — NÃO reconhecido por validarMagicBytes: serve de imagem falsa.
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

// ── Captura de cada upload ao Storage feito pelo SERVICE client ───────────────
type UploadCall = {
  bucket: string;
  path: string;
  opts?: Record<string, unknown>;
};
let uploads: UploadCall[];
let uploadResposta: { data: unknown; error: unknown };
// null → getPublicUrl devolve URL de Storage derivada do path; string → injeta URL
// arbitrária (caso da URL externa).
let publicUrlResposta: string | null;

// ── Captura de cada UPDATE em `lojas` feito pelo escopo REAL (admin-loja.ts) ──
//    O `escopo` NÃO é mockado: `escopo.atualizarLoja(patch)` chama de verdade
//    `svc.from("lojas").update(patch, { count:"exact" }).eq("id", lojaId)`.
type UpdateRegistro = {
  patch: Record<string, unknown>;
  opts?: unknown;
  eqCol?: string;
  eqVal?: unknown;
};
let updates: UpdateRegistro[];
let erroUpdate: unknown;

// [galeria] linha do tempo das escritas, remove() de compensação e INSERTs da
// linha-cópia em imagens_loja.
let sequencia: string[];
let removes: { bucket: string; caminhos: string[] }[];
let insertsImagens: Record<string, unknown>[];
let insertResposta: { data: unknown; error: unknown };

function cadeiaResolvida(resposta: () => unknown): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
            Promise.resolve().then(resposta).then(ok, falha);
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}

function builderLojas() {
  return {
    update(patch: Record<string, unknown>, opts?: unknown) {
      const reg: UpdateRegistro = { patch, opts };
      updates.push(reg);
      sequencia.push("update:lojas");
      return {
        eq(col: string, val: unknown) {
          reg.eqCol = col;
          reg.eqVal = val;
          // PostgREST terminal: { data, error, count }. Os UPDATEs do alvo escopam
          // por uma única coluna id.
          return Promise.resolve({ data: null, error: erroUpdate, count: 1 });
        },
      };
    },
  };
}

// Service client combinando os DOIS modelos: `storage` (padrão admin-upload.test)
// + `from("lojas")` (padrão admin-perfil.test), porque salvarLogoAdmin faz storage
// E escopo.atualizarLoja.
function makeServiceClient() {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _file: unknown, opts?: Record<string, unknown>) => {
          uploads.push({ bucket, path, opts });
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
                : `${STORAGE_URL_PREFIX}${bucket}/${path}`,
          },
        }),
      }),
    },
    from(tabela: string) {
      if (tabela === "imagens_loja") {
        return {
          insert(linha: Record<string, unknown>) {
            insertsImagens.push(linha);
            sequencia.push("insert:imagens_loja");
            return cadeiaResolvida(() => insertResposta);
          },
        };
      }
      if (tabela === "admin_acessos") {
        return { insert: () => cadeiaResolvida(() => ({ data: null, error: null })) };
      }
      if (tabela !== "lojas") {
        throw new Error(`from() inesperado para tabela: ${tabela}`);
      }
      return builderLojas();
    },
  };
}

// ── next/cache: revalidatePath fora de request scope → mock no-op ─────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS: default passa; negação via mockRejectedValueOnce ──────
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. Prova que admin sobe service_role;
//    em rejeição/lojaId inválido NÃO deve ser chamado. ──────────────────────────
let serviceClient: ReturnType<typeof makeServiceClient>;
const createServiceClient = vi.fn(() => serviceClient);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// NOTA: admin-loja.ts (validarLojaIdAdmin, prepararContextoAdmin, escopo.atualizarLoja,
// registrarAcessoAdmin, revalidarLojaAdmin) e upload-imagem.ts (validarBlobImagem)
// NÃO são mockados — rodam de verdade, exatamente como em admin-perfil.test.ts.

// 'use server' é só diretiva; o módulo importa no runner node. HOJE o módulo NÃO
// EXISTE → a resolução falha e o arquivo quebra na coleta (RED).
// [galeria] origem do recorte (tabela em memória respeitada pela query mockada)
// e o processamento best-effort de pendentes depois do UPDATE.
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
const processarRemocoesPendentes = vi.fn();
vi.mock("@/lib/actions/galeria-pendentes", () => ({
  processarRemocoesPendentes: (...a: unknown[]) => processarRemocoesPendentes(...a),
}));

import { salvarLogoAdmin, removerLogoAdmin } from "./admin-logo";

// Literais do contrato da galeria (galeria-contrato.ts ainda não existe).
const CAMPO_ORIGEM = "origem_id";
const MSG_ORIGEM_REMOVIDA = "Essa imagem foi removida da galeria.";
const MSG_FOTO_REMOVIDA_DA_GALERIA = "A foto escolhida foi removida da galeria. Escolha outra.";
const MSG_TENTE_DE_NOVO = "Não foi possível salvar. Tente de novo.";
const ORIGEM = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const ORIGEM_ALHEIA = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002";
const ORIGEM_PENDENTE = "aaaaaaaa-aaaa-aaaa-aaaa-000000000003";

/** Blob com magic bytes + type; força size quando necessário. */
function blob(bytes: Uint8Array, over: { type?: string; size?: number } = {}): Blob {
  const b = new Blob([bytes as BlobPart], { type: over.type ?? "image/png" });
  if (over.size !== undefined) {
    Object.defineProperty(b, "size", { value: over.size });
  }
  return b;
}

/**
 * FormData com o arquivo no campo CAMPO_ARQUIVO, o `loja_id` informado e, desde
 * a galeria, o `origem_id` OBRIGATÓRIO (null = omitir).
 */
function fd(
  arquivo: Blob,
  lojaId: string | null = LOJA_ALVO,
  origemId: string | null = ORIGEM,
): FormData {
  const f = new FormData();
  f.append(CAMPO_ARQUIVO, arquivo);
  if (lojaId !== null) f.append("loja_id", lojaId);
  if (origemId !== null) f.append(CAMPO_ORIGEM, origemId);
  return f;
}

function opUpload(): UploadCall | undefined {
  return uploads[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  uploads = [];
  updates = [];
  uploadResposta = { data: { path: "ok" }, error: null };
  erroUpdate = null;
  publicUrlResposta = null;
  serviceClient = makeServiceClient();
  verificarAdminSaaS.mockResolvedValue(undefined);
  sequencia = [];
  removes = [];
  insertsImagens = [];
  insertResposta = { data: null, error: null };
  imagens = [
    { id: ORIGEM, loja_id: LOJA_ALVO, origem_id: null, remocao_pendente_em: null },
    { id: ORIGEM_ALHEIA, loja_id: LOJA_ADMIN, origem_id: null, remocao_pendente_em: null },
    { id: ORIGEM_PENDENTE, loja_id: LOJA_ALVO, origem_id: null, remocao_pendente_em: "2026-10-06T12:00:00Z" },
  ];
  processarRemocoesPendentes.mockResolvedValue(undefined);
});

// ───────── Caso 1: bug principal — admin salva logo em loja alheia ────────────
describe("salvarLogoAdmin — caso 1 (bug principal): admin salva logo da loja-alvo", () => {
  it("sucesso: upload em `${lojaId}/logo/<uuid>.<ext>` no bucket produtos + UPDATE { logo_url } escopado por id", async () => {
    const r = await salvarLogoAdmin(fd(blob(PNG, { type: "image/png" })));

    expect(r.ok).toBe(true);

    // Amarra de isolamento sob service_role: path montado server-side pela loja-alvo.
    const op = opUpload();
    expect(op).toBeDefined();
    expect(op?.bucket).toBe("produtos");
    expect((op?.path ?? "").startsWith("produtos/")).toBe(false);
    expect((op?.path ?? "").split("/")[0]).toBe(LOJA_ALVO);
    expect(op?.path).toMatch(
      /^33333333-3333-3333-3333-333333333333\/logo\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i,
    );

    // UPDATE allowlist { logo_url } na loja-alvo (via escopo.atualizarLoja).
    expect(updates).toHaveLength(1);
    const patch = updates[0].patch;
    expect(Object.keys(patch)).toEqual(["logo_url"]);
    expect(String(patch.logo_url).startsWith(STORAGE_URL_PREFIX)).toBe(true);
    expect(updates[0].eqCol).toBe("id");
    expect(updates[0].eqVal).toBe(LOJA_ALVO);

    // Retorno carrega a URL persistida.
    if (r.ok) expect(r.logo_url).toBe(patch.logo_url);
  });
});

// ───────── Caso 2: cross-tenant fechado ──────────────────────────────────────
describe("salvarLogoAdmin — caso 2: cross-tenant fechado (nenhuma escrita na loja do admin)", () => {
  it("o ÚNICO UPDATE escopa por ('id', lojaId) da URL — nunca por outra loja", async () => {
    await salvarLogoAdmin(fd(blob(PNG, { type: "image/png" })));

    // Exatamente um UPDATE, e ele é escopado à loja-alvo — não há segundo
    // from("lojas") com outro id (o path e o escopo saem só do lojaId da URL).
    expect(updates).toHaveLength(1);
    for (const u of updates) {
      expect(u.eqCol).toBe("id");
      expect(u.eqVal).toBe(LOJA_ALVO);
      expect(u.eqVal).not.toBe(LOJA_ADMIN);
    }
    // O path de storage também nunca vaza para o namespace de outra loja.
    expect(opUpload()?.path).not.toContain(LOJA_ADMIN);
  });
});

// ───────── Caso 4: lojaId inválido → zero efeito, sem service_role ────────────
describe("salvarLogoAdmin / removerLogoAdmin — caso 4: lojaId inválido", () => {
  it("salvar: loja_id não-UUID no FormData → { ok:false }, ZERO upload, service_role NÃO criado", async () => {
    const r = await salvarLogoAdmin(fd(blob(PNG), "nao-e-uuid"));
    expect(r.ok).toBe(false);
    expect(opUpload()).toBeUndefined();
    expect(updates).toHaveLength(0);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("salvar: loja_id ausente no FormData → { ok:false }, ZERO upload, service_role NÃO criado", async () => {
    const r = await salvarLogoAdmin(fd(blob(PNG), null));
    expect(r.ok).toBe(false);
    expect(opUpload()).toBeUndefined();
    expect(updates).toHaveLength(0);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("remover: lojaId inválido → { ok:false }, sem UPDATE, service_role NÃO criado", async () => {
    const r = await removerLogoAdmin("nao-e-uuid");
    expect(r.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

// ───────── Caso 5: não-admin → exceção propaga (fail-closed) ──────────────────
describe("salvarLogoAdmin / removerLogoAdmin — caso 5: não-admin (fail-closed, D-4)", () => {
  it("salvar: verificarAdminSaaS lança → REJEITA (propaga), ZERO upload, sem UPDATE, sem service_role", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));

    await expect(
      salvarLogoAdmin(fd(blob(PNG, { type: "image/png" }))),
    ).rejects.toThrow("Acesso negado.");

    expect(opUpload()).toBeUndefined();
    expect(updates).toHaveLength(0);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("remover: verificarAdminSaaS lança → REJEITA (propaga), sem UPDATE, sem service_role", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));

    await expect(removerLogoAdmin(LOJA_ALVO)).rejects.toThrow("Acesso negado.");

    expect(updates).toHaveLength(0);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

// ───────── Caso 6: remoção → zera logo_url só na loja-alvo ────────────────────
describe("removerLogoAdmin — caso 6: zera logo_url apenas na loja-alvo", () => {
  it("UPDATE { logo_url: null } escopado ('id', lojaId), SEM chamada ao storage", async () => {
    const r = await removerLogoAdmin(LOJA_ALVO);

    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ logo_url: null });
    expect(updates[0].eqCol).toBe("id");
    expect(updates[0].eqVal).toBe(LOJA_ALVO);
    // Remoção não sobe nem apaga objeto no storage.
    expect(opUpload()).toBeUndefined();
  });
});

// ───────── Extras de segurança do salvar ──────────────────────────────────────
describe("salvarLogoAdmin — extras de segurança", () => {
  it("imagem falsa (GIF disfarçado de image/png) → { ok:false }, SEM upload e SEM UPDATE", async () => {
    const r = await salvarLogoAdmin(fd(blob(GIF, { type: "image/png" })));
    expect(r.ok).toBe(false);
    expect(opUpload()).toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  it("arquivo ausente (sem campo file) → { ok:false }, SEM upload e SEM UPDATE", async () => {
    const semArquivo = new FormData();
    semArquivo.append("loja_id", LOJA_ALVO);
    const r = await salvarLogoAdmin(semArquivo);
    expect(r.ok).toBe(false);
    expect(opUpload()).toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  it("schemaStorageUrl barra URL externa (getPublicUrl fora do Storage) → { ok:false }, NÃO persiste", async () => {
    publicUrlResposta = "https://evil.com/storage/v1/object/public/produtos/x.png";
    const r = await salvarLogoAdmin(fd(blob(PNG, { type: "image/png" })));
    expect(r.ok).toBe(false);
    // O upload pode ter ocorrido, mas a URL externa JAMAIS pode ser persistida.
    expect(updates).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Fase RED — galeria de imagens (specs/galeria-imagens-loja.md, página 4 via
// admin, D2/D5, RN-G3/G20). Paridade com `salvarLogoLoja`: `origem_id`
// obrigatório validado na LOJA-ALVO, linha-cópia ANTES do UPDATE (via
// escopo.inserir), tradução do trigger/deadlock, pendentes depois do UPDATE.
// ═════════════════════════════════════════════════════════════════════════════
describe("salvarLogoAdmin — origem_id e linha-cópia (galeria)", () => {
  it("sem origem_id → recusa, SEM upload e SEM UPDATE", async () => {
    const r = await salvarLogoAdmin(fd(blob(PNG), LOJA_ALVO, null));
    expect(r.ok).toBe(false);
    expect(opUpload()).toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  it("ATAQUE: origem de outra loja → MSG_ORIGEM_REMOVIDA, SEM upload; consulta na loja-alvo via svc", async () => {
    const r = await salvarLogoAdmin(fd(blob(PNG), LOJA_ALVO, ORIGEM_ALHEIA));
    expect(r).toEqual({ ok: false, erro: MSG_ORIGEM_REMOVIDA });
    expect(opUpload()).toBeUndefined();
    expect(updates).toHaveLength(0);
    expect(buscarOriginalDaLoja).toHaveBeenCalledWith(serviceClient, LOJA_ALVO, ORIGEM_ALHEIA);
  });

  it("origem pendente → MSG_ORIGEM_REMOVIDA, SEM upload", async () => {
    const r = await salvarLogoAdmin(fd(blob(PNG), LOJA_ALVO, ORIGEM_PENDENTE));
    expect(r).toEqual({ ok: false, erro: MSG_ORIGEM_REMOVIDA });
    expect(opUpload()).toBeUndefined();
  });

  it("feliz: INSERT da cópia (loja-alvo, origem_id, caminho) ANTES do UPDATE lojas", async () => {
    const r = await salvarLogoAdmin(fd(blob(PNG)));
    expect(r.ok).toBe(true);
    expect(insertsImagens).toHaveLength(1);
    expect(insertsImagens[0]).toMatchObject({
      loja_id: LOJA_ALVO,
      origem_id: ORIGEM,
      caminho: opUpload()?.path,
    });
    const iInsert = sequencia.indexOf("insert:imagens_loja");
    expect(iInsert).toBeGreaterThanOrEqual(0);
    expect(sequencia.indexOf("update:lojas")).toBeGreaterThan(iInsert);
  });

  it("INSERT da cópia falha → remove([caminho]), SEM UPDATE, erro genérico", async () => {
    insertResposta = { data: null, error: { message: "duplicate key imagens_loja_caminho_unico", code: "23505" } };
    const r = await salvarLogoAdmin(fd(blob(PNG)));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/imagens_loja|23505|duplicate/);
    expect(updates).toHaveLength(0);
    expect(removes).toEqual([{ bucket: "produtos", caminhos: [opUpload()?.path] }]);
  });

  it("UPDATE recusado pelo trigger → MSG_FOTO_REMOVIDA_DA_GALERIA", async () => {
    erroUpdate = { code: "P0001", message: "imagem_fora_da_galeria" };
    const r = await salvarLogoAdmin(fd(blob(PNG)));
    expect(r).toEqual({ ok: false, erro: MSG_FOTO_REMOVIDA_DA_GALERIA });
  });

  it("UPDATE aborta por deadlock → MSG_TENTE_DE_NOVO", async () => {
    erroUpdate = { code: "40P01", message: "deadlock detected" };
    const r = await salvarLogoAdmin(fd(blob(PNG)));
    expect(r).toEqual({ ok: false, erro: MSG_TENTE_DE_NOVO });
  });

  it("depois do UPDATE processa pendentes da loja-alvo com o service client; falha não derruba", async () => {
    processarRemocoesPendentes.mockRejectedValue(new Error("storage fora do ar"));
    const r = await salvarLogoAdmin(fd(blob(PNG)));
    expect(processarRemocoesPendentes).toHaveBeenCalledWith(serviceClient, LOJA_ALVO);
    expect(r.ok).toBe(true);
  });
});

describe("removerLogoAdmin — pendentes (galeria)", () => {
  it("depois do UPDATE processa pendentes da loja-alvo; falha não derruba", async () => {
    processarRemocoesPendentes.mockRejectedValue(new Error("storage fora do ar"));
    const r = await removerLogoAdmin(LOJA_ALVO);
    expect(processarRemocoesPendentes).toHaveBeenCalledWith(serviceClient, LOJA_ALVO);
    expect(r.ok).toBe(true);
  });
});
