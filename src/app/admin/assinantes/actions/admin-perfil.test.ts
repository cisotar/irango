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
const obterAdminUserId = vi.fn(() => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: () => obterAdminUserId(),
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
// count injetável por índice de UPDATE (default: 1 — linha encontrada e gravada).
let countUpdatePorIndice: (idx: number) => number | null = () => 1;

function builderLojas() {
  return {
    update(patch: Record<string, unknown>) {
      const reg: UpdateRegistro = { patch };
      updates.push(reg);
      ordemChamadas.push(`update:${updates.length}`);
      const idx = updates.length - 1;
      return {
        eq(col: string, val: unknown) {
          reg.eqCol = col;
          reg.eqVal = val;
          // Awaitable: PostgREST devolve { error, count }. Sem encadear .eq extra
          // aqui (os UPDATEs do alvo escopam por uma única coluna id).
          return Promise.resolve({
            error: erroUpdatePorIndice(idx),
            count: countUpdatePorIndice(idx),
          });
        },
      };
    },
  };
}

// ── admin_acessos (trilha de auditoria): captura os INSERTs do fire-and-forget
//    registrarAcessoAdmin (REAL, não mockado — só o wiring com svc é fake). ────
type InsertAcesso = { admin_user_id: string; loja_id: string; acao: string; metadados: unknown };
const insertsAcesso: InsertAcesso[] = [];

const clientServico = {
  marker: "svc-fake",
  from(tabela: string) {
    if (tabela === "admin_acessos") {
      return {
        insert(dados: InsertAcesso) {
          insertsAcesso.push(dados);
          return Promise.resolve({ error: null });
        },
      };
    }
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
// (180-A) buscarLojaAdminPorId entra aqui: é a leitura do endereço ANTERIOR que
// alimenta `deveRegeocodificar`. Default = loja-alvo SEM endereço e SEM coords,
// então qualquer payload com endereço conta como "mudou" (fluxo antigo intacto).
const slugExiste = vi.fn(async () => false);
type LojaAdminMock = Record<string, unknown> | null;
const LOJA_SEM_ENDERECO: LojaAdminMock = {
  id: LOJA_ID,
  slug: "pizzaria-do-ze",
  endereco_cep: null,
  endereco_rua: null,
  endereco_numero: null,
  endereco_bairro: null,
  endereco_cidade: null,
  endereco_estado: null,
  latitude: null,
  longitude: null,
};
const buscarLojaAdminPorId = vi.fn<() => Promise<LojaAdminMock>>(async () => {
  ordemChamadas.push("buscarLojaAdminPorId");
  return LOJA_SEM_ENDERECO;
});
vi.mock("@/lib/supabase/queries/lojas", () => ({
  slugExiste: (...a: unknown[]) => slugExiste(...(a as [])),
  buscarLojaAdminPorId: (...a: unknown[]) => buscarLojaAdminPorId(...(a as [])),
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
  insertsAcesso.length = 0;
  erroUpdatePorIndice = () => null;
  countUpdatePorIndice = () => 1;
  verificarAdminSaaS.mockImplementation(async () => {
    ordemChamadas.push("verificarAdminSaaS");
  });
  obterAdminUserId.mockReturnValue("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  slugExiste.mockResolvedValue(false);
  buscarLojaAdminPorId.mockImplementation(async () => {
    ordemChamadas.push("buscarLojaAdminPorId");
    return LOJA_SEM_ENDERECO;
  });
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

// ───────── Caso 5 (issue 122): flag whatsapp_envio_automatico via admin ──────
describe("salvarPerfilAdmin — whatsapp_envio_automatico (issue 122)", () => {
  it("flag false sobrevive ao pick CHAVES_PERFIL e chega ao 1º UPDATE escopado por lojaId", async () => {
    const r = await salvarPerfilAdmin(LOJA_ID, {
      ...PAYLOAD_BASE,
      whatsapp_envio_automatico: false,
    });

    expect(r).toMatchObject({ ok: true });
    const perfil = updates[0];
    expect(perfil.patch).toHaveProperty("whatsapp_envio_automatico", false);
    expect(perfil.eqCol).toBe("id");
    expect(perfil.eqVal).toBe(LOJA_ID);
  });

  it("payload SEM a flag não emite a chave no patch (preserva o valor no banco)", async () => {
    const r = await salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE);

    expect(r).toMatchObject({ ok: true });
    expect(updates[0].patch).not.toHaveProperty("whatsapp_envio_automatico");
  });

  it("payload hostil + flag: só a flag e os campos de perfil sobrevivem; autoritativas seguem fora", async () => {
    await salvarPerfilAdmin(LOJA_ID, {
      ...PAYLOAD_BASE,
      whatsapp_envio_automatico: true,
      ativo: true,
      dono_id: "00000000-0000-0000-0000-000000000000",
      assinatura_status: "ativa",
      latitude: 0.0001,
      longitude: 0.0001,
      id: "99999999-9999-9999-9999-999999999999",
    });

    const patchPerfil = updates[0].patch;
    for (const chave of CHAVES_PROIBIDAS) {
      expect(patchPerfil).not.toHaveProperty(chave);
    }
    expect(patchPerfil).toHaveProperty("whatsapp_envio_automatico", true);
    expect(patchPerfil).toMatchObject({
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
    });
  });

  it("flag não-booleana ('true') reprova no schema → ERRO_VALIDACAO, zero UPDATE", async () => {
    const r = await salvarPerfilAdmin(LOJA_ID, {
      ...PAYLOAD_BASE,
      whatsapp_envio_automatico: "true",
    });

    expect(r).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });
});

// ───────── Caso 6 (issue 164): trilha registra QUAIS campos, nunca valores ────
describe("salvarPerfilAdmin — trilha de auditoria com campos alterados (164)", () => {
  it("happy path → registrarAcessoAdmin grava metadados.campos com as CHAVES do patch, sem nenhum valor", async () => {
    const r = await salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE);

    expect(r).toMatchObject({ ok: true });
    expect(insertsAcesso).toHaveLength(1);
    const acesso = insertsAcesso[0];
    expect(acesso.loja_id).toBe(LOJA_ID);
    expect(acesso.acao).toBe("salvar_perfil_loja");

    const metadados = acesso.metadados as { campos: string[] };
    expect(metadados.campos).toEqual(Object.keys(updates[0].patch));
    // Nenhum valor de PII (whatsapp/endereço) vaza para a trilha — só as chaves.
    expect(JSON.stringify(metadados)).not.toContain("5511999998888");
    expect(JSON.stringify(metadados)).not.toContain("Praça da Sé");
  });
});

// ───────── Caso 7 (issue 164): loja inexistente/excluída entre load e submit ──
describe("salvarPerfilAdmin — loja inexistente não deve devolver ok:true (164)", () => {
  it("1º UPDATE com count 0 → { ok:false, erro:'Loja não encontrada.' }, sem 2º UPDATE nem trilha", async () => {
    countUpdatePorIndice = (idx) => (idx === 0 ? 0 : 1);

    const r = await salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE);

    expect(r).toMatchObject({ ok: false, erro: "Loja não encontrada." });
    expect(updates).toHaveLength(1);
    expect(insertsAcesso).toHaveLength(0);
  });

  it("2º UPDATE (coords) com count 0 → { ok:false, erro:'Loja não encontrada.' }, sem trilha", async () => {
    countUpdatePorIndice = (idx) => (idx === 1 ? 0 : 1);

    const r = await salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE);

    expect(r).toMatchObject({ ok: false, erro: "Loja não encontrada." });
    expect(updates).toHaveLength(2);
    expect(insertsAcesso).toHaveLength(0);
  });
});

// ───────── Caso 8 (issue 180-A): 2º UPDATE deixa de ser incondicional ────────
// Mesmo bug do painel: salvar o perfil pela via admin com o geocoder fora do ar
// apagava uma localização válida, mesmo sem o endereço ter mudado.
describe("salvarPerfilAdmin — endereço inalterado não regeocodifica (180-A)", () => {
  const LOJA_MESMO_ENDERECO: LojaAdminMock = {
    id: LOJA_ID,
    slug: PAYLOAD_BASE.slug,
    endereco_cep: PAYLOAD_BASE.endereco_cep,
    endereco_rua: PAYLOAD_BASE.endereco_rua,
    endereco_numero: PAYLOAD_BASE.endereco_numero,
    endereco_bairro: PAYLOAD_BASE.endereco_bairro,
    endereco_cidade: PAYLOAD_BASE.endereco_cidade,
    endereco_estado: PAYLOAD_BASE.endereco_estado,
    latitude: -23.55,
    longitude: -46.63,
  };

  function mockarLoja(loja: LojaAdminMock) {
    buscarLojaAdminPorId.mockImplementation(async () => {
      ordemChamadas.push("buscarLojaAdminPorId");
      return loja;
    });
  }

  it("CRITÉRIO 2: endereço IGUAL + geocoder fora do ar → geocoder NÃO chamado, só 1 UPDATE, coords intactas", async () => {
    mockarLoja(LOJA_MESMO_ENDERECO);
    geocodificarEnderecoComMotivo.mockResolvedValue({
      coords: null,
      motivo: "transitorio",
    });

    const r = await salvarPerfilAdmin(LOJA_ID, { ...PAYLOAD_BASE, nome: "Nome Novo" });

    expect(r).toEqual({ ok: true, geocodificado: true });
    expect(geocodificarEnderecoComMotivo).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).not.toHaveProperty("latitude");
    expect(updates[0].patch).not.toHaveProperty("longitude");
    // O salvamento em si não é rebaixado: trilha de auditoria registrada.
    expect(insertsAcesso).toHaveLength(1);
  });

  it("RISCO DO DIFF: a loja é lida ANTES do 1º UPDATE (senão compara o endereço novo consigo mesmo)", async () => {
    mockarLoja(LOJA_MESMO_ENDERECO);

    await salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE);

    const posLeitura = ordemChamadas.indexOf("buscarLojaAdminPorId");
    const posUpdate = ordemChamadas.indexOf("update:1");
    expect(posLeitura).toBeGreaterThanOrEqual(0);
    expect(posUpdate).toBeGreaterThanOrEqual(0);
    expect(posLeitura).toBeLessThan(posUpdate);
    // E depois do fail-closed de admin (D-4): nenhuma leitura sem prova.
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(posLeitura);
  });

  it("endereço ALTERADO + geocoder fora do ar → geocoder chamado e 2º UPDATE grava o par NULL", async () => {
    mockarLoja(LOJA_MESMO_ENDERECO);
    geocodificarEnderecoComMotivo.mockResolvedValue({
      coords: null,
      motivo: "transitorio",
    });

    const r = await salvarPerfilAdmin(LOJA_ID, {
      ...PAYLOAD_BASE,
      endereco_rua: "Rua Augusta",
    });

    expect(r).toEqual({ ok: true, geocodificado: false });
    expect(geocodificarEnderecoComMotivo).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(2);
    expect(updates[1].patch).toEqual({ latitude: null, longitude: null });
  });

  it("loja-alvo inexistente na leitura → { ok:false, erro:'Loja não encontrada.' } sem nenhum UPDATE", async () => {
    mockarLoja(null);

    const r = await salvarPerfilAdmin(LOJA_ID, PAYLOAD_BASE);

    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(updates).toHaveLength(0);
    expect(geocodificarEnderecoComMotivo).not.toHaveBeenCalled();
    expect(insertsAcesso).toHaveLength(0);
  });

  it("coord ÓRFÃ (loja com coords, endereço incompleto nos dois lados) → 2º UPDATE limpa o par (D3)", async () => {
    mockarLoja({ ...LOJA_SEM_ENDERECO, latitude: -23.55, longitude: -46.63 });

    const r = await salvarPerfilAdmin(LOJA_ID, {
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
      whatsapp: "5511999998888",
    });

    expect(r).toEqual({ ok: true, geocodificado: false });
    expect(geocodificarEnderecoComMotivo).not.toHaveBeenCalled();
    expect(updates).toHaveLength(2);
    expect(updates[1].patch).toEqual({ latitude: null, longitude: null });
  });
});
