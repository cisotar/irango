// TDD RED-first — issue 252 (crítica): `revisarCarrinhoAction` ganha vigência,
// e o PREVIEW passa a dar o MESMO veredito que o autoritativo.
//
// Autoridade: specs/cardapio-sazonal.md · RN-06 (a mesma função pura nos três
// consumidores) · RN-08 (a recusa do servidor) · RN-13/D14 (o produto exclusivo
// que sumiu da vitrine mas está no carrinho de alguém) · seguranca.md §10-A.
//
// Este arquivo corre colado na issue 249 pelo mesmo motivo que 228/229 correram
// coladas na onda 1: a paridade só é demonstrável quando os DOIS lados existem.
// Ele alimenta as duas Server Actions com EXATAMENTE as mesmas linhas de banco e
// o MESMO `agora`, e compara o veredito.
//
// ⚠️ SEAM 252 → GREEN. O contrato que este RED impõe:
//   1. `revisarCarrinhoAction` chama `buscarCardapiosComProdutos(svc, dados.loja_id)`
//      na MESMA onda de leituras — a query da 249, não uma segunda com outro filtro;
//   2. `LinhaRevisada` ganha `compravel: boolean` e
//      `motivoNaoCompravel: MotivoNaoCompravel | null`, derivados de
//      `avaliarVigenciaDoProduto`. NENHUM campo de rótulo: o texto do "volta em"
//      é da issue 254, e o item de temporada encerrada não tem volta a prometer;
//   3. item NÃO ENCONTRADO no banco vira linha BLOQUEADA — some da conta, nunca
//      da lista (omitir seria alterar o carrinho do cliente por omissão);
//   4. `produto_id` de OUTRA LOJA continua derrubando a revisão inteira
//      (`ok: false`) — ele NÃO pode ser rebaixado a linha bloqueada, ou a revisão
//      vira oráculo de existência de id do tenant vizinho (§6).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Tables } from "@/lib/database.types";
import type { CardapioVigencia } from "@/lib/utils/vigenciaCardapio";
import type { MotivoNaoCompravel } from "@/lib/utils/catalogoVitrine";
import type { LinhaRevisada } from "./revisarCarrinho-contrato";

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
const LOJA_B = "22222222-2222-2222-2222-222222222222";
const SOPA = "aaaaaaaa-0000-0000-0000-000000000011";
const COCA = "aaaaaaaa-0000-0000-0000-000000000012";
const FANTASMA = "aaaaaaaa-0000-0000-0000-00000000dead";
const PRODUTO_DA_LOJA_B = "aaaaaaaa-0000-0000-0000-0000000000b1";
const CARD_INVERNO = "bbbbbbbb-0000-0000-0000-000000000001";
const PEDIDO_ID = "99999999-0000-0000-0000-000000000001";
const TOKEN = "77777777-0000-0000-0000-000000000009";

/** Cenário 6 da spec: dom 20/12/2026 12:00 em America/Sao_Paulo. */
const AGORA = new Date("2026-12-20T15:00:00.000Z");

/** A recusa genérica da revisão, byte a byte (`revisarCarrinho.ts`). */
const FRAGMENTO_RECUSA = "Não foi possível revisar o carrinho";

const HORARIO = { abre: "00:00", fecha: "23:59", ativo: true };
const HORARIOS_SEMPRE = {
  seg: HORARIO, ter: HORARIO, qua: HORARIO, qui: HORARIO,
  sex: HORARIO, sab: HORARIO, dom: HORARIO,
};

/** A linha que a 252 promete. Declarada AQUI (e não em
 *  `revisarCarrinho-contrato.ts`) para o RED não tocar produção: é isto que a
 *  fase GREEN precisa acrescentar ao contrato. */
type LinhaComVigencia = LinhaRevisada & {
  compravel: boolean;
  motivoNaoCompravel: MotivoNaoCompravel | null;
};

function produtoRow(over: Partial<Tables<"produtos">> = {}): Tables<"produtos"> {
  return {
    id: COCA,
    loja_id: LOJA_A,
    categoria_id: null,
    nome: "Coca-Cola 2L",
    descricao: null,
    preco: 10.0,
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
    ...over,
  };
}

const SOPA_ROW = produtoRow({
  id: SOPA,
  nome: "Sopa de cebola",
  preco: 30.0,
  visibilidade: "cardapio",
});

function cardapio(over: Partial<CardapioVigencia> = {}): CardapioVigencia & { ordem: number } {
  return {
    id: CARD_INVERNO,
    nome: "Cardápio de Inverno",
    ativo: true,
    modo: "prazo_fixo",
    dias_semana: null,
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    prazo_inicio: "2026-06-21T03:00:00.000Z",
    prazo_fim: "2026-09-22T03:00:00.000Z",
    ordem: 0,
    ...over,
  };
}

