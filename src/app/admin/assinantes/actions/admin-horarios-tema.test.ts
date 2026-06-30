import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 091 (crítica: SIM). Server Actions admin
 * `salvarHorariosAdmin(lojaId, payload)` e `salvarTemaAdmin(lojaId, payload)` em
 * `./admin-horarios-tema`. Variantes admin de `salvarHorarios`/`salvarTema`
 * (molde: src/lib/actions/loja.ts) que gravam jsonb na LOJA-ALVO por `lojaId`
 * explícito, escopadas à mão pelo `eq("id", lojaId)` sob service_role.
 *
 * Por que é RED de verdade HOJE: o módulo `./admin-horarios-tema` exporta apenas
 * um STUB que lança `"TODO: GREEN"`. Toda asserção de comportamento (validação,
 * fail-closed, escopo, gravação) FALHA porque a action ainda não faz nada útil.
 * Output `FAIL` real anexado na issue 091.
 *
 * Invariantes provadas (issue 091, specs/admin-onboarding-assistido.md):
 *  - Caso 1 — admin não provado (fail-closed D-4): `verificarAdminSaaS()` lança →
 *    a exceção PROPAGA (não vira `{ ok:false }`) e NENHUM update roda. Zero efeito.
 *  - Caso 2 — `lojaId` inválido (não-UUID) → `{ ok:false }`, sem tocar
 *    admin/service/update.
 *  - Caso 3 — payload malformado (horário/tema reprovado por zod) → `{ ok:false }`,
 *    sem update (validação ANTES de qualquer I/O).
 *  - Caso 4 — CROSS-LOJA/escopo: o UPDATE inclui `.eq("id", lojaId)` da loja-alvo
 *    e SOMENTE dela. Sob service_role (BYPASSRLS) sem o WHERE escopado, o PostgREST
 *    recusaria o UPDATE e a RLS não conteria — por isso o `eq("id", lojaId)` é
 *    obrigatório e não pode escopar outra loja.
 *  - Caso 5 — sucesso: grava o jsonb correto (`{ horarios }` / `{ tema }`) na
 *    loja-alvo → `{ ok:true }`.
 *
 * CONTRATO que o GREEN deve satisfazer (arquivo:
 *   src/app/admin/assinantes/actions/admin-horarios-tema.ts):
 *     salvarHorariosAdmin(lojaId: string, payload: unknown):
 *       Promise<{ ok:true } | { ok:false; erro:string }>
 *     salvarTemaAdmin(lojaId: string, payload: unknown):
 *       Promise<{ ok:true } | { ok:false; erro:string }>
 *   Ordem por action: validar lojaId → validar payload (zod) → verificarAdminSaaS()
 *   → createServiceClient → from("lojas").update({ horarios|tema }).eq("id", lojaId).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";

// Payloads VÁLIDOS (paridade com schemaHorarios/schemaTema — src/lib/validacoes/loja.ts).
const HORARIOS_OK = {
  seg: { abre: "09:00", fecha: "18:00", ativo: true },
  ter: { abre: "09:00", fecha: "18:00", ativo: true },
  qua: { abre: "09:00", fecha: "18:00", ativo: true },
  qui: { abre: "09:00", fecha: "18:00", ativo: true },
  sex: { abre: "09:00", fecha: "18:00", ativo: true },
  sab: { abre: "10:00", fecha: "14:00", ativo: true },
  dom: { abre: "00:00", fecha: "00:00", ativo: false },
};
const TEMA_OK = { primaria: "#ff0000", fundo: "#ffffff", destaque: "#00ff00" };

// ── next/cache: revalidatePath fora de request scope → mock no-op. ────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS: prova de admin. Default passa; negação via
//    mockRejectedValueOnce. ────────────────────────────────────────────────────
const ordemChamadas: string[] = [];
const verificarAdminSaaS = vi.fn(async () => {
  ordemChamadas.push("verificarAdminSaaS");
});
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient encadeável: .from(table).update(patch).eq(col, val).
//    Captura cada UPDATE para asserir patch e escopo. .eq() resolve { error:null }.
type UpdateCall = { table: string; patch: unknown; eqCol?: string; eqVal?: unknown };
const updateCalls: UpdateCall[] = [];
let eqResultado: { error: unknown } = { error: null };

const clientServico = {
  from(table: string) {
    return {
      update(patch: unknown) {
        const call: UpdateCall = { table, patch };
        updateCalls.push(call);
        return {
          eq(col: string, val: unknown) {
            call.eqCol = col;
            call.eqVal = val;
            return Promise.resolve(eqResultado);
          },
        };
      },
    };
  },
};
const createServiceClient = vi.fn(() => {
  ordemChamadas.push("createServiceClient");
  return clientServico;
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// 'use server' é só diretiva; o módulo é importável no runner node. As actions
// hoje são STUB que lança "TODO: GREEN" → todo comportamento abaixo é RED.
import {
  salvarHorariosAdmin,
  salvarTemaAdmin,
} from "./admin-horarios-tema";

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
  updateCalls.length = 0;
  eqResultado = { error: null };
  verificarAdminSaaS.mockImplementation(async () => {
    ordemChamadas.push("verificarAdminSaaS");
  });
});

