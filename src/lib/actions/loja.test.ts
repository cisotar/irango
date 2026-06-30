import { describe, it, expect, vi, beforeEach } from "vitest";

// next/headers não disponível fora de request scope em testes — mockar.
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-real-ip": "127.0.0.1" })),
}));

// Rate limit: fail-open (permitido: true) em todos os testes unitários.
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: (_headers: Headers) => "127.0.0.1",
  verificarRateLimit: () => Promise.resolve({ permitido: true }),
}));

// Geocoding (issue 008): I/O externo (Nominatim) — MOCKADO. Controlável por
// teste: resolve { latitude, longitude } (sucesso) ou null (falha/incompleto).
// A coordenada é dado DERIVADO AUTORITATIVO do servidor (RN-1): o cliente nunca
// influencia o valor; a única fonte legítima é este util chamado server-side.
// (007) salvarPerfil passou a usar `geocodificarEnderecoComMotivo` (resultado
// discriminado: { coords } | { coords:null, motivo }). Mock controlável por teste.
const geocodificarComMotivo = vi.fn();
vi.mock("@/lib/utils/geocodificarEndereco", () => ({
  geocodificarEnderecoComMotivo: (...a: unknown[]) => geocodificarComMotivo(...a),
}));

/**
 * Fase RED (TDD) da issue 030 — Server Actions de configuração da loja
 * (`salvarPerfil` / `salvarHorarios` / `salvarTema`). Mock de TODO I/O externo:
 * client AUTENTICADO (createClient), service_role (createServiceClient) e as
 * queries de loja (buscarLojaDoDono / slugExiste / atualizarLojaDoDono).
 *
 * Por que é RED de verdade: `actions/loja.ts` é um STUB que lança 'TODO: GREEN'.
 * Cada asserção é sobre o COMPORTAMENTO esperado da action implementada
 * (validar no servidor, UPDATE escopado por RLS no client autenticado, unicidade
 * de slug via service_role excluindo a própria loja, erro genérico). Todos caem
 * vermelhos até a fase GREEN escrever a orquestração.
 *
 * Princípio anti-confiar-no-cliente (seguranca.md §10) + RN-A5 (§2): o teste
 * PROVA que colunas autoritativas (assinatura, hotmart, consentimento, dono_id,
 * ativo) NUNCA chegam ao UPDATE, mesmo injetadas no payload — via .strict() do
 * schema OU allowlist de colunas na action (nome, slug, telefone, whatsapp,
 * endereco).
 */

const USER_ID = "11111111-1111-1111-1111-111111111111";
const LOJA_ID = "22222222-2222-2222-2222-222222222222";

// ── colunas que a action PODE escrever (allowlist RN-A5) ──────────────────────
const COLUNAS_PERMITIDAS = new Set([
  "nome",
  "slug",
  "telefone",
  "whatsapp",
  "endereco_rua",
  "endereco_numero",
  "endereco_bairro",
  "endereco_cidade",
  // BUG corrigido na fase RED (issue 008, D4): a coluna real é `endereco_estado`,
  // não `endereco_uf` (confirmado em schema_inicial.sql / database.types.ts /
  // schemaPerfil). O set anterior dava falso-verde/falso-vermelho na allowlist.
  "endereco_estado",
  "endereco_cep",
  // Coords DERIVADAS no servidor (issue 008): a action as escreve no 2º UPDATE
  // (par tudo-ou-nada). NÃO vêm do payload — são geradas por geocodificarEndereco.
  "latitude",
  "longitude",
  // específicas de cada action:
  "horarios",
  "tema",
]);

// colunas que JAMAIS podem chegar a um UPDATE de configuração
const COLUNAS_PROIBIDAS = [
  "dono_id",
  "ativo",
  "assinatura_status",
  "assinatura_fim_periodo",
  "hotmart_subscriber_code",
  "hotmart_transaction",
  "consentimento_em",
  "consentimento_versao",
  "id",
];

