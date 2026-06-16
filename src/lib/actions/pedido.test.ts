import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

// Rate limit (issue 052): a action chama verificarRateLimit no topo via
// `await headers()`. rateLimit.ts é server-only (quebra no vitest) → mockamos
// para fail-open (permitido:true), e next/headers para não exigir request scope.
// O comportamento da trava é coberto em src/lib/utils/rateLimit.test.ts.
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: vi.fn(async () => ({ permitido: true })),
}));

/**
 * Fase RED (TDD) da issue 014 — Server Action `criarPedido` (camada 2:
 * unidade/orquestração com mocks de I/O). A action ainda é um STUB
 * (`throw 'TODO: GREEN'`), então TODA expectativa de comportamento abaixo
 * FALHA hoje — esse é o RED. A implementação é da fase GREEN.
 *
 * Foco (seguranca.md §10): ATAQUE de valor e recálculo autoritativo. O cliente
 * NUNCA define quanto paga. Provamos que:
 *  - o schema .strict() (022) rejeita qualquer campo monetário no payload ANTES
 *    de qualquer I/O (total/subtotal/preco mentidos nem chegam ao banco);
 *  - o valor passado à RPC `criar_pedido` vem do preço REAL do banco
 *    (buscarProdutosPorIds), não do payload;
 *  - produto de OUTRA loja / indisponível / inexistente → recusado;
 *  - loja inativa / fechada / assinatura inválida → recusado;
 *  - cupom esgotado na leitura → segue SEM desconto (não rejeita — D5);
 *  - sucesso → { pedidoId, token_acesso }; erro de banco → genérico, sem vazar.
 *
 * Padrão de mocks: igual a cupom.test.ts — service.ts é `server-only`, mockado;
 * cada query e a RPC são vi.fn() injetadas via vi.mock. NÃO testamos o banco
 * aqui (isso é rpc_criar_pedido.test.ts), e sim a ORQUESTRAÇÃO da action.
 */

// ─────────────────────────── mocks de I/O (server-only / queries / RPC)
const fakeClient = {
  __fake: "service-client",
  rpc: vi.fn(),
};
const createServiceClient = vi.fn(() => fakeClient);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaParaPedido = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaParaPedido: (...a: unknown[]) => buscarLojaParaPedido(...a),
}));

const buscarProdutosPorIds = vi.fn();
// [085] Leituras de opcionais do BANCO usadas pelo recálculo autoritativo:
//  - buscarOpcionaisPorIds(client, ids): linhas de `opcionais` por id, trazendo
//    loja_id / categoria_opcional_id / nome / preco / ativo (fonte de verdade do
//    preço e dos gates RN-O3/O5/O6). NOVA leitura esperada da action.
//  - buscarOpcionaisPorCategoria(client, categoriaIds) (081, existente): mapa
//    categoria_id(produto) → grupos; usado para validar RN-O4 (opcional permitido
//    para a categoria do produto). Já existe na query de produtos; a action o
//    reusa como conjunto de categoria_opcional_id permitidos por categoria.
const buscarOpcionaisPorIds = vi.fn();
const buscarOpcionaisPorCategoria = vi.fn();
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosPorIds: (...a: unknown[]) => buscarProdutosPorIds(...a),
  buscarOpcionaisPorIds: (...a: unknown[]) => buscarOpcionaisPorIds(...a),
  buscarOpcionaisPorCategoria: (...a: unknown[]) => buscarOpcionaisPorCategoria(...a),
}));

const listarZonasComTaxas = vi.fn();
const listarFormasPagamento = vi.fn();
const buscarCupomPorCodigo = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  listarZonasComTaxas: (...a: unknown[]) => listarZonasComTaxas(...a),
  listarFormasPagamento: (...a: unknown[]) => listarFormasPagamento(...a),
  buscarCupomPorCodigo: (...a: unknown[]) => buscarCupomPorCodigo(...a),
}));

// [064] reconciliarBairroCep é I/O (chama ViaCEP). Mockada — NÃO bater na rede
// nos testes de orquestração. Default (cenarioFeliz): reconcilia para o bairro
// declarado, isolando o teste do frete da política de fail-closed (testada à parte).
const reconciliarBairroCep = vi.fn();
vi.mock("@/lib/utils/reconciliarBairroCep", () => ({
  reconciliarBairroCep: (...a: unknown[]) => reconciliarBairroCep(...a),
}));

import * as rateLimitMod from "@/lib/utils/rateLimit";
import { criarPedido } from "./pedido";

