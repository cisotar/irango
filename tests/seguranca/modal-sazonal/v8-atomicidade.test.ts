import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTestDb, type TestDb } from "../../helpers/pglite";
import {
  argsEdicaoValidos,
  capturarErro,
  chamarAtivarModal,
  chamarSalvarModal,
  criarModalExtra,
  fotografarCenario,
  fotografarModal,
  mensagemMinima,
  semearCenario,
  type ArgsSalvarModal,
  type CenarioModalSazonal,
} from "./seed";

/**
 * Fase RED — issue 311, VETOR V8 (integridade transacional: gravação parcial visível).
 * Spec `specs/modal-sazonal-mensagem-formatada.md` §Matriz V8 (A27, A28, A31) e
 * RN-M15 "Testes obrigatórios de falha no meio" (casos 1 a 6).
 *
 * Como ler a camada pglite: no PostgREST cada chamada `.rpc` é UMA transação, e o
 * harness (`asUser`) espelha isso. O que estes testes travam é que a RPC FALHA
 * (propaga `23503`/`23514`/`raise`) em vez de engolir o erro e seguir com as
 * junções já apagadas por S5: uma função que capturasse a exceção devolveria
 * sucesso e o estado misto apareceria na foto. A camada Action (A31) trava a outra
 * metade: uma única chamada, nenhum request separado de escrita.
 *
 * "Nada muda" = fotografia das DUAS lojas (linha + junções + contagens) igual
 * antes/depois. Todo erro afirma SQLSTATE + fragmento.
 */

