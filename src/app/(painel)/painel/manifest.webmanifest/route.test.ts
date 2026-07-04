import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

/**
 * Fase RED (TDD) — issue 003, Nível 2 (Route Handler / invariante de isolamento).
 *
 * Prova o vetor de VAZAMENTO DE TENANT: a loja que nomeia o manifest do painel
 * vem SÓ da sessão (RLS via buscarLojaDoDono), NUNCA de query string. O alvo é
 * um STUB cujo GET() lança 'TODO: GREEN' — toda asserção cai vermelha até GREEN.
 *
 * Mock de I/O (padrão de src/lib/actions/loja.test.ts §111–148): createClient
 * (sessão/cookies) e buscarLojaDoDono (resolução por RLS). RLS real é coberta
 * por testes pglite da camada de queries — aqui provamos que a APLICAÇÃO nunca
 * passa input do cliente para a escolha da loja.
 */

// ── client autenticado mockado: só carrega o user retornado por getUser ──
const getUser = vi.fn();
const fakeClient = {
  auth: {
    getUser: () => getUser(),
  },
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(fakeClient),
}));

// ── buscarLojaDoDono: SEMPRE a loja A, qualquer que seja o argumento ──
// (prova de isolamento: o handler não tem como pedir outra loja)
const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

import { GET } from "./route";

function lojaFake(overrides: Partial<LojaCompleta>): LojaCompleta {
  const base: LojaCompleta = {
    assinatura_atualizada_em: null,
    assinatura_fim_periodo: null,
    assinatura_inicio: null,
    assinatura_status: "trial",
    ativo: true,
    atualizado_em: "2026-01-01T00:00:00Z",
    consentimento_em: null,
    consentimento_versao: null,
    criado_em: "2026-01-01T00:00:00Z",
    dono_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    endereco_bairro: null,
    endereco_cep: null,
    endereco_cidade: null,
    endereco_estado: null,
    endereco_numero: null,
    endereco_rua: null,
    horarios: {},
    hotmart_plano: null,
    hotmart_subscriber_code: null,
    billing_provider: null,
    provider_subscription_id: null,
    plano_id: null,
    id: "11111111-1111-1111-1111-111111111111",
    latitude: null,
    logo_url: null,
    longitude: null,
    nome: "Loja A",
    slug: "loja-a",
    taxa_entrega_fora_zona: null,
    telefone: null,
    tema: {},
    timezone: "America/Sao_Paulo",
    whatsapp: null,
    whatsapp_envio_automatico: true,
  };
  return { ...base, ...overrides };
}

const USER_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const LOJA_A = lojaFake({ nome: "Loja A", slug: "loja-a", logo_url: "https://cdn/a.png" });

beforeEach(() => {
  getUser.mockReset();
  buscarLojaDoDono.mockReset();
});

describe("GET /painel/manifest.webmanifest — isolamento e headers (RED issue 003)", () => {
  it("dono autenticado → 200, Content-Type application/manifest+json, Cache-Control private/no-store, name da própria loja", async () => {
    getUser.mockResolvedValue({ data: { user: USER_A } });
    buscarLojaDoDono.mockResolvedValue(LOJA_A);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.name).toBe("Loja A · Painel");
  });

  it("ISOLAMENTO: buscarLojaDoDono é chamado SEM nenhum loja_id/slug do cliente; corpo nunca traz a loja B", async () => {
    getUser.mockResolvedValue({ data: { user: USER_A } });
    // buscarLojaDoDono devolve só a loja A, independentemente de qualquer coisa.
    buscarLojaDoDono.mockResolvedValue(LOJA_A);

    const res = await GET();
    const body = await res.json();

    // o handler não recebe Request → não há ?loja_id=<B>/?slug=<B> a repassar.
    // buscarLojaDoDono recebe SÓ o client (1 argumento), nunca um id/slug.
    expect(buscarLojaDoDono).toHaveBeenCalledTimes(1);
    const args = buscarLojaDoDono.mock.calls[0];
    expect(args.length).toBe(1); // só o client, nenhum id/slug
    expect(args[0]).toBe(fakeClient);

    // nenhuma string de B vaza no manifest
    const json = JSON.stringify(body);
    expect(json).not.toContain("loja-b");
    expect(json).not.toContain("Loja B");
    expect(body.name).toBe("Loja A · Painel");
  });

  it("sem sessão (getUser → user null) → 401, sem corpo de loja, Cache-Control private/no-store", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // não chega a consultar loja alguma
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain("Painel"); // sem dado de manifest/loja no 401
  });

  it("sessão sem loja (órfão: buscarLojaDoDono → null) → 200 genérico 'iRango · Painel'", async () => {
    getUser.mockResolvedValue({ data: { user: USER_A } });
    buscarLojaDoDono.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("iRango · Painel");
  });

  it("erro de I/O (buscarLojaDoDono lança) → 500 genérico, sem detalhe do erro no corpo", async () => {
    getUser.mockResolvedValue({ data: { user: USER_A } });
    buscarLojaDoDono.mockRejectedValue(new Error("PGRST: connection refused"));

    const res = await GET();

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    expect(text).not.toContain("connection refused");
    expect(text).not.toContain("PGRST");
  });
});
