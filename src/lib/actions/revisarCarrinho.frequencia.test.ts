// TDD RED-first — issue 321 (crítica: SIM): `revisarCarrinhoAction` (preview)
// marca `fora_da_janela` nos MESMOS casos em que `criarPedido` (autoritativo)
// recusa — categoria oculta, período encerrado (produto e categoria), fora da
// frequência e `dias_semana = []` — e tira a linha do subtotal.
//
// Autoridade: specs/frequencia-exibicao.md RN-2, RN-3, RN-7, RN-8 ·
// seguranca.md §10-A (paridade preview ↔ autoritativo) ·
// plan/tecnico-frequencia-exibicao.md D12 ("a revisão marca `encerrado` como
// `fora_da_janela`"), "Testes do P3" item 7.
//
// ⚠️ SEAM 321 → GREEN: `revisarCarrinhoAction` troca `buscarCardapiosComProdutos`
// por `buscarCategorias(svc, dados.loja_id)` e o veredito por
// `avaliarFrequenciaNaLoja`; `compravel = produto.disponivel && av.disponivel`;
// o motivo continua `"fora_da_janela"` para os três motivos (sem motivo novo).
//
// Cada caso de bloqueio também passa pelo autoritativo: o preview NÃO pode ser
// mais generoso que `criarPedido` (caso-espelho anti-drift).

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

const buscarCardapiosComProdutos = vi.fn();
vi.mock("@/lib/supabase/queries/cardapios", () => ({
  buscarCardapiosComProdutos: (...a: unknown[]) => buscarCardapiosComProdutos(...a),
}));

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

import { revisarCarrinhoAction } from "./revisarCarrinho";
import { criarPedido } from "./pedido";

// ─────────────────────────────────────────────────────────── fixtures
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const FEIJOADA = "aaaaaaaa-0000-0000-0000-000000000321";
const COCA = "aaaaaaaa-0000-0000-0000-000000000322";
const CAT_PRATOS = "cccccccc-0000-0000-0000-000000000321";
const PEDIDO_ID = "99999999-0000-0000-0000-000000000321";
const TOKEN = "77777777-0000-0000-0000-000000000321";

/** Sáb 03/10/2026 12:00 em America/Sao_Paulo. */
const SABADO_MEIO_DIA = new Date("2026-10-03T15:00:00.000Z");
const ONTEM = "2026-10-02";

const HORARIO = { abre: "00:00", fecha: "23:59", ativo: true };
const HORARIOS_SEMPRE = {
  seg: HORARIO, ter: HORARIO, qua: HORARIO, qui: HORARIO,
  sex: HORARIO, sab: HORARIO, dom: HORARIO,
};

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