// ── client AUTENTICADO (server) — UPDATE roda aqui (RLS lojas_update_proprio) ──
// Captura a tabela e o patch passados ao .from(...).update(...).
// `_eqErros`: fila de erros a injetar — cada `.eq()` consome um item (null = sem erro).
// Após a fila esgotada, volta a retornar null. Resetado pelo beforeEach via
// `_eqErros.length = 0`.
const fromTabela = vi.fn();
const updatePatch = vi.fn();
const updateEq = vi.fn();
const _eqErros: Array<unknown> = [];
const authedClient = {
  from: (tabela: string) => {
    fromTabela(tabela);
    return {
      update: (patch: Record<string, unknown>) => {
        updatePatch(patch);
        // PostgREST exige WHERE (.eq) no UPDATE — a action encadeia .eq("id", …).
        return {
          eq: (coluna: string, valor: unknown) => {
            updateEq(coluna, valor);
            const err = _eqErros.length > 0 ? _eqErros.shift() : null;
            return Promise.resolve({ error: err ?? null });
          },
        };
      },
    };
  },
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(authedClient),
}));

// ── service_role client (BYPASSRLS) ───────────────────────────────────────────
// Além de checar unicidade de slug, definirPublicacao faz o flip de `ativo`
// (coluna protegida pelo trigger 057) via .from().update().eq().eq().
const svcUpdatePatch = vi.fn();
const svcUpdateEq = vi.fn();
const fakeService = {
  __role: "service",
  from: (_tabela: string) => ({
    update: (patch: Record<string, unknown>) => {
      svcUpdatePatch(patch);
      const chain = {
        eq: (coluna: string, valor: unknown) => {
          svcUpdateEq(coluna, valor);
          return chain; // permite encadear .eq().eq() e ainda ser thenable
        },
        then: (resolve: (v: { error: null }) => unknown) =>
          resolve({ error: null }),
      };
      return chain;
    },
  }),
};
const createServiceClient = vi.fn(() => fakeService);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── queries de loja ───────────────────────────────────────────────────────────
const buscarLojaDoDono = vi.fn();
const slugExiste = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
  slugExiste: (...a: unknown[]) => slugExiste(...a),
}));

import {
  salvarPerfil,
  salvarHorarios,
  salvarTema,
  definirPublicacao,
} from "./loja";

const PERFIL_OK = {
  nome: "Burguer do Zé",
  slug: "burguer-do-ze",
  telefone: "1133334444",
  whatsapp: "5511999998888",
};

// Perfil com endereço COMPLETO o bastante para geocodificar (cidade + UF, RN-2).
const PERFIL_COM_ENDERECO = {
  ...PERFIL_OK,
  endereco_cep: "01310-100",
  endereco_rua: "Av. Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
};

const COORDS_SP = { latitude: -23.56, longitude: -46.65 };

const HORARIOS_OK = {
  seg: { abre: "08:00", fecha: "18:00", ativo: true },
  ter: { abre: "08:00", fecha: "18:00", ativo: true },
  qua: { abre: "08:00", fecha: "18:00", ativo: true },
  qui: { abre: "08:00", fecha: "18:00", ativo: true },
  sex: { abre: "08:00", fecha: "18:00", ativo: true },
  sab: { abre: "08:00", fecha: "12:00", ativo: true },
  dom: { abre: "00:00", fecha: "00:00", ativo: false },
};

const TEMA_OK = { primaria: "#ff0000", fundo: "#ffffff", destaque: "#00ff00" };

beforeEach(() => {
  vi.clearAllMocks();
  // Reseta a fila de erros injetados no eq do authedClient.
  _eqErros.length = 0;
  // Caminho feliz: já existe loja do dono, slug livre.
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_ID, dono_id: USER_ID, slug: "slug-antigo" });
  slugExiste.mockResolvedValue(false);
  // Default: geocoding bem-sucedido. Casos de borda sobrescrevem por teste.
  geocodificarComMotivo.mockResolvedValue({ coords: COORDS_SP });
  // (007) Retry sob a trava: sem delay real nos testes.
  process.env.GEOCODE_RETRY_DELAY_MS = "0";
});

