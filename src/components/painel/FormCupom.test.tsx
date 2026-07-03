/**
 * Testes do FormCupom (issue 126 — prop `acoes?` injetável para criar/atualizar).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), mesmo padrão do projeto
 * (AcoesStatus.test.tsx, ProdutosClient.test.tsx).
 *
 * Por que este arquivo é diferente do de AcoesStatus/ProdutosClient: em
 * FormCupom a resolução `const criar = acoes?.criar ?? criarCupom` roda no
 * CORPO do componente (a cada render), não dentro de um handler de clique. Ou
 * seja, ao contrário do clique em si (não observável sem jsdom), um bug real
 * nessa linha — por exemplo trocar `acoes?.criar` por `acoes!.criar` ou por
 * `acoes.criar` sem optional chaining — LANÇA já no mount, exatamente o
 * cenário que quebrou em produção no commit 0bb5864 ("escopo admin perdia o
 * binding do client — toda escrita admin quebrava em prod"). Por isso os
 * testes abaixo renderizam sem `acoes` (o caminho do painel do lojista, que é
 * sempre executado sem a prop) e com `acoes` parcial — não só "não lança",
 * mas também conferem que o conteúdo renderizado (modo criar/editar, valores
 * de `inicial`) continua correto.
 *
 * Fora do escopo: qual das duas actions é de fato invocada ao submeter — isso
 * está atrás de um evento DOM (`onSubmit`), não observável em
 * `renderToStaticMarkup` (mesma lacuna documentada em AcoesStatus.test.tsx).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FormCupom, type CupomInicial } from "./FormCupom";

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

describe("modo criação (sem inicial, sem acoes) — caminho default do painel", () => {
  it("botão 'Criar cupom' e todos os campos em branco/default", () => {
    const html = renderToStaticMarkup(<FormCupom />);
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

describe("modo edição (com inicial, sem acoes) — reflete os dados do cupom", () => {
  it("botão 'Salvar alterações' e campos preenchidos a partir de `inicial`", () => {
    const html = renderToStaticMarkup(
      <FormCupom inicial={inicialBase({ ativo: false })} />,
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
      <FormCupom inicial={inicialBase({ expira_em: null })} />,
    );
    expect(valorDoInput(html, "cupom-data-fim")).toBe("");
  });
});

describe("prop `acoes` injetada não altera o que é renderizado (zero regressão)", () => {
  it("modo criação: render com `acoes` completa é idêntico ao render sem `acoes`", () => {
    const criar = vi.fn(async () => ({ ok: true }) as const);
    const atualizar = vi.fn(async () => ({ ok: true }) as const);

    const semAcoes = renderToStaticMarkup(<FormCupom />);
    const comAcoes = renderToStaticMarkup(
      <FormCupom acoes={{ criar, atualizar }} />,
    );

    expect(comAcoes).toBe(semAcoes);
    // Render estático não dispara submit; as actions injetadas não são chamadas aqui.
    expect(criar).not.toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();
  });

  it("modo edição: `acoes` PARCIAL (só `criar`, sem `atualizar`) não quebra o render nem muda o conteúdo", () => {
    // Prova o comentário do código-fonte: o fallback é por-função (`??`
    // individual), não por-objeto — um buraco em `atualizar` não deve
    // impedir o form de montar corretamente em modo edição, que é justamente
    // o modo que chamaria `atualizar` no submit.
    const criar = vi.fn(async () => ({ ok: true }) as const);
    const inicial = inicialBase();

    const semAcoes = renderToStaticMarkup(<FormCupom inicial={inicial} />);
    const comAcoesParcial = renderToStaticMarkup(
      <FormCupom inicial={inicial} acoes={{ criar } as never} />,
    );

    expect(comAcoesParcial).toBe(semAcoes);
    expect(comAcoesParcial).toContain(">Salvar alterações<");
  });
});
