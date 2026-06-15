import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";

// Rate limit (issue 052): a action chama verificarRateLimit no topo via
// `await headers()`. rateLimit.ts é server-only (quebra no vitest) → mockamos
// para fail-open (permitido:true), e next/headers para não exigir request scope.
// O comportamento da trava é coberto em src/lib/utils/rateLimit.test.ts.
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: vi.fn(async () => ({ permitido: true })),
}));

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

// [067] reconciliarBairroCep é I/O (chama ViaCEP). Mockada — NÃO bater na rede.
// Mesmo padrão de pedido.test.ts (linhas 70-72). Por padrão, reconcilia "Centro".
const reconciliarBairroCep = vi.fn();
vi.mock("@/lib/utils/reconciliarBairroCep", () => ({
  reconciliarBairroCep: (...a: unknown[]) => reconciliarBairroCep(...a),
}));

import * as rateLimitMod from "@/lib/utils/rateLimit";
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

const CEP_CENTRO = "01001-000";

beforeEach(() => {
  vi.clearAllMocks();
  listarZonasComTaxas.mockResolvedValue([zonaCentro()]);
  // Loja com fallback fora-de-zona configurado (R$ 15,00) por padrão.
  buscarLojaPublicaPorId.mockResolvedValue({
    id: LOJA_ID,
    taxa_entrega_fora_zona: 15,
  });
  // [067] Por padrão o ViaCEP reconcilia o CEP para o bairro canônico "Centro".
  // Espelha o autoritativo (064): com CEP+bairro, o canônico do CEP vence.
  reconciliarBairroCep.mockResolvedValue({
    bairroCanonico: "Centro",
    reconciliado: true,
  });
});

// ── Borda (issue 052): mensagem quando rate limit bloqueia ───────────────────
// calcularFreteAction retorna { ok:false } genérico quando bloqueado — sem
// revelar que o motivo foi rate limit (seguranca.md §14). Banco não é tocado.
describe("calcularFreteAction — rate limit bloqueado (issue 052)", () => {
  it("IP bloqueado → { ok:false } SEM consultar zonas ou loja", async () => {
    vi.mocked(rateLimitMod.verificarRateLimit).mockResolvedValueOnce({ permitido: false });

    const r = await calcularFreteAction({ loja_id: LOJA_ID, bairro: "Centro" });

    expect(r.ok).toBe(false);
    // Nenhuma query de banco foi disparada — o guard parou antes de qualquer I/O.
    expect(listarZonasComTaxas).not.toHaveBeenCalled();
    expect(buscarLojaPublicaPorId).not.toHaveBeenCalled();
  });
});

