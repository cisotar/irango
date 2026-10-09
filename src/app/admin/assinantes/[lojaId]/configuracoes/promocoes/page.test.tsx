import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * [362] Fiação da sub-rota admin `/configuracoes/promocoes` (Avisos). Molde:
 * `configuracoes/tema/page.test.tsx`.
 *
 * Prova três coisas que a page NÃO pode terceirizar:
 *  - o dado vem do LOADER escopado por `lojaId` (`carregarPromocoesAdmin`), que
 *    é quem valida o id, prova admin e eleva a service_role — a page nunca
 *    chama `createServiceClient` (ver `enforcement-escopo-admin.test.ts`);
 *  - `lojaId`, linhas e categorias chegam ao wrapper admin (que injeta as 5
 *    actions com o `lojaId` fixado por closure);
 *  - o `estado` do badge é DERIVADO NO SERVIDOR por `estadoDoModalSazonal`, com
 *    UM único `agora` para a página inteira (duas linhas nunca discordam sobre
 *    que instante é este), e a mensagem passa pelo parse fail-closed
 *    `lerMensagemModal`.
 */

const LOJA_ID = "11111111-1111-4111-8111-111111111111";

const modalA = {
  id: "22222222-2222-4222-8222-222222222222",
  loja_id: LOJA_ID,
  titulo: "Festa junina",
  mensagem: { versao: 1, paragrafos: [] },
  ativo: true,
  exibicao_inicio: "2026-06-01T00:00:00-03:00",
  exibicao_fim: "2026-06-30T23:59:59-03:00",
  mostrar_promocoes_junto: false,
  criado_em: "2026-05-01T00:00:00-03:00",
  atualizado_em: "2026-05-01T00:00:00-03:00",
  categorias: ["33333333-3333-4333-8333-333333333333"],
  cardapios: [],
};
const modalB = { ...modalA, id: "44444444-4444-4444-8444-444444444444", ativo: false };

const categorias = [
  { id: "33333333-3333-4333-8333-333333333333", nome: "Doces", loja_id: LOJA_ID, ordem: 1 },
];

const carregarPromocoesAdmin = vi.fn(async (_lojaId: string) => ({
  modais: [modalA, modalB],
  categorias,
}));
vi.mock("../../carga-promocoes", () => ({
  carregarPromocoesAdmin: (lojaId: string) => carregarPromocoesAdmin(lojaId),
}));

// Sentinelas: provam que a page usa os helpers compartilhados, sem derivação
// inline nem relógio do browser.
const ESTADO_SENTINELA = { tom: "verde", rotulo: "Ativo" };
const estadoDoModalSazonal = vi.fn((_m: unknown, _agora: Date) => ESTADO_SENTINELA);
vi.mock("@/lib/utils/estadoModalSazonal", () => ({
  estadoDoModalSazonal: (m: unknown, agora: Date) => estadoDoModalSazonal(m, agora),
}));

const MENSAGEM_SENTINELA = { versao: 1, paragrafos: [] };
const lerMensagemModal = vi.fn((_raw: unknown, _ctx: unknown) => MENSAGEM_SENTINELA);
vi.mock("@/lib/validacoes/mensagemModal", () => ({
  lerMensagemModal: (raw: unknown, ctx: unknown) => lerMensagemModal(raw, ctx),
}));

vi.mock("./PromocoesAdminClient", () => ({
  PromocoesAdminClient: () => null,
}));

import { PromocoesAdminClient } from "./PromocoesAdminClient";
import PromocoesAdminPage from "./page";

type Props = {
  lojaId: string;
  modais: { id: string; estado: unknown; mensagem: unknown; categorias: string[] }[];
  categorias: { id: string; nome: string }[];
};

async function renderizar(): Promise<ReactElement<Props>> {
  return (await PromocoesAdminPage({
    params: Promise.resolve({ lojaId: LOJA_ID }),
  })) as ReactElement<Props>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("[362] page admin /configuracoes/promocoes — fiação", () => {
  it("consome o loader escopado por lojaId (sem createServiceClient inline)", async () => {
    await renderizar();

    expect(carregarPromocoesAdmin).toHaveBeenCalledTimes(1);
    expect(carregarPromocoesAdmin).toHaveBeenCalledWith(LOJA_ID);
  });

  it("renderiza PromocoesAdminClient com lojaId, as linhas e as categorias", async () => {
    const el = await renderizar();

    expect(el.type).toBe(PromocoesAdminClient);
    expect(el.props.lojaId).toBe(LOJA_ID);
    expect(el.props.modais.map((m) => m.id)).toEqual([modalA.id, modalB.id]);
    expect(el.props.categorias).toEqual([{ id: categorias[0].id, nome: "Doces" }]);
  });

  it("o estado do badge é derivado no SERVIDOR, com UM único `agora` para as duas linhas", async () => {
    const el = await renderizar();

    expect(estadoDoModalSazonal).toHaveBeenCalledTimes(2);
    const [, agora1] = estadoDoModalSazonal.mock.calls[0];
    const [, agora2] = estadoDoModalSazonal.mock.calls[1];
    expect(agora1).toBeInstanceOf(Date);
    // A MESMA instância, não duas datas "parecidas".
    expect(agora2).toBe(agora1);
    expect(el.props.modais.every((m) => m.estado === ESTADO_SENTINELA)).toBe(true);
  });

  it("a mensagem passa pelo parse fail-closed lerMensagemModal, com lojaId e modalId no contexto", async () => {
    const el = await renderizar();

    expect(lerMensagemModal).toHaveBeenCalledWith(modalA.mensagem, {
      lojaId: LOJA_ID,
      modalId: modalA.id,
    });
    expect(el.props.modais.every((m) => m.mensagem === MENSAGEM_SENTINELA)).toBe(true);
  });
});
