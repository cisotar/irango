/**
 * Testes do `CuponsClient` (issue 127 — prop `acoes?` injetável, reusando o
 * contrato `AcoesFormCupom` do `FormCupom` + `remover`).
 *
 * Ambiente: vitest environment=node — sem jsdom. Estratégia:
 * `renderToStaticMarkup` (react-dom/server), mesmo padrão do projeto
 * (FormCupom.test.tsx, ProdutosClient.test.tsx, AcoesStatus.test.tsx).
 *
 * A resolução `const remover = acoes?.remover ?? removerCupom` roda no CORPO
 * do componente (a cada render), não dentro de um handler de clique — ao
 * contrário do clique em si (não observável sem jsdom), um bug real nessa
 * linha (trocar `acoes?.remover` por `acoes!.remover` ou por `acoes.remover`
 * sem optional chaining) LANÇA já no mount. É exatamente o cenário que quebrou
 * em produção no commit 0bb5864 ("escopo admin perdia o binding do client —
 * toda escrita admin quebrava em prod"). Por isso os testes abaixo renderizam
 * sem `acoes` (o caminho do painel do lojista, sempre executado sem a prop) e
 * com `acoes` completa/parcial — não só "não lança", mas também conferem que
 * o HTML renderizado continua correto e idêntico.
 *
 * Fora do escopo deste arquivo: qual das duas actions é de fato invocada ao
 * clicar em "Remover" no dialog de confirmação — isso está atrás de um evento
 * DOM, não observável em `renderToStaticMarkup` (mesma lacuna documentada em
 * FormCupom.test.tsx / AcoesStatus.test.tsx).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// CuponsClient chama useRouter() no topo (client component); SSR estático não
// tem um App Router montado. Mesmo padrão de ProdutosClient.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CuponsClient } from "./CuponsClient";
import type { AcoesCuponsClient } from "./CuponsClient";
import type { Cupom } from "@/lib/supabase/queries/entregaPagamento";

function cupomBase(overrides: Partial<Cupom> = {}): Cupom {
  return {
    id: "cupom-1",
    loja_id: "loja-1",
    codigo: "TESTE10",
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 0,
    usos_maximos: null,
    usos_contagem: 0,
    expira_em: null,
    ativo: true,
    criado_em: "2025-01-01T00:00:00Z",
    ...overrides,
  } as Cupom;
}

describe("sem acoes — caminho default do painel do lojista", () => {
  it("renderiza a lista sem lançar e mostra o cupom", () => {
    const html = renderToStaticMarkup(
      <CuponsClient cupons={[cupomBase()]} />,
    );
    expect(html).toContain("Cupons");
    expect(html).toContain("TESTE10");
  });

  it("lista vazia mostra o estado 'Nenhum cupom ainda'", () => {
    const html = renderToStaticMarkup(<CuponsClient cupons={[]} />);
    expect(html).toContain("Nenhum cupom ainda");
  });
});

describe("prop `acoes` injetada não altera o que é renderizado (zero regressão)", () => {
  it("`acoes` completa (criar, atualizar, remover): HTML idêntico ao sem acoes, nenhuma action é chamada", () => {
    const acoesMock: AcoesCuponsClient = {
      criar: vi.fn(async () => ({ ok: true }) as const),
      atualizar: vi.fn(async () => ({ ok: true }) as const),
      remover: vi.fn(async () => ({ ok: true }) as const),
    };

    const cupons = [cupomBase()];
    const semAcoes = renderToStaticMarkup(<CuponsClient cupons={cupons} />);
    const comAcoes = renderToStaticMarkup(
      <CuponsClient cupons={cupons} acoes={acoesMock} />,
    );

    expect(comAcoes).toBe(semAcoes);
    expect(acoesMock.criar).not.toHaveBeenCalled();
    expect(acoesMock.atualizar).not.toHaveBeenCalled();
    expect(acoesMock.remover).not.toHaveBeenCalled();
  });

  it("`acoes` PARCIAL (só `remover`, sem criar/atualizar) não quebra o render — prova que o fallback é por-função, não por-objeto", () => {
    const remover = vi.fn(async () => ({ ok: true }) as const);
    const cupons = [cupomBase()];

    const semAcoes = renderToStaticMarkup(<CuponsClient cupons={cupons} />);
    const comAcoesParcial = renderToStaticMarkup(
      <CuponsClient
        cupons={cupons}
        acoes={{ remover } as unknown as AcoesCuponsClient}
      />,
    );

    expect(comAcoesParcial).toBe(semAcoes);
    expect(remover).not.toHaveBeenCalled();
  });
});
