// TDD RED-first — issue 228 (crítica), critério de aceite nº 2:
//   "preview e criarPedido devolvem O MESMO desconto para o carrinho de RN-10-a
//    E para o de RN-10-d".
//
// É o teste de D5-b / RN-11. Ele não olha implementação: alimenta as DUAS
// Server Actions com EXATAMENTE as mesmas linhas de banco e compara o número.
// O carrinho de RN-10-d (opcional grudado em linha promocional) é o único que
// pega divergência de COMPONENTE: um preview que esquecesse de somar o opcional
// da linha promocional daria R$ 5,00 onde o autoritativo cobra R$ 6,00, e o
// cliente veria o total mudar na confirmação sem explicação.
//
// ⚠️ SEAM 228 ↔ 229 — ler antes de mexer. `criarPedido` ainda monta
// `precoProduto: { precoEfetivo: produto.preco, temDesconto: false }`
// (pedido.ts, comentário "(229)"). Enquanto essa linha não virar
// `precoEfetivo(produto, agora)`, o autoritativo cobra o preço de TABELA e
// nenhum destes dois testes pode ficar verde — nem com a 228 perfeita. Ver o
// relatório do `tdd`: ou a 228 absorve a troca, ou este arquivo é o RED da 229.
// NÃO "consertar" baixando a expectativa para o número do preço cheio: isso
// apagaria exatamente a divergência que o teste existe para pegar.
//
// `tipo_entrega: "retirada"` de propósito: frete 0 por regra (RN-C2), sem zona,
// sem CEP, sem geocoding — o único número em disputa é o desconto.

import { describe, it, expect, vi, beforeEach } from "vitest";
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

// ─────────────────────────── fixtures compartilhadas pelos DOIS caminhos
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
    criado_em: "2026-01-01T00:00:00.000Z",
    atualizado_em: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Feijoada/pizza R$ 100,00 com −20% vigente ⇒ preço efetivo R$ 80,00. */
const PROMOCIONAL = produtoRow({
  id: FEIJOADA,
  nome: "Feijoada",
  preco: 100.0,
  desconto_ativo: true,
  desconto_tipo: "percentual",
  desconto_valor: 20,
});

const BORDA = {
  id: OPC_BORDA,
  loja_id: LOJA_A,
  categoria_opcional_id: CAT_OPC,
  nome: "Borda recheada",
  preco: 10.0,
  ativo: true,
};

const CUPOM: Tables<"cupons"> = {
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
};

/** O MESMO banco para os dois caminhos — é isso que torna a comparação honesta. */
function mesmoBanco(comOpcional: boolean) {
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
  buscarProdutosPorIds.mockResolvedValue([PROMOCIONAL, produtoRow()]);
  buscarOpcionaisPorIds.mockResolvedValue(comOpcional ? [BORDA] : []);
  buscarOpcionaisPorCategoria.mockResolvedValue(
    comOpcional
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
  buscarCupomPorCodigo.mockResolvedValue(CUPOM);
  buscarPedidoPorToken.mockResolvedValue(null);
  fakeClient.rpc.mockResolvedValue({
    data: [{ pedido_id: PEDIDO_ID, token_acesso: TOKEN }],
    error: null,
  });
}

/** As MESMAS linhas do carrinho, na forma que cada action aceita. */
function itens(comOpcional: boolean) {
  return [
    {
      produto_id: FEIJOADA,
      quantidade: 1,
      ...(comOpcional ? { opcionais: [{ opcional_id: OPC_BORDA, quantidade: 1 }] } : {}),
    },
    { produto_id: REFRI, quantidade: 1 },
  ];
}

/** O desconto que o PREVIEW mostrou. */
async function descontoDoPreview(comOpcional: boolean): Promise<number> {
  const r = await revisarCarrinhoAction({
    loja_id: LOJA_A,
    codigo: "PROMO10",
    itens: itens(comOpcional),
  });
  if (!r.ok) throw new Error(`preview recusou o carrinho: ${r.mensagem}`);
  if (r.cupom == null || !r.cupom.valido) throw new Error("preview não aceitou o cupom");
  const e = r.cupom.estadoCupom;
  return e.estado === "zero" ? 0 : e.desconto;
}

/** O desconto que o AUTORITATIVO cobrou — lido do argumento da RPC. */
async function descontoCobrado(comOpcional: boolean): Promise<number> {
  const r = await criarPedido({
    loja_id: LOJA_A,
    tipo_entrega: "retirada",
    itens: itens(comOpcional),
    forma_pagamento: "pix",
    nome_cliente: "Fulano",
    codigo_cupom: "PROMO10",
  });
  if ("erro" in r) throw new Error(`criarPedido recusou o pedido: ${r.erro}`);
  const args = fakeClient.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
  return args.p_desconto as number;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient.rpc.mockReset();
});

describe("[228/RN-11/D5-b] preview e autoritativo dizem o MESMO número", () => {
  it("RN-10-a (carrinho misto, sem adicional): os dois descontam R$ 5,00", async () => {
    mesmoBanco(false);
    const preview = await descontoDoPreview(false);
    const cobrado = await descontoCobrado(false);

    expect(preview).toBe(5);
    expect(cobrado).toBe(5);
    expect(preview).toBe(cobrado);
  });

  it("RN-10-d (adicional em linha promocional): os dois descontam R$ 6,00", async () => {
    mesmoBanco(true);
    const preview = await descontoDoPreview(true);
    const cobrado = await descontoCobrado(true);

    // 10% de (0 + 10 borda + 50 refri). R$ 5,00 = regra "por linha" (D9 reverteu);
    // R$ 14,00 = ignorou a promoção.
    expect(preview).toBe(6);
    expect(cobrado).toBe(6);
    expect(preview).toBe(cobrado);
  });

  it("RN-10-d: o SUBTOTAL do preview é o mesmo que o pedido grava (R$ 140,00)", async () => {
    mesmoBanco(true);
    const r = await revisarCarrinhoAction({
      loja_id: LOJA_A,
      codigo: "PROMO10",
      itens: itens(true),
    });
    if (!r.ok) throw new Error(r.mensagem);

    await criarPedido({
      loja_id: LOJA_A,
      tipo_entrega: "retirada",
      itens: itens(true),
      forma_pagamento: "pix",
      nome_cliente: "Fulano",
      codigo_cupom: "PROMO10",
    });
    const args = fakeClient.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;

    expect(r.subtotal).toBe(140);
    expect(args.p_subtotal).toBe(r.subtotal);
  });
});
