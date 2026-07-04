import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fase RED (TDD) da issue 080 — guard `verificarAdminSaaS()`.
 *
 * Importa de `./admin`, cujo corpo é um STUB (`throw 'TODO: GREEN'`). TODA
 * expectativa abaixo FALHA hoje — esse é o RED. A implementação real (ler
 * `process.env.SAAS_ADMIN_USER_ID` + `auth.getUser()`) é da fase GREEN.
 *
 * Invariante crítica provada aqui (RN-12/13/14): a verificação de admin é a
 * ÚNICA linha de defesa antes de elevar para service_role e atravessar o trigger
 * de billing. Se for contornável, um lojista autenticado se auto-concede
 * `cortesia`/`ativa` e burla cobrança (bypass total de receita).
 *
 * Casos:
 *  1. uid === SAAS_ADMIN_USER_ID                → NÃO lança (admin passa).
 *  2. uid !== SAAS_ADMIN_USER_ID (lojista)      → LANÇA (não autorizado).
 *  3. usuário anônimo (getUser → user:null)     → LANÇA (null nunca casa UUID).
 *  4. SAAS_ADMIN_USER_ID ausente/vazio          → LANÇA p/ TODOS (fail-closed),
 *                                                  inclusive o admin real.
 *
 * Mock: `createClient` (server) devolve um client cujo `auth.getUser()` resolve
 * o usuário do caso. A env é manipulada por `vi.stubEnv` em cada teste.
 */

const ADMIN_UID = "99999999-9999-9999-9999-999999999999";
const LOJISTA_UID = "11111111-1111-1111-1111-111111111111";

let usuarioAtual: { id: string } | null;

const getUser = vi.fn(async () => ({
  data: { user: usuarioAtual },
  error: null,
}));

const createClient = vi.fn(async () => ({ auth: { getUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

import { verificarAdminSaaS, ehAdminSaaS } from "./admin";

beforeEach(() => {
  vi.clearAllMocks();
  usuarioAtual = null;
  vi.stubEnv("SAAS_ADMIN_USER_ID", ADMIN_UID);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verificarAdminSaaS — fase RED issue 080", () => {
  it("NÃO lança quando uid === SAAS_ADMIN_USER_ID (admin do SaaS)", async () => {
    usuarioAtual = { id: ADMIN_UID };
    await expect(verificarAdminSaaS()).resolves.toBeUndefined();
  });

  // NB: as asserções de rejeição abaixo checam a MENSAGEM de autorização real
  // ("acesso negado"), não um throw qualquer. Isso evita falso-verde: o STUB
  // lança "TODO: GREEN" — que NÃO casa o /acesso negado/i — então estes testes
  // também caem vermelhos hoje. Só a GREEN, lançando o erro certo, os deixa
  // verdes. (A asserção precisa distinguir "rejeitou por ser não-admin" de
  // "rejeitou porque a função não existe".)
  it("LANÇA acesso negado quando uid !== SAAS_ADMIN_USER_ID (lojista autenticado — bypass de cobrança)", async () => {
    usuarioAtual = { id: LOJISTA_UID };
    await expect(verificarAdminSaaS()).rejects.toThrow(/acesso negado/i);
  });

  it("LANÇA acesso negado para usuário anônimo (getUser → user: null)", async () => {
    usuarioAtual = null;
    await expect(verificarAdminSaaS()).rejects.toThrow(/acesso negado/i);
  });

  it("LANÇA mesmo para o admin real quando SAAS_ADMIN_USER_ID está ausente (fail-closed)", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", "");
    usuarioAtual = { id: ADMIN_UID };
    // Fail-closed: env ausente bloqueia TODOS, inclusive o admin real. O contrato
    // (D-4/D-5) lança "acesso negado" OU "não configurado" — qualquer das duas é
    // aceitável; o STUB ("TODO: GREEN") NÃO casa nenhuma, então cai vermelho hoje.
    await expect(verificarAdminSaaS()).rejects.toThrow(
      /acesso negado|não configurado/i,
    );
  });
});

/**
 * Fase RED (TDD) da issue 147 — helper `ehAdminSaaS(userId)`.
 *
 * Distinção crítica vs. verificarAdminSaaS() (fail-CLOSED): este helper é
 * fail-SAFE. É consumido no callback OAuth (148) para rotear o redirect, onde o
 * login NUNCA pode quebrar por config faltando. Por isso env ausente/vazia →
 * `false` SEM lançar, em vez de bloquear. É comparação síncrona de um user.id já
 * autoritativo contra SAAS_ADMIN_USER_ID — não faz getUser() (o mock de
 * createClient acima não é tocado por estes testes).
 *
 * Casos:
 *  1. userId === SAAS_ADMIN_USER_ID          → true.
 *  2. userId !== SAAS_ADMIN_USER_ID (lojista) → false.
 *  3. env ausente (undefined)                 → false SEM lançar.
 *  4. env vazia ("")                          → false SEM lançar.
 *  5. userId vazio ("")                        → false.
 *
 * Todos falham hoje: `ehAdminSaaS` não existe em `./admin` (fase GREEN a
 * implementa). O import quebra o type-check e a asserção não roda verde.
 */
describe("ehAdminSaaS — fase RED issue 147", () => {
  it("true quando userId === SAAS_ADMIN_USER_ID", () => {
    // env já stubada para ADMIN_UID no beforeEach.
    expect(ehAdminSaaS(ADMIN_UID)).toBe(true);
  });

  it("false quando userId !== SAAS_ADMIN_USER_ID (lojista)", () => {
    expect(ehAdminSaaS(LOJISTA_UID)).toBe(false);
  });

  it("false SEM lançar quando SAAS_ADMIN_USER_ID ausente (fail-safe: login não trava)", () => {
    // Remove a env stubada no beforeEach → process.env.SAAS_ADMIN_USER_ID undefined.
    vi.stubEnv("SAAS_ADMIN_USER_ID", undefined as unknown as string);
    expect(() => ehAdminSaaS(ADMIN_UID)).not.toThrow();
    expect(ehAdminSaaS(ADMIN_UID)).toBe(false);
  });

  it("false SEM lançar quando SAAS_ADMIN_USER_ID vazia (fail-safe)", () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", "");
    expect(() => ehAdminSaaS(ADMIN_UID)).not.toThrow();
    expect(ehAdminSaaS(ADMIN_UID)).toBe(false);
  });

  it("false para userId vazio (guard antes de tocar a env)", () => {
    // env válida (ADMIN_UID) no beforeEach; ainda assim userId "" nunca casa.
    expect(ehAdminSaaS("")).toBe(false);
  });
});
