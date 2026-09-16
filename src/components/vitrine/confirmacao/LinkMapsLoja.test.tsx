/**
 * [197] Fase RED — LinkMapsLoja (RN-R6 / Segurança da spec v0.3.0).
 *
 * Alvo: `src/components/vitrine/confirmacao/LinkMapsLoja.tsx` — AINDA NÃO
 * EXISTE. Estes testes falham até a fase GREEN (`executar`) criar o componente.
 *
 * Por que um componente extraído: `confirmacao/page.tsx` é Server Component
 * `async` (lê Supabase) e não é alcançável por `renderToStaticMarkup`. Extrair
 * o link torna `target`/`rel`/`href` mecanicamente testáveis.
 *
 * Ambiente: vitest environment=node + @vitejs/plugin-react, sem jsdom —
 * `renderToStaticMarkup` (react-dom/server), idêntico a
 * `StatusAssinatura.test.tsx:266-269` e `ListaOpcionaisItem.test.tsx`.
 *
 * Contrato esperado:
 *   <LinkMapsLoja loja={{ endereco_rua, endereco_numero, endereco_bairro,
 *                         endereco_cidade, endereco_estado, endereco_cep }} />
 *   → `null` quando `montarHrefMapsLoja` devolve `null` (RN-R5).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LinkMapsLoja } from "@/components/vitrine/confirmacao/LinkMapsLoja";

const LOJA = {
  endereco_rua: "Rua da Padaria",
  endereco_numero: "45",
  endereco_bairro: "Vila Nova",
  endereco_cidade: "Campinas",
  endereco_estado: "SP",
  endereco_cep: "13010-000",
};

function render(overrides: Partial<typeof LOJA> = {}): string {
  return renderToStaticMarkup(<LinkMapsLoja loja={{ ...LOJA, ...overrides }} />);
}

describe("[197] LinkMapsLoja — abertura em nova aba", () => {
  it("abre em nova aba (target=_blank)", () => {
    expect(render()).toContain('target="_blank"');
  });

  it("rel noopener — impede reverse tabnabbing (regressão da issue 126)", () => {
    expect(render()).toContain("noopener");
  });

  it("🔴 rel noreferrer — sem ele o header Referer entregaria ao Google a URL da confirmação, que carrega o token_acesso na query (confirmacao/page.tsx:34)", () => {
    expect(render()).toContain("noreferrer");
  });

  it("avisa o leitor de tela que o link abre em nova aba", () => {
    expect(render()).toContain("nova aba");
  });
});

describe("[197] LinkMapsLoja — href (RN-R6)", () => {
  it("origem literal do Google Maps, esquema e domínio nunca vindos do banco", () => {
    expect(render()).toContain(
      "href=\"https://www.google.com/maps/search/?api=1&amp;query=",
    );
  });

  it("a consulta traz o endereço completo com cidade e UF, e 'Brasil' como âncora", () => {
    const html = render();
    expect(html).toContain(
      encodeURIComponent("Rua da Padaria, 45, Vila Nova, Campinas - SP, Brasil"),
    );
  });

  it("🛑 o CEP não entra na consulta (issues 185/186)", () => {
    const html = render({ endereco_cep: "12914-190" });
    expect(html).not.toContain("12914");
    expect(html).not.toContain("CEP");
  });

  it("endereço com &, # e acento não escapa para a estrutura da URL", () => {
    const html = render({
      endereco_rua: "Av. Ponte & Praça #7",
      endereco_bairro: "Jardim São João",
    });
    expect(html).toContain("%26"); // &
    expect(html).toContain("%23"); // #
    expect(html).not.toContain('href="javascript');
  });

  it("um lojista não transforma o link em javascript: pelo campo de rua", () => {
    const html = render({ endereco_rua: "javascript:alert(1)//" });
    expect(html).toContain(
      "href=\"https://www.google.com/maps/search/?api=1&amp;query=",
    );
    expect(html).not.toContain('href="javascript:');
  });

  it("texto do endereço sai escapado como filho de JSX, nunca como tag executável", () => {
    const html = render({ endereco_rua: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
  });
});

describe("[197] LinkMapsLoja — RN-R5: sem âncora geográfica, sem link", () => {
  it("sem cidade → nada renderizado (sem link órfão)", () => {
    expect(render({ endereco_cidade: null as unknown as string })).toBe("");
  });

  it("sem estado → nada renderizado", () => {
    expect(render({ endereco_estado: null as unknown as string })).toBe("");
  });

  it("cidade/estado só com espaços → nada renderizado", () => {
    expect(render({ endereco_cidade: "  ", endereco_estado: " " })).toBe("");
  });

  it("endereço inteiramente vazio → nada renderizado", () => {
    expect(
      renderToStaticMarkup(
        <LinkMapsLoja
          loja={{
            endereco_rua: null,
            endereco_numero: null,
            endereco_bairro: null,
            endereco_cidade: null,
            endereco_estado: null,
            endereco_cep: null,
          }}
        />,
      ),
    ).toBe("");
  });

  it("loja null → nada renderizado", () => {
    expect(renderToStaticMarkup(<LinkMapsLoja loja={null} />)).toBe("");
  });
});
