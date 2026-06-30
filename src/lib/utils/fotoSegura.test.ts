import { describe, expect, it } from "vitest";
import { fotoSegura } from "./fotoSegura";

// Invariante anti-XSS de apresentação (seguranca.md §15): só uma URL que
// comeca EXATAMENTE com "https://" pode virar src de imagem. Qualquer outro
// protocolo/forma vira null (placeholder no render).
describe("fotoSegura", () => {
  it("aceita URL https:// e retorna a propria URL", () => {
    expect(fotoSegura("https://exemplo.com/x.jpg")).toBe(
      "https://exemplo.com/x.jpg",
    );
  });

  it("rejeita http:// (sem TLS) -> null", () => {
    expect(fotoSegura("http://exemplo.com/x.jpg")).toBeNull();
  });

  it("rejeita protocolo javascript: -> null", () => {
    expect(fotoSegura("javascript:alert(1)")).toBeNull();
  });

  it("rejeita data: URI -> null", () => {
    expect(fotoSegura("data:image/png;base64,xxx")).toBeNull();
  });

  it("rejeita caminho relativo -> null", () => {
    expect(fotoSegura("/relativo.jpg")).toBeNull();
  });

  it("rejeita HTTPS:// em maiusculo (startsWith case-sensitive) -> null", () => {
    expect(fotoSegura("HTTPS://maiusculo.com/x.jpg")).toBeNull();
  });

  it("trata null -> null", () => {
    expect(fotoSegura(null)).toBeNull();
  });

  it("trata undefined (arg omitido) -> null", () => {
    expect(fotoSegura(undefined)).toBeNull();
  });

  it("trata string vazia -> null", () => {
    expect(fotoSegura("")).toBeNull();
  });

  // --- bordas de protocolo que devem ser barradas ---

  it("rejeita URL protocol-relative //cdn (sem esquema) -> null", () => {
    // "//cdn.exemplo.com/x.jpg" não começa com "https://" — nunca vira src
    expect(fotoSegura("//cdn.exemplo.com/x.jpg")).toBeNull();
  });

  it("rejeita ftp:// -> null", () => {
    expect(fotoSegura("ftp://files.exemplo.com/x.jpg")).toBeNull();
  });

  it("rejeita string so de espacos (truthy mas invalida) -> null", () => {
    // url é truthy mas não começa com "https://" — guard mantém null
    expect(fotoSegura("   ")).toBeNull();
  });

  // --- borda crítica: "https://" sem host é aceito pela função mas inutilizável ---
  // Se isso mudar de comportamento (ex: alguém adicionar validação de host),
  // esse teste falha e força revisão consciente.
  it("aceita https:// sem host — comportamento atual documentado (sem host = URL inválida para Image)", () => {
    // A função retorna a string porque startsWith("https://") é verdadeiro.
    // CardProduto passa para <Image> — Next.js lançará erro de parse de URL.
    // Teste documenta a borda; se quisermos bloquear, a lógica muda aqui.
    expect(fotoSegura("https://")).toBe("https://");
  });
});
