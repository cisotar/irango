/**
 * V7 — UI redress, link disfarçado, tabnabbing e contraste da paleta (issue
 * 310; spec modal-sazonal-mensagem-formatada.md, matriz V7, RN-M06, RN-M12,
 * RN-M13). Fase RED.
 *
 *   - A13: a mensagem de tamanho máximo rola por DENTRO de um contêiner com
 *     altura máxima; ✕ e CTAs ficam FORA dele. `MensagemFormatada` sem
 *     `position` absoluta/fixa nem `z-*`, com quebra de palavra forçada.
 *   - A18: `AvisoSaidaLink` com `rel="noopener noreferrer"`,
 *     `referrerpolicy="no-referrer"`, `target="_blank"` e `href` = canônico
 *     REVALIDADO; URL que falha na revalidação não gera `<a>`.
 *   - A24: link não se disfarça de texto (zod remove `cor`/`sublinhado`; o
 *     markup do link sempre traz o ícone e a classe fixa; texto comum nunca).
 *   - A25: toda cor da paleta e a cor do link com contraste WCAG ≥ 4,5:1.
 *
 * Infra do A13: o `Dialog` do base-ui não renderiza conteúdo em SSR fechado
 * (`aberto` começa `false`, trava 6). O stub abaixo renderiza os filhos sempre,
 * o que permite inspecionar a ESTRUTURA do corpo do `ModalSazonal`. É só infra:
 * não altera o layout sob teste.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/ui/dialog", async () => {
  const { createElement } = await import("react");
  type P = { children?: unknown; className?: string };
  const caixa =
    (stub: string) =>
    ({ children, className }: P) =>
      createElement("div", { "data-stub": stub, className }, children as never);
  return {
    Dialog: ({ children }: P) => createElement("div", { "data-stub": "dialog" }, children as never),
    DialogContent: caixa("dialog-content"),
    DialogHeader: caixa("dialog-header"),
    DialogFooter: caixa("dialog-footer"),
    DialogTitle: caixa("dialog-title"),
    DialogDescription: caixa("dialog-description"),
  };
});

import { AvisoSaidaLink } from "@/components/shared/AvisoSaidaLink";
import { MensagemFormatada } from "@/components/shared/MensagemFormatada";
import { ModalSazonal } from "@/components/vitrine/ModalSazonal";
import {
  COR_LINK_MENSAGEM,
  FUNDO_MODAL_MENSAGEM,
  PALETA_MENSAGEM,
} from "@/lib/constants/paletaMensagem";
import { razaoContraste } from "@/lib/utils/contrasteWcag";
import {
  schemaMensagemModal,
  type LinkExternoValidado,
  type MensagemModalValidada,
} from "@/lib/validacoes/mensagemModal";

import { ancestraisEm, classeDe, tokensDeClasse } from "./markup";

let spyErro: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spyErro = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  spyErro.mockRestore();
});

/* ───────────────────────────── A13 ───────────────────────────── */

/**
 * Mensagem no teto: 20 parágrafos × 40 caracteres visíveis = 800 (RN-M08),
 * com uma "palavra" sem espaço para forçar o overflow horizontal se faltar
 * `break-words`.
 */
const MARCADOR = "MSGMAX";
const MENSAGEM_MAXIMA = {
  versao: 1,
  paragrafos: Array.from({ length: 20 }, (_, i) => ({
    trechos: [
      {
        texto: `${MARCADOR}${String(i).padStart(2, "0")}${"W".repeat(32)}`,
        tamanho: "enorme",
      },
    ],
  })),
} as unknown as MensagemModalValidada;

function renderModal(): string {
  return renderToStaticMarkup(
    <ModalSazonal
      titulo="Festival de inverno"
      mensagem={MENSAGEM_MAXIMA}
      produtos={[]}
      lojaSlug="loja-teste"
      diaDeHojeNaLoja="2026-09-27"
      storage={null}
      destinoFoco={{ current: null }}
    />,
  );
}

function ehContainerDeRolagem(classe: string): boolean {
  const tokens = classe.split(/\s+/);
  return (
    tokens.some((t) => /^max-h-/.test(t)) &&
    tokens.some((t) => t === "overflow-y-auto" || t === "overflow-auto")
  );
}

