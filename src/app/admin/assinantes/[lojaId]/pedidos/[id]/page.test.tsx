import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fiação da page admin de detalhe do pedido (issue 140). Não reprova a regra de
 * negócio (transição está na action 133, escopo/fail-closed no loader e seu teste):
 * aqui provamos apenas que a page monta o `basePedidos` correto NO SERVIDOR e que
 * `acaoStatus` é a Server Action `atualizarStatusPedidoAdmin` LIGADA ao `lojaId`
 * via `.bind` — invocá-la com `(id, novoStatus)` delega para a action com o
 * `lojaId` da URL fixado no servidor (nunca vindo do cliente).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const PEDIDO_ID = "33333333-3333-3333-3333-333333333333";

const pedidoFake = {
  id: PEDIDO_ID,
  loja_id: LOJA_ID,
  status: "pendente",
  itens_pedido: [],
};

// Loader mockado: já testado à parte (carga-pedido-detalhe.test.ts). Contrato
// da 137: devolve `{ pedido, modulosImpressao, nomeLoja }` (o entitlement da
// loja-ALVO já computado). A page apenas o repassa a DetalhePedido.
const carregarPedidoDetalheAdmin = vi.fn(
  async (_lojaId: string, _id: string) => ({
    pedido: pedidoFake,
    modulosImpressao: ["a4"] as const,
    nomeLoja: "Pizzaria Alvo",
  }),
);
vi.mock("../../carga-pedido-detalhe", () => ({
  carregarPedidoDetalheAdmin: (lojaId: string, id: string) =>
    carregarPedidoDetalheAdmin(lojaId, id),
}));

// Action admin mockada: capturamos os argumentos com que a page a liga/chama.
const atualizarStatusPedidoAdmin = vi.fn(
  async (_lojaId: string, _id: string, _novoStatus: string) => ({
    ok: true as const,
    status: "confirmado" as const,
  }),
);
vi.mock("@/app/admin/assinantes/actions/admin-status", () => ({
  atualizarStatusPedidoAdmin: (lojaId: string, id: string, novoStatus: string) =>
    atualizarStatusPedidoAdmin(lojaId, id, novoStatus),
}));

// DetalhePedido mockado só para identificar o elemento retornado pela page; as
// props são lidas do elemento React (a page devolve o elemento sem renderizá-lo).
vi.mock("@/components/painel/DetalhePedido", () => ({
  DetalhePedido: () => null,
}));

import DetalhePedidoAdminPage from "./page";

type PropsDetalhe = {
  pedido: unknown;
  basePedidos: string;
  acaoStatus: (id: string, novoStatus: string) => unknown;
  modulosImpressao: readonly string[];
  nomeLoja: string;
};

async function renderizarPage(): Promise<PropsDetalhe> {
  const elemento = await DetalhePedidoAdminPage({
    params: Promise.resolve({ lojaId: LOJA_ID, id: PEDIDO_ID }),
  });
  return (elemento as { props: PropsDetalhe }).props;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin de detalhe do pedido — fiação", () => {
  it("carrega o pedido pelo loader escopado e o repassa a DetalhePedido", async () => {
    const props = await renderizarPage();

    expect(carregarPedidoDetalheAdmin).toHaveBeenCalledWith(LOJA_ID, PEDIDO_ID);
    expect(props.pedido).toBe(pedidoFake);
  });

  it("repassa o entitlement da loja-ALVO (modulosImpressao + nomeLoja) a DetalhePedido — parity com o painel", async () => {
    const props = await renderizarPage();

    expect(props.modulosImpressao).toEqual(["a4"]);
    expect(props.nomeLoja).toBe("Pizzaria Alvo");
  });

  it("monta basePedidos escopado no servidor a partir do lojaId da URL", async () => {
    const props = await renderizarPage();

    expect(props.basePedidos).toBe(`/admin/assinantes/${LOJA_ID}/pedidos`);
  });

  it("acaoStatus é a action LIGADA ao lojaId: chamar (id, novoStatus) delega para atualizarStatusPedidoAdmin(lojaId, id, novoStatus)", async () => {
    const props = await renderizarPage();

    const acaoStatus = props.acaoStatus;
    expect(typeof acaoStatus).toBe("function");

    await acaoStatus!(PEDIDO_ID, "confirmado");

    // Prova do `.bind(null, lojaId)`: o lojaId NÃO veio do payload do cliente,
    // foi fixado no servidor; o cliente só forneceu (id, novoStatus).
    expect(atualizarStatusPedidoAdmin).toHaveBeenCalledTimes(1);
    expect(atualizarStatusPedidoAdmin).toHaveBeenCalledWith(
      LOJA_ID,
      PEDIDO_ID,
      "confirmado",
    );
  });
});
