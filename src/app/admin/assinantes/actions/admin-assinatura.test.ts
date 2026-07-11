import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Fase RED (TDD) — issue 151 (crítica: SIM). Server Actions ADMIN de billing-intent
// em `./admin-assinatura`: iniciarAssinaturaAdmin / trocarPlanoAdmin /
// atualizarMeioPagamentoAssinaturaAdmin / cancelarAssinaturaAdmin. É a variante
// ESCOPADA POR `lojaId` das actions do lojista (078) — o dono do SaaS opera a
// assinatura da LOJA-ALVO, nunca a própria.
//
// RED de HOJE: o módulo `./admin-assinatura` AINDA NÃO EXISTE (a fase GREEN/`executar`
// o cria) → o import falha e a suíte inteira reprova com ERR_MODULE_NOT_FOUND.
// Quando o GREEN existir como stub, as asserções caem vermelhas por ASSERÇÃO. Ambos
// os estados são RED válido antes do GREEN.
//
// CONTRATO que o GREEN deve satisfazer (Plano Técnico §Cenários):
//
//   type Resultado =
//     | { ok: true }
//     | { ok: true; url: string }     // só atualizarMeioPagamentoAssinaturaAdmin
//     | { ok: false; erro: string };
//
//   iniciarAssinaturaAdmin(lojaId: string, payload: unknown): Promise<Resultado>
//     1) validarLojaIdAdmin(lojaId) — não-UUID → { ok:false, erro:'Loja inválida.' }
//        ANTES de admin/service/provider/DB.
//     2) iniciarAssinaturaSchema.safeParse(payload) — SÓ { plano_id }, .strict()
//        rejeita preco/value injetado → { ok:false, erro:'Plano inválido.' } SEM
//        elevar admin nem tocar service/provider/DB.
//     3) prepararContextoAdmin(lojaId) FORA do try — verificarAdminSaaS() FALHA →
//        exceção PROPAGA (fail-closed D-4); svc NUNCA nasce.
//     4) buscarLojaAdminPorId(svc, lojaId) [loja-ALVO por id, NUNCA buscarLojaDoDono].
//        null → { ok:false, erro:'Loja não encontrada.' }.
//     5) GUARD double-init: loja.provider_subscription_id != null →
//        { ok:false, erro:'Assinatura já iniciada.' } SEM tocar provider.
//     6) buscarPlanoAtivo(svc, plano_id). null → { ok:false, erro:'Plano indisponível.' }.
//     7) provider().criarAssinatura({ value: plano.preco, plano, loja }) — VALUE do
//        BANCO (RN-1), NUNCA do payload. loja.email = resolverEmailDoDono(svc,
//        loja.dono_id) — e-mail do DONO-ALVO, NUNCA do admin autenticado.
//     8) persistirAssinaturaLoja(svc, loja.id, { billing_provider,
//        provider_subscription_id, plano_id }) — SEM assinatura_status/valor (RN-2/7).
//     9) → { ok:true }. catch → console.error + genérico.
//
//   trocarPlanoAdmin(lojaId, payload): igual, mas EXIGE provider_subscription_id !=
//     null (== null → 'Nenhuma assinatura ativa para trocar.'); chama
//     provider().atualizarAssinatura({ subscriptionId, value: plano.preco, ... }).
//
//   atualizarMeioPagamentoAssinaturaAdmin(lojaId): sem payload. == null →
//     'Nenhuma assinatura ativa.'. Feliz: { ok:true, url } — NÃO persiste.
//
//   cancelarAssinaturaAdmin(lojaId): sem payload. == null → 'Nenhuma assinatura
//     para cancelar.'. Feliz: provider().cancelarAssinatura(subId) e { ok:true } —
//     NÃO otimista: NÃO chama persistirAssinaturaLoja (status só pelo webhook 077).
//
// Alvo do GREEN: src/app/admin/assinantes/actions/admin-assinatura.ts
// =============================================================================

const LOJA_A = "11111111-1111-1111-1111-111111111111";
// Loja de OUTRO tenant: nenhum arg de nenhuma action pode carregar este id.
const LOJA_B = "99999999-9999-9999-9999-999999999999";
const PLANO_ID = "33333333-3333-3333-3333-333333333333";
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SUB_ID = "sub_existente_abc";
const SUB_NEW = "sub_new";
const EMAIL_DONO_ALVO = "dono-alvo@x.com";

