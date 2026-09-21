import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * [270 · proposta da auditoria] Trava ESTÁTICA do risco residual anotado na
 * issue 270: a prova de posse do cardápio (`cardapioPertenceALoja`) é uma
 * segunda ida ao banco, não uma garantia estrutural. Um caller futuro de
 * `cardapio_produtos` com `ON CONFLICT DO NOTHING` (`ignoreDuplicates`) ou com
 * DELETE escopado que esqueça o gate reabre o mesmo buraco — e a camada 3 de
 * `enforcement-escopo-admin.test.ts` NÃO o detecta, porque ela só exige
 * `loja_id` injetado/`.eq("loja_id")`, que o caller teria.
 *
 * Regra (o verbo decide o instrumento, plano da 270): TODA escrita em
 * `cardapio_produtos` por `upsert`/`inserirVarios` ou `delete` que more numa
 * `export async function` de `src/**` precisa de `cardapioPertenceALoja(`
 * ANTES dela, no MESMO bloco de função. Auto-descoberto por conteúdo
 * (`readdirSync` recursivo, precedente do enforcement admin): arquivo novo
 * entra sozinho.
 *
 * Fora da regra, de propósito: leituras (`select`) e a RPC
 * `aplicar_cardapio_em_categoria`, cuja posse é a trava T3 no corpo SQL.
 */

const RAIZ = join(process.cwd(), "src");

function fontesTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) out.push(...fontesTs(caminho));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(caminho);
  }
  return out;
}

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

/** `.eq("<coluna>"` — o filtro NOMEANDO a coluna, não um filtro qualquer. */
function filtraPor(trecho: string, coluna: string): boolean {
  return new RegExp(`\\.eq\\s*\\(\\s*["'\`]${coluna}["'\`]`).test(trecho);
}

/**
 * Escrita em `cardapio_produtos` sem posse. DUAS provas são aceitas:
 *
 *  (1) `cardapioPertenceALoja(` ANTES, no mesmo corpo — a prova da 270, a
 *      ÚNICA que serve para `upsert`/`inserirVarios`/`delete`, porque
 *      `ON CONFLICT DO NOTHING` descarta a linha antes da FK e um DELETE de
 *      zero linhas termina mudo;
 *  (2) [274 · D6] para UPDATE: o escopo pela TRIPLA COMPLETA (`loja_id` +
 *      `cardapio_id` + `produto_id`) com `count: "exact"` — ou
 *      `atualizarPorChave("cardapio_produtos", { cardapio_id, produto_id }, …)`,
 *      que produz exatamente isso por construção. O UPDATE transforma "zero
 *      linhas" em recusa, que é o que o gate comprava, sem a segunda ida ao
 *      banco e sem a janela TOCTOU.
 *
 * Devolve a lista de violações.
 */