describe("calcularFreteAction (Server Action — preview de frete, issue 072)", () => {
  it("bairro (reconciliado via CEP) casa zona → taxa_preview da zona + zona_nome", async () => {
    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: CEP_CENTRO,
      bairro: "Centro",
    });
    expect(r).toEqual({ ok: true, taxa_preview: 7.5, zona_nome: "Zona Central" });
  });

  it("bairro canônico FORA das zonas + taxa_entrega_fora_zona fixa → 'fora_zona' + taxa fixa", async () => {
    reconciliarBairroCep.mockResolvedValue({
      bairroCanonico: "Subúrbio Distante",
      reconciliado: true,
    });
    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: "99999-999",
      bairro: "Subúrbio Distante",
    });
    expect(r).toEqual({ ok: true, taxa_preview: 15, zona_nome: "fora_zona" });
  });

  it("bairro canônico FORA + taxa_entrega_fora_zona null → 'indisponivel' + taxa 0", async () => {
    reconciliarBairroCep.mockResolvedValue({
      bairroCanonico: "Subúrbio Distante",
      reconciliado: true,
    });
    buscarLojaPublicaPorId.mockResolvedValue({
      id: LOJA_ID,
      taxa_entrega_fora_zona: null,
    });
    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: "99999-999",
      bairro: "Subúrbio Distante",
    });
    expect(r).toEqual({ ok: true, taxa_preview: 0, zona_nome: "indisponivel" });
  });

  it("acento e CAIXA no bairro canônico não impedem o match (normalizarBairro)", async () => {
    // O ViaCEP devolve "CÉNTRO " — normalizarBairro casa com a zona de "Centro".
    reconciliarBairroCep.mockResolvedValue({
      bairroCanonico: "  CÉNTRO ",
      reconciliado: true,
    });
    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: CEP_CENTRO,
      bairro: "Centro",
    });
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
    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: CEP_CENTRO,
      bairro: "Centro",
    });
    expect(r).toEqual({ ok: true, taxa_preview: 7.5, zona_nome: "Zona Central" });
  });

  // ── [067] Paridade preview ↔ autoritativo (064): reconciliação CEP↔bairro
  //    fail-closed. O bairro DECLARADO nunca seleciona zona quando há CEP — o
  //    canônico do ViaCEP vence; falha do ViaCEP descarta o declarado.

  it("PARIDADE: ViaCEP down → bairro DESCARTADO → fallback fora-de-zona (mesma taxa do autoritativo)", async () => {
    // Cliente declara o bairro BARATO "Centro" mas o ViaCEP está fora do ar.
    // Fail-closed: descarta o declarado → nenhuma zona casa → fallback R$ 15
    // (idêntico ao que criarPedido cobraria).
    reconciliarBairroCep.mockResolvedValue({
      bairroCanonico: null,
      reconciliado: false,
    });
    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: CEP_CENTRO,
      bairro: "Centro",
    });
    expect(r).toEqual({ ok: true, taxa_preview: 15, zona_nome: "fora_zona" });
  });

  it("PARIDADE: bairro BARATO declarado + CEP de zona CARA → preview mostra a taxa do CEP", async () => {
    // Zona barata "Centro" 7.50 e zona cara "Jardins" 20. Cliente declara
    // "Centro" (barato), mas o CEP reconcilia para "Jardins" (caro). O preview
    // tem que mostrar 20 — sem ilusão de barato.
    listarZonasComTaxas.mockResolvedValue([
      zonaCentro(),
      {
        id: "zona-jardins",
        nome: "Zona Jardins",
        tipo: "bairro",
        ativo: true,
        taxa: { taxa: 20, pedido_minimo_gratis: null, raio_max_km: null },
        bairros: [{ nome: "Jardins" }],
      } as ZonaVitrine,
    ]);
    reconciliarBairroCep.mockResolvedValue({
      bairroCanonico: "Jardins",
      reconciliado: true,
    });
    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: "01400-000",
      bairro: "Centro",
    });
    expect(r).toEqual({ ok: true, taxa_preview: 20, zona_nome: "Zona Jardins" });
  });

  it("PARIDADE: zona tipo='faixa_cep' casa pelo CEP repassado (igual ao autoritativo)", async () => {
    // Zona por faixa de CEP. O preview tem que REPASSAR o cep numérico a
    // calcularFrete (não só usá-lo para reconciliar o bairro), senão nunca casa.
    listarZonasComTaxas.mockResolvedValue([
      {
        id: "zona-faixa",
        nome: "Zona Faixa CEP",
        tipo: "faixa_cep",
        ativo: true,
        taxa: {
          taxa: 9.9,
          pedido_minimo_gratis: null,
          raio_max_km: null,
          cep_inicio: 1000000,
          cep_fim: 1999999,
        },
        bairros: [],
      } as unknown as ZonaVitrine,
    ]);
    // Sem bairro: faixa_cep casa só pelo CEP. reconciliarBairroCep não é chamada.
    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: "01001-000",
    });
    expect(r).toEqual({ ok: true, taxa_preview: 9.9, zona_nome: "Zona Faixa CEP" });
    expect(reconciliarBairroCep).not.toHaveBeenCalled();
  });

  it("PARIDADE: sem CEP (só bairro declarado) → bairro DESCARTADO, reconciliação não roda", async () => {
    // Espelha o autoritativo: endereco.cep ausente → não chama ViaCEP → descarta
    // o bairro declarado → nenhuma zona tipo='bairro' casa → fallback R$ 15.
    const r = await calcularFreteAction({ loja_id: LOJA_ID, bairro: "Centro" });
    expect(r).toEqual({ ok: true, taxa_preview: 15, zona_nome: "fora_zona" });
    expect(reconciliarBairroCep).not.toHaveBeenCalled();
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