describe("V7-A13 — a mensagem não empurra nem cobre os controles do modal", () => {
  it("MensagemFormatada: contêiner com break-words e [overflow-wrap:anywhere]", () => {
    const markup = renderToStaticMarkup(<MensagemFormatada mensagem={MENSAGEM_MAXIMA} />);
    const tokens = tokensDeClasse(markup);
    expect(tokens).toContain("break-words");
    expect(tokens).toContain("[overflow-wrap:anywhere]");
    // o contêiner da quebra envolve o texto
    const idx = markup.indexOf(MARCADOR);
    expect(idx).toBeGreaterThan(-1);
    const ancestrais = ancestraisEm(markup, idx).map(classeDe);
    expect(ancestrais.some((c) => c.split(/\s+/).includes("break-words"))).toBe(true);
  });

  it("MensagemFormatada: sem position absoluta/fixa/sticky, sem z-index, sem inset", () => {
    const markup = renderToStaticMarkup(
      <MensagemFormatada mensagem={MENSAGEM_MAXIMA} aoEscolherLink={() => {}} />,
    );
    const proibidos = tokensDeClasse(markup).filter(
      (t) =>
        t === "absolute" ||
        t === "fixed" ||
        t === "sticky" ||
        /^-?z-/.test(t) ||
        /^-?inset-/.test(t) ||
        /^-?(top|left|right|bottom)-/.test(t),
    );
    expect(proibidos).toEqual([]);
    expect(markup).not.toMatch(/\sstyle=/i);
  });

  it("ModalSazonal só com título + mensagem máxima (sem pratos) renderiza a mensagem", () => {
    const markup = renderModal();
    expect(markup).toContain(`${MARCADOR}00`);
    expect(markup).toContain(`${MARCADOR}19`);
  });

  it("a mensagem está dentro de um contêiner com altura máxima e rolagem própria", () => {
    const markup = renderModal();
    const idx = markup.indexOf(MARCADOR);
    expect(idx).toBeGreaterThan(-1);
    const rolagem = ancestraisEm(markup, idx).filter((t) => ehContainerDeRolagem(classeDe(t)));
    expect(rolagem.length).toBeGreaterThanOrEqual(1);
    // e esse contêiner também força a quebra de palavra (ou está dentro de quem força)
    const classesAncestrais = ancestraisEm(markup, idx).map(classeDe).join(" ");
    expect(classesAncestrais).toContain("break-words");
  });

  it("o ✕ (aria-label=\"Fechar\") e os dois CTAs ficam FORA do contêiner de rolagem", () => {
    const markup = renderModal();
    const idxMsg = markup.indexOf(MARCADOR);
    expect(idxMsg).toBeGreaterThan(-1);
    const containers = ancestraisEm(markup, idxMsg)
      .filter((t) => ehContainerDeRolagem(classeDe(t)))
      .map((t) => t.inicio);
    expect(containers.length).toBeGreaterThanOrEqual(1);

    const alvos = [
      markup.lastIndexOf("<button", markup.indexOf('aria-label="Fechar"')),
      markup.lastIndexOf("<button", markup.indexOf("Ver cardápio")),
      markup.lastIndexOf("<button", markup.indexOf("Continuar vendo o cardápio")),
    ];
    for (const alvo of alvos) {
      expect(alvo).toBeGreaterThan(-1);
      const inicioAncestrais = ancestraisEm(markup, alvo).map((t) => t.inicio);
      for (const c of containers) {
        expect(inicioAncestrais).not.toContain(c);
      }
    }
  });

  it("DialogTitle continua o único título: a mensagem não emite heading", () => {
    const markup = renderToStaticMarkup(
      <MensagemFormatada
        mensagem={
          {
            versao: 1,
            paragrafos: [{ tipo: "titulo", trechos: [{ texto: "Grande promoção" }] }],
          } as unknown as MensagemModalValidada
        }
      />,
    );
    expect(markup).not.toMatch(/<h[1-6][\s>]/i);
    expect(markup).not.toMatch(/role="heading"/);
  });
});

/* ───────────────────────────── A18 ───────────────────────────── */

function renderAviso(link: unknown): string {
  return renderToStaticMarkup(
    <AvisoSaidaLink
      link={link as LinkExternoValidado}
      aoContinuar={() => {}}
      aoVoltar={() => {}}
    />,
  );
}

function tagsA(markup: string): string[] {
  return markup.match(/<a[\s>][^>]*>/gi) ?? [];
}

