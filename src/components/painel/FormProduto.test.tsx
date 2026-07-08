// Testes para FormProduto (issue 088) — checkbox "Ocultar da vitrine".
//
// Ambiente: vitest environment=node — sem jsdom. Estratégia idêntica a
// FormEndereco.test.tsx/StatusAssinatura.test.tsx: renderToStaticMarkup
// (react-dom/server) + asserções sobre o HTML real.
//
// O componente do shadcn/base-ui renderiza o estado `checked` como
// `aria-checked="true"|"false"` no elemento raiz (confirmado renderizando
// <Checkbox checked /> isoladamente). Os dois checkboxes do form ("Disponível
// na vitrine" e "Ocultar da vitrine") ficam adjacentes no HTML estático; para
// não confundir um com o outro, ancoramos a extração no marcador que só o
// checkbox "Ocultar" tem: `aria-describedby="produto-oculto-ajuda"`.
//
// Isto prova o que a issue pede: (1) default oculto=false ao criar, (2) o
// form reflete oculto=true real ao editar, e — o bug mais provável de uma
// regressão futura — (3) os dois controles são INDEPENDENTES (RN-1): marcar
// um não deveria nunca depender do valor do outro.

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// FormProduto chama useRouter() no topo (client component) para o fallback de
// navegação pós-submit; SSR estático não tem um App Router montado, então o
// hook precisa ser mockado para o componente renderizar (RN não relacionada
// ao que este teste cobre — apenas infra de render).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { FormProduto, type ProdutoInicial } from "@/components/painel/FormProduto";

const CATEGORIAS = [{ id: "c1", nome: "Lanches", exibir_imagens: true }];

function renderForm(inicial?: ProdutoInicial): string {
  return renderToStaticMarkup(
    <FormProduto
      categorias={CATEGORIAS}
      inicial={inicial}
      lojaSlug="loja-teste"
      lojaId="loja-1"
    />,
  );
}

/**
 * Extrai o trecho do elemento raiz do checkbox "Ocultar da vitrine" (o único
 * com aria-describedby="produto-oculto-ajuda") para ler seu aria-checked
 * sem risco de casar com o outro checkbox do form.
 */
function checkedDoOculto(html: string): string {
  const inicioTag = html.lastIndexOf(
    "<span",
    html.indexOf('aria-describedby="produto-oculto-ajuda"'),
  );
  const fimTag = html.indexOf(">", inicioTag);
  const tag = html.slice(inicioTag, fimTag);
  const match = tag.match(/aria-checked="(true|false)"/);
  if (!match) throw new Error("checkbox 'Ocultar' não encontrado no HTML");
  return match[1];
}

/**
 * Extrai o aria-checked do PRIMEIRO checkbox (span role=checkbox) do HTML —
 * no form, é sempre "Disponível na vitrine" (renderizado antes de "Ocultar").
 */
function checkedDoDisponivel(html: string): string {
  const inicioTag = html.indexOf('role="checkbox"');
  const antesTag = html.lastIndexOf("<span", inicioTag);
  const fimTag = html.indexOf(">", antesTag);
  const tag = html.slice(antesTag, fimTag);
  const match = tag.match(/aria-checked="(true|false)"/);
  if (!match) throw new Error("checkbox 'Disponível' não encontrado no HTML");
  return match[1];
}

describe("FormProduto — checkbox 'Ocultar da vitrine' (issue 088)", () => {
  it("criar (sem inicial): oculto default false", () => {
    const html = renderForm(undefined);
    expect(checkedDoOculto(html)).toBe("false");
  });

  it("criar (sem inicial): disponível default true (comportamento pré-existente preservado)", () => {
    const html = renderForm(undefined);
    expect(checkedDoDisponivel(html)).toBe("true");
  });

  it("editar produto com oculto=true: checkbox reflete o valor real do produto", () => {
    const html = renderForm({ id: "p1", nome: "X", oculto: true });
    expect(checkedDoOculto(html)).toBe("true");
  });

  it("editar produto com oculto=false: checkbox reflete false (não fica preso em true)", () => {
    const html = renderForm({ id: "p1", nome: "X", oculto: false });
    expect(checkedDoOculto(html)).toBe("false");
  });

  it("RN-1: oculto=true e disponivel=true SIMULTANEAMENTE — controles são independentes, nenhum força o outro", () => {
    const html = renderForm({ id: "p1", nome: "X", oculto: true, disponivel: true });
    expect(checkedDoDisponivel(html)).toBe("true");
    expect(checkedDoOculto(html)).toBe("true");
  });

  it("RN-1: oculto=true e disponivel=false SIMULTANEAMENTE — nenhum eixo é acoplado ao outro", () => {
    const html = renderForm({ id: "p1", nome: "X", oculto: true, disponivel: false });
    expect(checkedDoDisponivel(html)).toBe("false");
    expect(checkedDoOculto(html)).toBe("true");
  });

  it("RN-1: disponivel=false NÃO deve forçar oculto=true — produto indisponível mas não oculto continua com oculto=false", () => {
    const html = renderForm({ id: "p1", nome: "X", oculto: false, disponivel: false });
    expect(checkedDoDisponivel(html)).toBe("false");
    expect(checkedDoOculto(html)).toBe("false");
  });

  it("texto de ajuda distingue 'oculto' de 'esgotado/indisponível' (RN-1/RN-2 da spec)", () => {
    const html = renderForm(undefined);
    expect(html).toContain("Diferente de esgotado");
  });

  it("rótulos dos dois controles são textualmente distintos (não depende só de cor — WCAG 1.4.1)", () => {
    const html = renderForm(undefined);
    expect(html).toContain("Disponível na vitrine");
    expect(html).toContain("Ocultar da vitrine");
  });
});
