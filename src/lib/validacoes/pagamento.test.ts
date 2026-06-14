import { describe, it, expect } from "vitest";
// RED: schemaFormaPagamento ainda NÃO existe na forma final — a fase GREEN
// (executar) implementa src/lib/validacoes/pagamento.ts. Há apenas STUB TDD
// (z.never()) para o type-check compilar e a falha cair por ASSERÇÃO.
//
// RESPONSABILIDADE (FormPagamento + Server Action de pagamento):
// validar a FORMA da config de pagamento do lojista conforme o tipo.
//   tipo: enum 'pix' | 'dinheiro' | 'link' | 'cartao'
//   config (jsonb) varia por tipo:
//     pix      → { chave, tipo_chave } — chave válida conforme tipo_chave:
//                cpf/cnpj (dígitos), email (formato email), telefone (+55...
//                ou 55\d{10,11}), aleatoria (uuid). Rejeita chave vazia.
//     link     → { url } url válida (http/https)
//     dinheiro → config pode ser vazio ({})
//     cartao   → config pode ser vazio ({})
//
// NÃO confiar no cliente (lojista): a config é validada server-side antes de
// persistir. Uma chave pix malformada faria o comprador pagar pra ninguém.
//
// FORA DA RESPONSABILIDADE: unicidade/RLS no banco, geração de QR code.
import { schemaFormaPagamento } from "./pagamento";

// ---------------------------------------------------------------------------
// pix — caminho feliz por tipo de chave
// ---------------------------------------------------------------------------
describe("schemaFormaPagamento — pix caminho feliz", () => {
  it("aceita pix com chave telefone formato +55", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "+5511999999999", tipo_chave: "telefone" },
    });
    expect(r.success).toBe(true);
  });

  it("aceita pix com chave email", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "loja@exemplo.com", tipo_chave: "email" },
    });
    expect(r.success).toBe(true);
  });

  it("aceita pix com chave cpf (11 dígitos)", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "12345678901", tipo_chave: "cpf" },
    });
    expect(r.success).toBe(true);
  });

  it("aceita pix com chave cnpj (14 dígitos)", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "12345678000199", tipo_chave: "cnpj" },
    });
    expect(r.success).toBe(true);
  });

  it("aceita pix com chave aleatoria (uuid)", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: {
        chave: "123e4567-e89b-12d3-a456-426614174000",
        tipo_chave: "aleatoria",
      },
    });
    expect(r.success).toBe(true);
  });
});

describe("schemaFormaPagamento — pix rejeições", () => {
  // CRÍTICO (critério de aceite): chave pix telefone fora do formato rejeitada.
  it("rejeita pix com chave telefone fora do formato (curta demais)", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "5511", tipo_chave: "telefone" },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita pix com chave email malformada", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "loja@@exemplo", tipo_chave: "email" },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita pix com chave cpf com letras", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "123ABC78901", tipo_chave: "cpf" },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita pix com chave aleatoria que não é uuid", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "nao-e-uuid", tipo_chave: "aleatoria" },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita pix com chave vazia", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "", tipo_chave: "telefone" },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita pix com config vazio (sem chave)", () => {
    const r = schemaFormaPagamento.safeParse({ tipo: "pix", config: {} });
    expect(r.success).toBe(false);
  });

  it("rejeita pix com tipo_chave fora do enum", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: { chave: "qualquer", tipo_chave: "telegrama" },
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// link
// ---------------------------------------------------------------------------
describe("schemaFormaPagamento — link", () => {
  it("aceita link com url válida https", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "link",
      config: { url: "https://pagamento.exemplo.com/loja" },
    });
    expect(r.success).toBe(true);
  });

  it("rejeita link com url inválida", () => {
    const r = schemaFormaPagamento.safeParse({
      tipo: "link",
      config: { url: "isto nao e uma url" },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita link sem url no config", () => {
    const r = schemaFormaPagamento.safeParse({ tipo: "link", config: {} });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dinheiro / cartao — config pode ser vazio
// ---------------------------------------------------------------------------
describe("schemaFormaPagamento — dinheiro / cartao", () => {
  it("aceita dinheiro com config vazio", () => {
    const r = schemaFormaPagamento.safeParse({ tipo: "dinheiro", config: {} });
    expect(r.success).toBe(true);
  });

  it("aceita cartao com config vazio", () => {
    const r = schemaFormaPagamento.safeParse({ tipo: "cartao", config: {} });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tipo (enum)
// ---------------------------------------------------------------------------
describe("schemaFormaPagamento — tipo (enum)", () => {
  it("rejeita tipo fora do enum ('boleto')", () => {
    const r = schemaFormaPagamento.safeParse({ tipo: "boleto", config: {} });
    expect(r.success).toBe(false);
  });
});
