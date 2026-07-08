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
const LOJA_DIR = join(RAIZ, "[lojaId]");

type ModuloAction = { rotulo: string; fonte: string };

/**
 * Caminha recursivamente por TODO `src/app/admin/assinantes/**`, listando
 * .ts/.tsx (exceto `.test.ts(x)`). Base da descoberta POR CONTEÚDO abaixo —
 * não confia em nome/pasta de arquivo.
 */
function todosArquivosFonte(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      out.push(...todosArquivosFonte(caminho));
    } else if (
      (entrada.name.endsWith(".ts") || entrada.name.endsWith(".tsx")) &&
      !entrada.name.endsWith(".test.ts") &&
      !entrada.name.endsWith(".test.tsx")
    ) {
      out.push(caminho);
    }
  }
  return out;
}

/**
 * Descobre todo módulo que expõe Server Actions/loaders admin elevando a
 * service_role: `actions/*.ts` + `actions.ts` (billing/criar/excluir) + TODO
 * `[lojaId]/carga*.ts` (por NOME, precedente da issue 132) + — fechando o
 * achado #4A do pentest 2026-07-08 — QUALQUER `.ts`/`.tsx` sob
 * `assinantes/**` cujo TEXTO referencie `createServiceClient` (por
 * CONTEÚDO, não nome/pasta). Isso pega `page.tsx`/`layout.tsx`/loaders soltos
 * (ex.: `[lojaId]/cabecalho.ts`) que elevam a service_role fora de `actions/`
 * e fora do padrão `carga*.ts`, e antes escapavam por completo da descoberta
 * (buraco: `page.tsx` lê TODAS as lojas via service_role e não caía sob
 * nenhum guard transversal). Um arquivo novo qualquer que chame
 * `createServiceClient` entra sozinho, sem editar este teste.
 */
function modulosDeAction(): ModuloAction[] {
  const porNome = new Set([
    ...readdirSync(ACTIONS_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(ACTIONS_DIR, f)),
    join(RAIZ, "actions.ts"),
    ...readdirSync(LOJA_DIR)
      .filter((f) => f.startsWith("carga") && f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(LOJA_DIR, f)),
  ]);
  const porConteudo = todosArquivosFonte(RAIZ).filter((caminho) =>
    readFileSync(caminho, "utf8").includes("createServiceClient"),
  );
  const caminhos = new Set([...porNome, ...porConteudo]);
  return [...caminhos].map((caminho) => ({
    rotulo: caminho.slice(caminho.indexOf("src/")),
    fonte: readFileSync(caminho, "utf8"),
  }));
}

/**
 * Fatia a fonte em blocos, um por `export async function <nome>` (Server
 * Action) OU `export default async function <nome?>` (loader de página/
 * layout — `page.tsx`/`layout.tsx` só podem exportar default) até o próximo
 * export (ou EOF). Sem o ramo `default`, um `page.tsx` recém-descoberto pela
 * busca por conteúdo geraria ZERO blocos aqui → CAMADA 2 rodaria com 0 `it()`
 * para ele: verde por ausência de asserção, não por o guard existir de fato.
 */
