import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * Fase RED (TDD) — issue 336, fatia B4 (+ schemas de auth da B3).
 * Alvo: `src/lib/validacoes/cliente.ts` (ainda não existe).
 *
 * Import dinâmico por caso (padrão de `src/lib/utils/papeis.test.ts`): o vermelho
 * é por caso, não um erro de coleta do arquivo inteiro, e sem stub de produção.
 *
 * Borda dos 18 anos com DATA FIXA: o relógio é congelado em 2026-10-02T12:00Z
 * (TZ do runner = UTC, vitest.config.ts). O schema calcula a idade na hora do
 * parse; nenhum caso depende do dia em que a suíte roda.
 */

type Schema = {
  safeParse: (v: unknown) => {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { issues: { message: string }[] };
  };
};
type Mod = {
  schemaCadastroCliente: Schema;
  schemaEntrarCliente: Schema;
  schemaRecuperacaoCliente: Schema;
  schemaNovaSenhaCliente: Schema;
  schemaPerfilCliente: Schema;
  schemaCompletarPerfil: Schema;
  schemaEnderecoCliente: Schema;
};

async function carregar(): Promise<Mod> {
  return (await import("./cliente")) as unknown as Mod;
}

const MSG_18 = "Você precisa ter 18 anos ou mais para criar uma conta.";

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

const completar = () => ({ ...perfil(), aceiteTermos: true, endereco: endereco() });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

// ───────────────────────── endereço (rótulo / complemento) ─────────────────────
describe("schemaEnderecoCliente — rótulo, complemento e .strict()", () => {
  it("endereço válido passa e o rótulo sai com trim", async () => {
    const { schemaEnderecoCliente } = await carregar();
    const r = schemaEnderecoCliente.safeParse({ ...endereco(), rotulo: "  Casa  " });
    expect(r.success).toBe(true);
    expect(r.data?.rotulo).toBe("Casa");
  });

  it("rótulo vazio ou só espaços → rejeitado", async () => {
    const { schemaEnderecoCliente } = await carregar();
    expect(schemaEnderecoCliente.safeParse({ ...endereco(), rotulo: "" }).success).toBe(false);
    expect(schemaEnderecoCliente.safeParse({ ...endereco(), rotulo: "   " }).success).toBe(false);
  });

  it("rótulo com 30 caracteres passa; com 31 → rejeitado", async () => {
    const { schemaEnderecoCliente } = await carregar();
    expect(schemaEnderecoCliente.safeParse({ ...endereco(), rotulo: "a".repeat(30) }).success).toBe(true);
    expect(schemaEnderecoCliente.safeParse({ ...endereco(), rotulo: "a".repeat(31) }).success).toBe(false);
  });

  it("rótulo com \\n ou \\r → rejeitado", async () => {
    const { schemaEnderecoCliente } = await carregar();
    expect(schemaEnderecoCliente.safeParse({ ...endereco(), rotulo: "Casa\nRua" }).success).toBe(false);
    expect(schemaEnderecoCliente.safeParse({ ...endereco(), rotulo: "Casa\rRua" }).success).toBe(false);
  });

  it("complemento com 100 caracteres passa; com 101 → rejeitado", async () => {
    const { schemaEnderecoCliente } = await carregar();
    expect(schemaEnderecoCliente.safeParse({ ...endereco(), complemento: "c".repeat(100) }).success).toBe(true);
    expect(schemaEnderecoCliente.safeParse({ ...endereco(), complemento: "c".repeat(101) }).success).toBe(false);
  });

  for (const extra of ["cliente_id", "id", "loja_id", "papel"]) {
    it(`campo extra '${extra}' → rejeitado (.strict())`, async () => {
      const { schemaEnderecoCliente } = await carregar();
      const r = schemaEnderecoCliente.safeParse({ ...endereco(), [extra]: "33333333-3333-3333-3333-333333333333" });
      expect(r.success).toBe(false);
    });
  }
});

