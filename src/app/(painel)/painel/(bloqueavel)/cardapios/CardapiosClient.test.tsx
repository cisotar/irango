/**
 * [256] Markup da lista de cardápios. `environment: node`, sem jsdom —
 * `renderToStaticMarkup`, o mesmo padrão de `CuponsClient.test.tsx`.
 *
 * O conteúdo dos dois `AlertDialog` não é observável aqui (eles nascem
 * fechados e o clique não roda sem DOM). As frases que eles mostram estão
 * travadas em `frasesCardapio.test.ts`, que é puro — foi para isso que elas
 * saíram do JSX.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CardapiosClient, type LinhaCardapio } from "./CardapiosClient";
import type { AcoesCardapios } from "./CardapiosClient";

function acoes(): AcoesCardapios {
  return {
    ligarDesligar: vi.fn(async () => ({ ok: true }) as const),
    remover: vi.fn(async () => ({ ok: true }) as const),
    converter: vi.fn(async () => ({ ok: true }) as const),
    devolverAoMenu: vi.fn(async () => ({ ok: true }) as const),
  };
}

function linha(over: Partial<LinhaCardapio> = {}): LinhaCardapio {
  return {
    id: "c1",
    nome: "Feijoada de sábado",
    ativo: true,
    estado: {
      tom: "verde",
      rotulo: "Aberto agora",
      rotuloAcessivel: null,
      abertoAgora: true,
    },
    descricao: "Aparece todo sábado, das 11:00 às 15:00.",
    menu: 4,
    exclusivos: 2,
    // [264] Por padrão, nada sumiu — o aviso de RN-12 não aparece em cardápio
    // no ar, e um aviso que aparece sempre não é lido nunca.
    escondidos: { doMenu: 4, sumidos: 0 },
    nomesEscondidos: [],
    idsEscondidos: [],
    ...over,
  };
}

function montar(linhas: LinhaCardapio[], baseCardapios = "/painel/cardapios"): string {
  return renderToStaticMarkup(
    <CardapiosClient
      cardapios={linhas}
      // [269] A base de rota é INJETADA: o componente não conhece nem a do
      // lojista nem a do admin.
      baseCardapios={baseCardapios}
      acoes={acoes()}
    />,
  );
}

describe("CardapiosClient", () => {
  it("mostra o rótulo de estado que o SERVIDOR derivou, sem recalcular nada", () => {
    expect(montar([linha()])).toContain("Aberto agora");
    expect(
      montar([
        linha({
          estado: {
            tom: "neutro",
            rotulo: "Abre sábado às 11:00",
            rotuloAcessivel: null,
            abertoAgora: false,
          },
        }),
      ]),
    ).toContain("Abre sábado às 11:00");
  });

  it("o aria-label completo desce para o badge quando o rótulo é abreviado", () => {
    const html = montar([
      linha({
        estado: {
          tom: "ambar",
          rotulo: "Expira em 3 dias",
          rotuloAcessivel: "Expira em 3 dias, em 23/09 às 23:59",
          abertoAgora: true,
        },
      }),
    ]);
    expect(html).toContain('aria-label="Expira em 3 dias, em 23/09 às 23:59"');
  });

  it("D16: o cardápio no ar diz ao lojista o que o cliente está vendo", () => {
    const frase = "aparecendo como seção no topo da sua loja";
    expect(montar([linha()])).toContain(frase);
    expect(
      montar([
        linha({
          ativo: false,
          estado: {
            tom: "neutro",
            rotulo: "Desligado",
            rotuloAcessivel: null,
            abertoAgora: false,
          },
        }),
      ]),
    ).not.toContain(frase);
  });

  it("a frase da janela vem de `descreverVigencia`, não do JSX", () => {
    expect(montar([linha()])).toContain(
      "Aparece todo sábado, das 11:00 às 15:00.",
    );
  });

  it("o Switch de desligar NÃO promete que os produtos voltariam a vender", () => {
    // Agulha montada em pedaços: o critério de aceite da 256 grepa o literal
    // em `src/` e exige zero ocorrência (ver `frasesCardapio.test.ts`).
    expect(montar([linha()])).not.toContain(["voltam", "a", "vender"].join(" "));
  });

  it("lista vazia não é tela em branco", () => {
    expect(montar([])).toContain("Nenhum cardápio ainda.");
  });
});

describe("264/RN-12 — o aviso de cardápio escondendo produtos", () => {
  const expirado = linha({
    nome: "Cardápio de Inverno",
    estado: {
      tom: "neutro",
      rotulo: "Expirado",
      rotuloAcessivel: null,
      abertoAgora: false,
    },
    menu: 7,
    escondidos: { doMenu: 7, sumidos: 4 },
    nomesEscondidos: ["Sopa de cebola", "Caldo verde", "Fondue", "Canjica"],
    idsEscondidos: ["p1", "p2", "p3", "p4"],
  });

  it("cardápio no ar não mostra aviso nenhum", () => {
    const html = montar([linha()]);
    expect(html).not.toContain("sumiram da vitrine");
    expect(html).not.toContain("Devolver");
  });

  it("mostra as três frases na ordem: o que sumiu antes do que fica", () => {
    const html = montar([expirado]);

    expect(html).toContain("4 produtos sumiram da vitrine");
    expect(html).toContain("Eles são exclusivos deste cardápio.");
    expect(html).toContain(
      "Outros 7 produtos do menu continuam aparecendo e vendendo normalmente.",
    );
    expect(html.indexOf("sumiram da vitrine")).toBeLessThan(
      html.indexOf("continuam aparecendo"),
    );
  });

  it("é âmbar com ícone + texto, nunca vermelho (design §13.4 item 4)", () => {
    const html = montar([expirado]);
    // Recorta o bloco do aviso: o vermelho do "Remover" é de OUTRA parte da
    // linha e continua legítimo — o que não pode ser vermelho é o aviso.
    const aviso = html.slice(
      html.indexOf('<div role="alert"'),
      html.indexOf("Devolver os 4 ao menu"),
    );

    expect(aviso).toContain("border-amber-300");
    expect(aviso).toContain("text-amber-900");
    expect(aviso).toContain("lucide-triangle-alert");
    // As classes `aria-invalid:*-destructive` do `Button` valem para estado de
    // erro de form e não pintam nada aqui; o que o aviso não pode ter é cor
    // vermelha aplicada.
    expect(aviso).not.toContain("text-destructive");
    expect(aviso).not.toContain("bg-destructive");
  });

  it("oferece as duas saídas, as duas com alvo de 44px", () => {
    const html = montar([expirado]);

    // Expirado continua ligado: religar seria um botão que não faz nada.
    expect(html).toContain("Estender o prazo");
    expect(html).toContain("Devolver os 4 ao menu");
    expect(html).toContain("min-h-[44px]");
  });

  it("cardápio DESLIGADO oferece religar — mesmo aviso, um predicado só", () => {
    const html = montar([
      linha({
        ...expirado,
        ativo: false,
        estado: {
          tom: "neutro",
          rotulo: "Desligado",
          rotuloAcessivel: null,
          abertoAgora: false,
        },
      }),
    ]);

    expect(html).toContain("4 produtos sumiram da vitrine");
    expect(html).toContain("Religar o cardápio");
  });
});

/**
 * [269] Os TRÊS hrefs de `CardapiosClient` derivam de `baseCardapios`, nunca de
 * um literal escrito no componente. O componente é montado pelos DOIS mundos
 * (lojista em `/painel/cardapios`, hub admin em
 * `/admin/assinantes/<lojaId>/cardapios`) — o bug que originou a issue 269 foi
 * exatamente um href hardcoded mandando o admin, editando a loja de um
 * terceiro, para o painel da PRÓPRIA loja dele.
 *
 * `rotaCardapiosInjetada.test.tsx` já garante por grep que o literal
 * `/painel/cardapios` não aparece em código-fonte da pasta. O que FALTA e este
 * bloco cobre: provar que o HTML realmente MUDA quando `baseCardapios` muda —
 * um grep passa mesmo se o componente ignorasse a prop e sempre escrevesse
 * `${uma_variável_qualquer}/novo` fixa; só o RENDER com dois valores distintos
 * prova a derivação de verdade.
 */
