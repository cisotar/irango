import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 094 (crítica: SIM, red-first). Server Actions admin de
 * formas de pagamento (incl. CHAVE PIX sensível) + QR Pix em
 * `./admin-pagamento`, escopadas pela loja-alvo (`lojaId` explícito da URL admin)
 * sob service_role.
 *
 * Por que é RED de verdade HOJE: o módulo existe como STUB — cada action LANÇA
 * "TODO: GREEN". Os imports resolvem (type-check passa), mas toda invocação
 * rejeita/lança → cada asserção de comportamento falha. A fase GREEN (`executar`)
 * implementa o corpo. Output FAIL anexado na issue 094.
 *
 * Invariantes provadas (spec admin-onboarding-assistido.md RN-1/2/3 + seguranca.md
 * §10/§13/§21):
 *  - CROSS-LOJA: editar/remover/QR de OUTRA loja → escopo `eq("loja_id", lojaId)`
 *    (+ `eq("id", id)`) é a ÚNICA amarra sob service_role (RLS não protege). O
 *    `lojaId` gravado vem da URL admin, NUNCA do payload.
 *  - upload QR Pix: MIME falso → rejeitado por validarBlobImagem (magic bytes);
 *    path SEMPRE sob `${lojaId}/...` montado server-side, bucket `pix-qr`.
 *  - admin não provado (verificarAdminSaaS lança) → exceção PROPAGA, fail-closed:
 *    nenhum service client / insert / update / delete / upload roda.
 *  - lojaId inválido → { ok:false } SEM tocar admin/service.
 *  - chave Pix sensível: sucesso grava a forma (incl. chave) na loja-alvo; a chave
 *    NUNCA é logada em cru em console.* (§21).
 *
 * CONTRATO que o GREEN deve satisfazer (assinaturas no STUB):
 *   salvarFormaPagamentoAdmin(lojaId, payload): Promise<ResultadoPagamentoAdmin>
 *   atualizarFormaPagamentoAdmin(lojaId, id, payload): Promise<ResultadoPagamentoAdmin>
 *   removerFormaPagamentoAdmin(lojaId, id): Promise<ResultadoPagamentoAdmin>
 *   salvarQrPixAdmin(lojaId, formaId, pixQrUrl): Promise<ResultadoPagamentoAdmin>
 *   enviarQrPixAdmin(formData): Promise<ResultadoQrPixAdmin>
 */

// STORAGE_URL_PREFIX deriva de NEXT_PUBLIC_SUPABASE_URL (indefinida no runner).
// vi.hoisted roda ANTES dos imports ESM → storage.ts avalia com a base correta.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});

import { STORAGE_URL_PREFIX } from "@/lib/validacoes/storage";

const LOJA_ALVO = "11111111-1111-1111-1111-111111111111"; // loja da URL admin
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja de outro dono
const FORMA_ID = "33333333-3333-3333-3333-333333333333";

// Chave Pix sensível — usada para provar gravação na loja-alvo E ausência em log cru.
const CHAVE_PIX_SENSIVEL = "12345678901"; // CPF (11 dígitos)

// ── next/cache: revalidatePath fora de request scope → mock. ──────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS: prova de admin. Default passa; negação via mockRejected. ─
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── validarBlobImagem: helper puro de magic bytes. Default = imagem válida;
//    teste de MIME falso sobrescreve com { ok:false }. ─────────────────────────
const validarBlobImagem = vi.fn();
vi.mock("@/lib/actions/upload-imagem", () => ({
  validarBlobImagem: (...a: unknown[]) => validarBlobImagem(...a),
}));

// ── createServiceClient: server-only → mock. Captura insert/update/delete + eq
//    encadeados e os uploads ao Storage. Respostas controláveis por teste. ──────
type InsertCall = { tabela: string; valores: Record<string, unknown> };
type UpdateCall = { tabela: string; patch: Record<string, unknown>; eqs: [string, unknown][] };
type DeleteCall = { tabela: string; eqs: [string, unknown][] };
type SelectCall = { tabela: string; eqs: [string, unknown][] };
type UploadCall = { bucket: string; path: string; opts?: Record<string, unknown> };

let insertCalls: InsertCall[];
let updateCalls: UpdateCall[];
let deleteCalls: DeleteCall[];
let selectCalls: SelectCall[];
let uploadCalls: UploadCall[];

// Respostas controláveis.
let insertResposta: { error: unknown };
let updateResposta: { error: unknown };
let deleteResposta: { error: unknown };
let selectResposta: { data: unknown; error: unknown }; // p/ leitura de config atual (merge)
let uploadResposta: { data: unknown; error: unknown };

