/**
 * Testes do FormCupom (issue 126 — prop `acoes` injetável para criar/atualizar;
 * issue 160 — a prop e suas chaves passaram a ser OBRIGATÓRIAS, sem default
 * apontando para a action do lojista).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), mesmo padrão do projeto
 * (AcoesStatus.test.tsx, ProdutosClient.test.tsx).
 *
 * Por que este arquivo é diferente do de AcoesStatus/ProdutosClient: em
 * FormCupom a resolução das actions (`const { criar, atualizar } = acoes`) roda
 * no CORPO do componente (a cada render), não dentro de um handler de clique.
 * Ou seja, ao contrário do clique em si (não observável sem jsdom), um bug real
 * nessa linha LANÇA já no mount — exatamente o cenário que quebrou em produção
 * no commit 0bb5864 ("escopo admin perdia o binding do client — toda escrita
 * admin quebrava em prod"). Por isso os testes abaixo montam o form nos dois
 * caminhos (injeção do lojista e injeção admin) e não só verificam "não lança",
 * mas também que o conteúdo renderizado (modo criar/editar, valores de
 * `inicial`) continua correto e IDÊNTICO entre eles.
 *
 * Fora do escopo: qual das duas actions é de fato invocada ao submeter — isso
 * está atrás de um evento DOM (`onSubmit`), não observável em
 * `renderToStaticMarkup` (mesma lacuna documentada em AcoesStatus.test.tsx).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FormCupom, type AcoesFormCupom, type CupomInicial } from "./FormCupom";

/** Injeção mínima e completa das actions (o contrato exige as duas chaves). */
function acoesBase(): AcoesFormCupom {
  return {
    criar: vi.fn(async () => ({ ok: true }) as const),
    atualizar: vi.fn(async () => ({ ok: true }) as const),
  };
}

function inicialBase(overrides: Partial<CupomInicial> = {}): CupomInicial {
  return {
    id: "cupom-1",
    codigo: "TESTE10",
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 20,
    usos_maximos: 5,
    expira_em: null,
    ativo: true,
    ...overrides,
  };
}

function valorDoInput(html: string, id: string): string | null {
  const m = html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`));
  return m ? m[1] : null;
}

describe("modo criação (sem inicial) — caminho do painel do lojista", () => {
  it("botão 'Criar cupom' e todos os campos em branco/default", () => {
    const html = renderToStaticMarkup(<FormCupom acoes={acoesBase()} />);
    expect(html).toContain(">Criar cupom<");
    expect(html).not.toContain("Salvar alterações");
    expect(valorDoInput(html, "cupom-codigo")).toBe("");
    expect(valorDoInput(html, "cupom-minimo")).toBe("0");
    expect(valorDoInput(html, "cupom-usos")).toBe("");
    // Tipo default = percentual (option marcado com `selected`).
    expect(html).toContain('<option value="percentual" selected');
    // Ativo default = true → checkbox marcado (`data-checked`).
    expect(html).toContain('data-checked=""');
    expect(html).not.toContain('data-unchecked=""');
  });
});

describe("modo edição (com inicial) — reflete os dados do cupom", () => {
  it("botão 'Salvar alterações' e campos preenchidos a partir de `inicial`", () => {
    const html = renderToStaticMarkup(
      <FormCupom inicial={inicialBase({ ativo: false })} acoes={acoesBase()} />,
    );
    expect(html).toContain(">Salvar alterações<");
    expect(html).not.toContain(">Criar cupom<");
    expect(valorDoInput(html, "cupom-codigo")).toBe("TESTE10");
    expect(valorDoInput(html, "cupom-valor")).toBe("10");
    expect(valorDoInput(html, "cupom-minimo")).toBe("20");
    expect(valorDoInput(html, "cupom-usos")).toBe("5");
    // ativo=false → checkbox desmarcado.
    expect(html).toContain('data-unchecked=""');
  });

  it("cupom sem expiração (expira_em=null) não gera data inválida no input", () => {
    const html = renderToStaticMarkup(
      <FormCupom inicial={inicialBase({ expira_em: null })} acoes={acoesBase()} />,
    );
    expect(valorDoInput(html, "cupom-data-fim")).toBe("");
  });
});

describe("qual `acoes` é injetada não altera o que é renderizado (zero regressão)", () => {
  it("modo criação: render com a injeção admin é idêntico ao render com a do lojista", () => {
    const acoesLojista = acoesBase();
    const acoesAdmin = acoesBase();

    const comLojista = renderToStaticMarkup(<FormCupom acoes={acoesLojista} />);
    const comAdmin = renderToStaticMarkup(<FormCupom acoes={acoesAdmin} />);

    expect(comAdmin).toBe(comLojista);
    // Render estático não dispara submit; as actions injetadas não são chamadas aqui.
    expect(acoesAdmin.criar).not.toHaveBeenCalled();
    expect(acoesAdmin.atualizar).not.toHaveBeenCalled();
  });

  it("modo edição: monta sem lançar e mantém o conteúdo com a injeção admin", () => {
    // A resolução das actions roda no CORPO do componente: se alguém trocar a
    // desestruturação por algo que assuma `acoes` ausente, o mount quebra aqui.
    const inicial = inicialBase();

    const comLojista = renderToStaticMarkup(
      <FormCupom inicial={inicial} acoes={acoesBase()} />,
    );
    const comAdmin = renderToStaticMarkup(
      <FormCupom inicial={inicial} acoes={acoesBase()} />,
    );

    expect(comAdmin).toBe(comLojista);
    expect(comAdmin).toContain(">Salvar alterações<");
  });
});