const INVERNO_ABERTO = cardapio({
  prazo_inicio: "2026-12-01T03:00:00.000Z",
  prazo_fim: "2027-01-05T03:00:00.000Z",
});

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
  fakeClient.rpc.mockResolvedValue({
    data: [{ pedido_id: PEDIDO_ID, token_acesso: TOKEN }],
    error: null,
  });
}

function cardapiosDoBanco(
  porProduto: Record<string, (CardapioVigencia & { ordem: number })[]>,
) {
  const todos = [...new Set(Object.values(porProduto).flat())];
  // [273] O índice passa a ser de VÍNCULOS. Sem dias do item, o veredito é
  // byte a byte o de 249/252 — é a forma de 100% das linhas no deploy da 272.
  buscarCardapiosComProdutos.mockResolvedValue({
    cardapios: todos,
    vinculosPorProduto: new Map(
      Object.entries(porProduto).map(([id, lista]) => [
        id,
        lista.map((cardapio) => ({ cardapio, dias_semana: null })),
      ]),
    ),
  });
}

type Item = { produto_id: string; quantidade: number };

async function preview(itens: Item[]) {
  return revisarCarrinhoAction({ loja_id: LOJA_A, itens });
}

async function autoritativo(itens: Item[]) {
  return criarPedido({
    loja_id: LOJA_A,
    tipo_entrega: "retirada",
    itens,
    forma_pagamento: "pix",
    nome_cliente: "Fulano",
  });
}

/** O CONJUNTO que a revisão marcou como bloqueado — a metade esquerda da
 *  paridade de RN-11/§10-A. */
function bloqueados(r: Awaited<ReturnType<typeof preview>>): string[] {
  if (!r.ok) throw new Error(`a revisão recusou o carrinho inteiro: ${r.mensagem}`);
  return (r.itens as LinhaComVigencia[])
    .filter((l) => !l.compravel)
    .map((l) => l.produto_id)
    .sort();
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient.rpc.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  bancoBase();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("[252/§10-A] mesmo carrinho, mesmo `agora` ⇒ mesmo veredito", () => {
  const CARRINHO = [
    { produto_id: COCA, quantidade: 2 },
    { produto_id: SOPA, quantidade: 1 },
  ];

  it("temporada ENCERRADA: a revisão bloqueia a sopa e o pedido inteiro é recusado", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow(), SOPA_ROW]);
    cardapiosDoBanco({ [SOPA]: [cardapio()] });

    const r = await preview(CARRINHO);
    const pedido = await autoritativo(CARRINHO);

    // O preview NÃO é mais generoso que o autoritativo: o que ele bloqueia é
    // exatamente o que faz `criarPedido` recusar.
    expect(bloqueados(r)).toEqual([SOPA]);
    expect("erro" in pedido).toBe(true);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("temporada VIGENTE: a revisão não bloqueia nada e o pedido é aceito", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow(), SOPA_ROW]);
    cardapiosDoBanco({ [SOPA]: [INVERNO_ABERTO] });

    const r = await preview(CARRINHO);
    const pedido = await autoritativo(CARRINHO);

    // E não é mais SEVERO: preview que bloqueia o que o pedido aceita trava o
    // cliente sem motivo.
    expect(bloqueados(r)).toEqual([]);
    expect("erro" in pedido).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("o preview lê os cardápios pela MESMA query da 249, na MESMA loja", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow(), SOPA_ROW]);
    cardapiosDoBanco({ [SOPA]: [INVERNO_ABERTO] });

    await preview(CARRINHO);

    expect(buscarCardapiosComProdutos).toHaveBeenCalledWith(fakeClient, LOJA_A);
  });

  it("produto 'menu' dentro de cardápio fechado: comprável nos DOIS caminhos (D14)", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    cardapiosDoBanco({ [COCA]: [cardapio()] });

    const so_coca = [{ produto_id: COCA, quantidade: 1 }];
    const r = await preview(so_coca);
    const pedido = await autoritativo(so_coca);

    expect(bloqueados(r)).toEqual([]);
    expect("erro" in pedido).toBe(false);
  });
});

