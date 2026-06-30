import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 092 (crítica: SIM, red-first). Server Action admin
 * `salvarPerfilAdmin(lojaId, payload)` em `./admin-perfil` — variante admin de
 * salvar perfil/endereço da loja-alvo, com a allowlist compartilhada (RN-7) e
 * geocoding server-side (RN-9), escopada por `lojaId` (RN-3).
 *
 * Por que é RED de verdade HOJE: o módulo `./admin-perfil` traz apenas o STUB
 * `salvarPerfilAdmin` que lança `Error("TODO: GREEN")`. O import resolve (não
 * mascara a asserção por import quebrado), mas TODA chamada explode no stub →
 * cada caso falha na ASSERÇÃO do comportamento esperado. Output real do FAIL
 * anexado na issue. A fase GREEN (`executar`) substitui o stub.
 *
 * Invariantes provadas (specs/admin-onboarding-assistido.md, issue 092):
 *  1. ALLOWLIST RN-7: payload hostil tentando setar `ativo`/`dono_id`/
 *     `assinatura_status`/`hotmart_*`/`consentimento_*`/`latitude`/`longitude`
 *     → o patch enviado ao 1º UPDATE NÃO contém nenhuma dessas chaves (usa
 *     `montarPatchPerfil`). Provado inspecionando o patch capturado no `.update()`.
 *  2. slug ocupado por OUTRA loja (`slugExiste(svc, slug, lojaId)` → true) →
 *     `{ ok:false }`, sem UPDATE.
 *  3. admin não provado (`verificarAdminSaaS` lança) → exceção PROPAGA
 *     (fail-closed), zero efeito (sem service client, sem slugExiste, sem UPDATE).
 *  4. sucesso: 1º UPDATE grava endereço (allowlist) escopado `eq("id", lojaId)`;
 *     2º UPDATE grava o par latitude/longitude escopado `eq("id", lojaId)`; em
 *     geocoding falho (best-effort) grava o par NULL sem rebaixar o salvamento.
 *
 * CONTRATO que o GREEN deve satisfazer (arquivo: admin-perfil.ts):
 *   salvarPerfilAdmin(lojaId: string, payload: unknown):
 *     Promise<{ ok:true; geocodificado:boolean } | { ok:false; erro:string }>
 *   - valida lojaId (validarLojaIdAdmin / z.guid) + schemaPerfil
 *   - verificarAdminSaaS() ANTES de qualquer efeito
 *   - slugExiste(svc, slug, lojaId) só quando o slug mudou? (o teste assume que é
 *     chamado e excludindo a própria loja via 3º arg = lojaId)
 *   - patch perfil via montarPatchPerfil; 1º UPDATE eq("id", lojaId)
 *   - consulta via montarConsultaGeocoding → geocodificarEnderecoComMotivo
 *     → 2º UPDATE { latitude, longitude } | { latitude:null, longitude:null }
 *       eq("id", lojaId)
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// Payload válido de perfil COM endereço completo (passa schemaPerfil) — base do
// caminho feliz. Cada caso ajusta o que precisa.
const PAYLOAD_BASE = {
  nome: "Pizzaria do Zé",
  slug: "pizzaria-do-ze",
  whatsapp: "5511999998888",
  endereco_cep: "01001-000",
  endereco_rua: "Praça da Sé",
  endereco_numero: "100",
  endereco_bairro: "Sé",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
};

// ── next/cache: revalidatePath fora de request scope → mock no-op. ────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS: prova de admin. Default passa; negação faz reject. ─────
const ordemChamadas: string[] = [];
const verificarAdminSaaS = vi.fn(async () => {
  ordemChamadas.push("verificarAdminSaaS");
});
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient (server-only) → mock. Client `lojas` chainable que
//    CAPTURA cada UPDATE (patch + escopo do .eq). Cada `.update(patch)` empilha
//    um registro; `.eq(col, val)` o completa e devolve { error } awaitable. ─────
type UpdateRegistro = {
  patch: Record<string, unknown>;
  eqCol?: string;
  eqVal?: unknown;
};
const updates: UpdateRegistro[] = [];
// erro injetável por índice de UPDATE (default: nenhum erro).
let erroUpdatePorIndice: (idx: number) => unknown = () => null;

