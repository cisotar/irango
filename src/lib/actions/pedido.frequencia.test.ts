// TDD RED-first — issue 321 (crítica: SIM): `criarPedido` recusa, ANTES da RPC,
// o item fora da frequência do produto ou da categoria e o item de categoria
// oculta. O cliente só manda `produto_id` + `quantidade`; frequência, categoria
// e `oculta` vêm do banco (seguranca.md §10).
//
// Autoridade: specs/frequencia-exibicao.md RN-1, RN-2, RN-3, RN-7, RN-8 ·
// plan/tecnico-frequencia-exibicao.md D8 (motivo ⇒ erro), D12 (encerrado ⇒
// ERRO_FORA_DA_JANELA), "Testes do P3" item 6.
//
// ⚠️ SEAM 321 → GREEN. O contrato que este RED impõe:
//   1. `criarPedido` lê `buscarCategorias(svc, dados.loja_id)` na MESMA onda
//      de leituras, no lugar de `buscarCardapiosComProdutos` (que passa a ter
//      ZERO chamadas — cardápio é função morta, S5);
//   2. o veredito sai de `avaliarFrequenciaNaLoja(produto, categoriasPorId,
//      agora, loja.timezone)`; `categoria_oculta` ⇒ ERRO_GENERICO; `encerrado`
//      e `fora_da_frequencia` ⇒ ERRO_FORA_DA_JANELA (literal inalterado);
//   3. `visibilidade` é ignorada: produto 'cardapio' sem vínculo e permanente
//      é VENDIDO.
//
// Mocks só de I/O (molde: pedido.vigencia-cardapio.test.ts). O mock de
// `queries/cardapios` continua existindo para (a) o código atual não quebrar
// antes do GREEN e (b) provar que ele NÃO é mais chamado.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Tables } from "@/lib/database.types";

vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/utils/rateLimit", () => ({
  extrairIp: () => "203.0.113.7",
  verificarRateLimit: vi.fn(async () => ({ permitido: true })),
}));

const fakeClient = { __fake: "service-client", rpc: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeClient,
}));

const buscarProdutosPorIds = vi.fn();
const buscarOpcionaisPorIds = vi.fn();
const buscarOpcionaisPorCategoria = vi.fn();
vi.mock("@/lib/supabase/queries/produtos", () => ({
  buscarProdutosPorIds: (...a: unknown[]) => buscarProdutosPorIds(...a),
  buscarOpcionaisPorIds: (...a: unknown[]) => buscarOpcionaisPorIds(...a),
  buscarOpcionaisPorCategoria: (...a: unknown[]) => buscarOpcionaisPorCategoria(...a),
}));

// Cardápio: função morta. O mock devolve o índice VAZIO (forma válida) para o
// código de hoje não lançar; a asserção é de ZERO chamadas depois do GREEN.
const buscarCardapiosComProdutos = vi.fn();
vi.mock("@/lib/supabase/queries/cardapios", () => ({
  buscarCardapiosComProdutos: (...a: unknown[]) => buscarCardapiosComProdutos(...a),
}));

// O SEAM da 321: a MESMA query de categorias da vitrine, sob service_role.
const buscarCategorias = vi.fn();
vi.mock("@/lib/supabase/queries/categorias", () => ({
  buscarCategorias: (...a: unknown[]) => buscarCategorias(...a),
}));

const buscarCupomPorCodigo = vi.fn();
const listarFormasPagamento = vi.fn();
const listarZonasComTaxas = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  buscarCupomPorCodigo: (...a: unknown[]) => buscarCupomPorCodigo(...a),
  listarFormasPagamento: (...a: unknown[]) => listarFormasPagamento(...a),
  listarZonasComTaxas: (...a: unknown[]) => listarZonasComTaxas(...a),
}));

const buscarLojaParaPedido = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaParaPedido: (...a: unknown[]) => buscarLojaParaPedido(...a),
}));

