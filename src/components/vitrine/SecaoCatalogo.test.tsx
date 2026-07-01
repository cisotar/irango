/**
 * Fase RED (TDD) da issue 086 — propagação de `disponivel` até a vitrine.
 *
 * Contexto: `buscarCatalogoPublico` passa a retornar produtos esgotados
 * (`disponivel = false`, não-ocultos). Sem fechar a cadeia de propagação
 * (page.tsx → SecaoCatalogo → CardProduto), o produto esgotado APARECE mas
 * renderiza como DISPONÍVEL — pior que hoje. Este teste prova o contrato de UI:
 * `SecaoCatalogo` deve levar `disponivel` de cada produto ao `CardProduto`, que
 * então renderiza o estado "esgotado" (ribbon + botão desabilitado + aria-label).
 *
 * Ambiente: vitest environment=node — sem jsdom. Estratégia idêntica ao
 * HeaderLoja.test.tsx: renderToStaticMarkup (react-dom/server) para asserções
 * sobre o HTML gerado. `useCarrinho` usa store de módulo + useSyncExternalStore
 * com getServerSnapshot (carrinho vazio no SSR) — não exige provider.
 *
 * Por que é RED de verdade HOJE: `ProdutoCatalogo` (SecaoCatalogo.tsx) NÃO tem
 * campo `disponivel` e o `<CardProduto>` é montado SEM `disponivel` → default
 * `true`. Logo o card do produto esgotado renderiza como disponível (sem ribbon
 * "Esgotado", com o botão habilitado). A asserção do estado esgotado cai vermelha.
 * A GREEN fecha a cadeia (adiciona `disponivel` ao type e passa ao CardProduto).
 *
 * O estado visual do "esgotado" em si é contrato de CardProduto (já suportado);
 * aqui provamos SÓ a PROPAGAÇÃO do dado por SecaoCatalogo, não a matriz visual.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SecaoCatalogo,
  type CategoriaComProdutos,
  type ProdutoCatalogo,
} from "./SecaoCatalogo";

function categoriasFixture(): CategoriaComProdutos[] {
  const disponivel: ProdutoCatalogo = {
    id: "p-disp",
    nome: "Coca Gelada",
    descricao: null,
    preco: 5,
    foto_url: null,
    categoria_id: "cat-bebidas",
    disponivel: true,
  };
  const esgotado: ProdutoCatalogo = {
    id: "p-esg",
    nome: "Suco Esgotado",
    descricao: null,
    preco: 7,
    foto_url: null,
    categoria_id: "cat-bebidas",
    disponivel: false,
  };
  return [
    {
      id: "cat-bebidas",
      nome: "Bebidas",
      produtos: [disponivel, esgotado],
    },
  ];
}

describe("086 SecaoCatalogo — propaga `disponivel` ao CardProduto", () => {
  it("produto INDISPONÍVEL renderiza estado 'esgotado' (ribbon + botão desabilitado)", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo categorias={categoriasFixture()} />,
    );

    // CardProduto com disponivel=false: ribbon "Esgotado" + aria-label de esgotado.
    expect(html).toContain("Esgotado");
    expect(html).toContain('aria-label="Suco Esgotado esgotado"');
    // O botão do produto esgotado precisa estar desabilitado.
    const trecho = html.slice(html.indexOf("Suco Esgotado"));
    expect(trecho).toContain("disabled");
  });

  it("produto DISPONÍVEL segue clicável (aria-label de adicionar, sem 'esgotado')", () => {
    const html = renderToStaticMarkup(
      <SecaoCatalogo categorias={categoriasFixture()} />,
    );

    // O disponível mantém o aria-label de adicionar (contrato não regride).
    expect(html).toContain('aria-label="Adicionar Coca Gelada ao carrinho"');
    expect(html).not.toContain('aria-label="Coca Gelada esgotado"');
  });
});
