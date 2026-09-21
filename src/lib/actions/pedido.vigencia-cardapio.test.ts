// TDD RED-first — issue 249 (crítica): `criarPedido` recusa o PEDIDO INTEIRO
// por item fora da janela do cardápio.
//
// Autoridade: specs/cardapio-sazonal.md · RN-08 (a recusa do servidor) · RN-13
// e D14 (o produto exclusivo que sumiu) · RN-03 (inativo não participa de nada).
//
// Por que este arquivo existe: `pedido.ts` hoje valida `disponivel`, `oculto` e
// `loja_id` no laço de recusa (linhas 173-179) e NÃO valida vigência nenhuma.
// Enquanto nenhum caminho gravar `produtos.visibilidade = 'cardapio'` o buraco é
// inerte — mas ele é exatamente o buraco que esta issue fecha, e a UI (card
// desabilitado) não é a proteção.
//
// ⚠️ SEAM 249 → GREEN. O contrato que este RED impõe:
//   1. `criarPedido` chama `buscarCardapiosComProdutos(svc, dados.loja_id)`
//      DENTRO do mesmo `Promise.all` da onda única (pedido.ts:113-122), sob
//      `service_role`, sem filtro por `ativo` (a regra mora na função pura);
//   2. o veredito por item sai de `avaliarVigenciaDoProduto` — NUNCA de
//      aritmética nova aqui;
//   3. `!dentroDaJanela` ⇒ `return { erro: ERRO_FORA_DA_JANELA }` no MESMO laço,
//      ANTES da RPC. Nada gravado, nenhum item descartado em silêncio.
//
// `tipo_entrega: "retirada"` de propósito: frete 0 por regra, sem zona, sem CEP,
// sem geocoding — o único veredito em disputa é o da janela.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Tables } from "@/lib/database.types";
import type { CardapioVigencia } from "@/lib/utils/vigenciaCardapio";

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

// O SEAM da issue: a MESMA query que o SSR da vitrine usa (247), reusada aqui
// sob service_role. Nenhuma segunda leitura de cardápio pode existir.
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

import { criarPedido } from "./pedido";

// ─────────────────────────────────────────────────────────── fixtures
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const SOPA = "aaaaaaaa-0000-0000-0000-000000000011";
const COCA = "aaaaaaaa-0000-0000-0000-000000000012";
const CARD_INVERNO = "bbbbbbbb-0000-0000-0000-000000000001";
const PEDIDO_ID = "99999999-0000-0000-0000-000000000001";
const TOKEN = "77777777-0000-0000-0000-000000000009";

/** Cenário 6 da spec: dom 20/12/2026 12:00 em America/Sao_Paulo. */
const AGORA = new Date("2026-12-20T15:00:00.000Z");

/** A mensagem de RN-08, literal. Específica como "Loja fechada no momento." e
 *  deliberadamente SEM nomear o item (quem nomeia é a revisão do carrinho). */
const ERRO_FORA_DA_JANELA =
  "Um item do seu pedido saiu do cardápio deste horário. Revise o carrinho.";

const HORARIO = { abre: "00:00", fecha: "23:59", ativo: true };
const HORARIOS_SEMPRE = {
  seg: HORARIO, ter: HORARIO, qua: HORARIO, qui: HORARIO,
  sex: HORARIO, sab: HORARIO, dom: HORARIO,
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

/** Sopa de cebola: existe SÓ por causa do cardápio (D14). */
const SOPA_ROW = produtoRow({
  id: SOPA,
  nome: "Sopa de cebola",
  preco: 30.0,
  visibilidade: "cardapio",
});

/** `ordem` é de APRESENTAÇÃO e não entra em `CardapioVigencia` (D4) — mas é o
 *  que `buscarCardapiosComProdutos` devolve, então o fake devolve igual. */
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
    // Temporada ENCERRADA: 21/06 a 22/09/2026, e agora é 20/12.
    prazo_inicio: "2026-06-21T03:00:00.000Z",
    prazo_fim: "2026-09-22T03:00:00.000Z",
    ordem: 0,
    ...over,
  };
}