function exportsAsync(fonte: string): { nome: string; corpo: string }[] {
  const re = /export\s+(?:default\s+)?async\s+function\s+([a-zA-Z0-9_]*)/g;
  const marcas: { nome: string; inicio: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte)) !== null) marcas.push({ nome: m[1] || "default", inicio: m.index });
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
// Camada 3 — ESCOPO: toda escrita svc.from(x).update/delete/insert carrega
// .eq(...) OU está ancorada por posse (allowlist explícita, revisada).
// ═══════════════════════════════════════════════════════════════════════════════
//
// Sob service_role a RLS não filtra linhas: um UPDATE/DELETE sem .eq afeta a
// tabela inteira (cross-tenant) ou é recusado pelo PostgREST. A regra é UNIVERSAL
// nas actions admin — todo write escopa por loja_id/id/zona_id — então não há
// allowlist por tabela para update/delete. `.storage.from().remove()` e as
// funções de query (aplicarStatusAdmin/criarLoja/excluir) não casam o padrão
// `.from(x).update|delete|insert`.
//
// INSERT não tem "escopo" no sentido de .eq (é criação, não filtro de linha
// existente) — achado #4A do pentest 2026-07-08: a regex original só via
// update/delete, então um `svc.from("bairros_zona").insert({ zona_id: <hostil> })`
// cru passava sem NENHUM sinal. Para insert, a prova válida é POSSE ANTERIOR já
// verificada no mesmo módulo — hoje só existe em `admin-entrega.ts`, onde cada
// insert-filho (taxas_entrega/bairros_zona, sem loja_id próprio) é ancorado em
// `escopo.buscarPorId("zonas_entrega", id)` (zona existente confirmada da
// loja-alvo) ou na zona recém-criada por `escopo.inserir` (também sob a
// loja-alvo). Isso não é detectável por regex de forma confiável, então é uma
// ALLOWLIST EXPLÍCITA por (arquivo, tabela) — revisada linha a linha ao
// escrever este teste. QUALQUER outro `.from(x).insert()` fora dela conta como
// não-escopado.
//
// LETALIDADE: remover o .eq de um update/delete, OU adicionar um insert cru
// fora da allowlist (tabela nova, ou o mesmo arquivo passando a escrever em
// outra tabela sem prova de posse), faz o statement casar ESCRITA sem casar
// EQ/allowlist → o `expect` falha nomeando o arquivo e o trecho.

// Statement de escrita: .from("tabela") ... .update(  ou  .delete(  ou  .insert(
const ESCRITA = /\.from\s*\(\s*["'`]([^"'`]+)["'`]\s*\)[\s\S]*?\.(update|delete|insert)\s*\(/;
const TEM_EQ = /\.eq\s*\(/;

/**
 * Inserts-filho ANCORADOS POR POSSE em `admin-entrega.ts` (lido linha a linha
 * ao escrever este teste): `taxas_entrega`/`bairros_zona` não têm `loja_id`
 * próprio (FK só via `zona_id`), então ficam fora do wrapper `escopo.*` — mas
 * TODA escrita neles, em `criarZonaAdmin`/`atualizarZonaAdmin`, acontece
 * depois de `escopo.buscarPorId("zonas_entrega", id)` (~112, zona alheia
 * bloqueia ANTES de tocar a filha) ou sob a zona recém-criada via
 * `escopo.inserir` (~56-63, a FK só pode apontar para uma zona que acabou de
 * nascer sob a loja-alvo). São os únicos dois casos revisados como seguros.
 */
const ALLOWLIST_INSERT: { rotulo: string; tabela: string }[] = [
  { rotulo: "src/app/admin/assinantes/actions/admin-entrega.ts", tabela: "taxas_entrega" },
  { rotulo: "src/app/admin/assinantes/actions/admin-entrega.ts", tabela: "bairros_zona" },
];

function eInsertAllowlistado(rotulo: string, tabela: string): boolean {
  return ALLOWLIST_INSERT.some((a) => a.rotulo === rotulo && a.tabela === tabela);
}

/** Quebra a fonte em statements aproximados por `;` para isolar cada cadeia PostgREST. */
function statements(fonte: string): string[] {
  return fonte.split(";");
}

describe("enforcement CAMADA 3 — ESCOPO .eq (ou posse ancorada) em toda escrita service_role", () => {
  for (const mod of modulos) {
    const escritasSemEscopo = statements(mod.fonte).filter((st) => {
      const casamento = ESCRITA.exec(st);
      if (!casamento) return false;
      if (TEM_EQ.test(st)) return false; // escopado direto por .eq
      const [, tabela, verbo] = casamento;
      if (verbo === "insert" && eInsertAllowlistado(mod.rotulo, tabela)) return false; // posse ancorada, revisada
      return true;
    });
    it(`${mod.rotulo} — todo .from().update/.delete/.insert carrega .eq(escopo) ou está na allowlist de posse`, () => {
      expect(
        escritasSemEscopo,
        `escrita service_role sem .eq de escopo (nem allowlist de posse) em ${mod.rotulo} — ` +
          `UPDATE/DELETE sem filtro afeta cross-tenant, INSERT cru cria dado hostil:\n${escritasSemEscopo.join("\n---\n")}`,
      ).toHaveLength(0);
    });
  }
});