// ───────────────────────────── salvarPerfil ──────────────────────────────────
describe("salvarPerfil — caminho feliz", () => {
  it("sucesso sem endereço: valida e faz UPDATE em lojas → { ok: true, geocodificado: false }", async () => {
    // Sem cidade+UF não há o que geocodificar: o 2º UPDATE zera o par (NULL).
    const r = await salvarPerfil(PERFIL_OK);
    expect(r).toEqual({ ok: true, geocodificado: false });
    expect(fromTabela).toHaveBeenCalledWith("lojas");
    // PostgREST recusa UPDATE sem WHERE (21000): a action DEVE escopar por id.
    expect(updateEq).toHaveBeenCalledWith("id", LOJA_ID);
  });

  it("UPDATE roda via client AUTENTICADO (RLS lojas_update_proprio escopa por dono), NÃO service_role", async () => {
    await salvarPerfil(PERFIL_OK);
    // a checagem de slug pode usar service_role, mas a ESCRITA é no client autenticado.
    // O patch chegou ao authedClient (fromTabela registrou a chamada).
    expect(fromTabela).toHaveBeenCalledWith("lojas");
    expect(updatePatch).toHaveBeenCalled();
  });
});

// ────────────── salvarPerfil — endereço + geocoding (issue 008) ───────────────
describe("salvarPerfil — coords derivadas do servidor (RN-1/RN-2)", () => {
  it("endereço completo + geocoding ok → 2 UPDATEs; par de coords persistido; geocodificado:true", async () => {
    geocodificarComMotivo.mockResolvedValue({ coords: COORDS_SP });

    const r = await salvarPerfil(PERFIL_COM_ENDERECO);

    expect(r).toEqual({ ok: true, geocodificado: true });
    // 1º UPDATE = perfil+endereço; 2º UPDATE = par de coords.
    expect(updatePatch).toHaveBeenCalledTimes(2);

    // O endereço entra no 1º patch (allowlist coluna-a-coluna).
    const patchEndereco = updatePatch.mock.calls[0][0] as Record<string, unknown>;
    expect(patchEndereco).toMatchObject({
      endereco_cidade: "São Paulo",
      endereco_estado: "SP",
    });

    // O 2º patch carrega SÓ o par derivado (par tudo-ou-nada).
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: -23.56, longitude: -46.65 });

    // Geocoding chamado com uma consulta que contém cidade e UF.
    expect(geocodificarComMotivo).toHaveBeenCalledTimes(1);
    const consulta = geocodificarComMotivo.mock.calls[0][0] as string;
    expect(consulta).toContain("São Paulo");
    expect(consulta).toContain("SP");

    // Ambos os UPDATEs escopados por id (RLS lojas_update_proprio).
    expect(updateEq).toHaveBeenCalledTimes(2);
    expect(updateEq).toHaveBeenNthCalledWith(1, "id", LOJA_ID);
    expect(updateEq).toHaveBeenNthCalledWith(2, "id", LOJA_ID);
  });

  it("geocoding não-encontrado → endereço salvo, par de coords NULL, geocodificado:false + motivo (não bloqueia)", async () => {
    geocodificarComMotivo.mockResolvedValue({ coords: null, motivo: "nao_encontrado" });

    const r = await salvarPerfil(PERFIL_COM_ENDERECO);

    expect(r).toEqual({ ok: true, geocodificado: false, motivo: "nao_encontrado" });
    // nao_encontrado NÃO dispara retry (re-tentar não acharia o que não existe).
    expect(geocodificarComMotivo).toHaveBeenCalledTimes(1);
    expect(updatePatch).toHaveBeenCalledTimes(2);

    // 1º UPDATE: endereço persistido normalmente, apesar do geocoding falho.
    const patchEndereco = updatePatch.mock.calls[0][0] as Record<string, unknown>;
    expect(patchEndereco).toMatchObject({ endereco_cidade: "São Paulo", endereco_estado: "SP" });

    // 2º UPDATE: par tudo-ou-nada → AMBOS NULL.
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: null, longitude: null });
  });

  it("endereço incompleto (sem cidade/UF) → NÃO chama Nominatim; par NULL; geocodificado:false", async () => {
    // Só nome/slug: sem âncora geográfica mínima → não geocodifica (economiza a trava global).
    const r = await salvarPerfil(PERFIL_OK);

    expect(r).toEqual({ ok: true, geocodificado: false });
    expect(geocodificarComMotivo).not.toHaveBeenCalled();
    expect(updatePatch).toHaveBeenCalledTimes(2);
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: null, longitude: null });
  });

  it("ATAQUE RN-1: payload com latitude/longitude → rejeitado por .strict() ANTES de qualquer I/O", async () => {
    const r = await salvarPerfil({
      ...PERFIL_COM_ENDERECO,
      latitude: 0,
      longitude: 0,
    });

    expect(r).toMatchObject({ ok: false });
    // Barreira 1 (.strict()): nenhum UPDATE, nenhum geocoding.
    expect(updatePatch).not.toHaveBeenCalled();
    expect(geocodificarComMotivo).not.toHaveBeenCalled();
  });

  it("Barreira 2 (allowlist): nenhum dos 2 patches contém chave fora de COLUNAS_PERMITIDAS nem chave proibida", async () => {
    geocodificarComMotivo.mockResolvedValue({ coords: COORDS_SP });
    await salvarPerfil(PERFIL_COM_ENDERECO);

    for (const call of updatePatch.mock.calls) {
      const patch = call[0] as Record<string, unknown>;
      for (const proibida of COLUNAS_PROIBIDAS) {
        expect(patch).not.toHaveProperty(proibida);
      }
      for (const chave of Object.keys(patch)) {
        expect(COLUNAS_PERMITIDAS.has(chave)).toBe(true);
      }
    }
  });

  it("RLS dono A ≠ loja dono B: ambos os UPDATEs escopam por .eq('id', id da loja resolvida sob RLS)", async () => {
    // O escopo da escrita vem da loja resolvida por buscarLojaDoDono (RLS), nunca do payload.
    geocodificarComMotivo.mockResolvedValue({ coords: COORDS_SP });
    await salvarPerfil(PERFIL_COM_ENDERECO);

    const idsEscritos = updateEq.mock.calls
      .filter(([col]) => col === "id")
      .map(([, valor]) => valor);
    expect(idsEscritos).toHaveLength(2);
    for (const id of idsEscritos) {
      expect(id).toBe(LOJA_ID); // jamais um id de terceiro
    }
  });
});