/** Temporada VIGENTE no instante do teste. */
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

/** O índice `produto_id → vínculos` no formato de `buscarCardapiosComProdutos`. */
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

function enviar(produtoId: string) {
  return criarPedido({
    loja_id: LOJA_A,
    tipo_entrega: "retirada",
    itens: [{ produto_id: produtoId, quantidade: 1 }],
    forma_pagamento: "pix",
    nome_cliente: "Fulano",
  });
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

describe("[249/RN-08] payload forjado com item fora da janela", () => {
  it("recusa o PEDIDO INTEIRO com a mensagem de RN-08 e NÃO chama a RPC", async () => {
    buscarProdutosPorIds.mockResolvedValue([SOPA_ROW]);
    cardapiosDoBanco({ [SOPA]: [cardapio()] });

    const r = await enviar(SOPA);

    expect("erro" in r).toBe(true);
    expect((r as { erro: string }).erro).toBe(ERRO_FORA_DA_JANELA);
    // "antes da RPC": nada em `pedidos`, nada em `itens_pedido`.
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("o carrinho INTEIRO cai por um item só — o bom não é gravado sozinho", async () => {
    buscarProdutosPorIds.mockResolvedValue([SOPA_ROW, produtoRow()]);
    cardapiosDoBanco({ [SOPA]: [cardapio()] });

    const r = await criarPedido({
      loja_id: LOJA_A,
      tipo_entrega: "retirada",
      itens: [
        { produto_id: COCA, quantidade: 2 },
        { produto_id: SOPA, quantidade: 1 },
      ],
      forma_pagamento: "pix",
      nome_cliente: "Fulano",
    });

    expect("erro" in r).toBe(true);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("lê os cardápios da loja do PAYLOAD JÁ VALIDADO, sob service_role", async () => {
    buscarProdutosPorIds.mockResolvedValue([SOPA_ROW]);
    cardapiosDoBanco({ [SOPA]: [INVERNO_ABERTO] });

    await enviar(SOPA);

    expect(buscarCardapiosComProdutos).toHaveBeenCalledWith(fakeClient, LOJA_A);
  });

  it("temporada VIGENTE: o mesmo produto passa e a RPC é chamada", async () => {
    buscarProdutosPorIds.mockResolvedValue([SOPA_ROW]);
    cardapiosDoBanco({ [SOPA]: [INVERNO_ABERTO] });

    const r = await enviar(SOPA);

    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("[249/D14] produto 'menu' não é afetado por cardápio nenhum", () => {
  it("cardápio FECHADO com a Coca-Cola dentro: o pedido passa", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    cardapiosDoBanco({ [COCA]: [cardapio()] });

    const r = await enviar(COCA);

    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("cardápio INATIVO e fora do prazo: continua não bloqueando o produto do menu", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    cardapiosDoBanco({ [COCA]: [cardapio({ ativo: false })] });

    const r = await enviar(COCA);

    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("[249/RN-03+RN-13] os dois desfechos do produto 'cardapio'", () => {
  it("cardápio INATIVO mas dentro do prazo NÃO abre a venda (RN-03)", async () => {
    buscarProdutosPorIds.mockResolvedValue([SOPA_ROW]);
    cardapiosDoBanco({ [SOPA]: [{ ...INVERNO_ABERTO, ativo: false }] });

    const r = await enviar(SOPA);

    expect("erro" in r).toBe(true);
    expect((r as { erro: string }).erro).toBe(ERRO_FORA_DA_JANELA);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("produto 'cardapio' órfão (sumido da vitrine) é RECUSADO, não omitido", async () => {
    buscarProdutosPorIds.mockResolvedValue([SOPA_ROW]);
    cardapiosDoBanco({});

    const r = await enviar(SOPA);

    expect("erro" in r).toBe(true);
    expect((r as { erro: string }).erro).toBe(ERRO_FORA_DA_JANELA);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("basta UM cardápio aberto entre vários para o produto ser vendável", async () => {
    buscarProdutosPorIds.mockResolvedValue([SOPA_ROW]);
    cardapiosDoBanco({
      [SOPA]: [
        cardapio(),
        { ...INVERNO_ABERTO, id: "bbbbbbbb-0000-0000-0000-000000000002", nome: "Fim de ano" },
      ],
    });

    const r = await enviar(SOPA);

    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("[249/segurança] falha ao ler cardápios é FAIL-CLOSED", () => {
  it("leitura de cardápios rejeitada ⇒ pedido recusado, RPC não chamada", async () => {
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    buscarCardapiosComProdutos.mockRejectedValue(new Error("PostgREST 503"));

    const r = await enviar(COCA);

    // Fail-closed sem branch novo: o `Promise.all` rejeita, o catch externo
    // devolve o genérico (§14) e nada é vendido.
    expect("erro" in r).toBe(true);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [273] RED PRINCIPAL DO LOOP — `criarPedido` recusa a Feijoada numa SEGUNDA.
//
// Autoridade: specs/vigencia-por-item-do-cardapio.md RN-01 (itemAberto),
// RN-02 (união sobre vínculos), RN-04 (a recusa é do servidor e é a única
// autoridade) · seguranca.md §10 (valor e agora recalculados do banco).
//
// É a invariante de DINHEIRO desta spec: o cardápio "Especiais do Dia" está
// aberto os 7 dias, a Feijoada tem `dias_semana = {qua, sáb}` no VÍNCULO, e um
// payload forjado numa segunda-feira não pode virar pedido. O cliente não envia
// dia, hora, fuso, cardápio nem preço — o schema é `.strict()` e nada de
// vigência é declarado nele.
//
// ⚠️ SEAM 273 → GREEN. O contrato que este RED impõe:
//   `pedido.ts` passa `cardapios.vinculosPorProduto.get(produto.id) ?? []` a
//   `avaliarVigenciaDoProduto`, no MESMO laço que já recusa
//   indisponível/oculto/de outra loja, ANTES da RPC. Nenhuma linha de regra
//   nova, nenhum motivo novo, nenhuma segunda leitura de cardápio.
// ═══════════════════════════════════════════════════════════════════════════

/** Seg 21/12/2026, 12:00 -03 (America/Sao_Paulo, o fuso de `bancoBase`). */
const SEGUNDA = new Date("2026-12-21T15:00:00.000Z");
/** Qua 23/12/2026, 12:00 -03. */
const QUARTA = new Date("2026-12-23T15:00:00.000Z");

const FEIJOADA = "aaaaaaaa-0000-0000-0000-000000000013";
const CARD_ESPECIAIS = "bbbbbbbb-0000-0000-0000-000000000273";

/** "Especiais do Dia": recorrente, ATIVO, os 7 dias, sem faixa de horas. */
const ESPECIAIS_DO_DIA = cardapio({
  id: CARD_ESPECIAIS,
  nome: "Especiais do Dia",
  modo: "recorrente",
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
  dias_mes: null,
  prazo_inicio: null,
  prazo_fim: null,
});

/** A Feijoada existe SÓ por causa do cardápio — é o prato do dono do SaaS. */
const FEIJOADA_ROW = produtoRow({
  id: FEIJOADA,
  nome: "Feijoada",
  preco: 45.0,
  visibilidade: "cardapio",
});

/**
 * O índice que a 273 promete: `vinculosPorProduto`, com o `dias_semana` do
 * VÍNCULO. O RED trazia junto a chave legada por cardápio para que o vermelho
 * fosse da REGRA, e não de um `Map` vazio caindo no `?? []`; o GREEN a removeu
 * com o rename (RN-09).
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

describe("[273/RN-04] a Feijoada de {qua, sáb} num cardápio aberto os 7 dias", () => {
  it("SEGUNDA: `criarPedido` recusa o pedido com a mensagem de RN-08 e NÃO chama a RPC", async () => {
    vi.setSystemTime(SEGUNDA);
    buscarProdutosPorIds.mockResolvedValue([FEIJOADA_ROW]);
    vinculosDoBanco({ [FEIJOADA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }] });

    const r = await enviar(FEIJOADA);

    expect("erro" in r).toBe(true);
    expect((r as { erro: string }).erro).toBe(ERRO_FORA_DA_JANELA);
    // "antes da RPC": nada em `pedidos`, nada em `itens_pedido`.
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("QUARTA: o MESMO payload passa — a regra não fecha o que devia abrir", async () => {
    vi.setSystemTime(QUARTA);
    buscarProdutosPorIds.mockResolvedValue([FEIJOADA_ROW]);
    vinculosDoBanco({ [FEIJOADA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }] });

    const r = await enviar(FEIJOADA);

    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("o carrinho INTEIRO cai por causa dela — o item bom não é gravado sozinho", async () => {
    vi.setSystemTime(SEGUNDA);
    buscarProdutosPorIds.mockResolvedValue([FEIJOADA_ROW, produtoRow()]);
    vinculosDoBanco({ [FEIJOADA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }] });

    const r = await criarPedido({
      loja_id: LOJA_A,
      tipo_entrega: "retirada",
      itens: [
        { produto_id: COCA, quantidade: 2 },
        { produto_id: FEIJOADA, quantidade: 1 },
      ],
      forma_pagamento: "pix",
      nome_cliente: "Fulano",
    });

    expect("erro" in r).toBe(true);
    expect((r as { erro: string }).erro).toBe(ERRO_FORA_DA_JANELA);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("basta UM vínculo aberto hoje: em dois cardápios, o de segunda vende", async () => {
    vi.setSystemTime(SEGUNDA);
    buscarProdutosPorIds.mockResolvedValue([FEIJOADA_ROW]);
    vinculosDoBanco({
      [FEIJOADA]: [
        { cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] },
        { cardapio: ESPECIAIS_DO_DIA, dias_semana: [1] },
      ],
    });

    const r = await enviar(FEIJOADA);

    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("[273] regressão zero do deploy da 272 e curto-circuito de RN-02", () => {
  it("vínculo com `dias_semana` NULL ou [] vende em qualquer dia", async () => {
    // É 100% das linhas no deploy da 272: a coluna nasceu NULL, sem backfill.
    for (const dias of [null, []] as (number[] | null)[]) {
      vi.clearAllMocks();
      fakeClient.rpc.mockReset();
      bancoBase();
      vi.setSystemTime(SEGUNDA);
      buscarProdutosPorIds.mockResolvedValue([FEIJOADA_ROW]);
      vinculosDoBanco({ [FEIJOADA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: dias }] });

      const r = await enviar(FEIJOADA);

      expect("erro" in r).toBe(false);
      expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("produto `visibilidade: 'menu'` com vínculo agendado continua vendendo na segunda", async () => {
    vi.setSystemTime(SEGUNDA);
    // RN-02 curto-circuita ANTES de olhar vínculo nenhum: a agenda do vínculo
    // só decide destaque para o produto do menu, nunca compra.
    buscarProdutosPorIds.mockResolvedValue([produtoRow()]);
    vinculosDoBanco({ [COCA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }] });

    const r = await enviar(COCA);

    expect("erro" in r).toBe(false);
    expect(fakeClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("o payload NÃO tem por onde mandar dia, cardápio ou vigência (`.strict()`)", async () => {
    vi.setSystemTime(SEGUNDA);
    buscarProdutosPorIds.mockResolvedValue([FEIJOADA_ROW]);
    vinculosDoBanco({ [FEIJOADA]: [{ cardapio: ESPECIAIS_DO_DIA, dias_semana: [3, 6] }] });

    const forjado = {
      loja_id: LOJA_A,
      tipo_entrega: "retirada" as const,
      itens: [{ produto_id: FEIJOADA, quantidade: 1 }],
      forma_pagamento: "pix",
      nome_cliente: "Fulano",
      dias_semana: [1],
      cardapio_id: CARD_ESPECIAIS,
    };
    const r = await criarPedido(forjado as unknown as Parameters<typeof criarPedido>[0]);

    // Recusado de um jeito ou de outro — o que NUNCA pode é virar pedido.
    expect("erro" in r).toBe(true);
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });
});