const buscarPedidoPorToken = vi.fn();
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  buscarPedidoPorToken: (...a: unknown[]) => buscarPedidoPorToken(...a),
}));

vi.mock("@/lib/utils/resolverCepServidor", () => ({
  resolverCepServidor: vi.fn(async () => ({ endereco: null, motivo: "transitorio" })),
}));
vi.mock("@/lib/actions/distanciaFrete", () => ({
  distanciaDaLojaAoCep: vi.fn(async () => ({ km: undefined, causa: "sem_cep" })),
}));

import { criarPedido } from "./pedido";

// ─────────────────────────────────────────────────────────── fixtures
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const FEIJOADA = "aaaaaaaa-0000-0000-0000-000000000321";
const COCA = "aaaaaaaa-0000-0000-0000-000000000322";
const CAT_PRATOS = "cccccccc-0000-0000-0000-000000000321";
const CAT_ALHEIA = "cccccccc-0000-0000-0000-0000000000b1";
const PEDIDO_ID = "99999999-0000-0000-0000-000000000321";
const TOKEN = "77777777-0000-0000-0000-000000000321";

/** Sáb 03/10/2026 12:00 em America/Sao_Paulo (UTC-3). */
const SABADO_MEIO_DIA = new Date("2026-10-03T15:00:00.000Z");
/** "Ontem" no dia civil da loja em relação a SABADO_MEIO_DIA. */
const ONTEM = "2026-10-02";

/** Literais de `pedido.ts` — byte a byte. */
const ERRO_FORA_DA_JANELA =
  "Um item do seu pedido saiu do cardápio deste horário. Revise o carrinho.";
const ERRO_GENERICO = "Não foi possível criar o pedido. Tente novamente.";

const HORARIO = { abre: "00:00", fecha: "23:59", ativo: true };
const HORARIOS_SEMPRE = {
  seg: HORARIO, ter: HORARIO, qua: HORARIO, qui: HORARIO,
  sex: HORARIO, sab: HORARIO, dom: HORARIO,
};

/** As 5 colunas de C1. Declaradas aqui: `database.types.ts` ainda não as tem. */
type Frequencia = {
  dias_semana: number[] | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
};
const PERMANENTE: Frequencia = {
  dias_semana: null,
  hora_inicio: null,
  hora_fim: null,
  periodo_inicio: null,
  periodo_fim: null,
};
type ProdutoRow = Tables<"produtos"> & Frequencia;
type CategoriaRow = Tables<"categorias"> & Frequencia & { oculta: boolean };

function produtoRow(over: Partial<ProdutoRow> = {}): ProdutoRow {
  return {
    id: FEIJOADA,
    loja_id: LOJA_A,
    categoria_id: CAT_PRATOS,
    nome: "Feijoada",
    descricao: null,
    preco: 45.0,
    disponivel: true,
    oculto: false,
    ordem: 0,
    foto_url: null,
    desconto_ativo: false,
    desconto_tipo: null,
    desconto_valor: null,
    desconto_inicio: null,
    desconto_fim: null,
    visibilidade: "menu",
    criado_em: "2026-01-01T00:00:00.000Z",
    atualizado_em: "2026-01-01T00:00:00.000Z",
    ...PERMANENTE,
    ...over,
  };
}

function categoriaRow(over: Partial<CategoriaRow> = {}): CategoriaRow {
  return {
    id: CAT_PRATOS,
    loja_id: LOJA_A,
    nome: "Pratos",
    ordem: 0,
    exibir_imagens: true,
    criado_em: "2026-01-01T00:00:00.000Z",
    oculta: false,
    ...PERMANENTE,
    ...over,
  };
}

