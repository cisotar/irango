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

// [007] service_role é usado SÓ para as 2 colunas de coords (buscarCoordsLoja,
// via helper neutro distanciaDaLojaAoCep) — coords não têm SELECT anon (§19).
// Zonas/loja seguem ANON (não regredir privacidade). Sentinela ESTÁVEL para
// asserir, por identidade, que o helper recebeu o client service_role e não o anon.
const serviceClient = { __role: "service" };
const createServiceClient = vi.fn(() => serviceClient);
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
// [005] buscarCoordsLoja: a action consulta a PRESENÇA de coords da loja (via
// service_role, §19) só no ramo NÃO-atendido, para distinguir "loja com raio sem
// coords" de "endereço fora de área". Default: coords presentes (não regride os
// testes existentes de indisponível por bairro).
const buscarCoordsLoja = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaPublicaPorId: (...a: unknown[]) => buscarLojaPublicaPorId(...a),
  buscarCoordsLoja: (...a: unknown[]) => buscarCoordsLoja(...a),
}));

// [067] reconciliarBairroCep é I/O (chama ViaCEP). Mockada — NÃO bater na rede.
// Mesmo padrão de pedido.test.ts (linhas 70-72). Por padrão, reconcilia "Centro".
const reconciliarBairroCep = vi.fn();
vi.mock("@/lib/utils/reconciliarBairroCep", () => ({
  reconciliarBairroCep: (...a: unknown[]) => reconciliarBairroCep(...a),
}));

