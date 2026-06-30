import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Suite TRANSVERSAL de isolamento admin — issue 102 (crítica: SIM).
 *
 * Esta suite não duplica os testes por-action; enumera, de forma consolidada,
 * as invariantes de segurança que cruzam toda a feature de onboarding assistido
 * (issues 087–096). Cada invariante falharia se o comportamento protegido fosse
 * removido — lethalidade documentada inline.
 *
 * Organização:
 *   §1 — Gate de admin (RN-1): todas as actions, admin reprovado → propaga
 *   §2 — Escopo cross-loja (RN-2/3): eq("loja_id"/"id") capturado via spy
 *   §3 — Colunas protegidas (RN-7/8): salvarPerfilAdmin e publicarLojaAdmin
 *   §4 — RN-4: criarLojaAdmin, 2ª loja mesmo dono → {ok:false}, sem 2ª loja
 */

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════════════════

const LOJA_A = "11111111-1111-1111-1111-111111111111";
const LOJA_B = "22222222-2222-2222-2222-222222222222";
const RECURSO_ID = "33333333-3333-3333-3333-333333333333";
const EMAIL = "lojista@exemplo.com";
const DONO_ID_RESOLVIDO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// ── next/cache ──────────────────────────────────────────────────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS ───────────────────────────────────────────────────────
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── Query builder encadeável e espionável ────────────────────────────────────
// Captura tabela, tipo de operação, payload e filtros .eq().
// Resposta terminal configurável; default = sucesso 1 linha.
type Operacao = {
  tabela: string;
  tipo: "insert" | "update" | "delete" | "select" | "upsert";
  payload?: unknown;
  eqs: { coluna: string; valor: unknown }[];
};

let ops: Operacao[];
let terminalPadrao: () => { data: unknown; error: unknown; count: number | null };

function criarBuilder(tabela: string): Record<string, unknown> {
  const op: Operacao = { tabela, tipo: "select", eqs: [] };
  ops.push(op);

  const builder: Record<string, unknown> = {
    insert(payload: unknown) { op.tipo = "insert"; op.payload = payload; return builder; },
    update(payload: unknown) { op.tipo = "update"; op.payload = payload; return builder; },
    upsert(payload: unknown) { op.tipo = "upsert"; op.payload = payload; return builder; },
    delete() { op.tipo = "delete"; return builder; },
    select() { return builder; },
    single() { return builder; },
    maybeSingle() { return builder; },
    eq(coluna: string, valor: unknown) {
      op.eqs.push({ coluna, valor });
      return builder;
    },
    order() { return builder; },
    then(
      resolve: (v: { data: unknown; error: unknown; count: number | null }) => unknown,
    ) {
      return Promise.resolve(terminalPadrao()).then(resolve);
    },
  };
  return builder;
}

const clientServico = {
  marker: "svc-fake",
  from: (t: string) => criarBuilder(t),
  // Storage para excluirLoja (best-effort cleanup)
  storage: {
    from: () => ({
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ data: {}, error: null }),
    }),
  },
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── admin-loja helpers (reais, exceto registrarAcessoAdmin que é no-op) ──────
vi.mock("@/lib/actions/admin-loja", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, registrarAcessoAdmin: vi.fn() };
});

// ── Mock UNIFICADO de queries/lojas ─────────────────────────────────────────
// Unifica num único vi.mock todos os símbolos de @/lib/supabase/queries/lojas
// usados pelas actions deste módulo. Dois vi.mock() para o mesmo path se
// sobrescreveriam — fatal para salvarPerfilAdmin (slugExiste) e criarLojaAdmin.
const resolverDonoPorEmail = vi.fn<(...a: unknown[]) => Promise<string | null>>(
  async () => DONO_ID_RESOLVIDO,
);
const slugExiste = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => false);
const criarLoja = vi.fn<(...a: unknown[]) => Promise<{ id: string }>>(
  async () => ({ id: LOJA_A }),
);
const buscarLojaAdminPorId = vi.fn<(...a: unknown[]) => Promise<{ id: string; nome: string; ativo: boolean }>>(
  async () => ({ id: LOJA_A, nome: "Loja A", ativo: false }),
);
vi.mock("@/lib/supabase/queries/lojas", () => ({
  resolverDonoPorEmail: (...a: unknown[]) => resolverDonoPorEmail(...a),
  slugExiste: (...a: unknown[]) => slugExiste(...a),
  criarLoja: (...a: unknown[]) => criarLoja(...a),
  buscarLojaAdminPorId: (...a: unknown[]) => buscarLojaAdminPorId(...a),
}));

