import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 088 (crítica: SIM). Server Actions admin de categorias em
 * `./admin-categorias`:
 *   criarCategoriaAdmin(lojaId, payload)
 *   atualizarCategoriaAdmin(lojaId, id, payload)
 *   removerCategoriaAdmin(lojaId, id)
 *   reordenarCategoriasAdmin(lojaId, ordem)
 *
 * Por que é RED de verdade HOJE: o módulo `./admin-categorias` ainda não tem a
 * lógica — a fase GREEN/`executar` a escreve. O STUB lança "TODO: GREEN", então
 * cada invocação cai na asserção (ou rejeita com a marca do stub onde esperamos
 * resultado). Output real anexado na issue 088.
 *
 * Invariantes provadas (spec admin-onboarding-assistido.md RN-1/2/3 + plano §088):
 *  1. (D-4 / fail-closed) `verificarAdminSaaS()` lança ANTES de qualquer efeito →
 *     a exceção PROPAGA (nunca vira `{ ok:false }` amigável) e o service client /
 *     escrita NUNCA roda.
 *  2. `lojaId` não-UUID → rejeitado, ZERO efeito (sem admin/service/escrita).
 *  3. CROSS-LOJA: toda query/escrita inclui `.eq("loja_id", lojaId)`. Update/delete
 *     com `id` de categoria de OUTRA loja → o escopo zera o match (count 0 linhas)
 *     → não afeta a categoria alheia, retorno `{ ok:false }`.
 *  4. Sucesso: cria/edita na loja-alvo; `loja_id` vem do PARÂMETRO `lojaId`, NUNCA
 *     do payload (payload hostil com `loja_id` de outra loja é ignorado).
 *
 * CONTRATO que o GREEN deve satisfazer (ver bloco final do arquivo).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";
const CATEGORIA_ID = "33333333-3333-3333-3333-333333333333";

// ── next/cache: revalidatePath fora de request scope → mock. ──────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS: prova de admin. Default passa; negação via mockRejected. ─
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient (server-only) → mock com query builder ENCADEÁVEL e
//    ESPIONÁVEL. Registra, por operação, a tabela, a forma (insert/update/delete),
//    os `.eq(col, val)` aplicados e o payload — é com isso que provamos o escopo
//    `eq("loja_id", lojaId)` e que `loja_id` vem do parâmetro, não do payload.
//    A resposta terminal (`data`/`error`/`count`) é controlável por teste, para
//    simular o CROSS-LOJA (count 0 = escopo zerou o match).
type Operacao = {
  tabela: string;
  tipo: "insert" | "update" | "delete" | "select" | "upsert";
  payload?: unknown;
  eqs: { coluna: string; valor: unknown }[];
};

const ops: Operacao[] = [];
// Resposta terminal por operação; default = sucesso 1 linha. Cada teste sobrescreve.
let terminalResponder: (op: Operacao) => {
  data: unknown;
  error: unknown;
  count: number | null;
};

function criarBuilder(tabela: string) {
  // Cada chamada de `.from()` abre uma operação nova. O builder é "thenable":
  // o GREEN faz `await svc.from(...).update(...).eq(...).eq(...)`, então o objeto
  // encadeado precisa resolver para a resposta terminal.
  const op: Operacao = { tabela, tipo: "select", eqs: [] };
  ops.push(op);

  const builder: Record<string, unknown> = {
    insert(payload: unknown) {
      op.tipo = "insert";
      op.payload = payload;
      return builder;
    },
    update(payload: unknown) {
      op.tipo = "update";
      op.payload = payload;
      return builder;
    },
    upsert(payload: unknown) {
      op.tipo = "upsert";
      op.payload = payload;
      return builder;
    },
    delete() {
      op.tipo = "delete";
      return builder;
    },
    select() {
      op.tipo = op.tipo === "select" ? "select" : op.tipo;
      return builder;
    },
    eq(coluna: string, valor: unknown) {
      op.eqs.push({ coluna, valor });
      return builder;
    },
    order() {
      return builder;
    },
    // thenable: resolve para a resposta terminal da operação.
    then(
      resolve: (v: { data: unknown; error: unknown; count: number | null }) => unknown,
    ) {
      return Promise.resolve(terminalResponder(op)).then(resolve);
    },
  };
  return builder;
}