function builderLojas() {
  return {
    update(patch: Record<string, unknown>) {
      const reg: UpdateRegistro = { patch };
      updates.push(reg);
      const idx = updates.length - 1;
      return {
        eq(col: string, val: unknown) {
          reg.eqCol = col;
          reg.eqVal = val;
          // Awaitable: PostgREST devolve { error }. Sem encadear .eq extra aqui
          // (os UPDATEs do alvo escopam por uma única coluna id).
          return Promise.resolve({ error: erroUpdatePorIndice(idx) });
        },
      };
    },
  };
}

const clientServico = {
  marker: "svc-fake",
  from(tabela: string) {
    if (tabela !== "lojas") {
      throw new Error(`from() inesperado para tabela: ${tabela}`);
    }
    return builderLojas();
  },
};
const createServiceClient = vi.fn(() => {
  ordemChamadas.push("createServiceClient");
  return clientServico;
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── slugExiste (query helper) → mock. Default: slug livre (false). ────────────
const slugExiste = vi.fn(async () => false);
vi.mock("@/lib/supabase/queries/lojas", () => ({
  slugExiste: (...a: unknown[]) => slugExiste(...(a as [])),
}));

// ── geocodificarEnderecoComMotivo (server-only) → mock. Default: coords ok. ───
//    Tipo explícito do resultado discriminado (coords | { coords:null, motivo })
//    para o override `coords:null` do caso best-effort também type-checar.
type GeoResultado =
  | { coords: { latitude: number; longitude: number } }
  | { coords: null; motivo: "nao_encontrado" | "transitorio" };
const geocodificarEnderecoComMotivo = vi.fn<() => Promise<GeoResultado>>(
  async () => ({ coords: { latitude: -23.55, longitude: -46.63 } }),
);
vi.mock("@/lib/utils/geocodificarEndereco", () => ({
  geocodificarEnderecoComMotivo: (...a: unknown[]) =>
    geocodificarEnderecoComMotivo(...(a as [])),
}));

// 'use server' é só diretiva; o módulo importa no runner node. Hoje só o STUB
// (lança "TODO: GREEN") → cada caso falha na asserção (RED).
import { salvarPerfilAdmin } from "./admin-perfil";

// Chaves autoritativas que NUNCA podem entrar no patch de perfil (RN-7).
const CHAVES_PROIBIDAS = [
  "ativo",
  "dono_id",
  "assinatura_status",
  "hotmart_subscriber_code",
  "hotmart_transaction",
  "consentimento_versao",
  "consentimento_em",
  "latitude",
  "longitude",
  "id",
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  ordemChamadas.length = 0;
  updates.length = 0;
  erroUpdatePorIndice = () => null;
  verificarAdminSaaS.mockImplementation(async () => {
    ordemChamadas.push("verificarAdminSaaS");
  });
  slugExiste.mockResolvedValue(false);
  geocodificarEnderecoComMotivo.mockResolvedValue({
    coords: { latitude: -23.55, longitude: -46.63 },
  });
});

// ───────── Caso 1: ALLOWLIST RN-7 (o teste central) ──────────────────────────
describe("salvarPerfilAdmin — allowlist RN-7 (colunas autoritativas fora do patch)", () => {
  it("payload hostil tentando setar ativo/dono_id/billing/consentimento/coords → 1º UPDATE NÃO contém nenhuma dessas chaves", async () => {
    const payloadHostil = {
      ...PAYLOAD_BASE,
      // Injeções que um payload malicioso tentaria empurrar:
      ativo: true,
      dono_id: "00000000-0000-0000-0000-000000000000",
      assinatura_status: "ativa",
      hotmart_subscriber_code: "HM-EVIL",
      consentimento_versao: "v999",
      latitude: 0.0001,
      longitude: 0.0001,
      id: "99999999-9999-9999-9999-999999999999",
    };

    await salvarPerfilAdmin(LOJA_ID, payloadHostil);

    // O 1º UPDATE é o patch de perfil (o 2º é o par de coords derivado).
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const patchPerfil = updates[0].patch;

    for (const chave of CHAVES_PROIBIDAS) {
      expect(patchPerfil).not.toHaveProperty(chave);
    }
    // E o que DEVE estar (allowlist) está, com os valores validados.
    expect(patchPerfil).toMatchObject({
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
    });
  });
});

// ───────── Caso 2: slug ocupado por OUTRA loja → { ok:false } ─────────────────
describe("salvarPerfilAdmin — slug ocupado por outra loja", () => {
  it("slugExiste(svc, slug, lojaId) → true → { ok:false } e NENHUM UPDATE", async () => {
    slugExiste.mockResolvedValueOnce(true);

    const r = await salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE);

    expect(r).toMatchObject({ ok: false });
    // Checou unicidade excluindo a PRÓPRIA loja (3º arg = lojaId).
    expect(slugExiste).toHaveBeenCalledWith(clientServico, "pizzaria-do-ze", LOJA_ID);
    // Slug ocupado → não persiste nada.
    expect(updates).toHaveLength(0);
  });
});

