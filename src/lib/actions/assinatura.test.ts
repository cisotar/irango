import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

// =============================================================================
// Fase RED (TDD) — issue 078 (crítica: SIM). Server Actions de assinatura do
// lojista: iniciarAssinatura / trocarPlano / atualizarMeioPagamentoAssinatura /
// cancelarAssinatura. O arquivo `./assinatura` AINDA NÃO EXISTE → a suite falha
// no IMPORT (todo o arquivo vermelho). Quando GREEN criar o módulo como stub que
// `throw`/retorna placeholder, as asserções caem vermelhas por ASSERÇÃO. Ambos
// os estados são RED válido antes do GREEN (executar).
//
// CONTRATO que o GREEN deve satisfazer (Plano Técnico §Decisões / §Cenários):
//
//   type ResultadoAssinatura =
//     | { ok: true }
//     | { ok: true; url: string }     // só atualizarMeioPagamentoAssinatura
//     | { ok: false; erro: string };
//
//   iniciarAssinatura(payload: unknown): Promise<ResultadoAssinatura>
//     1) schemaIniciarAssinatura.safeParse(payload) — SÓ { plano_id }, .strict()
//        rejeita qualquer valor/preço injetado → { ok:false, erro:'Plano inválido.' }
//        SEM tocar banco/provider.
//     2) createClient() [autenticado] → buscarLojaDoDono(client). null →
//        { ok:false, erro:'Loja não encontrada.' } (não-dono / sem sessão).
//     3) GUARD double-init: loja.provider_subscription_id != null →
//        { ok:false, erro:'Assinatura já iniciada.' } SEM tocar o provider.
//     4) createServiceClient() → buscarPlanoAtivo(svc, plano_id). null →
//        { ok:false, erro:'Plano indisponível.' } SEM tocar o provider.
//     5) getBillingProvider(BILLING_PROVIDER).criarAssinatura({ value: plano.preco,
//        plano, loja }) — VALUE vem de planos.preco do BANCO (RN-1), NUNCA do
//        client. Retorna { subscriptionId }.
//     6) persistirAssinaturaLoja(svc, loja.id, { billing_provider,
//        provider_subscription_id: subscriptionId, plano_id }) — NÃO inclui
//        assinatura_status (RN-2). → { ok:true }.
//     7) catch → console.error('[iniciarAssinatura]', e) +
//        { ok:false, erro:'Não foi possível iniciar a assinatura. Tente novamente.' }.
//
//   trocarPlano(payload): igual, mas EXIGE provider_subscription_id existente;
//     ausente → { ok:false, erro:'Nenhuma assinatura ativa para trocar.' }. Chama
//     provider.atualizarAssinatura(...). Não escreve assinatura_status.
//
//   cancelarAssinatura(): sem payload. Sem provider_subscription_id →
//     { ok:false, erro:'Nenhuma assinatura para cancelar.' }. Caso feliz:
//     provider.cancelarAssinatura(subId) e { ok:true } — NÃO otimista, NÃO escreve
//     assinatura_status nem chama persistirAssinaturaLoja (RN-7).
//
//   atualizarMeioPagamentoAssinatura(): sem payload. Sem provider_subscription_id
//     → { ok:false, erro:'Nenhuma assinatura ativa.' }. Caso feliz:
//     { ok:true, url } com a URL do checkout hospedado do provider (RN-11).
// =============================================================================

// --- next/headers fora de request scope: mock (actions futuras podem usar). ---
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-real-ip": "127.0.0.1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// --- Clients Supabase: server-only → mock. Retornam sentinelas distinguíveis. ---
const clientAutenticado = { __fake: "auth-client" };
const clientServico = { __fake: "service-client" };
const createClient = vi.fn(async () => clientAutenticado);
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// --- Queries (I/O de banco): mockadas — testamos ORQUESTRAÇÃO, não o banco. ---
const buscarLojaDoDono = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const buscarPlanoAtivo = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const persistirAssinaturaLoja = vi.fn<(...a: unknown[]) => Promise<void>>();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
  persistirAssinaturaLoja: (...a: unknown[]) => persistirAssinaturaLoja(...a),
}));
vi.mock("@/lib/supabase/queries/planos", () => ({
  buscarPlanoAtivo: (...a: unknown[]) => buscarPlanoAtivo(...a),
}));

