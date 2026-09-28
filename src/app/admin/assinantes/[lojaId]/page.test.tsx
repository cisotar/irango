import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Fase RED — issue 329 (F4), spec `specs/status-pedido-clicavel-e-latencia.md`
 * página 4. Fiação do dashboard da loja-alvo no hub admin: a page passa a
 * injetar `acaoStatus={atualizarStatusPedidoAdmin.bind(null, lojaId)}` em
 * `DashboardLoja` (mesmo padrão de `pedidos/[id]/page.tsx:47` e do seu teste).
 *
 * Fail-closed: sem a prop, o selo clicável cairia na action do LOJISTA, que a
 * RLS zera para o admin (0 linhas) — nada vaza, mas o hub fica sem ação. Aqui
 * provamos que `acaoStatus(id, novo)` delega para a action ADMIN com o `lojaId`
 * da URL fixado no servidor (nunca vindo do cliente).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const PEDIDO_ID = "33333333-3333-3333-3333-333333333333";

const pedidosFake = [{ id: PEDIDO_ID, status: "pendente", itens_pedido: [] }];

const carregarDashboardLojaAdmin = vi.fn(async (_lojaId: string) => pedidosFake);
vi.mock("./carga-pedidos", () => ({
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

// Action do LOJISTA: se a page cair nela, o teste acusa (não pode ser chamada).
const atualizarStatusPedido = vi.fn();
vi.mock("@/lib/actions/status", () => ({
  atualizarStatusPedido: (...a: unknown[]) => atualizarStatusPedido(...a),
}));

function DashboardLojaFalso() {
  return null;
}
vi.mock("@/components/painel/DashboardLoja", () => ({
  DashboardLoja: DashboardLojaFalso,
}));

import DashboardLojaAdminPage from "./page";

type PropsDashboard = {
  pedidos: unknown;
  basePedidos: string;
  acaoStatus?: (id: string, novoStatus: string) => unknown;
};

/** A page devolve `<div>` com `<h1>` + `<DashboardLoja>`: acha o elemento sem renderizar. */
function acharDashboard(no: ReactNode): ReactElement<PropsDashboard> | null {
  if (Array.isArray(no)) {
    for (const filho of no) {
      const achado = acharDashboard(filho);
      if (achado) return achado;
    }
    return null;
  }
  if (!isValidElement(no)) return null;
  if (no.type === DashboardLojaFalso) return no as ReactElement<PropsDashboard>;
  return acharDashboard((no.props as { children?: ReactNode }).children);
}

async function propsDashboard(): Promise<PropsDashboard> {
  const elemento = await DashboardLojaAdminPage({ params: Promise.resolve({ lojaId: LOJA_ID }) });
  const dash = acharDashboard(elemento);
  expect(dash).not.toBeNull();
  return dash!.props;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin do dashboard da loja-alvo — fiação (issue 329)", () => {
  it("[trava] carrega pelo loader escopado e repassa pedidos + basePedidos", async () => {
    const props = await propsDashboard();
    expect(carregarDashboardLojaAdmin).toHaveBeenCalledWith(LOJA_ID);
    expect(props.pedidos).toBe(pedidosFake);
    expect(props.basePedidos).toBe(`/admin/assinantes/${LOJA_ID}/pedidos`);
  });

  it("acaoStatus é a action ADMIN ligada ao lojaId: acaoStatus(id, novo) → atualizarStatusPedidoAdmin(lojaId, id, novo)", async () => {
    const props = await propsDashboard();
    expect(typeof props.acaoStatus).toBe("function");

    await props.acaoStatus!(PEDIDO_ID, "saiu_entrega");

    expect(atualizarStatusPedidoAdmin).toHaveBeenCalledTimes(1);
    expect(atualizarStatusPedidoAdmin).toHaveBeenCalledWith(LOJA_ID, PEDIDO_ID, "saiu_entrega");
    expect(atualizarStatusPedido).not.toHaveBeenCalled();
  });
});