// ── next/cache: revalidatePath fora de request scope → mock. ──────────────────
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ── verificarAdminSaaS: prova de admin (chamada DENTRO de prepararContextoAdmin,
//    que é REAL). Default resolve; negação via mockRejectedValueOnce. ──────────
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. `svc` é MARCADOR opaco: toda
//    leitura/escrita passa por queries MOCKADAS, então o builder não precisa ser
//    real. Porém prepararContextoAdmin (REAL) monta `criarEscopoLoja(svc, ...)`,
//    que faz `svc.from.bind(svc)` na construção — por isso o marcador expõe `from`
//    (stub) para não estourar no bind. `auth.getUser` é espião: prova que o e-mail
//    do provider NUNCA sai de `svc.auth.getUser()` (viria o e-mail do admin). ──
const getUser = vi.fn();
const clientServico = {
  marker: "svc",
  from: () => ({}),
  auth: { getUser: (...a: unknown[]) => getUser(...a) },
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── admin-loja REAL (validarLojaIdAdmin/prepararContextoAdmin/revalidarLojaAdmin):
//    o z.guid() e o fail-closed de verdade são exercitados. Só `registrarAcessoAdmin`
//    vira no-op (fire-and-forget, não é o sob-teste). ─────────────────────────
vi.mock("@/lib/actions/admin-loja", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, registrarAcessoAdmin: vi.fn() };
});

// ── Queries (I/O de banco): mockadas — testamos ORQUESTRAÇÃO, não o banco.
//    `buscarLojaDoDono` incluído SÓ para provar que a action NUNCA o usa (a loja-alvo
//    vem de buscarLojaAdminPorId por lojaId, jamais de auth.uid()). ────────────
const buscarLojaAdminPorId = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const persistirAssinaturaLoja = vi.fn<(...a: unknown[]) => Promise<void>>();
const resolverEmailDoDono = vi.fn<(...a: unknown[]) => Promise<string | null>>();
const buscarLojaDoDono = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const buscarPlanoAtivo = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaAdminPorId: (...a: unknown[]) => buscarLojaAdminPorId(...a),
  persistirAssinaturaLoja: (...a: unknown[]) => persistirAssinaturaLoja(...a),
  resolverEmailDoDono: (...a: unknown[]) => resolverEmailDoDono(...a),
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));
vi.mock("@/lib/supabase/queries/planos", () => ({
  buscarPlanoAtivo: (...a: unknown[]) => buscarPlanoAtivo(...a),
}));

// ── Provider de billing (I/O Asaas): mockado — nunca bate na rede real. ───────
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

// REAL (não mockar): iniciarAssinaturaSchema — o `.strict()` precisa rodar de
// verdade para provar a rejeição de preco/value injetado.

// 'use server' é só diretiva; o módulo é importável no runner node. HOJE ele não
// existe → ERR_MODULE_NOT_FOUND (RED). GREEN cria o arquivo com o contrato acima.
import {
  iniciarAssinaturaAdmin,
  trocarPlanoAdmin,
  atualizarMeioPagamentoAssinaturaAdmin,
  cancelarAssinaturaAdmin,
} from "./admin-assinatura";

// Loja-alvo mínima (só os campos que a action lê). Por padrão SEM assinatura
// (provider_subscription_id null) → permite iniciar. `over` controla o estado.
type LojaAlvo = {
  id: string;
  dono_id: string;
  nome: string;
  provider_subscription_id: string | null;
  plano_id: string | null;
};
function lojaRow(over: Partial<LojaAlvo> = {}): LojaAlvo {
  return {
    id: LOJA_A,
    dono_id: DONO_A,
    nome: "Loja A",
    provider_subscription_id: null,
    plano_id: null,
    ...over,
  };
}

// Plano ativo. `preco` é o valor AUTORITATIVO (RN-1) — nunca vem do payload.
type PlanoAlvo = {
  id: string;
  preco: number;
  intervalo: string;
  provider_price_id: string | null;
};
function planoRow(over: Partial<PlanoAlvo> = {}): PlanoAlvo {
  return { id: PLANO_ID, preco: 49.9, intervalo: "mensal", provider_price_id: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  verificarAdminSaaS.mockResolvedValue(undefined);
  buscarLojaAdminPorId.mockResolvedValue(lojaRow());
  buscarPlanoAtivo.mockResolvedValue(planoRow());
  resolverEmailDoDono.mockResolvedValue(EMAIL_DONO_ALVO);
  persistirAssinaturaLoja.mockResolvedValue(undefined);
  criarAssinatura.mockResolvedValue({ subscriptionId: SUB_NEW });
  atualizarAssinatura.mockResolvedValue({ subscriptionId: SUB_ID });
  cancelarAssinatura.mockResolvedValue({ ok: true });
  urlMeioPagamento.mockResolvedValue({ url: "https://provider/x" });
});

