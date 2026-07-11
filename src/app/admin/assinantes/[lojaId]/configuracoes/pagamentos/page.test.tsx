import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Fiação da sub-rota admin /configuracoes/pagamentos (issue 152). Prova o
 * roteamento loader→wrapper: consome `carregarFormasPagamentoAdmin(lojaId)`
 * (loader de seção, sem createServiceClient inline) e renderiza
 * `PagamentosAdminClient` com `lojaId` + `formasPagamento`.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

const formasFake = [{ id: "forma-1", loja_id: LOJA_ID, tipo: "pix" }];

const carregarFormasPagamentoAdmin = vi.fn(async (_lojaId: string) => formasFake);
vi.mock("../../carga", () => ({
  carregarFormasPagamentoAdmin: (lojaId: string) =>
    carregarFormasPagamentoAdmin(lojaId),
}));

vi.mock("./PagamentosAdminClient", () => ({
  PagamentosAdminClient: () => null,
}));

import { PagamentosAdminClient } from "./PagamentosAdminClient";
import PagamentosConfiguracaoAdminPage from "./page";

type Props = {
  lojaId: string;
  formasPagamento: unknown;
};

async function renderizar(): Promise<ReactElement<Props>> {
  return (await PagamentosConfiguracaoAdminPage({
    params: Promise.resolve({ lojaId: LOJA_ID }),
  })) as ReactElement<Props>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin /configuracoes/pagamentos — fiação", () => {
  it("consome o loader de seção carregarFormasPagamentoAdmin escopado por lojaId", async () => {
    await renderizar();

    expect(carregarFormasPagamentoAdmin).toHaveBeenCalledTimes(1);
    expect(carregarFormasPagamentoAdmin).toHaveBeenCalledWith(LOJA_ID);
  });

  it("renderiza PagamentosAdminClient com lojaId + formasPagamento", async () => {
    const el = await renderizar();

    expect(el.type).toBe(PagamentosAdminClient);
    expect(el.props.lojaId).toBe(LOJA_ID);
    expect(el.props.formasPagamento).toBe(formasFake);
  });
});