// ───────── Caso 3: admin não provado → exceção, zero efeito ──────────────────
describe("salvarPerfilAdmin — fail-closed quando admin é negado (D-4)", () => {
  it("verificarAdminSaaS lança → a action REJEITA (propaga) e NÃO toca service/slug/UPDATE", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));

    await expect(salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE)).rejects.toThrow(
      "Acesso negado.",
    );

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(slugExiste).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

// ───────── Caso 4: sucesso → endereço + par coords, escopados por lojaId ──────
describe("salvarPerfilAdmin — caminho feliz (admin ok, slug livre)", () => {
  it("grava endereço (allowlist) e par coords, ambos eq('id', lojaId)", async () => {
    const r = await salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE);

    expect(r).toMatchObject({ ok: true });

    // Dois UPDATEs: [0] perfil/endereço, [1] coords.
    expect(updates).toHaveLength(2);

    // 1º UPDATE: endereço da allowlist, escopado pela loja-alvo.
    const perfil = updates[0];
    expect(perfil.patch).toMatchObject({
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
      endereco_cidade: "São Paulo",
      endereco_estado: "SP",
    });
    expect(perfil.eqCol).toBe("id");
    expect(perfil.eqVal).toBe(LOJA_ID);

    // 2º UPDATE: par de coords derivado no servidor, mesmo escopo.
    const coords = updates[1];
    expect(coords.patch).toEqual({ latitude: -23.55, longitude: -46.63 });
    expect(coords.eqCol).toBe("id");
    expect(coords.eqVal).toBe(LOJA_ID);
  });

  it("geocoding falho (best-effort) → 2º UPDATE grava par NULL, sem rebaixar o salvamento", async () => {
    geocodificarEnderecoComMotivo.mockResolvedValue({
      coords: null,
      motivo: "nao_encontrado",
    });

    const r = await salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE);

    // Salvamento NÃO é rebaixado a erro por falha de geocoding.
    expect(r).toMatchObject({ ok: true });
    expect(updates).toHaveLength(2);

    // Par tudo-ou-nada: ambos NULL (RN-2), escopado por lojaId.
    expect(updates[1].patch).toEqual({ latitude: null, longitude: null });
    expect(updates[1].eqCol).toBe("id");
    expect(updates[1].eqVal).toBe(LOJA_ID);
  });
});
