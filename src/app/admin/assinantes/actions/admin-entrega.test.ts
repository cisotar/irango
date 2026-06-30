import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 093 (crítica: SIM). Variantes ADMIN do CRUD de ZONAS de
 * entrega (zona + taxa 1:1 + bairros 1:N) na loja-alvo (`lojaId` explícito da URL
 * admin), via service_role, escopadas por `eq("loja_id", lojaId)`.
 *
 * Por que é RED de verdade HOJE: `criarZonaAdmin` / `atualizarZonaAdmin` /
 * `removerZonaAdmin` são STUBs que lançam "TODO: GREEN" (a fase GREEN/`executar`
 * implementa a lógica). O `import` resolve (arquivo existe), mas cada chamada
 * lança → toda asserção abaixo FALHA. Output real anexado na issue 093.
 *
 * Invariantes provadas (issue 093, specs/admin-onboarding-assistido.md — RN-2/3/6):
 *  - taxa NEGATIVA → reprovada (`schemaZonaCompleta`/`CHECK taxa>=0`): { ok:false }
 *    SEM tocar admin/service/insert (autoridade de escrita é o servidor, RN-6).
 *  - CHECAGEM DE PROPRIEDADE (central): atualizar/remover passando `zona_id` cuja
 *    zona NÃO pertence à `lojaId` → bloqueado ANTES de escrever em taxas_entrega/
 *    bairros_zona. A action confirma a posse consultando `zonas_entrega` escopado
 *    por eq("loja_id", lojaId). Filho NUNCA é escrito sob zona alheia.
 *  - CROSS-LOJA: zona escopada por eq("id", id)+eq("loja_id", lojaId) no
 *    update/delete → zona de outra loja não é afetada.
 *  - admin NÃO provado (verificarAdminSaaS lança) → exceção PROPAGA (fail-closed
 *    D-4), createServiceClient NUNCA chamado, ZERO efeito.
 *  - sucesso → grava zona+taxa+bairros na loja-alvo; `loja_id` gravado = `lojaId`
 *    da URL (nunca do payload); `taxa` do payload validado (RN-6).
 *
 * CONTRATO que o GREEN deve satisfazer (src/app/admin/assinantes/actions/admin-entrega.ts):
 *   criarZonaAdmin(lojaId: string, payload: unknown): Promise<{ok:true}|{ok:false;erro:string}>
 *   atualizarZonaAdmin(lojaId: string, id: string, payload: unknown): Promise<...>
 *   removerZonaAdmin(lojaId: string, id: string): Promise<...>
 */

const LOJA_ALVO = "11111111-1111-1111-1111-111111111111";
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222";
const ZONA_ID = "33333333-3333-3333-3333-333333333333";

// Payload válido do form de zona completa (zona + taxa 1:1 + bairros 1:N).
const payloadValido = {
  nome: "Centro",
  tipo: "bairro" as const,
  ativo: true,
  taxa: { taxa: 7.5, pedido_minimo_gratis: null, raio_max_km: null },
  bairros: ["Centro", "Sé"],
};

// ── Captura de TODAS as operações por tabela (insert/update/delete + filtros). ──
type Op = {
  tabela: string;
  acao: "insert" | "update" | "delete" | "select";
  payload?: unknown;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];

// Resposta da consulta de PROPRIEDADE da zona (select em zonas_entrega .single()).
// Default: zona pertence à loja-alvo. Testes de zona alheia trocam para null/erro.
let respostaPosseZona: { data: unknown; error: unknown };
// Resposta genérica de escrita (insert/update/delete) — default sucesso.
let respostaEscrita: { data: unknown; error: unknown };

