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

/**
 * Escrita em `cardapio_produtos` sem posse: `.from("cardapio_produtos")…
 * .upsert(|.delete(` ou `inserirVarios("cardapio_produtos"` sem
 * `cardapioPertenceALoja(` ANTES no mesmo corpo. Devolve a lista de violações.
 */
export function escritasSemPosse(corpo: string): string[] {
  const escritas = [
    /\.from\s*\(\s*["'`]cardapio_produtos["'`]\s*\)[\s\S]*?\.(upsert|delete)\s*\(/g,
    /inserirVarios\s*\(\s*["'`]cardapio_produtos["'`]/g,
  ];
  const gate = corpo.indexOf("cardapioPertenceALoja(");
  const violacoes: string[] = [];
  for (const re of escritas) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(corpo)) !== null) {
      if (gate === -1 || gate > m.index) violacoes.push(m[0].slice(0, 80));
    }
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
        /cardapio_produtos["'`]\s*\)[\s\S]*?\.(upsert|delete)\s*\(|inserirVarios\s*\(\s*["'`]cardapio_produtos/.test(e.corpo),
      ),
    );
    // aplicarCardapioEmProdutos, tirarDeCardapio e as duas gêmeas admin.
    expect(escritas.length).toBeGreaterThanOrEqual(4);
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