describe("[252/RN-13+D14] o item de temporada encerrada", () => {
  it("volta BLOQUEADO, com motivo 'fora_da_janela' e SEM rótulo de volta", async () => {
    buscarProdutosPorIds.mockResolvedValue([SOPA_ROW]);
    cardapiosDoBanco({ [SOPA]: [cardapio()] });

    const r = await preview([{ produto_id: SOPA, quantidade: 1 }]);
    if (!r.ok) throw new Error(r.mensagem);

    const linha = (r.itens as LinhaComVigencia[]).find((l) => l.produto_id === SOPA);
    expect(linha).toBeDefined();
    expect(linha?.compravel).toBe(false);
    expect(linha?.motivoNaoCompravel).toBe("fora_da_janela");
    // Sem próxima abertura não há data a prometer: o rótulo NÃO existe no
    // contrato da revisão (a frase genérica é da UI, issue 262).
    expect(
      (linha as unknown as Record<string, unknown>)?.rotuloVigencia ?? null,
    ).toBeNull();
  });

  it("o produto 'cardapio' órfão (sumido da vitrine) NÃO some da revisão", async () => {
    buscarProdutosPorIds.mockResolvedValue([SOPA_ROW]);
    cardapiosDoBanco({});

    const r = await preview([{ produto_id: SOPA, quantidade: 1 }]);
    if (!r.ok) throw new Error(r.mensagem);

    expect(r.itens).toHaveLength(1);
    expect((r.itens as LinhaComVigencia[])[0].compravel).toBe(false);
  });
});

describe("[252] item que a revisão não encontra no banco", () => {
  it("volta BLOQUEADO, não some da lista", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    cardapiosDoBanco({});

    const r = await preview([
      { produto_id: COCA, quantidade: 1 },
      { produto_id: FANTASMA, quantidade: 3 },
    ]);
    if (!r.ok) throw new Error(r.mensagem);

    // Omitir seria alterar o carrinho do cliente por omissão.
    expect(r.itens.map((l) => l.produto_id).sort()).toEqual([COCA, FANTASMA].sort());
    const fantasma = (r.itens as LinhaComVigencia[]).find((l) => l.produto_id === FANTASMA);
    expect(fantasma?.compravel).toBe(false);
    expect(fantasma?.motivoNaoCompravel).not.toBeNull();
    // Bloqueado não entra na conta: R$ 10,00 da Coca e nada do fantasma.
    expect(r.subtotal).toBe(10);
  });

  it("o autoritativo recusa o MESMO carrinho — nada é gravado", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    cardapiosDoBanco({});

    const pedido = await autoritativo([
      { produto_id: COCA, quantidade: 1 },
      { produto_id: FANTASMA, quantidade: 3 },
    ]);

    expect("erro" in pedido).toBe(true);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });
});

