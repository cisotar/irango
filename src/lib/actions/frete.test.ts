import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";

/**
 * Fase RED (TDD) da issue 072 — Server Action PÚBLICA `calcularFreteAction`
 * (PREVIEW de frete na Etapa 2 do checkout). A action ainda NÃO existe
 * (`@/lib/actions/frete`), então a importação falha e TODA expectativa abaixo
 * fica vermelha — RED.
 *
 * Contrato derivado da issue 072:
 *   calcularFreteAction(payload: { loja_id: uuid, bairro: string }) →
 *     - bairro casa zona      → { ok:true, taxa_preview: <taxa da zona>, zona_nome: <nome da zona> }
 *     - fora + fallback fixo  → { ok:true, taxa_preview: <taxa fixa>,    zona_nome: 'fora_zona' }
 *     - fora + sem fallback   → { ok:true, taxa_preview: 0, zona_nome: 'indisponivel' }  (ou { ok:false })
 *     - payload inválido      → { ok:false, erro }  SEM I/O
 *
 * Foco de segurança (issue 072 + seguranca.md §10):
 *   - PREVIEW recalculado no SERVIDOR a partir do banco (cliente nunca envia taxa);
 *   - reusa EXATAMENTE a mesma lib do recálculo autoritativo (calcularFrete + normalizarBairro);
 *   - leitura PÚBLICA via client ANON (createClient do servidor), NUNCA service_role;
 *   - valida o schema (zod strict) ANTES de qualquer I/O — payload inválido / campo
 *     extra não chega a tocar no banco (listarZonasComTaxas / buscarLojaPublicaPorId
 *     NÃO são chamadas).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// ── Mock do client anon (createClient do servidor). Igual ao padrão do
//    entregaPagamento.test.ts: o client raiz só expõe `.from` e NÃO é thenável,
//    senão `await createClient()` assimila o thenable. Aqui a action só repassa o
//    client às queries (que estão mockadas), então um objeto sentinela basta.
const anonClient = { __role: "anon" };
const createClient = vi.fn(async () => anonClient);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// service_role NUNCA deve ser tocado nesta action pública (leitura RLS pública).
const createServiceClient = vi.fn(() => ({ __role: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// Query de zonas (leitura pública). Retorna ZonaVitrine[] já hidratado.
const listarZonasComTaxas = vi.fn<(...a: unknown[]) => Promise<ZonaVitrine[]>>();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  listarZonasComTaxas: (...a: unknown[]) => listarZonasComTaxas(...a),
}));

// Busca pública da loja por id (via VIEW vitrine_lojas) só para obter
// `taxa_entrega_fora_zona`. CONTRATO p/ a fase GREEN: criar
// `buscarLojaPublicaPorId(client, lojaId)` em queries/lojas.ts.
const buscarLojaPublicaPorId = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaPublicaPorId: (...a: unknown[]) => buscarLojaPublicaPorId(...a),
}));

import { calcularFreteAction } from "./frete";

// Zona tipo 'bairro' que cobre "Centro" com taxa 7.50.
function zonaCentro(): ZonaVitrine {
  return {
    id: "zona-centro",
    nome: "Zona Central",
    tipo: "bairro",
    ativo: true,
    taxa: { taxa: 7.5, pedido_minimo_gratis: null, raio_max_km: null },
    bairros: [{ nome: "Centro" }],
  } as ZonaVitrine;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarZonasComTaxas.mockResolvedValue([zonaCentro()]);
  // Loja com fallback fora-de-zona configurado (R$ 15,00) por padrão.
  buscarLojaPublicaPorId.mockResolvedValue({
    id: LOJA_ID,
    taxa_entrega_fora_zona: 15,
  });
});

describe("calcularFreteAction (Server Action — preview de frete, issue 072)", () => {
  it("bairro casa zona → taxa_preview da zona + zona_nome da zona", async () => {
    const r = await calcularFreteAction({ loja_id: LOJA_ID, bairro: "Centro" });
    expect(r).toEqual({ ok: true, taxa_preview: 7.5, zona_nome: "Zona Central" });
  });

  it("bairro FORA das zonas + taxa_entrega_fora_zona fixa → zona_nome 'fora_zona' + taxa fixa", async () => {
    const r = await calcularFreteAction({ loja_id: LOJA_ID, bairro: "Subúrbio Distante" });
    expect(r).toEqual({ ok: true, taxa_preview: 15, zona_nome: "fora_zona" });
  });

  it("bairro FORA + taxa_entrega_fora_zona null → zona_nome 'indisponivel' + taxa 0", async () => {
    buscarLojaPublicaPorId.mockResolvedValue({
      id: LOJA_ID,
      taxa_entrega_fora_zona: null,
    });
    const r = await calcularFreteAction({ loja_id: LOJA_ID, bairro: "Subúrbio Distante" });
    expect(r).toEqual({ ok: true, taxa_preview: 0, zona_nome: "indisponivel" });
  });

  it("acento e CAIXA no bairro não impedem o match (normalizarBairro em ação)", async () => {
    // "CÉNTRO " (caixa alta + acento + espaço) deve casar com a zona de "Centro".
    const r = await calcularFreteAction({ loja_id: LOJA_ID, bairro: "  CÉNTRO " });
    expect(r).toEqual({ ok: true, taxa_preview: 7.5, zona_nome: "Zona Central" });
  });

  it("paridade preview ↔ autoritativo: usa a MESMA taxa da lib (sem reduzir frete)", async () => {
    // Zona barata "Centro" 7.50 + zona "Bairro Caro" 20 que TAMBÉM cobre o bairro.
    // calcularFrete escolhe a menor (7.50). O preview tem que devolver exatamente isso.
    listarZonasComTaxas.mockResolvedValue([
      zonaCentro(),
      {
        id: "zona-cara",
        nome: "Zona Cara",
        tipo: "bairro",
        ativo: true,
        taxa: { taxa: 20, pedido_minimo_gratis: null, raio_max_km: null },
        bairros: [{ nome: "Centro" }],
      } as ZonaVitrine,
    ]);
    const r = await calcularFreteAction({ loja_id: LOJA_ID, bairro: "Centro" });
    expect(r).toEqual({ ok: true, taxa_preview: 7.5, zona_nome: "Zona Central" });
  });

  it("payload inválido (sem bairro) → { ok:false } SEM tocar no banco", async () => {
    const r = await calcularFreteAction({ loja_id: LOJA_ID });
    expect(r.ok).toBe(false);
    expect(listarZonasComTaxas).not.toHaveBeenCalled();
    expect(buscarLojaPublicaPorId).not.toHaveBeenCalled();
  });

  it("payload inválido (loja_id não-uuid) → { ok:false } SEM tocar no banco", async () => {
    const r = await calcularFreteAction({ loja_id: "nao-uuid", bairro: "Centro" });
    expect(r.ok).toBe(false);
    expect(listarZonasComTaxas).not.toHaveBeenCalled();
  });

  it("payload inválido (bairro vazio) → { ok:false } SEM tocar no banco", async () => {
    const r = await calcularFreteAction({ loja_id: LOJA_ID, bairro: "   " });
    expect(r.ok).toBe(false);
    expect(listarZonasComTaxas).not.toHaveBeenCalled();
  });

  it("ATAQUE: payload com campo EXTRA (strict) → { ok:false } SEM tocar no banco", async () => {
    // Cliente tenta injetar a taxa — schema strict rejeita campo desconhecido.
    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      bairro: "Centro",
      taxa_preview: 0.01,
    });
    expect(r.ok).toBe(false);
    expect(listarZonasComTaxas).not.toHaveBeenCalled();
    expect(buscarLojaPublicaPorId).not.toHaveBeenCalled();
  });

  it("NÃO usa service_role (leitura pública via RLS anon)", async () => {
    await calcularFreteAction({ loja_id: LOJA_ID, bairro: "Centro" });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("usa o client ANON (createClient do servidor) e o repassa às queries", async () => {
    await calcularFreteAction({ loja_id: LOJA_ID, bairro: "Centro" });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(listarZonasComTaxas).toHaveBeenCalledWith(anonClient, LOJA_ID);
  });

  it("erro de banco → { ok:false } genérico, sem vazar e.message", async () => {
    listarZonasComTaxas.mockRejectedValue({ message: "senha postgres XYZ", code: "XX000" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await calcularFreteAction({ loja_id: LOJA_ID, bairro: "Centro" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("senha");
    spy.mockRestore();
  });
});