// ── mocks da Server Action (molde: src/lib/actions/modalSazonal.test.ts) ─────
const m = vi.hoisted(() => ({
  createClient: vi.fn(),
  buscarLojaDoDono: vi.fn(),
  verificarRateLimit: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...a: unknown[]) => m.createClient(...a),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    throw new Error("service_role não pode ser usado pelas actions do modal sazonal");
  },
}));
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => m.buscarLojaDoDono(...a),
  slugExiste: vi.fn(),
}));
vi.mock("@/lib/utils/rateLimit", () => ({
  verificarRateLimit: (...a: unknown[]) => m.verificarRateLimit(...a),
  extrairIp: () => "203.0.113.8",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const actions = () => import("@/lib/actions/modalSazonal");

const ERRO_GENERICO = "Não foi possível salvar. Tente novamente.";

// ══════════════════════════════════════════════════════════════════════════
// Camada banco (pglite): RN-M15 casos 1 a 6 (A27, A28) + controles positivos
// ══════════════════════════════════════════════════════════════════════════

describe("V8 · banco (pglite)", () => {
  let t: TestDb;
  let c: CenarioModalSazonal;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearCenario(t);
  });

  afterAll(async () => {
    await t?.close();
  });

  const estado = () => fotografarCenario(t, c);

  /** Edição que muda TUDO (título, janela, mensagem, promoções): falha tem de desfazer tudo. */
  function edicaoQueMudaTudo(over: Partial<ArgsSalvarModal>): ArgsSalvarModal {
    return {
      ...argsEdicaoValidos(c.a),
      p_titulo: "Titulo que nao pode ficar",
      p_exibicao_inicio: "2026-11-01T00:00:00-03:00",
      p_exibicao_fim: "2026-11-20T00:00:00-03:00",
      p_mensagem: mensagemMinima("mensagem que nao pode ficar"),
      p_mostrar_promocoes_junto: true,
      ...over,
    };
  }

  /** Categoria de A que existiu e foi apagada ENTRE a leitura do form e o save. */
  async function categoriaApagadaDeA(): Promise<string> {
    return t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.categorias (loja_id, nome) values ($1, 'Categoria efemera') returning id`,
        [c.a.id],
      );
      const id = r.rows[0].id;
      await db.query(`delete from public.categorias where id = $1`, [id]);
      return id;
    });
  }

  /** Junções ANTIGAS do seed, na ordem em que `fotografarModal` devolve (order by uuid). */
  const juncoesDoSeed = () => ({
    categorias: [...c.a.modalCategorias].sort(),
    cardapios: [...c.a.modalCardapios].sort(),
  });

  // ── Caso 1 (A27) ────────────────────────────────────────────────────────
  it("caso 1: editar com categorias válidas e cardápio de OUTRA loja → 23503 mscard_cardapio_fk; linha e junções idênticas", async () => {
    const antes = await estado();
    const args = edicaoQueMudaTudo({ p_categorias: [c.a.categorias[2]], p_cardapios: [c.b.cardapios[0]] });
    const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
    expect(e.code).toBe("23503");
    expect(e.message).toContain("mscard_cardapio_fk");
    expect(await estado()).toEqual(antes);
  });

  // ── Caso 2 (A27) ────────────────────────────────────────────────────────
  it("caso 2: editar com categoria APAGADA antes do save → 23503 msc_categoria_fk; linha e junções idênticas", async () => {
    const apagada = await categoriaApagadaDeA();
    const antes = await estado();
    const args = edicaoQueMudaTudo({ p_categorias: [apagada], p_cardapios: [c.a.cardapios[1]] });
    const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
    expect(e.code).toBe("23503");
    expect(e.message).toContain("msc_categoria_fk");
    expect(await estado()).toEqual(antes);
  });

  // ── Caso 3 (A28) ────────────────────────────────────────────────────────
  it("caso 3: CRIAR com categoria de outra loja → 23503 msc_categoria_fk; zero linhas novas (sem órfão)", async () => {
    const antes = await estado();
    const args = edicaoQueMudaTudo({ p_modal_id: null, p_titulo: "Orfao categoria", p_categorias: [c.b.categorias[0]] });
    const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
    expect(e.code).toBe("23503");
    expect(e.message).toContain("msc_categoria_fk");
    expect(await estado()).toEqual(antes);
    const orfaos = await t.asService((db) =>
      db.query(`select id from public.modais_sazonais where titulo = 'Orfao categoria'`),
    );
    expect(orfaos.rows).toHaveLength(0);
  });

  it("caso 3b: CRIAR com categoria válida e cardápio de outra loja → 23503 mscard_cardapio_fk; zero linhas novas", async () => {
    const antes = await estado();
    const args = edicaoQueMudaTudo({
      p_modal_id: null,
      p_titulo: "Orfao cardapio",
      p_categorias: [c.a.categorias[0]],
      p_cardapios: [c.b.cardapios[1]],
    });
    const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
    expect(e.code).toBe("23503");
    expect(e.message).toContain("mscard_cardapio_fk");
    expect(await estado()).toEqual(antes);
    const orfaos = await t.asService((db) =>
      db.query(`select id from public.modais_sazonais where titulo = 'Orfao cardapio'`),
    );
    expect(orfaos.rows).toHaveLength(0);
  });

  // ── Caso 4 (A27) ────────────────────────────────────────────────────────
  it("caso 4: editar com `p_mensagem` de 70 KB → 23514 modais_sazonais_mensagem_tamanho; linha e junções intactas", async () => {
    const antes = await estado();
    const args = edicaoQueMudaTudo({
      p_mensagem: mensagemMinima("a".repeat(70_000)),
      p_categorias: [c.a.categorias[2]],
      p_cardapios: [c.a.cardapios[1]],
    });
    const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
    expect(e.code).toBe("23514");
    expect(e.message).toContain("modais_sazonais_mensagem_tamanho");
    expect(await estado()).toEqual(antes);
  });

  // ── Caso 5 (A27): as junções apagadas por S5 VOLTAM ─────────────────────
  describe("caso 5: falha entre o DELETE (S5) e o fim dos INSERTs (S6) — as junções ANTIGAS voltam", () => {
    it("pré-condição: o seed tem junções NÃO vazias (senão 'voltar' seria vácuo)", async () => {
      const foto = await fotografarModal(t, c.a.modalId);
      expect(c.a.modalCategorias.length).toBeGreaterThan(0);
      expect(c.a.modalCardapios.length).toBeGreaterThan(0);
      expect({ categorias: foto.categorias, cardapios: foto.cardapios }).toEqual(juncoesDoSeed());
    });

    it("via caso 1 (cardápio de outra loja): recusado E as categorias/cardápios antigos existem de novo", async () => {
      const args = edicaoQueMudaTudo({ p_categorias: [c.a.categorias[2]], p_cardapios: [c.b.cardapios[0]] });
      const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
      expect(e.code).toBe("23503");
      expect(e.message).toContain("mscard_cardapio_fk");
      const foto = await fotografarModal(t, c.a.modalId);
      expect({ categorias: foto.categorias, cardapios: foto.cardapios }).toEqual(juncoesDoSeed());
      expect(foto.categorias).not.toContain(c.a.categorias[2]);
      expect(foto.linha?.titulo).toBe("Modal original A");
    });

    it("via caso 2 (categoria apagada): recusado E as categorias/cardápios antigos existem de novo", async () => {
      const apagada = await categoriaApagadaDeA();
      const args = edicaoQueMudaTudo({ p_categorias: [apagada], p_cardapios: [c.a.cardapios[1]] });
      const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
      expect(e.code).toBe("23503");
      expect(e.message).toContain("msc_categoria_fk");
      const foto = await fotografarModal(t, c.a.modalId);
      expect({ categorias: foto.categorias, cardapios: foto.cardapios }).toEqual(juncoesDoSeed());
      expect(foto.cardapios).not.toContain(c.a.cardapios[1]);
      expect(foto.linha?.titulo).toBe("Modal original A");
    });
  });

  // ── Caso 6 ──────────────────────────────────────────────────────────────
  it("caso 6: `p_modal_id` de OUTRA loja → raise de S4 (modal inexistente); nada muda em nenhuma das duas lojas", async () => {
    const antes = await estado();
    const args = edicaoQueMudaTudo({ p_modal_id: c.b.modalId, p_categorias: [], p_cardapios: [] });
    const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
    expect(e.code).toBe("P0001");
    expect(e.message).toContain("modal_sazonal: modal inexistente");
    expect(await estado()).toEqual(antes);
  });

  // ── Controles positivos (por ÚLTIMO: são os únicos que mudam o estado) ───
  describe("controles positivos: o caminho feliz grava tudo junto", () => {
    it("criar válido grava linha + mensagem + junções, nasce rascunho e devolve o id", async () => {
      const msg = mensagemMinima("Semana do caldo");
      const args: ArgsSalvarModal = {
        ...argsEdicaoValidos(c.a),
        p_modal_id: null,
        p_titulo: "Semana do caldo",
        p_mensagem: msg,
        p_mostrar_promocoes_junto: null,
        p_categorias: [c.a.categorias[2]],
        p_cardapios: [c.a.cardapios[1]],
      };
      const id = await t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args));
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const foto = await fotografarModal(t, id);
      expect(foto.linha).toMatchObject({
        id,
        loja_id: c.a.id,
        titulo: "Semana do caldo",
        ativo: false,
        mostrar_promocoes_junto: false,
        mensagem: msg,
      });
      expect(foto.categorias).toEqual([c.a.categorias[2]]);
      expect(foto.cardapios).toEqual([c.a.cardapios[1]]);
    });

    it("editar válido regrava linha + junções, devolve o MESMO id; `null` em promoções preserva; `ativo` nunca muda", async () => {
      await t.asService((db) =>
        db.query(
          `update public.modais_sazonais set ativo = true, mostrar_promocoes_junto = true where id = $1`,
          [c.a.modalId],
        ),
      );
      const msg = mensagemMinima("Editado");
      const args: ArgsSalvarModal = {
        ...argsEdicaoValidos(c.a),
        p_titulo: "Titulo novo",
        p_mensagem: msg,
        p_mostrar_promocoes_junto: null,
        p_categorias: [c.a.categorias[2]],
        p_cardapios: [],
      };
      const id = await t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args));
      expect(id).toBe(c.a.modalId);
      const foto = await fotografarModal(t, c.a.modalId);
      expect(foto.linha).toMatchObject({
        titulo: "Titulo novo",
        mensagem: msg,
        mostrar_promocoes_junto: true,
        ativo: true,
      });
      expect(foto.categorias).toEqual([c.a.categorias[2]]);
      expect(foto.cardapios).toEqual([]);
    });

    it("editar com seleção vazia (RN-M02) zera as junções e mantém `ativo = false` de um rascunho", async () => {
      const args: ArgsSalvarModal = {
        ...argsEdicaoValidos(c.b),
        p_mensagem: null,
        p_mostrar_promocoes_junto: false,
        p_categorias: [],
        p_cardapios: [],
      };
      const id = await t.asUser(c.b.donoId, (db) => chamarSalvarModal(db, args));
      expect(id).toBe(c.b.modalId);
      const foto = await fotografarModal(t, c.b.modalId);
      expect(foto.linha).toMatchObject({ ativo: false, mostrar_promocoes_junto: false, mensagem: null });
      expect(foto.categorias).toEqual([]);
      expect(foto.cardapios).toEqual([]);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Camada Server Action (client mockado): A31
// ══════════════════════════════════════════════════════════════════════════

const LOJA_ID = "a1111111-1111-4111-8111-111111111111";
const MODAL_ID = "a3333333-3333-4333-8333-333333333333";
const CATEGORIA_X = "c4444444-4444-4444-8444-444444444444";
const CARDAPIO_Y = "c5555555-5555-4555-8555-555555555555";

type Resposta = { data: unknown; error: { code?: string; message?: string } | null };
let respostaRpc: Resposta;

function thenavel(r: () => Resposta) {
  const p = {
    then: (onF: (v: Resposta) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(r()).then(onF, onR),
    single: () => p,
    maybeSingle: () => p,
  };
  return p;
}

function cadeiaFrom() {
  const cadeia: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "limit"]) {
    cadeia[k] = () => cadeia;
  }
  cadeia.single = () => cadeia;
  cadeia.maybeSingle = () => cadeia;
  cadeia.then = (onF: (v: Resposta) => unknown) =>
    Promise.resolve({ data: { id: MODAL_ID }, error: null }).then(onF);
  return cadeia;
}

const clientFalso = {
  from: (tabela: string) => {
    m.from(tabela);
    return cadeiaFrom();
  },
  rpc: (nome: string, args: unknown) => {
    m.rpc(nome, args);
    return thenavel(() => respostaRpc);
  },
};

function payloadValido(over: Record<string, unknown> = {}) {
  return {
    titulo: "Festival de Inverno",
    exibicao_inicio: "2026-10-01T00:00:00-03:00",
    exibicao_fim: "2026-10-16T00:00:00-03:00",
    mensagem: null,
    categorias: [],
    cardapios: [],
    ...over,
  };
}

const CHAVES_RPC = [
  "p_cardapios",
  "p_categorias",
  "p_exibicao_fim",
  "p_exibicao_inicio",
  "p_loja_id",
  "p_mensagem",
  "p_modal_id",
  "p_mostrar_promocoes_junto",
  "p_titulo",
];

describe("V8 · A31 Server Action faz UMA chamada à RPC (client mockado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respostaRpc = { data: MODAL_ID, error: null };
    m.createClient.mockResolvedValue(clientFalso);
    m.buscarLojaDoDono.mockResolvedValue({ id: LOJA_ID, dono_id: "dono-mock", slug: "loja-mock", ativo: true });
    m.verificarRateLimit.mockResolvedValue({ permitido: true });
  });

  function unicaChamadaRpc(): Record<string, unknown> {
    expect(m.rpc).toHaveBeenCalledTimes(1);
    const [nome, args] = m.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(nome).toBe("salvar_modal_sazonal");
    expect(Object.keys(args).sort()).toEqual(CHAVES_RPC);
    return args;
  }

  it("criar (seleção vazia, mensagem null): exatamente uma rpc, p_loja_id de buscarLojaDoDono, p_modal_id null, nenhum .from", async () => {
    const { criarModalSazonal } = await actions();
    const r = await criarModalSazonal(payloadValido({ mostrar_promocoes_junto: false }));
    expect(r.ok).toBe(true);
    const args = unicaChamadaRpc();
    expect(args).toMatchObject({
      p_loja_id: LOJA_ID,
      p_modal_id: null,
      p_titulo: "Festival de Inverno",
      p_exibicao_inicio: "2026-10-01T00:00:00-03:00",
      p_exibicao_fim: "2026-10-16T00:00:00-03:00",
      p_mensagem: null,
      p_mostrar_promocoes_junto: false,
      p_categorias: [],
      p_cardapios: [],
    });
    expect(m.from).not.toHaveBeenCalled();
  });

  it("editar (com seleção, promoções ausente): exatamente uma rpc, p_modal_id = id, promoções null (preservar), nenhum .from", async () => {
    const { editarModalSazonal } = await actions();
    const r = await editarModalSazonal(
      MODAL_ID,
      payloadValido({ categorias: [CATEGORIA_X], cardapios: [CARDAPIO_Y] }),
    );
    expect(r.ok).toBe(true);
    const args = unicaChamadaRpc();
    expect(args).toMatchObject({
      p_loja_id: LOJA_ID,
      p_modal_id: MODAL_ID,
      p_mensagem: null,
      p_mostrar_promocoes_junto: null,
      p_categorias: [CATEGORIA_X],
      p_cardapios: [CARDAPIO_Y],
    });
    expect(m.from).not.toHaveBeenCalled();
  });

  for (const qual of ["criar", "editar"] as const) {
    it(`${qual}: erro da RPC vira ERRO_GENERICO, detalhe só no log, e não há segunda tentativa nem escrita por .from`, async () => {
      respostaRpc = {
        data: null,
        error: { code: "23503", message: 'insert or update on table "modal_sazonal_cardapios" violates foreign key constraint "mscard_cardapio_fk"' },
      };
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const mod = await actions();
        const r =
          qual === "criar"
            ? await mod.criarModalSazonal(payloadValido({ cardapios: [CARDAPIO_Y] }))
            : await mod.editarModalSazonal(MODAL_ID, payloadValido({ cardapios: [CARDAPIO_Y] }));
        expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
        expect(JSON.stringify(r)).not.toContain("mscard_cardapio_fk");
        expect(JSON.stringify(r)).not.toContain("23503");
        expect(inspect(log.mock.calls, { depth: 6 })).toContain("mscard_cardapio_fk");
        unicaChamadaRpc();
        expect(m.from).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Issue 319 · ativar numa transação única (RPC `ativar_modal_sazonal`)
// ══════════════════════════════════════════════════════════════════════════
//
// CONTRATO FIXADO PARA A FASE GREEN (executar):
//   - SQL: `public.ativar_modal_sazonal(p_modal_id uuid) returns void`, security
//     invoker, molde de `salvar_modal_sazonal` (S1 `modal_sazonal: sem sessao`;
//     posse por `lojas.dono_id = auth.uid()` ANTES de tocar em linha, senão
//     `modal_sazonal: modal inexistente`; revoke `public, anon`; grant
//     `authenticated`). Desativa o ativo anterior da loja e ativa o alvo na MESMA
//     função (uma transação). Ativar o que já está ativo é idempotente. Não mexe
//     em nenhuma coluna além de `ativo` (e `atualizado_em`, se quiser).
//   - Action: `ativarModalSazonal(id)` faz EXATAMENTE uma chamada
//     `rpc("ativar_modal_sazonal", { p_modal_id: id })` e nenhuma `.from(...)`;
//     erro da RPC → ERRO_GENERICO, detalhe só no `console.error`.
//   - Trava estática: o corpo de `ativarModalSazonal` não contém
//     `.update({ ativo: true })` nem `.update({ ativo: false })`.
//
// FALHA FORÇADA: não há FK a violar numa ativação, então o teste instala (como
// superusuário do pglite) um trigger `before update` que lança quando uma linha
// passa de `ativo = false` para `ativo = true`. É a falha "depois do desativar":
// o anterior já foi desligado dentro da função quando o alvo explode. A
// transação única tem de devolver o anterior ativo. Mesmo princípio dos casos
// 1–6 acima: a RPC PROPAGA o erro e a foto das duas lojas não muda.

describe("V8 · 319 · ativar_modal_sazonal atômica (pglite)", () => {
  let t: TestDb;
  let c: CenarioModalSazonal;
  let anteriorDeA: string;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearCenario(t);
    anteriorDeA = await criarModalExtra(t, c.a.id, "Anterior ativo de A", true);
  });

  afterAll(async () => {
    await t?.close();
  });

  async function estado() {
    return { cenario: await fotografarCenario(t, c), anterior: await fotografarModal(t, anteriorDeA) };
  }

  async function ativosDaLoja(lojaId: string): Promise<string[]> {
    return t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `select id from public.modais_sazonais where loja_id = $1 and ativo order by id`,
        [lojaId],
      );
      return r.rows.map((x) => x.id);
    });
  }

  async function instalarFalhaAoAtivar() {
    await t.db.exec(`
      create or replace function public.tdd_falha_forcada_ao_ativar() returns trigger
      language plpgsql as $$
      begin
        if new.ativo and not old.ativo then
          raise exception 'tdd: falha forcada ao ativar';
        end if;
        return new;
      end $$;
      create trigger tdd_falha_forcada_ao_ativar
        before update on public.modais_sazonais
        for each row execute function public.tdd_falha_forcada_ao_ativar();
    `);
  }

  async function removerFalhaAoAtivar() {
    await t.db.exec(`
      drop trigger if exists tdd_falha_forcada_ao_ativar on public.modais_sazonais;
      drop function if exists public.tdd_falha_forcada_ao_ativar();
    `);
  }

  it("pré-condição: A tem o anterior ATIVO e o alvo (rascunho do seed) inativo", async () => {
    expect(await ativosDaLoja(c.a.id)).toEqual([anteriorDeA]);
    expect((await fotografarModal(t, c.a.modalId)).linha?.ativo).toBe(false);
  });

  it("falha forçada ao ligar o alvo (depois do desativar): erro propaga e TUDO reverte — o anterior continua ativo", async () => {
    const antes = await estado();
    await instalarFalhaAoAtivar();
    try {
      const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarAtivarModal(db, c.a.modalId)));
      expect(e.code).toBe("P0001");
      expect(e.message).toContain("tdd: falha forcada ao ativar");
    } finally {
      await removerFalhaAoAtivar();
    }
    expect(await estado()).toEqual(antes);
    expect(await ativosDaLoja(c.a.id)).toEqual([anteriorDeA]);
  });

  it("dono A ativa modal de B: raise `modal_sazonal: modal inexistente` e nada muda nas duas lojas", async () => {
    const antes = await estado();
    const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarAtivarModal(db, c.b.modalId)));
    expect(e.code).toBe("P0001");
    expect(e.message).toContain("modal_sazonal: modal inexistente");
    expect(await estado()).toEqual(antes);
  });

  it("modal inexistente: raise `modal_sazonal: modal inexistente` e nada muda", async () => {
    const antes = await estado();
    const e = await capturarErro(() =>
      t.asUser(c.a.donoId, (db) => chamarAtivarModal(db, "e9999999-9999-4999-8999-999999999999")),
    );
    expect(e.code).toBe("P0001");
    expect(e.message).toContain("modal_sazonal: modal inexistente");
    expect(await estado()).toEqual(antes);
  });

  // ── Controles positivos (por ÚLTIMO: mudam o estado) ─────────────────────

  it("UMA chamada ativa o alvo e desativa o anterior; B intocada; só `ativo` muda no alvo", async () => {
    const antesB = { modal: await fotografarModal(t, c.b.modalId), ativos: await ativosDaLoja(c.b.id) };
    const alvoAntes = await fotografarModal(t, c.a.modalId);

    await t.asUser(c.a.donoId, (db) => chamarAtivarModal(db, c.a.modalId));

    expect(await ativosDaLoja(c.a.id)).toEqual([c.a.modalId]);
    expect((await fotografarModal(t, anteriorDeA)).linha?.ativo).toBe(false);

    const alvoDepois = await fotografarModal(t, c.a.modalId);
    const semEstado = (f: typeof alvoAntes) => {
      const { ativo: _a, atualizado_em: _u, ...resto } = f.linha ?? {};
      void _a;
      void _u;
      return { linha: resto, categorias: f.categorias, cardapios: f.cardapios };
    };
    expect(alvoDepois.linha?.ativo).toBe(true);
    expect(semEstado(alvoDepois)).toEqual(semEstado(alvoAntes));

    expect({ modal: await fotografarModal(t, c.b.modalId), ativos: await ativosDaLoja(c.b.id) }).toEqual(antesB);
  });

  it("ativar o modal que JÁ está ativo é idempotente: sem erro, continua um só ativo", async () => {
    await t.asUser(c.a.donoId, (db) => chamarAtivarModal(db, c.a.modalId));
    expect(await ativosDaLoja(c.a.id)).toEqual([c.a.modalId]);
  });

  it("loja SEM ativo anterior (B): ativa o alvo sem erro", async () => {
    expect(await ativosDaLoja(c.b.id)).toEqual([]);
    await t.asUser(c.b.donoId, (db) => chamarAtivarModal(db, c.b.modalId));
    expect(await ativosDaLoja(c.b.id)).toEqual([c.b.modalId]);
  });
});

describe("V8 · 319 · Server Action ativarModalSazonal faz UMA chamada à RPC (client mockado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respostaRpc = { data: null, error: null };
    m.createClient.mockResolvedValue(clientFalso);
    m.buscarLojaDoDono.mockResolvedValue({ id: LOJA_ID, dono_id: "dono-mock", slug: "loja-mock", ativo: true });
    m.verificarRateLimit.mockResolvedValue({ permitido: true });
  });

  it("sucesso: exatamente uma rpc('ativar_modal_sazonal', { p_modal_id }) e nenhum .from", async () => {
    const { ativarModalSazonal } = await actions();
    const r = await ativarModalSazonal(MODAL_ID);
    expect(r).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("ativar_modal_sazonal", { p_modal_id: MODAL_ID });
    expect(m.from).not.toHaveBeenCalled();
  });

  it("erro da RPC vira ERRO_GENERICO, detalhe só no log; uma chamada só e nenhum .from", async () => {
    respostaRpc = { data: null, error: { code: "P0001", message: "modal_sazonal: modal inexistente" } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { ativarModalSazonal } = await actions();
      const r = await ativarModalSazonal(MODAL_ID);
      expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
      expect(JSON.stringify(r)).not.toContain("modal_sazonal");
      expect(inspect(log.mock.calls, { depth: 6 })).toContain("modal_sazonal: modal inexistente");
      expect(m.rpc).toHaveBeenCalledTimes(1);
      expect(m.from).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("V8 · 319 · trava estática: ativarModalSazonal não faz UPDATE de `ativo` por request", () => {
  const fonte = readFileSync(resolve(process.cwd(), "src/lib/actions/modalSazonal.ts"), "utf8");

  /** Corpo de `ativarModalSazonal`: da assinatura até a próxima função exportada. */
  function corpoAtivar(): string {
    const inicio = fonte.indexOf("export async function ativarModalSazonal");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const fim = fonte.indexOf("export async function", inicio + 1);
    return fonte.slice(inicio, fim === -1 ? undefined : fim);
  }

  it("não contém `.update({ ativo: true })` nem `.update({ ativo: false })`", () => {
    expect(corpoAtivar()).not.toMatch(/\.update\(\s*\{\s*ativo\s*:\s*(true|false)\s*\}\s*\)/);
  });

  it('chama `.rpc("ativar_modal_sazonal"`', () => {
    expect(corpoAtivar()).toMatch(/\.rpc\(\s*["']ativar_modal_sazonal["']/);
  });
});
