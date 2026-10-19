import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Fiação da sub-rota admin /configuracoes/entregas (issue 152). Prova o
 * roteamento loader→wrapper: consome `carregarZonasAdmin(lojaId)` (loader de
 * seção, sem createServiceClient inline) e renderiza `EntregasAdminClient` com
 * `lojaId` + `zonas` + `versao` (versão otimista lida no mesmo select das zonas,
 * issue 328). (spec modalidades-entrega-loja) Também lê a loja pelo
 * loader `carregarLojaAdminBase(lojaId)` e repassa as modalidades gravadas e o
 * fallback fora-de-zona. Issue 327: das coordenadas da loja só o boolean
 * `temCoordenadas` chega ao wrapper, junto do link de Perfil do hub admin.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

const zonasFake = [{ id: "zona-1", loja_id: LOJA_ID, nome: "Centro" }];

const carregarZonasAdmin = vi.fn(async (_lojaId: string) => ({ versao: 5, zonas: zonasFake }));
const lojaFake = {
  id: LOJA_ID,
  aceita_retirada: false,
  aceita_entrega: true,
  modo_frete: "a_combinar",
  taxa_entrega_fora_zona: 8,
};
const carregarLojaAdminBase = vi.fn(async (_lojaId: string) => lojaFake);
vi.mock("../../carga", () => ({
  carregarZonasAdmin: (lojaId: string) => carregarZonasAdmin(lojaId),
  carregarLojaAdminBase: (lojaId: string) => carregarLojaAdminBase(lojaId),
}));

vi.mock("./EntregasAdminClient", () => ({
  EntregasAdminClient: () => null,
}));

import { EntregasAdminClient } from "./EntregasAdminClient";
import EntregasConfiguracaoAdminPage from "./page";

type Props = {
  lojaId: string;
  zonas: unknown;
  versao: unknown;
  temCoordenadas: unknown;
  hrefPerfil: unknown;
  modalidades: unknown;
  taxaForaZona: unknown;
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

  it("renderiza EntregasAdminClient com lojaId + zonas + versao", async () => {
    const el = await renderizar();

    expect(el.type).toBe(EntregasAdminClient);
    expect(el.props.lojaId).toBe(LOJA_ID);
    expect(el.props.zonas).toBe(zonasFake);
    expect(el.props.versao).toBe(5);
  });

  it("lê a loja escopada por lojaId e repassa modalidades + fallback fora-de-zona", async () => {
    const el = await renderizar();

    expect(carregarLojaAdminBase).toHaveBeenCalledWith(LOJA_ID);
    expect(el.props.modalidades).toEqual({
      aceita_retirada: false,
      aceita_entrega: true,
      modo_frete: "a_combinar",
    });
    expect(el.props.taxaForaZona).toBe(8);
  });

  it("[327] repassa só o boolean temCoordenadas (nunca latitude/longitude) e o Perfil do hub admin", async () => {
    const el = await renderizar();

    expect(el.props.temCoordenadas).toBe(false);
    expect(el.props.hrefPerfil).toBe(`/admin/assinantes/${LOJA_ID}/configuracoes/perfil`);
    expect(Object.keys(el.props)).not.toContain("latitude");
    expect(Object.keys(el.props)).not.toContain("longitude");
  });

  it("[327] loja com as duas coordenadas ⇒ temCoordenadas true", async () => {
    carregarLojaAdminBase.mockResolvedValueOnce({ ...lojaFake, latitude: -10, longitude: -20 } as typeof lojaFake);

    const el = await renderizar();

    expect(el.props.temCoordenadas).toBe(true);
  });
});