/** Feijoada R$ 45 na categoria Pratos. */
function feijoada(over: Partial<ProdutoRow> = {}): ProdutoRow {
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

/** Coca R$ 10, sem categoria e permanente: a linha que SEMPRE passa. */
const COCA_ROW = feijoada({ id: COCA, nome: "Coca-Cola", preco: 10.0, categoria_id: null });

function pratos(over: Partial<CategoriaRow> = {}): CategoriaRow {
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
  buscarCategorias.mockResolvedValue([pratos()]);
  fakeClient.rpc.mockResolvedValue({
    data: [{ pedido_id: PEDIDO_ID, token_acesso: TOKEN }],
    error: null,
  });
}

const CARRINHO = [
  { produto_id: COCA, quantidade: 2 },
  { produto_id: FEIJOADA, quantidade: 1 },
];

function preview() {
  return revisarCarrinhoAction({ loja_id: LOJA_A, itens: CARRINHO });
}

function autoritativo() {
  return criarPedido({
    loja_id: LOJA_A,
    tipo_entrega: "retirada",
    itens: CARRINHO,
    forma_pagamento: "pix",
    nome_cliente: "Fulano",
  });
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
// P6 (volta da auditoria, item 2): a categoria OCULTA saiu desta tabela. A
// revisão não a trata mais como linha bloqueada (que devolvia o PREÇO do
// produto): recusa com a genérica, igual ao gate de `oculto` e ao `criarPedido`.
// Ver o bloco "[P6-2]" abaixo.
const BLOQUEIOS: [string, ProdutoRow, CategoriaRow][] = [
  ["produto ENCERRADO (periodo_fim ontem)", feijoada({ periodo_fim: ONTEM }), pratos()],
  ["categoria ENCERRADA (produto sem período)", feijoada(), pratos({ periodo_fim: ONTEM })],
  ["produto FORA da frequência (seg–sex no sábado)", feijoada({ dias_semana: [1, 2, 3, 4, 5] }), pratos()],
  ["categoria FORA da frequência (18:00–22:00 às 12:00)", feijoada(), pratos({ hora_inicio: "18:00:00", hora_fim: "22:00:00" })],
  ["produto `[]` (RN-8)", feijoada({ dias_semana: [] }), pratos()],
  ["categoria `[]` (RN-8)", feijoada(), pratos({ dias_semana: [] })],
];

describe("[321] a revisão bloqueia a linha nos mesmos casos do pedido", () => {
  for (const [nome, produto, categoria] of BLOQUEIOS) {
    it(`${nome} ⇒ compravel false, 'fora_da_janela', ok true, fora do subtotal`, async () => {
      buscarProdutosPorIds.mockResolvedValue([COCA_ROW, produto]);
      buscarCategorias.mockResolvedValue([categoria]);

      const r = await preview();

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const linha = r.itens.find((l) => l.produto_id === FEIJOADA);
      // A linha NUNCA some da lista: omitir alteraria o carrinho por omissão.
      expect(linha).toBeDefined();
      expect(linha?.compravel).toBe(false);
      expect(linha?.motivoNaoCompravel).toBe("fora_da_janela");
      // Só a Coca (2 × R$ 10) entra no subtotal.
      expect(r.subtotal).toBe(20);
      const coca = r.itens.find((l) => l.produto_id === COCA);
      expect(coca?.compravel).toBe(true);
    });

    it(`${nome} ⇒ espelho: criarPedido recusa e a RPC não é chamada`, async () => {
      buscarProdutosPorIds.mockResolvedValue([COCA_ROW, produto]);
      buscarCategorias.mockResolvedValue([categoria]);

      const pedido = await autoritativo();

      expect("erro" in pedido).toBe(true);
      expect(fakeClient.rpc).toHaveBeenCalledTimes(0);
    });
  }
});

describe("[321] dentro da janela a linha é comprável nos dois caminhos", () => {
  it("item só sáb 11:00–15:00 no sábado 12:00 ⇒ compravel true e subtotal inteiro", async () => {
    buscarProdutosPorIds.mockResolvedValue([
      COCA_ROW,
      feijoada({ dias_semana: [6], hora_inicio: "11:00:00", hora_fim: "15:00:00" }),
    ]);
    buscarCategorias.mockResolvedValue([pratos({ dias_semana: [1, 2, 3, 4, 5, 6] })]);

    const r = await preview();
    const pedido = await autoritativo();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const linha = r.itens.find((l) => l.produto_id === FEIJOADA);
    expect(linha?.compravel).toBe(true);
    expect(linha?.motivoNaoCompravel).toBeNull();
    expect(r.subtotal).toBe(65);
    expect("erro" in pedido).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("[321] a revisão lê categorias, não cardápios", () => {
  it("buscarCategorias(fakeClient, LOJA_A) e buscarCardapiosComProdutos 0×", async () => {
    buscarProdutosPorIds.mockResolvedValue([COCA_ROW, feijoada()]);

    await preview();

    expect(buscarCategorias).toHaveBeenCalledWith(fakeClient, LOJA_A);
    expect(buscarCardapiosComProdutos).toHaveBeenCalledTimes(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P6 (volta da auditoria, item 2, BAIXO): produto de categoria OCULTA na
// revisão devolvia a linha com `preco`/`precoEfetivo`, revelando o preço de um
// item que o lojista escondeu. Passa a ser o gate de `oculto`: `ok: false` com a
// genérica, antes de montar qualquer linha — o mesmo que `criarPedido` faz
// (`ERRO_GENERICO`). Categoria AUSENTE do mapa (outra loja, removida) é o mesmo
// motivo `categoria_oculta` (fail-closed) e cai no mesmo lugar.
const MSG_REVISAO_GENERICA = "Não foi possível revisar o carrinho. Tente novamente.";

describe("[P6-2] categoria oculta na revisão ⇒ recusa genérica, sem preço", () => {
  it.each([
    ["categoria OCULTA", () => buscarCategorias.mockResolvedValue([pratos({ oculta: true })])],
    ["categoria AUSENTE do mapa", () => buscarCategorias.mockResolvedValue([])],
  ])("%s ⇒ ok false, mensagem genérica, nenhum preço no retorno", async (_nome, prepara) => {
    buscarProdutosPorIds.mockResolvedValue([COCA_ROW, feijoada()]);
    prepara();

    const r = await preview();

    expect(r).toEqual({ ok: false, mensagem: MSG_REVISAO_GENERICA });
    const json = JSON.stringify(r);
    expect(json).not.toContain("preco");
    expect(json).not.toContain("45");
  });

  it("espelho: criarPedido recusa com ERRO_GENERICO e a RPC não é chamada", async () => {
    buscarProdutosPorIds.mockResolvedValue([COCA_ROW, feijoada()]);
    buscarCategorias.mockResolvedValue([pratos({ oculta: true })]);

    const pedido = await autoritativo();

    expect(pedido).toEqual({ erro: "Não foi possível criar o pedido. Tente novamente." });
    expect(fakeClient.rpc).toHaveBeenCalledTimes(0);
  });
});
