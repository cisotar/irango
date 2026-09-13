import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * [156] Teste-guarda TRANSVERSAL e AUTO-DESCOBERTO do enforcement de tenant nas
 * queries que rodam sob `service_role`.
 *
 * Suíte IRMÃ de `src/app/admin/assinantes/enforcement-escopo-admin.test.ts`:
 * mesma técnica (análise estática da fonte, descoberta por filesystem), outro
 * alvo. O guard admin só varre `admin/assinantes/**`, então uma query admin que
 * viva em `lib/supabase/queries/*` ficava FORA de qualquer rede do CI — a
 * "lacuna conhecida" registrada em `seguranca.md` §506.
 *
 * O alvo é a assinatura `(svc, lojaId)`: o `svc` é o client de service_role
 * (BYPASSA RLS) e o `lojaId` é a loja-alvo. Nessas funções o `.eq("loja_id",
 * lojaId)` é a ÚNICA barreira cross-tenant que resta — sem ele a query devolve
 * linhas de todas as lojas. As irmãs `(client, ...)` do lojista NÃO entram aqui:
 * elas rodam sob RLS, que já filtra por tenant no banco.
 *
 * Hoje as quatro funções descobertas estão corretas e cada uma tem teste
 * unitário próprio. Este arquivo existe contra a regressão FUTURA: uma query
 * admin nova que esqueça o `.eq` entra na descoberta sozinha e falha aqui, sem
 * ninguém precisar lembrar de editar uma lista.
 *
 * LETALIDADE (verificada por mutação ao escrever): remover o `.eq("loja_id",
 * lojaId)` de qualquer uma das funções descobertas faz o `it()` daquela função
 * falhar nomeando arquivo e função.
 */

const QUERIES_DIR = join(process.cwd(), "src/lib/supabase/queries");

type FuncaoSvc = { rotulo: string; nome: string; corpo: string };

/**
 * Descobre, por ASSINATURA, toda função exportada que recebe o client de
 * service_role e um `lojaId`: `export async function <nome>(svc: <T>, lojaId:
 * string`. Casa o parâmetro pelo NOME (`svc`), que é a convenção do projeto em
 * todas as queries admin, e exige `lojaId: string` logo em seguida — é a
 * assinatura que marca "escopo de tenant é responsabilidade do código, não da
 * RLS". Quebra de espaços/quebras de linha é tolerada pelo `\s*`.
 */
const ASSINATURA_SVC =
  /export\s+async\s+function\s+([a-zA-Z0-9_]+)\s*\(\s*svc\s*:\s*[^,)]+,\s*lojaId\s*:\s*string/g;

function funcoesSvc(): FuncaoSvc[] {
  const out: FuncaoSvc[] = [];
  for (const arquivo of readdirSync(QUERIES_DIR)) {
    if (!arquivo.endsWith(".ts") || arquivo.endsWith(".test.ts")) continue;
    const caminho = join(QUERIES_DIR, arquivo);
    const fonte = readFileSync(caminho, "utf8");
    const rotulo = `src/lib/supabase/queries/${arquivo}`;

    // Marca o início de cada função descoberta e fatia até o próximo `export`
    // (ou EOF) — mesma estratégia de `exportsAsync` no guard admin.
    const marcas: { nome: string; inicio: number }[] = [];
    const re = new RegExp(ASSINATURA_SVC.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte)) !== null) {
      marcas.push({ nome: m[1], inicio: m.index });
    }
    const proximoExport = (a: number): number => {
      const i = fonte.indexOf("\nexport ", a + 1);
      return i === -1 ? fonte.length : i;
    };
    for (const marca of marcas) {
      out.push({
        rotulo,
        nome: marca.nome,
        corpo: fonte.slice(marca.inicio, proximoExport(marca.inicio)),
      });
    }
  }
  return out;
}

const funcoes = funcoesSvc();

// ═══════════════════════════════════════════════════════════════════════════════
// Sanidade da descoberta — sem isto a suíte passaria por lista VAZIA, verde por
// ausência de asserção em vez de por o escopo existir.
// ═══════════════════════════════════════════════════════════════════════════════

describe("enforcement: descoberta de queries (svc, lojaId)", () => {
  it("encontra as funções service_role escopadas por loja", () => {
    expect(
      funcoes.length,
      "nenhuma função (svc, lojaId) descoberta em lib/supabase/queries — " +
        "a assinatura mudou e este guard virou no-op silencioso",
    ).toBeGreaterThanOrEqual(4);

    // Âncoras nominais: as quatro que motivaram a issue. Se uma sumir ou for
    // renomeada, isto falha e obriga a revisar a descoberta em vez de perder
    // cobertura sem ninguém notar.
    const nomes = funcoes.map((f) => f.nome);
    for (const esperada of [
      "listarFaturasDaLojaAdmin",
      "listarCuponsDaLoja",
      "listarPedidosDaLoja",
      "buscarPedidoDaLoja",
    ]) {
      expect(nomes, `${esperada} saiu da descoberta`).toContain(esperada);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ESCOPO: toda query (svc, lojaId) filtra por .eq("loja_id", lojaId)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Exige o par COMPLETO — coluna E variável. `.eq("loja_id", outraCoisa)` não
// satisfaz: filtrar por uma loja que não é a loja-alvo do parâmetro é o mesmo
// bug cross-tenant com outra roupa.

const EQ_LOJA_ID = /\.eq\s*\(\s*["'`]loja_id["'`]\s*,\s*lojaId\s*\)/;

describe("enforcement ESCOPO — .eq(\"loja_id\", lojaId) em toda query service_role", () => {
  for (const fn of funcoes) {
    it(`${fn.rotulo} → ${fn.nome}() escopa por .eq("loja_id", lojaId)`, () => {
      expect(
        EQ_LOJA_ID.test(fn.corpo),
        `${fn.nome} recebe o client de service_role (BYPASSA RLS) e um lojaId, ` +
          `mas não filtra por .eq("loja_id", lojaId) — a query devolve linhas de ` +
          `TODAS as lojas. Sob service_role o .eq é a única barreira cross-tenant.`,
      ).toBe(true);
    });
  }
});