// [007] Helper NEUTRO distanciaDaLojaAoCep (lib/actions/distanciaFrete.ts):
// FONTE ÚNICA da sequência buscarCoordsLoja → geocodificarEndereco(CEP) →
// haversine — reusada pelo autoritativo (criarPedido, 006) E pelo preview
// (calcularFreteAction, 007): paridade RN-7. Mockado aqui (como em
// pedido.test.ts:91) — os testes da ACTION provam a ORQUESTRAÇÃO (instanciar
// service_role, chamar o helper com (svc, loja_id, cep), injetar distanciaKm no
// EnderecoEntrega só quando number), não a matemática do helper. Por padrão
// resolve `undefined` (fail-closed: loja sem coords / CEP sem geocode) — assim
// nenhum teste pré-existente (sem zona raio_km) regride; só os casos de raio
// sobrescrevem com número.
const distanciaDaLojaAoCep = vi.fn();
vi.mock("@/lib/actions/distanciaFrete", () => ({
  distanciaDaLojaAoCep: (...a: unknown[]) => distanciaDaLojaAoCep(...a),
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

// [007] Zona tipo='raio_km' — casa quando endereco.distanciaKm <= raio_max_km.
// Espelha o helper de pedido.test.ts (zonasComRaio) para a paridade RN-7.
function zonaRaio(raioMaxKm = 5, taxa = 3.0): ZonaVitrine {
  return {
    id: "zona-raio",
    nome: "Zona Raio 5km",
    tipo: "raio_km",
    ativo: true,
    taxa: { taxa, pedido_minimo_gratis: null, raio_max_km: raioMaxKm, cep_inicio: null, cep_fim: null },
    bairros: [],
  } as ZonaVitrine;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarZonasComTaxas.mockResolvedValue([zonaCentro()]);
  // [007] Default fail-closed: sem coords / sem geocode → undefined → zona
  // raio_km não casa. Mantém todos os testes pré-existentes (bairro/faixa_cep)
  // intactos; só os casos de raio sobrescrevem com número.
  distanciaDaLojaAoCep.mockResolvedValue(undefined);
  // Loja com fallback fora-de-zona configurado (R$ 15,00) por padrão.
  buscarLojaPublicaPorId.mockResolvedValue({
    id: LOJA_ID,
    taxa_entrega_fora_zona: 15,
  });
  // [005] Por padrão a loja TEM coords (par presente) — só os casos de
  // misconfiguração (coords NULL) sobrescrevem para null.
  buscarCoordsLoja.mockResolvedValue({ latitude: -22.96, longitude: -46.54 });
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

  // [007] CONVERTIDO de "NÃO usa service_role". A invariante mudou: o preview por
  // raio precisa das coords da loja, que NÃO têm SELECT anon (§19). Agora o
  // service_role É usado — mas SÓ para as coords, via o helper neutro. Zonas/loja
  // continuam ANON (não regredir privacidade). O teste seguinte trava esse escopo.
  it("[007] usa service_role SÓ para coords (helper) — zonas/loja seguem ANON", async () => {
    await calcularFreteAction({ loja_id: LOJA_ID, cep: CEP_CENTRO, bairro: "Centro" });
    // service_role instanciado e repassado ao helper de coords:
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    expect(distanciaDaLojaAoCep).toHaveBeenCalledWith(serviceClient, LOJA_ID, CEP_CENTRO);
    // ...mas as queries de zonas/loja recebem o client ANON, não o service_role:
    expect(listarZonasComTaxas).toHaveBeenCalledWith(anonClient, LOJA_ID);
    expect(buscarLojaPublicaPorId).toHaveBeenCalledWith(anonClient, LOJA_ID);
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

// ── [007] PREVIEW DE FRETE POR RAIO (raio_km) — distanciaKm derivado server-side
//    via helper neutro distanciaDaLojaAoCep(svc, loja_id, cep), espelhando o
//    autoritativo (criarPedido, 006). A action ATUAL não instancia service_role
//    nem chama o helper nem injeta endereco.distanciaKm → zona raio_km nunca casa.
//    Logo TODOS os casos abaixo são RED até a fase GREEN aplicar o patch.
describe("calcularFreteAction — preview de frete por raio (raio_km) [007]", () => {
  // 1) Loja com coords + CEP + zona raio_km cobrindo a distância → taxa da zona raio.
  it("[007-1] coords + CEP + zona raio_km cobre → taxa_preview = taxa da zona raio; zona_nome = nome da zona", async () => {
    // Só existe zona raio_km (raio_max_km=5, taxa 3,00). Helper resolve 4,7 km
    // (<= 5) → distanciaKm injetado → a zona raio casa em calcularFrete.
    listarZonasComTaxas.mockResolvedValue([zonaRaio(5, 3.0)]);
    distanciaDaLojaAoCep.mockResolvedValue(4.7);

    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: CEP_CENTRO,
    });

    expect(r).toEqual({ ok: true, taxa_preview: 3.0, zona_nome: "Zona Raio 5km" });
    // O helper recebeu o client service_role + loja + cep (RN-7, escopo §19).
    expect(distanciaDaLojaAoCep).toHaveBeenCalledWith(serviceClient, LOJA_ID, CEP_CENTRO);
  });

  // 2) Geocoding null (helper undefined) → zona raio não casa → fallback fora-de-zona,
  //    idêntico ao autoritativo (RN-5 fail-closed).
  it("[007-2] geocoding null (helper undefined) → zona raio NÃO casa → fallback (mesmo do autoritativo)", async () => {
    // Só zona raio_km; loja tem taxa_entrega_fora_zona=15. Helper undefined →
    // distanciaKm ausente → raio não casa → fallback R$ 15 (igual ao criarPedido).
    listarZonasComTaxas.mockResolvedValue([zonaRaio(5, 3.0)]);
    distanciaDaLojaAoCep.mockResolvedValue(undefined);

    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: CEP_CENTRO,
    });

    expect(r).toEqual({ ok: true, taxa_preview: 15, zona_nome: "fora_zona" });
  });

  // 3) Loja SEM coords → helper undefined → comportamento atual inalterado
  //    (zonas tipo='bairro' seguem funcionando normalmente).
  it("[007-3] loja sem coords (helper undefined) → comportamento de bairro inalterado", async () => {
    // Mantém a zona de bairro padrão (Centro 7.50) + helper undefined (sem coords).
    distanciaDaLojaAoCep.mockResolvedValue(undefined);

    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: CEP_CENTRO,
      bairro: "Centro",
    });

    // Resultado IDÊNTICO ao teste de bairro existente: a presença do passo de
    // coords não pode alterar o caminho bairro/faixa_cep.
    expect(r).toEqual({ ok: true, taxa_preview: 7.5, zona_nome: "Zona Central" });
  });

  // 4) PARIDADE preview ↔ criarPedido: mesmo input → mesma taxa, pelos MESMOS args
  //    ao MESMO helper. Espelho EXATO de pedido.test.ts [006-A1]
  //    (distanciaDaLojaAoCep(client, loja_id, cep) → 4.7; zona raio_max_km=5 taxa 3,00).
  it("[007-4] PARIDADE: mesmo input → preview e criarPedido produzem a MESMA taxa (mesmos args ao helper)", async () => {
    listarZonasComTaxas.mockResolvedValue([zonaRaio(5, 3.0)]);
    distanciaDaLojaAoCep.mockResolvedValue(4.7);

    const r = await calcularFreteAction({
      loja_id: LOJA_ID,
      cep: CEP_CENTRO,
    });

    // Mesma taxa que [006-A1] persiste em p_taxa_entrega (3,00).
    expect(r).toEqual({ ok: true, taxa_preview: 3.0, zona_nome: "Zona Raio 5km" });
    // Mesma assinatura de chamada do autoritativo: (clientServiceRole, lojaId, cep).
    expect(distanciaDaLojaAoCep).toHaveBeenCalledTimes(1);
    expect(distanciaDaLojaAoCep).toHaveBeenCalledWith(serviceClient, LOJA_ID, CEP_CENTRO);
  });
});

