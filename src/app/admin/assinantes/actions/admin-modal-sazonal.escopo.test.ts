// Fase RED (TDD) da issue 362 — crítica: SIM. Prova de UNIDADE das 5 Server
// Actions ADMIN do modal sazonal (Avisos) na loja-ALVO, sob `service_role`:
//
//   src/app/admin/assinantes/actions/admin-modal-sazonal.ts   ← AINDA NÃO EXISTE
//
// Contrato que a fase GREEN tem de publicar (tasks/362 §Server Actions admin):
//   criarModalSazonalAdmin(lojaId: string, payload: unknown)
//   editarModalSazonalAdmin(lojaId: string, id: string, payload: unknown)
//   ativarModalSazonalAdmin(lojaId: string, id: string)
//   desativarModalSazonalAdmin(lojaId: string, id: string)
//   removerModalSazonalAdmin(lojaId: string, id: string)
// todas devolvendo `ResultadoModalSazonal` de @/lib/actions/patches-modal-sazonal.
//
// Ordem INEGOCIÁVEL de cada action (molde `admin-galeria.ts`):
//   1. `validarLojaIdAdmin(lojaId)` — inválido ⇒ recusa ANTES de qualquer efeito
//      e ANTES de elevar a service_role;
//   2. `schemaModalSazonal.safeParse` / `z.guid()` no `id` — antes de I/O;
//   3. `prepararContextoAdmin(lojaId)` FORA do try (prova admin antes de elevar);
//   4. escrita com o `lojaId` VALIDADO da URL — `p_loja_id` na RPC,
//      `.eq("loja_id", lojaId)` + `.eq("id", id)` nos UPDATE/DELETE;
//   5. `registrarAcessoAdmin` + revalidate.
//
// POR QUE O IMPORT É DINÂMICO: o módulo de produção não existe. Um `import`
// estático quebraria `npx tsc --noEmit` (TS2307) e mascararia TODA asserção
// deste arquivo atrás de um erro de TIPO. Com `import(/* @vite-ignore */ VAR)`
// (padrão de `cardapio.crud.test.ts:678`) o vermelho é de RUNTIME — exatamente
// o que a fase RED precisa provar.
//
// ANTI-FALSO-VERDE — o que cada asserção impede:
//  - `createServiceClient` é um `vi.fn()` CONTADO: "recusa antes de elevar" é
//    afirmado pelo número de chamadas (0), não por "deu ok:false". Uma action
//    que elevasse, escrevesse e só então falhasse devolveria `ok:false` igual —
//    e passaria num teste que só olhasse o retorno;
//  - os writes são capturados com TABELA, OPERAÇÃO, PATCH/ARGS e a LISTA DE
//    FILTROS `.eq`. Afirmar "houve write" não prova escopo: o par
//    (`loja_id`, `id`) é o que impede o UPDATE/DELETE de alcançar a loja errada
//    sob service_role (BYPASSRLS — a RLS NÃO é a defesa aqui, seguranca.md §7);
//  - `p_loja_id` é comparado com o `lojaId` da URL e o payload forjado traz
//    `loja_id` de OUTRA loja: nenhum write pode conter esse valor em lugar
//    nenhum (varredura do registro serializado), nem de carona com campo válido;
//  - o caso de sucesso é o contrapeso: sem ele, um módulo que recusasse tudo
//    passaria em todos os casos negativos;
//  - `mostrar_promocoes_junto` ausente tem de chegar como `null` (preservar) e
//    não como `false` — é `montarPatchModalSazonal` reusado, SEM segunda
//    allowlist.
//
// NENHUMA lógica de produção aqui.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResultadoModalSazonal } from "@/lib/actions/patches-modal-sazonal";

const LOJA_URL = "11111111-1111-4111-8111-111111111111";
const LOJA_FORJADA = "99999999-9999-4999-8999-999999999999";
const MODAL_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORIA_ID = "33333333-3333-4333-8333-333333333333";
const CARDAPIO_ID = "44444444-4444-4444-8444-444444444444";
const NAO_UUID = "nao-e-uuid-362";