// ── (007) Distinção transitório vs. não-encontrado + retry curto ──────────────
describe("salvarPerfil — robustez do geocoding (issue 007)", () => {
  it("transitório → retry sob a trava; retry OK → geocodificado:true, coords persistidas", async () => {
    geocodificarComMotivo
      .mockResolvedValueOnce({ coords: null, motivo: "transitorio" })
      .mockResolvedValueOnce({ coords: COORDS_SP });

    const r = await salvarPerfil(PERFIL_COM_ENDERECO);

    expect(r).toEqual({ ok: true, geocodificado: true });
    expect(geocodificarComMotivo).toHaveBeenCalledTimes(2); // 1ª + retry
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: -23.56, longitude: -46.65 });
  });

  it("transitório nas duas tentativas → geocodificado:false + motivo:'transitorio'; coords NULL", async () => {
    geocodificarComMotivo.mockResolvedValue({ coords: null, motivo: "transitorio" });

    const r = await salvarPerfil(PERFIL_COM_ENDERECO);

    expect(r).toEqual({ ok: true, geocodificado: false, motivo: "transitorio" });
    expect(geocodificarComMotivo).toHaveBeenCalledTimes(2);
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: null, longitude: null });
  });

  it("não-encontrado → SEM retry; geocodificado:false + motivo:'nao_encontrado'", async () => {
    geocodificarComMotivo.mockResolvedValue({ coords: null, motivo: "nao_encontrado" });

    const r = await salvarPerfil(PERFIL_COM_ENDERECO);

    expect(r).toEqual({ ok: true, geocodificado: false, motivo: "nao_encontrado" });
    expect(geocodificarComMotivo).toHaveBeenCalledTimes(1); // não re-tenta o inexistente
  });

  it("falha de coords (2º UPDATE) NUNCA rebaixa o salvamento — erro só do UPDATE vira ok:false", async () => {
    // O salvamento do endereço (1º UPDATE) teve sucesso; geocoding transitório.
    // Aqui provamos que um motivo no ramo de sucesso continua ok:true.
    geocodificarComMotivo.mockResolvedValue({ coords: null, motivo: "transitorio" });
    const r = await salvarPerfil(PERFIL_COM_ENDERECO);
    expect(r).toMatchObject({ ok: true });
  });
});

