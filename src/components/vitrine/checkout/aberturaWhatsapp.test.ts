/**
 * Testes da mecânica de abertura automática do WhatsApp (issue 126, RN-A5).
 *
 * Ambiente: vitest `environment: node` — sem jsdom/@testing-library. A mecânica
 * de janela foi extraída para este módulo neutro com o abridor INJETADO
 * (mesmo padrão de `criarControladorPolling`/`DepsPolling` em
 * `StatusPedidoLive.test.tsx`), o que permite observar o efeito sem DOM nem
 * React. O default (`window.open`) é coberto com `vi.stubGlobal("window", ...)`
 * — precedente em `SeletorImprimirPedido.test.tsx`.
 *
 * LACUNA CONHECIDA: provar que `useEnviarPedido` chama `prepararAbaWhatsapp`
 * ANTES do `await criarPedido` exigiria clique DOM real (infra que o projeto
 * não tem). Mitigação: a chamada fica fora do `startEnvio` (verificável por
 * leitura) + verificação manual.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  abrirAbaEmBranco,
  prepararAbaWhatsapp,
  type JanelaWhatsapp,
} from "./aberturaWhatsapp";

const HREF_OK = "https://api.whatsapp.com/send?phone=5511999999999&text=Pedido";

function janelaFake() {
  const close = vi.fn();
  const janela: JanelaWhatsapp = { location: { href: "" }, close };
  return { janela, close };
}

/**
 * Janela que registra a ORDEM entre `opener = null` e a navegação — a mitigação
 * de reverse tabnabbing só vale se o desapossamento vier ANTES do href externo.
 */
function janelaComOrdem() {
  const ordem: string[] = [];
  const close = vi.fn(() => ordem.push("close"));
  let href = "";
  let opener: unknown = {};
  const janela: JanelaWhatsapp = {
    close,
    get location() {
      return {
        get href() {
          return href;
        },
        set href(v: string) {
          href = v;
          ordem.push("navegar");
        },
      };
    },
    get opener() {
      return opener;
    },
    set opener(v: unknown) {
      opener = v;
      ordem.push("opener=null");
    },
  };
  return { janela, ordem, close, lerHref: () => href, lerOpener: () => opener };
}

describe("prepararAbaWhatsapp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preAbrir=false: não abre janela e concluir(href) é no-op", () => {
    const { janela, close } = janelaFake();
    const abrir = vi.fn(() => janela);

    const aba = prepararAbaWhatsapp(false, abrir);
    aba.concluir(HREF_OK);

    expect(abrir).not.toHaveBeenCalled();
    expect(janela.location.href).toBe("");
    expect(close).not.toHaveBeenCalled();
  });

  it("preAbrir=true: abre a aba UMA vez e ANTES de qualquer concluir (gesto do clique)", () => {
    const ordem: string[] = [];
    const { janela } = janelaFake();
    const abrir = vi.fn(() => {
      ordem.push("abrir");
      return janela;
    });

    const aba = prepararAbaWhatsapp(true, abrir);
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(ordem).toEqual(["abrir"]);

    ordem.push("concluir");
    aba.concluir(HREF_OK);

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(ordem).toEqual(["abrir", "concluir"]);
  });

  it("sucesso: concluir(href https) navega a aba e NÃO fecha", () => {
    const { janela, close } = janelaFake();

    prepararAbaWhatsapp(true, () => janela).concluir(HREF_OK);

    expect(janela.location.href).toBe(HREF_OK);
    expect(close).not.toHaveBeenCalled();
  });

  it("divergência com o servidor: concluir(null) fecha a aba e não navega", () => {
    const { janela, close } = janelaFake();

    prepararAbaWhatsapp(true, () => janela).concluir(null);

    expect(close).toHaveBeenCalledTimes(1);
    expect(janela.location.href).toBe("");
  });

  it("popup bloqueado (abrir devolve null): concluir não lança", () => {
    const aba = prepararAbaWhatsapp(true, () => null);

    expect(() => aba.concluir(HREF_OK)).not.toThrow();
    expect(() => aba.concluir(null)).not.toThrow();
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "\tjavascript:alert(1)",
    "\njavascript:alert(1)",
    "\u0000https://api.whatsapp.com/send",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "http://api.whatsapp.com/send",
    "HTTPS://api.whatsapp.com/send",
    "//evil.com",
    "https:/api.whatsapp.com/send",
  ])(
    "anti-XSS §15: href %j fecha a aba e não navega",
    (href) => {
      const { janela, close } = janelaFake();

      prepararAbaWhatsapp(true, () => janela).concluir(href);

      expect(janela.location.href).toBe("");
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it("reverse tabnabbing: anula `opener` ANTES de navegar para o domínio externo", () => {
    const { janela, ordem, lerOpener, close } = janelaComOrdem();

    prepararAbaWhatsapp(true, () => janela).concluir(HREF_OK);

    expect(ordem).toEqual(["opener=null", "navegar"]);
    expect(lerOpener()).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it("fail-closed: se `opener` não puder ser anulado, NÃO navega e fecha a aba", () => {
    const close = vi.fn();
    const janela: JanelaWhatsapp = {
      location: { href: "" },
      close,
      set opener(_v: unknown) {
        throw new TypeError("somente leitura");
      },
      get opener() {
        return {};
      },
    };

    prepararAbaWhatsapp(true, () => janela).concluir(HREF_OK);

    expect(janela.location.href).toBe("");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("atribuição de href que lança: fecha a aba em vez de deixá-la órfã", () => {
    const close = vi.fn();
    const janela: JanelaWhatsapp = {
      close,
      opener: {},
      get location() {
        return {
          get href() {
            return "";
          },
          set href(_v: string) {
            throw new Error("COOP");
          },
        };
      },
    };

    expect(() =>
      prepararAbaWhatsapp(true, () => janela).concluir(HREF_OK),
    ).not.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("close() que lança não propaga a exceção (best-effort RN-A4)", () => {
    const janela: JanelaWhatsapp = {
      location: { href: "" },
      close: () => {
        throw new Error("COOP");
      },
    };

    expect(() => prepararAbaWhatsapp(true, () => janela).concluir(null)).not.toThrow();
  });
});

describe("abrirAbaEmBranco (default)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sem window (SSR): devolve null sem lançar", () => {
    vi.stubGlobal("window", undefined);

    expect(abrirAbaEmBranco()).toBeNull();
  });

  it("com window: chama window.open('', '_blank') e devolve a janela", () => {
    const { janela } = janelaFake();
    const open = vi.fn(() => janela);
    vi.stubGlobal("window", { open });

    expect(abrirAbaEmBranco()).toBe(janela);
    expect(open).toHaveBeenCalledWith("", "_blank");
  });

  it("window.open que lança: devolve null", () => {
    vi.stubGlobal("window", {
      open: () => {
        throw new Error("bloqueado");
      },
    });

    expect(abrirAbaEmBranco()).toBeNull();
  });
});