function bancoBase() {
  buscarLojaParaPedido.mockResolvedValue({
    id: LOJA_A,
    nome: "Loja A",
    ativo: true,
    horarios: HORARIOS_SEMPRE,
    timezone: "America/Sao_Paulo",
    assinatura_status: "ativa",
    assinatura_fim_periodo: "2099-01-01T00:00:00.000Z",
    taxa_entrega_fora_zona: null,
    whatsapp: null,
    whatsapp_envio_automatico: false,
  });
  listarFormasPagamento.mockResolvedValue([
    { id: "f1", loja_id: LOJA_A, tipo: "pix", config: {} },
  ]);
  listarZonasComTaxas.mockResolvedValue([]);
  buscarOpcionaisPorIds.mockResolvedValue([]);
  buscarOpcionaisPorCategoria.mockResolvedValue({});
  buscarCupomPorCodigo.mockResolvedValue(null);
  buscarPedidoPorToken.mockResolvedValue(null);
  buscarCardapiosComProdutos.mockResolvedValue({ cardapios: [], vinculosPorProduto: new Map() });
  buscarCategorias.mockResolvedValue([categoriaRow()]);
  fakeClient.rpc.mockResolvedValue({
    data: [{ pedido_id: PEDIDO_ID, token_acesso: TOKEN }],
    error: null,
  });
}

function cenario(produtos: ProdutoRow[], categorias: CategoriaRow[] = [categoriaRow()]) {
  buscarProdutosPorIds.mockResolvedValue(produtos);
  buscarCategorias.mockResolvedValue(categorias);
}

function enviar(...produtoIds: string[]) {
  return criarPedido({
    loja_id: LOJA_A,
    tipo_entrega: "retirada",
    itens: produtoIds.map((produto_id) => ({ produto_id, quantidade: 1 })),
    forma_pagamento: "pix",
    nome_cliente: "Fulano",
  });
}

async function esperarRecusa(r: Awaited<ReturnType<typeof criarPedido>>, erro: string) {
  expect(r).toEqual({ erro });
  // "antes da RPC": nada em `pedidos`, nada em `itens_pedido`.
  expect(fakeClient.rpc).toHaveBeenCalledTimes(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient.rpc.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(SABADO_MEIO_DIA);
  bancoBase();
});

