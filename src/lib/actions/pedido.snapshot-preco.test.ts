// TDD RED-first — issue 229 (crítica): `criarPedido` nasce com o preço do BANCO
// no instante do envio, grava o par `preco`/`preco_original` (D7/RN-13) e
// transforma o "segundo clique" de D11 em garantia de SERVIDOR (RN-12-a).
//
// Esta é a issue em que o cliente poderia pagar MENOS do que deve: hoje
// `pedido.ts` monta `precoProduto: { precoEfetivo: produto.preco,
// temDesconto: false }` — o preço de TABELA —, o que significa que (a) o
// snapshot não sabe que houve promoção e (b) a base elegível do cupom inclui
// o produto promocional, acumulando cupom sobre promoção (D5 proíbe).
//
// CAMADA: orquestração da Server Action com I/O mockado — a verdade lida é
// "o que a action manda para a RPC `criar_pedido`". A persistência da coluna
// já é provada no banco por tests/migrations/itens_pedido_preco_original.test.ts
// (issue 221): não duplicamos aqui.
//
// COMPLEMENTA, sem duplicar:
//  - paridade-preview-autoritativo.test.ts (RED da 228) — compara preview ↔
//    autoritativo (desconto 5 / 6 e subtotal 140). Aqui provamos o LADO
//    autoritativo: o snapshot por item, a corrida de vigência, o cupom de
//    desconto zero e a matriz de RN-12-a.
//  - pedido.test.ts — suíte existente de recálculo/ataque, intocada.
//
// Duas exigências vindas do `auditar` da 221, honradas abaixo:
//  (a) `preco_original` é afirmado IGUAL a `produtos.preco` da linha do banco,
//      não apenas `>= preco` — um bug de derivação passaria pelo CHECK mudo;
//  (b) a chamada carrega os 17 argumentos nomeados. Omitir `p_frete_a_combinar`
//      resolve para a `criar_pedido` LEGADA de 16 args, que descarta
//      `preco_original` em silêncio (issue 266).
//
// `tipo_entrega: "retirada"` de propósito: frete 0 por regra (RN-C2), sem zona,
// sem CEP, sem geocoding — os únicos números em disputa são preço e desconto.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/database.types";
import type { ResultadoCriarPedido } from "./pedido";

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

// (249/252) A onda de leituras de `criarPedido`/`revisarCarrinhoAction` passou a
// incluir os cardápios da loja. Loja sem cardápio nenhum = o comportamento que
// estes testes já descreviam (todo produto é `visibilidade: 'menu'`).
vi.mock("@/lib/supabase/queries/cardapios", () => ({
  buscarCardapiosComProdutos: async () => ({
    cardapios: [],
    vinculosPorProduto: new Map(),
  }),
}));

const buscarPedidoPorToken = vi.fn();
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  buscarPedidoPorToken: (...a: unknown[]) => buscarPedidoPorToken(...a),
}));

import { criarPedido } from "./pedido";

// ─────────────────────────────────────────────────────────── fixtures do banco
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const FEIJOADA = "aaaaaaaa-0000-0000-0000-000000000001";
const REFRI = "aaaaaaaa-0000-0000-0000-000000000002";
const OPC_BORDA = "ffffffff-0000-0000-0000-000000000001";
const CAT_PROD = "dddddddd-0000-0000-0000-000000000001";
const CAT_OPC = "eeeeeeee-0000-0000-0000-000000000001";
const PEDIDO_ID = "99999999-0000-0000-0000-000000000001";
const TOKEN = "77777777-0000-0000-0000-000000000009";

const HORARIO = { abre: "00:00", fecha: "23:59", ativo: true };
const HORARIOS_SEMPRE = {
  seg: HORARIO, ter: HORARIO, qua: HORARIO, qui: HORARIO,
  sex: HORARIO, sab: HORARIO, dom: HORARIO,
};

