/**
 * Fase RED (TDD) da issue 331 — fatia F5: travas de FONTE para "uma única
 * fonte de verdade" (plan/loop-ocultar-opcionais-por-produto.md, "Risco por
 * fatia" F5 e "Travas" de P3).
 *
 * Lidas do código-fonte, no mesmo espírito de `rotaCardapiosInjetada.test.tsx`
 * e da trava de `PilulasDeDias.test.tsx`: o que um revisor conferiria por grep
 * vira teste, para que a próxima tela não abra uma segunda porta para a tabela
 * nem um segundo estado de ocultação.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = process.cwd();

function fontes(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...fontes(p));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.(ts|tsx)$/.test(nome)) out.push(p);
  }
  return out;
}

function quemContem(dirs: string[], padrao: RegExp): string[] {
  const achados = new Set<string>();
  for (const d of dirs) {
    for (const arq of fontes(join(RAIZ, d))) {
      if (padrao.test(readFileSync(arq, "utf8"))) achados.add(relative(RAIZ, arq));
    }
  }
  return [...achados].sort();
}

const ACTION_LOJISTA = "src/lib/actions/opcional.ts";
const ACTION_ADMIN = "src/app/admin/assinantes/actions/admin-opcionais.ts";
const QUERIES = "src/lib/supabase/queries/opcionais.ts";

describe("331 F5 · a tabela produto_opcionais_ocultos tem 3 portas, e só 3", () => {
  it("o nome da tabela só aparece nas 2 actions (escrita) e em queries/opcionais.ts (leitura)", () => {
    const achados = quemContem(["src"], /["']produto_opcionais_ocultos["']/).filter(
      (f) => f !== "src/lib/database.types.ts",
    );
    expect(achados).toEqual([ACTION_ADMIN, ACTION_LOJISTA, QUERIES].sort());
  });

  it('`.from("produto_opcionais_ocultos")` em src/lib/actions e src/app/admin: só nas actions de ocultação', () => {
    const achados = quemContem(
      ["src/lib/actions", "src/app/admin"],
      /\.from\(\s*["'`]produto_opcionais_ocultos["'`]\s*\)/,
    );
    expect(achados).toContain(ACTION_LOJISTA);
    for (const f of achados) expect([ACTION_LOJISTA, ACTION_ADMIN]).toContain(f);
  });
});

describe("331 F5 · um estado de ocultação por tela, e uma regra", () => {
  it("useOcultacoesOpcionais( é chamado só no ProdutosClient e no OpcionaisClient (o admin reusa os dois)", () => {
    const achados = quemContem(["src/app", "src/components"], /\buseOcultacoesOpcionais\(/).filter(
      (f) => f !== "src/components/painel/useOcultacoesOpcionais.ts",
    );
    expect(achados).toEqual(
      [
        "src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx",
        "src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.tsx",
      ].sort(),
    );
  });

  it("criarPedido e revisarCarrinho aplicam a MESMA regra pura (idsPermitidosDoProduto)", () => {
    for (const arq of ["src/lib/actions/pedido.ts", "src/lib/actions/revisarCarrinho.ts"]) {
      const fonte = readFileSync(join(RAIZ, arq), "utf8");
      expect(fonte, arq).toContain("idsPermitidosDoProduto");
      expect(fonte, arq).toContain("buscarOcultosPorProdutos");
    }
  });
});