// ── next/cache: revalidatePath fora de request scope → mock. ──────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS: prova de admin. Default passa; negação via mockReject. ──
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock encadeável. ───────────────────────
// CRÍTICO: o client raiz NÃO é thenável (só expõe `.from`). Apenas os nós
// retornados por `.from(...).select()/.eq()/...` terminam numa Promise — senão
// `await` assimilaria o thenable. Espelha actions.test.ts / entregaPagamento.test.ts.
function makeChain() {
  let tabela = "";
  let acao: Op["acao"] = "select";
  const filtros: Array<[string, unknown]> = [];
  let payload: unknown;
  const node: Record<string, unknown> = {};

  const registrar = () =>
    ops.push({ tabela, acao, payload, filtros: [...filtros] });

  node.select = () => node;
  node.single = () => {
    registrar();
    return Promise.resolve(respostaPosseZona);
  };
  node.maybeSingle = () => {
    registrar();
    return Promise.resolve(respostaPosseZona);
  };
  node.eq = (col: string, val: unknown) => {
    filtros.push([col, val]);
    return node;
  };
  node.insert = (row: unknown) => {
    acao = "insert";
    payload = row;
    return node;
  };
  node.update = (row: unknown) => {
    acao = "update";
    payload = row;
    return node;
  };
  node.upsert = (row: unknown) => {
    acao = "update";
    payload = row;
    return node;
  };
  node.delete = () => {
    acao = "delete";
    return node;
  };
  // Resolução terminal de escrita (insert/update/delete sem .single()).
  node.then = (onF: (v: unknown) => unknown) => {
    registrar();
    return Promise.resolve(respostaEscrita).then(onF);
  };

  return (t: string) => {
    tabela = t;
    return node;
  };
}

const clientServico = {
  from: (t: string) => fromImpl(t),
};
let fromImpl: (t: string) => unknown;
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// STUBs lançam "TODO: GREEN" → import resolve, mas cada chamada falha → RED.
import {
  criarZonaAdmin,
  atualizarZonaAdmin,
  removerZonaAdmin,
} from "./admin-entrega";

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  respostaPosseZona = { data: { id: ZONA_ID, loja_id: LOJA_ALVO }, error: null };
  respostaEscrita = { data: { id: ZONA_ID }, error: null };
  verificarAdminSaaS.mockResolvedValue(undefined);
  // Cada chamada de action reconstrói a cadeia (estado de op por nó).
  fromImpl = (t: string) => makeChain()(t);
});

// Reinstala a cadeia por teste (cada `.from` precisa de nó fresco).
function freshClient() {
  fromImpl = (t: string) => makeChain()(t);
}

// ───────────────── Caso 1: taxa negativa reprovada (RN-6) ────────────────────
describe("criarZonaAdmin — taxa negativa reprovada (autoridade do servidor, RN-6)", () => {
  it("taxa < 0 → { ok:false } SEM admin/service/insert", async () => {
    freshClient();
    const payloadTaxaNeg = {
      ...payloadValido,
      taxa: { taxa: -5, pedido_minimo_gratis: null, raio_max_km: null },
    };

    const r = await criarZonaAdmin(LOJA_ALVO, payloadTaxaNeg);

    expect(r).toEqual(expect.objectContaining({ ok: false }));
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });
});

// ──────── Caso 2: checagem de PROPRIEDADE — filho sob zona alheia bloqueado ───
describe("atualizarZonaAdmin — checagem de propriedade da zona (central)", () => {
  it("zona_id NÃO pertence à lojaId → bloqueado ANTES de escrever taxa/bairros", async () => {
    freshClient();
    // A consulta de posse não encontra a zona sob a loja-alvo (zona é de outra loja).
    respostaPosseZona = { data: null, error: null };

    const r = await atualizarZonaAdmin(LOJA_ALVO, ZONA_ID, payloadValido);

    expect(r).toEqual(expect.objectContaining({ ok: false }));

    // A action CONSULTOU zonas_entrega escopando por id + loja-alvo.
    const consultaPosse = ops.find(
      (o) => o.tabela === "zonas_entrega" && o.acao === "select",
    );
    expect(consultaPosse).toBeDefined();
    expect(consultaPosse!.filtros).toContainEqual(["loja_id", LOJA_ALVO]);

    // NADA escrito em filhos (taxa/bairros) sob zona alheia.
    const escritaFilho = ops.find(
      (o) =>
        (o.tabela === "taxas_entrega" || o.tabela === "bairros_zona") &&
        o.acao !== "select",
    );
    expect(escritaFilho).toBeUndefined();
  });
});