// Builder de UPDATE/DELETE/SELECT: acumula .eq() e resolve a resposta ao await.
function chainAlvo(
  kind: "update" | "delete" | "select",
  registro: UpdateCall | DeleteCall | SelectCall,
  resposta: { error: unknown } | { data: unknown; error: unknown },
) {
  const builder = {
    eq(coluna: string, valor: unknown) {
      (registro as { eqs: [string, unknown][] }).eqs.push([coluna, valor]);
      return builder;
    },
    // SELECT usa maybeSingle no molde de pagamento.ts.
    maybeSingle() {
      return Promise.resolve(resposta);
    },
    then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
      return Promise.resolve(resposta).then(onF, onR);
    },
  };
  return builder;
}

const clientServico = {
  from(tabela: string) {
    return {
      insert(valores: Record<string, unknown>) {
        insertCalls.push({ tabela, valores });
        return Promise.resolve(insertResposta);
      },
      update(patch: Record<string, unknown>) {
        const reg: UpdateCall = { tabela, patch, eqs: [] };
        updateCalls.push(reg);
        return chainAlvo("update", reg, updateResposta);
      },
      delete() {
        const reg: DeleteCall = { tabela, eqs: [] };
        deleteCalls.push(reg);
        return chainAlvo("delete", reg, deleteResposta);
      },
      select(_cols?: string) {
        const reg: SelectCall = { tabela, eqs: [] };
        selectCalls.push(reg);
        return chainAlvo("select", reg, selectResposta);
      },
    };
  },
  storage: {
    from(bucket: string) {
      return {
        upload: async (path: string, _buf: unknown, opts?: Record<string, unknown>) => {
          uploadCalls.push({ bucket, path, opts });
          return uploadResposta;
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `${STORAGE_URL_PREFIX}${bucket}/${path}` },
        }),
      };
    },
  },
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// 'use server' é só diretiva; o módulo é importável no runner node. As actions
// existem como STUB (lançam "TODO: GREEN") → RED por asserção.
import {
  salvarFormaPagamentoAdmin,
  atualizarFormaPagamentoAdmin,
  removerFormaPagamentoAdmin,
  salvarQrPixAdmin,
  enviarQrPixAdmin,
} from "./admin-pagamento";

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls = [];
  updateCalls = [];
  deleteCalls = [];
  selectCalls = [];
  uploadCalls = [];
  // Defaults do caminho feliz; cada teste sobrescreve o que precisa.
  verificarAdminSaaS.mockResolvedValue(undefined);
  insertResposta = { error: null };
  updateResposta = { error: null };
  deleteResposta = { error: null };
  // SELECT de config atual (merge no update/QR): uma forma pix com a chave.
  selectResposta = {
    data: { config: { tipo_chave: "cpf", chave: CHAVE_PIX_SENSIVEL } },
    error: null,
  };
  uploadResposta = { data: { path: "ok" }, error: null };
  // Imagem válida por padrão (PNG). Teste de MIME falso sobrescreve.
  validarBlobImagem.mockResolvedValue({
    ok: true,
    buffer: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    tipoReal: "image/png",
    ext: "png",
  });
});

// Forma pix válida com chave sensível (CPF).
function payloadPixValido() {
  return {
    tipo: "pix",
    config: { tipo_chave: "cpf", chave: CHAVE_PIX_SENSIVEL },
  };
}

// ─────────── Caso 5: lojaId inválido → rejeitado SEM admin/service ───────────
describe("salvarFormaPagamentoAdmin — validação de lojaId (083)", () => {
  it("lojaId não-UUID → { ok:false } SEM tocar admin/service/insert", async () => {
    const r = await salvarFormaPagamentoAdmin("nao-e-uuid", payloadPixValido());

    expect(r).toMatchObject({ ok: false });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });
});

// ─────────── Caso 3: admin não provado → exceção propaga, zero efeito ────────
describe("salvarFormaPagamentoAdmin — fail-closed quando admin é negado (D-4)", () => {
  it("verificarAdminSaaS lança → action REJEITA (propaga) e NÃO toca service/insert", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(
      salvarFormaPagamentoAdmin(LOJA_ALVO, payloadPixValido()),
    ).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });
});

