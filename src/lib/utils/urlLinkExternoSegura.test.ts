import { describe, expect, it } from "vitest";

import { urlLinkExternoSegura } from "./urlLinkExternoSegura";

// Casos felizes e canonização. Os casos hostis (protocolo, credencial, IP,
// porta, tetos) vivem na suíte de vetor tests/seguranca/modal-sazonal/v2-link.

describe("urlLinkExternoSegura — casos felizes", () => {
  it("aceita https com caminho, query e fragmento, sem alterar o que já é canônico", () => {
    expect(urlLinkExternoSegura("https://exemplo.com/promo?x=1#topo")).toBe(
      "https://exemplo.com/promo?x=1#topo",
    );
  });

  it("aceita subdomínio", () => {
    expect(urlLinkExternoSegura("https://festa.exemplo.com.br/")).toBe(
      "https://festa.exemplo.com.br/",
    );
  });

  it("canoniza host em minúsculas e acrescenta a barra final", () => {
    expect(urlLinkExternoSegura("https://Exemplo.COM")).toBe("https://exemplo.com/");
  });

  it("canoniza IDN para punycode", () => {
    const r = urlLinkExternoSegura("https://ção.com/");
    expect(r).not.toBeNull();
    expect(r!.startsWith("https://xn--")).toBe(true);
  });

  it("remove segmentos `/./` e `/../` (forma canônica WHATWG)", () => {
    expect(urlLinkExternoSegura("https://exemplo.com/a/./b/../c")).toBe("https://exemplo.com/a/c");
  });

  it("aceita link para o próprio domínio do iRango (só navega, passa pelo aviso)", () => {
    expect(urlLinkExternoSegura("https://irango.vercel.app/loja/outra")).toBe(
      "https://irango.vercel.app/loja/outra",
    );
  });

  it("recusa host terminado em ponto (rótulo final vazio)", () => {
    expect(urlLinkExternoSegura("https://exemplo.com./")).toBeNull();
  });
});
