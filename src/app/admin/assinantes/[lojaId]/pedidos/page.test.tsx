import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED — issue 329 (F4), spec `specs/status-pedido-clicavel-e-latencia.md`
 * página 5. A aba Pedidos do hub admin passa a injetar
 * `acaoStatus={atualizarStatusPedidoAdmin.bind(null, lojaId)}` em
 * `PedidosClient` (padrão de `pedidos/[id]/page.tsx:47` e do seu teste).
 *
 * Fail-closed: sem a prop, o selo clicável cairia na action do LOJISTA, que a
 * RLS zera para o admin. Aqui provamos que `acaoStatus(id, novo)` delega para a
 * action ADMIN com o `lojaId` da URL fixado no servidor.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const PEDIDO_ID = "33333333-3333-3333-3333-333333333333";

const carregarDashboardLojaAdmin = vi.fn(async (_lojaId: string) => [] as unknown[]);
vi.mock("../carga-pedidos", () => ({
  carregarDashboardLojaAdmin: (lojaId: string) => carregarDashboardLojaAdmin(lojaId),
}));

const atualizarStatusPedidoAdmin = vi.fn(
  async (_lojaId: string, _id: string, _novoStatus: string) => ({
    ok: true as const,
    status: "saiu_entrega" as const,
  }),
);
vi.mock("@/app/admin/assinantes/actions/admin-status", () => ({
  atualizarStatusPedidoAdmin: (lojaId: string, id: string, novoStatus: string) =>
    atualizarStatusPedidoAdmin(lojaId, id, novoStatus),
}));

const atualizarStatusPedido = vi.fn();
vi.mock("@/lib/actions/status", () => ({
  atualizarStatusPedido: (...a: unknown[]) => atualizarStatusPedido(...a),
}));

vi.mock("@/app/(painel)/painel/(bloqueavel)/pedidos/PedidosClient", () => ({
  PedidosClient: () => null,
}));

import PedidosAdminPage from "./page";

type PropsPedidosClient = {
  pedidos: unknown[];
  basePedidos: string;
  acaoStatus?: (id: string, novoStatus: string) => unknown;
};

async function propsPedidosClient(): Promise<PropsPedidosClient> {
  const elemento = await PedidosAdminPage({ params: Promise.resolve({ lojaId: LOJA_ID }) });
  return (elemento as { props: PropsPedidosClient }).props;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin da lista de pedidos — fiação (issue 329)", () => {
  it("[trava] carrega pelo loader escopado e monta basePedidos no servidor", async () => {
    const props = await propsPedidosClient();
    expect(carregarDashboardLojaAdmin).toHaveBeenCalledWith(LOJA_ID);
    expect(props.basePedidos).toBe(`/admin/assinantes/${LOJA_ID}/pedidos`);
  });

  it("acaoStatus é a action ADMIN ligada ao lojaId: acaoStatus(id, novo) → atualizarStatusPedidoAdmin(lojaId, id, novo)", async () => {
    const props = await propsPedidosClient();
    expect(typeof props.acaoStatus).toBe("function");

    await props.acaoStatus!(PEDIDO_ID, "saiu_entrega");

    expect(atualizarStatusPedidoAdmin).toHaveBeenCalledTimes(1);
    expect(atualizarStatusPedidoAdmin).toHaveBeenCalledWith(LOJA_ID, PEDIDO_ID, "saiu_entrega");
    expect(atualizarStatusPedido).not.toHaveBeenCalled();
  });
});
