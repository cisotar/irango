import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 087 (crítica: SIM). Server Action `criarLojaAdmin(payload)`
 * em `./actions` (admin do SaaS cria uma loja em nome de um lojista).
 *
 * Por que é RED de verdade HOJE: `criarLojaAdmin` existe apenas como STUB que lança
 * `Error("TODO: GREEN")` — sem nenhuma lógica de produção. Cada teste abaixo asserta
 * o COMPORTAMENTO esperado (retorno/ordem/efeitos); contra o stub, ou a chamada
 * rejeita com "TODO: GREEN" (onde se esperava `{ ok:... }`) ou a asserção de efeito
 * falha (nenhuma query foi chamada). A fase GREEN (`executar`) escreve o corpo real.
 *
 * Invariantes provadas (spec admin-onboarding-assistido §"Criar Loja para Cliente",
 * RN-4/RN-5 + escopo da issue 087):
 *  - D-4/fail-closed: `verificarAdminSaaS()` lança ANTES de qualquer efeito → a
 *    exceção PROPAGA (não vira `{ ok:false }` amigável); NENHUM INSERT roda.
 *  - e-mail sem usuário (`resolverDonoPorEmail` → null) → `{ ok:false }`, zero INSERT.
 *  - dono já tem loja → `criarLoja` lança violação de índice único `lojas(dono_id)`
 *    (23505) → `{ ok:false }`, nenhuma 2ª loja persiste.
 *  - slug ocupado (`slugExiste` → true) → `{ ok:false }`, zero INSERT.
 *  - sucesso → `criarLoja` chamado com `dono_id` = o RESOLVIDO server-side,
 *    `ativo=false`, `assinatura_status='trial'`, `consentimento_em` preenchido,
 *    `consentimento_versao=VERSAO_TERMOS`; retorna `{ ok:true, lojaId }`.
 *  - segurança: payload hostil (`ativo:true`, `assinatura_status:'ativa'`, `dono_id`
 *    forjado) é IGNORADO — esses campos vêm de constantes server-side; o e-mail
 *    NUNCA é logado em cru.
 *
 * CONTRATO que o GREEN deve satisfazer:
 *   criarLojaAdmin(payload: unknown):
 *     Promise<{ ok:true; lojaId:string } | { ok:false; erro:string }>
 *   em src/app/admin/assinantes/actions.ts
 */

import { VERSAO_TERMOS } from "@/lib/constants/termos";

const DONO_ID = "22222222-2222-2222-2222-222222222222";
const LOJA_ID = "33333333-3333-3333-3333-333333333333";
const EMAIL = "lojista@exemplo.com";
const SLUG = "pizzaria-do-ze";
const NOME = "Pizzaria do Zé";

const payloadValido = () => ({ email: EMAIL, nome: NOME, slug: SLUG });

// ── next/cache: revalidatePath fora de request scope → mock. ──────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS: prova de admin. Default passa; negação via
//    mockRejectedValueOnce. (compartilhado com prepararContextoAdmin real). ─────
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. Cliente opaco; só identidade. ─────
const clientServico = { __svc: true };
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── queries de lojas: mockadas — testamos ORQUESTRAÇÃO da action. ─────────────
const resolverDonoPorEmail =
  vi.fn<(...a: unknown[]) => Promise<string | null>>();
const slugExiste = vi.fn<(...a: unknown[]) => Promise<boolean>>();
const criarLoja = vi.fn<(...a: unknown[]) => Promise<{ id: string }>>();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  resolverDonoPorEmail: (...a: unknown[]) => resolverDonoPorEmail(...a),
  slugExiste: (...a: unknown[]) => slugExiste(...a),
  criarLoja: (...a: unknown[]) => criarLoja(...a),
}));

// 'use server' é só diretiva; o módulo é importável no runner node.
import { criarLojaAdmin } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults do caminho feliz; cada teste sobrescreve o que precisa.
  verificarAdminSaaS.mockResolvedValue(undefined);
  resolverDonoPorEmail.mockResolvedValue(DONO_ID);
  slugExiste.mockResolvedValue(false);
  criarLoja.mockResolvedValue({ id: LOJA_ID });
});

