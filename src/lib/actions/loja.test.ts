import { describe, it, expect, vi, beforeEach } from "vitest";

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
  "endereco_uf",
  "endereco_cep",
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
const fromTabela = vi.fn();
const updatePatch = vi.fn();
const updateEq = vi.fn();
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
            return Promise.resolve({ error: null });
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
  // Caminho feliz: já existe loja do dono, slug livre.
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_ID, dono_id: USER_ID, slug: "slug-antigo" });
  slugExiste.mockResolvedValue(false);
});

// ───────────────────────────── salvarPerfil ──────────────────────────────────
describe("salvarPerfil — caminho feliz", () => {
  it("sucesso: valida e faz UPDATE em lojas → { ok: true }", async () => {
    const r = await salvarPerfil(PERFIL_OK);
    expect(r).toEqual({ ok: true });
    expect(fromTabela).toHaveBeenCalledWith("lojas");
    expect(updatePatch).toHaveBeenCalledTimes(1);
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
    expect(r).toEqual({ ok: true });
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
