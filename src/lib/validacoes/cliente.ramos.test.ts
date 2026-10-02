import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  MENSAGEM_IDADE_MINIMA,
  schemaCadastroCliente,
  schemaCompletarPerfil,
  schemaEnderecoCliente,
  schemaEntrarCliente,
  schemaExcluirConta,
  schemaIdEnderecoCliente,
  schemaNovaSenhaCliente,
  schemaPerfilCliente,
  schemaRecuperacaoCliente,
  schemaSairCliente,
  schemaSalvarEnderecoCliente,
  validarDataNascimento,
} from "./cliente";

/**
 * P18 — ramos que o RED (cliente.test.ts) não cobre. Relógio congelado em
 * 2026-10-02T12:00Z onde o schema usa `new Date()`; `validarDataNascimento`
 * recebe `hoje` por parâmetro. Dados fictícios.
 */
const GUID = "44444444-4444-4444-4444-444444444444";
const endereco = () => ({
  rotulo: "Casa",
  cep: "01001-000",
  rua: "Rua Exemplo",
  numero: "100",
  bairro: "Centro",
  cidade: "Cidade Teste",
  uf: "SP",
});
const perfil = () => ({
  nome: "Pessoa Teste",
  telefone: "(11) 90000-0000",
  data_nascimento: "1990-05-10",
  aceita_marketing: false,
});
const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
});
afterAll(() => vi.useRealTimers());

describe("validarDataNascimento — bordas com `hoje` injetado", () => {
  const hoje = new Date("2026-10-02T23:59:59.000Z");
  it("válida → null; 120 anos exatos aceita, 1 dia a mais rejeita", () => {
    expect(validarDataNascimento("1990-05-10", hoje)).toBeNull();
    expect(validarDataNascimento("1906-10-02", hoje)).toBeNull();
    expect(validarDataNascimento("1906-10-01", hoje)).toBe("Data de nascimento inválida.");
  });
  it("hoje exato (futuro zero) → menor de idade, não 'futura'; amanhã → futura", () => {
    expect(validarDataNascimento("2026-10-02", hoje)).toBe(MENSAGEM_IDADE_MINIMA);
    expect(validarDataNascimento("2026-10-03", hoje)).toBe("Data de nascimento não pode ser futura.");
  });
  it("29/02: nascido em 2008-02-29 só é 18 em 2026-03-01 (não 02-28)", () => {
    expect(validarDataNascimento("2008-02-29", new Date("2026-02-28T12:00:00Z"))).toBe(MENSAGEM_IDADE_MINIMA);
    expect(validarDataNascimento("2008-02-29", new Date("2026-03-01T12:00:00Z"))).toBeNull();
  });
  it("hoje em 29/02 de ano bissexto: nascido em 2006-03-01 ainda tem 17", () => {
    const h = new Date("2024-02-29T12:00:00Z");
    expect(validarDataNascimento("2006-03-01", h)).toBe(MENSAGEM_IDADE_MINIMA);
    expect(validarDataNascimento("2006-02-28", h)).toBeNull();
  });
  it("formatos não ISO ou datas impossíveis → inválida", () => {
    for (const v of ["", "2000-1-1", "01/01/2000", "2000-01-01T00:00:00Z", "2000-13-01", "2001-02-29", "0000-00-00", " 2000-01-01"]) {
      expect(validarDataNascimento(v, hoje), v).toBe("Data de nascimento inválida.");
    }
  });
});

