import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Fase RED (TDD) — issue 241 (crítica: SIM). Arquivo NOVO; nenhuma suíte
 * existente é editada.
 *
 * Complemento de `admin-produtos.paridade.test.ts`:
 *  1. PERFIL — o admin liga/desliga `modal_promocoes` pela MESMA
 *     `montarPatchPerfil`, sem segunda allowlist (provado por comportamento:
 *     o patch capturado é IGUAL ao que `montarPatchPerfil` devolve);
 *  2. CONFERÊNCIA NEGATIVA de código — os três `grep` do critério de aceite da
 *     241, congelados como asserção. São COMPLEMENTO (anti-drift textual), não
 *     a prova principal: um `{ ...payload }` novo, uma segunda cópia do schema
 *     ou um `calcularDesconto` no caminho do cupom admin passam a falhar aqui
 *     mesmo que o comportamento ainda pareça certo no mock.
 *
 * NENHUMA lógica de produção aqui.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const RAIZ = resolve(__dirname, "../../../../..");

function ler(caminho: string): string {
  return readFileSync(resolve(RAIZ, caminho), "utf8");
}

// ── mocks de I/O do caminho admin de perfil ──────────────────────────────────
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: vi.fn(async () => {}),
  obterAdminUserId: vi.fn(() => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
}));

type UpdateRegistro = { patch: Record<string, unknown>; eqCol?: string; eqVal?: unknown };
const updates: UpdateRegistro[] = [];

const clientServico = {
  from(tabela: string) {
    if (tabela === "admin_acessos") {
      return { insert: () => Promise.resolve({ error: null }) };
    }
    if (tabela !== "lojas") throw new Error(`from() inesperado: ${tabela}`);
    return {
      update(patch: Record<string, unknown>) {
        const reg: UpdateRegistro = { patch };
        updates.push(reg);
        return {
          eq(col: string, val: unknown) {
            reg.eqCol = col;
            reg.eqVal = val;
            return Promise.resolve({ data: null, error: null, count: 1 });
          },
        };
      },
    };
  },
};
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => clientServico }));

const LOJA_SEM_ENDERECO = {
  id: LOJA_ID,
  slug: "pizzaria-do-ze",
  endereco_cep: null,
  endereco_rua: null,
  endereco_numero: null,
  endereco_bairro: null,
  endereco_cidade: null,
  endereco_estado: null,
  latitude: null,
  longitude: null,
};
vi.mock("@/lib/supabase/queries/lojas", () => ({
  slugExiste: vi.fn(async () => false),
  buscarLojaAdminPorId: vi.fn(async () => LOJA_SEM_ENDERECO),
}));

vi.mock("@/lib/actions/geocodificarComRetry", () => ({
  geocodificarLojaComRetry: vi.fn(async () => ({ coords: null, motivo: "nao_encontrado" })),
}));

import { salvarPerfilAdmin } from "./admin-perfil";
import { montarPatchPerfil } from "@/lib/actions/patches-loja";

beforeEach(() => {
  updates.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("241 — perfil: o admin usa a MESMA montarPatchPerfil, sem segunda allowlist", () => {
  it("o patch do UPDATE admin é IGUAL ao de montarPatchPerfil para o mesmo dado", async () => {
    const dados = {
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
      telefone: "1130000000",
      endereco_cidade: "São Paulo",
      endereco_estado: "SP",
      whatsapp_envio_automatico: false,
      modal_promocoes: false,
    };

    const r = await salvarPerfilAdmin(LOJA_ID, dados);
    expect(r.ok).toBe(true);
    // O 2º UPDATE (par de coords derivado no servidor) não é patch de perfil:
    // a paridade de allowlist se afirma sobre o 1º.
    expect(updates.length).toBeGreaterThanOrEqual(1);
    // Igualdade ESTRUTURAL com a allowlist única — não "contém", não "chaves
    // parecidas": uma segunda allowlist no admin (a mais ou a menos) quebra aqui.
    expect(updates[0].patch).toEqual(montarPatchPerfil(dados));
    expect(updates[0].eqCol).toBe("id");
    expect(updates[0].eqVal).toBe(LOJA_ID);
  });

  it("payload hostil: o patch admin continua igual ao da allowlist única", async () => {
    const dados = { nome: "Pizzaria do Zé", slug: "pizzaria-do-ze", modal_promocoes: true };

    const r = await salvarPerfilAdmin(LOJA_ID, {
      ...dados,
      ativo: true,
      dono_id: "00000000-0000-0000-0000-000000000000",
      assinatura_status: "ativa",
      latitude: -23.5,
      longitude: -46.6,
      id: "22222222-2222-2222-2222-222222222222",
    });

    expect(r.ok).toBe(true);
    expect(updates[0].patch).toEqual(montarPatchPerfil(dados));
  });
});

describe("241 — conferência negativa de código (os greps do critério de aceite)", () => {
  const ARQUIVOS_ESCRITA = [
    "src/app/admin/assinantes/actions/admin-produtos.ts",
    "src/app/admin/assinantes/actions/admin-perfil.ts",
  ];

  it("nenhum spread de payload/dados em linha de código do caminho admin", () => {
    for (const arquivo of ARQUIVOS_ESCRITA) {
      const linhas = ler(arquivo)
        .split("\n")
        .map((l) => l.trim())
        // comentário citando o padrão proibido é permitido; código, não.
        .filter((l) => !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));
      const suspeitas = linhas.filter(
        (l) => l.includes("...payload") || l.includes("...dados"),
      );
      expect({ arquivo, suspeitas }).toEqual({ arquivo, suspeitas: [] });
    }
  });

  it("admin-cupom.ts não é caller de calcularDesconto (só o comentário)", () => {
    const codigo = ler("src/app/admin/assinantes/actions/admin-cupom.ts")
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(codigo).not.toContain("calcularDesconto");
  });

  it("os dois mundos importam o MESMO schemaProduto de @/lib/validacoes/produto", () => {
    const lojista = ler("src/lib/actions/produto.ts");
    const admin = ler("src/app/admin/assinantes/actions/admin-produtos.ts");
    for (const codigo of [lojista, admin]) {
      expect(codigo).toContain("schemaProduto");
      expect(codigo).toContain('from "@/lib/validacoes/produto"');
    }
    // Nenhuma segunda definição de schema de produto fora do módulo de validação.
    expect(admin).not.toContain("z.object(");
    expect(admin).not.toContain("const schemaProduto");
  });

  it("a mensagem de D10 tem UMA fonte: nada de texto literal no caminho admin", () => {
    const admin = ler("src/app/admin/assinantes/actions/admin-produtos.ts");
    expect(admin).not.toContain("Não dá para salvar: o preço novo");
  });
});