// ═══════════════════════════ (a) ISOLAMENTO CROSS-LOJA ═══════════════════════
describe("(a) isolamento cross-loja — loja-alvo resolvida por lojaId, nunca por auth.uid()", () => {
  it("iniciarAssinaturaAdmin(LOJA_A) resolve a loja por buscarLojaAdminPorId(svc, LOJA_A) e persiste em LOJA_A", async () => {
    const r = await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });

    expect(r).toEqual({ ok: true });
    // Loja-alvo lida por id, com o service client (svc), NÃO por auth.uid().
    expect(buscarLojaAdminPorId).toHaveBeenCalledTimes(1);
    expect(buscarLojaAdminPorId).toHaveBeenCalledWith(clientServico, LOJA_A);
    // Persistência escopada em LOJA_A (loja.id do retorno de buscarLojaAdminPorId).
    const [clientArg, lojaIdArg] = persistirAssinaturaLoja.mock.calls[0] as unknown as [
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(clientArg).toBe(clientServico);
    expect(lojaIdArg).toBe(LOJA_A);
  });

  it("NUNCA usa buscarLojaDoDono (derivaria a loja do PRÓPRIO admin — bug de isolamento)", async () => {
    await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
  });

  it("nenhum arg de nenhum spy carrega LOJA_B (o outro tenant nunca é tocado)", async () => {
    await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });
    const chamadas = [
      ...buscarLojaAdminPorId.mock.calls,
      ...persistirAssinaturaLoja.mock.calls,
      ...buscarPlanoAtivo.mock.calls,
      ...resolverEmailDoDono.mock.calls,
      ...criarAssinatura.mock.calls,
    ];
    expect(JSON.stringify(chamadas)).not.toContain(LOJA_B);
  });

  it("lojaId não-UUID → { ok:false, erro:'Loja inválida.' } SEM tocar admin/service/provider/DB", async () => {
    const r = await iniciarAssinaturaAdmin("nao-e-uuid", { plano_id: PLANO_ID });

    expect(r).toEqual({ ok: false, erro: "Loja inválida." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("fail-closed D-4: verificarAdminSaaS lança → PROPAGA (não vira { ok:false }); svc nunca nasce, nada é escrito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(
      iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID }),
    ).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("cancelarAssinaturaAdmin(LOJA_A) → provider keyed pela sub da loja-alvo (LOJA_A), nunca LOJA_B", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));

    const r = await cancelarAssinaturaAdmin(LOJA_A);

    expect(r).toEqual({ ok: true });
    expect(buscarLojaAdminPorId).toHaveBeenCalledWith(clientServico, LOJA_A);
    expect(cancelarAssinatura).toHaveBeenCalledWith(SUB_ID);
  });
});