describe("schemaPerfilCliente — ramos de campo", () => {
  it("aceita_marketing omitido → false (RN-12, default)", () => {
    const { aceita_marketing: _m, ...sem } = perfil();
    const r = schemaPerfilCliente.safeParse(sem);
    expect(r.success).toBe(true);
    expect(r.success && r.data.aceita_marketing).toBe(false);
  });
  it("aceita_marketing não-booleano ('true', 1) → rejeitado", () => {
    expect(ok(schemaPerfilCliente, { ...perfil(), aceita_marketing: "true" })).toBe(false);
    expect(ok(schemaPerfilCliente, { ...perfil(), aceita_marketing: 1 })).toBe(false);
  });
  it("nome só com espaços → rejeitado; nome sai com trim", () => {
    expect(ok(schemaPerfilCliente, { ...perfil(), nome: "   " })).toBe(false);
    const r = schemaPerfilCliente.safeParse({ ...perfil(), nome: "  Ana  " });
    expect(r.success && r.data.nome).toBe("Ana");
  });
  it("telefone: 8 e 20 caracteres passam; 7 e 21 não; letras não", () => {
    expect(ok(schemaPerfilCliente, { ...perfil(), telefone: "12345678" })).toBe(true);
    expect(ok(schemaPerfilCliente, { ...perfil(), telefone: "1".repeat(20) })).toBe(true);
    expect(ok(schemaPerfilCliente, { ...perfil(), telefone: "1234567" })).toBe(false);
    expect(ok(schemaPerfilCliente, { ...perfil(), telefone: "1".repeat(21) })).toBe(false);
    expect(ok(schemaPerfilCliente, { ...perfil(), telefone: "1199999-abcd" })).toBe(false);
  });
  it("campos ausentes (nome, telefone, data) → rejeitado", () => {
    for (const k of ["nome", "telefone", "data_nascimento"] as const) {
      const p: Record<string, unknown> = perfil();
      delete p[k];
      expect(ok(schemaPerfilCliente, p), k).toBe(false);
    }
  });
  it("null / undefined / [] / string como payload → rejeitado", () => {
    for (const v of [null, undefined, [], "x", 0]) expect(ok(schemaPerfilCliente, v)).toBe(false);
  });
});

describe("schemaEnderecoCliente — CEP, UF e limites dos CHECKs", () => {
  it("CEP com e sem hífen passam; formatos errados não", () => {
    expect(ok(schemaEnderecoCliente, { ...endereco(), cep: "01001000" })).toBe(true);
    for (const cep of ["1001-000", "01001-00", "0100-1000", "abcde-fgh", "", "01001 000", "01001-0000"]) {
      expect(ok(schemaEnderecoCliente, { ...endereco(), cep }), cep).toBe(false);
    }
  });
  it("UF com 1 ou 3 letras → rejeitada", () => {
    expect(ok(schemaEnderecoCliente, { ...endereco(), uf: "S" })).toBe(false);
    expect(ok(schemaEnderecoCliente, { ...endereco(), uf: "SPP" })).toBe(false);
  });
  it("rua 200 passa / 201 não; numero 20 / 21; bairro 100 / 101; cidade 100 / 101", () => {
    const casos: [string, number][] = [["rua", 200], ["numero", 20], ["bairro", 100], ["cidade", 100]];
    for (const [k, max] of casos) {
      expect(ok(schemaEnderecoCliente, { ...endereco(), [k]: "a".repeat(max) }), `${k} ${max}`).toBe(true);
      expect(ok(schemaEnderecoCliente, { ...endereco(), [k]: "a".repeat(max + 1) }), `${k} ${max + 1}`).toBe(false);
      expect(ok(schemaEnderecoCliente, { ...endereco(), [k]: "   " }), `${k} vazio`).toBe(false);
    }
  });
  it("rótulo ausente → rejeitado (obrigatório no endereço de cliente)", () => {
    const { rotulo: _r, ...sem } = endereco();
    expect(ok(schemaEnderecoCliente, sem)).toBe(false);
  });
  it("padrao no payload → rejeitado (.strict(): padrão só por definirEnderecoPadrao)", () => {
    expect(ok(schemaEnderecoCliente, { ...endereco(), padrao: true })).toBe(false);
  });
});

describe("schemaSalvarEnderecoCliente / schemaIdEnderecoCliente / excluir / sair", () => {
  it("sem id (criar) e com id guid (editar) passam", () => {
    expect(ok(schemaSalvarEnderecoCliente, endereco())).toBe(true);
    expect(ok(schemaSalvarEnderecoCliente, { ...endereco(), id: GUID })).toBe(true);
  });
  it("id não-guid → rejeitado; cliente_id e padrao → rejeitados", () => {
    expect(ok(schemaSalvarEnderecoCliente, { ...endereco(), id: "1 OR 1=1" })).toBe(false);
    expect(ok(schemaSalvarEnderecoCliente, { ...endereco(), cliente_id: GUID })).toBe(false);
    expect(ok(schemaSalvarEnderecoCliente, { ...endereco(), padrao: true })).toBe(false);
  });
  it("schemaIdEnderecoCliente: só { id: guid }", () => {
    expect(ok(schemaIdEnderecoCliente, { id: GUID })).toBe(true);
    expect(ok(schemaIdEnderecoCliente, {})).toBe(false);
    expect(ok(schemaIdEnderecoCliente, { id: "x" })).toBe(false);
    expect(ok(schemaIdEnderecoCliente, { id: GUID, cliente_id: GUID })).toBe(false);
  });
  it("schemaExcluirConta: {} passa; qualquer campo (ex.: id alheio) → rejeitado", () => {
    expect(ok(schemaExcluirConta, {})).toBe(true);
    expect(ok(schemaExcluirConta, { id: GUID })).toBe(false);
    expect(ok(schemaExcluirConta, [])).toBe(false);
  });
  it("schemaSairCliente: next opcional ≤2048; extra rejeitado", () => {
    expect(ok(schemaSairCliente, {})).toBe(true);
    expect(ok(schemaSairCliente, { next: "/x".padEnd(2048, "a") })).toBe(true);
    expect(ok(schemaSairCliente, { next: "/x".padEnd(2049, "a") })).toBe(false);
    expect(ok(schemaSairCliente, { next: "/x", papel: "lojista" })).toBe(false);
  });
});

