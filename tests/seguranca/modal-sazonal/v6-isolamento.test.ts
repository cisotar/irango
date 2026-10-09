import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { inspect } from "node:util";
import type { PGlite } from "@electric-sql/pglite";
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
  type CenarioModalSazonal,
  type ErroBanco,
} from "./seed";

/**
 * Fase RED — issue 309, VETOR V6 (isolamento cross-tenant e contorno da Server Action).
 * Spec `specs/modal-sazonal-mensagem-formatada.md` §Matriz V6; RN-M04, RN-M10, RN-M11,
 * RN-M15 (S1, S2, S4, S6, S7).
 *
 *   A8   escrita direta fora do contrato: CHECK de topo barra; topo válido com trecho
 *        hostil é gravado e neutralizado na leitura (`lerMensagemModal` → null);
 *   A9   dono B escreve na linha de A (tabela) e pela Server Action;
 *   A29  dono B chama a RPC direto (posse, modal alheio, seleção alheia), anon e
 *        service_role sem JWT de usuário;
 *   A10  anon lê `mensagem` de rascunho;
 *   A11  `loja_id`/`ativo` pendurados no payload: reprova e a RPC nunca é chamada;
 *   A12  `id` de rota lixo: `ERRO_VALIDACAO` antes de rate-limit e de client.
 *
 * Escrito a partir do SPEC/ISSUE. Módulos de produção importados DINAMICAMENTE por
 * teste: enquanto não existem ou não compilam, cada teste falha sozinho e a camada
 * pglite segue rodando e falhando na asserção.
 *
 * Toda trava de escopo afirma SQLSTATE + fragmento da mensagem (memória "SQLSTATE
 * não basta em teste de escopo"). "Nada muda" = fotografia das DUAS lojas igual
 * antes/depois.
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
  extrairIp: () => "203.0.113.7",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const actions = () => import("@/lib/actions/modalSazonal");
const leitura = () => import("@/lib/validacoes/mensagemModal");

const ERRO_VALIDACAO = "Dados inválidos. Confira os campos e tente novamente.";
const ERRO_GENERICO = "Não foi possível salvar. Tente novamente.";

// Ids fixos das fixtures de ACTION (não são do pglite).
const LOJA_A_ID = "a1111111-1111-4111-8111-111111111111";
const LOJA_B_ID = "b2222222-2222-4222-8222-222222222222";
const MODAL_DE_A = "a3333333-3333-4333-8333-333333333333";
const CATEGORIA_X = "c4444444-4444-4444-8444-444444444444";

type Resposta = { data: unknown; error: { code?: string; message?: string } | null };
let respostaRpc: Resposta;

/** Resposta do builder: thenable + `single`/`maybeSingle` (o que o supabase-js devolve). */
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
    Promise.resolve({ data: null, error: null }).then(onF);
  return cadeia;
}

const clientFalso = {
  from: (t: string) => {
    m.from(t);
    return cadeiaFrom();
  },
  rpc: (nome: string, args: unknown) => {
    m.rpc(nome, args);
    return thenavel(() => respostaRpc);
  },
};

function lojaMock(id: string) {
  return { id, dono_id: "dono-mock", slug: `loja-${id.slice(0, 4)}`, ativo: true };
}