describe("salvarPerfil — slug e unicidade", () => {
  it("slug MUDOU e já usado por OUTRA loja → erro, sem UPDATE", async () => {
    slugExiste.mockResolvedValue(true); // ocupado por outra loja
    const r = await salvarPerfil({ ...PERFIL_OK, slug: "slug-tomado" });
    expect(r).toMatchObject({ ok: false });
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("checa unicidade via service_role EXCLUINDO a própria loja (exceto = id da loja)", async () => {
    await salvarPerfil({ ...PERFIL_OK, slug: "novo-slug" });
    expect(createServiceClient).toHaveBeenCalled();
    expect(slugExiste).toHaveBeenCalledTimes(1);
    const [client, slug, exceto] = slugExiste.mock.calls[0];
    expect(client).toBe(fakeService); // service_role, não o autenticado
    expect(slug).toBe("novo-slug");
    expect(exceto).toBe(LOJA_ID); // exclui a própria loja
  });

  it("slug NÃO mudou (igual ao atual) → não precisa checar unicidade", async () => {
    buscarLojaDoDono.mockResolvedValue({ id: LOJA_ID, dono_id: USER_ID, slug: PERFIL_OK.slug });
    const r = await salvarPerfil(PERFIL_OK);
    expect(r).toEqual({ ok: true, geocodificado: false });
    expect(slugExiste).not.toHaveBeenCalled();
  });
});

describe("salvarPerfil — ATAQUE RN-A5 (seguranca.md §2/§10): allowlist de colunas", () => {
  it("ATAQUE: injetar assinatura_status/hotmart_*/consentimento_*/dono_id/ativo → NUNCA chegam ao UPDATE", async () => {
    const r = await salvarPerfil({
      ...PERFIL_OK,
      dono_id: "99999999-9999-9999-9999-999999999999",
      ativo: true,
      assinatura_status: "ativa",
      assinatura_fim_periodo: "2099-01-01",
      hotmart_subscriber_code: "HACK",
      hotmart_transaction: "HACK",
      consentimento_em: "2099-01-01",
      consentimento_versao: "FAKE",
    });

    if (r.ok) {
      // se a action prosseguiu, o patch enviado ao banco SÓ pode conter colunas
      // permitidas — nenhuma coluna autoritativa/sensível.
      const patch = updatePatch.mock.calls[0][0] as Record<string, unknown>;
      for (const proibida of COLUNAS_PROIBIDAS) {
        expect(patch).not.toHaveProperty(proibida);
      }
      for (const chave of Object.keys(patch)) {
        expect(COLUNAS_PERMITIDAS.has(chave)).toBe(true);
      }
    } else {
      // se .strict() rejeitou os campos extras, nenhum UPDATE aconteceu.
      expect(updatePatch).not.toHaveBeenCalled();
    }
  });
});

describe("salvarPerfil — validação e erro genérico", () => {
  it("slug inválido 'Ab C' → rejeitado SEM tocar no banco", async () => {
    const r = await salvarPerfil({ ...PERFIL_OK, slug: "Ab C" });
    expect(r).toMatchObject({ ok: false });
    expect(slugExiste).not.toHaveBeenCalled();
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("nome vazio → rejeitado SEM tocar no banco", async () => {
    const r = await salvarPerfil({ ...PERFIL_OK, nome: "" });
    expect(r).toMatchObject({ ok: false });
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("erro de banco → mensagem GENÉRICA (não vaza detalhe interno, §14)", async () => {
    buscarLojaDoDono.mockRejectedValue(new Error("conexao postgres senha XYZ vazou"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await salvarPerfil(PERFIL_OK);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("senha");
    expect(JSON.stringify(r)).not.toContain("postgres");
    spy.mockRestore();
  });
});

// ──────────────────────────── salvarHorarios ─────────────────────────────────
describe("salvarHorarios", () => {
  it("sucesso: valida e faz UPDATE de horarios da própria loja → { ok: true }", async () => {
    const r = await salvarHorarios(HORARIOS_OK);
    expect(r).toEqual({ ok: true });
    expect(fromTabela).toHaveBeenCalledWith("lojas");
    const patch = updatePatch.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).toHaveProperty("horarios");
  });

  it("UPDATE de horarios só toca colunas permitidas (nada de assinatura/dono/ativo)", async () => {
    await salvarHorarios(HORARIOS_OK);
    const patch = updatePatch.mock.calls[0][0] as Record<string, unknown>;
    for (const proibida of COLUNAS_PROIBIDAS) {
      expect(patch).not.toHaveProperty(proibida);
    }
  });

  it("abre >= fecha em dia ATIVO → rejeitado SEM tocar no banco", async () => {
    const ruim = { ...HORARIOS_OK, seg: { abre: "18:00", fecha: "08:00", ativo: true } };
    const r = await salvarHorarios(ruim);
    expect(r).toMatchObject({ ok: false });
    expect(updatePatch).not.toHaveBeenCalled();
  });
});

// ────────────────────────────── salvarTema ───────────────────────────────────
describe("salvarTema", () => {
  it("sucesso: valida hex e faz UPDATE de tema → { ok: true }", async () => {
    const r = await salvarTema(TEMA_OK);
    expect(r).toEqual({ ok: true });
    expect(fromTabela).toHaveBeenCalledWith("lojas");
    const patch = updatePatch.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).toHaveProperty("tema");
  });

  it("ATAQUE injeção CSS: cor não-hex 'red;}body{display:none' → rejeitado SEM tocar no banco", async () => {
    const r = await salvarTema({ ...TEMA_OK, primaria: "red;}body{display:none" });
    expect(r).toMatchObject({ ok: false });
    expect(updatePatch).not.toHaveBeenCalled();
  });

  it("UPDATE de tema só toca colunas permitidas (nada de assinatura/dono/ativo)", async () => {
    await salvarTema(TEMA_OK);
    const patch = updatePatch.mock.calls[0][0] as Record<string, unknown>;
    for (const proibida of COLUNAS_PROIBIDAS) {
      expect(patch).not.toHaveProperty(proibida);
    }
  });
});

// ─────────────────────────── definirPublicacao ───────────────────────────────
describe("definirPublicacao — toggle de publicação da vitrine (ativo)", () => {
  const LOJA_COMPLETA = {
    id: LOJA_ID,
    dono_id: USER_ID,
    slug: "burguer-do-ze",
    nome: "Burguer do Zé",
    whatsapp: "5511999998888",
  };

  it("publicar com perfil completo → { ok: true } e seta ativo=true via service_role", async () => {
    buscarLojaDoDono.mockResolvedValue(LOJA_COMPLETA);
    const r = await definirPublicacao(true);
    expect(r).toEqual({ ok: true });
    expect(svcUpdatePatch).toHaveBeenCalledWith({ ativo: true });
    // Escopo reafirmado por id E dono_id (service_role bypassa RLS).
    expect(svcUpdateEq).toHaveBeenCalledWith("id", LOJA_ID);
    expect(svcUpdateEq).toHaveBeenCalledWith("dono_id", USER_ID);
  });

  it("despublicar → { ok: true } e seta ativo=false (não exige perfil completo)", async () => {
    buscarLojaDoDono.mockResolvedValue({ id: LOJA_ID, dono_id: USER_ID, slug: "x", nome: "", whatsapp: null });
    const r = await definirPublicacao(false);
    expect(r).toEqual({ ok: true });
    expect(svcUpdatePatch).toHaveBeenCalledWith({ ativo: false });
  });

  it("publicar SEM whatsapp → recusa (perfil incompleto), NÃO chama UPDATE", async () => {
    buscarLojaDoDono.mockResolvedValue({ ...LOJA_COMPLETA, whatsapp: null });
    const r = await definirPublicacao(true);
    expect(r.ok).toBe(false);
    expect(svcUpdatePatch).not.toHaveBeenCalled();
  });

  it("publicar SEM nome → recusa, NÃO chama UPDATE", async () => {
    buscarLojaDoDono.mockResolvedValue({ ...LOJA_COMPLETA, nome: "   " });
    const r = await definirPublicacao(true);
    expect(r.ok).toBe(false);
    expect(svcUpdatePatch).not.toHaveBeenCalled();
  });

  it("sem loja do dono → { ok: false } sem tocar no banco", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await definirPublicacao(true);
    expect(r.ok).toBe(false);
    expect(svcUpdatePatch).not.toHaveBeenCalled();
  });
});

// ──────────── montarConsultaGeocoding — bordas via salvarPerfil ───────────────
// montarConsultaGeocoding agora vive em patches-loja.ts (issue 084) e tem teste
// direto em patches-loja.test.ts. Aqui cobrimos a INTEGRAÇÃO via salvarPerfil:
// se o gate retorna null, geocodificarEndereco NÃO é chamado.
describe("salvarPerfil — montarConsultaGeocoding bordas (gate de completude)", () => {
  it("só cidade, sem UF → gate retorna null → Nominatim não chamado; par NULL gravado", async () => {
    // Sem endereco_estado não há âncora geográfica mínima (RN-2).
    const r = await salvarPerfil({
      ...PERFIL_OK,
      endereco_cidade: "São Paulo",
      // endereco_estado ausente — schemaPerfil aceita (optional)
    });

    expect(r).toEqual({ ok: true, geocodificado: false });
    expect(geocodificarComMotivo).not.toHaveBeenCalled();
    // 2º UPDATE: par NULL (coords zeradas, nunca ímpares)
    expect(updatePatch).toHaveBeenCalledTimes(2);
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: null, longitude: null });
  });

  it("só UF, sem cidade → gate retorna null → Nominatim não chamado; par NULL gravado", async () => {
    // Sem endereco_cidade a consulta não teria referência municipal válida.
    const r = await salvarPerfil({
      ...PERFIL_OK,
      endereco_estado: "SP",
      // endereco_cidade ausente
    });

    expect(r).toEqual({ ok: true, geocodificado: false });
    expect(geocodificarComMotivo).not.toHaveBeenCalled();
    expect(updatePatch).toHaveBeenCalledTimes(2);
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: null, longitude: null });
  });

  it("cidade + UF presentes → Nominatim chamado; consulta contém ambos", async () => {
    geocodificarComMotivo.mockResolvedValue({ coords: COORDS_SP });

    await salvarPerfil({
      ...PERFIL_OK,
      endereco_cidade: "Curitiba",
      endereco_estado: "PR",
    });

    expect(geocodificarComMotivo).toHaveBeenCalledTimes(1);
    const consulta = geocodificarComMotivo.mock.calls[0][0] as string;
    expect(consulta).toContain("Curitiba");
    expect(consulta).toContain("PR");
  });
});

// ──────── falha no 2º UPDATE (coords) após geocoding bem-sucedido ─────────────
describe("salvarPerfil — falha no 2º UPDATE de coords", () => {
  it("geocoding ok mas UPDATE de coords falha → { ok: false }; erro não vaza detalhe interno", async () => {
    geocodificarComMotivo.mockResolvedValue({ coords: COORDS_SP });

    // 1º eq (perfil) → sem erro; 2º eq (coords) → erro de banco
    _eqErros.push(null); // 1º UPDATE (patch perfil+endereço): ok
    _eqErros.push({ message: "column latitude does not exist" }); // 2º UPDATE: erro

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await salvarPerfil(PERFIL_COM_ENDERECO);
    spy.mockRestore();

    expect(r).toMatchObject({ ok: false });
    // O detalhe do banco não pode vazar ao cliente (seguranca.md §14).
    expect(JSON.stringify(r)).not.toContain("column");
    expect(JSON.stringify(r)).not.toContain("latitude does not exist");
  });

  it("geocoding ok mas UPDATE de coords falha → 1º UPDATE (endereço) JÁ foi persistido antes da falha", async () => {
    // Comprova que o fluxo é sequencial: perfil gravado, coords falham.
    geocodificarComMotivo.mockResolvedValue({ coords: COORDS_SP });
    _eqErros.push(null); // 1º ok
    _eqErros.push({ message: "banco indisponivel" }); // 2º falha

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await salvarPerfil(PERFIL_COM_ENDERECO);
    spy.mockRestore();

    // O 1º patch (endereço) deve ter sido enviado ao banco antes da falha.
    expect(updatePatch).toHaveBeenCalledTimes(2);
    const patchEndereco = updatePatch.mock.calls[0][0] as Record<string, unknown>;
    expect(patchEndereco).toMatchObject({ endereco_cidade: "São Paulo" });
    // O 2º patch (coords) também foi tentado.
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: -23.56, longitude: -46.65 });
  });
});