describe("269 — CardapiosClient: os três hrefs derivam de baseCardapios (não hardcoded)", () => {
  const BASE_ADMIN = "/admin/assinantes/loja-alvo-123/cardapios";

  it("'Novo cardápio' aponta para `${baseCardapios}/novo` — muda com a base injetada", () => {
    const htmlLojista = montar([linha()], "/painel/cardapios");
    const htmlAdmin = montar([linha()], BASE_ADMIN);

    expect(htmlLojista).toContain('href="/painel/cardapios/novo"');
    expect(htmlAdmin).toContain(`href="${BASE_ADMIN}/novo"`);
    // O mundo admin NUNCA vê a rota do lojista, nem por acidente de fallback.
    expect(htmlAdmin).not.toContain('href="/painel/cardapios/novo"');
  });

  it("'Editar' (lápis) aponta para `${baseCardapios}/${linha.id}` — muda com a base injetada", () => {
    const l = linha({ id: "cardapio-xyz" });
    const htmlLojista = montar([l], "/painel/cardapios");
    const htmlAdmin = montar([l], BASE_ADMIN);

    expect(htmlLojista).toContain('href="/painel/cardapios/cardapio-xyz"');
    expect(htmlAdmin).toContain(`href="${BASE_ADMIN}/cardapio-xyz"`);
    expect(htmlAdmin).not.toContain('href="/painel/cardapios/cardapio-xyz"');
  });

  it("o link do aviso de RN-12 (editarHref de AvisoEscondendo) também deriva de baseCardapios", () => {
    // ativo=true + sumidos>0 é a única combinação em que AvisoEscondendo
    // renderiza um <Link> (religar por clique não passa por href nenhum).
    const l = linha({
      id: "cardapio-xyz",
      ativo: true,
      escondidos: { doMenu: 2, sumidos: 1 },
    });
    const htmlLojista = montar([l], "/painel/cardapios");
    const htmlAdmin = montar([l], BASE_ADMIN);

    expect(htmlLojista).toContain('href="/painel/cardapios/cardapio-xyz"');
    expect(htmlAdmin).toContain(`href="${BASE_ADMIN}/cardapio-xyz"`);
    // As DUAS ocorrências de href por página (Editar + AvisoEscondendo) mudam
    // igualmente — nenhuma delas escapa da injeção.
    expect(htmlAdmin).not.toContain("/painel/cardapios");
  });
});