// ───────────────────────── perfil (nome, telefone, nascimento) ─────────────────
describe("schemaPerfilCliente — nome, telefone e campos autoritativos", () => {
  it("perfil válido passa", async () => {
    const { schemaPerfilCliente } = await carregar();
    expect(schemaPerfilCliente.safeParse(perfil()).success).toBe(true);
  });

  it("nome com 120 caracteres passa; com 121 → rejeitado; vazio → rejeitado", async () => {
    const { schemaPerfilCliente } = await carregar();
    expect(schemaPerfilCliente.safeParse({ ...perfil(), nome: "n".repeat(120) }).success).toBe(true);
    expect(schemaPerfilCliente.safeParse({ ...perfil(), nome: "n".repeat(121) }).success).toBe(false);
    expect(schemaPerfilCliente.safeParse({ ...perfil(), nome: "   " }).success).toBe(false);
  });

  it("telefone fora da regex de pedido.ts → rejeitado", async () => {
    const { schemaPerfilCliente } = await carregar();
    expect(schemaPerfilCliente.safeParse({ ...perfil(), telefone: "abc" }).success).toBe(false);
    expect(schemaPerfilCliente.safeParse({ ...perfil(), telefone: "1".repeat(21) }).success).toBe(false);
  });

  for (const extra of [
    "id",
    "cliente_id",
    "papel",
    "loja_id",
    "criado_em",
    "ultimo_acesso_em",
    "consentimento_em",
    "consentimento_versao",
  ]) {
    it(`campo autoritativo '${extra}' no payload → rejeitado (.strict())`, async () => {
      const { schemaPerfilCliente } = await carregar();
      expect(schemaPerfilCliente.safeParse({ ...perfil(), [extra]: "x" }).success).toBe(false);
    });
  }
});

