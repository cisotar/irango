import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Teste-guarda TRANSVERSAL e AUTO-DESCOBERTO do enforcement de tenant nas Server
 * Actions admin (plan/ticklish-tumbling-prism.md, camadas 2 e 3).
 *
 * As actions admin rodam com `service_role` (BYPASSA RLS): a segurança cross-tenant
 * depende de DUAS convenções manuais por action —
 *   (guard)  provar admin ANTES de elevar: prepararContextoAdmin | verificarAdminSaaS;
 *   (escopo) toda escrita svc carrega .eq(...) (loja_id/id/zona_id).
 *
 * A suíte `isolamento-admin.test.ts` prova essas invariantes por INVOCAÇÃO, mas
 * enumera as actions à mão — uma action NOVA que esqueça o padrão não é detectada.
 * Este arquivo fecha esse gap por ANÁLISE ESTÁTICA da FONTE, descoberta via
 * filesystem (`readdirSync`, mesmo precedente de tests/helpers/pglite.ts): toda
 * action nova entra automaticamente, sem editar lista.
 *
 * Não invoca as actions (não sofre do problema de montar args válidos por action);
 * lê o texto-fonte e assere a presença das duas convenções por export async.
 */

const RAIZ = join(process.cwd(), "src/app/admin/assinantes");
const ACTIONS_DIR = join(RAIZ, "actions");

type ModuloAction = { rotulo: string; fonte: string };

/**
 * Descobre todo módulo que expõe Server Actions admin elevando a service_role:
 * `actions/*.ts` + `actions.ts` (billing/criar/excluir) + `[lojaId]/carga.ts`
 * (o loader, que também eleva). Auto-descoberto — não há lista manual a manter.
 */
function modulosDeAction(): ModuloAction[] {
  const caminhos = [
    ...readdirSync(ACTIONS_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(ACTIONS_DIR, f)),
    join(RAIZ, "actions.ts"),
    join(RAIZ, "[lojaId]", "carga.ts"),
  ];
  return caminhos.map((caminho) => ({
    rotulo: caminho.slice(caminho.indexOf("src/")),
    fonte: readFileSync(caminho, "utf8"),
  }));
}

/** Fatia a fonte em blocos, um por `export async function <nome>` até o próximo (ou EOF). */
function exportsAsync(fonte: string): { nome: string; corpo: string }[] {
  const re = /export\s+async\s+function\s+([a-zA-Z0-9_]+)/g;
  const marcas: { nome: string; inicio: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte)) !== null) marcas.push({ nome: m[1], inicio: m.index });
  return marcas.map((marca, i) => ({
    nome: marca.nome,
    corpo: fonte.slice(marca.inicio, marcas[i + 1]?.inicio ?? fonte.length),
  }));
}

const modulos = modulosDeAction();

// ═══════════════════════════════════════════════════════════════════════════════
// Sanidade da descoberta — falha se o glob parar de achar as actions (evita que
// os testes abaixo virem no-op silencioso por lista vazia).
// ═══════════════════════════════════════════════════════════════════════════════

describe("enforcement: descoberta de actions admin", () => {
  it("encontra os módulos de action e ao menos 20 exports async no total", () => {
    expect(modulos.length).toBeGreaterThanOrEqual(9);
    const total = modulos.reduce((n, mod) => n + exportsAsync(mod.fonte).length, 0);
    expect(total, "esperava >= 20 Server Actions admin descobertas").toBeGreaterThanOrEqual(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Camada 2 — GUARD: toda action prova admin antes de elevar (auto-descoberto)
// ═══════════════════════════════════════════════════════════════════════════════
//
// LETALIDADE: remover a chamada de guard de qualquer export (ou adicionar uma
// action nova sem ele) faz o `expect` do bloco daquele export falhar.

const GUARD = /\b(prepararContextoAdmin|verificarAdminSaaS)\s*\(/;

describe("enforcement CAMADA 2 — GUARD de admin por export async", () => {
  for (const mod of modulos) {
    for (const exp of exportsAsync(mod.fonte)) {
      it(`${mod.rotulo} → ${exp.nome}() prova admin (prepararContextoAdmin | verificarAdminSaaS)`, () => {
        expect(
          GUARD.test(exp.corpo),
          `${exp.nome} não referencia prepararContextoAdmin nem verificarAdminSaaS — ` +
            `action admin sem guard eleva service_role sem provar admin (bypass do RN-1)`,
        ).toBe(true);
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Camada 3 — ESCOPO: toda escrita svc.from(x).update/delete carrega .eq(...)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Sob service_role a RLS não filtra linhas: um UPDATE/DELETE sem .eq afeta a
// tabela inteira (cross-tenant) ou é recusado pelo PostgREST. A regra é UNIVERSAL
// nas actions admin — todo write escopa por loja_id/id/zona_id — então não há
// allowlist por tabela. `.storage.from().remove()` e as funções de query
// (aplicarStatusAdmin/criarLoja/excluir) não casam o padrão `.from(x).update|delete`.
//
// LETALIDADE: remover o .eq de qualquer update/delete faz o statement casar
// ESCRITA sem casar EQ → o `expect` falha nomeando o arquivo.

// Statement de escrita: .from("tabela") ... .update(  ou  .delete(
const ESCRITA = /\.from\s*\(\s*["'`][^"'`]+["'`]\s*\)[\s\S]*?\.(update|delete)\s*\(/;
const TEM_EQ = /\.eq\s*\(/;

/** Quebra a fonte em statements aproximados por `;` para isolar cada cadeia PostgREST. */
function statements(fonte: string): string[] {
  return fonte.split(";");
}

describe("enforcement CAMADA 3 — ESCOPO .eq em toda escrita service_role", () => {
  for (const mod of modulos) {
    const escritasSemEscopo = statements(mod.fonte).filter(
      (st) => ESCRITA.test(st) && !TEM_EQ.test(st),
    );
    it(`${mod.rotulo} — todo .from().update/.delete carrega .eq(escopo)`, () => {
      expect(
        escritasSemEscopo,
        `escrita service_role sem .eq de escopo em ${mod.rotulo} — ` +
          `UPDATE/DELETE sem filtro afeta cross-tenant:\n${escritasSemEscopo.join("\n---\n")}`,
      ).toHaveLength(0);
    });
  }
});