// --- Provider de billing (I/O Asaas): mockado — nunca bate na rede real. ---
const criarAssinatura = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const atualizarAssinatura = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const cancelarAssinatura = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const urlMeioPagamento = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const provider = {
  criarAssinatura: (...a: unknown[]) => criarAssinatura(...(a as [unknown])),
  atualizarAssinatura: (...a: unknown[]) => atualizarAssinatura(...(a as [unknown])),
  cancelarAssinatura: (...a: unknown[]) => cancelarAssinatura(...(a as [unknown])),
  urlMeioPagamento: (...a: unknown[]) => urlMeioPagamento(...(a as [unknown])),
};
const getBillingProvider = vi.fn((..._a: unknown[]) => provider);
vi.mock("@/lib/billing/providers", () => ({
  getBillingProvider: (...a: unknown[]) => getBillingProvider(...(a as [string])),
  nomeProviderBillingAtivo: () => process.env.BILLING_PROVIDER ?? "asaas",
  providerBillingAtivo: () =>
    getBillingProvider(process.env.BILLING_PROVIDER ?? "asaas"),
}));

// 'use server' é só diretiva; importável em teste node. Este import FALHA hoje
// (módulo inexistente) — RED por import, conforme cabeçalho.
import {
  iniciarAssinatura,
  trocarPlano,
  cancelarAssinatura as cancelarAssinaturaAction,
  atualizarMeioPagamentoAssinatura,
} from "./assinatura";

const LOJA_A = "11111111-1111-1111-1111-111111111111";
const PLANO_ID = "22222222-2222-2222-2222-222222222222";
const SUB_ID = "sub_asaas_999";

// Loja do dono autenticado. Por padrão SEM assinatura (provider_subscription_id
// null) — permite iniciar. `over` controla o estado de billing por teste.
function lojaRow(over: Partial<Tables<"lojas">> = {}): Tables<"lojas"> {
  return {
    id: LOJA_A,
    dono_id: "dono-a",
    nome: "Loja A",
    slug: "loja-a",
    ativo: true,
    assinatura_status: "trial",
    assinatura_inicio: null,
    assinatura_fim_periodo: null,
    assinatura_atualizada_em: null,
    billing_provider: null,
    provider_subscription_id: null,
    plano_id: null,
    hotmart_subscriber_code: null,
    hotmart_plano: null,
    consentimento_em: null,
    consentimento_versao: null,
    criado_em: "2026-01-01T00:00:00.000Z",
    atualizado_em: "2026-01-01T00:00:00.000Z",
    endereco_bairro: null,
    endereco_cep: null,
    endereco_cidade: null,
    endereco_estado: null,
    endereco_numero: null,
    endereco_rua: null,
    horarios: {},
    latitude: null,
    longitude: null,
    logo_url: null,
    taxa_entrega_fora_zona: null,
    telefone: null,
    whatsapp: null,
    whatsapp_envio_automatico: true,
    timezone: "America/Sao_Paulo",
    ...over,
  } as Tables<"lojas">;
}

// Plano ativo R$ 49,00. `preco` é o valor AUTORITATIVO (RN-1).
function planoRow(over: Partial<Tables<"planos">> = {}): Tables<"planos"> {
  return {
    id: PLANO_ID,
    nome: "Plano Mensal",
    preco: 49,
    intervalo: "mensal",
    provider_price_id: null,
    ativo: true,
    criado_em: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // defaults do caminho feliz; cada teste sobrescreve o que precisa.
  buscarLojaDoDono.mockResolvedValue(lojaRow());
  buscarPlanoAtivo.mockResolvedValue(planoRow());
  criarAssinatura.mockResolvedValue({ subscriptionId: SUB_ID });
  atualizarAssinatura.mockResolvedValue({ subscriptionId: SUB_ID });
  cancelarAssinatura.mockResolvedValue({ ok: true });
  urlMeioPagamento.mockResolvedValue({ url: "https://asaas.com/checkout/abc" });
});