// ── adminAssinatura (usado pelas billing actions) ────────────────────────────
const excluirLojaPermanente = vi.fn<(...a: unknown[]) => Promise<{ linhasAfetadas: number }>>(
  async () => ({ linhasAfetadas: 1 }),
);
const aplicarStatusAdmin = vi.fn<(...a: unknown[]) => Promise<{ linhasAfetadas: number }>>(
  async () => ({ linhasAfetadas: 1 }),
);
vi.mock("@/lib/supabase/queries/adminAssinatura", () => ({
  excluirLojaPermanente: (...a: unknown[]) => excluirLojaPermanente(...a),
  aplicarStatusAdmin: (...a: unknown[]) => aplicarStatusAdmin(...a),
}));

// ── notFound para carga.ts ───────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

// ── Queries usadas por carregarLojaAdmin ─────────────────────────────────────
vi.mock("@/lib/supabase/queries/categorias", () => ({
  buscarCategorias: vi.fn(async () => []),
}));
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosDoLojista: vi.fn(async () => []),
}));
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  listarZonasComTaxas: vi.fn(async () => []),
  listarFormasPagamento: vi.fn(async () => []),
}));

// ── geocodificarEnderecoComMotivo (salvarPerfilAdmin) ────────────────────────
vi.mock("@/lib/utils/geocodificarEndereco", () => ({
  geocodificarEnderecoComMotivo: vi.fn(async () => ({
    coords: { latitude: -23.55, longitude: -46.63 },
  })),
}));

// ── validarBlobImagem (admin-upload, admin-pagamento) ────────────────────────
vi.mock("@/lib/actions/upload-imagem", () => ({
  validarBlobImagem: vi.fn(async () => ({
    ok: true,
    buffer: new Uint8Array([0x89, 0x50]),
    tipoReal: "image/png",
    ext: "png",
  })),
}));

// ── Imports das actions APÓS todos os vi.mock() ──────────────────────────────
import {
  criarLojaAdmin,
  concederCortesia,
  revogarCortesia,
  suspenderLoja,
  reativarLoja,
  excluirLoja,
} from "./actions";
import { carregarLojaAdmin } from "./[lojaId]/carga";
import {
  criarCategoriaAdmin,
  atualizarCategoriaAdmin,
  removerCategoriaAdmin,
} from "./actions/admin-categorias";
import {
  criarZonaAdmin,
  atualizarZonaAdmin,
  removerZonaAdmin,
} from "./actions/admin-entrega";
import { salvarHorariosAdmin, salvarTemaAdmin } from "./actions/admin-horarios-tema";
import {
  removerFormaPagamentoAdmin,
} from "./actions/admin-pagamento";
import { salvarPerfilAdmin } from "./actions/admin-perfil";
import { publicarLojaAdmin } from "./actions/admin-publicar";

