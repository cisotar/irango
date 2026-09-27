/**
 * V2 — Link e URL hostil na mensagem do modal sazonal (issue 305; spec
 * modal-sazonal-mensagem-formatada.md, matriz V2, RN-M05, RN-M12). Fase RED.
 *
 * Camadas do vetor numa suíte só:
 *   - guard `urlLinkExternoSegura` (delegando a `urlHttpsSegura`, seguranca.md §15);
 *   - zod de escrita (`schemaMensagemModal`) e parse na leitura (`lerMensagemModal`);
 *   - aviso de saída (`AvisoSaidaLink`, revalida no render);
 *   - renderizador (`MensagemFormatada`, NUNCA `<a>`).
 *
 * Nenhum caso faz fetch da URL (sem SSRF). Caracteres invisíveis e homógrafos
 * são escritos com escape (`\t`, `і`), nunca literais.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AvisoSaidaLink } from "@/components/shared/AvisoSaidaLink";
import { MensagemFormatada } from "@/components/shared/MensagemFormatada";
import { urlHttpsSegura } from "@/lib/utils/urlHttpsSegura";
import { urlLinkExternoSegura } from "@/lib/utils/urlLinkExternoSegura";
import {
  lerMensagemModal,
  schemaMensagemModal,
  TETO_URL_BRUTA,
  TETO_URL_CANONICA,
  type LinkExternoValidado,
  type MensagemModalValidada,
} from "@/lib/validacoes/mensagemModal";

const CTX = {
  lojaId: "11111111-1111-4111-8111-111111111111",
  modalId: "22222222-2222-4222-8222-222222222222",
};

const TEXTO_INDISPONIVEL = "Este link não está disponível.";

function docComLink(link: unknown) {
  return {
    versao: 1,
    paragrafos: [{ trechos: [{ texto: "Veja a promoção", link }] }],
  };
}

function renderAviso(link: unknown): string {
  return renderToStaticMarkup(
    <AvisoSaidaLink
      link={link as LinkExternoValidado}
      aoContinuar={() => {}}
      aoVoltar={() => {}}
    />,
  );
}

let spyErro: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spyErro = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  spyErro.mockRestore();
});

/** A15 — lista literal da matriz V2. */
const PROTOCOLO_HOSTIL = [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "http://exemplo.com/promo",
  "//golpe.com",
  "/painel",
  "mailto:alguem@exemplo.invalid",
  "tel:0",
  " https://exemplo.com/promo",
  "https:golpe.com",
] as const;

/** A16 — link enganoso (credencial, IP, localhost, porta, host sem ponto). */
const LINK_ENGANOSO = [
  "https://irango.vercel.app@golpe.com",
  "https://192.168.0.1",
  "https://0x7f.1",
  "https://[::1]",
  "https://localhost",
  "https://a.localhost",
  "https://golpe.com:8443",
  "https://intranet",
] as const;

const TODOS_RECUSADOS = [...PROTOCOLO_HOSTIL, ...LINK_ENGANOSO];

describe("V2 — controle positivo: https canônico atravessa todas as camadas", () => {
  it("urlLinkExternoSegura devolve o href canônico", () => {
    expect(urlLinkExternoSegura("https://exemplo.com/promo?x=1")).toBe(
      "https://exemplo.com/promo?x=1",
    );
    // canonização WHATWG: host em minúsculas, barra final
    expect(urlLinkExternoSegura("https://EXEMPLO.com")).toBe("https://exemplo.com/");
  });

  it("zod aceita e grava o CANÔNICO, não o bruto", () => {
    const r = schemaMensagemModal.safeParse(docComLink("https://EXEMPLO.com"));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data!.paragrafos[0].trechos[0].link).toBe("https://exemplo.com/");
  });

  it("lerMensagemModal aceita documento cru com link válido", () => {
    const lida = lerMensagemModal(docComLink("https://exemplo.com/promo"), CTX);
    expect(lida).not.toBeNull();
    expect(lida!.paragrafos[0].trechos[0].link).toBe("https://exemplo.com/promo");
  });

  it("tetos de URL exportados valem 2048 (bruto) e 1000 (canônico)", () => {
    expect(TETO_URL_BRUTA).toBe(2048);
    expect(TETO_URL_CANONICA).toBe(1000);
  });
});

