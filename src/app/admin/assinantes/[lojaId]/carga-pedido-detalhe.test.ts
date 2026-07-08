import { describe, it, expect, vi, beforeEach } from "vitest";

import type { VarianteImpressao } from "@/lib/utils/variantesHabilitadas";

/**
 * RED (fase /tdd) da issue 137 — extensão do loader para ESPELHAR o entitlement
 * de impressão da loja-ALVO (RN-M2 admin). Além dos invariantes da 140 abaixo, o
 * loader passa a devolver `modulosImpressao` + `nomeLoja`, lendo as flags da loja
 * via `buscarLojaAdminPorId(svc, lojaId)` ESCOPADA por `.eq("id", lojaId)` — o
 * `lojaId` já validado, NUNCA do payload nem a loja do próprio admin. A decisão
 * usa o MESMO util do painel (`variantesHabilitadas`, issue 130), fail-closed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RED (fase /tdd) da issue 140 — loader `carregarPedidoDetalheAdmin(lojaId, id)`
 * em `src/app/admin/assinantes/[lojaId]/carga-pedido-detalhe.ts` (NÃO existe
 * ainda; será criado na fase GREEN). Espelha `carga-pedidos.test.ts`: mocks de
 * `verificarAdminSaaS`, `createServiceClient`, `next/navigation.notFound` e da
 * query `buscarPedidoDaLoja(svc, lojaId, id)`; `validarLojaIdAdmin` (083) NÃO é
 * mockado — usa a implementação real (z.guid()).
 *
 * Invariantes provadas (mapa de enforcement do plano técnico da 140):
 *  RN-1 (fail-closed): `verificarAdminSaaS()` REJEITA → a exceção PROPAGA e
 *    NENHUMA leitura/elevação acontece (nem `createServiceClient`, nem
 *    `buscarPedidoDaLoja`, nem `notFound`). Não eleva a service_role.
 *  Validação 083: `lojaId` não-UUID → `notFound()` ANTES de provar admin ou ler.
 *  Barreira cross-loja / inexistente / id inválido: `buscarPedidoDaLoja` → `null`
 *    (o duplo `.eq("loja_id").eq("id")` da 130 não casa) → loader `notFound()`.
 *    Anti-enumeração: "de outra loja" e "não existe" são indistinguíveis.
 *  Ordem: `verificarAdminSaaS()` roda ANTES de `createServiceClient()`.
 *  Escopo: `buscarPedidoDaLoja` recebe `(svc, lojaId, id)` — o lojaId validado,
 *    nunca `OUTRA_LOJA`.
 *  Sucesso: retorna o pedido da query sem transformação.
 *  Erro de query propaga (não vira notFound silencioso).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";
const PEDIDO_ID = "33333333-3333-3333-3333-333333333333";

// Ordem das operações sensíveis, para provar RN-1 (admin antes de qualquer leitura).
const ordemChamadas: string[] = [];

// ── verificarAdminSaaS: default passa; negação via mockRejectedValueOnce. ──────
const verificarAdminSaaS = vi.fn(async () => {
  ordemChamadas.push("verificarAdminSaaS");
});
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. Registra ordem ao ser criado. ────
const clientServico = { marker: "svc-fake" };
const createServiceClient = vi.fn(() => {
  ordemChamadas.push("createServiceClient");
  return clientServico;
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── notFound: como o real do Next, LANÇA (interrompe o fluxo). ─────────────────
class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
const notFound = vi.fn(() => {
  ordemChamadas.push("notFound");
  throw new NotFoundError();
});
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
}));

// ── Query: buscarPedidoDaLoja(svc, lojaId, id). Capturamos os argumentos. ──────
const pedidoFake = {
  id: PEDIDO_ID,
  loja_id: LOJA_ID,
  status: "novo",
  total: 4200,
  nome_cliente: "Fulano de Tal",
  criado_em: "2026-07-03T00:00:00Z",
  itens_pedido: [{ id: "item-1", itens_pedido_opcionais: [] }],
};
const buscarPedidoDaLoja = vi.fn(
  async (
    _svc: unknown,
    _lojaId: string,
    _id: string,
  ): Promise<typeof pedidoFake | null> => pedidoFake,
);
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  buscarPedidoDaLoja: (svc: unknown, lojaId: string, id: string) =>
    buscarPedidoDaLoja(svc, lojaId, id),
}));

// ── Query de flags: buscarLojaAdminPorId(svc, lojaId) — leitura ESCOPADA da ────
// loja-ALVO (`.eq("id", lojaId)`, queries/lojas.ts). Capturamos os argumentos
// para provar que o escopo é o `lojaId` VALIDADO, nunca outra loja.
// Só o subconjunto de flags que `variantesHabilitadas` (130) consome + o nome.
type LojaAlvoFlags = {
  id: string;
  nome: string;
  modulo_impressao_a4: boolean | null;
  modulo_impressao_termica: boolean | null;
};
const lojaAlvoSoA4: LojaAlvoFlags = {
  id: LOJA_ID,
  nome: "Pizzaria Alvo",
  modulo_impressao_a4: true,
  modulo_impressao_termica: false,
};
const buscarLojaAdminPorId = vi.fn(
  async (_svc: unknown, _lojaId: string): Promise<LojaAlvoFlags | null> => {
    ordemChamadas.push("buscarLojaAdminPorId");
    return lojaAlvoSoA4;
  },
);
// `variantesHabilitadas` (util PURO, 130) NÃO é mockado: usa o MESMO caminho de
// decisão do painel (DRY / anti-drift). Só a leitura de I/O é mockada.
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaAdminPorId: (svc: unknown, lojaId: string) =>
    buscarLojaAdminPorId(svc, lojaId),
}));

// validarLojaIdAdmin (083) NÃO é mockado: usa a implementação real (z.guid()).

/**
 * Contrato-alvo da fase GREEN (issue 137): o loader passa a devolver, além do
 * pedido, o entitlement de impressão da loja-ALVO já COMPUTADO e o nome da loja
 * (p/ o recibo). Assinatura esperada:
 *   Promise<{ pedido: PedidoComItens; modulosImpressao: VarianteImpressao[]; nomeLoja: string }>
 * O `as unknown as` documenta esse contrato SEM depender do tipo atual (ainda
 * `Promise<PedidoComItens>`) — o RED é por ASSERÇÃO em runtime, não por type-check.
 */