describe("V7-A18 — aviso de saída sem tabnabbing nem vazamento de referrer", () => {
  it("link válido: exatamente um <a> com rel, referrerpolicy e target fixos", () => {
    const markup = renderAviso("https://exemplo.com/promo");
    const as = tagsA(markup);
    expect(as).toHaveLength(1);
    const a = as[0];
    expect(a).toContain('rel="noopener noreferrer"');
    // HTML é case-insensitive: o React 19 serializa `referrerPolicy` em camelCase.
    expect(a).toMatch(/\sreferrerpolicy="no-referrer"/i);
    expect(a).toContain('target="_blank"');
    expect(a).toContain('href="https://exemplo.com/promo"');
  });

  it("href é o CANÔNICO revalidado, não o valor recebido", () => {
    const markup = renderAviso("https://EXEMPLO.com/promo");
    const as = tagsA(markup);
    expect(as).toHaveLength(1);
    expect(as[0]).toContain('href="https://exemplo.com/promo"');
    expect(markup).not.toContain("EXEMPLO.com");
  });

  it("mostra o hostname em destaque, o endereço completo e os rótulos das ações", () => {
    const markup = renderAviso("https://exemplo.com/promo");
    expect(markup).toContain("Continuar para exemplo.com");
    expect(markup).toContain("https://exemplo.com/promo");
    expect(markup).toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Voltar/);
  });

  it.each([
    "https://usuario:senha@golpe.com/",
    "https://golpe.com:8443/",
    "http://exemplo.com/",
    "javascript:alert(1)",
  ])("URL que falha na revalidação (%j por cast): zero <a", (url) => {
    const markup = renderAviso(url);
    expect(tagsA(markup)).toHaveLength(0);
    expect(markup).not.toMatch(/\shref=/i);
    expect(markup).toContain("Este link não está disponível.");
  });
});

/* ───────────────────────────── A24 ───────────────────────────── */

const RE_ICONE = /<svg[^>]*aria-hidden="true"/;

/** O primeiro <button>…</button> do markup (o link com callback). */
function primeiroBotao(markup: string): string {
  const m = /<button[\s>][\s\S]*?<\/button>/.exec(markup);
  return m ? m[0] : "";
}

function classeDaTagDeAbertura(fragmento: string): string {
  return /^<[a-z]+[^>]*\sclass="([^"]*)"/.exec(fragmento)?.[1] ?? "";
}

