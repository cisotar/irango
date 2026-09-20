// Fase RED (TDD) — issue 231 (crítica: SIM, red-first). Arquivo NOVO: a suíte
// existente `admin-perfil.test.ts` (issue 092) não é editada aqui.
//
// CASO-ESPELHO do lado ADMIN. O critério de aceite da 231 diz "o mesmo teste
// vale para o caminho admin, SEM segunda allowlist". Este teste prova isso pelo
// COMPORTAMENTO, não por leitura de código: chama a Server Action admin real
// (`salvarPerfilAdmin`) com mocks só de I/O e inspeciona o patch capturado no
// 1º UPDATE. Se `modal_promocoes` chega ao UPDATE admin sem nenhuma linha nova
// em `src/app/admin/assinantes/actions/`, a allowlist é mesmo única — a que
// vive em `montarPatchPerfil`.
//
// O caminho admin tem DOIS gargalos antes da allowlist, e os dois precisam
// deixar o campo passar para o teste ficar verde:
//   1. `CHAVES_PERFIL = Object.keys(schemaPerfil.shape)` (allowlist-pick);
//   2. `schemaPerfil.strict()` — chave fora do shape é descartada no pick e o
//      campo sumiria em SILÊNCIO nesta via (sem erro, com `ok: true`).
// Ou seja: o GREEN precisa do campo em `schemaPerfil` também, ou o lojista
// consegue desligar o modal e o admin não.
//
// NENHUMA lógica de produção aqui.

import { describe, it, expect, vi, beforeEach } from "vitest";

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// ── next/cache ────────────────────────────────────────────────────────────────
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ── prova de admin ────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: vi.fn(async () => {}),
  obterAdminUserId: vi.fn(() => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
}));

// ── service client: captura cada UPDATE em `lojas` ────────────────────────────
type UpdateRegistro = { patch: Record<string, unknown>; eqCol?: string; eqVal?: unknown };
const updates: UpdateRegistro[] = [];

function builderLojas() {
  return {
    update(patch: Record<string, unknown>) {
      const reg: UpdateRegistro = { patch };
      updates.push(reg);
      return {
        eq(col: string, val: unknown) {
          reg.eqCol = col;
          reg.eqVal = val;
          return Promise.resolve({ data: null, error: null, count: 1 });
        },
      };
    },
  };
}

const clientServico = {
  from(tabela: string) {
    if (tabela === "admin_acessos") {
      return { insert: () => Promise.resolve({ error: null }) };
    }
    if (tabela !== "lojas") throw new Error(`from() inesperado: ${tabela}`);
    return builderLojas();
  },
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => clientServico,
}));

// ── queries: slug livre; loja-alvo SEM endereço e SEM coords (não regeocodifica) ─
const LOJA_SEM_ENDERECO = {
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
vi.mock("@/lib/supabase/queries/lojas", () => ({
  slugExiste: vi.fn(async () => false),
  buscarLojaAdminPorId: vi.fn(async () => LOJA_SEM_ENDERECO),
}));

// ── geocoding: não deve ser chamado neste cenário (endereço ausente dos 2 lados) ─
const geocodificarLojaComRetry = vi.fn(async () => ({ coords: null, motivo: "nao_encontrado" }));
vi.mock("@/lib/actions/geocodificarComRetry", () => ({
  geocodificarLojaComRetry: (...a: unknown[]) => geocodificarLojaComRetry(...(a as [])),
}));

import { salvarPerfilAdmin } from "./admin-perfil";

beforeEach(() => {
  updates.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("salvarPerfilAdmin — modal_promocoes pela allowlist ÚNICA (issue 231)", () => {
  it("GRAVA modal_promocoes: false vindo do admin (sem segunda allowlist)", async () => {
    const r = await salvarPerfilAdmin(LOJA_ID, {
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
      modal_promocoes: false,
    });

    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
    const [primeiro] = updates;
    // Escopo por id (nunca cross-tenant).
    expect(primeiro.eqCol).toBe("id");
    expect(primeiro.eqVal).toBe(LOJA_ID);
    // A asserção que mata o `if (v)` E o pick/strict que engoliria a chave.
    expect("modal_promocoes" in primeiro.patch).toBe(true);
    expect(primeiro.patch.modal_promocoes).toBe(false);
  });

  it("GRAVA modal_promocoes: true vindo do admin", async () => {
    const r = await salvarPerfilAdmin(LOJA_ID, {
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
      modal_promocoes: true,
    });

    expect(r.ok).toBe(true);
    expect(updates[0]?.patch.modal_promocoes).toBe(true);
  });

  it("ausente PRESERVA o valor no banco (a coluna não é tocada)", async () => {
    const r = await salvarPerfilAdmin(LOJA_ID, {
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
    });

    expect(r.ok).toBe(true);
    expect("modal_promocoes" in (updates[0]?.patch ?? {})).toBe(false);
  });

  it("SEGURANÇA RN-7: coluna fora da allowlist não entra, nem de carona com o campo novo", async () => {
    const r = await salvarPerfilAdmin(LOJA_ID, {
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
      modal_promocoes: false,
      ativo: true,
      dono_id: "00000000-0000-0000-0000-000000000000",
      assinatura_status: "ativa",
      hotmart_subscriber_code: "HACK231",
      latitude: -23.5,
      longitude: -46.6,
      id: "22222222-2222-2222-2222-222222222222",
    });

    expect(r.ok).toBe(true);
    const patch = updates[0]?.patch ?? {};
    expect(patch.modal_promocoes).toBe(false);
    for (const proibida of [
      "ativo",
      "dono_id",
      "assinatura_status",
      "hotmart_subscriber_code",
      "latitude",
      "longitude",
      "id",
    ]) {
      expect(proibida in patch).toBe(false);
    }
  });
});