// ───── Caso 1: admin negado → exceção PROPAGA, fail-closed, nada inserido ─────
describe("criarLojaAdmin — fail-closed quando admin é negado (D-4)", () => {
  it("verificarAdminSaaS lança → a action REJEITA (propaga) e NÃO insere loja", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));

    await expect(criarLojaAdmin(payloadValido())).rejects.toThrow(
      "Acesso negado.",
    );

    // Fail-closed: nenhum INSERT após a prova de admin falhar.
    expect(criarLoja).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ───── Caso 2: e-mail sem usuário → { ok:false }, zero INSERT ─────────────────
describe("criarLojaAdmin — e-mail sem usuário cadastrado", () => {
  it("resolverDonoPorEmail → null → { ok:false } e NENHUM INSERT", async () => {
    resolverDonoPorEmail.mockResolvedValueOnce(null);

    const r = await criarLojaAdmin(payloadValido());

    expect(r.ok).toBe(false);
    expect(criarLoja).not.toHaveBeenCalled();
  });
});

// ───── Caso 3: dono já tem loja (índice único lojas(dono_id) → 23505) ─────────
describe("criarLojaAdmin — RN-4 (uma loja por dono)", () => {
  it("criarLoja lança violação de unique → { ok:false }, sem 2ª loja", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const violacao = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });
    criarLoja.mockRejectedValueOnce(violacao);

    const r = await criarLojaAdmin(payloadValido());

    expect(r.ok).toBe(false);
    // Tentou inserir exatamente uma vez; não há retry/segunda loja.
    expect(criarLoja).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ───── Caso 4: slug ocupado → { ok:false }, zero INSERT ──────────────────────
describe("criarLojaAdmin — slug ocupado", () => {
  it("slugExiste → true → { ok:false } e NENHUM INSERT", async () => {
    slugExiste.mockResolvedValueOnce(true);

    const r = await criarLojaAdmin(payloadValido());

    expect(r.ok).toBe(false);
    expect(criarLoja).not.toHaveBeenCalled();
  });
});

// ───── Caso 5: sucesso → INSERT com defaults server-side + { ok:true } ───────
describe("criarLojaAdmin — caminho feliz", () => {
  it("insere com dono resolvido + defaults server-side e retorna { ok:true, lojaId }", async () => {
    const antes = Date.now();
    const r = await criarLojaAdmin(payloadValido());
    const depois = Date.now();

    expect(r).toEqual({ ok: true, lojaId: LOJA_ID });

    // dono_id veio da RESOLUÇÃO server-side por e-mail, não do payload.
    expect(resolverDonoPorEmail).toHaveBeenCalledTimes(1);
    const emailArg = resolverDonoPorEmail.mock.calls[0][1] as string;
    expect(emailArg).toBe(EMAIL);

    expect(criarLoja).toHaveBeenCalledTimes(1);
    const [clientArg, dados] = criarLoja.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(clientArg).toBe(clientServico);

    // Identidade/perfil informados.
    expect(dados.dono_id).toBe(DONO_ID);
    expect(dados.nome).toBe(NOME);
    expect(dados.slug).toBe(SLUG);

    // Defaults de cadastro decididos pelo SERVIDOR (não do payload).
    expect(dados.ativo).toBe(false);
    expect(dados.assinatura_status).toBe("trial");
    expect(dados.consentimento_versao).toBe(VERSAO_TERMOS);

    // consentimento_em preenchido server-side (timestamp ISO de "agora").
    expect(typeof dados.consentimento_em).toBe("string");
    const ts = Date.parse(dados.consentimento_em as string);
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(antes - 1000);
    expect(ts).toBeLessThanOrEqual(depois + 1000);

    // Navegação: revalida a listagem do admin.
    expect(revalidatePath).toHaveBeenCalledWith("/admin/assinantes");
  });
});

// ───── Caso 6: segurança — payload hostil ignorado; e-mail não logado cru ─────
describe("criarLojaAdmin — segurança (não confia no cliente)", () => {
  it("payload com ativo:true / assinatura_status:'ativa' / dono_id forjado é IGNORADO", async () => {
    const hostil = {
      email: EMAIL,
      nome: NOME,
      slug: SLUG,
      ativo: true,
      assinatura_status: "ativa",
      dono_id: "00000000-0000-0000-0000-000000000000",
    };

    const r = await criarLojaAdmin(hostil);

    expect(r.ok).toBe(true);
    expect(criarLoja).toHaveBeenCalledTimes(1);
    const [, dados] = criarLoja.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    // Constantes server-side vencem o payload hostil.
    expect(dados.ativo).toBe(false);
    expect(dados.assinatura_status).toBe("trial");
    // dono_id é o RESOLVIDO por e-mail, nunca o forjado no payload.
    expect(dados.dono_id).toBe(DONO_ID);
    expect(dados.dono_id).not.toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("o e-mail NUNCA é logado em cru (PII, scrubbing §21)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Força um caminho de erro para exercitar logging interno.
    criarLoja.mockRejectedValueOnce(new Error("boom"));
    await criarLojaAdmin(payloadValido());

    const todasAsLinhas = [
      ...spy.mock.calls,
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]
      .flat()
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join(" ");
    expect(todasAsLinhas).not.toContain(EMAIL);

    spy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ───── Caso 8: payload inválido → { ok:false } ANTES de verificarAdminSaaS ────
// Garante que a primeira barreira (parse/allowlist) bloqueia sem custo de I/O:
// `verificarAdminSaaS` NÃO deve ser chamado se os dados nem passam no schema.
describe("criarLojaAdmin — payload inválido bloqueado antes da prova de admin", () => {
  it("e-mail malformado → { ok:false } e verificarAdminSaaS NUNCA chamado", async () => {
    const r = await criarLojaAdmin({ email: "nao-e-email", nome: NOME, slug: SLUG });

    expect(r.ok).toBe(false);
    // A prova de admin é cara (I/O); não deve rodar para payload inválido.
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(criarLoja).not.toHaveBeenCalled();
  });

  it("slug com espaço (inválido) → { ok:false } antes de qualquer I/O", async () => {
    const r = await criarLojaAdmin({ email: EMAIL, nome: NOME, slug: "slug invalido" });

    expect(r.ok).toBe(false);
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(criarLoja).not.toHaveBeenCalled();
  });
});

// ───── Caso 9: ORDEM resolverDono → slugExiste → criarLoja ────────────────────
// Prova que slug ocupado NÃO cortocircuita antes de resolver o dono. A spec exige
// a sequência: resolver dono (verifica se e-mail existe) PRIMEIRO, slug depois.
// Se a order fosse invertida, o caso de "slug ocupado" mascararia um e-mail inválido.
describe("criarLojaAdmin — ordem das verificações server-side", () => {
  it("slug ocupado: resolverDonoPorEmail é chamado ANTES de negar por slug", async () => {
    slugExiste.mockResolvedValueOnce(true);

    const r = await criarLojaAdmin(payloadValido());

    expect(r.ok).toBe(false);
    // resolverDonoPorEmail deve ter rodado (ordem: dono primeiro, slug depois).
    expect(resolverDonoPorEmail).toHaveBeenCalledTimes(1);
    // criarLoja nunca deve ter sido chamado (early-return no slug).
    expect(criarLoja).not.toHaveBeenCalled();
  });

  it("e-mail sem usuário: slugExiste NUNCA consultado (early-return correto)", async () => {
    resolverDonoPorEmail.mockResolvedValueOnce(null);

    const r = await criarLojaAdmin(payloadValido());

    expect(r.ok).toBe(false);
    // Se resolverDono falhou, slugExiste não deve nem ser chamado.
    expect(slugExiste).not.toHaveBeenCalled();
    expect(criarLoja).not.toHaveBeenCalled();
  });
});