describe("schemas de auth — ramos", () => {
  it("next > 2048 rejeitado em cadastro, entrar, recuperação e nova senha", () => {
    const longo = "/".padEnd(2049, "a");
    expect(ok(schemaCadastroCliente, { email: "a@exemplo.test", senha: "senha1234", next: longo })).toBe(false);
    expect(ok(schemaEntrarCliente, { email: "a@exemplo.test", senha: "x", next: longo })).toBe(false);
    expect(ok(schemaRecuperacaoCliente, { email: "a@exemplo.test", next: longo })).toBe(false);
    expect(ok(schemaNovaSenhaCliente, { senha: "senha1234", confirmacao: "senha1234", next: longo })).toBe(false);
  });
  it("entrar: senha vazia rejeitada; senha de 1 caractere ou de 200 passa (sem política)", () => {
    expect(ok(schemaEntrarCliente, { email: "a@exemplo.test", senha: "" })).toBe(false);
    expect(ok(schemaEntrarCliente, { email: "a@exemplo.test", senha: "x" })).toBe(true);
    expect(ok(schemaEntrarCliente, { email: "a@exemplo.test", senha: "x".repeat(200) })).toBe(true);
  });
  it("nova senha: erro de divergência aponta o campo 'confirmacao'", () => {
    const r = schemaNovaSenhaCliente.safeParse({ senha: "senha1234", confirmacao: "senha12345" });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues.some((i) => i.path.join(".") === "confirmacao")).toBe(true);
  });
  it("e-mail vazio / sem domínio → rejeitado em todos os schemas de e-mail", () => {
    for (const email of ["", "a@", "@x.com", "sem-arroba"]) {
      expect(ok(schemaCadastroCliente, { email, senha: "senha1234" }), email).toBe(false);
      expect(ok(schemaRecuperacaoCliente, { email }), email).toBe(false);
    }
  });
});

describe("schemaCompletarPerfil — ramos", () => {
  const base = () => ({ ...perfil(), aceiteTermos: true, endereco: endereco() });
  it("endereço sem rótulo ou com UF inválida → rejeitado (aninhado)", () => {
    expect(ok(schemaCompletarPerfil, { ...base(), endereco: { ...endereco(), uf: "S" } })).toBe(false);
    const { rotulo: _r, ...sem } = endereco();
    expect(ok(schemaCompletarPerfil, { ...base(), endereco: sem })).toBe(false);
  });
  it("campo `padrao` dentro do endereço → rejeitado", () => {
    expect(ok(schemaCompletarPerfil, { ...base(), endereco: { ...endereco(), padrao: true } })).toBe(false);
  });
  it("aceita `next` opcional; aceiteTermos null/undefined/0 → rejeitado", () => {
    expect(ok(schemaCompletarPerfil, { ...base(), next: "/loja/x" })).toBe(true);
    for (const v of [null, undefined, 0, 1]) expect(ok(schemaCompletarPerfil, { ...base(), aceiteTermos: v })).toBe(false);
  });
  it("nascimento futuro devolve a mensagem de futuro (não a de idade)", () => {
    const r = schemaCompletarPerfil.safeParse({ ...base(), data_nascimento: "2026-10-03" });
    expect(!r.success && r.error.issues.map((i) => i.message)).toContain("Data de nascimento não pode ser futura.");
  });
});
