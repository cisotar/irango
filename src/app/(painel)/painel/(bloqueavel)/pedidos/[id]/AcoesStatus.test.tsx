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
    // Inválidas a partir de pendente (nenhum salto além do atalho da RN-SC2):
    expect(html).not.toContain("Iniciar preparo");
    // Issue 329 (RN-SC2): o atalho para saiu_entrega aparece em pendente,
    // com confirmação (RN-SC6) — spec status-pedido-clicavel-e-latencia.md.
    expect(html).toContain("Saiu pra entrega");
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

// ---------------------------------------------------------------------------
// (d) ordem RN-SC13 e variante visual (issue 329): próxima etapa (primária,
// variant="default") → atalho (variant="outline") → Cancelar (variant="destructive")
// ---------------------------------------------------------------------------

function render2(statusAtual: StatusPedido, tipoEntrega: string | null): string {
  return renderToStaticMarkup(
    <AcoesStatus pedidoId={PEDIDO_ID} statusAtual={statusAtual} tipoEntrega={tipoEntrega} />,
  );
}

describe("ordem RN-SC13 e variante visual dos botões", () => {
  it("pendente+entrega: ordem é Confirmar, depois o atalho, depois Cancelar", () => {
    const html = render2("pendente", "entrega");
    const posConfirmar = html.indexOf(">Confirmar<");
    const posAtalho = html.indexOf(">Saiu pra entrega<");
    const posCancelar = html.indexOf(">Cancelar<");
    expect(posConfirmar).toBeGreaterThan(-1);
    expect(posAtalho).toBeGreaterThan(posConfirmar);
    expect(posCancelar).toBeGreaterThan(posAtalho);
  });

  it("Confirmar (próxima etapa/principal) usa variant default — fundo bg-primary", () => {
    const html = render2("pendente", "entrega");
    const botaoConfirmar = html.slice(0, html.indexOf(">Confirmar<"));
    const abreBotao = botaoConfirmar.lastIndexOf("<button");
    const tagConfirmar = html.slice(abreBotao, html.indexOf(">Confirmar<"));
    expect(tagConfirmar).toContain("bg-primary");
    expect(tagConfirmar).not.toContain("bg-destructive");
  });

  it("o atalho (pula etapa) usa variant outline — nunca default nem destructive", () => {
    const html = render2("pendente", "entrega");
    const abreBotao = html.lastIndexOf("<button", html.indexOf(">Saiu pra entrega<"));
    const tagAtalho = html.slice(abreBotao, html.indexOf(">Saiu pra entrega<"));
    expect(tagAtalho).toContain("border-border bg-background");
    expect(tagAtalho).not.toContain("bg-primary");
    expect(tagAtalho).not.toContain("bg-destructive");
  });

  it("Cancelar usa variant destructive — fundo bg-destructive", () => {
    const html = render2("pendente", "entrega");
    const abreBotao = html.lastIndexOf("<button", html.indexOf(">Cancelar<"));
    const tagCancelar = html.slice(abreBotao, html.indexOf(">Cancelar<"));
    expect(tagCancelar).toContain("bg-destructive");
    expect(tagCancelar).not.toContain("bg-primary");
  });

  it("em_preparo: só UMA ação de saiu_entrega (a etapa normal), sem atalho duplicado", () => {
    const html = render2("em_preparo", "entrega");
    expect(html.match(/>Saiu pra entrega</g)).toHaveLength(1);
    // É a etapa PRINCIPAL (variant default), não o outline do atalho.
    const abreBotao = html.lastIndexOf("<button", html.indexOf(">Saiu pra entrega<"));
    const tag = html.slice(abreBotao, html.indexOf(">Saiu pra entrega<"));
    expect(tag).toContain("bg-primary");
  });
});

// ---------------------------------------------------------------------------
// (e) rótulo por modalidade (RN-SC11) refletido nos botões do detalhe
// ---------------------------------------------------------------------------

describe("rótulo do atalho/etapa por modalidade (RN-SC11)", () => {
  it("pendente+retirada: atalho mostra 'Pronto para retirada', nunca 'Saiu pra entrega'", () => {
    const html = render2("pendente", "retirada");
    expect(html).toContain("Pronto para retirada");
    expect(html).not.toContain("Saiu pra entrega");
  });

  it("confirmado+retirada: atalho mostra 'Pronto para retirada'", () => {
    const html = render2("confirmado", "retirada");
    expect(html).toContain("Pronto para retirada");
    expect(html).not.toContain("Saiu pra entrega");
  });

  it("em_preparo+retirada: a etapa principal é 'Pronto para retirada' (não duplicada) + Cancelar", () => {
    const html = render2("em_preparo", "retirada");
    expect(html.match(/>Pronto para retirada</g)).toHaveLength(1);
    expect(html).toContain("Cancelar");
    expect(html).not.toContain("Saiu pra entrega");
  });

  it("saiu_entrega (qualquer modalidade): só 'Marcar entregue', nenhum rótulo de saiu_entrega", () => {
    const html = render2("saiu_entrega", "retirada");
    expect(html).toContain("Marcar entregue");
    expect(html).not.toContain("Pronto para retirada");
    expect(html).not.toContain("Saiu pra entrega");
  });
});
