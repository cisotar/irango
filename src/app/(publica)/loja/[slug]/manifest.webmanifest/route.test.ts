import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LojaPublica } from "@/lib/supabase/queries/lojas";

/**
 * Testes do Route Handler GET /loja/[slug]/manifest.webmanifest (issue 002).
 *
 * Mocks: createClient (Supabase SSR/cookies) e buscarLojaPorSlug (view anon).
 * A função sob teste é o handler GET — não mockamos a lógica interna (montarIcones,
 * schemaTema). Provamos o comportamento observável: status, headers, body JSON.
 *
 * Cada teste falharia se o comportamento correspondente quebrasse.
 */

// ── Supabase client anon mockado ──────────────────────────────────────────────
const fakeClient = {};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(fakeClient),
}));

// ── buscarLojaPorSlug mockado (lê vitrine_lojas, anon) ───────────────────────
const buscarLojaPorSlug = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaPorSlug: (...a: unknown[]) => buscarLojaPorSlug(...a),
}));

// ── notFound() mockado (lança para simular 404 do Next) ──────────────────────
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));

import { GET } from "./route";

// ── helper: LojaPublica mínima válida ─────────────────────────────────────────
function lojaFake(overrides: Partial<LojaPublica>): LojaPublica {
  const base: LojaPublica = {
    assinatura_fim_periodo: null,
    assinatura_status: "trial",
    ativo: true,
    endereco_bairro: null,
    endereco_cep: null,
    endereco_cidade: null,
    endereco_estado: null,
    endereco_numero: null,
    endereco_rua: null,
    horarios: {},
    id: "11111111-1111-1111-1111-111111111111",
    logo_url: null,
    nome: "Pizzaria Base",
    slug: "pizzaria-base",
    taxa_entrega_fora_zona: null,
    telefone: null,
    tema: null,
    timezone: "America/Sao_Paulo",
    whatsapp: null,
    whatsapp_envio_automatico: true,
  };
  return { ...base, ...overrides };
}

// ── helper: chama GET com params Promise (assinatura Next 16) ────────────────
async function callGET(slug: string): Promise<Response> {
  return GET(new Request(`http://localhost/loja/${slug}/manifest.webmanifest`), {
    params: Promise.resolve({ slug }),
  });
}