const clientServico = {
  from: (tabela: string) => criarBuilder(tabela),
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// 'use server' é só diretiva; o módulo é importável no runner node. As actions
// ainda lançam "TODO: GREEN" (STUB) → RED nas asserções.
import {
  criarCategoriaAdmin,
  atualizarCategoriaAdmin,
  removerCategoriaAdmin,
  reordenarCategoriasAdmin,
  alternarExibirImagensAdmin,
} from "./admin-categorias";

// Helper: encontra a operação de escrita (não-select) registrada.
function opEscrita(): Operacao | undefined {
  return ops.find((o) => o.tipo !== "select");
}

beforeEach(() => {
  vi.clearAllMocks();
  ops.length = 0;
  verificarAdminSaaS.mockResolvedValue(undefined);
  // Default caminho feliz: a operação afeta 1 linha.
  terminalResponder = () => ({ data: [{ id: CATEGORIA_ID }], error: null, count: 1 });
});

// ───────────── Caso 2: lojaId inválido (sem efeito algum) ────────────────────
describe("admin-categorias — validação de lojaId (UUID)", () => {
  it("criarCategoriaAdmin com lojaId não-UUID → rejeita/erro SEM admin/service/escrita", async () => {
    const r = await criarCategoriaAdmin("nao-e-uuid", { nome: "Bebidas", ordem: 0 });

    expect(r).toEqual({ ok: false, erro: "Loja inválida." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("atualizarCategoriaAdmin com lojaId não-UUID → erro SEM efeito", async () => {
    const r = await atualizarCategoriaAdmin("xxx", CATEGORIA_ID, { nome: "X", ordem: 0 });

    expect(r).toEqual({ ok: false, erro: "Loja inválida." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });
});

// ───── Caso 1: admin negado → exceção PROPAGA, fail-closed, nada escrito ──────
describe("admin-categorias — fail-closed quando admin é negado (D-4)", () => {
  it("criarCategoriaAdmin: verificarAdminSaaS lança → REJEITA (propaga), NÃO toca service/escrita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));

    await expect(
      criarCategoriaAdmin(LOJA_ID, { nome: "Bebidas", ordem: 0 }),
    ).rejects.toThrow("Acesso negado.");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("removerCategoriaAdmin: admin negado → propaga, zero efeito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));

    await expect(removerCategoriaAdmin(LOJA_ID, CATEGORIA_ID)).rejects.toThrow(
      "Acesso negado.",
    );
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });
});

// ─────────── Caso 3: CROSS-LOJA — escopo eq("loja_id", lojaId) ───────────────
describe("admin-categorias — escopo cross-loja (eq loja_id) é OBRIGATÓRIO", () => {
  it("atualizarCategoriaAdmin: escreve com .eq('loja_id', lojaId) E .eq('id', id)", async () => {
    await atualizarCategoriaAdmin(LOJA_ID, CATEGORIA_ID, { nome: "Doces", ordem: 1 });

    const op = opEscrita();
    expect(op).toBeDefined();
    expect(op!.tabela).toBe("categorias");
    expect(op!.tipo).toBe("update");
    // Escopo manual obrigatório: RLS não protege sob service_role (§7).
    expect(op!.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_ID });
    expect(op!.eqs).toContainEqual({ coluna: "id", valor: CATEGORIA_ID });
  });

  it("removerCategoriaAdmin: DELETE escopado por loja_id E id", async () => {
    await removerCategoriaAdmin(LOJA_ID, CATEGORIA_ID);

    const op = opEscrita();
    expect(op).toBeDefined();
    expect(op!.tipo).toBe("delete");
    expect(op!.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_ID });
    expect(op!.eqs).toContainEqual({ coluna: "id", valor: CATEGORIA_ID });
  });

  it("CROSS-LOJA: update de categoria de OUTRA loja → count 0 → não afeta, { ok:false }", async () => {
    // Categoria pertence a OUTRA_LOJA; chamamos com LOJA_ID. O escopo
    // eq("loja_id", LOJA_ID) zera o match → o terminal devolve count 0.
    terminalResponder = (op) => {
      const escopadaPelaLojaCerta = op.eqs.some(
        (e) => e.coluna === "loja_id" && e.valor === LOJA_ID,
      );
      // Linha real é da OUTRA_LOJA: só casaria se o escopo fosse OUTRA_LOJA.
      const casou = escopadaPelaLojaCerta ? 0 : 1;
      return { data: [], error: null, count: casou };
    };

    const r = await atualizarCategoriaAdmin(LOJA_ID, CATEGORIA_ID, {
      nome: "Sequestrada",
      ordem: 0,
    });

    expect(r).toEqual({ ok: false, erro: "Categoria não encontrada." });
    // Provou que o escopo da loja correta foi aplicado (e por isso casou 0).
    const op = opEscrita();
    expect(op!.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_ID });
  });
});

// ─────────── Caso 4: sucesso — loja_id vem do PARÂMETRO, não do payload ──────
describe("admin-categorias — loja_id autoritativo (parâmetro, nunca payload)", () => {
  it("criarCategoriaAdmin: INSERT com loja_id = lojaId; payload hostil com loja_id alheio é IGNORADO", async () => {
    const r = await criarCategoriaAdmin(LOJA_ID, {
      nome: "Lanches",
      ordem: 2,
      // payload hostil: tenta plantar a categoria em OUTRA loja.
      loja_id: OUTRA_LOJA,
    });

    expect(r).toEqual({ ok: true });
    const op = opEscrita();
    expect(op).toBeDefined();
    expect(op!.tabela).toBe("categorias");
    expect(op!.tipo).toBe("insert");
    // loja_id autoritativo = parâmetro. NUNCA o do payload.
    const payload = op!.payload as { loja_id?: string; nome?: string };
    expect(payload.loja_id).toBe(LOJA_ID);
    expect(payload.loja_id).not.toBe(OUTRA_LOJA);
    expect(payload.nome).toBe("Lanches");
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("criarCategoriaAdmin: prova de admin ANTES de elevar a service_role", async () => {
    await criarCategoriaAdmin(LOJA_ID, { nome: "Lanches", ordem: 0 });

    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
  });

  it("reordenarCategoriasAdmin: cada escrita escopada por loja_id = lojaId", async () => {
    await reordenarCategoriasAdmin(LOJA_ID, [
      { id: CATEGORIA_ID, ordem: 0 },
      { id: OUTRA_LOJA, ordem: 1 },
    ]);

    const escritas = ops.filter((o) => o.tipo !== "select");
    expect(escritas.length).toBeGreaterThan(0);
    // TODA escrita de reordenação precisa carregar o escopo da loja-alvo.
    for (const op of escritas) {
      expect(op.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_ID });
    }
  });
});

// ───── alternarExibirImagensAdmin (toggle exibir/ocultar imagens — issue) ────
describe("admin-categorias — alternarExibirImagensAdmin", () => {
  it("lojaId não-UUID → erro SEM admin/service/escrita", async () => {
    const r = await alternarExibirImagensAdmin("xxx", CATEGORIA_ID, false);

    expect(r).toEqual({ ok: false, erro: "Loja inválida." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("payload não-boolean → { ok:false, erro:'Dados inválidos.' } SEM efeito", async () => {
    const r = await alternarExibirImagensAdmin(
      LOJA_ID,
      CATEGORIA_ID,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "true" as any,
    );

    expect(r).toEqual({ ok: false, erro: "Dados inválidos." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("admin negado → propaga (fail-closed), zero efeito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));

    await expect(
      alternarExibirImagensAdmin(LOJA_ID, CATEGORIA_ID, false),
    ).rejects.toThrow("Acesso negado.");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("grava exibir_imagens escopado por loja_id E id, na loja-alvo", async () => {
    const r = await alternarExibirImagensAdmin(LOJA_ID, CATEGORIA_ID, false);

    expect(r).toEqual({ ok: true });
    const op = opEscrita();
    expect(op).toBeDefined();
    expect(op!.tabela).toBe("categorias");
    expect(op!.tipo).toBe("update");
    expect(op!.payload).toEqual({ exibir_imagens: false });
    expect(op!.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_ID });
    expect(op!.eqs).toContainEqual({ coluna: "id", valor: CATEGORIA_ID });
    expect(revalidatePath).toHaveBeenCalled();
  });

  // ISOLAMENTO: categoria existe (id casa), mas pertence a OUTRA loja — o
  // escopo eq("loja_id", lojaId) zera o match (count 0), então a categoria
  // alheia NÃO é afetada mesmo com o id correto.
  it("ISOLADO: categoria de OUTRA loja (mesmo id) → count 0 → 'Categoria não encontrada.', não afeta a alheia", async () => {
    terminalResponder = (op) => {
      const escopadaPelaLojaCerta = op.eqs.some(
        (e) => e.coluna === "loja_id" && e.valor === LOJA_ID,
      );
      const casou = escopadaPelaLojaCerta ? 0 : 1;
      return { data: [], error: null, count: casou };
    };

    const r = await alternarExibirImagensAdmin(LOJA_ID, CATEGORIA_ID, true);

    expect(r).toEqual({ ok: false, erro: "Categoria não encontrada." });
    const op = opEscrita();
    expect(op!.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_ID });
  });

  it("exibir_imagens=true grava true explicitamente (não é tratado como ausente)", async () => {
    const r = await alternarExibirImagensAdmin(LOJA_ID, CATEGORIA_ID, true);
    expect(r).toEqual({ ok: true });
    expect(opEscrita()!.payload).toEqual({ exibir_imagens: true });
  });
});

/**
 * ── CONTRATO PARA A FASE GREEN (executar) ────────────────────────────────────
 * Arquivo: src/app/admin/assinantes/actions/admin-categorias.ts  ('use server')
 *
 * Assinaturas:
 *   criarCategoriaAdmin(lojaId: string, payload: unknown):
 *     Promise<{ ok:true } | { ok:false; erro:string }>
 *   atualizarCategoriaAdmin(lojaId: string, id: string, payload: unknown):
 *     Promise<{ ok:true } | { ok:false; erro:string }>
 *   removerCategoriaAdmin(lojaId: string, id: string):
 *     Promise<{ ok:true } | { ok:false; erro:string }>
 *   reordenarCategoriasAdmin(lojaId: string, ordem: { id:string; ordem:number }[]):
 *     Promise<{ ok:true } | { ok:false; erro:string }>
 *
 * Ordem fail-closed por action (espelha actions.ts):
 *   validarLojaIdAdmin(lojaId) → senão { ok:false, erro:"Loja inválida." }
 *   schemaCategoria.safeParse(payload) (criar/atualizar) → senão { ok:false, ... }
 *   verificarAdminSaaS() FORA do try (propaga, D-4)
 *   createServiceClient()
 *   escrita escopada SEMPRE por .eq("loja_id", lojaId) (+ .eq("id", id) update/delete)
 *   count/linhas afetadas 0 → { ok:false, erro:"Categoria não encontrada." }
 *   loja_id no INSERT/UPDATE vem do PARÂMETRO lojaId, nunca do payload
 *   revalidatePath(rota admin do cardápio) + revalidatePath("/loja/[slug]")
 *   registrarAcessoAdmin (best-effort: INSERT em admin_acessos); catch genérico
 *
 * Casos que precisam passar: os 4 describes acima.
 */