// ── next/cache ────────────────────────────────────────────────────────────────
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ── prova de admin ────────────────────────────────────────────────────────────
const verificarAdminSaaS = vi.fn(async () => {});
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: vi.fn(() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
}));

// ── service client: captura cada write e cada RPC, com filtros `.eq` ──────────
type Write = {
  tabela: string;
  op: "insert" | "update" | "delete" | "rpc";
  dados?: Record<string, unknown>;
  args?: Record<string, unknown>;
  filtros: Array<[string, unknown]>;
};
const writes: Write[] = [];

/** Só os writes de DADO — o log de auditoria (`admin_acessos`) não conta. */
const dados = () => writes.filter((w) => w.tabela !== "admin_acessos");

type Resposta = { data: unknown; error: null; count: number | null };

function cadeia(reg: Write, resposta: Resposta) {
  const obj = {
    eq(coluna: string, valor: unknown) {
      reg.filtros.push([coluna, valor]);
      return obj;
    },
    in(coluna: string, valores: unknown) {
      reg.filtros.push([coluna, valores]);
      return obj;
    },
    select() {
      return obj;
    },
    maybeSingle() {
      return Promise.resolve(resposta);
    },
    single() {
      return Promise.resolve(resposta);
    },
    then<T>(
      ok?: ((v: Resposta) => T) | null,
      falha?: ((e: unknown) => T) | null,
    ): Promise<T> {
      return Promise.resolve(resposta).then(ok ?? undefined, falha ?? undefined);
    },
  };
  return obj;
}

const OK_UMA_LINHA: Resposta = { data: { id: MODAL_ID }, error: null, count: 1 };

const clientServico = {
  from(tabela: string) {
    const mk = (op: Write["op"], dadosDoWrite?: unknown) => {
      const reg: Write = {
        tabela,
        op,
        dados: (dadosDoWrite ?? undefined) as Record<string, unknown> | undefined,
        filtros: [],
      };
      writes.push(reg);
      return cadeia(reg, OK_UMA_LINHA);
    };
    return {
      insert: (linha: unknown) => mk("insert", linha),
      upsert: (linhas: unknown) => mk("insert", linhas),
      update: (patch: unknown) => mk("update", patch),
      delete: () => mk("delete"),
      select: () => cadeia({ tabela, op: "update", filtros: [] }, OK_UMA_LINHA),
    };
  },
  rpc(nome: string, args: Record<string, unknown>) {
    writes.push({ tabela: nome, op: "rpc", args, filtros: [] });
    // `salvar_modal_sazonal` devolve o id do modal gravado.
    return Promise.resolve({ data: MODAL_ID, error: null });
  },
};

const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// Defensivo: se o GREEN resolver o slug para revalidar a vitrine, não vai ao banco.
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaAdminPorId: vi.fn(async () => ({ id: LOJA_URL, slug: "loja-alvo-362" })),
  slugExiste: vi.fn(async () => false),
}));

// ── o módulo que a fase GREEN tem de criar ────────────────────────────────────
const MODULO = "./admin-modal-sazonal";

type ModAdminModalSazonal = {
  criarModalSazonalAdmin(lojaId: string, payload: unknown): Promise<ResultadoModalSazonal>;
  editarModalSazonalAdmin(
    lojaId: string,
    id: string,
    payload: unknown,
  ): Promise<ResultadoModalSazonal>;
  ativarModalSazonalAdmin(lojaId: string, id: string): Promise<ResultadoModalSazonal>;
  desativarModalSazonalAdmin(lojaId: string, id: string): Promise<ResultadoModalSazonal>;
  removerModalSazonalAdmin(lojaId: string, id: string): Promise<ResultadoModalSazonal>;
};

async function acoes(): Promise<ModAdminModalSazonal> {
  return (await import(/* @vite-ignore */ MODULO)) as unknown as ModAdminModalSazonal;
}

