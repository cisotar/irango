import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";

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
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosPorIds: (...a: unknown[]) => buscarProdutosPorIds(...a),
}));

const listarZonasComTaxas = vi.fn();
const listarFormasPagamento = vi.fn();
const buscarCupomPorCodigo = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  listarZonasComTaxas: (...a: unknown[]) => listarZonasComTaxas(...a),
  listarFormasPagamento: (...a: unknown[]) => listarFormasPagamento(...a),
  buscarCupomPorCodigo: (...a: unknown[]) => buscarCupomPorCodigo(...a),
}));

import { criarPedido } from "./pedido";

// ─────────────────────────── fixtures
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const LOJA_B = "22222222-2222-2222-2222-222222222222";
const PROD_1 = "aaaaaaaa-0000-0000-0000-000000000001"; // R$ 25,00 na loja A
const PROD_2 = "aaaaaaaa-0000-0000-0000-000000000002"; // R$ 10,00 na loja A
const PROD_B = "bbbbbbbb-0000-0000-0000-000000000001"; // produto da loja B
const CUPOM_ID = "cccccccc-0000-0000-0000-000000000001";

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
});