// ─────────── Caso 4: sucesso grava forma (incl. chave Pix) na loja-alvo ──────
describe("salvarFormaPagamentoAdmin — sucesso grava na loja-alvo", () => {
  it("INSERT com loja_id = lojaId da URL (NUNCA do payload) e chave Pix preservada", async () => {
    const r = await salvarFormaPagamentoAdmin(LOJA_ALVO, payloadPixValido());

    expect(r).toEqual({ ok: true });
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(insertCalls).toHaveLength(1);

    const { tabela, valores } = insertCalls[0];
    expect(tabela).toBe("formas_pagamento");
    // loja_id é o da URL admin, jamais derivado/forjado por payload.
    expect(valores.loja_id).toBe(LOJA_ALVO);
    expect(valores.tipo).toBe("pix");
    // A chave Pix sensível chegou ao banco escopada à loja-alvo.
    expect(valores.config).toMatchObject({
      tipo_chave: "cpf",
      chave: CHAVE_PIX_SENSIVEL,
    });

    expect(revalidatePath).toHaveBeenCalled();
  });

  it("lojaId no payload é IGNORADO — loja_id gravado é o argumento, não o injetado", async () => {
    // Atacante injeta loja_id alheio no payload; o escopo é o argumento.
    const payloadComLojaInjetada = {
      ...payloadPixValido(),
      loja_id: LOJA_OUTRA,
    };

    await salvarFormaPagamentoAdmin(LOJA_ALVO, payloadComLojaInjetada);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].valores.loja_id).toBe(LOJA_ALVO);
    expect(insertCalls[0].valores.loja_id).not.toBe(LOJA_OUTRA);
  });
});

// ─────────── Caso §21: chave Pix NUNCA logada em cru ─────────────────────────
describe("salvarFormaPagamentoAdmin — chave Pix não vaza em log (§21)", () => {
  it("erro de INSERT → nenhum console.* recebe a chave Pix em cru", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    insertResposta = { error: { message: "db down" } };

    const r = await salvarFormaPagamentoAdmin(LOJA_ALVO, payloadPixValido());

    expect(r).toMatchObject({ ok: false });
    // A chave sensível não pode aparecer em NENHUMA chamada de log.
    for (const spy of [erro, log, warn]) {
      for (const call of spy.mock.calls) {
        const serial = JSON.stringify(call);
        expect(serial).not.toContain(CHAVE_PIX_SENSIVEL);
      }
    }
    erro.mockRestore();
    log.mockRestore();
    warn.mockRestore();
  });
});

// ── CROSS-LOJA no SELECT de configAtualDaForma: escopo loja_id obrigatório ─────
// configAtualDaForma lê a config atual para fazer merge antes de gravar o UPDATE.
// Sob service_role, sem eq("loja_id"), a config de OUTRA loja poderia ser lida e
// mesclada na gravação — vazamento de dados cross-loja mesmo que o UPDATE esteja
// escopado. Esse teste é letal: se o eq("loja_id") for removido do SELECT, o
// selectCalls[0].eqs não conterá a entrada e o expect abaixo falhará.
describe("atualizarFormaPagamentoAdmin — escopo cross-loja no SELECT de configAtualDaForma", () => {
  it("SELECT da config atual também escopado por eq('loja_id', lojaId) E eq('id', formaId)", async () => {
    await atualizarFormaPagamentoAdmin(LOJA_ALVO, FORMA_ID, payloadPixValido());

    // Pelo menos um SELECT deve ter ocorrido (configAtualDaForma).
    expect(selectCalls.length).toBeGreaterThanOrEqual(1);
    const selConfig = selectCalls.find((s) => s.tabela === "formas_pagamento");
    expect(selConfig).toBeDefined();
    // Ambos os escopos obrigatórios: isolamento de loja E de registro.
    expect(selConfig!.eqs).toContainEqual(["loja_id", LOJA_ALVO]);
    expect(selConfig!.eqs).toContainEqual(["id", FORMA_ID]);
    // Nunca lê com escopo de outra loja.
    expect(selConfig!.eqs).not.toContainEqual(["loja_id", LOJA_OUTRA]);
  });
});

// ─────────── Caso 1: CROSS-LOJA no UPDATE (atualizar de outra loja) ──────────
describe("atualizarFormaPagamentoAdmin — escopo cross-loja", () => {
  it("UPDATE escopado por eq('loja_id', lojaId) E eq('id', id) — bloqueia outra loja", async () => {
    const r = await atualizarFormaPagamentoAdmin(LOJA_ALVO, FORMA_ID, payloadPixValido());

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    const { tabela, eqs } = updateCalls[0];
    expect(tabela).toBe("formas_pagamento");
    // Ambos os escopos presentes: a única amarra de isolamento sob service_role.
    expect(eqs).toContainEqual(["loja_id", LOJA_ALVO]);
    expect(eqs).toContainEqual(["id", FORMA_ID]);
    // E o escopo NÃO usa a loja alheia.
    expect(eqs).not.toContainEqual(["loja_id", LOJA_OUTRA]);
  });
});