// ────── coords antigas zeradas quando endereço volta a ser incompleto ─────────
describe("salvarPerfil — zeragem de coords ao salvar endereço incompleto", () => {
  it("endereço previamente completo agora salvo sem cidade → coords zeradas (par NULL), não fica lixo antigo", async () => {
    // Cenário: loja tinha coords; dono salva perfil sem cidade (sem âncora).
    // A action DEVE gravar { latitude: null, longitude: null } — não pular o 2º UPDATE.
    const r = await salvarPerfil({
      ...PERFIL_OK,
      endereco_rua: "Rua X",
      endereco_numero: "100",
      // sem cidade e sem estado: gate retorna null
    });

    expect(r).toEqual({ ok: true, geocodificado: false });
    // 2º UPDATE existe e zera o par (não pula).
    expect(updatePatch).toHaveBeenCalledTimes(2);
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: null, longitude: null });
    // Confirmação: geocoding não foi chamado.
    expect(geocodificarComMotivo).not.toHaveBeenCalled();
  });

  it("endereço sem nenhum campo → coords zeradas (par NULL); 2º UPDATE acontece", async () => {
    // Perfil mínimo (nome + slug) sem nenhum campo de endereço.
    const r = await salvarPerfil(PERFIL_OK);

    expect(r).toEqual({ ok: true, geocodificado: false });
    expect(updatePatch).toHaveBeenCalledTimes(2);
    const patchCoords = updatePatch.mock.calls[1][0] as Record<string, unknown>;
    expect(patchCoords).toEqual({ latitude: null, longitude: null });
  });
});