// ── payload válido pelo `schemaModalSazonal` REUSADO (sem segunda allowlist) ──
const PAYLOAD_OK = {
  titulo: "Festa junina",
  exibicao_inicio: "2026-06-01T00:00:00-03:00",
  exibicao_fim: "2026-06-30T23:59:59-03:00",
  mensagem: { versao: 1, paragrafos: [{ trechos: [{ texto: "Promo de junho" }] }] },
  categorias: [CATEGORIA_ID],
  cardapios: [CARDAPIO_ID],
};

beforeEach(() => {
  writes.length = 0;
  createServiceClient.mockClear();
  verificarAdminSaaS.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Nenhum write (nem o log) carrega o valor da loja forjada, em campo nenhum. */
function nenhumVestigioDaLojaForjada() {
  const comVestigio = writes.filter((w) => JSON.stringify(w).includes(LOJA_FORJADA));
  expect(comVestigio).toEqual([]);
}

/** Um `.eq` por coluna, comparado como conjunto (a ordem do builder não importa). */
function filtrosDe(w: Write): Record<string, unknown> {
  return Object.fromEntries(w.filtros);
}

// ═══════════════════════════════════════════ 1. lojaId inválido ⇒ nada, nem svc
describe("[362] lojaId não-uuid ⇒ recusa ANTES de elevar a service_role", () => {
  const invalidos: Array<[string, unknown]> = [
    ["string não-uuid", NAO_UUID],
    ["string vazia", ""],
    ["número", 7],
    ["null", null],
    ["undefined", undefined],
    ["objeto", { toString: () => LOJA_URL }],
  ];

  it.each(invalidos)("criar — %s", async (_n, lojaId) => {
    const { criarModalSazonalAdmin } = await acoes();

    const r = await criarModalSazonalAdmin(lojaId as string, PAYLOAD_OK);

    expect(r.ok).toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it.each(invalidos)("editar — %s", async (_n, lojaId) => {
    const { editarModalSazonalAdmin } = await acoes();

    const r = await editarModalSazonalAdmin(lojaId as string, MODAL_ID, PAYLOAD_OK);

    expect(r.ok).toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it.each(invalidos)("ativar — %s", async (_n, lojaId) => {
    const { ativarModalSazonalAdmin } = await acoes();

    const r = await ativarModalSazonalAdmin(lojaId as string, MODAL_ID);

    expect(r.ok).toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it.each(invalidos)("desativar — %s", async (_n, lojaId) => {
    const { desativarModalSazonalAdmin } = await acoes();

    const r = await desativarModalSazonalAdmin(lojaId as string, MODAL_ID);

    expect(r.ok).toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it.each(invalidos)("remover — %s", async (_n, lojaId) => {
    const { removerModalSazonalAdmin } = await acoes();

    const r = await removerModalSazonalAdmin(lojaId as string, MODAL_ID);

    expect(r.ok).toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

// ═══════════════════════════════════════════════ 2. id de modal inválido ⇒ nada
describe("[362] id de modal não-uuid ⇒ recusa antes de qualquer I/O", () => {
  const idsRuins: Array<[string, unknown]> = [
    ["string não-uuid", NAO_UUID],
    ["string vazia", ""],
    ["null", null],
    // Um filtro `.eq("id", "*")` sob service_role alcançaria a loja inteira.
    ["curinga", "*"],
  ];

  it.each(idsRuins)("editar — %s", async (_n, id) => {
    const { editarModalSazonalAdmin } = await acoes();

    const r = await editarModalSazonalAdmin(LOJA_URL, id as string, PAYLOAD_OK);

    expect(r.ok).toBe(false);
    expect(dados()).toEqual([]);
  });

  it.each(idsRuins)("ativar — %s", async (_n, id) => {
    const { ativarModalSazonalAdmin } = await acoes();

    const r = await ativarModalSazonalAdmin(LOJA_URL, id as string);

    expect(r.ok).toBe(false);
    expect(dados()).toEqual([]);
  });

  it.each(idsRuins)("desativar — %s", async (_n, id) => {
    const { desativarModalSazonalAdmin } = await acoes();

    const r = await desativarModalSazonalAdmin(LOJA_URL, id as string);

    expect(r.ok).toBe(false);
    expect(dados()).toEqual([]);
  });

  it.each(idsRuins)("remover — %s", async (_n, id) => {
    const { removerModalSazonalAdmin } = await acoes();

    const r = await removerModalSazonalAdmin(LOJA_URL, id as string);

    expect(r.ok).toBe(false);
    expect(dados()).toEqual([]);
  });
});

// ════════════════════════════════ 3. a loja que vale é a da URL, nunca a do payload
describe("[362] `loja_id` da escrita vem da URL VALIDADA, nunca do payload", () => {
  it("criar com payload OK ⇒ RPC salvar_modal_sazonal com p_loja_id = lojaId da URL e p_modal_id null", async () => {
    const { criarModalSazonalAdmin } = await acoes();

    const r = await criarModalSazonalAdmin(LOJA_URL, PAYLOAD_OK);

    expect(r).toEqual({ ok: true });
    const rpcs = dados().filter((w) => w.op === "rpc");
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].tabela).toBe("salvar_modal_sazonal");
    const args = rpcs[0].args!;
    expect(args.p_loja_id).toBe(LOJA_URL);
    expect(args.p_modal_id).toBe(null);
    expect(args.p_titulo).toBe("Festa junina");
    expect(args.p_categorias).toEqual([CATEGORIA_ID]);
    expect(args.p_cardapios).toEqual([CARDAPIO_ID]);
    // `montarPatchModalSazonal` reusado: ausente = preservar (`null`), não `false`.
    expect(args.p_mostrar_promocoes_junto).toBe(null);
    // A mensagem canônica chega à RPC (RN-M15: linha + mensagem juntas).
    expect((args.p_mensagem as { versao?: number } | null)?.versao).toBe(1);
  });

  it("editar com payload OK ⇒ p_modal_id = id da rota e p_loja_id = lojaId da URL", async () => {
    const { editarModalSazonalAdmin } = await acoes();

    const r = await editarModalSazonalAdmin(LOJA_URL, MODAL_ID, PAYLOAD_OK);

    expect(r).toEqual({ ok: true });
    const rpcs = dados().filter((w) => w.op === "rpc");
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].tabela).toBe("salvar_modal_sazonal");
    expect(rpcs[0].args!.p_modal_id).toBe(MODAL_ID);
    expect(rpcs[0].args!.p_loja_id).toBe(LOJA_URL);
  });

  it("criar com `loja_id` FORJADO no payload ⇒ recusa (schemaModalSazonal é `.strict()`) e NENHUM write com a loja forjada", async () => {
    const { criarModalSazonalAdmin } = await acoes();

    const r = await criarModalSazonalAdmin(LOJA_URL, {
      ...PAYLOAD_OK,
      loja_id: LOJA_FORJADA,
    });

    expect(r.ok).toBe(false);
    nenhumVestigioDaLojaForjada();
    // Invariante que vale sob QUALQUER desenho: se um write escapasse, ele teria
    // de carregar a loja da URL.
    for (const w of dados().filter((x) => x.op === "rpc")) {
      expect(w.args!.p_loja_id).toBe(LOJA_URL);
    }
  });

  it("editar com `loja_id` FORJADO no payload ⇒ recusa e nenhum vestígio da loja forjada", async () => {
    const { editarModalSazonalAdmin } = await acoes();

    const r = await editarModalSazonalAdmin(LOJA_URL, MODAL_ID, {
      ...PAYLOAD_OK,
      loja_id: LOJA_FORJADA,
    });

    expect(r.ok).toBe(false);
    nenhumVestigioDaLojaForjada();
  });

  it("criar com colunas AUTORITATIVAS forjadas (`id`, `ativo`, `criado_em`) ⇒ recusa; nenhuma delas chega à RPC", async () => {
    const { criarModalSazonalAdmin } = await acoes();

    const r = await criarModalSazonalAdmin(LOJA_URL, {
      ...PAYLOAD_OK,
      id: MODAL_ID,
      ativo: true,
      criado_em: "2020-01-01T00:00:00-03:00",
    });

    expect(r.ok).toBe(false);
    for (const w of dados().filter((x) => x.op === "rpc")) {
      for (const proibida of ["ativo", "id", "criado_em", "loja_id"]) {
        expect(proibida in w.args!).toBe(false);
      }
    }
  });
});

// ═══════════════════════════ 4. ativar: overload de 2 args amarra a loja no banco
describe("[362] ativar ⇒ RPC ativar_modal_sazonal com os DOIS argumentos", () => {
  it("passa p_modal_id e p_loja_id (a loja-alvo é amarrada no BANCO, não por pré-checagem em TS)", async () => {
    const { ativarModalSazonalAdmin } = await acoes();

    const r = await ativarModalSazonalAdmin(LOJA_URL, MODAL_ID);

    expect(r).toEqual({ ok: true });
    const rpcs = dados().filter((w) => w.op === "rpc");
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].tabela).toBe("ativar_modal_sazonal");
    // Igualdade EXATA: nem argumento a menos (voltaria ao 1-arg do lojista, que
    // sob service_role cai em 'sem sessao'), nem a mais.
    expect(rpcs[0].args).toEqual({ p_modal_id: MODAL_ID, p_loja_id: LOJA_URL });
  });
});

// ══════════════════════════════ 5. desativar/remover: par de filtros `loja_id`+`id`
describe("[362] UPDATE/DELETE escopados pelo PAR (loja_id, id) — cinto e suspensório", () => {
  it("desativar ⇒ UPDATE em modais_sazonais com ativo:false e os DOIS filtros", async () => {
    const { desativarModalSazonalAdmin } = await acoes();

    const r = await desativarModalSazonalAdmin(LOJA_URL, MODAL_ID);

    expect(r).toEqual({ ok: true });
    const updates = dados().filter((w) => w.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].tabela).toBe("modais_sazonais");
    expect(updates[0].dados).toMatchObject({ ativo: false });
    // O par é o que impede o UPDATE de alcançar a loja errada sob BYPASSRLS.
    expect(filtrosDe(updates[0])).toMatchObject({ loja_id: LOJA_URL, id: MODAL_ID });
    expect(updates[0].filtros).toHaveLength(2);
  });

  it("remover ⇒ DELETE em modais_sazonais com os DOIS filtros (nunca só por id)", async () => {
    const { removerModalSazonalAdmin } = await acoes();

    const r = await removerModalSazonalAdmin(LOJA_URL, MODAL_ID);

    expect(r).toEqual({ ok: true });
    const deletes = dados().filter((w) => w.op === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].tabela).toBe("modais_sazonais");
    expect(filtrosDe(deletes[0])).toMatchObject({ loja_id: LOJA_URL, id: MODAL_ID });
    expect(deletes[0].filtros).toHaveLength(2);
  });

  it("nenhuma das 5 actions escreve em tabela fora de modais_sazonais / das suas RPCs / do log", async () => {
    const { criarModalSazonalAdmin, ativarModalSazonalAdmin, removerModalSazonalAdmin } =
      await acoes();

    await criarModalSazonalAdmin(LOJA_URL, PAYLOAD_OK);
    await ativarModalSazonalAdmin(LOJA_URL, MODAL_ID);
    await removerModalSazonalAdmin(LOJA_URL, MODAL_ID);

    const permitidas = new Set([
      "modais_sazonais",
      "salvar_modal_sazonal",
      "ativar_modal_sazonal",
      "admin_acessos",
    ]);
    for (const w of writes) {
      expect(permitidas.has(w.tabela), `write inesperado em ${w.tabela}`).toBe(true);
    }
  });
});

// ═════════════════════════════════ 6. fail-closed: prova de admin antes de elevar
describe("[362] prova de admin é FORA do try: se lança, PROPAGA (fail-closed)", () => {
  it("verificarAdminSaaS rejeitando ⇒ a action REJEITA (não vira `{ ok: false }` amigável) e nada é escrito", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    const { criarModalSazonalAdmin } = await acoes();

    await expect(criarModalSazonalAdmin(LOJA_URL, PAYLOAD_OK)).rejects.toThrow();

    expect(dados()).toEqual([]);
  });
});