afterEach(() => {
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
describe("[321/RN-3] produto fora da própria frequência", () => {
  it("item só seg–sex num sábado ⇒ ERRO_FORA_DA_JANELA e RPC 0×", async () => {
    cenario([produtoRow({ dias_semana: [1, 2, 3, 4, 5] })]);
    await esperarRecusa(await enviar(FEIJOADA), ERRO_FORA_DA_JANELA);
  });

  it("item 18:00–22:00 às 12:00 ⇒ ERRO_FORA_DA_JANELA e RPC 0×", async () => {
    cenario([produtoRow({ hora_inicio: "18:00:00", hora_fim: "22:00:00" })]);
    await esperarRecusa(await enviar(FEIJOADA), ERRO_FORA_DA_JANELA);
  });

  it("o carrinho INTEIRO cai por um item só — o bom não é gravado sozinho", async () => {
    cenario([
      produtoRow({ dias_semana: [1] }),
      produtoRow({ id: COCA, nome: "Coca-Cola", preco: 10, categoria_id: null }),
    ]);
    await esperarRecusa(await enviar(COCA, FEIJOADA), ERRO_FORA_DA_JANELA);
  });
});

describe("[321/RN-1 + RN-2] categoria", () => {
  it("categoria fora da frequência (seg–sex) com item permanente ⇒ ERRO_FORA_DA_JANELA", async () => {
    cenario([produtoRow()], [categoriaRow({ dias_semana: [1, 2, 3, 4, 5] })]);
    await esperarRecusa(await enviar(FEIJOADA), ERRO_FORA_DA_JANELA);
  });

  it("categoria OCULTA ⇒ ERRO_GENERICO (não revela decisão editorial)", async () => {
    cenario([produtoRow()], [categoriaRow({ oculta: true })]);
    await esperarRecusa(await enviar(FEIJOADA), ERRO_GENERICO);
  });

  it("categoria AUSENTE do mapa (outra loja / removida) ⇒ ERRO_GENERICO (fail-closed)", async () => {
    cenario([produtoRow({ categoria_id: CAT_ALHEIA })], [categoriaRow()]);
    await esperarRecusa(await enviar(FEIJOADA), ERRO_GENERICO);
  });
});

describe("[321/RN-7] período encerrado (D12)", () => {
  it("produto com periodo_fim ONTEM no fuso da loja ⇒ ERRO_FORA_DA_JANELA", async () => {
    cenario([produtoRow({ periodo_inicio: "2026-09-01", periodo_fim: ONTEM })]);
    await esperarRecusa(await enviar(FEIJOADA), ERRO_FORA_DA_JANELA);
  });

  it("categoria encerrada, produto sem período ⇒ ERRO_FORA_DA_JANELA", async () => {
    cenario([produtoRow()], [categoriaRow({ periodo_inicio: "2026-09-01", periodo_fim: ONTEM })]);
    await esperarRecusa(await enviar(FEIJOADA), ERRO_FORA_DA_JANELA);
  });
});

describe("[321/RN-8] `dias_semana = []` é nunca", () => {
  it("produto `[]` ⇒ ERRO_FORA_DA_JANELA", async () => {
    cenario([produtoRow({ dias_semana: [] })]);
    await esperarRecusa(await enviar(FEIJOADA), ERRO_FORA_DA_JANELA);
  });

  it("categoria `[]` ⇒ ERRO_FORA_DA_JANELA", async () => {
    cenario([produtoRow()], [categoriaRow({ dias_semana: [] })]);
    await esperarRecusa(await enviar(FEIJOADA), ERRO_FORA_DA_JANELA);
  });

  it("contraprova: `dias_semana: null` (todo dia) ⇒ RPC 1×", async () => {
    cenario([produtoRow({ dias_semana: null })], [categoriaRow({ dias_semana: null })]);
    const r = await enviar(FEIJOADA);
    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("[321] dentro da janela: o pedido passa", () => {
  it("item só sáb 11:00–15:00, categoria seg–sáb, sábado 12:00 ⇒ RPC 1×", async () => {
    cenario(
      [produtoRow({ dias_semana: [6], hora_inicio: "11:00:00", hora_fim: "15:00:00" })],
      [categoriaRow({ dias_semana: [1, 2, 3, 4, 5, 6] })],
    );
    const r = await enviar(FEIJOADA);
    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("S5: produto `visibilidade: 'cardapio'` SEM vínculo e permanente ⇒ vendido", async () => {
    cenario([produtoRow({ visibilidade: "cardapio" })]);
    const r = await enviar(FEIJOADA);
    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("[321] a fonte da decisão é a categoria do banco, não o cardápio", () => {
  it("lê as categorias da loja do PAYLOAD JÁ VALIDADO, sob service_role", async () => {
    cenario([produtoRow()]);
    await enviar(FEIJOADA);
    expect(buscarCategorias).toHaveBeenCalledWith(fakeClient, LOJA_A);
  });

  it("buscarCardapiosComProdutos NÃO é chamada (cardápio é função morta)", async () => {
    cenario([produtoRow()]);
    await enviar(FEIJOADA);
    expect(buscarCardapiosComProdutos).toHaveBeenCalledTimes(0);
  });

  it("falha ao ler categorias é FAIL-CLOSED: pedido recusado, RPC 0×", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    buscarCategorias.mockRejectedValue(new Error("PostgREST 503"));
    // Antes do GREEN esta leitura nem acontece e o pedido passa — é o RED.
    const r = await enviar(FEIJOADA);
    expect(r).toEqual({ erro: ERRO_GENERICO });
    expect(fakeClient.rpc).toHaveBeenCalledTimes(0);
  });
});