type ResultadoLoaderAlvo = {
  pedido: unknown;
  modulosImpressao: VarianteImpressao[];
  nomeLoja: string;
};

import { carregarPedidoDetalheAdmin } from "./carga-pedido-detalhe";

async function carregar(
  lojaId: string,
  id: string,
): Promise<ResultadoLoaderAlvo> {
  return (await carregarPedidoDetalheAdmin(
    lojaId,
    id,
  )) as unknown as ResultadoLoaderAlvo;
}

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
});

describe("carregarPedidoDetalheAdmin — RN-1: admin não provado", () => {
  it("propaga a exceção e NÃO faz nenhuma leitura/elevação (fail-closed)", async () => {
    const falhaAdmin = new Error("acesso negado");
    verificarAdminSaaS.mockRejectedValueOnce(falhaAdmin);

    await expect(carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID)).rejects.toThrow(
      "acesso negado",
    );

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarPedidoDaLoja).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarPedidoDetalheAdmin — lojaId inválido (083)", () => {
  it("recusa não-UUID via notFound() SEM ler dados nem provar admin", async () => {
    await expect(
      carregarPedidoDetalheAdmin("nao-e-uuid", PEDIDO_ID),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
    // A validação de formato precede o guard de admin neste loader.
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarPedidoDaLoja).not.toHaveBeenCalled();
  });
});

