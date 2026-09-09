/**
 * Testes do `CuponsClient` (issue 127 — prop `acoes` injetável, reusando o
 * contrato `AcoesFormCupom` do `FormCupom` + `remover`; issue 160 — a prop e
 * suas chaves passaram a ser OBRIGATÓRIAS, sem default apontando para a action
 * do lojista).
 *
 * Ambiente: vitest environment=node — sem jsdom. Estratégia:
 * `renderToStaticMarkup` (react-dom/server), mesmo padrão do projeto
 * (FormCupom.test.tsx, ProdutosClient.test.tsx, AcoesStatus.test.tsx).
 *
 * A resolução das actions (`const { remover } = acoes`) roda no CORPO do
 * componente (a cada render), não dentro de um handler de clique — ao
 * contrário do clique em si (não observável sem jsdom), um bug real nessa
 * linha LANÇA já no mount. É exatamente o cenário que quebrou em produção no
 * commit 0bb5864 ("escopo admin perdia o binding do client — toda escrita
 * admin quebrava em prod"). Por isso os testes abaixo montam a tela nos dois
 * caminhos de injeção (lojista e admin) — não só "não lança", mas também
 * conferem que o HTML renderizado continua correto e idêntico entre eles.
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

/** Injeção mínima e completa das actions (o contrato exige as três chaves). */
function acoesBase(): AcoesCuponsClient {
  return {
    criar: vi.fn(async () => ({ ok: true }) as const),
    atualizar: vi.fn(async () => ({ ok: true }) as const),
    remover: vi.fn(async () => ({ ok: true }) as const),
  };
}

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

describe("injeção do painel do lojista", () => {
  it("renderiza a lista sem lançar e mostra o cupom", () => {
    const html = renderToStaticMarkup(
      <CuponsClient cupons={[cupomBase()]} acoes={acoesBase()} />,
    );
    expect(html).toContain("Cupons");
    expect(html).toContain("TESTE10");
  });

  it("lista vazia mostra o estado 'Nenhum cupom ainda'", () => {
    const html = renderToStaticMarkup(
      <CuponsClient cupons={[]} acoes={acoesBase()} />,
    );
    expect(html).toContain("Nenhum cupom ainda");
  });
});

describe("qual `acoes` é injetada não altera o que é renderizado (zero regressão)", () => {
  it("injeção admin: HTML idêntico ao da injeção do lojista, nenhuma action é chamada", () => {
    const acoesAdmin = acoesBase();

    const cupons = [cupomBase()];
    const comLojista = renderToStaticMarkup(
      <CuponsClient cupons={cupons} acoes={acoesBase()} />,
    );
    const comAdmin = renderToStaticMarkup(
      <CuponsClient cupons={cupons} acoes={acoesAdmin} />,
    );

    expect(comAdmin).toBe(comLojista);
    expect(acoesAdmin.criar).not.toHaveBeenCalled();
    expect(acoesAdmin.atualizar).not.toHaveBeenCalled();
    expect(acoesAdmin.remover).not.toHaveBeenCalled();
  });
});