describe("V7-A24 — link não se disfarça de texto comum", () => {
  it("zod: trecho com link + cor + sublinhado é canonizado SEM cor e sublinhado", () => {
    const r = schemaMensagemModal.safeParse({
      versao: 1,
      paragrafos: [
        {
          trechos: [
            {
              texto: "Promoção",
              link: "https://exemplo.com/",
              cor: "azul",
              sublinhado: true,
              negrito: true,
            },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const trecho = r.data!.paragrafos[0].trechos[0];
    expect(trecho).toStrictEqual({
      texto: "Promoção",
      link: "https://exemplo.com/",
      negrito: true,
    });
    expect(Object.hasOwn(trecho, "cor")).toBe(false);
    expect(Object.hasOwn(trecho, "sublinhado")).toBe(false);
  });

  it("controle: sem link, cor e sublinhado são preservados", () => {
    const r = schemaMensagemModal.safeParse({
      versao: 1,
      paragrafos: [{ trechos: [{ texto: "Promoção", cor: "azul", sublinhado: true }] }],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data!.paragrafos[0].trechos[0]).toStrictEqual({
      texto: "Promoção",
      cor: "azul",
      sublinhado: true,
    });
  });

  function docLink(texto: string, extra: Record<string, unknown> = {}) {
    return {
      versao: 1,
      paragrafos: [{ trechos: [{ texto, link: "https://exemplo.com/", ...extra }] }],
    } as unknown as MensagemModalValidada;
  }

  it("markup do link (com callback) sempre traz o ícone svg aria-hidden", () => {
    const markup = renderToStaticMarkup(
      <MensagemFormatada mensagem={docLink("Veja")} aoEscolherLink={() => {}} />,
    );
    expect(primeiroBotao(markup)).toMatch(RE_ICONE);
  });

  it("markup do link (prévia, sem callback) também traz o ícone", () => {
    const markup = renderToStaticMarkup(<MensagemFormatada mensagem={docLink("Veja")} />);
    expect(markup).toMatch(RE_ICONE);
  });

  it("classe do link é FIXA: não depende do texto nem de cor/sublinhado forçados", () => {
    const a = primeiroBotao(
      renderToStaticMarkup(<MensagemFormatada mensagem={docLink("Veja")} aoEscolherLink={() => {}} />),
    );
    const b = primeiroBotao(
      renderToStaticMarkup(
        <MensagemFormatada
          mensagem={docLink("Outro texto", { cor: "marrom", sublinhado: false })}
          aoEscolherLink={() => {}}
        />,
      ),
    );
    const classeA = classeDaTagDeAbertura(a);
    expect(classeA).not.toBe("");
    expect(classeDaTagDeAbertura(b)).toBe(classeA);
    // visual fixo inclui sublinhado
    expect(a).toMatch(/underline/);
  });

  it("texto comum nunca traz o ícone, mesmo azul e sublinhado", () => {
    const markup = renderToStaticMarkup(
      <MensagemFormatada
        mensagem={
          {
            versao: 1,
            paragrafos: [{ trechos: [{ texto: "Parece link", cor: "azul", sublinhado: true }] }],
          } as unknown as MensagemModalValidada
        }
        aoEscolherLink={() => {}}
      />,
    );
    expect(markup).not.toMatch(/<svg/i);
    expect(markup).not.toMatch(/<button/i);
  });
});

/* ───────────────────────────── A25 ───────────────────────────── */

/**
 * Oráculo INDEPENDENTE (WCAG 2.x, luminância relativa sRGB). A asserção de
 * segurança da paleta usa este cálculo, não o util de produção, para que um
 * bug no util não aprove uma cor ilegível.
 */
function luminancia(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function razaoOraculo(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const RE_HEX = /^#[0-9a-f]{6}$/i;
/** Contrato: Record chave→hex. */
const PALETA: Record<string, string> = PALETA_MENSAGEM;

describe("V7-A25 — toda cor da mensagem passa WCAG AA sobre o fundo do modal", () => {
  it("a paleta tem exatamente as 7 chaves do enum", () => {
    expect(Object.keys(PALETA_MENSAGEM).sort()).toEqual(
      ["azul", "cinza", "laranja", "marrom", "roxo", "verde", "vermelho"],
    );
  });

  it("todas as cores e o fundo são hex #rrggbb (nada de rgb()/nome/var)", () => {
    for (const cor of Object.values(PALETA_MENSAGEM)) expect(cor).toMatch(RE_HEX);
    expect(COR_LINK_MENSAGEM).toMatch(RE_HEX);
    expect(FUNDO_MODAL_MENSAGEM).toMatch(RE_HEX);
  });

  it("o fundo é o bg-popover claro do Dialog (#ffffff)", () => {
    expect(FUNDO_MODAL_MENSAGEM.toLowerCase()).toBe("#ffffff");
  });

  it("a cor do link é um tom FORA da paleta do lojista", () => {
    const paleta = Object.values(PALETA).map((c) => c.toLowerCase());
    expect(paleta).not.toContain(COR_LINK_MENSAGEM.toLowerCase());
  });

  it.each(Object.entries(PALETA))("%s (%s) tem contraste ≥ 4,5:1", (_chave, cor) => {
    expect(razaoOraculo(cor, FUNDO_MODAL_MENSAGEM)).toBeGreaterThanOrEqual(4.5);
  });

  it("a cor do link tem contraste ≥ 4,5:1", () => {
    expect(razaoOraculo(COR_LINK_MENSAGEM, FUNDO_MODAL_MENSAGEM)).toBeGreaterThanOrEqual(4.5);
  });

  describe("util razaoContraste (valores concretos)", () => {
    it("preto sobre branco = 21:1, simétrico", () => {
      expect(razaoContraste("#000000", "#ffffff")).toBeCloseTo(21, 2);
      expect(razaoContraste("#ffffff", "#000000")).toBeCloseTo(21, 2);
    });

    it("mesma cor = 1:1", () => {
      expect(razaoContraste("#7e22ce", "#7e22ce")).toBeCloseTo(1, 5);
    });

    it("valores medidos do spec RN-M13", () => {
      expect(razaoContraste("#3e2723", "#ffffff")).toBeCloseTo(13.82, 1);
      expect(razaoContraste("#c2410c", "#ffffff")).toBeCloseTo(5.18, 1);
      expect(razaoContraste("#1e40af", "#ffffff")).toBeCloseTo(8.72, 1);
    });

    it("aceita hex em maiúsculas", () => {
      expect(razaoContraste("#FFFFFF", "#000000")).toBeCloseTo(21, 2);
    });

    it("cinza claro reprovaria AA (sanidade do limiar)", () => {
      expect(razaoContraste("#999999", "#ffffff")).toBeLessThan(4.5);
    });
  });
});
