import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) da issue 015 — Server Actions `cadastrar` / `entrar`
 * (orquestração, sem rede). Mock de TODO I/O externo: Supabase Auth
 * (signUp/signInWithPassword/admin.deleteUser), service_role client e as queries
 * de loja (contarLojasDoDono/slugExiste/criarLoja).
 *
 * Por que é RED de verdade: `actions/auth.ts` é um STUB que lança 'TODO: GREEN'.
 * Cada asserção é sobre o COMPORTAMENTO esperado da action implementada
 * (gravar trial/consentimento pelo servidor, recusar sem aceite SEM signUp,
 * compensar com deleteUser, erro genérico no login). Todos caem vermelhos até a
 * fase GREEN escrever a orquestração.
 *
 * Princípio anti-confiar-no-cliente (seguranca.md §10): o teste prova que
 * dono_id/assinatura_status/consentimento_* vêm do SERVIDOR — nunca do payload.
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const VERSAO_TERMOS = "2026-06-13"; // D8 do plano — constante do servidor

// ── Supabase Auth (server client) ────────────────────────────────────────────
const signUp = vi.fn();
const signInWithPassword = vi.fn();
const deleteUser = vi.fn();
const serverClient = {
  auth: {
    signUp: (...a: unknown[]) => signUp(...a),
    signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
  },
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(serverClient),
}));

// ── service_role client (BYPASSRLS) — admin.deleteUser vive aqui ──────────────
const fakeService = { auth: { admin: { deleteUser: (...a: unknown[]) => deleteUser(...a) } } };
const createServiceClient = vi.fn(() => fakeService);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── queries de loja ───────────────────────────────────────────────────────────
const contarLojasDoDono = vi.fn();
const slugExiste = vi.fn();
const criarLoja = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  contarLojasDoDono: (...a: unknown[]) => contarLojasDoDono(...a),
  slugExiste: (...a: unknown[]) => slugExiste(...a),
  criarLoja: (...a: unknown[]) => criarLoja(...a),
}));

import { cadastrar, entrar } from "./auth";

const PAYLOAD_OK = { email: "joao@teste.com", senha: "senha1234", aceiteTermos: true as const };

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults do caminho feliz; cada teste sobrescreve o que precisa.
  signUp.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  contarLojasDoDono.mockResolvedValue(0);
  slugExiste.mockResolvedValue(false);
  criarLoja.mockResolvedValue({ id: "loja-1", dono_id: USER_ID });
  deleteUser.mockResolvedValue({ error: null });
});

describe("cadastrar — caminho feliz", () => {
  it("sucesso: signUp + cria loja → { ok: true }", async () => {
    const r = await cadastrar(PAYLOAD_OK);
    expect(r).toEqual({ ok: true });
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(criarLoja).toHaveBeenCalledTimes(1);
  });

  it("grava dono_id do USER do signUp, consentimento e trial — DECIDIDOS PELO SERVIDOR", async () => {
    await cadastrar(PAYLOAD_OK);
    const dados = criarLoja.mock.calls[0][1] as Record<string, unknown>;
    // dono_id vem do retorno do signUp, não do payload
    expect(dados.dono_id).toBe(USER_ID);
    // consentimento gravado pelo servidor
    expect(dados.consentimento_versao).toBe(VERSAO_TERMOS);
    expect(typeof dados.consentimento_em).toBe("string");
    // trial decidido pelo servidor
    expect(dados.assinatura_status).toBe("trial");
    // §17 + finding ALTA da auditoria: loja nasce INATIVA (não vaza na vitrine)
    expect(dados.ativo).toBe(false);
    // fim do período ≈ now + 14 dias
    const fim = new Date(dados.assinatura_fim_periodo as string).getTime();
    const esperado = Date.now() + 14 * 24 * 60 * 60 * 1000;
    expect(Math.abs(fim - esperado)).toBeLessThan(60 * 60 * 1000);
    // nome nasce vazio
    expect(dados.nome).toBe("");
  });

  it("INSERT da loja roda via service_role (não anon)", async () => {
    await cadastrar(PAYLOAD_OK);
    expect(createServiceClient).toHaveBeenCalled();
    expect(criarLoja.mock.calls[0][0]).toBe(fakeService);
  });
});