describe("carregarPedidoDetalheAdmin — barreira cross-loja / não encontrado", () => {
  it("pedido de OUTRA loja (query → null) vira notFound() — não vaza que existe alhures", async () => {
    // `buscarPedidoDaLoja` faz o duplo `.eq("loja_id").eq("id")` (130): id válido
    // de outra loja não casa o loja_id → null. O loader traduz isso em notFound().
    buscarPedidoDaLoja.mockResolvedValueOnce(null);

    await expect(
      carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(buscarPedidoDaLoja).toHaveBeenCalledTimes(1);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("pedido inexistente / id inválido (query → null) vira notFound()", async () => {
    buscarPedidoDaLoja.mockResolvedValueOnce(null);

    await expect(
      carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalledTimes(1);
  });
});

describe("carregarPedidoDetalheAdmin — sucesso: ordem, escopo e retorno", () => {
  it("prova admin ANTES de elevar service_role", async () => {
    await carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID);

    expect(ordemChamadas[0]).toBe("verificarAdminSaaS");
    expect(ordemChamadas.indexOf("verificarAdminSaaS")).toBeLessThan(
      ordemChamadas.indexOf("createServiceClient"),
    );
  });

  it("a query é escopada pelo (svc, lojaId validado, id) — nunca outra loja", async () => {
    await carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID);

    expect(buscarPedidoDaLoja).toHaveBeenCalledTimes(1);
    const [svcRecebido, lojaIdRecebido, idRecebido] =
      buscarPedidoDaLoja.mock.calls[0]!;
    expect(svcRecebido).toBe(clientServico);
    expect(lojaIdRecebido).toBe(LOJA_ID);
    expect(lojaIdRecebido).not.toBe(OUTRA_LOJA);
    expect(idRecebido).toBe(PEDIDO_ID);
  });

  it("retorna o pedido da query mockada sem transformação (em resultado.pedido)", async () => {
    // Contrato 137: o pedido agora vem em `resultado.pedido`, ao lado do
    // entitlement. A referência é preservada (sem cópia/transformação).
    const resultado = await carregar(LOJA_ID, PEDIDO_ID);

    expect(resultado.pedido).toBe(pedidoFake);
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("carregarPedidoDetalheAdmin — falha na query propaga (não é engolida)", () => {
  it("erro de buscarPedidoDaLoja propaga ao chamador — não vira notFound silencioso", async () => {
    const falhaQuery = new Error("erro de conexão com o banco");
    buscarPedidoDaLoja.mockRejectedValueOnce(falhaQuery);

    await expect(carregarPedidoDetalheAdmin(LOJA_ID, PEDIDO_ID)).rejects.toThrow(
      "erro de conexão com o banco",
    );
    expect(notFound).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Issue 137 — ESPELHO do entitlement da loja-ALVO (RN-M2 admin).
// ═════════════════════════════════════════════════════════════════════════════

describe("carregarPedidoDetalheAdmin — RN-M2 admin: espelha o entitlement da loja-ALVO", () => {
  it("loja-alvo só com A4 → modulosImpressao = ['a4']", async () => {
    buscarLojaAdminPorId.mockResolvedValueOnce({
      id: LOJA_ID,
      nome: "Pizzaria Alvo",
      modulo_impressao_a4: true,
      modulo_impressao_termica: false,
    });

    const resultado = await carregar(LOJA_ID, PEDIDO_ID);

    expect(resultado.modulosImpressao).toEqual(["a4"]);
  });

  it("loja-alvo com módulo térmico → modulosImpressao inclui 'cozinha' e 'recibo' (mapa RN-M2)", async () => {
    buscarLojaAdminPorId.mockResolvedValueOnce({
      id: LOJA_ID,
      nome: "Pizzaria Alvo",
      modulo_impressao_a4: false,
      modulo_impressao_termica: true,
    });

    const resultado = await carregar(LOJA_ID, PEDIDO_ID);

    expect(resultado.modulosImpressao).toEqual(["cozinha", "recibo"]);
  });

  it("loja-alvo SEM módulo (flags false) → [] (fail-closed)", async () => {
    buscarLojaAdminPorId.mockResolvedValueOnce({
      id: LOJA_ID,
      nome: "Pizzaria Alvo",
      modulo_impressao_a4: false,
      modulo_impressao_termica: false,
    });

    const resultado = await carregar(LOJA_ID, PEDIDO_ID);

    expect(resultado.modulosImpressao).toEqual([]);
  });

  it("loja-alvo null (flag não lida) → [] e NÃO vira notFound — o pedido existe", async () => {
    // Fail-closed do issue 137: loja-alvo `null` → entitlement vazio, mas a page
    // ainda renderiza (o pedido foi encontrado). Não confundir com notFound.
    buscarLojaAdminPorId.mockResolvedValueOnce(null);

    const resultado = await carregar(LOJA_ID, PEDIDO_ID);

    expect(resultado.modulosImpressao).toEqual([]);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("nomeLoja repassado é o da loja-ALVO (parity com o painel: usado no recibo)", async () => {
    buscarLojaAdminPorId.mockResolvedValueOnce({
      id: LOJA_ID,
      nome: "Pizzaria Alvo",
      modulo_impressao_a4: true,
      modulo_impressao_termica: false,
    });

    const resultado = await carregar(LOJA_ID, PEDIDO_ID);

    expect(resultado.nomeLoja).toBe("Pizzaria Alvo");
  });
});

describe("carregarPedidoDetalheAdmin — RN-M1 + isolamento cross-tenant: escopo da leitura de flag", () => {
  it("lê as flags ESCOPADAS por (svc elevado, lojaId VALIDADO) — nunca outra loja, nunca a loja do admin", async () => {
    // O teste mais importante: a flag lida é a da loja-ALVO validada. Um bug de
    // escopo aqui espelharia o entitlement da loja errada (burla RN-M1).
    await carregar(LOJA_ID, PEDIDO_ID);

    expect(buscarLojaAdminPorId).toHaveBeenCalledTimes(1);
    const [svcRecebido, lojaIdRecebido] = buscarLojaAdminPorId.mock.calls[0]!;
    // Sob service_role (BYPASSRLS) o isolamento É o `.eq("id", lojaId)` com o id
    // validado — não a RLS. Logo o argumento tem de ser exatamente o lojaId validado.
    expect(lojaIdRecebido).toBe(LOJA_ID);
    expect(lojaIdRecebido).not.toBe(OUTRA_LOJA);
    // Elevada: o client é o service client já criado, não outro.
    expect(svcRecebido).toBe(clientServico);
  });
});

describe("carregarPedidoDetalheAdmin — ordem fail-closed do entitlement (validar → provar admin → elevar → ler)", () => {
  it("lê a flag DEPOIS de provar admin e de elevar a service_role", async () => {
    await carregar(LOJA_ID, PEDIDO_ID);

    const iAdmin = ordemChamadas.indexOf("verificarAdminSaaS");
    const iSvc = ordemChamadas.indexOf("createServiceClient");
    const iFlag = ordemChamadas.indexOf("buscarLojaAdminPorId");

    expect(iFlag).toBeGreaterThan(-1); // a flag CHEGA a ser lida no caminho feliz
    expect(iAdmin).toBeLessThan(iFlag); // admin provado ANTES de ler flag
    expect(iSvc).toBeLessThan(iFlag); // elevação ANTES de ler flag
  });

  it("prova de admin falha → NENHUMA flag é lida (buscarLojaAdminPorId não chamado)", async () => {
    // Guard de ordem para a GREEN: a leitura de flag não pode preceder a prova de
    // admin. (Companion do teste feliz acima — juntos travam a ordem inegociável.)
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(carregar(LOJA_ID, PEDIDO_ID)).rejects.toThrow("acesso negado");

    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
  });
});