/** Payload VÁLIDO do contrato novo: `mensagem: null` e seleção vazia aceitos (RN-M02). */
function payloadValido(over: Record<string, unknown> = {}) {
  return {
    titulo: "Festival de Inverno",
    exibicao_inicio: "2026-10-01T00:00:00-03:00",
    exibicao_fim: "2026-10-16T00:00:00-03:00",
    mensagem: null,
    categorias: [],
    cardapios: [],
    mostrar_promocoes_junto: false,
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Camada banco (pglite): A8, A9, A29, A10
// ══════════════════════════════════════════════════════════════════════════

describe("V6 · banco (pglite)", () => {
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

  /**
   * Sessão `authenticated` SEM `sub` no JWT (auth.uid() nulo): o outro lado de S1,
   * independente de ACL de `service_role`.
   */
  async function comoAutenticadoSemSub<T>(fn: (db: PGlite) => Promise<T>): Promise<T> {
    await t.db.exec("begin");
    try {
      await t.db.query("set local role authenticated");
      await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ role: "authenticated" }),
      ]);
      const r = await fn(t.db);
      await t.db.exec("commit");
      return r;
    } catch (err) {
      await t.db.exec("rollback");
      throw err;
    }
  }

  function esperarRaise(e: ErroBanco, fragmento: string) {
    expect(e.code).toBe("P0001");
    expect(e.message).toContain(fragmento);
  }

  // ── A8 · escrita direta fora do contrato ────────────────────────────────

  describe("A8 · escrita direta (dono, PostgREST) com JSON fora do contrato", () => {
    it("UPDATE com mensagem `versao: 2`: 23514 modais_sazonais_mensagem_forma e nada muda", async () => {
      const antes = await estado();
      const e = await capturarErro(() =>
        t.asUser(c.a.donoId, (db) =>
          db.query(`update public.modais_sazonais set mensagem = $1::jsonb where id = $2`, [
            JSON.stringify({ versao: 2, paragrafos: [{ trechos: [{ texto: "oi" }] }] }),
            c.a.modalId,
          ]),
        ),
      );
      expect(e.code).toBe("23514");
      expect(e.message).toContain("modais_sazonais_mensagem_forma");
      expect(await estado()).toEqual(antes);
    });

    const hostis: { nome: string; trecho: Record<string, unknown> }[] = [
      { nome: "trecho com `href` cru", trecho: { texto: "clique", href: "https://exemplo.test" } },
      { nome: "trecho com `link: \"javascript:…\"`", trecho: { texto: "clique", link: "javascript:alert(1)" } },
    ];

    for (const caso of hostis) {
      it(`topo válido com ${caso.nome}: é GRAVADO (CHECK só vê o topo) e lerMensagemModal devolve null sem logar conteúdo`, async () => {
        const hostil = { versao: 1, paragrafos: [{ trechos: [caso.trecho] }] };
        const r = await t.asUser(c.a.donoId, (db) =>
          db.query<{ id: string }>(
            `update public.modais_sazonais set mensagem = $1::jsonb where id = $2 returning id`,
            [JSON.stringify(hostil), c.a.modalId],
          ),
        );
        expect(r.rows).toHaveLength(1);

        const foto = await fotografarModal(t, c.a.modalId);
        expect(foto.linha?.mensagem).toEqual(hostil);

        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          const { lerMensagemModal } = await leitura();
          const lido = lerMensagemModal(foto.linha?.mensagem, { lojaId: c.a.id, modalId: c.a.modalId });
          expect(lido).toBeNull();
          const logado = inspect(log.mock.calls, { depth: 6 });
          expect(logado).not.toContain("javascript");
          expect(logado).not.toContain("exemplo.test");
        } finally {
          log.mockRestore();
        }
      });
    }
  });

  // ── A9 · dono B escreve na linha de A pela tabela ───────────────────────

  describe("A9 · dono B escreve `mensagem` na loja A direto na tabela", () => {
    it("UPDATE de `mensagem` do modal de A sob B afeta 0 linhas e nada muda nas duas lojas", async () => {
      const antes = await estado();
      const r = await t.asUser(c.b.donoId, (db) =>
        db.query<{ id: string }>(
          `update public.modais_sazonais set mensagem = $1::jsonb where id = $2 returning id`,
          [JSON.stringify(mensagemMinima("sequestro")), c.a.modalId],
        ),
      );
      expect(r.rows).toHaveLength(0);
      expect(await estado()).toEqual(antes);
    });

    it("INSERT com `loja_id` de A e `mensagem` sob B: 42501 RLS de modais_sazonais e zero linha nova", async () => {
      const antes = await estado();
      const e = await capturarErro(() =>
        t.asUser(c.b.donoId, (db) =>
          db.query(
            `insert into public.modais_sazonais (loja_id, titulo, exibicao_inicio, exibicao_fim, mensagem)
             values ($1, 'Intruso', $2, $3, $4::jsonb)`,
            [c.a.id, "2026-10-01T00:00:00-03:00", "2026-10-16T00:00:00-03:00", JSON.stringify(mensagemMinima())],
          ),
        ),
      );
      expect(e.code).toBe("42501");
      expect(e.message).toContain("row-level security");
      expect(e.message).toContain("modais_sazonais");
      expect(await estado()).toEqual(antes);
    });
  });

  // ── A29 · RPC chamada direto ────────────────────────────────────────────

  describe("A29 · RPC salvar_modal_sazonal chamada direto fora da própria loja", () => {
    it("B com `p_loja_id` de A: raise de S2 (sem posse) e nada muda", async () => {
      const antes = await estado();
      const args = { ...argsEdicaoValidos(c.a), p_mensagem: mensagemMinima("de B") };
      const e = await capturarErro(() => t.asUser(c.b.donoId, (db) => chamarSalvarModal(db, args)));
      esperarRaise(e, "modal_sazonal: sem posse");
      expect(await estado()).toEqual(antes);
    });

    it("B criando (p_modal_id null) com `p_loja_id` de A: raise de S2 e zero modal novo", async () => {
      const antes = await estado();
      const args = { ...argsEdicaoValidos(c.a), p_modal_id: null, p_categorias: [], p_cardapios: [] };
      const e = await capturarErro(() => t.asUser(c.b.donoId, (db) => chamarSalvarModal(db, args)));
      esperarRaise(e, "modal_sazonal: sem posse");
      expect(await estado()).toEqual(antes);
    });

    it("B com o próprio `p_loja_id` e `p_modal_id` de A: raise de S4, MESMA mensagem de id inexistente (sem oráculo)", async () => {
      const antes = await estado();
      const alheio = { ...argsEdicaoValidos(c.b), p_modal_id: c.a.modalId, p_categorias: [], p_cardapios: [] };
      const eAlheio = await capturarErro(() => t.asUser(c.b.donoId, (db) => chamarSalvarModal(db, alheio)));
      esperarRaise(eAlheio, "modal_sazonal: modal inexistente");

      const inexistente = { ...alheio, p_modal_id: "e9999999-9999-4999-8999-999999999999" };
      const eInexistente = await capturarErro(() =>
        t.asUser(c.b.donoId, (db) => chamarSalvarModal(db, inexistente)),
      );
      esperarRaise(eInexistente, "modal_sazonal: modal inexistente");

      expect(eAlheio).toEqual(eInexistente);
      expect(await estado()).toEqual(antes);
    });

    it("B editando o próprio modal com categoria de A: 23503 msc_categoria_fk e nada muda", async () => {
      const antes = await estado();
      const args = { ...argsEdicaoValidos(c.b), p_categorias: [c.a.categorias[0]] };
      const e = await capturarErro(() => t.asUser(c.b.donoId, (db) => chamarSalvarModal(db, args)));
      expect(e.code).toBe("23503");
      expect(e.message).toContain("msc_categoria_fk");
      expect(await estado()).toEqual(antes);
    });

    it("B editando o próprio modal com cardápio de A: 23503 mscard_cardapio_fk e nada muda", async () => {
      const antes = await estado();
      const args = { ...argsEdicaoValidos(c.b), p_cardapios: [c.a.cardapios[0]] };
      const e = await capturarErro(() => t.asUser(c.b.donoId, (db) => chamarSalvarModal(db, args)));
      expect(e.code).toBe("23503");
      expect(e.message).toContain("mscard_cardapio_fk");
      expect(await estado()).toEqual(antes);
    });

    it("B criando na própria loja com categoria de A: 23503 msc_categoria_fk e zero modal novo", async () => {
      const antes = await estado();
      const args = { ...argsEdicaoValidos(c.b), p_modal_id: null, p_categorias: [c.a.categorias[2]] };
      const e = await capturarErro(() => t.asUser(c.b.donoId, (db) => chamarSalvarModal(db, args)));
      expect(e.code).toBe("23503");
      expect(e.message).toContain("msc_categoria_fk");
      expect(await estado()).toEqual(antes);
    });

    it("asAnon chamando a RPC: 42501 permission denied (S7) e nada muda", async () => {
      const antes = await estado();
      const e = await capturarErro(() => t.asAnon((db) => chamarSalvarModal(db, argsEdicaoValidos(c.a))));
      expect(e.code).toBe("42501");
      expect(e.message).toContain("salvar_modal_sazonal");
      expect(await estado()).toEqual(antes);
    });

    /**
     * [362] A via de SERVIÇO passou a ser legítima em `salvar_modal_sazonal` (a
     * sub-rota admin de Avisos escreve na loja-alvo sob service_role, migration
     * 20261008120000): `asService` com `p_loja_id` da própria loja GRAVA — é o
     * contrapeso coberto em `tests/migrations/rpc_modal_sazonal_via_servico.test.ts`.
     * A trava que importa AQUI (isolamento cross-tenant) não desapareceu, ela
     * MUDOU DE EIXO: deixou de ser "service_role não escreve" e virou
     * "service_role não escreve FORA de `p_loja_id`". Os dois casos abaixo são o
     * mesmo vetor deste describe sob o contrato novo.
     */
    it("[362] asService com p_modal_id de A e p_loja_id de B: raise 'modal inexistente' e nada muda", async () => {
      const antes = await estado();
      const args = { ...argsEdicaoValidos(c.a), p_loja_id: c.b.id };
      const e = await capturarErro(() => t.asService((db) => chamarSalvarModal(db, args)));
      esperarRaise(e, "modal_sazonal: modal inexistente");
      expect(await estado()).toEqual(antes);
    });

    it("[362] authenticated com claim `role: service_role` FORJADO não vira via de serviço: raise 'sem posse' e nada muda", async () => {
      // `v_e_servico` exige os DOIS sinais (claim do JWT E role efetivo da
      // sessão): aqui o claim mente, o role SQL continua `authenticated`, então
      // a posse volta a ser exigida e o dono B não é dono da loja A.
      const antes = await estado();
      const e = await capturarErro(async () => {
        await t.db.exec("begin");
        try {
          await t.db.query("set local role authenticated");
          await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: c.b.donoId, role: "service_role" }),
          ]);
          const r = await chamarSalvarModal(t.db, argsEdicaoValidos(c.a));
          await t.db.exec("commit");
          return r;
        } catch (err) {
          await t.db.exec("rollback");
          throw err;
        }
      });
      esperarRaise(e, "modal_sazonal: sem posse");
      expect(await estado()).toEqual(antes);
    });

    it("authenticated com JWT sem `sub` (auth.uid() nulo): raise de S1 (sem sessao) e nada muda", async () => {
      const antes = await estado();
      const e = await capturarErro(() => comoAutenticadoSemSub((db) => chamarSalvarModal(db, argsEdicaoValidos(c.a))));
      esperarRaise(e, "modal_sazonal: sem sessao");
      expect(await estado()).toEqual(antes);
    });
  });

  // ── A10 · leitura pública de rascunho ───────────────────────────────────

  describe("A10 · anon lê `mensagem` de modal rascunho", () => {
    it("rascunho de A com mensagem gravada: anon lê 0 linhas; B (outro dono) também 0", async () => {
      await t.asService((db) =>
        db.query(`update public.modais_sazonais set mensagem = $1::jsonb, ativo = false where id = $2`, [
          JSON.stringify(mensagemMinima("rascunho secreto de A")),
          c.a.modalId,
        ]),
      );

      const anon = await t.asAnon((db) =>
        db.query(`select id, mensagem from public.modais_sazonais where id = $1`, [c.a.modalId]),
      );
      expect(anon.rows).toHaveLength(0);

      const deB = await t.asUser(c.b.donoId, (db) =>
        db.query(`select id, mensagem from public.modais_sazonais where id = $1`, [c.a.modalId]),
      );
      expect(deB.rows).toHaveLength(0);
    });

    it("controle: o MESMO select do anon enxerga a mensagem de um modal ATIVO (o 0 acima não é vácuo)", async () => {
      const msg = mensagemMinima("promo publica de B");
      await t.asService((db) =>
        db.query(`update public.modais_sazonais set mensagem = $1::jsonb, ativo = true where id = $2`, [
          JSON.stringify(msg),
          c.b.modalId,
        ]),
      );
      try {
        const anon = await t.asAnon((db) =>
          db.query<{ id: string; mensagem: unknown }>(
            `select id, mensagem from public.modais_sazonais where id = $1`,
            [c.b.modalId],
          ),
        );
        expect(anon.rows).toHaveLength(1);
        expect(anon.rows[0].mensagem).toEqual(msg);
      } finally {
        await t.asService((db) =>
          db.query(`update public.modais_sazonais set ativo = false where id = $1`, [c.b.modalId]),
        );
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Camada Server Action (client mockado): A9-action, A11, A12
// ══════════════════════════════════════════════════════════════════════════

describe("V6 · Server Action (client mockado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respostaRpc = { data: MODAL_DE_A, error: null };
    m.createClient.mockResolvedValue(clientFalso);
    m.buscarLojaDoDono.mockResolvedValue(lojaMock(LOJA_A_ID));
    m.verificarRateLimit.mockResolvedValue({ permitido: true });
  });

  describe("A9 · editarModalSazonal(idDeA) sob o dono B", () => {
    it("RPC recusa (S4): ok:false com ERRO_GENERICO, sem vazar o detalhe; p_loja_id é o de B", async () => {
      m.buscarLojaDoDono.mockResolvedValue(lojaMock(LOJA_B_ID));
      respostaRpc = { data: null, error: { code: "P0001", message: "modal_sazonal: modal inexistente" } };
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { editarModalSazonal } = await actions();
        const r = await editarModalSazonal(MODAL_DE_A, payloadValido({ titulo: "Sequestro" }));
        expect(r).toEqual({ ok: false, erro: ERRO_GENERICO });
        expect(JSON.stringify(r)).not.toContain("modal_sazonal");
        expect(m.rpc).toHaveBeenCalledTimes(1);
        const [nome, args] = m.rpc.mock.calls[0] as [string, Record<string, unknown>];
        expect(nome).toBe("salvar_modal_sazonal");
        expect(args.p_loja_id).toBe(LOJA_B_ID);
        expect(args.p_modal_id).toBe(MODAL_DE_A);
      } finally {
        log.mockRestore();
      }
    });
  });

  describe("A11 · `loja_id`/`ativo` pendurados no payload", () => {
    const extras: { nome: string; extra: Record<string, unknown> }[] = [
      { nome: "loja_id", extra: { loja_id: LOJA_B_ID } },
      { nome: "ativo", extra: { ativo: true } },
    ];

    for (const { nome, extra } of extras) {
      it(`criar: o payload válido passa e chama a RPC; o MESMO payload + \`${nome}\` reprova e a RPC nunca é chamada`, async () => {
        const { criarModalSazonal } = await actions();

        const ok = await criarModalSazonal(payloadValido({ categorias: [CATEGORIA_X] }));
        expect(ok).toEqual({ ok: true });
        expect(m.rpc).toHaveBeenCalledTimes(1);

        m.rpc.mockClear();
        const r = await criarModalSazonal({ ...payloadValido({ categorias: [CATEGORIA_X] }), ...extra });
        expect(r).toEqual({ ok: false, erro: ERRO_VALIDACAO });
        expect(m.rpc).not.toHaveBeenCalled();
        expect(m.from).not.toHaveBeenCalled();
      });

      it(`editar: o payload válido passa e chama a RPC; o MESMO payload + \`${nome}\` reprova e a RPC nunca é chamada`, async () => {
        const { editarModalSazonal } = await actions();

        const ok = await editarModalSazonal(MODAL_DE_A, payloadValido({ mensagem: null }));
        expect(ok).toEqual({ ok: true });
        expect(m.rpc).toHaveBeenCalledTimes(1);

        m.rpc.mockClear();
        const r = await editarModalSazonal(MODAL_DE_A, { ...payloadValido(), ...extra });
        expect(r).toEqual({ ok: false, erro: ERRO_VALIDACAO });
        expect(m.rpc).not.toHaveBeenCalled();
        expect(m.from).not.toHaveBeenCalled();
      });
    }
  });

  describe("A12 · `id` de rota lixo (RN-M10: z.guid antes de rate-limit e client)", () => {
    type Mod = Awaited<ReturnType<typeof actions>>;
    const alvos: { nome: string; chamar: (mod: Mod, id: string) => Promise<unknown> }[] = [
      { nome: "editarModalSazonal", chamar: (mod, id) => mod.editarModalSazonal(id, payloadValido()) },
      { nome: "ativarModalSazonal", chamar: (mod, id) => mod.ativarModalSazonal(id) },
      { nome: "desativarModalSazonal", chamar: (mod, id) => mod.desativarModalSazonal(id) },
      { nome: "removerModalSazonal", chamar: (mod, id) => mod.removerModalSazonal(id) },
    ];
    const lixos = ["1 or 1=1", "../"];

    for (const alvo of alvos) {
      for (const lixo of lixos) {
        it(`${alvo.nome}(${JSON.stringify(lixo)}): ERRO_VALIDACAO sem rate-limit, sem createClient, sem I/O`, async () => {
          const mod = await actions();
          const r = await alvo.chamar(mod, lixo);
          expect(r).toEqual({ ok: false, erro: ERRO_VALIDACAO });
          expect(m.verificarRateLimit).not.toHaveBeenCalled();
          expect(m.createClient).not.toHaveBeenCalled();
          expect(m.rpc).not.toHaveBeenCalled();
          expect(m.from).not.toHaveBeenCalled();
        });
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Issue 317 · anon lê junções (categorias/cardápios) de modal em RASCUNHO
// ══════════════════════════════════════════════════════════════════════════
//
// CONTRATO FIXADO PARA A FASE GREEN (executar): migration NOVA recria
// `modal_sazonal_categorias_leitura_publica` e `modal_sazonal_cardapios_leitura_publica`
// (mesmos nomes) com
//   exists (select 1 from public.modais_sazonais m
//            where m.id = <tabela>.modal_sazonal_id
//              and m.loja_id = <tabela>.loja_id
//              and m.ativo
//              and public.loja_esta_ativa(m.loja_id))
// O filtro é POR MODAL (m.id = modal_sazonal_id), não por loja: uma loja com um
// modal ativo e um rascunho só expõe as junções do ativo. As policies
// `*_leitura_propria` (dono lê as próprias, inclusive rascunho) não mudam.

describe("V6 · 317 · RLS das junções: rascunho não vaza para anon (pglite)", () => {
  let t: TestDb;
  let c: CenarioModalSazonal;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearCenario(t);
  });

  afterAll(async () => {
    await t?.close();
  });

  type Juncoes = { categorias: string[]; cardapios: string[] };

  /** O que o papel lê das DUAS junções filtrando por loja (o ataque da issue). */
  async function juncoesDaLoja(
    como: (fn: (db: PGlite) => Promise<Juncoes>) => Promise<Juncoes>,
    lojaId: string,
  ): Promise<Juncoes> {
    return como(async (db) => {
      const cats = await db.query<{ id: string }>(
        `select categoria_id as id from public.modal_sazonal_categorias where loja_id = $1 order by categoria_id`,
        [lojaId],
      );
      const cards = await db.query<{ id: string }>(
        `select cardapio_id as id from public.modal_sazonal_cardapios where loja_id = $1 order by cardapio_id`,
        [lojaId],
      );
      return { categorias: cats.rows.map((r) => r.id), cardapios: cards.rows.map((r) => r.id) };
    });
  }

  const anon = (fn: (db: PGlite) => Promise<Juncoes>) => t.asAnon(fn);
  const ordenado = (ids: string[]) => [...ids].sort();

  async function definirAtivo(modalId: string, ativo: boolean) {
    await t.asService((db) =>
      db.query(`update public.modais_sazonais set ativo = $1 where id = $2`, [ativo, modalId]),
    );
  }

  async function definirLojaAtiva(lojaId: string, ativo: boolean) {
    await t.asService((db) => db.query(`update public.lojas set ativo = $1 where id = $2`, [ativo, lojaId]));
  }

  it("pré-condição: o modal de A é rascunho e TEM junções (senão o 0 seria vácuo)", async () => {
    const foto = await fotografarModal(t, c.a.modalId);
    expect(foto.linha?.ativo).toBe(false);
    expect(foto.categorias.length).toBeGreaterThan(0);
    expect(foto.cardapios.length).toBeGreaterThan(0);
  });

  it("anon filtrando por loja A (modal rascunho): 0 linhas em modal_sazonal_categorias e modal_sazonal_cardapios", async () => {
    expect(await juncoesDaLoja(anon, c.a.id)).toEqual({ categorias: [], cardapios: [] });
  });

  it("anon filtrando pelo id do rascunho de A: 0 linhas nas duas junções (não vaza o id do rascunho)", async () => {
    const r = await t.asAnon(async (db) => {
      const cats = await db.query(
        `select modal_sazonal_id from public.modal_sazonal_categorias where modal_sazonal_id = $1`,
        [c.a.modalId],
      );
      const cards = await db.query(
        `select modal_sazonal_id from public.modal_sazonal_cardapios where modal_sazonal_id = $1`,
        [c.a.modalId],
      );
      return { cats: cats.rows.length, cards: cards.rows.length };
    });
    expect(r).toEqual({ cats: 0, cards: 0 });
  });

  it("dono B (authenticated de outra loja) também lê 0 junções do rascunho de A", async () => {
    const deB = (fn: (db: PGlite) => Promise<Juncoes>) => t.asUser(c.b.donoId, fn);
    expect(await juncoesDaLoja(deB, c.a.id)).toEqual({ categorias: [], cardapios: [] });
  });

  it("controle: o DONO A continua lendo as junções do próprio rascunho (leitura_propria intacta)", async () => {
    const deA = (fn: (db: PGlite) => Promise<Juncoes>) => t.asUser(c.a.donoId, fn);
    expect(await juncoesDaLoja(deA, c.a.id)).toEqual({
      categorias: ordenado(c.a.modalCategorias),
      cardapios: ordenado(c.a.modalCardapios),
    });
  });

  it("controle: modal ATIVO de loja ativa — anon lê as junções (a vitrine continua funcionando)", async () => {
    await definirAtivo(c.b.modalId, true);
    try {
      expect(await juncoesDaLoja(anon, c.b.id)).toEqual({
        categorias: ordenado(c.b.modalCategorias),
        cardapios: ordenado(c.b.modalCardapios),
      });
    } finally {
      await definirAtivo(c.b.modalId, false);
    }
  });

  it("modal ATIVO de loja INATIVA: anon lê 0 junções", async () => {
    await definirAtivo(c.b.modalId, true);
    await definirLojaAtiva(c.b.id, false);
    try {
      expect(await juncoesDaLoja(anon, c.b.id)).toEqual({ categorias: [], cardapios: [] });
    } finally {
      await definirLojaAtiva(c.b.id, true);
      await definirAtivo(c.b.modalId, false);
    }
  });

  it("MESMA loja com um modal ativo e um rascunho: anon lê SÓ as junções do ativo (filtro é por modal, não por loja)", async () => {
    const ativoId = await criarModalExtra(t, c.a.id, "Modal ativo de A", true);
    await t.asService(async (db) => {
      await db.query(
        `insert into public.modal_sazonal_categorias (loja_id, modal_sazonal_id, categoria_id) values ($1, $2, $3)`,
        [c.a.id, ativoId, c.a.categorias[2]],
      );
      await db.query(
        `insert into public.modal_sazonal_cardapios (loja_id, modal_sazonal_id, cardapio_id) values ($1, $2, $3)`,
        [c.a.id, ativoId, c.a.cardapios[1]],
      );
    });
    try {
      const lido = await t.asAnon(async (db) => {
        const cats = await db.query<{ m: string; id: string }>(
          `select modal_sazonal_id as m, categoria_id as id from public.modal_sazonal_categorias where loja_id = $1`,
          [c.a.id],
        );
        const cards = await db.query<{ m: string; id: string }>(
          `select modal_sazonal_id as m, cardapio_id as id from public.modal_sazonal_cardapios where loja_id = $1`,
          [c.a.id],
        );
        return { cats: cats.rows, cards: cards.rows };
      });
      expect(lido.cats).toEqual([{ m: ativoId, id: c.a.categorias[2] }]);
      expect(lido.cards).toEqual([{ m: ativoId, id: c.a.cardapios[1] }]);
    } finally {
      await t.asService((db) => db.query(`delete from public.modais_sazonais where id = $1`, [ativoId]));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Issue 319 · RPC ativar_modal_sazonal chamada fora da própria loja (posse)
// ══════════════════════════════════════════════════════════════════════════
//
// CONTRATO FIXADO PARA A FASE GREEN (executar), molde `salvar_modal_sazonal`:
//   `public.ativar_modal_sazonal(p_modal_id uuid)`, security invoker,
//   `set search_path = public, pg_temp`; revoke de `public, anon`; grant a
//   `authenticated`. Mensagens estáveis P0001:
//     - `modal_sazonal: sem sessao`      → auth.uid() nulo (S1);
//     - `modal_sazonal: modal inexistente` → modal de outra loja OU inexistente,
//       MESMA mensagem e sem id (nenhum oráculo), ANTES de tocar em qualquer linha.
//   anon → 42501 com o nome da função na mensagem.

describe("V6 · 319 · RPC ativar_modal_sazonal: posse e sessão (pglite)", () => {
  let t: TestDb;
  let c: CenarioModalSazonal;
  let ativoDeA: string;
  let ativoDeB: string;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearCenario(t);
    // Cada loja com um modal ATIVO além do rascunho do seed: "nada muda" deixa de
    // ser vácuo (um desativar indevido apareceria na foto).
    ativoDeA = await criarModalExtra(t, c.a.id, "Ativo de A", true);
    ativoDeB = await criarModalExtra(t, c.b.id, "Ativo de B", true);
  });

  afterAll(async () => {
    await t?.close();
  });

  async function estado() {
    return {
      cenario: await fotografarCenario(t, c),
      ativoDeA: await fotografarModal(t, ativoDeA),
      ativoDeB: await fotografarModal(t, ativoDeB),
    };
  }

  async function comoAutenticadoSemSub<T>(fn: (db: PGlite) => Promise<T>): Promise<T> {
    await t.db.exec("begin");
    try {
      await t.db.query("set local role authenticated");
      await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ role: "authenticated" }),
      ]);
      const r = await fn(t.db);
      await t.db.exec("commit");
      return r;
    } catch (err) {
      await t.db.exec("rollback");
      throw err;
    }
  }

  function esperarRaise(e: ErroBanco, fragmento: string) {
    expect(e.code).toBe("P0001");
    expect(e.message).toContain(fragmento);
  }

  it("pré-condição: A e B têm um modal ativo e um rascunho cada", async () => {
    const r = await t.asService((db) =>
      db.query<{ loja_id: string; ativos: number; total: number }>(
        `select loja_id, count(*) filter (where ativo)::int as ativos, count(*)::int as total
           from public.modais_sazonais where loja_id = any($1::uuid[]) group by loja_id`,
        [[c.a.id, c.b.id]],
      ),
    );
    expect(r.rows).toHaveLength(2);
    for (const linha of r.rows) expect(linha).toMatchObject({ ativos: 1, total: 2 });
  });

  it("B ativa o RASCUNHO de A: raise `modal_sazonal: modal inexistente` e nenhuma linha muda nas duas lojas", async () => {
    const antes = await estado();
    const e = await capturarErro(() => t.asUser(c.b.donoId, (db) => chamarAtivarModal(db, c.a.modalId)));
    esperarRaise(e, "modal_sazonal: modal inexistente");
    expect(await estado()).toEqual(antes);
  });

  it("B ativa modal de A e modal INEXISTENTE: MESMO erro (sem oráculo de existência)", async () => {
    const antes = await estado();
    const eAlheio = await capturarErro(() => t.asUser(c.b.donoId, (db) => chamarAtivarModal(db, c.a.modalId)));
    const eInexistente = await capturarErro(() =>
      t.asUser(c.b.donoId, (db) => chamarAtivarModal(db, "e9999999-9999-4999-8999-999999999999")),
    );
    esperarRaise(eInexistente, "modal_sazonal: modal inexistente");
    expect(eAlheio).toEqual(eInexistente);
    expect(await estado()).toEqual(antes);
  });

  it("asAnon chamando ativar_modal_sazonal: 42501 permission denied e nada muda", async () => {
    const antes = await estado();
    const e = await capturarErro(() => t.asAnon((db) => chamarAtivarModal(db, c.a.modalId)));
    expect(e.code).toBe("42501");
    expect(e.message).toContain("ativar_modal_sazonal");
    expect(await estado()).toEqual(antes);
  });

  it("asService sem JWT de usuário: raise `modal_sazonal: sem sessao` e nada muda", async () => {
    const antes = await estado();
    const e = await capturarErro(() => t.asService((db) => chamarAtivarModal(db, c.a.modalId)));
    esperarRaise(e, "modal_sazonal: sem sessao");
    expect(await estado()).toEqual(antes);
  });

  it("authenticated com JWT sem `sub`: raise `modal_sazonal: sem sessao` e nada muda", async () => {
    const antes = await estado();
    const e = await capturarErro(() => comoAutenticadoSemSub((db) => chamarAtivarModal(db, c.a.modalId)));
    esperarRaise(e, "modal_sazonal: sem sessao");
    expect(await estado()).toEqual(antes);
  });

  it("ACL: anon e public SEM execute; authenticated COM execute", async () => {
    const r = await t.asService((db) =>
      db.query<{ anon: boolean; auth: boolean }>(
        `select has_function_privilege('anon', 'public.ativar_modal_sazonal(uuid)', 'execute') as anon,
                has_function_privilege('authenticated', 'public.ativar_modal_sazonal(uuid)', 'execute') as auth`,
      ),
    );
    expect(r.rows[0]).toEqual({ anon: false, auth: true });
  });
});