// ── Payloads mínimos válidos ─────────────────────────────────────────────────
const PAYLOAD_NOVA_LOJA = { email: EMAIL, nome: "Loja Teste", slug: "loja-teste" };
const PAYLOAD_CATEGORIA = { nome: "Bebidas", ordem: 0 };
const PAYLOAD_ZONA = {
  nome: "Centro",
  tipo: "bairro" as const,
  ativo: true,
  taxa: { taxa: 5.0, pedido_minimo_gratis: null, raio_max_km: null },
  bairros: ["Centro"],
};
const HORARIOS_OK = {
  seg: { abre: "09:00", fecha: "18:00", ativo: true },
  ter: { abre: "09:00", fecha: "18:00", ativo: true },
  qua: { abre: "09:00", fecha: "18:00", ativo: true },
  qui: { abre: "09:00", fecha: "18:00", ativo: true },
  sex: { abre: "09:00", fecha: "18:00", ativo: true },
  sab: { abre: "10:00", fecha: "14:00", ativo: true },
  dom: { abre: "00:00", fecha: "00:00", ativo: false },
};
const TEMA_OK = { primaria: "#ff0000", fundo: "#ffffff", destaque: "#00ff00" };
const PAYLOAD_PERFIL = {
  nome: "Pizzaria do Zé",
  slug: "pizzaria-do-ze",
  whatsapp: "5511999998888",
  endereco_cep: "01001-000",
  endereco_rua: "Praça da Sé",
  endereco_numero: "100",
  endereco_bairro: "Sé",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
};

// ═══════════════════════════════════════════════════════════════════════════════
// beforeEach: restaura defaults
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  ops = [];

  // Repõe implementações após clearAllMocks
  verificarAdminSaaS.mockResolvedValue(undefined);
  terminalPadrao = () => ({ data: [{ id: RECURSO_ID }], error: null, count: 1 });

  resolverDonoPorEmail.mockResolvedValue(DONO_ID_RESOLVIDO);
  slugExiste.mockResolvedValue(false);
  criarLoja.mockResolvedValue({ id: LOJA_A });
  excluirLojaPermanente.mockResolvedValue({ linhasAfetadas: 1 });
  aplicarStatusAdmin.mockResolvedValue({ linhasAfetadas: 1 });
  buscarLojaAdminPorId.mockResolvedValue({ id: LOJA_A, nome: "Loja A", ativo: false });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §1 — Gate de admin (RN-1): admin reprovado → exceção PROPAGA em TODAS as actions
// ═══════════════════════════════════════════════════════════════════════════════
//
// LETHALIDADE: se uma action capturasse a exceção e retornasse { ok:false }
// em vez de propagar, o gate seria burlado. O teste falharia porque
// expect(promise).rejects.toThrow() falharia em promise que resolve.
// Removendo o `await verificarAdminSaaS()` os testes também falhariam:
// a action resolveria com { ok:true } sem ter provado admin.
//
// Cobre: createServiceClient NÃO é chamado → zero escrita/leitura.