export function escritasSemPosse(corpo: string): string[] {
  const gate = corpo.indexOf("cardapioPertenceALoja(");
  const comGateAntes = (indice: number) => gate !== -1 && gate < indice;
  const violacoes: string[] = [];

  // Verbos da 270: só a prova (1) serve.
  for (const re of [
    /\.from\s*\(\s*["'`]cardapio_produtos["'`]\s*\)[\s\S]*?\.(upsert|delete)\s*\(/g,
    /inserirVarios\s*\(\s*["'`]cardapio_produtos["'`]/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(corpo)) !== null) {
      if (!comGateAntes(m.index)) violacoes.push(m[0].slice(0, 80));
    }
  }

  // [274] UPDATE cru: prova (1) OU prova (2). O trecho analisado é a INSTRUÇÃO
  // (até o `;`), onde moram o `count` e os `.eq` encadeados.
  const reUpdate = /\.from\s*\(\s*["'`]cardapio_produtos["'`]\s*\)[\s\S]*?\.update\s*\(/g;
  let u: RegExpExecArray | null;
  while ((u = reUpdate.exec(corpo)) !== null) {
    const fim = corpo.indexOf(";", u.index);
    const instrucao = corpo.slice(u.index, fim === -1 ? corpo.length : fim);
    const tripla =
      filtraPor(instrucao, "loja_id") &&
      filtraPor(instrucao, "cardapio_id") &&
      filtraPor(instrucao, "produto_id");
    const contaLinhas = /count\s*:\s*["'`]exact["'`]/.test(instrucao);
    if (!comGateAntes(u.index) && !(tripla && contaLinhas)) {
      violacoes.push(u[0].slice(0, 80));
    }
  }

  // [274] `escopo.atualizarPorChave`: a prova (2) é a CHAVE COMPLETA — chave
  // parcial alcança o cardápio inteiro (ou o produto em todos os cardápios),
  // chave vazia alcança a loja inteira sob service_role.
  const reChave =
    /atualizarPorChave\s*\(\s*["'`]cardapio_produtos["'`]\s*,\s*\{([^}]*)\}/g;
  let c: RegExpExecArray | null;
  while ((c = reChave.exec(corpo)) !== null) {
    const chave = c[1];
    const completa = /\bcardapio_id\b/.test(chave) && /\bproduto_id\b/.test(chave);
    if (!comGateAntes(c.index) && !completa) violacoes.push(c[0].slice(0, 80));
  }

  return violacoes;
}

const modulos = fontesTs(RAIZ)
  .filter((c) => readFileSync(c, "utf8").includes("cardapio_produtos"))
  .map((c) => ({ rotulo: c.slice(c.indexOf("src/")), fonte: readFileSync(c, "utf8") }));

describe("270 — enforcement: escrita em cardapio_produtos exige posse do cardápio ANTES", () => {
  it("ANTI-VACUIDADE: descobre os dois callers de escrita conhecidos", () => {
    const rotulos = modulos.map((m) => m.rotulo);
    expect(rotulos).toContain("src/lib/actions/cardapio.ts");
    expect(rotulos).toContain("src/app/admin/assinantes/actions/admin-cardapios.ts");
    const escritas = modulos.flatMap((m) =>
      exportsAsync(m.fonte).filter((e) =>
        /cardapio_produtos["'`]\s*\)[\s\S]*?\.(upsert|delete|update)\s*\(|(?:inserirVarios|atualizarPorChave)\s*\(\s*["'`]cardapio_produtos/.test(e.corpo),
      ),
    );
    // aplicarCardapioEmProdutos, tirarDeCardapio e as duas gêmeas admin — mais,
    // desde a 274, `definirDiasDoVinculo` e `definirDiasDoVinculoAdmin`, que
    // escrevem por `update`. Se o regex de descoberta não aprender o verbo
    // novo, as duas ficam invisíveis ao guard e este número não sobe.
    expect(escritas.length).toBeGreaterThanOrEqual(6);
  });

  for (const mod of modulos) {
    for (const exp of exportsAsync(mod.fonte)) {
      it(`${mod.rotulo} → ${exp.nome}() não escreve em cardapio_produtos sem cardapioPertenceALoja antes`, () => {
        expect(escritasSemPosse(exp.corpo)).toHaveLength(0);
      });
    }
  }

  it("LETALIDADE: as formas hostis são reprovadas pelo MESMO analisador", () => {
    const semGate = `export async function x() {
      const { error } = await supabase.from("cardapio_produtos").upsert(linhas, { onConflict: "cardapio_id,produto_id", ignoreDuplicates: true });
    }`;
    const gateDepois = `export async function x() {
      await svc.from("cardapio_produtos").delete().eq("loja_id", id).eq("cardapio_id", c);
      if (!(await cardapioPertenceALoja(svc, id, c))) return;
    }`;
    const inserirVariosCru = `export async function x() {
      const { error } = await escopo.inserirVarios("cardapio_produtos", linhas, { onConflict: "a", ignoreDuplicates: true });
    }`;
    const correto = `export async function x() {
      if (!(await cardapioPertenceALoja(svc, id, c))) return;
      await svc.from("cardapio_produtos").delete().eq("loja_id", id).eq("cardapio_id", c);
    }`;
    expect(escritasSemPosse(semGate)).toHaveLength(1);
    expect(escritasSemPosse(gateDepois)).toHaveLength(1);
    expect(escritasSemPosse(inserirVariosCru)).toHaveLength(1);
    expect(escritasSemPosse(correto)).toHaveLength(0);
  });
});

// ═══════════ [274] o guard aprende o verbo `update` e a SEGUNDA prova ═══════
//
// Fase RED da issue 274 (D6). `definirDiasDoVinculo` NÃO chama
// `cardapioPertenceALoja`, e isso é correto: a 270 exigiu o gate porque
// `upsert … ignoreDuplicates` descarta a linha ANTES da FK e porque `delete` de
// zero linhas devolve sucesso mudo. Um UPDATE com `count: "exact"` TRANSFORMA
// "zero linhas" em recusa — exatamente o que o gate comprava, sem a segunda ida
// ao banco e sem a janela TOCTOU entre a leitura e a escrita.
//
// Só que "não precisa do gate" não pode virar "escreve como quiser": sem o
// `count: "exact"` o `count` volta `null` e a recusa nunca dispara; sem UMA das
// três colunas o UPDATE alcança linha que não é daquele vínculo. Então o
// analisador passa a aceitar DUAS provas para escrita em `cardapio_produtos`:
//   (1) `cardapioPertenceALoja(` ANTES, no mesmo corpo (a prova da 270); OU
//   (2) o escopo pela TRIPLA COMPLETA `loja_id` + `cardapio_id` + `produto_id`
//       com `count: "exact"` — ou `atualizarPorChave("cardapio_produtos",
//       { cardapio_id, produto_id }, …)`, que a produz por construção.
//
// Os fixtures abaixo rodam contra o MESMO `escritasSemPosse` que varre `src/**`:
// afrouxar o analisador para deixar a produção passar deixa estes vermelhos.

describe("[274] enforcement: `update` em cardapio_produtos prova posse pelo escopo + count", () => {
  const LETAIS: Array<[string, string]> = [
    [
      "update escopado SÓ por loja_id (alcança qualquer vínculo da loja)",
      `export async function x() {
        await supabase.from("cardapio_produtos").update({ dias_semana: d }, { count: "exact" }).eq("loja_id", l);
      }`,
    ],
    [
      "update sem `produto_id` (alcança o cardápio INTEIRO)",
      `export async function x() {
        await supabase.from("cardapio_produtos").update({ dias_semana: d }, { count: "exact" }).eq("loja_id", l).eq("cardapio_id", c);
      }`,
    ],
    [
      "update sem `cardapio_id` (alcança o produto em TODOS os cardápios)",
      `export async function x() {
        await supabase.from("cardapio_produtos").update({ dias_semana: d }, { count: "exact" }).eq("loja_id", l).eq("produto_id", p);
      }`,
    ],
    [
      "tripla completa mas SEM `count: \"exact\"` (o count volta null e a recusa nunca dispara)",
      `export async function x() {
        await supabase.from("cardapio_produtos").update({ dias_semana: d }).eq("loja_id", l).eq("cardapio_id", c).eq("produto_id", p);
      }`,
    ],
    [
      "atualizarPorChave com chave PARCIAL (só cardapio_id)",
      `export async function x() {
        await escopo.atualizarPorChave("cardapio_produtos", { cardapio_id }, { dias_semana: d });
      }`,
    ],
    [
      "atualizarPorChave com chave VAZIA (UPDATE da loja inteira sob service_role)",
      `export async function x() {
        await escopo.atualizarPorChave("cardapio_produtos", {}, { dias_semana: d });
      }`,
    ],
  ];

  for (const [rotulo, fixture] of LETAIS) {
    it(`LETALIDADE: ${rotulo} ⇒ REPROVADO`, () => {
      expect(escritasSemPosse(fixture), "o analisador não viu esta escrita").toHaveLength(1);
    });
  }

  const ACEITAS: Array<[string, string]> = [
    [
      "prova (2): tripla completa + count exact, sem gate — D6",
      `export async function x() {
        await supabase.from("cardapio_produtos").update({ dias_semana: d }, { count: "exact" }).eq("loja_id", l).eq("cardapio_id", c).eq("produto_id", p);
      }`,
    ],
    [
      "prova (2): atualizarPorChave com a chave natural completa",
      `export async function x() {
        await escopo.atualizarPorChave("cardapio_produtos", { cardapio_id, produto_id }, { dias_semana: d });
      }`,
    ],
    [
      "prova (1): o gate da 270 ANTES do update também serve",
      `export async function x() {
        if (!(await cardapioPertenceALoja(svc, id, c))) return;
        await svc.from("cardapio_produtos").update({ dias_semana: d }, { count: "exact" }).eq("loja_id", l);
      }`,
    ],
  ];

  for (const [rotulo, fixture] of ACEITAS) {
    it(`${rotulo} ⇒ aprovado`, () => {
      expect(escritasSemPosse(fixture)).toHaveLength(0);
    });
  }

  it("regressão: as formas da 270 (`upsert`/`delete`/`inserirVarios`) continuam exigindo o gate", () => {
    expect(
      escritasSemPosse(`export async function x() {
        await supabase.from("cardapio_produtos").upsert(linhas, { onConflict: "cardapio_id,produto_id", ignoreDuplicates: true });
      }`),
    ).toHaveLength(1);
    expect(
      escritasSemPosse(`export async function x() {
        await svc.from("cardapio_produtos").delete().eq("loja_id", l).eq("cardapio_id", c);
      }`),
    ).toHaveLength(1);
  });
});