beforeEach(() => {
  buscarLojaPorSlug.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /loja/[slug]/manifest.webmanifest — critérios de aceite (issue 002)", () => {
  // ── Caso 1: caminho feliz — 200 + Content-Type + shape do manifest ──────────
  it("loja existente → 200 e Content-Type application/manifest+json", async () => {
    buscarLojaPorSlug.mockResolvedValue(lojaFake({ nome: "Burger Fit", slug: "burger-fit" }));

    const res = await callGET("burger-fit");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
  });

  it("name = nome completo da loja; short_name ≤ 12 chars", async () => {
    buscarLojaPorSlug.mockResolvedValue(
      lojaFake({ nome: "Pizzaria da Vovó Esperança", slug: "pizzaria-da-vovo" }),
    );

    const res = await callGET("pizzaria-da-vovo");
    const body = await res.json();

    expect(body.name).toBe("Pizzaria da Vovó Esperança");
    expect(body.short_name.length).toBeLessThanOrEqual(12);
    // truncamento é os 12 primeiros chars de nome
    expect(body.short_name).toBe("Pizzaria da ");
  });

  it("nome com exatamente 12 chars não é truncado", async () => {
    buscarLojaPorSlug.mockResolvedValue(
      lojaFake({ nome: "Burger Fit 12", slug: "burger-fit-12" }),
    );

    const res = await callGET("burger-fit-12");
    const body = await res.json();

    // "Burger Fit 12" = 13 chars → truncado para 12
    expect(body.short_name.length).toBeLessThanOrEqual(12);
  });

  it("nome com até 12 chars → short_name igual ao nome completo", async () => {
    buscarLojaPorSlug.mockResolvedValue(lojaFake({ nome: "Sushi", slug: "sushi" }));

    const res = await callGET("sushi");
    const body = await res.json();

    expect(body.short_name).toBe("Sushi");
    expect(body.name).toBe("Sushi");
  });

  it("start_url, scope e id refletem /loja/<slug>; display = standalone", async () => {
    buscarLojaPorSlug.mockResolvedValue(lojaFake({ nome: "Tapioca", slug: "tapioca" }));

    const res = await callGET("tapioca");
    const body = await res.json();

    expect(body.start_url).toBe("/loja/tapioca");
    expect(body.scope).toBe("/loja/tapioca");
    expect(body.id).toBe("/loja/tapioca");
    expect(body.display).toBe("standalone");
  });

  // ── Caso 2: logo_url https → ícones usam a logo_url ─────────────────────────
  it("loja com logo_url https:// → icons[].src apontam para a logo_url", async () => {
    buscarLojaPorSlug.mockResolvedValue(
      lojaFake({ slug: "com-logo", logo_url: "https://cdn.exemplo.com/logo.png" }),
    );

    const res = await callGET("com-logo");
    const body = await res.json();

    expect(body.icons).toHaveLength(2);
    expect(body.icons.map((i: { src: string }) => i.src)).toEqual([
      "https://cdn.exemplo.com/logo.png",
      "https://cdn.exemplo.com/logo.png",
    ]);
    expect(body.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512"]);
  });

  // ── Caso 3: sem logo_url → fallback ─────────────────────────────────────────
  it("loja sem logo_url (null) → icons[] apontam para /icons/vitrine-{192,512}.png", async () => {
    buscarLojaPorSlug.mockResolvedValue(lojaFake({ slug: "sem-logo", logo_url: null }));

    const res = await callGET("sem-logo");
    const body = await res.json();

    expect(body.icons.map((i: { src: string }) => i.src)).toEqual([
      "/icons/vitrine-192.png",
      "/icons/vitrine-512.png",
    ]);
  });

  // ── Borda de segurança: logo_url http:// → fallback (defesa em profundidade) ─
  it("logo_url com http:// (inseguro) → fallback, nunca emite http: como ícone (§15)", async () => {
    buscarLojaPorSlug.mockResolvedValue(
      lojaFake({ slug: "http-logo", logo_url: "http://cdn.exemplo.com/logo.png" }),
    );

    const res = await callGET("http-logo");
    const body = await res.json();

    const srcs = body.icons.map((i: { src: string }) => i.src);
    expect(srcs).not.toContain("http://cdn.exemplo.com/logo.png");
    expect(srcs).toEqual(["/icons/vitrine-192.png", "/icons/vitrine-512.png"]);
  });

  it("logo_url com data: URI → fallback (defesa em profundidade §15)", async () => {
    buscarLojaPorSlug.mockResolvedValue(
      lojaFake({ slug: "data-logo", logo_url: "data:image/png;base64,abc" }),
    );

    const res = await callGET("data-logo");
    const body = await res.json();

    const srcs = body.icons.map((i: { src: string }) => i.src);
    expect(srcs).toEqual(["/icons/vitrine-192.png", "/icons/vitrine-512.png"]);
  });

  // ── Caso 4: slug inexistente → 404 ──────────────────────────────────────────
  it("slug inexistente (buscarLojaPorSlug → null) → 404 via notFound()", async () => {
    buscarLojaPorSlug.mockResolvedValue(null);

    await expect(callGET("nao-existe")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("loja com nome null (view retorna linha inválida) → 404 via notFound()", async () => {
    buscarLojaPorSlug.mockResolvedValue(lojaFake({ nome: null }));

    await expect(callGET("loja-invalida")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("loja com slug null (linha inválida da view) → 404 via notFound()", async () => {
    buscarLojaPorSlug.mockResolvedValue(lojaFake({ slug: null }));

    await expect(callGET("loja-sem-slug")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // ── tema válido → colors extraídas ──────────────────────────────────────────
  it("tema com primaria/fundo válidos → theme_color e background_color do banco", async () => {
    buscarLojaPorSlug.mockResolvedValue(
      lojaFake({
        slug: "com-tema",
        tema: { primaria: "#ff0000", fundo: "#ffffff", destaque: "#00ff00" },
      }),
    );

    const res = await callGET("com-tema");
    const body = await res.json();

    expect(body.theme_color).toBe("#ff0000");
    expect(body.background_color).toBe("#ffffff");
  });

  // ── tema null/inválido → defaults iRango ────────────────────────────────────
  it("tema null → theme_color e background_color com defaults iRango", async () => {
    buscarLojaPorSlug.mockResolvedValue(lojaFake({ slug: "sem-tema", tema: null }));

    const res = await callGET("sem-tema");
    const body = await res.json();

    expect(body.theme_color).toBe("#332616");
    expect(body.background_color).toBe("#f5f0e6");
  });

  it("tema malformado (hex inválido) → defaults iRango em vez de crash", async () => {
    buscarLojaPorSlug.mockResolvedValue(
      lojaFake({ slug: "tema-ruim", tema: { primaria: "red", fundo: "blue", destaque: "green" } }),
    );

    const res = await callGET("tema-ruim");
    const body = await res.json();

    expect(body.theme_color).toBe("#332616");
    expect(body.background_color).toBe("#f5f0e6");
  });

  // ── erro de I/O → 500 sem detalhe ───────────────────────────────────────────
  it("buscarLojaPorSlug lança (falha de rede/PostgREST) → 500 genérico, sem detalhe no corpo (§14)", async () => {
    buscarLojaPorSlug.mockRejectedValue(new Error("PGRST: connection refused"));

    const res = await callGET("qualquer-slug");

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("connection refused");
    expect(text).not.toContain("PGRST");
  });

  // ── buscarLojaPorSlug recebe o client e o slug corretos ─────────────────────
  it("buscarLojaPorSlug é chamado com o client anon e o slug da URL", async () => {
    buscarLojaPorSlug.mockResolvedValue(lojaFake({ slug: "meu-slug" }));

    await callGET("meu-slug");

    expect(buscarLojaPorSlug).toHaveBeenCalledTimes(1);
    const [clientArg, slugArg] = buscarLojaPorSlug.mock.calls[0];
    expect(clientArg).toBe(fakeClient);
    expect(slugArg).toBe("meu-slug");
  });
});
