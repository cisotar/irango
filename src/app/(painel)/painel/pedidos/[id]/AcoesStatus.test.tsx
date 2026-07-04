/**
 * Testes do AcoesStatus (issue 124 — prop `acao?` injetável).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), mesmo padrão do projeto
 * (ThumbProduto.test.tsx, FormProduto.test.tsx).
 *
 * Cobertura possível sem jsdom (render estático):
 *   (a) status intermediário exibe SÓ os rótulos das transições válidas
 *       (fonte única: transicaoPermitida) e nenhuma inválida;
 *   (b) status terminal exibe a mensagem de finalizado, sem botões.
 *
 * Limitação honesta: o disparo de onClick e, portanto, qual action (`acao ??
 * atualizarStatusPedido`) é de fato invocada NÃO é observável em
 * renderToStaticMarkup. A compatibilidade da assinatura de `acao` é garantida
 * pelo compilador (tsc) e o fluxo de ponta a ponta é coberto em 140/`verificar`.
 * Não introduzimos jsdom só por isso. Aqui provamos apenas que aceitar o prop
 * `acao` não altera o que a UI renderiza (zero regressão no painel do lojista).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// AcoesStatus chama useRouter() no topo (client component) para o refresh
// pós-transição; SSR estático não tem App Router montado, então o hook é
// mockado apenas para o componente renderizar (infra de render, sem relação
// com o que o teste cobre).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { AcoesStatus } from "./AcoesStatus";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

const PEDIDO_ID = "abcdef12-3456-7890-abcd-ef1234567890";

function render(statusAtual: StatusPedido, acao?: Parameters<typeof AcoesStatus>[0]["acao"]): string {
  return renderToStaticMarkup(
    <AcoesStatus pedidoId={PEDIDO_ID} statusAtual={statusAtual} acao={acao} />,
  );
}

// ---------------------------------------------------------------------------
// (a) status intermediário → exibe só as transições válidas
// ---------------------------------------------------------------------------

describe("transições exibidas por status (fonte única transicaoPermitida)", () => {
  it("pendente exibe Confirmar e Cancelar, e nenhuma transição inválida", () => {
    const html = render("pendente");
    expect(html).toContain("Confirmar");
    expect(html).toContain("Cancelar");
    // Inválidas a partir de pendente (não deve haver salto):
    expect(html).not.toContain("Iniciar preparo");
    expect(html).not.toContain("Saiu pra entrega");
    expect(html).not.toContain("Marcar entregue");
  });

  it("em_preparo exibe Saiu pra entrega e Cancelar, sem reversão", () => {
    const html = render("em_preparo");
    expect(html).toContain("Saiu pra entrega");
    expect(html).toContain("Cancelar");
    expect(html).not.toContain("Confirmar");
    expect(html).not.toContain("Marcar entregue");
  });

  it("saiu_entrega exibe apenas Marcar entregue (sem opção de cancelar)", () => {
    const html = render("saiu_entrega");
    expect(html).toContain("Marcar entregue");
    expect(html).not.toContain("Cancelar");
    expect(html).not.toContain("Saiu pra entrega");
  });
});

// ---------------------------------------------------------------------------
// (b) status terminal → mensagem de finalizado, sem botões
// ---------------------------------------------------------------------------

describe("status terminal", () => {
  it("entregue exibe a mensagem de finalizado e nenhum botão", () => {
    const html = render("entregue");
    expect(html).toContain("Este pedido está finalizado");
    expect(html).not.toContain("<button");
  });

  it("cancelado exibe a mensagem de finalizado e nenhum botão", () => {
    const html = render("cancelado");
    expect(html).toContain("Este pedido está finalizado");
    expect(html).not.toContain("<button");
  });
});

// ---------------------------------------------------------------------------
// (c) o prop `acao` injetado não altera a UI renderizada (zero regressão)
// ---------------------------------------------------------------------------

describe("prop acao injetada", () => {
  it("com acao custom, renderiza os mesmos botões que o default (só troca o alvo)", () => {
    const acao = vi.fn(async () => ({ ok: true, status: "confirmado" }) as const);
    const comAcao = render("pendente", acao);
    const semAcao = render("pendente");
    expect(comAcao).toBe(semAcao);
    // Render estático não dispara onClick; a action injetada não é chamada aqui.
    expect(acao).not.toHaveBeenCalled();
  });
});