describe("[252/§6] produto_id de OUTRA LOJA", () => {
  // Guarda de não-regressão, verde por construção HOJE e frágil amanhã: a
  // mudança nº 3 desta issue ("inexistente vira linha bloqueada") convida a
  // fundir o `produto == null` com o `loja_id !== dados.loja_id` num ramo só —
  // e aí o cross-loja seria rebaixado a linha bloqueada, confirmando ao
  // atacante que o id EXISTE em outra loja. É isso que estas asserções travam.
  it("derruba a revisão inteira com o fragmento genérico, e NÃO vira linha bloqueada", async () => {
    buscarProdutosPorIds.mockResolvedValue([
      produtoRow({ id: PRODUTO_DA_LOJA_B, loja_id: LOJA_B, nome: "Prato da Loja B" }),
    ]);
    cardapiosDoBanco({});

    const r = await preview([{ produto_id: PRODUTO_DA_LOJA_B, quantidade: 1 }]);

    expect(r.ok).toBe(false);
    expect((r as { ok: false; mensagem: string }).mensagem).toContain(FRAGMENTO_RECUSA);
    // Nem linha, nem subtotal, nem nome: nada do tenant vizinho atravessa.
    expect("itens" in r).toBe(false);
  });

  it("o autoritativo recusa o mesmo id e não chama a RPC", async () => {
    buscarProdutosPorIds.mockResolvedValue([
      produtoRow({ id: PRODUTO_DA_LOJA_B, loja_id: LOJA_B, nome: "Prato da Loja B" }),
    ]);
    cardapiosDoBanco({});

    const pedido = await autoritativo([{ produto_id: PRODUTO_DA_LOJA_B, quantidade: 1 }]);

    expect("erro" in pedido).toBe(true);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [273] RED — o preview do checkout marca a mesma linha que o autoritativo.
//
// Autoridade: specs/vigencia-por-item-do-cardapio.md RN-01/RN-02/RN-04 ·
// seguranca.md §10-A (paridade preview ↔ autoritativo).
//
// ⚠️ SEAM 273 → GREEN: `revisarCarrinho.ts` passa
// `cardapios.vinculosPorProduto.get(produto.id) ?? []` à MESMA
// `avaliarVigenciaDoProduto` de `criarPedido`. Nenhum motivo novo em
// `MotivoNaoCompravel`: item fora do dia produz `"fora_da_janela"`.
// ═══════════════════════════════════════════════════════════════════════════

/** Seg 21/12/2026, 12:00 -03. */
const SEGUNDA = new Date("2026-12-21T15:00:00.000Z");
/** Qua 23/12/2026, 12:00 -03. */
const QUARTA = new Date("2026-12-23T15:00:00.000Z");

const FEIJOADA = "aaaaaaaa-0000-0000-0000-000000000013";

const ESPECIAIS_DO_DIA = cardapio({
  id: "bbbbbbbb-0000-0000-0000-000000000273",
  nome: "Especiais do Dia",
  modo: "recorrente",
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
  dias_mes: null,
  prazo_inicio: null,
  prazo_fim: null,
});

const FEIJOADA_ROW = produtoRow({
  id: FEIJOADA,
  nome: "Feijoada",
  preco: 45.0,
  visibilidade: "cardapio",
});

/**
 * Mesmo bridge do RED da 273 em `pedido.vigencia-cardapio.test.ts`. A chave
 * legada por cardápio, que existia só para o vermelho ser da REGRA e não de um
 * `Map` vazio, saiu com o rename (RN-09).
 */
function vinculosDoBanco(
  porProduto: Record<
    string,
    { cardapio: CardapioVigencia & { ordem: number }; dias_semana: number[] | null }[]
  >,
) {
  const vinculos = Object.values(porProduto).flat();
  buscarCardapiosComProdutos.mockResolvedValue({
    cardapios: [...new Set(vinculos.map((v) => v.cardapio))],
    vinculosPorProduto: new Map(Object.entries(porProduto)),
  });
}

describe("[273/§10-A] a Feijoada {qua, sáb} na revisão do carrinho", () => {
  const CARRINHO = [
    { produto_id: COCA, quantidade: 2 },
    { produto_id: FEIJOADA, quantidade: 1 },
  ];

  it("SEGUNDA: linha NÃO comprável com motivo 'fora_da_janela', fora do subtotal", async () => {
    vi.setSystemTime(SEGUNDA);
    buscarProdutosPorIds.mockResolvedValue([produtoRow(), FEIJOADA_ROW]);
    vinculosDoBanco({ [FEIJOADA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }] });

    const r = await preview(CARRINHO);
    if (!r.ok) throw new Error(r.mensagem);

    const linha = (r.itens as LinhaComVigencia[]).find((l) => l.produto_id === FEIJOADA);
    expect(linha?.compravel).toBe(false);
    // Nenhum motivo NOVO: para o cliente é a mesma frase útil ("volta quarta").
    expect(linha?.motivoNaoCompravel).toBe("fora_da_janela");
    // A linha NÃO some da lista, mas não entra na conta: 2 × R$ 10,00 da Coca.
    expect(r.itens).toHaveLength(2);
    expect(r.subtotal).toBe(20);
  });

  it("SEGUNDA: o preview bloqueia EXATAMENTE o que faz `criarPedido` recusar", async () => {
    vi.setSystemTime(SEGUNDA);
    buscarProdutosPorIds.mockResolvedValue([produtoRow(), FEIJOADA_ROW]);
    vinculosDoBanco({ [FEIJOADA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }] });

    const r = await preview(CARRINHO);
    const pedido = await autoritativo(CARRINHO);

    expect(bloqueados(r)).toEqual([FEIJOADA]);
    expect("erro" in pedido).toBe(true);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("QUARTA: nada bloqueado no preview e o pedido é aceito — o preview não é mais SEVERO", async () => {
    vi.setSystemTime(QUARTA);
    buscarProdutosPorIds.mockResolvedValue([produtoRow(), FEIJOADA_ROW]);
    vinculosDoBanco({ [FEIJOADA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }] });

    const r = await preview(CARRINHO);
    const pedido = await autoritativo(CARRINHO);

    expect(bloqueados(r)).toEqual([]);
    expect("erro" in pedido).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("virada de meia-noite: o veredito muda com `agora` do SERVIDOR, não com o payload", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow(), FEIJOADA_ROW]);
    vinculosDoBanco({ [FEIJOADA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }] });

    // Quarta 23:59:59 local ainda vende; quinta 00:00:01 local já não.
    vi.setSystemTime(new Date("2026-12-24T02:59:59.000Z"));
    expect(bloqueados(await preview(CARRINHO))).toEqual([]);

    vi.setSystemTime(new Date("2026-12-24T03:00:01.000Z"));
    expect(bloqueados(await preview(CARRINHO))).toEqual([FEIJOADA]);
  });
});