// ═══════════════════════ (b) PREÇO DO BANCO / .strict() ══════════════════════
describe("(b) preço do banco — .strict() barra preco/value injetado; value = planos.preco", () => {
  it("ATAQUE payload { plano_id, preco } → { ok:false, erro:'Plano inválido.' } antes de admin/service/provider/DB", async () => {
    const r = await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID, preco: 1 });

    expect(r).toEqual({ ok: false, erro: "Plano inválido." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarPlanoAtivo).not.toHaveBeenCalled();
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("ATAQUE payload { plano_id, value } → { ok:false, erro:'Plano inválido.' } sem tocar provider/DB", async () => {
    const r = await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID, value: 0.01 });

    expect(r).toEqual({ ok: false, erro: "Plano inválido." });
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("ATAQUE plano_id não-UUID → { ok:false, erro:'Plano inválido.' } sem tocar provider/DB", async () => {
    const r = await iniciarAssinaturaAdmin(LOJA_A, { plano_id: "nao-uuid" });

    expect(r).toEqual({ ok: false, erro: "Plano inválido." });
    expect(buscarPlanoAtivo).not.toHaveBeenCalled();
    expect(criarAssinatura).not.toHaveBeenCalled();
  });

  it("iniciar happy → criarAssinatura recebe value === planos.preco (49.9), NUNCA valor do payload", async () => {
    await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });

    expect(criarAssinatura).toHaveBeenCalledTimes(1);
    const arg = criarAssinatura.mock.calls[0][0] as { value: number };
    expect(arg.value).toBe(49.9);
    // Lido de planos.preco escopado por plano_id ativo, com o service client.
    expect(buscarPlanoAtivo).toHaveBeenCalledWith(clientServico, PLANO_ID);
  });

  it("preço vem do BANCO mesmo com plano de preço alto — nunca do cliente", async () => {
    buscarPlanoAtivo.mockResolvedValue(planoRow({ preco: 149 }));
    await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });
    const arg = criarAssinatura.mock.calls[0][0] as { value: number };
    expect(arg.value).toBe(149);
  });

  it("trocarPlanoAdmin happy → atualizarAssinatura recebe value === planos.preco, keyed pelo subscriptionId existente", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));
    buscarPlanoAtivo.mockResolvedValue(planoRow({ preco: 79 }));

    const r = await trocarPlanoAdmin(LOJA_A, { plano_id: PLANO_ID });

    expect(r).toEqual({ ok: true });
    expect(atualizarAssinatura).toHaveBeenCalledTimes(1);
    const arg = atualizarAssinatura.mock.calls[0][0] as { value: number; subscriptionId: string };
    expect(arg.value).toBe(79);
    expect(arg.subscriptionId).toBe(SUB_ID);
  });

  it("trocarPlanoAdmin ATAQUE value injetado → { ok:false, erro:'Plano inválido.' } sem tocar provider", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));
    const r = await trocarPlanoAdmin(LOJA_A, { plano_id: PLANO_ID, value: 0.01 });
    expect(r).toEqual({ ok: false, erro: "Plano inválido." });
    expect(atualizarAssinatura).not.toHaveBeenCalled();
  });
});

// ══════════════════ (c) assinatura_status NUNCA ESCRITO (RN-2/RN-7) ══════════
describe("(c) assinatura_status nunca escrito — só o webhook 077 é autoridade", () => {
  it("iniciar happy → patch de persistirAssinaturaLoja é EXATAMENTE { billing_provider, provider_subscription_id, plano_id }", async () => {
    await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });

    expect(persistirAssinaturaLoja).toHaveBeenCalledTimes(1);
    const dados = persistirAssinaturaLoja.mock.calls[0][2] as Record<string, unknown>;

    // Somente billing-intent: nenhuma coluna de status/valor.
    expect(Object.keys(dados).sort()).toEqual(
      ["billing_provider", "plano_id", "provider_subscription_id"].sort(),
    );
    expect(dados.provider_subscription_id).toBe(SUB_NEW);
    expect(dados.plano_id).toBe(PLANO_ID);
    expect(dados).not.toHaveProperty("assinatura_status");
    expect(dados).not.toHaveProperty("assinatura_inicio");
    expect(dados).not.toHaveProperty("valor");
  });

  it("cancelarAssinaturaAdmin → chama provider().cancelarAssinatura e NÃO persiste (não otimista, RN-7)", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));

    const r = await cancelarAssinaturaAdmin(LOJA_A);

    expect(r).toEqual({ ok: true });
    expect(cancelarAssinatura).toHaveBeenCalledTimes(1);
    expect(cancelarAssinatura).toHaveBeenCalledWith(SUB_ID);
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("atualizarMeioPagamentoAssinaturaAdmin → { ok:true, url } do provider e NÃO persiste (não muda estado, RN-11)", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));

    const r = await atualizarMeioPagamentoAssinaturaAdmin(LOJA_A);

    expect(r).toEqual({ ok: true, url: "https://provider/x" });
    expect(urlMeioPagamento).toHaveBeenCalledWith(SUB_ID);
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });
});

// ══════════════════════ (d) E-MAIL DO DONO-ALVO ══════════════════════════════
describe("(d) e-mail do provider = e-mail do DONO da loja-alvo, nunca do admin autenticado", () => {
  it("iniciar happy → resolverEmailDoDono(svc, loja.dono_id) e criarAssinatura recebe loja.email = e-mail resolvido", async () => {
    await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });

    expect(resolverEmailDoDono).toHaveBeenCalledWith(clientServico, DONO_A);
    const arg = criarAssinatura.mock.calls[0][0] as { loja: { id: string; email: string } };
    expect(arg.loja.email).toBe(EMAIL_DONO_ALVO);
    expect(arg.loja.id).toBe(LOJA_A);
  });

  it("NÃO deriva o e-mail de svc.auth.getUser() (viria o e-mail do admin logado)", async () => {
    await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("trocarPlanoAdmin happy → atualizarAssinatura recebe loja.email do dono-alvo", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));

    await trocarPlanoAdmin(LOJA_A, { plano_id: PLANO_ID });

    expect(resolverEmailDoDono).toHaveBeenCalledWith(clientServico, DONO_A);
    const arg = atualizarAssinatura.mock.calls[0][0] as { loja: { email: string } };
    expect(arg.loja.email).toBe(EMAIL_DONO_ALVO);
  });
});

