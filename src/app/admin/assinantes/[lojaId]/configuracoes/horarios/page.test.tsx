import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Fiação da sub-rota admin /configuracoes/horarios (issue 152). Prova o
 * roteamento loader→wrapper: consome `carregarLojaAdminBase(lojaId)` e renderiza
 * `HorariosAdminClient` com `lojaId` + `inicial` (horários) + `timezone`.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

const horariosFake = { seg: { abre: "08:00", fecha: "18:00", ativo: true } };
const lojaFake = {
  id: LOJA_ID,
  horarios: horariosFake,
  timezone: "America/Sao_Paulo",
};

const carregarLojaAdminBase = vi.fn(async (_lojaId: string) => lojaFake);
vi.mock("../../carga", () => ({
  carregarLojaAdminBase: (lojaId: string) => carregarLojaAdminBase(lojaId),
}));

vi.mock("./HorariosAdminClient", () => ({
  HorariosAdminClient: () => null,
}));

import { HorariosAdminClient } from "./HorariosAdminClient";
import HorariosConfiguracaoAdminPage from "./page";

type Props = {
  lojaId: string;
  inicial: unknown;
  timezone: string;
};

async function renderizar(): Promise<ReactElement<Props>> {
  return (await HorariosConfiguracaoAdminPage({
    params: Promise.resolve({ lojaId: LOJA_ID }),
  })) as ReactElement<Props>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin /configuracoes/horarios — fiação", () => {
  it("consome o loader base escopado por lojaId (sem createServiceClient inline)", async () => {
    await renderizar();

    expect(carregarLojaAdminBase).toHaveBeenCalledTimes(1);
    expect(carregarLojaAdminBase).toHaveBeenCalledWith(LOJA_ID);
  });

  it("renderiza HorariosAdminClient com lojaId + horarios + timezone", async () => {
    const el = await renderizar();

    expect(el.type).toBe(HorariosAdminClient);
    expect(el.props.lojaId).toBe(LOJA_ID);
    expect(el.props.inicial).toBe(horariosFake);
    expect(el.props.timezone).toBe("America/Sao_Paulo");
  });
});