describe("V2-A15 — protocolo hostil é recusado em todas as camadas", () => {
  it.each(PROTOCOLO_HOSTIL)("urlLinkExternoSegura(%j) === null", (url) => {
    expect(urlLinkExternoSegura(url)).toBeNull();
  });

  it.each(PROTOCOLO_HOSTIL)("schemaMensagemModal reprova trecho com link %j", (url) => {
    expect(schemaMensagemModal.safeParse(docComLink(url)).success).toBe(false);
  });

  it.each(PROTOCOLO_HOSTIL)("lerMensagemModal devolve null para documento cru com link %j", (url) => {
    const cru: unknown = JSON.parse(JSON.stringify(docComLink(url)));
    expect(lerMensagemModal(cru, CTX)).toBeNull();
    // a URL nunca vai para o log (RN-M12)
    expect(JSON.stringify(spyErro.mock.calls)).not.toContain(url.trim());
  });

  it.each(PROTOCOLO_HOSTIL)("AvisoSaidaLink com %j por cast: sem <a, sem href, mostra indisponível", (url) => {
    const markup = renderAviso(url);
    expect(markup).not.toMatch(/<a[\s>]/i);
    expect(markup).not.toMatch(/\shref=/i);
    expect(markup).toContain(TEXTO_INDISPONIVEL);
  });
});

describe("V2-A16 — link enganoso é recusado; IDN é aceito em punycode", () => {
  it.each(LINK_ENGANOSO)("urlLinkExternoSegura(%j) === null", (url) => {
    expect(urlLinkExternoSegura(url)).toBeNull();
  });

  it.each(LINK_ENGANOSO)("schemaMensagemModal reprova trecho com link %j", (url) => {
    expect(schemaMensagemModal.safeParse(docComLink(url)).success).toBe(false);
  });

  it.each(LINK_ENGANOSO)("lerMensagemModal devolve null para documento cru com link %j", (url) => {
    expect(lerMensagemModal(docComLink(url), CTX)).toBeNull();
  });

  it.each(LINK_ENGANOSO)("AvisoSaidaLink com %j por cast: sem <a, mostra indisponível", (url) => {
    const markup = renderAviso(url);
    expect(markup).not.toMatch(/<a[\s>]/i);
    expect(markup).not.toMatch(/\shref=/i);
    expect(markup).toContain(TEXTO_INDISPONIVEL);
  });

  describe("fronteira do tamanho BRUTO (2048/2049)", () => {
    // `/./` são segmentos que o parser WHATWG remove: o bruto fica longo e o
    // canônico curto, isolando o teto BRUTO do teto canônico.
    const bruto2048 = "https://exemplo.com" + "/.".repeat(1013) + "/xy";
    const bruto2049 = "https://exemplo.com" + "/.".repeat(1014) + "/x";

    it("pré-condição dos comprimentos", () => {
      expect(bruto2048.length).toBe(2048);
      expect(bruto2049.length).toBe(2049);
    });

    it("2048 caracteres brutos é aceito e canonizado", () => {
      expect(urlLinkExternoSegura(bruto2048)).toBe("https://exemplo.com/xy");
    });

    it("2049 caracteres brutos é recusado, mesmo com canônico curto", () => {
      expect(urlLinkExternoSegura(bruto2049)).toBeNull();
      expect(schemaMensagemModal.safeParse(docComLink(bruto2049)).success).toBe(false);
    });
  });

  describe("fronteira do tamanho CANÔNICO (1000/1001)", () => {
    const canon1000 = "https://exemplo.com/" + "a".repeat(980);
    const canon1001 = "https://exemplo.com/" + "a".repeat(981);

    it("pré-condição dos comprimentos", () => {
      expect(canon1000.length).toBe(1000);
      expect(canon1001.length).toBe(1001);
    });

    it("canônico de 1000 é aceito", () => {
      expect(urlLinkExternoSegura(canon1000)).toBe(canon1000);
      expect(schemaMensagemModal.safeParse(docComLink(canon1000)).success).toBe(true);
    });

    it("canônico de 1001 é recusado", () => {
      expect(urlLinkExternoSegura(canon1001)).toBeNull();
      expect(schemaMensagemModal.safeParse(docComLink(canon1001)).success).toBe(false);
      expect(lerMensagemModal(docComLink(canon1001), CTX)).toBeNull();
    });
  });

  describe("homógrafo IDN (i cirílico U+0456)", () => {
    const homografo = "https://іrango.com";
    const canonico = new URL(homografo).href;
    const hostPunycode = new URL(homografo).hostname;

    it("pré-condição: o parser WHATWG converte para xn--", () => {
      expect(hostPunycode.startsWith("xn--")).toBe(true);
    });

    it("é ACEITO e canonizado para https://xn--…", () => {
      const r = urlLinkExternoSegura(homografo);
      expect(r).toBe(canonico);
      expect(r!.startsWith("https://xn--")).toBe(true);
      expect(r).not.toContain("і");
    });

    it("zod grava o punycode, não o Unicode", () => {
      const r = schemaMensagemModal.safeParse(docComLink(homografo));
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data!.paragrafos[0].trechos[0].link).toBe(canonico);
    });

    it("o aviso de saída mostra o hostname xn--…, nunca o caractere cirílico", () => {
      const markup = renderAviso(canonico);
      expect(markup).toContain(hostPunycode);
      expect(markup).not.toContain("і");
    });

    it("o aviso revalida: recebendo o bruto Unicode por cast, mostra/usa o punycode", () => {
      const markup = renderAviso(homografo);
      expect(markup).toContain(hostPunycode);
      expect(markup).not.toContain("і");
    });
  });
});