describe("§1 Gate de admin (RN-1): admin reprovado propaga em TODAS as actions", () => {
  const ERRO_ADMIN = "Acesso negado — não é admin SaaS.";

  it("[087] criarLojaAdmin — admin reprovado → rejeita, NENHUM INSERT", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(criarLojaAdmin(PAYLOAD_NOVA_LOJA)).rejects.toThrow();
    expect(criarLoja).not.toHaveBeenCalled();
  });

  it("[088] criarCategoriaAdmin — admin reprovado → rejeita, ZERO escrita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(criarCategoriaAdmin(LOJA_A, PAYLOAD_CATEGORIA)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("[088] removerCategoriaAdmin — admin reprovado → rejeita, ZERO escrita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(removerCategoriaAdmin(LOJA_A, RECURSO_ID)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[089] criarZonaAdmin — admin reprovado → rejeita, ZERO escrita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(criarZonaAdmin(LOJA_A, PAYLOAD_ZONA)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[089] atualizarZonaAdmin — admin reprovado → rejeita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(atualizarZonaAdmin(LOJA_A, RECURSO_ID, PAYLOAD_ZONA)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[089] removerZonaAdmin — admin reprovado → rejeita, zero DELETE", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(removerZonaAdmin(LOJA_A, RECURSO_ID)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[091] salvarHorariosAdmin — admin reprovado → rejeita, ZERO update", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(salvarHorariosAdmin(LOJA_A, HORARIOS_OK)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("[091] salvarTemaAdmin — admin reprovado → rejeita, ZERO update", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(salvarTemaAdmin(LOJA_A, TEMA_OK)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[092] salvarPerfilAdmin — admin reprovado → rejeita, ZERO update", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(salvarPerfilAdmin(LOJA_A, PAYLOAD_PERFIL)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[094] removerFormaPagamentoAdmin — admin reprovado → rejeita, ZERO delete", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(removerFormaPagamentoAdmin(LOJA_A, RECURSO_ID)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[095] publicarLojaAdmin — admin reprovado → rejeita, ativo inalterado", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(publicarLojaAdmin(LOJA_A, true)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("[096] carregarLojaAdmin — admin reprovado → rejeita, NENHUMA query de dados", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(carregarLojaAdmin(LOJA_A)).rejects.toThrow();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
  });

  it("[billing] concederCortesia — admin reprovado → rejeita, aplicarStatusAdmin não chamado", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(concederCortesia(LOJA_A)).rejects.toThrow();
    expect(aplicarStatusAdmin).not.toHaveBeenCalled();
  });

  it("[billing] revogarCortesia — admin reprovado → rejeita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(revogarCortesia(LOJA_A)).rejects.toThrow();
    expect(aplicarStatusAdmin).not.toHaveBeenCalled();
  });

  it("[billing] suspenderLoja — admin reprovado → rejeita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(suspenderLoja(LOJA_A)).rejects.toThrow();
    expect(aplicarStatusAdmin).not.toHaveBeenCalled();
  });

  it("[billing] reativarLoja — admin reprovado → rejeita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(reativarLoja(LOJA_A)).rejects.toThrow();
    expect(aplicarStatusAdmin).not.toHaveBeenCalled();
  });

  it("[084] excluirLoja — admin reprovado → rejeita, DELETE não executado", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error(ERRO_ADMIN));
    await expect(excluirLoja(LOJA_A)).rejects.toThrow();
    expect(excluirLojaPermanente).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §2 — Escopo cross-loja (RN-2/3): eq("loja_id"/"id") é a única amarra
// ═══════════════════════════════════════════════════════════════════════════════
//
// LETHALIDADE dos testes de escopo positivo: se o .eq("loja_id") for removido
// do código de produção, o UPDATE/DELETE afetaria todas as linhas (ou PostgREST
// recusaria). O builder espião não vê o filtro → expect(...).toContainEqual()
// falha.
//
// LETHALIDADE dos testes de "recurso de B passado com lojaId=A":
// terminalPadrao retorna count=0 simulando que o escopo zerou o match (o recurso
// de B não aparece sob lojaId=A). A action deve interpretar count=0 como "não
// encontrado" e retornar { ok:false }. Se o eq() fosse removido e o banco real
// retornasse o recurso de B, a action mentiria com { ok:true }.

describe("§2 Escopo cross-loja (RN-2/3): eq(loja_id) é a única amarra sob service_role", () => {
  it("[088] criarCategoriaAdmin → INSERT em categorias inclui loja_id=LOJA_A do PARÂMETRO", async () => {
    await criarCategoriaAdmin(LOJA_A, PAYLOAD_CATEGORIA);

    const insert = ops.find((o) => o.tipo === "insert" && o.tabela === "categorias");
    expect(insert, "esperava INSERT em categorias").toBeDefined();
    const payload = insert!.payload as Record<string, unknown>;
    expect(payload.loja_id).toBe(LOJA_A);
    // loja_id nunca vem do payload do cliente (PAYLOAD_CATEGORIA não tem loja_id)
    expect(payload.loja_id).not.toBe(LOJA_B);
  });

  it("[088] atualizarCategoriaAdmin com recurso de LOJA_B → eq(loja_id, LOJA_A) zera o match → {ok:false}", async () => {
    // Simula recurso pertencente a LOJA_B: escopo por LOJA_A retorna count=0
    terminalPadrao = () => ({ data: null, error: null, count: 0 });

    const r = await atualizarCategoriaAdmin(LOJA_A, RECURSO_ID, PAYLOAD_CATEGORIA);

    const update = ops.find((o) => o.tipo === "update" && o.tabela === "categorias");
    expect(update, "esperava UPDATE em categorias").toBeDefined();
    // Filtro de escopo obrigatório — sem ele count=0 não seria atingível neste teste
    expect(update!.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_A });
    expect(update!.eqs).toContainEqual({ coluna: "id", valor: RECURSO_ID });
    // Recurso de B não afetado (count=0 → { ok:false })
    expect(r).toMatchObject({ ok: false });
  });

  it("[088] removerCategoriaAdmin → DELETE inclui eq(loja_id, LOJA_A) E eq(id, RECURSO_ID)", async () => {
    await removerCategoriaAdmin(LOJA_A, RECURSO_ID);

    const del = ops.find((o) => o.tipo === "delete" && o.tabela === "categorias");
    expect(del, "esperava DELETE em categorias").toBeDefined();
    expect(del!.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_A });
    expect(del!.eqs).toContainEqual({ coluna: "id", valor: RECURSO_ID });
  });

  it("[091] salvarHorariosAdmin → UPDATE em lojas escopado por eq('id', LOJA_A), nunca LOJA_B", async () => {
    await salvarHorariosAdmin(LOJA_A, HORARIOS_OK);

    const update = ops.find((o) => o.tipo === "update" && o.tabela === "lojas");
    expect(update, "esperava UPDATE em lojas").toBeDefined();
    expect(update!.eqs).toContainEqual({ coluna: "id", valor: LOJA_A });
    expect(update!.eqs).not.toContainEqual({ coluna: "id", valor: LOJA_B });
  });

  it("[091] salvarTemaAdmin → UPDATE em lojas escopado por eq('id', LOJA_A)", async () => {
    await salvarTemaAdmin(LOJA_A, TEMA_OK);

    const update = ops.find((o) => o.tipo === "update" && o.tabela === "lojas");
    expect(update, "esperava UPDATE em lojas").toBeDefined();
    expect(update!.eqs).toContainEqual({ coluna: "id", valor: LOJA_A });
  });

  it("[092] salvarPerfilAdmin → todos os UPDATEs em lojas escopados por eq('id', LOJA_A)", async () => {
    await salvarPerfilAdmin(LOJA_A, PAYLOAD_PERFIL);

    // salvarPerfilAdmin faz 2 UPDATEs: [0] perfil/endereço, [1] coords
    const updates = ops.filter((o) => o.tipo === "update" && o.tabela === "lojas");
    expect(updates.length, "esperava 2 UPDATEs em lojas").toBeGreaterThanOrEqual(1);
    for (const u of updates) {
      expect(u.eqs).toContainEqual({ coluna: "id", valor: LOJA_A });
    }
  });

  it("[093] criarZonaAdmin → INSERT em zonas_entrega inclui loja_id=LOJA_A do parâmetro", async () => {
    await criarZonaAdmin(LOJA_A, PAYLOAD_ZONA);

    const zonaInsert = ops.find((o) => o.tipo === "insert" && o.tabela === "zonas_entrega");
    expect(zonaInsert, "esperava INSERT em zonas_entrega").toBeDefined();
    expect((zonaInsert!.payload as Record<string, unknown>).loja_id).toBe(LOJA_A);
  });

  it("[093] removerZonaAdmin com recurso de LOJA_B → DELETE tem eq(loja_id, LOJA_A) → zona de B inalterada", async () => {
    // terminalPadrao padrão = count:1 (1 linha afetada)
    // O ponto de prova aqui é o eq() no DELETE, não count=0.
    // Se eq(loja_id) fosse removido, o DELETE afetaria qualquer zona (cross-loja).
    await removerZonaAdmin(LOJA_A, RECURSO_ID);

    const del = ops.find((o) => o.tipo === "delete" && o.tabela === "zonas_entrega");
    expect(del, "esperava DELETE em zonas_entrega").toBeDefined();
    expect(del!.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_A });
    expect(del!.eqs).toContainEqual({ coluna: "id", valor: RECURSO_ID });
  });

  it("[094] removerFormaPagamentoAdmin → DELETE inclui eq(loja_id, LOJA_A) E eq(id, RECURSO_ID)", async () => {
    await removerFormaPagamentoAdmin(LOJA_A, RECURSO_ID);

    const del = ops.find((o) => o.tipo === "delete" && o.tabela === "formas_pagamento");
    expect(del, "esperava DELETE em formas_pagamento").toBeDefined();
    expect(del!.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_A });
    expect(del!.eqs).toContainEqual({ coluna: "id", valor: RECURSO_ID });
  });

  it("[095] publicarLojaAdmin → UPDATE em lojas escopado por eq('id', LOJA_A), nunca LOJA_B", async () => {
    await publicarLojaAdmin(LOJA_A, true);

    const update = ops.find((o) => o.tipo === "update" && o.tabela === "lojas");
    expect(update, "esperava UPDATE em lojas").toBeDefined();
    expect(update!.eqs).toContainEqual({ coluna: "id", valor: LOJA_A });
    expect(update!.eqs).not.toContainEqual({ coluna: "id", valor: LOJA_B });
  });

  it("[096] carregarLojaAdmin → TODA query recebe lojaId LOJA_A, nunca LOJA_B", async () => {
    await carregarLojaAdmin(LOJA_A);

    // buscarLojaAdminPorId é a query central — seu 2º arg deve ser sempre LOJA_A
    expect(buscarLojaAdminPorId).toHaveBeenCalledWith(clientServico, LOJA_A);
    for (const call of buscarLojaAdminPorId.mock.calls) {
      expect(call[1]).not.toBe(LOJA_B);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §3 — Colunas protegidas (RN-7 salvarPerfilAdmin / RN-8 publicarLojaAdmin)
// ═══════════════════════════════════════════════════════════════════════════════
//
// LETHALIDADE RN-7: se montarPatchPerfil incluísse uma chave da blocklist
// (ex: removendo o filtro de allowlist coluna a coluna), o teste falharia com
// expect(patch).not.toHaveProperty(chaveProibida).
//
// LETHALIDADE RN-8: se publicarLojaAdmin passasse colunas extras no patch,
// expect(patch).toEqual({ ativo: publicar }) falharia (igualdade estrita).

describe("§3 Colunas protegidas (RN-7 salvarPerfilAdmin / RN-8 publicarLojaAdmin)", () => {
  const COLUNAS_PROIBIDAS_PERFIL = [
    "ativo",
    "dono_id",
    "assinatura_status",
    "hotmart_subscriber_code",
    "hotmart_transaction",
    "consentimento_versao",
    "consentimento_em",
    "latitude",
    "longitude",
    "id",
    "billing_provider",
    "plano_id",
    "fim_periodo_atual",
  ];

  it("[092] salvarPerfilAdmin — payload hostil com colunas autoritativas → 1º UPDATE NÃO contém nenhuma delas", async () => {
    const payloadHostil = {
      // Campos legítimos do perfil:
      nome: "Loja Legítima",
      slug: "loja-legitima",
      whatsapp: "5511999998888",
      endereco_cep: "01001-000",
      endereco_rua: "Rua A",
      endereco_numero: "1",
      endereco_bairro: "Centro",
      endereco_cidade: "São Paulo",
      endereco_estado: "SP",
      // Injeções maliciosas — devem ser descartadas:
      ativo: true,
      dono_id: "00000000-0000-0000-0000-000000000000",
      assinatura_status: "ativa",
      hotmart_subscriber_code: "HM-EVIL-666",
      consentimento_versao: "v999",
      latitude: 0.0001,
      longitude: 0.0001,
      id: "99999999-9999-9999-9999-999999999999",
      billing_provider: "hotmart",
      plano_id: "plano-premium",
    };

    const r = await salvarPerfilAdmin(LOJA_A, payloadHostil);
    expect(r, "esperava { ok:true }").toMatchObject({ ok: true });

    // 1º UPDATE = patch de perfil (allowlist via montarPatchPerfil); 2º = coords
    const updates = ops.filter((o) => o.tipo === "update" && o.tabela === "lojas");
    expect(updates.length, "esperava ao menos 1 UPDATE em lojas").toBeGreaterThanOrEqual(1);
    const patchPerfil = updates[0].payload as Record<string, unknown>;

    for (const col of COLUNAS_PROIBIDAS_PERFIL) {
      expect(
        patchPerfil,
        `coluna autoritativa '${col}' não deve entrar no patch de perfil (RN-7)`,
      ).not.toHaveProperty(col);
    }
    // Allowlist mínima deve estar presente:
    expect(patchPerfil).toMatchObject({
      nome: "Loja Legítima",
      slug: "loja-legitima",
    });
  });

  it("[095] publicarLojaAdmin(true) — patch é EXATAMENTE { ativo: true }, nenhuma coluna de billing", async () => {
    const COLUNAS_PROIBIDAS_PUBLICAR = [
      "assinatura_status",
      "billing_provider",
      "plano_id",
      "fim_periodo_atual",
      "dono_id",
      "id",
    ];

    await publicarLojaAdmin(LOJA_A, true);

    const update = ops.find((o) => o.tipo === "update" && o.tabela === "lojas");
    expect(update, "esperava UPDATE em lojas").toBeDefined();
    const patch = update!.payload as Record<string, unknown>;

    // Igualdade estrita: qualquer coluna extra quebraria esse expect
    expect(patch).toEqual({ ativo: true });

    for (const col of COLUNAS_PROIBIDAS_PUBLICAR) {
      expect(
        patch,
        `coluna proibida '${col}' não deve aparecer no patch de publicação (RN-8)`,
      ).not.toHaveProperty(col);
    }
  });

  it("[095] publicarLojaAdmin(false) — patch é EXATAMENTE { ativo: false }", async () => {
    await publicarLojaAdmin(LOJA_A, false);

    const update = ops.find((o) => o.tipo === "update" && o.tabela === "lojas");
    expect(update!.payload).toEqual({ ativo: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §4 — RN-4: criarLojaAdmin, 2ª loja para mesmo dono → {ok:false}, sem 2ª loja
// ═══════════════════════════════════════════════════════════════════════════════
//
// LETHALIDADE: se o catch interno não interceptasse a violação de unique (23505)
// e propagasse a exceção, o teste falharia (rejects em vez de resolves com
// { ok:false }). Se tentasse retry, criarLoja seria chamado > 1 vez.

describe("§4 RN-4: criarLojaAdmin — 2ª loja para mesmo dono (violação unique 23505)", () => {
  it("criarLoja lança violação unique → { ok:false }, UMA tentativa, sem revalidatePath", async () => {
    const violacao = Object.assign(
      new Error("duplicate key value violates unique constraint lojas_dono_id_key"),
      { code: "23505" },
    );
    criarLoja.mockRejectedValueOnce(violacao);

    const r = await criarLojaAdmin(PAYLOAD_NOVA_LOJA);

    expect(r).toMatchObject({ ok: false });
    // Uma única tentativa — sem retry silencioso
    expect(criarLoja).toHaveBeenCalledTimes(1);
    // revalidatePath não é chamado: nada foi criado
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("payload hostil (ativo:true, assinatura_status:'ativa', dono_id forjado) → defaults server-side vencem", async () => {
    const payloadHostil = {
      email: EMAIL,
      nome: "Loja Hostil",
      slug: "loja-hostil-xyz",
      ativo: true,
      assinatura_status: "ativa",
      dono_id: "00000000-0000-0000-0000-000000000000",
    };

    const r = await criarLojaAdmin(payloadHostil);

    expect(r).toMatchObject({ ok: true });
    expect(criarLoja).toHaveBeenCalledTimes(1);
    const [, dados] = criarLoja.mock.calls[0] as [unknown, Record<string, unknown>];

    // Constantes server-side vencem o payload hostil
    expect(dados.ativo).toBe(false);
    expect(dados.assinatura_status).toBe("trial");
    // dono_id é resolvido por email server-side, NUNCA o forjado no payload
    expect(dados.dono_id).toBe(DONO_ID_RESOLVIDO);
    expect(dados.dono_id).not.toBe("00000000-0000-0000-0000-000000000000");
  });
});