// ───────────────────────────── iniciarAssinatura ────────────────────────────
describe("iniciarAssinatura — caminho feliz e contrato de orquestração", () => {
  it("plano_id válido → cria no provider e persiste subscriptionId via service_role", async () => {
    const r = await iniciarAssinatura({ plano_id: PLANO_ID });

    expect(r).toEqual({ ok: true });

    // Provider chamado com o VALOR vindo do BANCO (planos.preco), não do client.
    expect(criarAssinatura).toHaveBeenCalledTimes(1);
    const arg = criarAssinatura.mock.calls[0][0] as { value: number };
    expect(arg.value).toBe(49);

    // Persistência via SERVICE_ROLE, escopada na loja do dono, com o subId do provider.
    expect(persistirAssinaturaLoja).toHaveBeenCalledTimes(1);
    const [clientArg, lojaIdArg, dadosArg] = persistirAssinaturaLoja.mock
      .calls[0] as unknown as [unknown, string, Record<string, unknown>];
    expect(clientArg).toBe(clientServico);
    expect(lojaIdArg).toBe(LOJA_A);
    expect(dadosArg.provider_subscription_id).toBe(SUB_ID);
    expect(dadosArg.plano_id).toBe(PLANO_ID);
  });

  it("preço cobrado vem do BANCO mesmo com plano de preço alto — nunca do client", async () => {
    buscarPlanoAtivo.mockResolvedValue(planoRow({ preco: 149 }));
    await iniciarAssinatura({ plano_id: PLANO_ID });
    const arg = criarAssinatura.mock.calls[0][0] as { value: number };
    expect(arg.value).toBe(149);
  });

  it("lê o preço de planos.preco escopado por plano_id ATIVO (RN-1)", async () => {
    await iniciarAssinatura({ plano_id: PLANO_ID });
    expect(buscarPlanoAtivo).toHaveBeenCalledWith(clientServico, PLANO_ID);
  });

  it("NÃO escreve assinatura_status (RN-2) — status é só do webhook", async () => {
    await iniciarAssinatura({ plano_id: PLANO_ID });
    const dados = persistirAssinaturaLoja.mock.calls[0][2] as unknown as Record<
      string,
      unknown
    >;
    expect(dados).not.toHaveProperty("assinatura_status");
  });
});