// ─────────────────────────── fixtures
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const LOJA_B = "22222222-2222-2222-2222-222222222222";
const PROD_1 = "aaaaaaaa-0000-0000-0000-000000000001"; // R$ 25,00 na loja A
const PROD_B = "bbbbbbbb-0000-0000-0000-000000000001"; // produto da loja B
const CUPOM_ID = "cccccccc-0000-0000-0000-000000000001";
// [085] opcionais — fixtures
const CAT_PROD_PAES = "dddddddd-0000-0000-0000-000000000001"; // categoria de PRODUTO do PROD_1
const CAT_OPC_LATICINIOS = "eeeeeeee-0000-0000-0000-000000000001"; // categoria de OPCIONAL associada a Pães
const CAT_OPC_EMBALAGENS = "eeeeeeee-0000-0000-0000-000000000002"; // categoria de OPCIONAL NÃO associada a Pães
const OPC_BRIE = "ffffffff-0000-0000-0000-000000000001"; // Brie extra +8,00 (loja A, Laticínios, ativo)
const OPC_GELEIA = "ffffffff-0000-0000-0000-000000000002"; // Geleia +6,00 (loja A, Laticínios, ativo)
const OPC_INATIVO = "ffffffff-0000-0000-0000-000000000003"; // ativo=false
const OPC_OUTRA_LOJA = "ffffffff-0000-0000-0000-000000000004"; // loja_id = LOJA_B
const OPC_CAT_NAO_ASSOC = "ffffffff-0000-0000-0000-000000000005"; // categoria_opcional não associada à categoria do produto

// Horários abertos 24h todos os dias (loja sempre aberta nos testes felizes).
const HORARIO_ABERTO = {
  abre: "00:00",
  fecha: "23:59",
  ativo: true,
};
const HORARIOS_SEMPRE = {
  seg: HORARIO_ABERTO,
  ter: HORARIO_ABERTO,
  qua: HORARIO_ABERTO,
  qui: HORARIO_ABERTO,
  sex: HORARIO_ABERTO,
  sab: HORARIO_ABERTO,
  dom: HORARIO_ABERTO,
};
const HORARIOS_FECHADO = {
  seg: { abre: "00:00", fecha: "00:00", ativo: false },
  ter: { abre: "00:00", fecha: "00:00", ativo: false },
  qua: { abre: "00:00", fecha: "00:00", ativo: false },
  qui: { abre: "00:00", fecha: "00:00", ativo: false },
  sex: { abre: "00:00", fecha: "00:00", ativo: false },
  sab: { abre: "00:00", fecha: "00:00", ativo: false },
  dom: { abre: "00:00", fecha: "00:00", ativo: false },
};

function lojaRow(over: Record<string, unknown> = {}) {
  return {
    id: LOJA_A,
    nome: "Loja A",
    ativo: true,
    horarios: HORARIOS_SEMPRE,
    timezone: "America/Sao_Paulo",
    assinatura_status: "ativa",
    assinatura_fim_periodo: "2099-01-01T00:00:00.000Z",
    // [071] fallback fora-de-zona (RN-C4). null = entrega indisponível fora de zona.
    taxa_entrega_fora_zona: null,
    ...over,
  };
}