// ───────── Caso 1: admin não provado → exceção propaga, zero efeito ──────────
describe("admin não provado (fail-closed D-4)", () => {
  it("salvarHorariosAdmin: verificarAdminSaaS lança → REJEITA e NÃO faz update", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(salvarHorariosAdmin(LOJA_ID, HORARIOS_OK)).rejects.toThrow(
      "acesso negado",
    );

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("salvarTemaAdmin: verificarAdminSaaS lança → REJEITA e NÃO faz update", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(salvarTemaAdmin(LOJA_ID, TEMA_OK)).rejects.toThrow(
      "acesso negado",
    );

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

// ──────────── Caso 2: lojaId inválido (não-UUID) → rejeitado ─────────────────
describe("lojaId inválido", () => {
  it("salvarHorariosAdmin: lojaId não-UUID → { ok:false } sem admin/service/update", async () => {
    const r = await salvarHorariosAdmin("nao-e-uuid", HORARIOS_OK);

    expect(r.ok).toBe(false);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("salvarTemaAdmin: lojaId não-UUID → { ok:false } sem admin/service/update", async () => {
    const r = await salvarTemaAdmin("nao-e-uuid", TEMA_OK);

    expect(r.ok).toBe(false);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

// ─────────── Caso 3: payload malformado (zod reprova) → { ok:false } ─────────
describe("payload inválido (zod)", () => {
  it("salvarHorariosAdmin: horário malformado (abre não-HH:MM) → { ok:false } sem update", async () => {
    const horariosRuins = { ...HORARIOS_OK, seg: { abre: "9h", fecha: "18:00", ativo: true } };

    const r = await salvarHorariosAdmin(LOJA_ID, horariosRuins);

    expect(r.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  it("salvarHorariosAdmin: chave extra (.strict) → { ok:false } sem update", async () => {
    const horariosExtra = { ...HORARIOS_OK, dono_id: "x" };

    const r = await salvarHorariosAdmin(LOJA_ID, horariosExtra);

    expect(r.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  it("salvarTemaAdmin: cor sem # (hex inválido) → { ok:false } sem update", async () => {
    const temaRuim = { ...TEMA_OK, primaria: "ff0000" };

    const r = await salvarTemaAdmin(LOJA_ID, temaRuim);

    expect(r.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  it("salvarTemaAdmin: chave extra (.strict) → { ok:false } sem update", async () => {
    const temaExtra = { ...TEMA_OK, ativo: true };

    const r = await salvarTemaAdmin(LOJA_ID, temaExtra);

    expect(r.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });
});

// ───── Caso 4: CROSS-LOJA / escopo — UPDATE escopado por eq("id", lojaId) ─────
describe("escopo cross-loja (RN-3: eq('id', lojaId) obrigatório)", () => {
  it("salvarHorariosAdmin: UPDATE escopa a loja-alvo (eq id = lojaId), nunca outra", async () => {
    const r = await salvarHorariosAdmin(LOJA_ID, HORARIOS_OK);

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0];
    expect(call.table).toBe("lojas");
    // Escopo obrigatório: WHERE id = lojaId da loja-alvo.
    expect(call.eqCol).toBe("id");
    expect(call.eqVal).toBe(LOJA_ID);
    // Não pode tocar outra loja.
    expect(call.eqVal).not.toBe(OUTRA_LOJA);
  });

  it("salvarTemaAdmin: UPDATE escopa a loja-alvo (eq id = lojaId), nunca outra", async () => {
    const r = await salvarTemaAdmin(LOJA_ID, TEMA_OK);

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0];
    expect(call.table).toBe("lojas");
    expect(call.eqCol).toBe("id");
    expect(call.eqVal).toBe(LOJA_ID);
    expect(call.eqVal).not.toBe(OUTRA_LOJA);
  });

  it("escopa a loja-alvo passada, mesmo quando há OUTRA_LOJA no sistema", async () => {
    await salvarHorariosAdmin(OUTRA_LOJA, HORARIOS_OK);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].eqVal).toBe(OUTRA_LOJA);
  });
});

// ────────── Caso 5: sucesso grava jsonb (horarios/tema) na loja-alvo ─────────
describe("sucesso grava jsonb na loja-alvo", () => {
  it("salvarHorariosAdmin: prova admin ANTES de elevar, grava { horarios } → { ok:true }", async () => {
    const r = await salvarHorariosAdmin(LOJA_ID, HORARIOS_OK);

    expect(r).toEqual({ ok: true });
    // Ordem fail-closed: prova admin antes do service_role.
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
    expect(updateCalls[0].patch).toEqual({ horarios: HORARIOS_OK });
  });

  it("salvarTemaAdmin: grava { tema } → { ok:true }", async () => {
    const r = await salvarTemaAdmin(LOJA_ID, TEMA_OK);

    expect(r).toEqual({ ok: true });
    expect(updateCalls[0].patch).toEqual({ tema: TEMA_OK });
  });

  it("erro do banco no UPDATE → { ok:false } (não vaza, não estoura)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    eqResultado = { error: { message: "db down" } };

    const r = await salvarTemaAdmin(LOJA_ID, TEMA_OK);

    expect(r.ok).toBe(false);
    spy.mockRestore();
  });
});
