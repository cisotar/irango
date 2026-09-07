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

// Controle do cenário "slug ocupado" (issue 124, C1.6): por padrão o SELECT de
// `slugExiste` devolve `data: null` (slug livre — nenhum caso pré-existente
// muda isso). Setar `ocupado = true` faz o MESMO `slugExiste` real (não
// mockado) devolver uma linha, exercitando o branch "slug em uso" através da
// cadeia real `.select().eq().neq()` do client real-shape — nenhum teste hoje
// prova esse branch fora do dublê literal de `admin-perfil.test.ts` (que mocka
// `slugExiste` inteiro, sem tocar `svc.from`).
const estadoSlug = vi.hoisted(() => ({ ocupado: false }));

vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// D3 (plano 124): zero rede no CI. O payload dos cenários já omite
// cidade/estado (gate de `montarConsultaGeocoding` → null), e este mock é o
// cinto de segurança caso o gate mude: `salvarPerfilAdmin` sempre grava o par
// de coords NULL no 2º UPDATE, mantendo `capturado.updates` determinístico.
vi.mock("@/lib/utils/geocodificarEndereco", () => ({
  geocodificarEnderecoComMotivo: vi.fn(async () => ({
    coords: null,
    motivo: "nao_encontrado",
  })),
}));

vi.mock("@/lib/supabase/service", () => {
  const RESPOSTA: RespostaFake = { data: null, error: null, count: 1 };

  function criarEncadeavel(
    eqs: Array<[string, string]>,
    resposta: RespostaFake = RESPOSTA,
  ) {
    const encadeavel = {
      eq(coluna: string, valor: string) {
        eqs.push([coluna, valor]);
        return encadeavel;
      },
      // Aditivo (issue 124): `slugExiste(svc, slug, lojaId)` faz
      // `.select("id").eq("slug", …).neq("id", lojaId)`. Nenhum caso anterior
      // chama `neq` — registrar no MESMO array de `eqs` deixa as asserções de
      // escopo enxergarem qualquer filtro emitido, inclusive um `neq` hostil.
      neq(coluna: string, valor: string) {
        eqs.push([coluna, valor]);
        return encadeavel;
      },
      select() {
        return encadeavel;
      },
      maybeSingle() {
        return Promise.resolve(resposta);
      },
      then(
        onFulfilled?: (v: RespostaFake) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) {
        return Promise.resolve(resposta).then(onFulfilled, onRejected);
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
        // Só `slugExiste` faz SELECT em `lojas` neste arquivo. Quando
        // `estadoSlug.ocupado`, devolve uma linha de OUTRA loja — sem isso,
        // o branch "slug em uso" da action nunca seria exercitado com o
        // client real-shape (C1.6).
        const resposta: RespostaFake =
          tabela === "lojas" && estadoSlug.ocupado
            ? { data: [{ id: "outra-loja-com-mesmo-slug" }], error: null, count: 1 }
            : RESPOSTA;
        return criarEncadeavel(registro.eqs, resposta);
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
import { salvarPerfilAdmin } from "@/app/admin/assinantes/actions/admin-perfil";
import { verificarAdminSaaS } from "@/lib/auth/admin";

beforeEach(() => {
  capturado.updates.length = 0;
  capturado.inserts.length = 0;
  capturado.deletes.length = 0;
  capturado.selects.length = 0;
  estadoSlug.ocupado = false;
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

// ─────────────────────────────────────────────────────────────────────────────
// Issue 124 — binding POR TENANT da flag `whatsapp_envio_automatico`.
//
// Delta em relação à issue 122 (`admin-perfil.test.ts` §"Caso 5"): lá o dublê de
// `createServiceClient` é um OBJETO LITERAL (`from` como propriedade própria) —
// exatamente a forma que NÃO pegou o incidente 2026-07-03 — e o caso hostil
// assere só a AUSÊNCIA de colunas no patch, nunca o DESTINO do UPDATE.
//
// Aqui a mesma action roda contra o client real-shape deste arquivo (`from` no
// protótipo lendo `this.rest`) e as asserções são sobre ONDE a escrita cai:
// `eqs` de CADA update, igualdade EXATA (não `toContainEqual`), e ausência total
// de `LOJA_HOSTIL` em qualquer filtro ou patch.
const LOJA_HOSTIL = "99999999-9999-4999-8999-999999999999";

// SEM endereco_cidade/endereco_estado: `montarConsultaGeocoding` devolve null e o
// 2º UPDATE grava o par NULL sem tocar a rede (D3).
const PAYLOAD_MIN = {
  nome: "Pizzaria Alvo",
  slug: "pizzaria-alvo",
  whatsapp: "5511999998888",
};

describe("salvarPerfilAdmin — binding por tenant da flag whatsapp_envio_automatico (124)", () => {
  it("C1.1 — flag `false` grava na LOJA-ALVO, escopada exatamente por id", async () => {
    const resultado = await salvarPerfilAdmin(LOJA_ALVO, {
      ...PAYLOAD_MIN,
      whatsapp_envio_automatico: false,
    });

    expect(resultado).toMatchObject({ ok: true });

    // 2 UPDATEs: perfil + par de coords NULL (best-effort, D3).
    expect(capturado.updates).toHaveLength(2);
    expect(capturado.updates[0].tabela).toBe("lojas");
    expect(capturado.updates[0].patch).toHaveProperty(
      "whatsapp_envio_automatico",
      false,
    );
    // Igualdade EXATA: um segundo `.eq` (ou nenhum) mudaria o conjunto de linhas
    // atingidas. É esta asserção — não a do patch — que prova o binding.
    expect(capturado.updates[0].eqs).toEqual([["id", LOJA_ALVO]]);
    expect(capturado.updates[1].eqs).toEqual([["id", LOJA_ALVO]]);
  });

  it("C1.2 — flag `true` idem (a via não trata a flag por truthiness)", async () => {
    const resultado = await salvarPerfilAdmin(LOJA_ALVO, {
      ...PAYLOAD_MIN,
      whatsapp_envio_automatico: true,
    });

    expect(resultado).toMatchObject({ ok: true });
    expect(capturado.updates[0].patch).toHaveProperty(
      "whatsapp_envio_automatico",
      true,
    );
    expect(capturado.updates[0].eqs).toEqual([["id", LOJA_ALVO]]);
  });

  it("C1.3 — `id`/`loja_id`/`dono_id` hostis NO PAYLOAD não redirecionam a escrita", async () => {
    await salvarPerfilAdmin(LOJA_ALVO, {
      ...PAYLOAD_MIN,
      whatsapp_envio_automatico: false,
      id: LOJA_HOSTIL,
      loja_id: LOJA_HOSTIL,
      dono_id: LOJA_HOSTIL,
    });

    const perfil = capturado.updates[0];
    expect(perfil.eqs).toEqual([["id", LOJA_ALVO]]);
    expect(perfil.patch).not.toHaveProperty("id");
    expect(perfil.patch).not.toHaveProperty("loja_id");
    expect(perfil.patch).not.toHaveProperty("dono_id");
    // O hardening não é um "rejeita tudo": a flag legítima sobrevive ao mesmo
    // payload hostil.
    expect(perfil.patch).toHaveProperty("whatsapp_envio_automatico", false);

    // `LOJA_HOSTIL` não aparece em NENHUM filtro de NENHUM update…
    expect(
      capturado.updates.flatMap((u) => u.eqs).map(([, valor]) => valor),
    ).not.toContain(LOJA_HOSTIL);
    // …nem em patch algum (rede de segurança sobre escopo e conteúdo de uma vez).
    expect(JSON.stringify(capturado.updates)).not.toContain(LOJA_HOSTIL);
  });

  it("C1.4 — nenhum UPDATE em `lojas` sai sem escopo (a loja do próprio admin fica intacta)", async () => {
    await salvarPerfilAdmin(LOJA_ALVO, {
      ...PAYLOAD_MIN,
      whatsapp_envio_automatico: false,
    });

    const emLojas = capturado.updates.filter((u) => u.tabela === "lojas");
    expect(emLojas.length).toBeGreaterThan(0);
    for (const u of emLojas) {
      // Um UPDATE em `lojas` sem `.eq` atingiria TODAS as lojas do SaaS,
      // inclusive a do admin logado — cenário-catástrofe fechado aqui.
      expect(u.eqs.length).toBeGreaterThan(0);
      expect(u.eqs).toEqual([["id", LOJA_ALVO]]);
    }
  });

  it("C1.5 — `lojaId` de rota inválido é fail-closed: zero I/O, zero UPDATE", async () => {
    const resultado = await salvarPerfilAdmin("nao-e-uuid", {
      ...PAYLOAD_MIN,
      whatsapp_envio_automatico: false,
    });

    expect(resultado).toMatchObject({ ok: false });
    expect(capturado.updates).toHaveLength(0);
    // `validarLojaIdAdmin` corta ANTES de `slugExiste` — nem o SELECT roda.
    expect(capturado.selects).toHaveLength(0);
  });

  // Delta real (auditoria 124): `admin-perfil.test.ts` (122) mocka `slugExiste`
  // INTEIRO como função — o branch "slug ocupado" da implementação REAL
  // (`src/lib/supabase/queries/lojas.ts`, `.select().eq().neq()`) nunca roda
  // contra um client ali. Aqui `slugExiste` NÃO é mockado (mesma escolha de
  // C1.1–C1.5): o fake do client é quem simula a linha colidente, exercitando
  // a cadeia real ponta a ponta.
  it("C1.6 — slug ocupado por OUTRA loja (client real-shape): zero UPDATE", async () => {
    estadoSlug.ocupado = true;

    const resultado = await salvarPerfilAdmin(LOJA_ALVO, {
      ...PAYLOAD_MIN,
      whatsapp_envio_automatico: false,
    });

    expect(resultado).toMatchObject({ ok: false });
    // Save é atômico do ponto de vista da UX: slug ocupado barra a flag junto.
    expect(capturado.updates).toHaveLength(0);
    // O SELECT realmente rodou (não é um curto-circuito antes de tocar o client).
    expect(capturado.selects).toHaveLength(1);
    expect(capturado.selects[0].tabela).toBe("lojas");
  });

  // Delta real: em `admin-perfil.test.ts` o mock de `@/lib/auth/admin` já
  // cobre esta ordem, mas com o dublê literal do client (que não pegaria o
  // incidente 2026-07-03 se alguém movesse a prova de admin para DEPOIS de
  // `createServiceClient`). Aqui a mesma prova roda contra o client real-shape.
  it("C1.7 — verificarAdminSaaS reprovando (client real-shape): propaga, zero I/O", async () => {
    vi.mocked(verificarAdminSaaS).mockRejectedValueOnce(
      new Error("Acesso negado."),
    );

    await expect(
      salvarPerfilAdmin(LOJA_ALVO, {
        ...PAYLOAD_MIN,
        whatsapp_envio_automatico: false,
      }),
    ).rejects.toThrow("Acesso negado.");

    // Nunca chegou a criar o service client nem a tocar `lojas`: zero SELECT,
    // zero UPDATE. Nunca degrada para "salvar mesmo assim".
    expect(capturado.selects).toHaveLength(0);
    expect(capturado.updates).toHaveLength(0);
  });

  // Concorrência/idempotência: dois saves sequenciais do admin na MESMA loja.
  // Sem dinheiro nem contador aqui (plano 124, tabela "Bordas e erros"): cada
  // chamada é independente e escopada por `id`, então "last-write-wins" sobre
  // um booleano é o comportamento correto — não deveria exigir lock/RPC. Este
  // teste prova que repetir a chamada não vaza escopo nem acumula patches
  // cruzados entre as duas execuções.
  it("C1.8 — dois saves sequenciais do admin: cada UPDATE seguido escopado por LOJA_ALVO, last-write-wins", async () => {
    await salvarPerfilAdmin(LOJA_ALVO, {
      ...PAYLOAD_MIN,
      whatsapp_envio_automatico: true,
    });
    await salvarPerfilAdmin(LOJA_ALVO, {
      ...PAYLOAD_MIN,
      whatsapp_envio_automatico: false,
    });

    const emLojas = capturado.updates.filter((u) => u.tabela === "lojas");
    // 2 saves × (1º UPDATE perfil + 2º UPDATE par de coords) = 4.
    expect(emLojas).toHaveLength(4);
    for (const u of emLojas) {
      // Nenhum dos dois saves escapa do escopo por id, mesmo em sequência.
      expect(u.eqs).toEqual([["id", LOJA_ALVO]]);
    }

    const patchesComFlag = emLojas
      .map((u) => u.patch as Record<string, unknown>)
      .filter((p) => "whatsapp_envio_automatico" in p);
    expect(patchesComFlag).toHaveLength(2);
    // A 2ª chamada é a que vale (last-write-wins) — nenhuma sobrescrita cruzada.
    expect(patchesComFlag[0].whatsapp_envio_automatico).toBe(true);
    expect(patchesComFlag[1].whatsapp_envio_automatico).toBe(false);
  });
});