describe("iniciarAssinatura — recálculo/anti-injeção de valor (RN-1, §10)", () => {
  it("ATAQUE: client envia `preco` além de plano_id → .strict() rejeita SEM tocar provider/banco", async () => {
    const r = await iniciarAssinatura({ plano_id: PLANO_ID, preco: 1 });
    expect(r).toEqual({ ok: false, erro: "Plano inválido." });
    expect(buscarPlanoAtivo).not.toHaveBeenCalled();
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("ATAQUE: client envia `value` → .strict() rejeita SEM tocar provider/banco", async () => {
    const r = await iniciarAssinatura({ plano_id: PLANO_ID, value: 0.01 });
    expect(r).toEqual({ ok: false, erro: "Plano inválido." });
    expect(criarAssinatura).not.toHaveBeenCalled();
  });

  it("ATAQUE: plano_id não-UUID → inválido SEM tocar provider/banco", async () => {
    const r = await iniciarAssinatura({ plano_id: "não-uuid" });
    expect(r).toEqual({ ok: false, erro: "Plano inválido." });
    expect(buscarPlanoAtivo).not.toHaveBeenCalled();
    expect(criarAssinatura).not.toHaveBeenCalled();
  });
});

describe("iniciarAssinatura — posse e isolamento entre lojas", () => {
  it("ATAQUE: usuário não-dono / sem loja → 'Loja não encontrada' SEM tocar provider", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await iniciarAssinatura({ plano_id: PLANO_ID });
    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("usa o client AUTENTICADO para derivar a loja (RLS dono_id), nunca o payload", async () => {
    await iniciarAssinatura({ plano_id: PLANO_ID });
    expect(buscarLojaDoDono).toHaveBeenCalledWith(clientAutenticado);
  });
});

describe("iniciarAssinatura — bordas", () => {
  it("plano inativo/inexistente → 'Plano indisponível.' SEM tocar provider", async () => {
    buscarPlanoAtivo.mockResolvedValue(null);
    const r = await iniciarAssinatura({ plano_id: PLANO_ID });
    expect(r).toEqual({ ok: false, erro: "Plano indisponível." });
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("double-init: já existe provider_subscription_id → 'Assinatura já iniciada.' SEM tocar provider", async () => {
    buscarLojaDoDono.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));
    const r = await iniciarAssinatura({ plano_id: PLANO_ID });
    expect(r).toEqual({ ok: false, erro: "Assinatura já iniciada." });
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("provider lança → erro genérico + log [iniciarAssinatura], sem vazar e.message (§14)", async () => {
    const erro = new Error("ASAAS 500: token sk_live_SEGREDO inválido");
    criarAssinatura.mockRejectedValue(erro);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await iniciarAssinatura({ plano_id: PLANO_ID });

    expect(r).toEqual({
      ok: false,
      erro: "Não foi possível iniciar a assinatura. Tente novamente.",
    });
    expect(spy).toHaveBeenCalledWith("[iniciarAssinatura]", erro);
    expect(JSON.stringify(r)).not.toContain("SEGREDO");
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─────────────────────────────── trocarPlano ────────────────────────────────
describe("trocarPlano", () => {
  it("sem assinatura ativa (provider_subscription_id null) → erro SEM tocar provider", async () => {
    buscarLojaDoDono.mockResolvedValue(lojaRow({ provider_subscription_id: null }));
    const r = await trocarPlano({ plano_id: PLANO_ID });
    expect(r).toEqual({ ok: false, erro: "Nenhuma assinatura ativa para trocar." });
    expect(atualizarAssinatura).not.toHaveBeenCalled();
  });

  it("com assinatura ativa → atualiza no provider com o preço do BANCO (RN-1), não escreve status", async () => {
    buscarLojaDoDono.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));
    buscarPlanoAtivo.mockResolvedValue(planoRow({ preco: 79 }));

    const r = await trocarPlano({ plano_id: PLANO_ID });

    expect(r).toEqual({ ok: true });
    expect(atualizarAssinatura).toHaveBeenCalledTimes(1);
    const arg = atualizarAssinatura.mock.calls[0][0] as { value: number };
    expect(arg.value).toBe(79);
    // RN-2: se persistir, não pode carregar assinatura_status.
    if (persistirAssinaturaLoja.mock.calls.length > 0) {
      const dados = persistirAssinaturaLoja.mock.calls[0][2] as unknown as Record<
        string,
        unknown
      >;
      expect(dados).not.toHaveProperty("assinatura_status");
    }
  });

  it("ATAQUE: value injetado → .strict() rejeita SEM tocar provider", async () => {
    buscarLojaDoDono.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));
    const r = await trocarPlano({ plano_id: PLANO_ID, value: 0.01 });
    expect(r).toEqual({ ok: false, erro: "Plano inválido." });
    expect(atualizarAssinatura).not.toHaveBeenCalled();
  });
});

// ──────────────────────────── cancelarAssinatura ────────────────────────────
describe("cancelarAssinatura — RN-7 (não otimista)", () => {
  it("solicita o cancelamento ao provider e NÃO muda assinatura_status localmente", async () => {
    buscarLojaDoDono.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));

    const r = await cancelarAssinaturaAction();

    expect(r).toEqual({ ok: true });
    // Pediu ao provider, com o id da assinatura.
    expect(cancelarAssinatura).toHaveBeenCalledTimes(1);
    expect(cancelarAssinatura).toHaveBeenCalledWith(SUB_ID);
    // RN-7: NÃO escreve status local — nenhuma persistência de billing aqui
    // (o webhook é a autoridade de 'cancelada').
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("sem assinatura → 'Nenhuma assinatura para cancelar.' SEM tocar provider", async () => {
    buscarLojaDoDono.mockResolvedValue(lojaRow({ provider_subscription_id: null }));
    const r = await cancelarAssinaturaAction();
    expect(r).toEqual({ ok: false, erro: "Nenhuma assinatura para cancelar." });
    expect(cancelarAssinatura).not.toHaveBeenCalled();
  });

  it("não-dono → 'Loja não encontrada' SEM tocar provider", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await cancelarAssinaturaAction();
    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(cancelarAssinatura).not.toHaveBeenCalled();
  });
});

// ─────────────────── atualizarMeioPagamentoAssinatura (RN-11) ────────────────
describe("atualizarMeioPagamentoAssinatura — retorna URL hospedada (RN-11)", () => {
  it("com assinatura → { ok:true, url } do checkout hospedado do provider", async () => {
    buscarLojaDoDono.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));
    const r = await atualizarMeioPagamentoAssinatura();
    expect(r).toEqual({ ok: true, url: "https://asaas.com/checkout/abc" });
    expect(urlMeioPagamento).toHaveBeenCalledWith(SUB_ID);
  });

  it("sem assinatura → erro SEM tocar provider", async () => {
    buscarLojaDoDono.mockResolvedValue(lojaRow({ provider_subscription_id: null }));
    const r = await atualizarMeioPagamentoAssinatura();
    expect(r).toEqual({ ok: false, erro: "Nenhuma assinatura ativa." });
    expect(urlMeioPagamento).not.toHaveBeenCalled();
  });
});