// ── [005] DEGRADAÇÃO CLARA quando faltam coords da loja (RN-2-C). A action ATUAL
//    colapsa "loja com raio sem coords" e "endereço fora de área" no MESMO
//    zona_nome "indisponivel" → mensagem "tente outro endereço" engana o cliente
//    (nenhum endereço resolveria). RED: esperamos um veredito distinto
//    ("indisponivel_loja") só quando a loja tem zona raio ativa E coords NULL.
describe("calcularFreteAction — degradação coords ausentes (issue 005)", () => {
  it("[005-1] zona raio + coords NULL + SEM fallback → zona_nome 'indisponivel_loja'", async () => {
    listarZonasComTaxas.mockResolvedValue([zonaRaio(5, 3.0)]);
    distanciaDaLojaAoCep.mockResolvedValue(undefined); // sem coords → sem distância
    buscarCoordsLoja.mockResolvedValue(null); // loja sem coords (par NULL)
    buscarLojaPublicaPorId.mockResolvedValue({ id: LOJA_ID, taxa_entrega_fora_zona: null });

    const r = await calcularFreteAction({ loja_id: LOJA_ID, cep: CEP_CENTRO });

    expect(r).toEqual({ ok: true, taxa_preview: 0, zona_nome: "indisponivel_loja" });
  });

  it("[005-2] endereço fora de área (loja COM coords) → 'indisponivel' (mensagem atual inalterada)", async () => {
    listarZonasComTaxas.mockResolvedValue([zonaRaio(5, 3.0)]);
    distanciaDaLojaAoCep.mockResolvedValue(99); // longe demais (> raio 5)
    buscarCoordsLoja.mockResolvedValue({ latitude: -22.96, longitude: -46.54 });
    buscarLojaPublicaPorId.mockResolvedValue({ id: LOJA_ID, taxa_entrega_fora_zona: null });

    const r = await calcularFreteAction({ loja_id: LOJA_ID, cep: CEP_CENTRO });

    expect(r).toEqual({ ok: true, taxa_preview: 0, zona_nome: "indisponivel" });
  });

  it("[005-3] zona raio + coords NULL + COM fallback → 'fora_zona' (atendido, não toca degradação)", async () => {
    listarZonasComTaxas.mockResolvedValue([zonaRaio(5, 3.0)]);
    distanciaDaLojaAoCep.mockResolvedValue(undefined);
    buscarCoordsLoja.mockResolvedValue(null);
    buscarLojaPublicaPorId.mockResolvedValue({ id: LOJA_ID, taxa_entrega_fora_zona: 15 });

    const r = await calcularFreteAction({ loja_id: LOJA_ID, cep: CEP_CENTRO });

    expect(r).toEqual({ ok: true, taxa_preview: 15, zona_nome: "fora_zona" });
  });

  it("[005-4] bairro fora (loja COM coords, sem raio) → 'indisponivel' genérico inalterado", async () => {
    // Só zona bairro; bairro reconciliado fora; sem fallback. Não há raio → nunca
    // é 'indisponivel_loja' mesmo que coords faltassem.
    reconciliarBairroCep.mockResolvedValue({ bairroCanonico: "Longe", reconciliado: true });
    buscarLojaPublicaPorId.mockResolvedValue({ id: LOJA_ID, taxa_entrega_fora_zona: null });

    const r = await calcularFreteAction({ loja_id: LOJA_ID, cep: "99999-999", bairro: "Longe" });

    expect(r).toEqual({ ok: true, taxa_preview: 0, zona_nome: "indisponivel" });
  });
});
