/**
 * Fiação do `AssinaturaAdminClient` (issue 153). Prova que o wrapper admin injeta
 * as 4 actions admin de billing (`iniciarAssinaturaAdmin`/`trocarPlanoAdmin`/
 * `atualizarMeioPagamentoAssinaturaAdmin`/`cancelarAssinaturaAdmin`) no
 * `GerenciarAssinaturaClient` com o `lojaId` da URL fixado por closure — e que os
 * defaults do LOJISTA (`@/lib/actions/assinatura`) NUNCA são chamados no caminho admin.
 *
 * Por que é invariante de SEGURANÇA (specs/configuracoes-admin-subrotas.md): se o
 * wrapper recaísse no default do lojista, as actions derivariam a loja pelo AUTH do
 * admin (`buscarLojaDoDono`) e operariam a assinatura DO ADMIN, não a loja-alvo —
 * escrita cross-tenant errada e silenciosa. A fiação correta (lojaId da URL →
 * action admin) fecha esse vetor.
 *
 * Ambiente node, sem jsdom: a prova de wiring CAPTURA a prop `acoes` que o
 * `AssinaturaAdminClient` injeta no `GerenciarAssinaturaClient` (stub) e INVOCA
 * cada função, asserindo qual action foi chamada e com qual `lojaId`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AcoesAssinatura } from "@/components/painel/GerenciarAssinaturaClient";

const LOJA_ID = "11111111-1111-4111-8111-111111111111";

// Captura da prop `acoes` injetada no GerenciarAssinaturaClient. `vi.hoisted` roda
// antes dos `vi.mock` hoisted, então a referência existe quando o factory executa.
const capturado = vi.hoisted(() => ({
  acoes: undefined as AcoesAssinatura | undefined,
}));

// Stub do client de painel: captura `acoes` e não renderiza a árvore real.
vi.mock("@/components/painel/GerenciarAssinaturaClient", () => ({
  GerenciarAssinaturaClient: (props: { acoes?: AcoesAssinatura }) => {
    capturado.acoes = props.acoes;
    return null;
  },
}));

// Actions admin (alvo do wiring desta issue).
vi.mock("@/app/admin/assinantes/actions/admin-assinatura", () => ({
  iniciarAssinaturaAdmin: vi.fn(async () => ({ ok: true })),
  trocarPlanoAdmin: vi.fn(async () => ({ ok: true })),
  atualizarMeioPagamentoAssinaturaAdmin: vi.fn(async () => ({
    ok: true,
    url: "https://provider.local/pay",
  })),
  cancelarAssinaturaAdmin: vi.fn(async () => ({ ok: true })),
}));

// Defaults do LOJISTA: devem permanecer intocados no caminho admin.
vi.mock("@/lib/actions/assinatura", () => ({
  iniciarAssinatura: vi.fn(async () => ({ ok: true })),
  trocarPlano: vi.fn(async () => ({ ok: true })),
  atualizarMeioPagamentoAssinatura: vi.fn(async () => ({ ok: true })),
  cancelarAssinatura: vi.fn(async () => ({ ok: true })),
}));

import { AssinaturaAdminClient } from "./AssinaturaAdminClient";
import {
  iniciarAssinaturaAdmin,
  trocarPlanoAdmin,
  atualizarMeioPagamentoAssinaturaAdmin,
  cancelarAssinaturaAdmin,
} from "@/app/admin/assinantes/actions/admin-assinatura";
import {
  iniciarAssinatura,
  trocarPlano,
  atualizarMeioPagamentoAssinatura,
  cancelarAssinatura,
} from "@/lib/actions/assinatura";

function renderizar(lojaId = LOJA_ID) {
  renderToStaticMarkup(
    <AssinaturaAdminClient
      lojaId={lojaId}
      planos={[{ id: "plano-1", nome: "Mensal", preco: 5000, intervalo: "mês" }]}
      planoAtualId={null}
      temAssinatura={false}
    />,
  );
}

describe("AssinaturaAdminClient — fiação das 4 actions admin de billing (issue 153)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturado.acoes = undefined;
  });

  it("injeta as 4 acoes no GerenciarAssinaturaClient (todas funções)", () => {
    renderizar();
    expect(capturado.acoes).toBeDefined();
    expect(capturado.acoes!.iniciarAssinatura).toBeTypeOf("function");
    expect(capturado.acoes!.trocarPlano).toBeTypeOf("function");
    expect(capturado.acoes!.atualizarMeioPagamentoAssinatura).toBeTypeOf(
      "function",
    );
    expect(capturado.acoes!.cancelarAssinatura).toBeTypeOf("function");
  });

  it("iniciarAssinatura(payload) → iniciarAssinaturaAdmin(lojaId, payload) — nunca o default do lojista", async () => {
    renderizar();
    const payload = { plano_id: "plano-1" };

    await capturado.acoes!.iniciarAssinatura(payload);

    expect(iniciarAssinaturaAdmin).toHaveBeenCalledTimes(1);
    expect(iniciarAssinaturaAdmin).toHaveBeenCalledWith(LOJA_ID, payload);
    expect(iniciarAssinatura).not.toHaveBeenCalled();
  });

  it("trocarPlano(payload) → trocarPlanoAdmin(lojaId, payload) — nunca o default do lojista", async () => {
    renderizar();
    const payload = { plano_id: "plano-2" };

    await capturado.acoes!.trocarPlano(payload);

    expect(trocarPlanoAdmin).toHaveBeenCalledTimes(1);
    expect(trocarPlanoAdmin).toHaveBeenCalledWith(LOJA_ID, payload);
    expect(trocarPlano).not.toHaveBeenCalled();
  });

  it("atualizarMeioPagamentoAssinatura() → atualizarMeioPagamentoAssinaturaAdmin(lojaId) — nunca o default", async () => {
    renderizar();

    await capturado.acoes!.atualizarMeioPagamentoAssinatura();

    expect(atualizarMeioPagamentoAssinaturaAdmin).toHaveBeenCalledTimes(1);
    expect(atualizarMeioPagamentoAssinaturaAdmin).toHaveBeenCalledWith(LOJA_ID);
    expect(atualizarMeioPagamentoAssinatura).not.toHaveBeenCalled();
  });

  it("cancelarAssinatura() → cancelarAssinaturaAdmin(lojaId) — nunca o default do lojista", async () => {
    renderizar();

    await capturado.acoes!.cancelarAssinatura();

    expect(cancelarAssinaturaAdmin).toHaveBeenCalledTimes(1);
    expect(cancelarAssinaturaAdmin).toHaveBeenCalledWith(LOJA_ID);
    expect(cancelarAssinatura).not.toHaveBeenCalled();
  });

  it("o lojaId fixado vem da closure/URL: OUTRA loja → a action admin recebe o lojaId dado, não o default", async () => {
    const OUTRA_LOJA = "99999999-9999-4999-8999-999999999999";
    renderizar(OUTRA_LOJA);

    await capturado.acoes!.cancelarAssinatura();

    expect(cancelarAssinaturaAdmin).toHaveBeenCalledWith(OUTRA_LOJA);
  });
});
