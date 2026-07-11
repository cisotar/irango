/**
 * Testes de fiação para `GerenciarAssinaturaClient` (issue 148 — prop `acoes?`
 * injetável; default = as 4 actions do lojista).
 *
 * Ambiente: vitest environment=node — SEM jsdom (decisão consciente: disco
 * quase cheio + preserva o precedente "environment node" do projeto; ver
 * ProdutosClient.test.tsx e AcoesStatus.test.tsx; jsdom /
 * @testing-library/react / react-test-renderer não estão instalados).
 * `renderToStaticMarkup` NÃO dispara onClick, então "o clique dispara a action
 * injetada" não é observável aqui.
 *
 * O que este arquivo prova (viável em node):
 *   (a) sem `acoes`, o componente usa o default (ACOES_LOJISTA) e renderiza sem
 *       lançar — o painel do lojista não regride;
 *   (b) aceitar `acoes` não altera o HTML renderizado (zero regressão, nos dois
 *       ramos temAssinatura=true/false) e nenhuma action — injetada OU do
 *       lojista — é chamada durante o render;
 *   (c) os controles que despacham cada action estão presentes na superfície
 *       (Assinar / Trocar plano / Atualizar forma de pagamento / Cancelar);
 *   (d) `planos=[]` (borda de input vazio) cai no early-return dedicado: nenhum
 *       botão de ação aparece e nenhuma action é referenciada.
 *
 * O que fica para `verificar` (// @see verificar): que o CLIQUE em cada botão
 * chama a função INJETADA em `acoes`, não a do lojista. O componente consome as
 * 4 actions nos PRÓPRIOS handlers internos (confirmarPlano / atualizarPagamento
 * / confirmarCancelamento) — não há filho para stubar/capturar a prop — e sem
 * DOM real o disparo não é observável em teste node. A assinatura das funções
 * injetadas é garantida por tsc (AcoesAssinatura via `typeof`). O valor cobrado
 * continua autoritativo no servidor (planos.preco, RN-1), independentemente de
 * qual variante é injetada — a prop só carrega referência de função, não valor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Client component chama useRouter() no topo; SSR estático não tem App Router
// montado. Mesmo padrão de AcoesStatus.test.tsx / ProdutosClient.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// `toast` só é usado DENTRO dos handlers (não no render); mockado por higiene.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock do módulo `'use server'`: assim o default ACOES_LOJISTA é composto por
// estes mocks e podemos afirmar o negativo (nenhuma action do lojista é chamada
// durante o render). Evita também importar o módulo real (que sobe clientes
// Supabase / service_role) sob node.
vi.mock("@/lib/actions/assinatura", () => ({
  iniciarAssinatura: vi.fn(async () => ({ ok: true }) as const),
  trocarPlano: vi.fn(async () => ({ ok: true }) as const),
  atualizarMeioPagamentoAssinatura: vi.fn(async () => ({ ok: true }) as const),
  cancelarAssinatura: vi.fn(async () => ({ ok: true }) as const),
}));

import * as actionsLojista from "@/lib/actions/assinatura";
import {
  GerenciarAssinaturaClient,
  type AcoesAssinatura,
  type PlanoView,
} from "./GerenciarAssinaturaClient";

const PLANOS: PlanoView[] = [
  { id: "plano-a", nome: "Básico", preco: 49.9, intervalo: "mês" },
  { id: "plano-b", nome: "Pro", preco: 99.9, intervalo: "mês" },
];

// 4 mocks injetáveis, distintos dos do lojista. Cast porque a assinatura real
// de cada action é um union { ok } | { ok; url } | { ok:false; erro }; o corpo
// do vi.fn devolve só o caminho feliz. Precedente: ProdutosClient.test.tsx.
function acoesMock(): AcoesAssinatura {
  return {
    iniciarAssinatura: vi.fn(async () => ({ ok: true })),
    trocarPlano: vi.fn(async () => ({ ok: true })),
    atualizarMeioPagamentoAssinatura: vi.fn(async () => ({ ok: true })),
    cancelarAssinatura: vi.fn(async () => ({ ok: true })),
  } as unknown as AcoesAssinatura;
}

function render(
  temAssinatura: boolean,
  planoAtualId: string | null,
  acoes?: AcoesAssinatura,
): string {
  return renderToStaticMarkup(
    <GerenciarAssinaturaClient
      planos={PLANOS}
      planoAtualId={planoAtualId}
      temAssinatura={temAssinatura}
      acoes={acoes}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("default `acoes = ACOES_LOJISTA` (sem prop)", () => {
  it("renderiza sem lançar quando `acoes` é omitido — painel do lojista não regride", () => {
    const html = render(false, null);
    expect(html).toContain("Escolha seu plano");
    expect(html).toContain("Assinar");
  });

  it("com assinatura e sem `acoes`, renderiza os controles do lojista sem lançar", () => {
    const html = render(true, "plano-a");
    expect(html).toContain("Trocar plano");
    expect(html).toContain("Atualizar forma de pagamento");
    expect(html).toContain("Cancelar assinatura");
  });
});

describe("aceitar `acoes` é zero-regressão de markup", () => {
  it("HTML com `acoes` injetadas é idêntico ao HTML sem `acoes`", () => {
    const semAcoes = render(true, "plano-a");
    const comAcoes = render(true, "plano-a", acoesMock());
    expect(comAcoes).toBe(semAcoes);
  });

  it("nenhuma action — injetada OU do lojista — é chamada durante o render", () => {
    const acoes = acoesMock();
    render(true, "plano-a", acoes);

    // Render estático não dispara onClick.
    for (const fn of Object.values(acoes)) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(actionsLojista.iniciarAssinatura).not.toHaveBeenCalled();
    expect(actionsLojista.trocarPlano).not.toHaveBeenCalled();
    expect(actionsLojista.atualizarMeioPagamentoAssinatura).not.toHaveBeenCalled();
    expect(actionsLojista.cancelarAssinatura).not.toHaveBeenCalled();
  });

  // O teste acima só compara markup no ramo `temAssinatura=true` (que também
  // renderiza pagamento/cancelar). Sem este segundo caso, uma regressão que só
  // aparecesse no ramo "sem assinatura ainda" (ex.: `acoes` influenciando o
  // botão "Assinar") passaria despercebida.
  it("HTML com `acoes` injetadas é idêntico ao HTML sem `acoes` (sem assinatura)", () => {
    const semAcoes = render(false, null);
    const comAcoes = render(false, null, acoesMock());
    expect(comAcoes).toBe(semAcoes);
  });
});

// A prova de que o CLIQUE despacha a função INJETADA (e não a do lojista)
// exige DOM real — deferida a `verificar`. // @see verificar
describe("superfície de despacho de cada action está presente", () => {
  it("sem assinatura → botão 'Assinar' (despacha iniciarAssinatura)", () => {
    const html = render(false, null);
    expect(html).toContain("Assinar");
    // Nada de trocar/cancelar antes de existir assinatura.
    expect(html).not.toContain("Cancelar assinatura");
    expect(html).not.toContain("Atualizar forma de pagamento");
  });

  it("com assinatura → controles de trocar / atualizar pagamento / cancelar", () => {
    const html = render(true, "plano-a");
    // Título do modo troca (superfície de trocarPlano).
    expect(html).toContain("Trocar plano");
    // Superfície de atualizarMeioPagamentoAssinatura.
    expect(html).toContain("Atualizar forma de pagamento");
    // Trigger de cancelarAssinatura.
    expect(html).toContain("Cancelar assinatura");
  });
});

// Borda obrigatória (input vazio) descoberta sem cobertura: `planos=[]` tem
// early-return dedicado (linhas 102-115 do componente) que nenhum teste
// exercitava. Barata em node (sem clique envolvido) e valiosa: prova que,
// sem planos, nenhum controle de despacho aparece e nenhuma action —
// injetada ou do lojista — é sequer referenciada.
describe("planos vazio (borda)", () => {
  it("sem planos, renderiza aviso, nenhum botão de ação, e nenhuma action é chamada", () => {
    const acoes = acoesMock();
    const html = renderToStaticMarkup(
      <GerenciarAssinaturaClient
        planos={[]}
        planoAtualId={null}
        temAssinatura={false}
        acoes={acoes}
      />,
    );

    expect(html).toContain("Nenhum plano disponível no momento.");
    expect(html).not.toContain("Assinar");
    expect(html).not.toContain("Cancelar assinatura");
    expect(html).not.toContain("Atualizar forma de pagamento");

    for (const fn of Object.values(acoes)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
