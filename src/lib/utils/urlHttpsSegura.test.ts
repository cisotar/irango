import { describe, expect, it } from "vitest";
import { urlHttpsSegura } from "./urlHttpsSegura";

// Invariante anti-XSS de apresentação (seguranca.md §15): só uma URL que
// comeca EXATAMENTE com "https://" pode virar src/href remoto. Qualquer outro
// protocolo/forma vira null (placeholder no render). Esta é a matriz exaustiva
// de bordas — a fonte única; os consumidores (fotoSegura) só testam delegação.
describe("urlHttpsSegura", () => {
  it("aceita URL https:// e retorna a propria URL", () => {
    expect(urlHttpsSegura("https://exemplo.com/x.jpg")).toBe(
      "https://exemplo.com/x.jpg",
    );
  });

  it("rejeita http:// (sem TLS) -> null", () => {
    expect(urlHttpsSegura("http://exemplo.com/x.jpg")).toBeNull();
  });

  it("rejeita protocolo javascript: -> null", () => {
    expect(urlHttpsSegura("javascript:alert(1)")).toBeNull();
  });

  it("rejeita data: URI -> null", () => {
    expect(urlHttpsSegura("data:image/png;base64,xxx")).toBeNull();
  });

  it("rejeita caminho relativo -> null", () => {
    expect(urlHttpsSegura("/relativo.jpg")).toBeNull();
  });

  it("rejeita HTTPS:// em maiusculo (startsWith case-sensitive) -> null", () => {
    expect(urlHttpsSegura("HTTPS://maiusculo.com/x.jpg")).toBeNull();
  });

  it("trata null -> null", () => {
    expect(urlHttpsSegura(null)).toBeNull();
  });

  it("trata undefined (arg omitido) -> null", () => {
    expect(urlHttpsSegura(undefined)).toBeNull();
  });

  it("trata string vazia -> null", () => {
    expect(urlHttpsSegura("")).toBeNull();
  });

  // --- bordas de protocolo que devem ser barradas ---

  it("rejeita URL protocol-relative //cdn (sem esquema) -> null", () => {
    // "//cdn.exemplo.com/x.jpg" não começa com "https://" — nunca vira src/href
    expect(urlHttpsSegura("//cdn.exemplo.com/x.jpg")).toBeNull();
  });

  it("rejeita ftp:// -> null", () => {
    expect(urlHttpsSegura("ftp://files.exemplo.com/x.jpg")).toBeNull();
  });

  it("rejeita string so de espacos (truthy mas invalida) -> null", () => {
    // url é truthy mas não começa com "https://" — guard mantém null
    expect(urlHttpsSegura("   ")).toBeNull();
  });

  // --- borda crítica: "https://" sem host é aceito pela função mas inutilizável ---
  // Se isso mudar de comportamento (ex: alguém adicionar validação de host),
  // esse teste falha e força revisão consciente.
  it("aceita https:// sem host — comportamento atual documentado (sem host = URL inválida)", () => {
    // A função retorna a string porque startsWith("https://") é verdadeiro.
    // O consumidor (ex: <Image>) é quem lançará erro de parse de URL.
    // Teste documenta a borda; se quisermos bloquear, a lógica muda aqui.
    expect(urlHttpsSegura("https://")).toBe("https://");
  });

  // --- bordas de bypass por prefixo (vetor clássico de XSS) ---

  it("rejeita espaco antes de https:// (bypass de prefixo) -> null", () => {
    // " https://exemplo.com" não começa com "https://" — guard rejeita corretamente.
    // Vetor clássico: atacante injeta espaço esperando que o consumidor faça trim.
    expect(urlHttpsSegura(" https://exemplo.com/x.jpg")).toBeNull();
  });

  it("rejeita newline antes de https:// (bypass de prefixo) -> null", () => {
    expect(urlHttpsSegura("\nhttps://exemplo.com/x.jpg")).toBeNull();
  });

  it("rejeita https:/ com um unico slash (typo/bypass) -> null", () => {
    // "https:/exemplo.com" — um slash só: não satisfaz startsWith("https://").
    expect(urlHttpsSegura("https:/exemplo.com")).toBeNull();
  });
});
