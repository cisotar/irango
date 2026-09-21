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
// Camada 3 — ESCOPO: toda escrita svc.from(x).update/delete/insert/upsert
// carrega .eq(...) OU está ancorada por posse (allowlist explícita, revisada).
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
// cru passava sem NENHUM sinal.
//
// [269 · R1] `upsert` entrou no verbo em 2026-09-21, pelo mesmo motivo e com o
// mesmo tratamento de INSERT (é criação de linha; a prova válida é `loja_id`
// injetado ou posse anterior já verificada). Até aqui a regex casava só
// `update|delete|insert`, e um `svc.from("t").upsert(...)` cru era INVISÍVEL a
// todas as camadas — já havia um no repositório
// (`admin-entrega.ts` → `taxas_entrega`, legítimo por posse ancorada, mas
// passando por AUSÊNCIA DE REDE, não por aprovação). A issue 269 introduziria o
// segundo (`cardapio_produtos`, N linhas), então a rede é fechada ANTES: o
// caminho sancionado passa a ser `escopo.inserirVarios`, que injeta `loja_id`
// por último em cada linha. Para insert, a prova válida é POSSE ANTERIOR já
// verificada no mesmo módulo — hoje só existe em `admin-entrega.ts`, onde cada
// insert-filho (taxas_entrega/bairros_zona, sem loja_id próprio) é ancorado em
// `escopo.buscarPorId("zonas_entrega", id)` (zona existente confirmada da
// loja-alvo) ou na zona recém-criada por `escopo.inserir` (também sob a
// loja-alvo). Isso não é detectável por regex de forma confiável, então é uma
// ALLOWLIST EXPLÍCITA por (arquivo, tabela) — revisada linha a linha ao
// escrever este teste. QUALQUER outro `.from(x).insert()` fora dela conta como
// não-escopado.
//
// LETALIDADE: remover o .eq de um update/delete, OU adicionar um insert/upsert
// cru fora da allowlist (tabela nova, ou o mesmo arquivo passando a escrever em
// outra tabela sem prova de posse), faz o statement casar ESCRITA sem casar
// EQ/allowlist → o `expect` falha nomeando o arquivo e o trecho. Provado por
// mutação ao fechar R1: plantar `svc.from("cardapio_produtos").upsert([...])`
// cru em `admin-produtos.ts` deixa esta camada VERMELHA.

