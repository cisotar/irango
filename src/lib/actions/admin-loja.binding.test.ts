// Regressão do incidente de produção (2026-07-03): TODAS as escritas admin via
// `escopo` falhavam na Vercel com `TypeError: Cannot read properties of
// undefined (reading 'rest')` em `Object.atualizarLoja`/`Object.buscarPorId`.
//
// Causa: `criarEscopoLoja` desacoplava o método do client
// (`const from = svc.from`) — no supabase-js real, `from` é método de PROTÓTIPO
// que lê `this.rest` (dist/index.mjs: `from(relation) { return
// this.rest.from(relation) }`); chamado solto, `this` é `undefined`.
//
// Os testes das actions admin não pegaram porque mockam `createServiceClient`
// com objeto literal (`from:` como propriedade própria/arrow, sem dependência de
// `this`). ESTE arquivo fecha essa lacuna: o fake reproduz a forma do client
// real — `from` no protótipo lendo `this.rest` — de modo que qualquer chamada
// desacoplada volta a explodir exatamente como em produção.

import { describe, it, expect, vi, beforeEach } from "vitest";

const LOJA_ALVO = "5ec21485-e58a-4071-a41c-f8963076ae00";

type RespostaFake = { data: unknown; error: null; count: number };

// Registro das escritas capturadas pelo fake (inspecionado nas asserções).
const capturado = vi.hoisted(() => ({
  updates: [] as Array<{ tabela: string; patch: unknown; eqs: Array<[string, string]> }>,
  inserts: [] as Array<{ tabela: string; dados: unknown }>,
  deletes: [] as Array<{ tabela: string; eqs: Array<[string, string]> }>,
  selects: [] as Array<{ tabela: string; eqs: Array<[string, string]> }>,
}));

vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => {
  const RESPOSTA: RespostaFake = { data: null, error: null, count: 1 };

  function criarEncadeavel(eqs: Array<[string, string]>) {
    const encadeavel = {
      eq(coluna: string, valor: string) {
        eqs.push([coluna, valor]);
        return encadeavel;
      },
      select() {
        return encadeavel;
      },
      maybeSingle() {
        return Promise.resolve(RESPOSTA);
      },
      then(
        onFulfilled?: (v: RespostaFake) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) {
        return Promise.resolve(RESPOSTA).then(onFulfilled, onRejected);
      },
    };
    return encadeavel;
  }

  function criarBuilder(tabela: string) {
    return {
      insert(dados: unknown) {
        capturado.inserts.push({ tabela, dados });
        return criarEncadeavel([]);
      },
      update(patch: unknown) {
        const registro = { tabela, patch, eqs: [] as Array<[string, string]> };
        capturado.updates.push(registro);
        return criarEncadeavel(registro.eqs);
      },
      delete() {
        const registro = { tabela, eqs: [] as Array<[string, string]> };
        capturado.deletes.push(registro);
        return criarEncadeavel(registro.eqs);
      },
      select() {
        const registro = { tabela, eqs: [] as Array<[string, string]> };
        capturado.selects.push(registro);
        return criarEncadeavel(registro.eqs);
      },
    };
  }

  class PostgrestFake {
    from(tabela: string) {
      return criarBuilder(tabela);
    }
  }

  // Fiel ao SupabaseClient real: `from` no PROTÓTIPO, lendo `this.rest`.
  // `svc.from` desacoplado → `this === undefined` → TypeError (reading 'rest').
  class ServiceClientFake {
    rest = new PostgrestFake();
    from(tabela: string) {
      return this.rest.from(tabela);
    }
    storage = {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    };
  }

  return { createServiceClient: () => new ServiceClientFake() };
});

import { prepararContextoAdmin } from "./admin-loja";
import { removerLogoAdmin } from "@/app/admin/assinantes/actions/admin-logo";

beforeEach(() => {
  capturado.updates.length = 0;
  capturado.inserts.length = 0;
  capturado.deletes.length = 0;
  capturado.selects.length = 0;
});

describe("criarEscopoLoja — binding com client real (from de protótipo, this.rest)", () => {
  it("todos os helpers do escopo executam sem TypeError e injetam o escopo por loja", async () => {
    const { escopo } = await prepararContextoAdmin(LOJA_ALVO);

    // Se `from` estiver desacoplado do client, cada linha abaixo lança
    // `TypeError: Cannot read properties of undefined (reading 'rest')`.
    await escopo.inserir("produtos", { nome: "X", preco: 10 });
    await escopo.atualizar("produtos", "id-1", { nome: "Y" });
    await escopo.remover("produtos", "id-1");
    await escopo.buscarPorId("produtos", "id-1");
    await escopo.atualizarLoja({ logo_url: null });

    expect(capturado.inserts).toHaveLength(1);
    expect(capturado.inserts[0]).toMatchObject({
      tabela: "produtos",
      dados: { nome: "X", loja_id: LOJA_ALVO },
    });
    expect(capturado.updates.map((u) => u.tabela)).toEqual(["produtos", "lojas"]);
    expect(capturado.updates[0].eqs).toEqual([
      ["loja_id", LOJA_ALVO],
      ["id", "id-1"],
    ]);
    expect(capturado.updates[1].eqs).toEqual([["id", LOJA_ALVO]]);
    expect(capturado.deletes[0].eqs).toEqual([
      ["loja_id", LOJA_ALVO],
      ["id", "id-1"],
    ]);
    expect(capturado.selects[0].eqs).toEqual([
      ["loja_id", LOJA_ALVO],
      ["id", "id-1"],
    ]);
  });

  it("removerLogoAdmin (ponta a ponta da action) retorna ok com o client real-shape", async () => {
    const resultado = await removerLogoAdmin(LOJA_ALVO);

    expect(resultado).toEqual({ ok: true });
    expect(capturado.updates).toHaveLength(1);
    expect(capturado.updates[0]).toMatchObject({
      tabela: "lojas",
      patch: { logo_url: null },
    });
    expect(capturado.updates[0].eqs).toEqual([["id", LOJA_ALVO]]);
  });
});