describe("schemaPerfilCliente — data_nascimento (decisão 17), hoje fixo = 2026-10-02", () => {
  it("borda: completa 18 anos HOJE (2008-10-02) → aceita", async () => {
    const { schemaPerfilCliente } = await carregar();
    expect(schemaPerfilCliente.safeParse({ ...perfil(), data_nascimento: "2008-10-02" }).success).toBe(true);
  });

  it("borda: completa 18 anos AMANHÃ (2008-10-03) → rejeitada com a mensagem da decisão 17", async () => {
    const { schemaPerfilCliente } = await carregar();
    const r = schemaPerfilCliente.safeParse({ ...perfil(), data_nascimento: "2008-10-03" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(MSG_18);
  });

  it("data futura (2026-10-03) → rejeitada", async () => {
    const { schemaPerfilCliente } = await carregar();
    expect(schemaPerfilCliente.safeParse({ ...perfil(), data_nascimento: "2026-10-03" }).success).toBe(false);
  });

  it("121 anos (1905-01-01) → rejeitada; 119 anos (1906-10-03) → aceita", async () => {
    const { schemaPerfilCliente } = await carregar();
    expect(schemaPerfilCliente.safeParse({ ...perfil(), data_nascimento: "1905-01-01" }).success).toBe(false);
    expect(schemaPerfilCliente.safeParse({ ...perfil(), data_nascimento: "1906-10-03" }).success).toBe(true);
  });

  it("data inválida (2007-02-30 / texto) → rejeitada", async () => {
    const { schemaPerfilCliente } = await carregar();
    expect(schemaPerfilCliente.safeParse({ ...perfil(), data_nascimento: "2007-02-30" }).success).toBe(false);
    expect(schemaPerfilCliente.safeParse({ ...perfil(), data_nascimento: "ontem" }).success).toBe(false);
  });
});

// ───────────────────────── completar perfil (decisão 19) ───────────────────────
describe("schemaCompletarPerfil — aceite de termos e endereço", () => {
  it("payload completo passa", async () => {
    const { schemaCompletarPerfil } = await carregar();
    expect(schemaCompletarPerfil.safeParse(completar()).success).toBe(true);
  });

  it("sem aceiteTermos → rejeitado", async () => {
    const { schemaCompletarPerfil } = await carregar();
    const { aceiteTermos: _a, ...semAceite } = completar();
    expect(schemaCompletarPerfil.safeParse(semAceite).success).toBe(false);
  });

  it("aceiteTermos false ou 'true' (string) → rejeitado (literal true)", async () => {
    const { schemaCompletarPerfil } = await carregar();
    expect(schemaCompletarPerfil.safeParse({ ...completar(), aceiteTermos: false }).success).toBe(false);
    expect(schemaCompletarPerfil.safeParse({ ...completar(), aceiteTermos: "true" }).success).toBe(false);
  });

  it("sem endereço → rejeitado (decisão 8, mínimo 1)", async () => {
    const { schemaCompletarPerfil } = await carregar();
    const { endereco: _e, ...semEndereco } = completar();
    expect(schemaCompletarPerfil.safeParse(semEndereco).success).toBe(false);
  });

  it("versão de termos no payload → rejeitado (versão é do servidor)", async () => {
    const { schemaCompletarPerfil } = await carregar();
    expect(schemaCompletarPerfil.safeParse({ ...completar(), versao: "1999-01-01" }).success).toBe(false);
    expect(
      schemaCompletarPerfil.safeParse({ ...completar(), consentimento_versao: "1999-01-01" }).success,
    ).toBe(false);
  });

  it("menor de 18 → rejeitado com a mensagem da decisão 17", async () => {
    const { schemaCompletarPerfil } = await carregar();
    const r = schemaCompletarPerfil.safeParse({ ...completar(), data_nascimento: "2008-10-03" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(MSG_18);
  });

  it("endereço com cliente_id injetado → rejeitado (.strict() aninhado)", async () => {
    const { schemaCompletarPerfil } = await carregar();
    const r = schemaCompletarPerfil.safeParse({
      ...completar(),
      endereco: { ...endereco(), cliente_id: "33333333-3333-3333-3333-333333333333" },
    });
    expect(r.success).toBe(false);
  });
});

// ───────────────────────── auth (cadastro / entrar / recuperação) ──────────────
describe("schemaCadastroCliente — só e-mail e senha (RN-06)", () => {
  const ok = () => ({ email: "pessoa@exemplo.test", senha: "senha1234" });

  it("e-mail + senha válidos passam", async () => {
    const { schemaCadastroCliente } = await carregar();
    expect(schemaCadastroCliente.safeParse(ok()).success).toBe(true);
  });

  it("senha 7 → rejeitada; 72 → aceita; 73 → rejeitada", async () => {
    const { schemaCadastroCliente } = await carregar();
    expect(schemaCadastroCliente.safeParse({ ...ok(), senha: "s".repeat(7) }).success).toBe(false);
    expect(schemaCadastroCliente.safeParse({ ...ok(), senha: "s".repeat(72) }).success).toBe(true);
    expect(schemaCadastroCliente.safeParse({ ...ok(), senha: "s".repeat(73) }).success).toBe(false);
  });

  it("e-mail malformado → rejeitado", async () => {
    const { schemaCadastroCliente } = await carregar();
    expect(schemaCadastroCliente.safeParse({ ...ok(), email: "nao-e-email" }).success).toBe(false);
  });

  for (const extra of ["aceiteTermos", "nome", "telefone", "papel", "loja_id", "id", "cliente_id"]) {
    it(`'${extra}' no payload → rejeitado (.strict())`, async () => {
      const { schemaCadastroCliente } = await carregar();
      const valor = extra === "aceiteTermos" ? true : "x";
      expect(schemaCadastroCliente.safeParse({ ...ok(), [extra]: valor }).success).toBe(false);
    });
  }
});

describe("schemaEntrarCliente / schemaRecuperacaoCliente / schemaNovaSenhaCliente — .strict()", () => {
  it("entrar: válido passa; papel/loja_id injetados → rejeitado", async () => {
    const { schemaEntrarCliente } = await carregar();
    const ok = { email: "pessoa@exemplo.test", senha: "qualquer" };
    expect(schemaEntrarCliente.safeParse(ok).success).toBe(true);
    expect(schemaEntrarCliente.safeParse({ ...ok, papel: "lojista" }).success).toBe(false);
    expect(schemaEntrarCliente.safeParse({ ...ok, loja_id: "x" }).success).toBe(false);
  });

  it("recuperação: só e-mail; papel injetado → rejeitado", async () => {
    const { schemaRecuperacaoCliente } = await carregar();
    expect(schemaRecuperacaoCliente.safeParse({ email: "pessoa@exemplo.test" }).success).toBe(true);
    expect(
      schemaRecuperacaoCliente.safeParse({ email: "pessoa@exemplo.test", papel: "lojista" }).success,
    ).toBe(false);
  });

  it("nova senha: 8–72 com confirmação igual; divergente ou curta → rejeitada; extra → rejeitado", async () => {
    const { schemaNovaSenhaCliente } = await carregar();
    expect(schemaNovaSenhaCliente.safeParse({ senha: "novaSenha1", confirmacao: "novaSenha1" }).success).toBe(true);
    expect(schemaNovaSenhaCliente.safeParse({ senha: "novaSenha1", confirmacao: "outraSenha" }).success).toBe(false);
    expect(schemaNovaSenhaCliente.safeParse({ senha: "curta", confirmacao: "curta" }).success).toBe(false);
    expect(
      schemaNovaSenhaCliente.safeParse({ senha: "s".repeat(73), confirmacao: "s".repeat(73) }).success,
    ).toBe(false);
    expect(
      schemaNovaSenhaCliente.safeParse({ senha: "novaSenha1", confirmacao: "novaSenha1", papel: "lojista" })
        .success,
    ).toBe(false);
  });
});