describe("V2-A17 — a mensagem nunca emite <a> nem href", () => {
  // Render FORÇADO (cast): prova o renderizador sozinho, sem depender do zod.
  const mensagem = {
    versao: 1,
    paragrafos: [
      {
        trechos: [
          { texto: "Veja o cardápio especial", link: "https://exemplo.com/especial" },
          { texto: " e também " },
          { texto: "a página da festa", link: "https://festa.exemplo.com/" },
        ],
      },
      { tipo: "item-lista", trechos: [{ texto: "Item com link", link: "https://exemplo.com/item" }] },
    ],
  } as unknown as MensagemModalValidada;

  it("com aoEscolherLink: zero <a, zero href, link é <button type=\"button\">", () => {
    const markup = renderToStaticMarkup(
      <MensagemFormatada mensagem={mensagem} aoEscolherLink={() => {}} />,
    );
    expect(markup).not.toMatch(/<a[\s>]/i);
    expect(markup).not.toMatch(/\shref=/i);
    const botoes = markup.match(/<button\s[^>]*type="button"[^>]*>/g) ?? [];
    expect(botoes).toHaveLength(3);
    expect(markup).toContain("Veja o cardápio especial");
    // a URL não vira atributo nenhum no markup da mensagem
    expect(markup).not.toContain("https://exemplo.com/especial");
  });

  it("sem aoEscolherLink (prévia): zero <a, zero href, zero <button; link é <span>", () => {
    const markup = renderToStaticMarkup(<MensagemFormatada mensagem={mensagem} />);
    expect(markup).not.toMatch(/<a[\s>]/i);
    expect(markup).not.toMatch(/\shref=/i);
    expect(markup).not.toMatch(/<button/i);
    expect(markup).toMatch(/<span[^>]*>(?:(?!<\/span>)[\s\S])*Veja o cardápio especial/);
  });

  it("render forçado com link hostil: continua sem <a e sem href", () => {
    const hostil = {
      versao: 1,
      paragrafos: [{ trechos: [{ texto: "clique", link: "javascript:alert(1)" }] }],
    } as unknown as MensagemModalValidada;
    for (const markup of [
      renderToStaticMarkup(<MensagemFormatada mensagem={hostil} aoEscolherLink={() => {}} />),
      renderToStaticMarkup(<MensagemFormatada mensagem={hostil} />),
    ]) {
      expect(markup).not.toMatch(/<a[\s>]/i);
      expect(markup).not.toMatch(/\shref=/i);
      expect(markup).not.toContain("javascript:");
    }
  });
});

describe("V2 — delegação: urlLinkExternoSegura recusa tudo que urlHttpsSegura recusa", () => {
  // Amostra de src/lib/utils/urlHttpsSegura.test.ts (não duplica o predicado).
  const RECUSADOS_PELO_GUARD_BASE: unknown[] = [
    "http://exemplo.com/x.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,xxx",
    "/relativo.jpg",
    "HTTPS://maiusculo.com/x.jpg",
    null,
    undefined,
    "",
    "//cdn.exemplo.com/x.jpg",
    "ftp://files.exemplo.com/x.jpg",
    "   ",
    " https://exemplo.com/x.jpg",
    "\nhttps://exemplo.com/x.jpg",
    "https:/exemplo.com",
  ];

  it.each(RECUSADOS_PELO_GUARD_BASE)("%j: urlHttpsSegura null ⇒ urlLinkExternoSegura null", (url) => {
    expect(urlHttpsSegura(url as string | null | undefined)).toBeNull();
    expect(urlLinkExternoSegura(url)).toBeNull();
  });

  it("aceitos pelo guard base mas malformados também caem (https:// sem host)", () => {
    expect(urlHttpsSegura("https://")).toBe("https://");
    expect(urlLinkExternoSegura("https://")).toBeNull();
  });

  it.each([123, {}, [], true])("entrada não-string %j devolve null", (x) => {
    expect(urlLinkExternoSegura(x)).toBeNull();
  });

  it("toda URL recusada nesta suíte também tem o guard base consistente (sanidade)", () => {
    // Nenhuma URL recusada pode sair como string de urlLinkExternoSegura.
    for (const url of TODOS_RECUSADOS) {
      expect(urlLinkExternoSegura(url)).toBeNull();
    }
  });
});
