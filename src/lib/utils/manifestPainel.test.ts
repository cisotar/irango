import { describe, it, expect } from "vitest";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import { montarManifestPainel } from "./manifestPainel";

/**
 * Fase RED (TDD) — issue 003, Nível 1 (função pura `montarManifestPainel`).
 *
 * Prova o SHAPE do manifest e a escolha de ícone, sem mock de I/O. O alvo é um
 * STUB que lança 'TODO: GREEN' — toda asserção cai vermelha até a fase GREEN.
 * As asserções são sobre o COMPORTAMENTO esperado (nome derivado da loja,
 * fallback de ícone, rejeição de logo não-https, genérico em null), nunca sobre
 * a fórmula bugada do stub.
 */

// LojaCompleta tem muitas colunas non-null; `lojaFake` dá uma base válida e
// tipada, deixando o teste focar só em `nome`/`logo_url`.
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
    dono_id: "11111111-1111-1111-1111-111111111111",
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
    id: "22222222-2222-2222-2222-222222222222",
    latitude: null,
    logo_url: null,
    longitude: null,
    nome: "Loja Base",
    slug: "loja-base",
    taxa_entrega_fora_zona: null,
    telefone: null,
    tema: {},
    timezone: "America/Sao_Paulo",
    whatsapp: null,
    whatsapp_envio_automatico: true,
  };
  return { ...base, ...overrides };
}

const ICONES_FALLBACK = [
  { src: "/icons/painel-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icons/painel-512.png", sizes: "512x512", type: "image/png" },
];

describe("montarManifestPainel — shape e ícones (RED issue 003)", () => {
  it("caso 1: loja com logo_url https → name = '<nome> · Painel', short_name 'Painel', ícones usam a logo_url", () => {
    const m = montarManifestPainel(
      lojaFake({ nome: "Pizzaria da Vovó", logo_url: "https://cdn.exemplo.com/a.png" }),
    );
    expect(m.name).toBe("Pizzaria da Vovó · Painel");
    expect(m.short_name).toBe("Painel");
    // ícones apontam para a logo_url da loja (dois tamanhos)
    expect(m.icons.map((i) => i.src)).toEqual([
      "https://cdn.exemplo.com/a.png",
      "https://cdn.exemplo.com/a.png",
    ]);
    expect(m.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
  });

  it("caso 2: loja sem logo_url (null) → ícones de fallback /icons/painel-{192,512}.png", () => {
    const m = montarManifestPainel(lojaFake({ nome: "Sem Logo", logo_url: null }));
    expect(m.name).toBe("Sem Logo · Painel");
    expect(m.icons).toEqual(ICONES_FALLBACK);
  });

  it("caso 3: logo_url com http:// (inseguro) → rejeita e usa fallback (defesa em profundidade §15)", () => {
    const m = montarManifestPainel(
      lojaFake({ nome: "Insegura", logo_url: "http://cdn.exemplo.com/a.png" }),
    );
    // jamais emitir a url http como ícone
    expect(m.icons.map((i) => i.src)).not.toContain("http://cdn.exemplo.com/a.png");
    expect(m.icons).toEqual(ICONES_FALLBACK);
  });

  it("caso 4: loja = null (dono sem loja) → name = 'iRango · Painel' e ícones de fallback", () => {
    const m = montarManifestPainel(null);
    expect(m.name).toBe("iRango · Painel");
    expect(m.icons).toEqual(ICONES_FALLBACK);
  });

  it("caso 5: start_url, scope, id e display são constantes (independente da loja)", () => {
    const comLoja = montarManifestPainel(lojaFake({ nome: "Qualquer" }));
    const semLoja = montarManifestPainel(null);
    for (const m of [comLoja, semLoja]) {
      expect(m.start_url).toBe("/painel");
      expect(m.scope).toBe("/painel");
      expect(m.id).toBe("/painel");
      expect(m.display).toBe("standalone");
    }
  });
});
