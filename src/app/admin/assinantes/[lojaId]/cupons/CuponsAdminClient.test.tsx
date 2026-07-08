/**
 * Teste de FIAÇÃO (issue 136 — não crítica) do `CuponsAdminClient`. Prova que o
 * wrapper admin injeta as actions admin de cupom
 * (`criarCupomAdmin`/`atualizarCupomAdmin`/`removerCupomAdmin`) no `CuponsClient`
 * com o `lojaId` da URL fixado por closure — e que os defaults do LOJISTA
 * (`criarCupom`/`atualizarCupom`/`removerCupom`) NUNCA são referenciados no
 * caminho admin (senão a escrita recairia na loja DO ADMIN via auth, não na
 * loja-alvo — escrita cross-tenant silenciosa). A autoridade real continua nas
 * actions do servidor (134); este teste só cobre a montagem da chamada.
 *
 * Ambiente: environment=node, sem jsdom/@testing-library (padrão do projeto —
 * ver ConfiguracaoAdminClient.test.tsx). A prova de wiring é feita CAPTURANDO o
 * objeto `acoes` que o `CuponsAdminClient` injeta no `CuponsClient` (stub) e
 * INVOCANDO cada operação, então asserindo qual action foi chamada e com quais
 * argumentos.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111";

// Captura do objeto `acoes` injetado no CuponsClient. `vi.hoisted` roda antes
// dos `vi.mock` hoisted, então a referência existe quando o factory executa.
const capturado = vi.hoisted(() => ({
  acoes: undefined as
    | {
        criar?: (payload: unknown) => unknown;
        atualizar?: (id: string, payload: unknown) => unknown;
        remover?: (id: string) => unknown;
      }
    | undefined,
}));

// --- CuponsClient: stub que captura `acoes` sem renderizar a árvore real ---
vi.mock("@/app/(painel)/painel/(bloqueavel)/cupons/CuponsClient", () => ({
  CuponsClient: (props: { acoes?: unknown }) => {
    capturado.acoes = props.acoes as (typeof capturado)["acoes"];
    return null;
  },
}));

// --- actions admin de cupom (alvo do wiring desta issue) ---
vi.mock("@/app/admin/assinantes/actions/admin-cupom", () => ({
  criarCupomAdmin: vi.fn(async () => ({ ok: true })),
  atualizarCupomAdmin: vi.fn(async () => ({ ok: true })),
  removerCupomAdmin: vi.fn(async () => ({ ok: true })),
}));

// --- defaults do LOJISTA: devem permanecer intocados no caminho admin ---
vi.mock("@/lib/actions/cupom", () => ({
  criarCupom: vi.fn(async () => ({ ok: true })),
  atualizarCupom: vi.fn(async () => ({ ok: true })),
  removerCupom: vi.fn(async () => ({ ok: true })),
}));

import { CuponsAdminClient } from "./CuponsAdminClient";
import {
  criarCupomAdmin,
  atualizarCupomAdmin,
  removerCupomAdmin,
} from "@/app/admin/assinantes/actions/admin-cupom";
import { criarCupom, atualizarCupom, removerCupom } from "@/lib/actions/cupom";

function renderizar(lojaId = LOJA_ALVO) {
  // `cupons` é irrelevante ao wiring (CuponsClient é stub) — só o `lojaId` importa.
  renderToStaticMarkup(
    <CuponsAdminClient lojaId={lojaId} cupons={[]} />,
  );
}

describe("CuponsAdminClient — fiação das actions admin de cupom (issue 136)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturado.acoes = undefined;
  });

  it("injeta acoes.criar/atualizar/remover no CuponsClient (todas funções)", () => {
    renderizar();
    expect(capturado.acoes?.criar).toBeTypeOf("function");
    expect(capturado.acoes?.atualizar).toBeTypeOf("function");
    expect(capturado.acoes?.remover).toBeTypeOf("function");
  });

  it("criar(payload) chama criarCupomAdmin(lojaId, payload) — nunca criarCupom", async () => {
    renderizar();
    const payload = { codigo: "PROMO10" };
    await capturado.acoes!.criar!(payload);

    expect(criarCupomAdmin).toHaveBeenCalledTimes(1);
    expect(criarCupomAdmin).toHaveBeenCalledWith(LOJA_ALVO, payload);
    expect(criarCupom).not.toHaveBeenCalled();
  });

  it("atualizar(id, payload) chama atualizarCupomAdmin(lojaId, id, payload) — nunca atualizarCupom", async () => {
    renderizar();
    const payload = { valor: 15 };
    await capturado.acoes!.atualizar!("cupom-1", payload);

    expect(atualizarCupomAdmin).toHaveBeenCalledTimes(1);
    expect(atualizarCupomAdmin).toHaveBeenCalledWith(LOJA_ALVO, "cupom-1", payload);
    expect(atualizarCupom).not.toHaveBeenCalled();
  });

  it("remover(id) chama removerCupomAdmin(lojaId, id) — nunca removerCupom", async () => {
    renderizar();
    await capturado.acoes!.remover!("cupom-2");

    expect(removerCupomAdmin).toHaveBeenCalledTimes(1);
    expect(removerCupomAdmin).toHaveBeenCalledWith(LOJA_ALVO, "cupom-2");
    expect(removerCupom).not.toHaveBeenCalled();
  });

  it("usa o lojaId da URL como escopo (loja-alvo, não a do admin)", async () => {
    const OUTRA_LOJA = "99999999-9999-4999-8999-999999999999";
    renderizar(OUTRA_LOJA);
    await capturado.acoes!.criar!({ codigo: "X" });

    expect(criarCupomAdmin).toHaveBeenCalledWith(OUTRA_LOJA, { codigo: "X" });
  });
});
