import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Fiação da sub-rota admin /configuracoes/entregas (issue 152). Prova o
 * roteamento loader→wrapper: consome `carregarZonasAdmin(lojaId)` (loader de
 * seção, sem createServiceClient inline) e renderiza `EntregasAdminClient` com
 * `lojaId` + `zonas`.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

const zonasFake = [{ id: "zona-1", loja_id: LOJA_ID, nome: "Centro" }];

const carregarZonasAdmin = vi.fn(async (_lojaId: string) => zonasFake);
vi.mock("../../carga", () => ({
  carregarZonasAdmin: (lojaId: string) => carregarZonasAdmin(lojaId),
}));

vi.mock("./EntregasAdminClient", () => ({
  EntregasAdminClient: () => null,
}));

import { EntregasAdminClient } from "./EntregasAdminClient";
import EntregasConfiguracaoAdminPage from "./page";

type Props = {
  lojaId: string;
  zonas: unknown;
};

async function renderizar(): Promise<ReactElement<Props>> {
  return (await EntregasConfiguracaoAdminPage({
    params: Promise.resolve({ lojaId: LOJA_ID }),
  })) as ReactElement<Props>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin /configuracoes/entregas — fiação", () => {
  it("consome o loader de seção carregarZonasAdmin escopado por lojaId", async () => {
    await renderizar();

    expect(carregarZonasAdmin).toHaveBeenCalledTimes(1);
    expect(carregarZonasAdmin).toHaveBeenCalledWith(LOJA_ID);
  });

  it("renderiza EntregasAdminClient com lojaId + zonas", async () => {
    const el = await renderizar();

    expect(el.type).toBe(EntregasAdminClient);
    expect(el.props.lojaId).toBe(LOJA_ID);
    expect(el.props.zonas).toBe(zonasFake);
  });
});