describe("cadastrar — ATAQUES e invariantes (não confiar no cliente)", () => {
  it("ATAQUE: sem aceiteTermos → recusa SEM signUp nem criar loja", async () => {
    const r = await cadastrar({ email: "joao@teste.com", senha: "senha1234" });
    expect(r).toMatchObject({ ok: false });
    expect(signUp).not.toHaveBeenCalled();
    expect(criarLoja).not.toHaveBeenCalled();
  });

  it("ATAQUE: aceiteTermos:false → recusa SEM signUp nem criar loja", async () => {
    const r = await cadastrar({ ...PAYLOAD_OK, aceiteTermos: false });
    expect(r).toMatchObject({ ok: false });
    expect(signUp).not.toHaveBeenCalled();
    expect(criarLoja).not.toHaveBeenCalled();
  });

  it("ATAQUE: injetar assinatura_status='ativa' no payload → .strict() rejeita OU servidor grava 'trial'", async () => {
    const r = await cadastrar({ ...PAYLOAD_OK, assinatura_status: "ativa" });
    if (r.ok) {
      // se .strict() permitir (ignorando o extra), o servidor AINDA grava trial.
      const dados = criarLoja.mock.calls[0][1] as Record<string, unknown>;
      expect(dados.assinatura_status).toBe("trial");
    } else {
      // se .strict() rejeitar, não houve signUp nem loja.
      expect(signUp).not.toHaveBeenCalled();
      expect(criarLoja).not.toHaveBeenCalled();
    }
  });

  it("ATAQUE: injetar dono_id/consentimento_* no payload → servidor ignora (usa user.id + now/VERSAO)", async () => {
    const r = await cadastrar({
      ...PAYLOAD_OK,
      dono_id: "99999999-9999-9999-9999-999999999999",
      consentimento_versao: "FAKE",
    });
    if (r.ok) {
      const dados = criarLoja.mock.calls[0][1] as Record<string, unknown>;
      expect(dados.dono_id).toBe(USER_ID); // não o injetado
      expect(dados.consentimento_versao).toBe(VERSAO_TERMOS); // não 'FAKE'
    } else {
      expect(criarLoja).not.toHaveBeenCalled();
    }
  });

  it("senha fraca (<8) → recusa SEM signUp", async () => {
    const r = await cadastrar({ email: "joao@teste.com", senha: "123", aceiteTermos: true });
    expect(r).toMatchObject({ ok: false });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("RN-01: dono já tem 1 loja → recusa a 2ª (não chama criarLoja)", async () => {
    contarLojasDoDono.mockResolvedValue(1);
    const r = await cadastrar(PAYLOAD_OK);
    expect(r).toMatchObject({ ok: false });
    expect(criarLoja).not.toHaveBeenCalled();
  });
});

describe("cadastrar — slug e compensação", () => {
  it("slug derivado colide (slugExiste true uma vez) → sufixa e cria mesmo assim", async () => {
    // 1ª tentativa ocupada, 2ª livre → action resolve sufixo e cria a loja.
    slugExiste.mockResolvedValueOnce(true).mockResolvedValue(false);
    const r = await cadastrar(PAYLOAD_OK);
    expect(r).toEqual({ ok: true });
    expect(criarLoja).toHaveBeenCalledTimes(1);
    const dados = criarLoja.mock.calls[0][1] as Record<string, unknown>;
    // slug derivado de 'joao' colidiu → variação sufixada (não exatamente 'joao')
    expect(dados.slug).not.toBe("joao");
    expect(String(dados.slug)).toMatch(/^joao/);
  });

  it("compensação: signUp ok mas criarLoja falha → tenta deleteUser e retorna erro genérico", async () => {
    const erroPg = new Error("insert failed: senha postgres XYZ");
    criarLoja.mockRejectedValue(erroPg);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await cadastrar(PAYLOAD_OK);

    expect(r).toMatchObject({ ok: false });
    expect(deleteUser).toHaveBeenCalledWith(USER_ID); // compensação best-effort
    // erro genérico — não vaza detalhe interno (seguranca.md §14)
    expect(JSON.stringify(r)).not.toContain("senha");
    spy.mockRestore();
  });
});

describe("entrar", () => {
  it("login ok → { ok: true }", async () => {
    const r = await entrar({ email: "joao@teste.com", senha: "senha1234" });
    expect(r).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("ATAQUE anti-enumeração: credencial errada → erro GENÉRICO (não revela se email existe)", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });
    const r = await entrar({ email: "naoexiste@teste.com", senha: "errada123" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      // mensagem não diferencia "email não existe" de "senha errada"
      expect(r.erro.toLowerCase()).not.toContain("email não encontrado");
      expect(r.erro.toLowerCase()).not.toContain("não existe");
      expect(r.erro.toLowerCase()).not.toContain("senha incorreta para");
    }
  });
});
