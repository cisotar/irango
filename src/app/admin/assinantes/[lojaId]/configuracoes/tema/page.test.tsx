import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Fiação da sub-rota admin /configuracoes/tema (issue 152). Prova o roteamento
 * loader→wrapper e que o `temaInicial` é DERIVADO do helper compartilhado
 * `montarTemaInicial(loja.tema)` (helper único — sem `lerCor` duplicado).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

const temaJson = { primaria: "#123456" };
const lojaFake = { id: LOJA_ID, nome: "Pizzaria Alvo", tema: temaJson };

const carregarLojaAdminBase = vi.fn(async (_lojaId: string) => lojaFake);
vi.mock("../../carga", () => ({
  carregarLojaAdminBase: (lojaId: string) => carregarLojaAdminBase(lojaId),
}));

// Sentinela: prova que o wrapper recebe o RESULTADO do helper (fiação), não uma
// derivação inline na page.
const TEMA_SENTINELA = {
  primaria: "#123456",
  fundo: "#ffffff",
  destaque: "#f59e0b",
};
const montarTemaInicial = vi.fn((_tema: unknown) => TEMA_SENTINELA);
vi.mock("@/lib/utils/tema", () => ({
  montarTemaInicial: (tema: unknown) => montarTemaInicial(tema),
}));

vi.mock("./TemaAdminClient", () => ({
  TemaAdminClient: () => null,
}));

import { TemaAdminClient } from "./TemaAdminClient";
import TemaConfiguracaoAdminPage from "./page";

type Props = {
  lojaId: string;
  temaInicial: unknown;
  nomeLoja: string;
};

async function renderizar(): Promise<ReactElement<Props>> {
  return (await TemaConfiguracaoAdminPage({
    params: Promise.resolve({ lojaId: LOJA_ID }),
  })) as ReactElement<Props>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin /configuracoes/tema — fiação", () => {
  it("consome o loader base escopado por lojaId (sem createServiceClient inline)", async () => {
    await renderizar();

    expect(carregarLojaAdminBase).toHaveBeenCalledTimes(1);
    expect(carregarLojaAdminBase).toHaveBeenCalledWith(LOJA_ID);
  });

  it("deriva temaInicial pelo helper montarTemaInicial(loja.tema)", async () => {
    const el = await renderizar();

    expect(montarTemaInicial).toHaveBeenCalledWith(temaJson);
    expect(el.props.temaInicial).toBe(TEMA_SENTINELA);
  });

  it("renderiza TemaAdminClient com lojaId + nomeLoja", async () => {
    const el = await renderizar();

    expect(el.type).toBe(TemaAdminClient);
    expect(el.props.lojaId).toBe(LOJA_ID);
    expect(el.props.nomeLoja).toBe("Pizzaria Alvo");
  });
});