function produtoRow(over: Partial<Tables<"produtos">> = {}): Tables<"produtos"> {
  return {
    id: REFRI,
    loja_id: LOJA_A,
    categoria_id: CAT_PROD,
    nome: "Refrigerante",
    descricao: null,
    preco: 50.0,
    disponivel: true,
    oculto: false,
    ordem: 0,
    foto_url: null,
    desconto_ativo: false,
    desconto_tipo: null,
    desconto_valor: null,
    desconto_inicio: null,
    desconto_fim: null,
    // [244] coluna NOT NULL com default 'menu': é assim que toda linha nasce.
    visibilidade: "menu",
    criado_em: "2026-01-01T00:00:00.000Z",
    atualizado_em: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Feijoada R$ 100,00 com −20% VIGENTE (sem janela) ⇒ efetivo R$ 80,00. */
const FEIJOADA_EM_PROMOCAO = produtoRow({
  id: FEIJOADA,
  nome: "Feijoada",
  preco: 100.0,
  desconto_ativo: true,
  desconto_tipo: "percentual",
  desconto_valor: 20,
});

/** A MESMA Feijoada, com a janela ENCERRADA no passado (RN-12: corrida de
 *  vigência). `desconto_ativo` continua true — é exatamente o estado que o
 *  lojista deixa no banco quando a promoção simplesmente venceu. */
const FEIJOADA_PROMOCAO_EXPIRADA = produtoRow({
  ...FEIJOADA_EM_PROMOCAO,
  desconto_fim: "2020-01-01T00:00:00.000Z",
});

const REFRIGERANTE = produtoRow();

const BORDA = {
  id: OPC_BORDA,
  loja_id: LOJA_A,
  categoria_opcional_id: CAT_OPC,
  nome: "Borda recheada",
  preco: 10.0,
  ativo: true,
};

function cupomRow(over: Partial<Tables<"cupons">> = {}): Tables<"cupons"> {
  return {
    id: "cccccccc-0000-0000-0000-000000000001",
    loja_id: LOJA_A,
    codigo: "PROMO10",
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 100.0,
    usos_maximos: null,
    usos_contagem: 0,
    expira_em: null,
    ativo: true,
    criado_em: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

type ItemJsonb = {
  produto_id: string;
  nome: string;
  preco: number;
  quantidade: number;
  preco_original?: number | null;
  opcionais?: { opcional_id: string; preco_snapshot: number; quantidade: number }[];
};

interface Cenario {
  produtos?: Tables<"produtos">[];
  opcionais?: typeof BORDA[];
  cupom?: Tables<"cupons"> | null;
}

function banco({ produtos, opcionais = [], cupom = cupomRow() }: Cenario = {}) {
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
  buscarProdutosPorIds.mockResolvedValue(produtos ?? [FEIJOADA_EM_PROMOCAO, REFRIGERANTE]);
  buscarOpcionaisPorIds.mockResolvedValue(opcionais);
  buscarOpcionaisPorCategoria.mockResolvedValue(
    opcionais.length > 0
      ? {
          [CAT_PROD]: [
            {
              categoriaOpcionalId: CAT_OPC,
              categoriaOpcionalNome: "Bordas",
              ordem: 0,
              opcionais: [],
            },
          ],
        }
      : {},
  );
  buscarCupomPorCodigo.mockResolvedValue(cupom);
  buscarPedidoPorToken.mockResolvedValue(null);
  fakeClient.rpc.mockResolvedValue({
    data: [{ pedido_id: PEDIDO_ID, token_acesso: TOKEN }],
    error: null,
  });
}

/** Os argumentos nomeados da ÚLTIMA chamada da RPC — a "linha gravada" que esta
 *  camada consegue observar. */
function argsDaRpc(): Record<string, unknown> {
  const call = fakeClient.rpc.mock.calls.at(-1);
  if (call == null) throw new Error("a RPC criar_pedido não foi chamada");
  return call[1] as Record<string, unknown>;
}

function itensDaRpc(): ItemJsonb[] {
  return argsDaRpc().p_itens as ItemJsonb[];
}

function itemDaRpc(produtoId: string): ItemJsonb {
  const item = itensDaRpc().find((i) => i.produto_id === produtoId);
  if (item == null) throw new Error(`item ${produtoId} ausente no jsonb p_itens`);
  return item;
}

/** CONTRATO para o GREEN: a recusa de RN-12-a é DISTINGUÍVEL de um erro
 *  genérico — o checkout (issue 238) precisa saber que deve chamar
 *  `revisarCarrinhoAction` e abrir a reconfirmação, e não repetir o envio. */
type ResultadoObservado = ResultadoCriarPedido & { codigo?: string };

async function enviar(payload: Record<string, unknown>): Promise<ResultadoObservado> {
  return (await criarPedido({
    loja_id: LOJA_A,
    tipo_entrega: "retirada",
    forma_pagamento: "pix",
    nome_cliente: "Fulano",
    ...payload,
  })) as ResultadoObservado;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient.rpc.mockReset();
});

// ═════════════════════════════════════════════════ D7 / RN-13 — o par gravado
describe("[229/RN-13/D7] snapshot: `preco` pago e `preco_original` de tabela", () => {
  it("RN-10-a: Feijoada grava preco 80 + preco_original 100 (o preço de tabela DO BANCO) e o refrigerante grava NULL", async () => {
    banco();
    const r = await enviar({
      itens: [
        { produto_id: FEIJOADA, quantidade: 1 },
        { produto_id: REFRI, quantidade: 1 },
      ],
      codigo_cupom: "PROMO10",
    });
    expect("erro" in r).toBe(false);

    const feijoada = itemDaRpc(FEIJOADA);
    // O preço PAGO é o efetivo, não o de tabela.
    expect(feijoada.preco).toBe(80);
    // Exigência (a) do `auditar` da 221: IGUAL ao `produtos.preco` da linha do
    // banco, não só `>= preco`. Um bug de derivação (p.ex. gravar o próprio
    // efetivo, ou o preço de outro item) passaria pelo CHECK sem ruído.
    expect(feijoada.preco_original).toBe(100);
    expect(feijoada.preco_original).toBe(FEIJOADA_EM_PROMOCAO.preco);

    // Item sem desconto: NULL (ou chave ausente — a RPC trata os dois como NULL).
    const refri = itemDaRpc(REFRI);
    expect(refri.preco).toBe(50);
    expect(refri.preco_original ?? null).toBeNull();
  });

  it("RN-10-a: os números do pedido são os do preview — p_subtotal 130, p_desconto 5, p_total 125", async () => {
    banco();
    await enviar({
      itens: [
        { produto_id: FEIJOADA, quantidade: 1 },
        { produto_id: REFRI, quantidade: 1 },
      ],
      codigo_cupom: "PROMO10",
    });
    const args = argsDaRpc();

    // 80 + 50. Cupom de 10% sobre a base elegível (só o refri: 50) ⇒ 5.
    expect(args.p_subtotal).toBe(130);
    expect(args.p_desconto).toBe(5);
    expect(args.p_total).toBe(125);
    expect(args.p_taxa_entrega).toBe(0);
  });

  it("RN-10-d: adicional em linha promocional — subtotal 140, desconto 6, total 134, e a Feijoada ainda grava o par 80/100", async () => {
    banco({ opcionais: [BORDA] });
    await enviar({
      itens: [
        {
          produto_id: FEIJOADA,
          quantidade: 1,
          opcionais: [{ opcional_id: OPC_BORDA, quantidade: 1 }],
        },
        { produto_id: REFRI, quantidade: 1 },
      ],
      codigo_cupom: "PROMO10",
    });
    const args = argsDaRpc();

    // Base por COMPONENTE (D9): refri 50 + borda 10 = 60 ⇒ 10% = 6.
    // R$ 5,00 seria a regra "por linha" que D9 reverteu; R$ 14,00 seria ignorar
    // a promoção (o bug de hoje).
    expect(args.p_subtotal).toBe(140);
    expect(args.p_desconto).toBe(6);
    expect(args.p_total).toBe(134);

    // O adicional NÃO recebe desconto (D8) e NÃO contamina o par do produto.
    const feijoada = itemDaRpc(FEIJOADA);
    expect(feijoada.preco).toBe(80);
    expect(feijoada.preco_original).toBe(100);
    expect(feijoada.opcionais?.[0]?.preco_snapshot).toBe(10);
  });

  it("[221/266] a chamada carrega os 17 argumentos nomeados — nunca cai na `criar_pedido` LEGADA de 16, que descarta preco_original em silêncio", async () => {
    banco();
    await enviar({
      itens: [{ produto_id: FEIJOADA, quantidade: 1 }],
    });
    const args = argsDaRpc();

    // `p_frete_a_combinar` é o argumento que desempata o overload: omiti-lo faz
    // o Postgres resolver para a assinatura de 16 args (menos defaults a
    // preencher), que ignora `preco_original` sem erro nenhum.
    expect(Object.keys(args)).toContain("p_frete_a_combinar");
    expect(Object.keys(args)).toHaveLength(17);
    // E o par só é gravado porque viaja DENTRO do jsonb.
    expect(itemDaRpc(FEIJOADA).preco_original).toBe(100);
  });
});

// ════════════════════════════════════════════ RN-12 — corrida de vigência
describe("[229/RN-12/D11] vale o preço do banco no instante do envio", () => {
  it("a promoção EXPIROU entre o carrinho e o envio ⇒ grava 100, sem preco_original — e a MESMA linha vigente grava 80/100", async () => {
    // O par é um teste só de propósito: "grava 100" sozinho passa por acidente
    // enquanto a action ignora desconto (o bug de hoje). As duas linhas são
    // idênticas exceto por `desconto_fim` — o que a asserção prova é que a
    // action AVALIA a vigência, não que ela desconhece promoções.
    banco({ produtos: [FEIJOADA_PROMOCAO_EXPIRADA, REFRIGERANTE] });
    await enviar({
      itens: [
        { produto_id: FEIJOADA, quantidade: 1 },
        { produto_id: REFRI, quantidade: 1 },
      ],
      codigo_cupom: "PROMO10",
    });

    const feijoada = itemDaRpc(FEIJOADA);
    // O cliente viu 80 no carrinho; o banco diz 100 agora. Vale o banco.
    expect(feijoada.preco).toBe(100);
    // Sem desconto vigente não existe "de/por": NULL, e não 100/100 (RN-14
    // exibiria um par inútil "de R$ 100,00 por R$ 100,00").
    expect(feijoada.preco_original ?? null).toBeNull();

    const args = argsDaRpc();
    // Sem promoção, a Feijoada VOLTA para a base elegível: 150 ⇒ 10% = 15.
    expect(args.p_subtotal).toBe(150);
    expect(args.p_desconto).toBe(15);
    expect(args.p_total).toBe(135);

    // O outro lado da corrida: a MESMA Feijoada, com a janela aberta.
    fakeClient.rpc.mockClear();
    banco({ produtos: [FEIJOADA_EM_PROMOCAO, REFRIGERANTE] });
    await enviar({
      itens: [
        { produto_id: FEIJOADA, quantidade: 1 },
        { produto_id: REFRI, quantidade: 1 },
      ],
      codigo_cupom: "PROMO10",
    });
    expect(itemDaRpc(FEIJOADA).preco).toBe(80);
    expect(itemDaRpc(FEIJOADA).preco_original).toBe(100);
    expect(argsDaRpc().p_subtotal).toBe(130);
  });
});

// ═══════════════════════════════════ RN-10.3 — desconto zero não consome cupom
describe("[229/RN-10.3] cupom válido cujo desconto dá R$ 0,00 NÃO é consumido", () => {
  it("carrinho só com o item promocional ⇒ p_desconto 0, p_cupom_id e p_cupom_codigo NULL", async () => {
    // pedido_minimo 0: o cupom é VÁLIDO (validarUsoCupom passa). O desconto é
    // zero por falta de base elegível (D5), não por recusa do cupom — é
    // exatamente o caso puro de RN-10-c.
    banco({
      produtos: [FEIJOADA_EM_PROMOCAO],
      cupom: cupomRow({ pedido_minimo: 0 }),
    });
    await enviar({
      itens: [{ produto_id: FEIJOADA, quantidade: 1 }],
      codigo_cupom: "PROMO10",
    });
    const args = argsDaRpc();

    expect(args.p_subtotal).toBe(80);
    expect(args.p_desconto).toBe(0);
    expect(args.p_total).toBe(80);
    // A trava: com `p_cupom_id` NULL a RPC não incrementa `usos_contagem` e não
    // grava `cupom_codigo`. Um cupom queimado por um desconto de R$ 0,00 é o
    // cliente perdendo um uso que não recebeu.
    expect(args.p_cupom_id).toBeNull();
    expect(args.p_cupom_codigo).toBeNull();
  });
});

// ═══════════════════════════ RN-12-a — a matriz do "segundo clique" no servidor
describe("[229/RN-12-a/D11] `promocaoExibida`: o segundo clique é do SERVIDOR", () => {
  it("célula 1 — true afirmado × true apurado: segue e cobra 80", async () => {
    banco({ produtos: [FEIJOADA_EM_PROMOCAO] });
    const r = await enviar({
      itens: [{ produto_id: FEIJOADA, quantidade: 1, promocaoExibida: true }],
    });

    expect("erro" in r).toBe(false);
    expect(itemDaRpc(FEIJOADA).preco).toBe(80);
    expect(itemDaRpc(FEIJOADA).preco_original).toBe(100);
  });

  it("célula 2 — false afirmado × false apurado: segue e cobra o preço cheio", async () => {
    banco({ produtos: [REFRIGERANTE] });
    const r = await enviar({
      itens: [{ produto_id: REFRI, quantidade: 1, promocaoExibida: false }],
    });

    expect("erro" in r).toBe(false);
    expect(itemDaRpc(REFRI).preco).toBe(50);
    expect(itemDaRpc(REFRI).preco_original ?? null).toBeNull();
  });

  it("célula 3 — false afirmado × true apurado: SEGUE e cobra COM desconto (o campo não barateia nada)", async () => {
    // A promoção começou entre o carrinho e o envio: o cliente paga MENOS do
    // que viu. D11: "preço cai ⇒ só avisa". E a prova de que `promocaoExibida`
    // não é superfície de ataque de valor — mentir `false` não dá desconto
    // nenhum a mais nem a menos: vale o banco.
    banco({ produtos: [FEIJOADA_EM_PROMOCAO] });
    const r = await enviar({
      itens: [{ produto_id: FEIJOADA, quantidade: 1, promocaoExibida: false }],
    });

    expect("erro" in r).toBe(false);
    expect(itemDaRpc(FEIJOADA).preco).toBe(80);
    expect(argsDaRpc().p_total).toBe(80);
  });

  it("célula 4 — true afirmado × false apurado: RECUSA com código de revisão e NÃO chama a RPC", async () => {
    // A promoção terminou: o cliente pagaria MAIS do que viu. D11 exige
    // reconfirmação explícita, e a garantia é de servidor — sem jsdom, "o
    // componente pede o segundo clique" não é afirmável.
    banco({ produtos: [FEIJOADA_PROMOCAO_EXPIRADA] });
    const r = await enviar({
      itens: [{ produto_id: FEIJOADA, quantidade: 1, promocaoExibida: true }],
    });

    expect("erro" in r).toBe(true);
    // Distinguível do erro genérico: o checkout precisa saber que deve revisar
    // o carrinho e mostrar o de/para, não repetir o mesmo envio.
    expect(r.codigo).toBe("revisao_necessaria");
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("ausente ⇒ tratado como false: cliente antigo na janela de deploy, com promoção ENCERRADA, SEGUE (fail-closed sem recusar por engano)", async () => {
    // O único caso que a ausência não pode virar: recusar um cliente que nunca
    // soube do campo. Ausente ⇒ `false` ⇒ nunca cai na célula 4.
    banco({ produtos: [FEIJOADA_PROMOCAO_EXPIRADA] });
    const r = await enviar({
      itens: [{ produto_id: FEIJOADA, quantidade: 1 }],
    });

    expect("erro" in r).toBe(false);
    expect(itemDaRpc(FEIJOADA).preco).toBe(100);
  });

  it("ausente ⇒ tratado como false, com promoção VIGENTE: segue e cobra 80 (mesma célula 3)", async () => {
    banco({ produtos: [FEIJOADA_EM_PROMOCAO] });
    const r = await enviar({
      itens: [{ produto_id: FEIJOADA, quantidade: 1 }],
    });

    expect("erro" in r).toBe(false);
    expect(itemDaRpc(FEIJOADA).preco).toBe(80);
    expect(itemDaRpc(FEIJOADA).preco_original).toBe(100);
  });

  it("a recusa é POR PEDIDO INTEIRO: um item com a divergência derruba o carrinho todo (nada de pedido parcial)", async () => {
    banco({ produtos: [FEIJOADA_PROMOCAO_EXPIRADA, REFRIGERANTE] });
    const r = await enviar({
      itens: [
        { produto_id: FEIJOADA, quantidade: 1, promocaoExibida: true },
        { produto_id: REFRI, quantidade: 1, promocaoExibida: false },
      ],
    });

    expect("erro" in r).toBe(true);
    expect(r.codigo).toBe("revisao_necessaria");
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("`promocaoExibida` entra no zod SEM afrouxar o .strict(): campo monetário no item continua recusado ANTES de qualquer I/O", async () => {
    banco({ produtos: [FEIJOADA_EM_PROMOCAO] });
    const r = await enviar({
      itens: [
        { produto_id: FEIJOADA, quantidade: 1, promocaoExibida: true, preco: 0.01 },
      ],
    });

    expect("erro" in r).toBe(true);
    // Recusa de SCHEMA, não de revisão — o código de revisão aqui seria uma
    // pista de que o payload chegou ao recálculo.
    expect(r.codigo).toBeUndefined();
    expect(buscarProdutosPorIds).not.toHaveBeenCalled();
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });
});