// ═══════════════════════ GUARDS DE ESTADO (bordas por action) ════════════════
describe("guards de estado — double-init e exigência de assinatura ativa", () => {
  it("iniciar com provider_subscription_id != null → 'Assinatura já iniciada.' SEM tocar provider/persist", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: SUB_ID }));

    const r = await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });

    expect(r).toEqual({ ok: false, erro: "Assinatura já iniciada." });
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  it("trocarPlanoAdmin sem assinatura ativa (== null) → 'Nenhuma assinatura ativa para trocar.' SEM provider", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: null }));
    const r = await trocarPlanoAdmin(LOJA_A, { plano_id: PLANO_ID });
    expect(r).toEqual({ ok: false, erro: "Nenhuma assinatura ativa para trocar." });
    expect(atualizarAssinatura).not.toHaveBeenCalled();
  });

  it("atualizarMeioPagamentoAssinaturaAdmin sem assinatura (== null) → 'Nenhuma assinatura ativa.' SEM provider", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: null }));
    const r = await atualizarMeioPagamentoAssinaturaAdmin(LOJA_A);
    expect(r).toEqual({ ok: false, erro: "Nenhuma assinatura ativa." });
    expect(urlMeioPagamento).not.toHaveBeenCalled();
  });

  it("cancelarAssinaturaAdmin sem assinatura (== null) → 'Nenhuma assinatura para cancelar.' SEM provider", async () => {
    buscarLojaAdminPorId.mockResolvedValue(lojaRow({ provider_subscription_id: null }));
    const r = await cancelarAssinaturaAdmin(LOJA_A);
    expect(r).toEqual({ ok: false, erro: "Nenhuma assinatura para cancelar." });
    expect(cancelarAssinatura).not.toHaveBeenCalled();
  });

  it("iniciar com loja inexistente (buscarLojaAdminPorId → null) → 'Loja não encontrada.' SEM provider", async () => {
    buscarLojaAdminPorId.mockResolvedValue(null);
    const r = await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });
    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });

  // As 3 actions abaixo repetem o MESMO guard `if (loja == null)` copiado de
  // iniciarAssinaturaAdmin — cada uma precisa do seu próprio teste, senão um
  // guard removido só em UMA delas não quebra nada (o teste acima só cobre
  // iniciar; sem `loja` a linha seguinte de cada action acessaria
  // `loja.provider_subscription_id` de `null` e cairia no catch genérico).
  it("trocarPlanoAdmin com loja inexistente → 'Loja não encontrada.' SEM provider", async () => {
    buscarLojaAdminPorId.mockResolvedValue(null);
    const r = await trocarPlanoAdmin(LOJA_A, { plano_id: PLANO_ID });
    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(atualizarAssinatura).not.toHaveBeenCalled();
  });

  it("atualizarMeioPagamentoAssinaturaAdmin com loja inexistente → 'Loja não encontrada.' SEM provider", async () => {
    buscarLojaAdminPorId.mockResolvedValue(null);
    const r = await atualizarMeioPagamentoAssinaturaAdmin(LOJA_A);
    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(urlMeioPagamento).not.toHaveBeenCalled();
  });

  it("cancelarAssinaturaAdmin com loja inexistente → 'Loja não encontrada.' SEM provider", async () => {
    buscarLojaAdminPorId.mockResolvedValue(null);
    const r = await cancelarAssinaturaAdmin(LOJA_A);
    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(cancelarAssinatura).not.toHaveBeenCalled();
  });

  it("iniciar com plano inativo/inexistente (buscarPlanoAtivo → null) → 'Plano indisponível.' SEM provider", async () => {
    buscarPlanoAtivo.mockResolvedValue(null);
    const r = await iniciarAssinaturaAdmin(LOJA_A, { plano_id: PLANO_ID });
    expect(r).toEqual({ ok: false, erro: "Plano indisponível." });
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(persistirAssinaturaLoja).not.toHaveBeenCalled();
  });
});
