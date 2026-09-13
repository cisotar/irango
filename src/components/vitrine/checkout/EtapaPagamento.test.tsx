/**
 * [174] Contrato: a lista de formas de pagamento renderizada na vitrine é
 * SUBCONJUNTO das formas cadastradas pela loja (`formasPagamento` — hidratada
 * por `listarFormasPagamento`, filtrada por `loja_id`).
 *
 * A trava que este teste prova: `EtapaPagamento` (linha ~215) itera
 * `formasPagamento.map(...)` — nunca um universo fixo (`ROTULO_PAGAMENTO` tem
 * 4 chaves fixas, mas só vira `<RadioGroupItem>` quem estiver no array vindo do
 * servidor). Se um dia o componente passar a iterar `Object.keys(ROTULO_PAGAMENTO)`
 * por engano, a premissa de `criarPedido` (que a forma recusada é "rara por
 * construção" — 159/174) cai, e este teste é quem denuncia.
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), padrão do projeto
 * (HeaderLoja.test.tsx, DetalhePedido.test.tsx).
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// EtapaPagamento chama useEnviarPedido, que usa useRouter() (SSR estático não
// tem App Router montado) e criarPedido/prepararAbaWhatsapp (server action e
// mecânica de janela — irrelevantes para render). Mocks de infra, mesmo padrão
// de useEnviarPedido.test.ts.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/actions/pedido", () => ({
  criarPedido: vi.fn(),
}));
vi.mock("./aberturaWhatsapp", () => ({
  prepararAbaWhatsapp: () => ({ concluir: vi.fn() }),
}));

import { EtapaPagamento, type EtapaPagamentoProps } from "./EtapaPagamento";
import { ESTADO_INICIAL, type FormaPagamentoWizard } from "./estado";

const ROTULO: Record<FormaPagamentoWizard["tipo"], string> = {
  pix: "Pix",
  cartao: "Cartão de crédito/débito",
  dinheiro: "Dinheiro",
  link: "Link de pagamento",
};

const TODOS_TIPOS = Object.keys(ROTULO) as FormaPagamentoWizard["tipo"][];

// O SUBTITULO_PAGAMENTO de 'cartao' ("Link de pagamento via WhatsApp") contém
// a substring do RÓTULO de 'link' ("Link de pagamento") — checar como texto
// solto daria falso positivo. O rótulo sempre fecha o <span> imediatamente
// após, então ancoramos nisso para distinguir rótulo de subtítulo.
function contemRotulo(html: string, tipo: FormaPagamentoWizard["tipo"]): boolean {
  return html.includes(`${ROTULO[tipo]}</span>`);
}

function render(formasPagamento: FormaPagamentoWizard[]): string {
  const props: EtapaPagamentoProps = {
    lojaId: "0d1e2f30-0000-4000-8000-000000000001",
    lojaSlug: "loja-teste",
    lojaAberta: true,
    formasPagamento,
    itens: [],
    estado: ESTADO_INICIAL,
    subtotal: 0,
    desconto: 0,
    frete: 0,
    onEstadoChange: () => {},
    onVoltar: () => {},
  };
  return renderToStaticMarkup(<EtapaPagamento {...props} />);
}

describe("[174] EtapaPagamento — lista de pagamento é subconjunto das formas cadastradas", () => {
  it("loja com só 'pix' cadastrado: renderiza SÓ o rótulo Pix, nenhum outro", () => {
    const html = render([{ id: "f1", tipo: "pix" }]);

    expect(contemRotulo(html, "pix")).toBe(true);
    for (const outro of TODOS_TIPOS.filter((t) => t !== "pix")) {
      expect(contemRotulo(html, outro)).toBe(false);
    }
  });

  it("loja com 'cartao' e 'dinheiro' cadastrados: renderiza os dois, nunca 'pix' ou 'link'", () => {
    const html = render([
      { id: "f1", tipo: "cartao" },
      { id: "f2", tipo: "dinheiro" },
    ]);

    expect(contemRotulo(html, "cartao")).toBe(true);
    expect(contemRotulo(html, "dinheiro")).toBe(true);
    expect(contemRotulo(html, "pix")).toBe(false);
    expect(contemRotulo(html, "link")).toBe(false);
  });

  it("loja sem nenhuma forma cadastrada: nenhum dos 4 rótulos aparece", () => {
    const html = render([]);

    for (const tipo of TODOS_TIPOS) {
      expect(contemRotulo(html, tipo)).toBe(false);
    }
    expect(html).toContain("Esta loja ainda não configurou formas de pagamento.");
  });

  it("todas as 4 formas cadastradas: as 4 aparecem (upper bound do subconjunto = universo)", () => {
    const html = render(TODOS_TIPOS.map((tipo, i) => ({ id: `f${i}`, tipo })));

    for (const tipo of TODOS_TIPOS) {
      expect(contemRotulo(html, tipo)).toBe(true);
    }
  });
});