// ─────────── Caso 1: CROSS-LOJA no DELETE (remover de outra loja) ────────────
describe("removerFormaPagamentoAdmin — escopo cross-loja", () => {
  it("DELETE escopado por eq('loja_id', lojaId) E eq('id', id) — bloqueia outra loja", async () => {
    const r = await removerFormaPagamentoAdmin(LOJA_ALVO, FORMA_ID);

    expect(r).toEqual({ ok: true });
    expect(deleteCalls).toHaveLength(1);
    const { tabela, eqs } = deleteCalls[0];
    expect(tabela).toBe("formas_pagamento");
    expect(eqs).toContainEqual(["loja_id", LOJA_ALVO]);
    expect(eqs).toContainEqual(["id", FORMA_ID]);
    expect(eqs).not.toContainEqual(["loja_id", LOJA_OUTRA]);
  });

  it("admin negado → exceção propaga, NENHUM delete roda (fail-closed)", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(
      removerFormaPagamentoAdmin(LOJA_ALVO, FORMA_ID),
    ).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(deleteCalls).toHaveLength(0);
  });
});

// ─────────── Caso 1: CROSS-LOJA no salvarQrPixAdmin (gravar URL) ─────────────
describe("salvarQrPixAdmin — escopo cross-loja no UPDATE", () => {
  it("UPDATE da URL escopado por eq('loja_id', lojaId) E eq('id', formaId)", async () => {
    const url = `${STORAGE_URL_PREFIX}pix-qr/${LOJA_ALVO}/qr.png`;

    const r = await salvarQrPixAdmin(LOJA_ALVO, FORMA_ID, url);

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    const { eqs } = updateCalls[0];
    expect(eqs).toContainEqual(["loja_id", LOJA_ALVO]);
    expect(eqs).toContainEqual(["id", FORMA_ID]);
  });

  it("URL externa (fora do Storage do iRango) → { ok:false }, NÃO grava", async () => {
    const r = await salvarQrPixAdmin(
      LOJA_ALVO,
      FORMA_ID,
      "https://evil.example.com/qr.png",
    );

    expect(r).toMatchObject({ ok: false });
    expect(updateCalls).toHaveLength(0);
  });
});

// ─────────── Caso 2: upload QR Pix — MIME falso + path server-side ───────────
describe("enviarQrPixAdmin — upload QR Pix", () => {
  function formDataComArquivo(extra?: Record<string, string>) {
    const fd = new FormData();
    fd.set("loja_id", LOJA_ALVO);
    // Blob não-vazio; o conteúdo real é decidido pelo mock de validarBlobImagem.
    fd.set("file", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]), "qr.png");
    if (extra) for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  }

  it("MIME falso (validarBlobImagem ok:false) → rejeitado, NENHUM upload", async () => {
    validarBlobImagem.mockResolvedValueOnce({
      ok: false,
      erro: "Conteúdo do arquivo não é uma imagem válida.",
    });

    const r = await enviarQrPixAdmin(formDataComArquivo());

    expect(r).toMatchObject({ ok: false });
    expect(uploadCalls).toHaveLength(0);
  });

  it("sucesso: path SEMPRE sob `${lojaId}/...` no bucket pix-qr, montado server-side", async () => {
    const r = await enviarQrPixAdmin(formDataComArquivo());

    expect(r).toMatchObject({ ok: true });
    expect(uploadCalls).toHaveLength(1);
    const { bucket, path } = uploadCalls[0];
    expect(bucket).toBe("pix-qr");
    // O 1º segmento do path é a loja-alvo — única amarra de isolamento (RLS de
    // bucket não protege sob service_role).
    expect(path.startsWith(`${LOJA_ALVO}/`)).toBe(true);
    // A URL devolvida é do Storage do iRango.
    if (r.ok) expect(r.pix_qr_url.startsWith(STORAGE_URL_PREFIX)).toBe(true);
  });

  it("path NUNCA usa loja injetada via campo extra do FormData", async () => {
    // FormData "loja_alvo" alheio NÃO deve mudar o path; só o loja_id validado conta.
    const fd = new FormData();
    fd.set("loja_id", LOJA_ALVO);
    fd.set("pasta", LOJA_OUTRA); // ruído malicioso
    fd.set("file", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]), "qr.png");

    await enviarQrPixAdmin(fd);

    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].path.startsWith(`${LOJA_OUTRA}/`)).toBe(false);
    expect(uploadCalls[0].path.startsWith(`${LOJA_ALVO}/`)).toBe(true);
  });

  it("admin negado → exceção propaga, NENHUM upload (fail-closed)", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(enviarQrPixAdmin(formDataComArquivo())).rejects.toThrow(
      "acesso negado",
    );

    expect(uploadCalls).toHaveLength(0);
  });
});