// ──────────────── Caso 3: cross-loja — update/delete escopados ───────────────
describe("atualizarZonaAdmin / removerZonaAdmin — zona escopada por loja-alvo (cross-loja)", () => {
  it("atualizarZonaAdmin escopa a zona por eq('id') + eq('loja_id', lojaAlvo)", async () => {
    freshClient();

    await atualizarZonaAdmin(LOJA_ALVO, ZONA_ID, payloadValido);

    const opZona = ops.find(
      (o) => o.tabela === "zonas_entrega" && o.acao === "update",
    );
    expect(opZona).toBeDefined();
    expect(opZona!.filtros).toContainEqual(["id", ZONA_ID]);
    expect(opZona!.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
    // Nunca escopa por loja de outra.
    expect(opZona!.filtros).not.toContainEqual(["loja_id", LOJA_OUTRA]);
  });

  it("removerZonaAdmin deleta a zona escopada por eq('id') + eq('loja_id', lojaAlvo)", async () => {
    freshClient();

    await removerZonaAdmin(LOJA_ALVO, ZONA_ID);

    const opDel = ops.find(
      (o) => o.tabela === "zonas_entrega" && o.acao === "delete",
    );
    expect(opDel).toBeDefined();
    expect(opDel!.filtros).toContainEqual(["id", ZONA_ID]);
    expect(opDel!.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
  });
});

// ──────────── Caso 4: admin não provado → exceção, zero efeito (D-4) ─────────
describe("criarZonaAdmin — fail-closed quando admin é negado (D-4)", () => {
  it("verificarAdminSaaS lança → action REJEITA (propaga), service NUNCA criado, ZERO insert", async () => {
    freshClient();
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(criarZonaAdmin(LOJA_ALVO, payloadValido)).rejects.toThrow(
      "acesso negado",
    );

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ────────────── Caso 5: sucesso → grava zona+taxa+bairros na loja-alvo ───────
describe("criarZonaAdmin — sucesso grava zona+taxa+bairros na loja-alvo", () => {
  it("INSERT zona com loja_id = lojaAlvo (nunca do payload), taxa do payload, bairros", async () => {
    freshClient();

    const r = await criarZonaAdmin(LOJA_ALVO, payloadValido);

    expect(r).toEqual({ ok: true });
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(createServiceClient).toHaveBeenCalledTimes(1);

    // Zona gravada na loja-alvo, loja_id da URL (não do payload).
    const insZona = ops.find(
      (o) => o.tabela === "zonas_entrega" && o.acao === "insert",
    );
    expect(insZona).toBeDefined();
    expect(insZona!.payload).toEqual(
      expect.objectContaining({ loja_id: LOJA_ALVO, nome: "Centro" }),
    );

    // Taxa do payload VALIDADO gravada (RN-6: autoridade do servidor).
    const insTaxa = ops.find(
      (o) => o.tabela === "taxas_entrega" && o.acao === "insert",
    );
    expect(insTaxa).toBeDefined();
    expect(insTaxa!.payload).toEqual(
      expect.objectContaining({ taxa: 7.5 }),
    );

    // Bairros gravados.
    const insBairros = ops.find(
      (o) => o.tabela === "bairros_zona" && o.acao === "insert",
    );
    expect(insBairros).toBeDefined();
  });

  it("loja_id do PAYLOAD é ignorado — gravação usa sempre a loja-alvo da URL", async () => {
    freshClient();
    const payloadComLojaForjada = { ...payloadValido, loja_id: LOJA_OUTRA };

    await criarZonaAdmin(LOJA_ALVO, payloadComLojaForjada);

    const insZona = ops.find(
      (o) => o.tabela === "zonas_entrega" && o.acao === "insert",
    );
    expect(insZona).toBeDefined();
    const grava = insZona!.payload as Record<string, unknown>;
    expect(grava.loja_id).toBe(LOJA_ALVO);
    expect(grava.loja_id).not.toBe(LOJA_OUTRA);
  });
});