function produtoRow(over: Partial<Tables<"produtos">> = {}): Tables<"produtos"> {
  return {
    id: PROD_1,
    loja_id: LOJA_A,
    categoria_id: null,
    nome: "Pizza",
    descricao: null,
    preco: 25.0,
    disponivel: true,
    ordem: 0,
    foto_url: null,
    criado_em: "2026-01-01T00:00:00.000Z",
    atualizado_em: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function cupomRow(over: Partial<Tables<"cupons">> = {}): Tables<"cupons"> {
  return {
    id: CUPOM_ID,
    loja_id: LOJA_A,
    codigo: "PROMO5",
    tipo: "fixo",
    valor: 5.0,
    pedido_minimo: 0,
    usos_maximos: null,
    usos_contagem: 0,
    expira_em: null,
    ativo: true,
    criado_em: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Linha de `opcionais` como vinda do banco (fonte de verdade do preço/loja/ativo). */
function opcionalRow(
  over: Partial<Tables<"opcionais">> = {},
): Pick<Tables<"opcionais">, "id" | "loja_id" | "categoria_opcional_id" | "nome" | "preco" | "ativo"> {
  return {
    id: OPC_BRIE,
    loja_id: LOJA_A,
    categoria_opcional_id: CAT_OPC_LATICINIOS,
    nome: "Brie extra",
    preco: 8.0,
    ativo: true,
    ...over,
  };
}

/**
 * Mapa de RN-O4 (081): categoria de PRODUTO → grupos de opcional permitidos.
 * A action usa as `categoriaOpcionalId` dos grupos como o conjunto permitido.
 * Por padrão, a categoria do PROD_1 (Pães) permite Laticínios — NÃO Embalagens.
 */
function permitidosPaesLaticinios() {
  return {
    [CAT_PROD_PAES]: [
      {
        categoriaOpcionalId: CAT_OPC_LATICINIOS,
        categoriaOpcionalNome: "Laticínios",
        ordem: 0,
        opcionais: [],
      },
    ],
  };
}

// Zona que atende o CEP do payload com taxa 5.00.
function zonasComFrete5() {
  return [
    {
      id: "z1",
      loja_id: LOJA_A,
      nome: "Centro",
      tipo: "bairro",
      ativo: true,
      taxa: { taxa: 5.0, pedido_minimo_gratis: null, raio_max_km: null },
      bairros: [{ nome: "Centro" }],
    },
  ];
}

function formasComPix() {
  return [{ id: "f1", loja_id: LOJA_A, tipo: "pix", config: {} }];
}

/** Payload limpo (só intenção) — base dos testes; o cliente NÃO manda valores.
 * [069] tipo_entrega='entrega' é obrigatório no schema; endereco_entrega obrigatório
 * para entrega (refine condicional). Builder default usa entrega c/ endereço. */
function payloadBase(over: Record<string, unknown> = {}) {
  return {
    loja_id: LOJA_A,
    tipo_entrega: "entrega",
    itens: [{ produto_id: PROD_1, quantidade: 2 }],
    endereco_entrega: { cep: "01000-000", rua: "Rua X", numero: "10", bairro: "Centro" },
    forma_pagamento: "pix",
    nome_cliente: "Fulano",
    ...over,
  };
}

/** Configura todos os mocks para o caminho feliz (loja A, aberta, ativa). */
function cenarioFeliz() {
  buscarLojaParaPedido.mockResolvedValue(lojaRow());
  listarFormasPagamento.mockResolvedValue(formasComPix());
  buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
  listarZonasComTaxas.mockResolvedValue(zonasComFrete5());
  buscarCupomPorCodigo.mockResolvedValue(null);
  // [064] por padrão a reconciliação SUCEDE devolvendo o bairro declarado
  // (CEP↔bairro coerentes) — assim o frete dos testes felizes é determinístico.
  reconciliarBairroCep.mockResolvedValue({ bairroCanonico: "Centro", reconciliado: true });
  // [085] sem opcionais por padrão: nenhuma leitura de opcional retorna nada.
  buscarOpcionaisPorIds.mockResolvedValue([]);
  buscarOpcionaisPorCategoria.mockResolvedValue({});
  fakeClient.rpc.mockResolvedValue({
    data: [{ pedido_id: "ped-1", token_acesso: "tok-1" }],
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient.rpc.mockReset();
});

describe("criarPedido (Server Action — recálculo autoritativo §10)", () => {
  // ─────────────────────── caminho feliz / contrato de retorno
  it("sucesso: retorna { pedidoId, token_acesso } vindos da RPC", async () => {
    cenarioFeliz();
    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ pedidoId: "ped-1", token_acesso: "tok-1" });
  });

  // ─────────────────────── ATAQUE DE VALOR (§10) — núcleo crítico
  it("ATAQUE: payload com total:0.01 / subtotal / preco mentidos → schema .strict() rejeita ANTES de qualquer I/O", async () => {
    cenarioFeliz();
    const r = await criarPedido(
      payloadBase({ total: 0.01, subtotal: 0.01, itens: [{ produto_id: PROD_1, quantidade: 2, preco: 0.01 }] }),
    );
    expect(r).toEqual({ erro: expect.any(String) });
    // nenhuma query nem RPC foi tocada — barrado na borda Zod
    expect(buscarLojaParaPedido).not.toHaveBeenCalled();
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("ATAQUE: o valor passado à RPC vem do PREÇO DO BANCO, não do payload", async () => {
    // banco diz 25,00; 2 unidades → subtotal 50; frete 5; sem cupom → total 55.
    cenarioFeliz();
    await criarPedido(payloadBase()); // payload SÓ tem produto_id + quantidade

    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = fakeClient.rpc.mock.calls[0] as [string, Record<string, number>];
    expect(fn).toBe("criar_pedido");
    expect(args.p_subtotal).toBe(50.0); // 25 (banco) * 2
    expect(args.p_taxa_entrega).toBe(5.0);
    expect(args.p_desconto).toBe(0);
    expect(args.p_total).toBe(55.0);
  });

  it("ATAQUE: itens passados à RPC carregam SNAPSHOT (nome/preco do banco), não do cliente", async () => {
    cenarioFeliz();
    await criarPedido(payloadBase());
    const args = fakeClient.rpc.mock.calls[0][1] as { p_itens: { nome: string; preco: number; quantidade: number }[] };
    expect(args.p_itens).toEqual([{ produto_id: PROD_1, nome: "Pizza", preco: 25.0, quantidade: 2 }]);
  });

  // ─────────────────────── produto: outra loja / indisponível / inexistente
  it("ATAQUE: produto de OUTRA loja no payload → recusado (não chama a RPC)", async () => {
    buscarLojaParaPedido.mockResolvedValue(lojaRow());
    listarFormasPagamento.mockResolvedValue(formasComPix());
    listarZonasComTaxas.mockResolvedValue(zonasComFrete5());
    buscarCupomPorCodigo.mockResolvedValue(null);
    // produto pertence à loja B, mas o payload pede pela loja A
    buscarProdutosPorIds.mockResolvedValue([produtoRow({ id: PROD_B, loja_id: LOJA_B })]);

    const r = await criarPedido(payloadBase({ itens: [{ produto_id: PROD_B, quantidade: 1 }] }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("produto indisponível → recusado (não chama a RPC)", async () => {
    buscarLojaParaPedido.mockResolvedValue(lojaRow());
    listarFormasPagamento.mockResolvedValue(formasComPix());
    listarZonasComTaxas.mockResolvedValue(zonasComFrete5());
    buscarCupomPorCodigo.mockResolvedValue(null);
    buscarProdutosPorIds.mockResolvedValue([produtoRow({ disponivel: false })]);

    const r = await criarPedido(payloadBase({ itens: [{ produto_id: PROD_1, quantidade: 1 }] }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("produto inexistente (faltando no resultado) → recusado", async () => {
    buscarLojaParaPedido.mockResolvedValue(lojaRow());
    listarFormasPagamento.mockResolvedValue(formasComPix());
    listarZonasComTaxas.mockResolvedValue(zonasComFrete5());
    buscarCupomPorCodigo.mockResolvedValue(null);
    buscarProdutosPorIds.mockResolvedValue([]); // pediu PROD_1, banco não retornou

    const r = await criarPedido(payloadBase({ itens: [{ produto_id: PROD_1, quantidade: 1 }] }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  // ─────────────────────── quantidade adulterada → barrada pelo schema
  it("ATAQUE: quantidade 0 → schema rejeita SEM I/O", async () => {
    cenarioFeliz();
    const r = await criarPedido(payloadBase({ itens: [{ produto_id: PROD_1, quantidade: 0 }] }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
  });

  it("ATAQUE: quantidade negativa → schema rejeita SEM I/O", async () => {
    cenarioFeliz();
    const r = await criarPedido(payloadBase({ itens: [{ produto_id: PROD_1, quantidade: -3 }] }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
  });

  it("ATAQUE: quantidade > 99 → schema rejeita SEM I/O", async () => {
    cenarioFeliz();
    const r = await criarPedido(payloadBase({ itens: [{ produto_id: PROD_1, quantidade: 100 }] }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
  });

  // ─────────────────────── cupom esgotado na leitura → segue SEM desconto (D5)
  it("cupom esgotado na leitura → recalcula SEM desconto e PROSSEGUE (não rejeita — D5)", async () => {
    buscarLojaParaPedido.mockResolvedValue(lojaRow());
    listarFormasPagamento.mockResolvedValue(formasComPix());
    listarZonasComTaxas.mockResolvedValue(zonasComFrete5());
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    // cupom já esgotado: usos_contagem === usos_maximos
    buscarCupomPorCodigo.mockResolvedValue(cupomRow({ usos_maximos: 1, usos_contagem: 1 }));
    fakeClient.rpc.mockResolvedValue({ data: [{ pedido_id: "ped-1", token_acesso: "tok-1" }], error: null });

    const r = await criarPedido(payloadBase({ codigo_cupom: "PROMO5" }));
    expect(r).toEqual({ pedidoId: "ped-1", token_acesso: "tok-1" }); // pedido NÃO rejeitado
    const args = fakeClient.rpc.mock.calls[0][1] as { p_desconto: number; p_total: number; p_cupom_id: string | null };
    expect(args.p_desconto).toBe(0); // sem desconto
    expect(args.p_total).toBe(55.0); // 50 subtotal + 5 frete, sem desconto
  });

  // ─────────────────────── loja inativa / fechada / assinatura inválida
  it("loja inativa → recusado (não chama a RPC)", async () => {
    cenarioFeliz();
    buscarLojaParaPedido.mockResolvedValue(lojaRow({ ativo: false }));
    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("loja fechada (lojaAberta=false) → recusado com mensagem específica (RN-09)", async () => {
    cenarioFeliz();
    buscarLojaParaPedido.mockResolvedValue(lojaRow({ horarios: HORARIOS_FECHADO }));
    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ erro: expect.stringContaining("fechada") });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("loja com assinatura inativa (suspensa) → recusado (assinaturaPermiteAcesso=false)", async () => {
    cenarioFeliz();
    buscarLojaParaPedido.mockResolvedValue(
      lojaRow({ assinatura_status: "suspensa", assinatura_fim_periodo: "2020-01-01T00:00:00.000Z" }),
    );
    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  // ─────────────────────── forma de pagamento não configurada
  it("forma de pagamento não aceita pela loja → recusado", async () => {
    cenarioFeliz();
    listarFormasPagamento.mockResolvedValue([{ id: "f1", loja_id: LOJA_A, tipo: "dinheiro", config: {} }]);
    const r = await criarPedido(payloadBase({ forma_pagamento: "pix" }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  // ─────────────────────── CEP fora de zona
  it("CEP fora de qualquer zona (atendido=false) → recusado", async () => {
    cenarioFeliz();
    listarZonasComTaxas.mockResolvedValue([]); // nenhuma zona atende
    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  // ─────────────────────── [071] tipo_entrega / troco_para / fallback fora-de-zona
  it("[071] entrega: RPC recebe p_tipo_entrega='entrega'", async () => {
    cenarioFeliz();
    await criarPedido(payloadBase());
    const args = fakeClient.rpc.mock.calls[0][1] as { p_tipo_entrega: string };
    expect(args.p_tipo_entrega).toBe("entrega");
  });

  it("[071] RN-C2 retirada com endereço enviado → p_taxa_entrega=0 e p_tipo_entrega='retirada'", async () => {
    cenarioFeliz();
    // Zona atenderia com frete 5, mas retirada FORÇA frete 0 e ignora endereço.
    await criarPedido(
      payloadBase({ tipo_entrega: "retirada", endereco_entrega: undefined }),
    );
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
    const args = fakeClient.rpc.mock.calls[0][1] as {
      p_tipo_entrega: string;
      p_taxa_entrega: number;
      p_total: number;
    };
    expect(args.p_tipo_entrega).toBe("retirada");
    expect(args.p_taxa_entrega).toBe(0);
    expect(args.p_total).toBe(50.0); // subtotal 50, sem frete
  });

  it("retirada NÃO persiste endereço — minimização PII/LGPD (achado auditoria)", async () => {
    cenarioFeliz();
    // Cliente envia endereço mesmo em retirada; servidor descarta (grava null).
    await criarPedido(
      payloadBase({
        tipo_entrega: "retirada",
        endereco_entrega: { cep: "01000-000", rua: "Rua X", numero: "10", bairro: "Centro" },
      }),
    );
    const args = fakeClient.rpc.mock.calls[0][1] as { p_endereco_entrega: unknown };
    expect(args.p_endereco_entrega).toBeNull();
  });

  it("[071] RN-C4 entrega fora de zona com taxa_entrega_fora_zona=8 → frete 8", async () => {
    buscarLojaParaPedido.mockResolvedValue(lojaRow({ taxa_entrega_fora_zona: 8.0 }));
    listarFormasPagamento.mockResolvedValue(formasComPix());
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    listarZonasComTaxas.mockResolvedValue([]); // nenhuma zona casa
    buscarCupomPorCodigo.mockResolvedValue(null);
    fakeClient.rpc.mockResolvedValue({
      data: [{ pedido_id: "ped-1", token_acesso: "tok-1" }],
      error: null,
    });

    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ pedidoId: "ped-1", token_acesso: "tok-1" });
    const args = fakeClient.rpc.mock.calls[0][1] as { p_taxa_entrega: number; p_total: number };
    expect(args.p_taxa_entrega).toBe(8.0);
    expect(args.p_total).toBe(58.0); // 50 subtotal + 8 fallback
  });

  it("[071] RN-C4 entrega fora de zona SEM fallback (taxa_entrega_fora_zona=null) → recusado", async () => {
    buscarLojaParaPedido.mockResolvedValue(lojaRow({ taxa_entrega_fora_zona: null }));
    listarFormasPagamento.mockResolvedValue(formasComPix());
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    listarZonasComTaxas.mockResolvedValue([]); // nenhuma zona casa
    buscarCupomPorCodigo.mockResolvedValue(null);

    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  // ─────────────────────── [064] FAIL-CLOSED da reconciliação CEP↔bairro
  it("[064] ATAQUE subpagamento: ViaCEP indisponível (reconciliado:false) → bairro declarado DESCARTADO, NÃO casa zona barata → fallback fora-de-zona", async () => {
    // Loja tem zona 'Centro' (R$5) E fallback fora-de-zona (R$8). O cliente
    // declara bairro 'Centro' (barato). ViaCEP cai → não reconcilia. O bairro
    // declarado NÃO pode selecionar a zona barata: cai no fallback (mais caro).
    buscarLojaParaPedido.mockResolvedValue(lojaRow({ taxa_entrega_fora_zona: 8.0 }));
    listarFormasPagamento.mockResolvedValue(formasComPix());
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    listarZonasComTaxas.mockResolvedValue(zonasComFrete5()); // zona 'Centro' R$5 existe
    buscarCupomPorCodigo.mockResolvedValue(null);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    // ViaCEP down → fail-closed.
    reconciliarBairroCep.mockResolvedValue({ bairroCanonico: null, reconciliado: false });
    fakeClient.rpc.mockResolvedValue({
      data: [{ pedido_id: "ped-1", token_acesso: "tok-1" }],
      error: null,
    });

    await criarPedido(payloadBase()); // declara bairro 'Centro'
    const args = fakeClient.rpc.mock.calls[0][1] as { p_taxa_entrega: number };
    // NÃO pode ser 5 (zona barata declarada): tem que ser 8 (fallback mais caro).
    expect(args.p_taxa_entrega).toBe(8.0);
  });

  it("[064] FAIL-CLOSED sem fallback: ViaCEP indisponível + sem taxa_entrega_fora_zona → entrega indisponível (não cobra zona barata declarada)", async () => {
    buscarLojaParaPedido.mockResolvedValue(lojaRow({ taxa_entrega_fora_zona: null }));
    listarFormasPagamento.mockResolvedValue(formasComPix());
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    listarZonasComTaxas.mockResolvedValue(zonasComFrete5());
    buscarCupomPorCodigo.mockResolvedValue(null);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    reconciliarBairroCep.mockResolvedValue({ bairroCanonico: null, reconciliado: false });

    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("[064] divergência: bairro declarado barato MAS CEP é de zona cara → cobra a zona do CEP (canônico vence)", async () => {
    // Zonas: 'Centro' R$5 e 'Jardins' R$12. Cliente declara 'Centro' mas o CEP
    // resolve para 'Jardins' → cobra R$12.
    buscarLojaParaPedido.mockResolvedValue(lojaRow());
    listarFormasPagamento.mockResolvedValue(formasComPix());
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    listarZonasComTaxas.mockResolvedValue([
      ...zonasComFrete5(),
      {
        id: "z2",
        loja_id: LOJA_A,
        nome: "Jardins",
        tipo: "bairro",
        ativo: true,
        taxa: { taxa: 12.0, pedido_minimo_gratis: null, raio_max_km: null },
        bairros: [{ nome: "Jardins" }],
      },
    ]);
    buscarCupomPorCodigo.mockResolvedValue(null);
    buscarOpcionaisPorIds.mockResolvedValue([]);
    buscarOpcionaisPorCategoria.mockResolvedValue({});
    reconciliarBairroCep.mockResolvedValue({ bairroCanonico: "Jardins", reconciliado: true });
    fakeClient.rpc.mockResolvedValue({
      data: [{ pedido_id: "ped-1", token_acesso: "tok-1" }],
      error: null,
    });

    await criarPedido(payloadBase({
      endereco_entrega: { cep: "01400-000", rua: "R", numero: "1", bairro: "Centro" },
    }));
    const args = fakeClient.rpc.mock.calls[0][1] as { p_taxa_entrega: number };
    expect(args.p_taxa_entrega).toBe(12.0); // zona do CEP, não a declarada
  });

  it("[071] RN-C3 troco_para persiste APENAS quando forma_pagamento='dinheiro'", async () => {
    cenarioFeliz();
    listarFormasPagamento.mockResolvedValue([{ id: "f1", loja_id: LOJA_A, tipo: "dinheiro", config: {} }]);
    await criarPedido(payloadBase({ forma_pagamento: "dinheiro", troco_para: 100 }));
    const args = fakeClient.rpc.mock.calls[0][1] as { p_troco_para: number | null; p_total: number };
    expect(args.p_troco_para).toBe(100);
    // RN-C3: troco é informativo — NÃO altera o total (50 subtotal + 5 frete).
    expect(args.p_total).toBe(55.0);
  });

  it("[071] RN-C3 troco_para é IGNORADO (null) quando pagamento não é dinheiro", async () => {
    cenarioFeliz(); // forma pix
    // mesmo que o cliente envie troco_para num pagamento pix, servidor grava null.
    await criarPedido(payloadBase({ forma_pagamento: "pix", troco_para: 100 }));
    const args = fakeClient.rpc.mock.calls[0][1] as { p_troco_para: number | null };
    expect(args.p_troco_para).toBeNull();
  });

  // ─────────────────────── tratamento de erro (§14)
  it("erro da RPC → mensagem genérica, log [criarPedido], sem vazar detalhe do banco", async () => {
    cenarioFeliz();
    fakeClient.rpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate key value violates unique constraint pedidos_pkey senha XYZ" },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ erro: expect.any(String) });
    expect(JSON.stringify(r)).not.toContain("constraint");
    expect(JSON.stringify(r)).not.toContain("senha");
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBe("[criarPedido]");
    spy.mockRestore();
  });

  it("exceção inesperada (query lança) → mensagem genérica, sem vazar e.message", async () => {
    buscarLojaParaPedido.mockRejectedValue(new Error("connection refused: senha postgres XYZ"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarPedido(payloadBase());
    expect(r).toEqual({ erro: expect.any(String) });
    expect(JSON.stringify(r)).not.toContain("senha");
    spy.mockRestore();
  });

  // ─────────────────────── validação Zod roda ANTES de qualquer I/O
  it("loja_id não-UUID → schema rejeita SEM tocar no banco", async () => {
    cenarioFeliz();
    const r = await criarPedido(payloadBase({ loja_id: "não-uuid" }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(buscarLojaParaPedido).not.toHaveBeenCalled();
  });

  it("carrinho vazio (itens:[]) → schema rejeita SEM I/O", async () => {
    cenarioFeliz();
    const r = await criarPedido(payloadBase({ itens: [] }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // [085] OPCIONAIS — recálculo autoritativo + snapshot (spec RN-O1..O6)
  //
  // Contrato esperado da action (fase GREEN):
  //  - lê os opcionais escolhidos do BANCO por id (buscarOpcionaisPorIds): nunca
  //    confia em preço do cliente (RN-O1/O2);
  //  - RN-O3: opcional cujo loja_id ≠ pedido.loja_id → recusa o pedido inteiro;
  //  - RN-O4: opcional cuja categoria_opcional_id NÃO está nos grupos permitidos
  //    da categoria do produto (buscarOpcionaisPorCategoria) → recusa;
  //  - RN-O5: opcional ausente do retorno do banco (inexistente) ou ativo=false → recusa;
  //  - RN-O1 (090): subtotal_item = (produto.preco × qtd_item) + Σ op.preco × op.qtd,
  //    opcional por linha (não multiplica pela qtd do produto); preços do banco;
  //    p_total = subtotal + frete − desconto;
  //  - RN-O6: cada item passado à RPC carrega seus opcionais com snapshot do banco
  //    (nome_snapshot / preco_snapshot / quantidade).
  //  Shape esperado de p_itens com opcionais (a verificar no contrato GREEN):
  //    { produto_id, nome, preco, quantidade,
  //      opcionais: [{ opcional_id, nome_snapshot, preco_snapshot, quantidade }] }
  // ═══════════════════════════════════════════════════════════════════════════

  /** Caminho feliz com PROD_1 categorizado (Pães) e dois opcionais válidos. */
  function cenarioOpcionaisValidos() {
    cenarioFeliz();
    buscarProdutosPorIds.mockResolvedValue([produtoRow({ categoria_id: CAT_PROD_PAES })]);
    buscarOpcionaisPorCategoria.mockResolvedValue(permitidosPaesLaticinios());
    buscarOpcionaisPorIds.mockResolvedValue([
      opcionalRow({ id: OPC_BRIE, nome: "Brie extra", preco: 8.0 }),
      opcionalRow({ id: OPC_GELEIA, nome: "Geleia", preco: 6.0 }),
    ]);
  }

  // 1) RN-O1 — recálculo COM opcionais usando preço do banco
  it("[085] RN-O1: item com 2 opcionais → p_total = (produto × qtd_item) + Σ op×qtd + frete − desconto (preços do BANCO)", async () => {
    cenarioOpcionaisValidos();
    // 090: opcional por linha. produto 25 × 2 = 50; + (brie 8×1 + geleia 6×2 = 20)
    // uma vez = 70 subtotal; + 5 frete = 75
    await criarPedido(
      payloadBase({
        itens: [
          {
            produto_id: PROD_1,
            quantidade: 2,
            opcionais: [
              { opcional_id: OPC_BRIE, quantidade: 1 },
              { opcional_id: OPC_GELEIA, quantidade: 2 },
            ],
          },
        ],
      }),
    );
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
    const args = fakeClient.rpc.mock.calls[0][1] as {
      p_subtotal: number;
      p_total: number;
    };
    expect(args.p_subtotal).toBe(70.0);
    expect(args.p_total).toBe(75.0);
  });

  // 2) RN-O3 — opcional de OUTRA loja → recusa o pedido inteiro
  it("[085] RN-O3: opcional de OUTRA loja → pedido recusado integralmente (não chama a RPC)", async () => {
    cenarioOpcionaisValidos();
    buscarOpcionaisPorIds.mockResolvedValue([
      opcionalRow({ id: OPC_OUTRA_LOJA, loja_id: LOJA_B }),
    ]);
    const r = await criarPedido(
      payloadBase({
        itens: [{ produto_id: PROD_1, quantidade: 1, opcionais: [{ opcional_id: OPC_OUTRA_LOJA, quantidade: 1 }] }],
      }),
    );
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  // 3) RN-O4 — opcional cuja categoria NÃO está associada à categoria do produto → recusa
  it("[085] RN-O4: opcional de categoria NÃO associada à categoria do produto → recusado", async () => {
    cenarioOpcionaisValidos();
    // opcional existe, é da loja A e ativo, mas pertence a Embalagens — que NÃO está
    // nos grupos permitidos da categoria do produto (só Laticínios).
    buscarOpcionaisPorIds.mockResolvedValue([
      opcionalRow({ id: OPC_CAT_NAO_ASSOC, categoria_opcional_id: CAT_OPC_EMBALAGENS }),
    ]);
    const r = await criarPedido(
      payloadBase({
        itens: [{ produto_id: PROD_1, quantidade: 1, opcionais: [{ opcional_id: OPC_CAT_NAO_ASSOC, quantidade: 1 }] }],
      }),
    );
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  // 4) RN-O5 — opcional inativo / inexistente → recusa
  it("[085] RN-O5: opcional ativo=false → recusado (não chama a RPC)", async () => {
    cenarioOpcionaisValidos();
    buscarOpcionaisPorIds.mockResolvedValue([
      opcionalRow({ id: OPC_INATIVO, ativo: false }),
    ]);
    const r = await criarPedido(
      payloadBase({
        itens: [{ produto_id: PROD_1, quantidade: 1, opcionais: [{ opcional_id: OPC_INATIVO, quantidade: 1 }] }],
      }),
    );
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("[085] RN-O5: opcional inexistente (faltando no retorno do banco) → recusado", async () => {
    cenarioOpcionaisValidos();
    buscarOpcionaisPorIds.mockResolvedValue([]); // pediu OPC_BRIE, banco não retornou
    const r = await criarPedido(
      payloadBase({
        itens: [{ produto_id: PROD_1, quantidade: 1, opcionais: [{ opcional_id: OPC_BRIE, quantidade: 1 }] }],
      }),
    );
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  // 5) RN-O1/O2 — preço adulterado no payload é IGNORADO (servidor usa o banco)
  it("[085] RN-O1/O2: preço adulterado no opcional é ignorado — cálculo usa o preço do BANCO", async () => {
    cenarioOpcionaisValidos();
    buscarOpcionaisPorIds.mockResolvedValue([
      opcionalRow({ id: OPC_BRIE, nome: "Brie extra", preco: 8.0 }),
    ]);
    // O .strict() do 083 já barraria { preco } no opcional; aqui garantimos que,
    // mesmo se vazasse, o servidor recalcula do banco. Enviamos só ids+qtd válidos
    // e provamos que o total reflete o preço REAL (8,00), não um payload de 0,01.
    await criarPedido(
      payloadBase({
        itens: [{ produto_id: PROD_1, quantidade: 1, opcionais: [{ opcional_id: OPC_BRIE, quantidade: 1 }] }],
      }),
    );
    const args = fakeClient.rpc.mock.calls[0][1] as { p_subtotal: number; p_total: number };
    // produto 25 + brie 8 = 33 subtotal; + 5 frete = 38 — preço do banco, não 0,01.
    expect(args.p_subtotal).toBe(33.0);
    expect(args.p_total).toBe(38.0);
  });

  // 6) RN-O6 — snapshot do banco repassado à RPC por item
  it("[085] RN-O6: a action passa à RPC, por item, opcionais com nome_snapshot/preco_snapshot do BANCO + quantidade", async () => {
    cenarioOpcionaisValidos();
    await criarPedido(
      payloadBase({
        itens: [
          {
            produto_id: PROD_1,
            quantidade: 2,
            opcionais: [
              { opcional_id: OPC_BRIE, quantidade: 1 },
              { opcional_id: OPC_GELEIA, quantidade: 2 },
            ],
          },
        ],
      }),
    );
    const args = fakeClient.rpc.mock.calls[0][1] as {
      p_itens: {
        produto_id: string;
        nome: string;
        preco: number;
        quantidade: number;
        opcionais: { opcional_id: string; nome_snapshot: string; preco_snapshot: number; quantidade: number }[];
      }[];
    };
    expect(args.p_itens).toEqual([
      {
        produto_id: PROD_1,
        nome: "Pizza",
        preco: 25.0,
        quantidade: 2,
        opcionais: [
          { opcional_id: OPC_BRIE, nome_snapshot: "Brie extra", preco_snapshot: 8.0, quantidade: 1 },
          { opcional_id: OPC_GELEIA, nome_snapshot: "Geleia", preco_snapshot: 6.0, quantidade: 2 },
        ],
      },
    ]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // [063] idempotency_key — propagação da action para a RPC
  //
  // Prova que a action:
  //  - passa p_idempotency_key ao RPC quando o payload traz a chave;
  //  - passa p_idempotency_key: null quando o payload NÃO traz a chave.
  //
  // Crítico: um bug de propagação (ex. esquecer o campo no objeto de args)
  // faria a RPC nunca deduplicar, mesmo com schema e RPC corretos.
  // ═══════════════════════════════════════════════════════════════════════════

  const CHAVE_IDEMP = "77777777-7777-4777-8777-777777777777";

  it("[063-A1] action propaga idempotency_key do payload como p_idempotency_key na chamada da RPC", async () => {
    cenarioFeliz();
    await criarPedido(payloadBase({ idempotency_key: CHAVE_IDEMP }));

    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = fakeClient.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("criar_pedido");
    expect(args.p_idempotency_key).toBe(CHAVE_IDEMP);
  });

  it("[063-A2] action passa p_idempotency_key: null à RPC quando payload não traz idempotency_key", async () => {
    cenarioFeliz();
    // payload sem idempotency_key (campo opcional ausente)
    await criarPedido(payloadBase());

    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
    const args = fakeClient.rpc.mock.calls[0][1] as Record<string, unknown>;
    // 'p_idempotency_key' deve existir na chamada com valor null (não omitido),
    // para que o parâmetro DEFAULT NULL da RPC funcione corretamente.
    expect(Object.prototype.hasOwnProperty.call(args, "p_idempotency_key")).toBe(true);
    expect(args.p_idempotency_key).toBeNull();
  });

  it("[063-A3] idempotency_key inválido (não-uuid) → schema rejeita; p_idempotency_key nunca chega à RPC", async () => {
    cenarioFeliz();
    const r = await criarPedido(payloadBase({ idempotency_key: "nao-e-uuid" }));
    expect(r).toEqual({ erro: expect.any(String) });
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });
});

// ── Borda (issue 052): mensagem genérica quando rate limit bloqueia criarPedido ─
// criarPedido é a action mais crítica financeiramente. Prova que quando o guard
// dispara (permitido:false) o erro retornado é genérico e nenhum I/O de banco
// ocorre — o atacante não ganha informação nem consome recursos.
describe("criarPedido — rate limit bloqueado (issue 052)", () => {
  it("IP bloqueado → { erro:'Muitas tentativas...' } SEM consultar loja, produto ou RPC", async () => {
    vi.mocked(rateLimitMod.verificarRateLimit).mockResolvedValueOnce({ permitido: false });

    const r = await criarPedido({
      loja_id: LOJA_A,
      itens: [{ produto_id: PROD_1, quantidade: 1 }],
      nome_cliente: "Atacante",
      forma_pagamento: "pix",
      tipo_entrega: "retirada",
    });

    expect(r).toEqual({
      erro: "Muitas tentativas. Tente novamente em alguns instantes.",
    });
    // Nenhum I/O deve ocorrer quando o guard bloqueia.
    expect(buscarLojaParaPedido).not.toHaveBeenCalled();
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });
});