// Statement de escrita: .from("tabela") ... .update(, .delete(, .insert( ou .upsert(
const ESCRITA = /\.from\s*\(\s*["'`]([^"'`]+)["'`]\s*\)[\s\S]*?\.(update|delete|insert|upsert)\s*\(/;

/**
 * [179] Escopo de tenant = `.eq("loja_id", ...)` NOMEANDO A COLUNA — não um
 * `.eq(` qualquer.
 *
 * A versão anterior (`/\.eq\s*\(/`) aceitava qualquer filtro: provado por
 * mutação, plantar `svc.from("zonas_entrega").update({ativo}).eq("id", id)` —
 * sem `loja_id`, que é EXATAMENTE o vetor cross-tenant real — deixava a suíte
 * admin inteira verde. O guard só pegava a ausência total de `.eq(`.
 *
 * As três formas de aspas são aceitas porque as três compilam igual; o que o
 * guard exige é o NOME da coluna.
 */
const TEM_EQ_LOJA_ID = /\.eq\s*\(\s*["'`]loja_id["'`]/;

/** Constrói o matcher de `.eq("<coluna>"` de uma entrada da allowlist. */
function temEqDaColuna(statement: string, coluna: string): boolean {
  return new RegExp(`\\.eq\\s*\\(\\s*["'\`]${coluna}["'\`]`).test(statement);
}

/**
 * Inserts/upserts-filho ANCORADOS POR POSSE em `admin-entrega.ts` (lido linha a linha
 * ao escrever este teste): `taxas_entrega`/`bairros_zona` não têm `loja_id`
 * próprio (FK só via `zona_id`), então ficam fora do wrapper `escopo.*` — mas
 * TODA escrita neles, em `criarZonaAdmin`/`atualizarZonaAdmin`, acontece
 * depois de `escopo.buscarPorId("zonas_entrega", id)` (~112, zona alheia
 * bloqueia ANTES de tocar a filha) ou sob a zona recém-criada via
 * `escopo.inserir` (~56-63, a FK só pode apontar para uma zona que acabou de
 * nascer sob a loja-alvo). São os únicos dois casos revisados como seguros.
 *
 * [269 · R1] `taxas_entrega` é escrita por `upsert` (`onConflict: "zona_id"`),
 * não por `insert`. A entrada já estava aqui e passa a valer de fato a partir
 * do momento em que a regex enxerga `upsert` — até então ela era decorativa.
 */
const ALLOWLIST_INSERT: { rotulo: string; tabela: string }[] = [
  { rotulo: "src/app/admin/assinantes/actions/admin-entrega.ts", tabela: "taxas_entrega" },
  { rotulo: "src/app/admin/assinantes/actions/admin-entrega.ts", tabela: "bairros_zona" },
];

function eInsertAllowlistado(rotulo: string, tabela: string): boolean {
  return ALLOWLIST_INSERT.some((a) => a.rotulo === rotulo && a.tabela === tabela);
}

/**
 * [179] Escritas que escopam LEGITIMAMENTE por uma coluna que não é `loja_id`.
 * Cada entrada foi lida linha a linha; a entrada NÃO isenta a escrita de filtro
 * — ela troca qual coluna o guard exige. Uma escrita allowlistada que perca o
 * `.eq` da SUA coluna continua falhando.
 *
 * Manter esta lista curta é o ponto: qualquer tabela nova escopada por algo que
 * não seja `loja_id` exige revisão humana e uma linha aqui, com o motivo.
 */
const ALLOWLIST_ESCOPO: {
  rotulo: string;
  tabela: string;
  verbo: "update" | "delete";
  coluna: string;
  motivo: string;
}[] = [
  {
    rotulo: "src/app/admin/assinantes/actions/admin-entrega.ts",
    tabela: "bairros_zona",
    verbo: "delete",
    coluna: "zona_id",
    motivo:
      "bairros_zona não tem loja_id próprio (FK só via zona_id). O delete roda " +
      "depois de escopo.buscarPorId('zonas_entrega', id), que já bloqueia zona " +
      "de outra loja — mesma posse ancorada dos inserts da ALLOWLIST_INSERT.",
  },
  {
    rotulo: "src/app/admin/assinantes/actions/admin-modulos-impressao.ts",
    tabela: "lojas",
    verbo: "update",
    coluna: "id",
    motivo:
      "Em `lojas` o `id` É a chave de tenant — não existe coluna loja_id. " +
      "Exigir loja_id aqui seria exigir uma coluna inexistente.",
  },
];

function escopoAllowlistado(
  rotulo: string,
  tabela: string,
  verbo: string,
  statement: string,
): boolean {
  const entrada = ALLOWLIST_ESCOPO.find(
    (a) => a.rotulo === rotulo && a.tabela === tabela && a.verbo === verbo,
  );
  if (!entrada) return false;
  // A allowlist troca a coluna exigida, NUNCA dispensa o filtro.
  return temEqDaColuna(statement, entrada.coluna);
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
      if (TEM_EQ_LOJA_ID.test(st)) return false; // escopado pelo tenant, o caso normal
      const [, tabela, verbo] = casamento;
      // `insert` e `upsert` são criação de linha: a prova válida é a mesma.
      if (
        (verbo === "insert" || verbo === "upsert") &&
        eInsertAllowlistado(mod.rotulo, tabela)
      ) {
        return false; // posse ancorada, revisada
      }
      if (escopoAllowlistado(mod.rotulo, tabela, verbo, st)) return false; // outra coluna de escopo, revisada
      return true;
    });
    it(`${mod.rotulo} — todo .from().update/.delete/.insert/.upsert carrega .eq("loja_id") ou está na allowlist revisada`, () => {
      expect(
        escritasSemEscopo,
        `escrita service_role sem .eq("loja_id") (nem allowlist revisada) em ${mod.rotulo} — ` +
          `UPDATE/DELETE sem filtro afeta cross-tenant, INSERT/UPSERT cru cria dado hostil ` +
          `(use escopo.inserir/escopo.inserirVarios):\n${escritasSemEscopo.join("\n---\n")}`,
      ).toHaveLength(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Camada 4 — RPC: toda chamada `svc.rpc("fn", { … })` na via admin carrega
// `p_loja_id`/`loja_id` DERIVADO do lojaId validado da URL. [issue 215]
// ═══════════════════════════════════════════════════════════════════════════════
//
// Fase RED (TDD) da issue 215. Esta camada nasce vermelha e por um motivo
// preciso: a CAMADA 3 só enxerga `.from("t") … .update|delete|insert(`. A issue
// 215 introduz a PRIMEIRA escrita admin por RPC do repositório
// (`svc.rpc("reordenar_opcionais_da_categoria", …)` e
// `svc.rpc("reordenar_itens_do_grupo_opcional", …)`), e uma escrita por RPC não
// casa aquele padrão — ou seja, hoje ela não é vista por NENHUM `it()`. Sem esta
// camada a 215 fecharia o débito 211 e abriria outro, invisível.
//
// Por que o guard exige o ARGUMENTO, e não a mera presença da chamada: sob
// `service_role` a RLS não filtra nada e a nova RPC é `security definer` — a
// trava T2 confere `p_loja_id` contra `lojas.dono_id`, mas sob `auth.role() =
// 'service_role'` ela é dispensada de propósito (é o caso [215-I5], que faz a
// via admin funcionar). Logo, na via admin o ÚNICO controle de tenant que resta
// é o valor literal de `p_loja_id`. Um `p_loja_id: parsed.data.loja_id` — id
// escolhido pelo cliente — reescreveria a ordem de qualquer loja do marketplace
// sem tocar em nada que as camadas 2 e 3 vigiam.
//
// ANTI-VACUIDADE: um guard que não acha nada passa por ausência de asserção e é
// pior do que não existir, porque dá sinal falso de cobertura. Por isso
// [215-C1] exige ao menos 2 chamadas descobertas — as duas que a 215 entrega —
// e [215-C2] exige que toda ocorrência textual de `.rpc(` seja legível pelo
// parser (uma chamada em forma que a regex não lê ficaria fora do laço).
//
// LETALIDADE: [215-C4] planta as formas hostis contra o MESMO analisador usado
// nos módulos reais e exige que ele as reprove.

/**
 * `.rpc("nome", { … })` com objeto de argumentos literal. Os args destas
 * actions são planos (identificadores), então `[^}]*` basta e é o que mantém o
 * parser legível; uma chamada com objeto aninhado deixaria de casar aqui e cai
 * na rede de [215-C2].
 */
const CHAMADA_RPC = /\.rpc\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{([^}]*)\}/g;

/** Qualquer `.rpc(` textual — a rede que impede chamada invisível ao parser. */
const QUALQUER_RPC = /\.rpc\s*\(/g;

type ChamadaRpc = { rotulo: string; fn: string; args: string; trecho: string };

function chamadasRpcDe(rotulo: string, fonte: string): ChamadaRpc[] {
  const re = new RegExp(CHAMADA_RPC.source, "g");
  const out: ChamadaRpc[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte)) !== null) {
    out.push({ rotulo, fn: m[1], args: m[2], trecho: m[0] });
  }
  return out;
}

function contarOcorrencias(fonte: string, re: RegExp): number {
  return fonte.match(new RegExp(re.source, "g"))?.length ?? 0;
}

/** Valor textual do primeiro argumento cuja chave esteja em `chaves`. */
function valorDoArgumento(args: string, chaves: string[]): string | null {
  for (const par of args.split(",")) {
    const i = par.indexOf(":");
    if (i === -1) continue;
    const chave = par.slice(0, i).trim();
    if (chaves.includes(chave)) return par.slice(i + 1).trim();
  }
  return null;
}

/**
 * As ÚNICAS origens aceitas para o id de tenant numa RPC admin:
 *  - `loja.lojaId` — saída de `validarLojaIdAdmin(lojaId)` (z.guid da URL);
 *  - `lojaId`      — o parâmetro da action, quando já validado no mesmo corpo.
 *
 * A comparação é do valor INTEIRO (`^…$`), não "contém": `parsed.data.lojaId`
 * ou `payload.lojaId` casariam num teste por substring e é exatamente o vetor
 * que esta camada existe para barrar.
 */
const ORIGEM_DERIVADA = /^(loja\.lojaId|lojaId)$/;

function rpcEscopadaPorLoja(args: string): boolean {
  const valor = valorDoArgumento(args, ["p_loja_id", "loja_id"]);
  return valor != null && ORIGEM_DERIVADA.test(valor);
}

/**
 * RPCs de LEITURA pura, que não escrevem e portanto não precisam do arg de
 * tenant. Vazia de propósito: nenhuma existe hoje, e cada entrada futura exige
 * revisão humana + motivo, igual às allowlists das camadas acima.
 */
const ALLOWLIST_RPC_LEITURA: { rotulo: string; fn: string }[] = [];

function eLeituraAllowlistada(rotulo: string, fn: string): boolean {
  return ALLOWLIST_RPC_LEITURA.some((a) => a.rotulo === rotulo && a.fn === fn);
}

const chamadasRpcAdmin = modulos.flatMap((mod) => chamadasRpcDe(mod.rotulo, mod.fonte));

describe("enforcement CAMADA 4 — escopo de tenant em toda RPC admin", () => {
  it("[215-C1] ANTI-VACUIDADE: a descoberta acha ao menos 2 chamadas svc.rpc na via admin", () => {
    // Se esta contagem for 0, o laço de [215-C3] não gera NENHUM `it()` e a
    // camada inteira vira verde por ausência de asserção.
    expect(
      chamadasRpcAdmin.length,
      "esperava >= 2 chamadas svc.rpc descobertas nas actions admin " +
        "(reordenar_opcionais_da_categoria + reordenar_itens_do_grupo_opcional, issue 215); " +
        `encontradas: ${chamadasRpcAdmin.length} → o guard da CAMADA 4 está vazio e NÃO prova nada`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("[215-C2] toda ocorrência textual de `.rpc(` é legível pelo parser desta camada", () => {
    const ilegiveis = modulos
      .map((mod) => ({
        rotulo: mod.rotulo,
        textuais: contarOcorrencias(mod.fonte, QUALQUER_RPC),
        lidas: chamadasRpcDe(mod.rotulo, mod.fonte).length,
      }))
      .filter((m) => m.textuais !== m.lidas);
    expect(
      ilegiveis,
      "chamada .rpc(...) em forma que a regex CHAMADA_RPC não lê (args fora de objeto literal, " +
        `objeto aninhado): ficaria FORA do laço da camada 4:\n${JSON.stringify(ilegiveis, null, 2)}`,
    ).toHaveLength(0);
  });

  for (const chamada of chamadasRpcAdmin) {
    if (eLeituraAllowlistada(chamada.rotulo, chamada.fn)) continue;
    it(`[215-C3] ${chamada.rotulo} → rpc("${chamada.fn}") passa p_loja_id derivado do lojaId validado`, () => {
      expect(
        rpcEscopadaPorLoja(chamada.args),
        `rpc("${chamada.fn}") em ${chamada.rotulo} não passa p_loja_id/loja_id vindo de ` +
          `loja.lojaId nem de lojaId. Sob service_role a RLS não filtra e a trava T2 é ` +
          `dispensada — o valor deste argumento é o ÚNICO escopo de tenant que resta.\n` +
          `args: {${chamada.args}}`,
      ).toBe(true);
    });
  }

  it("[215-C4] LETALIDADE: o analisador reprova as formas hostis e aprova a derivada", () => {
    const hostis: { nome: string; fonte: string }[] = [
      {
        nome: "p_loja_id vindo do payload do cliente",
        fonte: `const { error } = await svc.rpc("x", { p_loja_id: parsed.data.loja_id, p_ids: ids });`,
      },
      {
        nome: "p_loja_id vindo de um objeto qualquer com sufixo lojaId",
        fonte: `await svc.rpc("x", { p_loja_id: parsed.data.lojaId, p_ids: ids });`,
      },
      { nome: "sem argumento de tenant nenhum", fonte: `await svc.rpc("x", { p_ids: ids });` },
      {
        nome: "escopo por categoria em vez de loja",
        fonte: `await svc.rpc("x", { p_categoria_id: categoria_id, p_ids: ids });`,
      },
    ];
    for (const caso of hostis) {
      const [chamada] = chamadasRpcDe("fixture.ts", caso.fonte);
      expect(chamada, `fixture não casou a regex: ${caso.nome}`).toBeDefined();
      expect(
        rpcEscopadaPorLoja(chamada.args),
        `a camada 4 DEIXOU PASSAR a forma hostil: ${caso.nome}`,
      ).toBe(false);
    }

    const legitimas = [
      `await svc.rpc("x", { p_loja_id: loja.lojaId, p_categoria_id: categoria_id, p_ids: ids });`,
      `await svc.rpc("x", { p_ids: ids, p_loja_id: lojaId });`,
    ];
    for (const fonte of legitimas) {
      const [chamada] = chamadasRpcDe("fixture.ts", fonte);
      expect(chamada).toBeDefined();
      expect(
        rpcEscopadaPorLoja(chamada.args),
        `a camada 4 reprovou uma chamada legítima: ${fonte}`,
      ).toBe(true);
    }
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 215, camada 4:
 *
 * Nada a implementar AQUI: este arquivo é só guard. O que o GREEN precisa
 * entregar para [215-C1] e [215-C3] ficarem verdes é, em
 * `src/app/admin/assinantes/actions/admin-opcionais.ts`:
 *
 *   svc.rpc("reordenar_opcionais_da_categoria", { p_loja_id: loja.lojaId, … })
 *   svc.rpc("reordenar_itens_do_grupo_opcional", { p_loja_id: loja.lojaId, … })
 *
 * — com `loja` = `validarLojaIdAdmin(lojaId)`. Qualquer outra origem para
 * `p_loja_id` (payload, parsed.data, variável intermediária) é reprovada de
 * propósito: se o GREEN precisar de uma origem nova, ela entra em
 * `ORIGEM_DERIVADA` com revisão humana, nunca por afrouxamento da regex.
 */
