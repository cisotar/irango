import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import ts from "typescript";

/**
 * Teste-guarda TRANSVERSAL e AUTO-DESCOBERTO da INJEÇÃO DE ACTIONS nos wrappers
 * admin (issue 160). Irmão de `enforcement-escopo-admin.test.ts`: mesma família
 * (descoberta por filesystem + sanity anti-vacuidade + letalidade documentada),
 * outro eixo.
 *
 * ── O RISCO ─────────────────────────────────────────────────────────────────
 * Os componentes do painel (`PerfilClient`, `EntregasClient`, `ProdutosClient`,
 * …) são REUSADOS pelo hub admin. A parametrização foi feita com props de Server
 * Action OPCIONAIS, cujo default/fallback é a action do LOJISTA — que resolve a
 * loja por `auth.uid()`. Consequência: um wrapper admin que ESQUEÇA uma prop
 * COMPILA sem erro, roda sem erro, e grava na loja DO ADMIN LOGADO em vez da
 * loja-alvo da URL. Cross-tenant silencioso, sem exceção, sem log.
 *
 * `enforcement-escopo-admin.test.ts` não alcança isso: ele descobre módulos por
 * referência a `createServiceClient`, que wrapper `'use client'` nunca tem.
 * Os `page.test.tsx` provam page→wrapper, não wrapper→client. Este arquivo fecha
 * o gap wrapper→client para os 9 wrappers de uma vez.
 *
 * ── COMO FUNCIONA ───────────────────────────────────────────────────────────
 * Análise estática por AST (compilador TypeScript, não regex — ver "DUAS FORMAS"
 * abaixo), em três etapas:
 *
 *  1. DESCOBERTA — `readdirSync` recursivo sobre `src/app/admin/assinantes/**`
 *     coletando todo `*AdminClient.tsx`. Wrapper novo entra sozinho, sem editar
 *     lista aqui.
 *  2. ALVO — no AST do wrapper, todo elemento JSX cuja tag é importada e resolve
 *     para um arquivo FORA de `admin/assinantes` (= componente compartilhado do
 *     painel) e que declare ao menos uma prop de action.
 *  3. CONTRATO — no AST do componente do painel, o tipo do 1º parâmetro é
 *     resolvido (literal, alias local, alias IMPORTADO de outro arquivo,
 *     interseção) até a lista de props. Dela sai o conjunto EXIGIDO.
 *
 * ── DUAS FORMAS DE PROP (o defeito de maior probabilidade deste guard) ───────
 * A injeção existe em duas formas estruturalmente diferentes:
 *
 *   PLANA     `onSalvar={…}` `onDefinirPublicacao={…}` `onSalvarLogo={…}`
 *             → PerfilClient, HorariosClient, TemaClient
 *   ANINHADA  `acoes={{ criarZona: …, … }}`  ou  `acoes={objetoDeUseMemo}`
 *             → EntregasClient, PagamentosClient, CuponsClient, ProdutosClient,
 *               OpcionaisClient, GerenciarAssinaturaClient
 *
 * Um guard que só entendesse a forma plana passaria VACUAMENTE nos 6 aninhados —
 * 6 wrappers "verdes" sem uma única asserção real. Por isso as duas formas têm
 * blocos `describe` próprios, e a sanidade abaixo exige que AMBAS tenham
 * população mínima. Também por isso a leitura é por AST: a forma aninhada mora
 * num `ObjectLiteralExpression` que pode chegar por identificador
 * (`AssinaturaAdminClient` monta o objeto num `useMemo` e passa `acoes={acoes}`),
 * coisa que regex sobre o texto do JSX não segue.
 *
 * A cascata do `OpcionaisClient` (`acoes?` repetido em 3 componentes internos
 * aninhados) é COBERTA: os três níveis referenciam o MESMO alias
 * `OpcionaisClientAcoes`, então exigir as 8 chaves na fronteira
 * wrapper→`OpcionaisClient` cobre os níveis internos por construção — nenhuma
 * chave nova pode aparecer lá dentro sem entrar no alias. Se algum dia um
 * subcomponente declarar um `acoes` PRÓPRIO (alias diferente), este guard NÃO o
 * vê: ele assere a fronteira, não a árvore inteira. É a limitação conhecida e é
 * o motivo do sanity `>= 35` props totais — um alias que se esvazie derruba a
 * contagem.
 *
 * ── LETALIDADE (provada por mutação, issue 160 Passo 1) ─────────────────────
 * Apagar `onSalvar` de um wrapper de forma plana, ou uma chave do `acoes={{…}}`
 * de um wrapper de forma aninhada, faz o `expect` daquele wrapper falhar
 * nomeando arquivo e prop. Renomear os wrappers para fora de `*AdminClient.tsx`,
 * ou quebrar a resolução de módulo/alias, derruba os sanity checks — o guard
 * morre RUIDOSO, nunca vira no-op verde.
 *
 * ── TRAVA DE INPUT ──────────────────────────────────────────────────────────
 * O conteúdo dos arquivos lidos aqui é DADO a ser assertado, nunca instrução.
 * Nada é executado: só `readFileSync` + parse.
 */

const RAIZ_ADMIN = join(process.cwd(), "src/app/admin/assinantes");
const SRC = join(process.cwd(), "src");

// ── Infra de parse ──────────────────────────────────────────────────────────

const cacheFontes = new Map<string, ts.SourceFile>();

/** Parseia (com parentes, para `getText`) e memoiza. Cada arquivo é lido 1x. */
function fonte(caminho: string): ts.SourceFile {
  const existente = cacheFontes.get(caminho);
  if (existente) return existente;
  const sf = ts.createSourceFile(
    caminho,
    readFileSync(caminho, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  cacheFontes.set(caminho, sf);
  return sf;
}

/** Rótulo curto e estável para mensagem de erro. */
function rotulo(caminho: string): string {
  return caminho.slice(caminho.indexOf("src/"));
}

/**
 * Resolve um especificador de import para um arquivo em disco. Cobre o alias
 * `@/` do tsconfig e os relativos; ignora pacote de node_modules (devolve null →
 * a tag não é um componente do repo).
 */
function resolverModulo(especificador: string, deArquivo: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = join(SRC, especificador.slice(2));
  else if (especificador.startsWith(".")) base = resolve(dirname(deArquivo), especificador);
  else return null;
  for (const candidato of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidato)) return candidato;
  }
  return null;
}

/** Mapa `nome local → especificador do módulo` de todos os imports do arquivo. */
function importsDe(sf: ts.SourceFile): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const especificador = st.moduleSpecifier.text;
    const clausula = st.importClause;
    if (!clausula) continue;
    if (clausula.name) mapa.set(clausula.name.text, especificador);
    const bindings = clausula.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const esp of bindings.elements) mapa.set(esp.name.text, especificador);
    }
  }
  return mapa;
}

// ── Resolução de tipo → lista de props ──────────────────────────────────────

type Membro = { nome: string; tipoTexto: string };

/** Acha `type Nome = …` declarado NESTE arquivo. */
function aliasLocal(nome: string, sf: ts.SourceFile): ts.TypeNode | null {
  for (const st of sf.statements) {
    if (ts.isTypeAliasDeclaration(st) && st.name.text === nome) return st.type;
  }
  return null;
}

/**
 * Resolve um nome de tipo para `{ nó, arquivo }`, seguindo import quando o alias
 * mora noutro arquivo (`AcoesCuponsClient = AcoesFormCupom & {…}`, com
 * `AcoesFormCupom` vindo de `components/painel/FormCupom.tsx`). Sem isso, o
 * contrato do CuponsClient seria lido como 1 prop em vez de 3.
 */
function resolverNomeDeTipo(
  nome: string,
  sf: ts.SourceFile,
): { no: ts.TypeNode; sf: ts.SourceFile } | null {
  const local = aliasLocal(nome, sf);
  if (local) return { no: local, sf };
  const especificador = importsDe(sf).get(nome);
  if (!especificador) return null;
  const caminho = resolverModulo(especificador, sf.fileName);
  if (!caminho) return null;
  const outro = fonte(caminho);
  const remoto = aliasLocal(nome, outro);
  return remoto ? { no: remoto, sf: outro } : null;
}

/** Achata um nó de tipo até a lista de `PropertySignature`. */
function membrosDoTipo(
  no: ts.TypeNode | undefined,
  sf: ts.SourceFile,
  profundidade = 0,
): Membro[] {
  if (!no || profundidade > 6) return [];
  if (ts.isTypeLiteralNode(no)) {
    return no.members.filter(ts.isPropertySignature).map((m) => ({
      nome: m.name.getText(sf),
      tipoTexto: m.type ? m.type.getText(sf).replace(/\s+/g, " ").trim() : "",
    }));
  }
  if (ts.isIntersectionTypeNode(no)) {
    return no.types.flatMap((t) => membrosDoTipo(t, sf, profundidade + 1));
  }
  if (ts.isTypeReferenceNode(no) && ts.isIdentifier(no.typeName)) {
    const alvo = resolverNomeDeTipo(no.typeName.text, sf);
    if (alvo) return membrosDoTipo(alvo.no, alvo.sf, profundidade + 1);
  }
  return [];
}

/** Tipo do 1º parâmetro do componente exportado com este nome. */
function tipoDePropsDoComponente(sf: ts.SourceFile, nome: string): ts.TypeNode | undefined {
  let achado: ts.TypeNode | undefined;
  const visita = (n: ts.Node): void => {
    if (!achado) {
      if (ts.isFunctionDeclaration(n) && n.name?.text === nome) {
        achado = n.parameters[0]?.type;
      } else if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === nome &&
        n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
      ) {
        achado = n.initializer.parameters[0]?.type;
      }
      ts.forEachChild(n, visita);
    }
  };
  visita(sf);
  return achado;
}

/**
 * Prop de action na forma PLANA: convenção React `on<Verbo>` cujo tipo NÃO é um
 * callback de UI puro (`() => void`). Todas as props de action plana do projeto
 * têm tipo `typeof <action>Lojista` ou `UploadLogoLojaProps["on…"]`; um
 * `onSucesso?: () => void` (FormCupom) é UX e fica de fora.
 */
function eAcaoPlana(m: Membro): boolean {
  return /^on[A-Z]/.test(m.nome) && !/^\(\s*\)\s*=>\s*void$/.test(m.tipoTexto);
}

// ── Leitura do wrapper admin ────────────────────────────────────────────────

/** Todo `*AdminClient.tsx` sob `admin/assinantes/**`, por filesystem. */
function wrappersAdmin(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) out.push(...wrappersAdmin(caminho));
    else if (entrada.name.endsWith("AdminClient.tsx")) out.push(caminho);
  }
  return out.sort();
}

/** 1º `ObjectLiteralExpression` dentro de um nó (atravessa `useMemo(() => ({…}))`). */
function primeiroObjeto(n: ts.Node): ts.ObjectLiteralExpression | null {
  if (ts.isObjectLiteralExpression(n)) return n;
  let achado: ts.ObjectLiteralExpression | null = null;
  ts.forEachChild(n, (filho) => {
    if (!achado) achado = primeiroObjeto(filho);
  });
  return achado;
}

/** `const <nome> = …` neste arquivo → o objeto literal que ele constrói. */
function objetoDaVariavel(nome: string, sf: ts.SourceFile): ts.ObjectLiteralExpression | null {
  let achado: ts.ObjectLiteralExpression | null = null;
  const visita = (n: ts.Node): void => {
    if (
      !achado &&
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === nome &&
      n.initializer
    ) {
      achado = primeiroObjeto(n.initializer);
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return achado;
}

/** Chaves de um objeto literal; `null` se houver spread (não provável estaticamente). */
function chavesDoObjeto(obj: ts.ObjectLiteralExpression, sf: ts.SourceFile): string[] | null {
  const chaves: string[] = [];
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
      chaves.push(p.name.getText(sf));
    } else {
      return null;
    }
  }
  return chaves;
}

type Alvo = {
  wrapper: string;
  cliente: string;
  componente: string;
  /** Props de action planas exigidas pelo contrato do componente do painel. */
  exigidasPlanas: string[];
  /** Chaves de `acoes` exigidas pelo contrato (vazio se o componente não tem `acoes`). */
  exigidasAcoes: string[];
  passadasPlanas: string[];
  /** `null` = `acoes` não passado, ou passado de forma que não dá para provar. */
  passadasAcoes: string[] | null;
  /** Motivo de `passadasAcoes === null`, para a mensagem de erro. */
  diagnosticoAcoes: string;
  /** `true` se o JSX usa `{...spread}` — prop checking deixa de ser provável. */
  temSpread: boolean;
};

function analisarWrapper(caminhoWrapper: string): Alvo[] {
  const sf = fonte(caminhoWrapper);
  const imports = importsDe(sf);
  const alvos: Alvo[] = [];

  const visita = (n: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const tag = n.tagName.getText(sf);
      const especificador = imports.get(tag);
      const caminhoCliente = especificador
        ? resolverModulo(especificador, caminhoWrapper)
        : null;

      // Só interessa componente COMPARTILHADO: resolvido no repo e fora de
      // `admin/assinantes` (um componente só-admin não tem default de lojista).
      if (caminhoCliente && !caminhoCliente.startsWith(RAIZ_ADMIN)) {
        const sfCliente = fonte(caminhoCliente);
        const membros = membrosDoTipo(
          tipoDePropsDoComponente(sfCliente, tag),
          sfCliente,
        );
        const exigidasPlanas = membros.filter(eAcaoPlana).map((m) => m.nome);
        // Reencontra o NÓ de tipo do membro `acoes` (a lista `membros` só tem
        // texto) para poder resolvê-lo até as chaves. `tipoDoMembro` devolve o
        // arquivo dono do nó junto: o alias pode morar noutro arquivo, e resolver
        // o nó com o `SourceFile` errado leria zero chaves (guard vácuo).
        const acoes = tipoDoMembro(sfCliente, tipoDePropsDoComponente(sfCliente, tag), "acoes");
        const exigidasAcoes = acoes ? membrosDoTipo(acoes.no, acoes.sf).map((m) => m.nome) : [];

        if (exigidasPlanas.length > 0 || exigidasAcoes.length > 0) {
          const passadasPlanas: string[] = [];
          let passadasAcoes: string[] | null = null;
          let diagnosticoAcoes = "prop `acoes` não foi passada ao componente";
          let temSpread = false;

          for (const attr of n.attributes.properties) {
            if (ts.isJsxSpreadAttribute(attr)) {
              temSpread = true;
              continue;
            }
            if (!ts.isJsxAttribute(attr)) continue;
            const nomeAttr = attr.name.getText(sf);
            if (nomeAttr === "acoes") {
              const init = attr.initializer;
              const expr =
                init && ts.isJsxExpression(init) ? init.expression : undefined;
              let obj: ts.ObjectLiteralExpression | null = null;
              if (expr && ts.isObjectLiteralExpression(expr)) obj = expr;
              else if (expr && ts.isIdentifier(expr)) obj = objetoDaVariavel(expr.text, sf);
              if (!obj) {
                diagnosticoAcoes =
                  "`acoes` passado por expressão opaca (não é objeto literal " +
                  "nem identificador resolvível) — a injeção deixa de ser provável estaticamente";
              } else {
                passadasAcoes = chavesDoObjeto(obj, sf);
                if (passadasAcoes === null) {
                  diagnosticoAcoes =
                    "`acoes` contém spread (`...`) — a injeção deixa de ser provável estaticamente";
                }
              }
            } else {
              passadasPlanas.push(nomeAttr);
            }
          }

          alvos.push({
            wrapper: rotulo(caminhoWrapper),
            cliente: rotulo(caminhoCliente),
            componente: tag,
            exigidasPlanas,
            exigidasAcoes,
            passadasPlanas,
            passadasAcoes,
            diagnosticoAcoes,
            temSpread,
          });
        }
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return alvos;
}

/**
 * Nó de tipo do membro `nome` dentro de um tipo de props, JUNTO do arquivo dono
 * do nó. Devolver o `SourceFile` importa: se o tipo de props for um alias
 * importado, o nó de `acoes` pertence ao OUTRO arquivo, e resolvê-lo depois com
 * o `SourceFile` do primeiro leria zero chaves — guard vácuo por dessincronia.
 */
function tipoDoMembro(
  sf: ts.SourceFile,
  no: ts.TypeNode | undefined,
  nome: string,
  profundidade = 0,
): { no: ts.TypeNode; sf: ts.SourceFile } | undefined {
  if (!no || profundidade > 6) return undefined;
  if (ts.isTypeLiteralNode(no)) {
    for (const m of no.members) {
      if (ts.isPropertySignature(m) && m.name.getText(sf) === nome && m.type) {
        return { no: m.type, sf };
      }
    }
    return undefined;
  }
  if (ts.isIntersectionTypeNode(no)) {
    for (const t of no.types) {
      const achado = tipoDoMembro(sf, t, nome, profundidade + 1);
      if (achado) return achado;
    }
    return undefined;
  }
  if (ts.isTypeReferenceNode(no) && ts.isIdentifier(no.typeName)) {
    const alvo = resolverNomeDeTipo(no.typeName.text, sf);
    if (alvo) return tipoDoMembro(alvo.sf, alvo.no, nome, profundidade + 1);
  }
  return undefined;
}

const WRAPPERS = wrappersAdmin(RAIZ_ADMIN);
const ALVOS = WRAPPERS.flatMap(analisarWrapper);

// ═══════════════════════════════════════════════════════════════════════════════
// Sanidade da descoberta — sem isto, um rename de `*AdminClient.tsx`, uma quebra
// no alias `@/` ou um alias de `acoes` que se esvazie transformariam TODOS os
// blocos abaixo em no-op verde (zero `it()` gerado = suíte "passa" por ausência
// de asserção, não por o contrato estar cumprido).
// ═══════════════════════════════════════════════════════════════════════════════

describe("enforcement: descoberta dos wrappers admin", () => {
  it("encontra >= 9 wrappers `*AdminClient.tsx` sob admin/assinantes", () => {
    expect(
      WRAPPERS.map(rotulo),
      "a descoberta por filesystem não achou os wrappers admin — " +
        "rename de arquivo ou mudança de pasta tornaria este guard um no-op verde",
    ).toHaveLength(WRAPPERS.length);
    expect(WRAPPERS.length).toBeGreaterThanOrEqual(9);
  });

  it("todo wrapper renderiza ao menos 1 componente do painel com prop de action", () => {
    const semAlvo = WRAPPERS.map(rotulo).filter(
      (w) => !ALVOS.some((a) => a.wrapper === w),
    );
    expect(
      semAlvo,
      "wrapper admin sem alvo detectado: ou ele deixou de reusar componente do " +
        "painel, ou a resolução de módulo/tipo quebrou e o guard parou de olhar para ele",
    ).toHaveLength(0);
  });

  it("todo alvo exige >= 1 prop de action e o total é >= 35", () => {
    const vazios = ALVOS.filter(
      (a) => a.exigidasPlanas.length + a.exigidasAcoes.length === 0,
    ).map((a) => `${a.wrapper} → ${a.componente}`);
    expect(vazios, "alvo sem nenhuma prop de action exigida (contrato lido como vazio)").toHaveLength(0);
    const total = ALVOS.reduce(
      (n, a) => n + a.exigidasPlanas.length + a.exigidasAcoes.length,
      0,
    );
    expect(total, "esperava >= 35 props de action exigidas no total").toBeGreaterThanOrEqual(35);
  });

  it("as DUAS formas de prop estão populadas (guard não é vácuo numa delas)", () => {
    const comPlanas = ALVOS.filter((a) => a.exigidasPlanas.length > 0);
    const comAcoes = ALVOS.filter((a) => a.exigidasAcoes.length > 0);
    expect(
      comPlanas.map((a) => a.wrapper),
      "nenhum alvo de forma PLANA (`onSalvar=`) — o parser de prop plana quebrou",
    ).not.toHaveLength(0);
    expect(comAcoes.length, "esperava >= 6 alvos de forma ANINHADA (`acoes={{…}}`)").toBeGreaterThanOrEqual(6);
  });

  it("nenhum componente do painel recebe `{...spread}` do wrapper admin", () => {
    const comSpread = ALVOS.filter((a) => a.temSpread).map(
      (a) => `${a.wrapper} → <${a.componente} {...} />`,
    );
    expect(
      comSpread,
      "spread de props num componente compartilhado torna a injeção não-provável " +
        "estaticamente e cega este guard — passe as actions nominalmente",
    ).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FORMA PLANA — `onSalvar={…}`, `onDefinirPublicacao={…}`, `onSalvarLogo={…}`
// ═══════════════════════════════════════════════════════════════════════════════
//
// LETALIDADE: apagar um `onX={…}` do JSX do wrapper faz o `expect` daquele
// wrapper falhar nomeando arquivo e prop.

describe("enforcement — wrapper admin injeta TODA prop de action PLANA", () => {
  for (const alvo of ALVOS.filter((a) => a.exigidasPlanas.length > 0)) {
    it(`${alvo.wrapper} → <${alvo.componente}> passa ${alvo.exigidasPlanas.join(", ")}`, () => {
      const faltando = alvo.exigidasPlanas.filter(
        (p) => !alvo.passadasPlanas.includes(p),
      );
      expect(
        faltando,
        `${alvo.wrapper} não injeta ${faltando.join(", ")} em <${alvo.componente}>. ` +
          `O contrato de ${alvo.cliente} declara essa prop OPCIONAL com default na ` +
          `action do LOJISTA — omitida na via admin, a gravação vai para a loja do ` +
          `admin logado (auth.uid()) em vez da loja-alvo da URL. Cross-tenant silencioso.`,
      ).toHaveLength(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FORMA ANINHADA — `acoes={{ … }}` (inline) ou `acoes={objeto}` (via useMemo)
// ═══════════════════════════════════════════════════════════════════════════════
//
// É AQUI que um guard ingênuo passa vacuamente: 6 dos 9 wrappers usam esta forma.
//
// LETALIDADE: apagar uma chave do `acoes={{…}}` faz o `expect` daquele wrapper
// falhar nomeando arquivo e chave. Trocar o objeto por uma expressão opaca ou por
// um spread também falha (diagnóstico explícito), em vez de passar por omissão.

describe("enforcement — wrapper admin injeta TODA chave de `acoes` ANINHADA", () => {
  for (const alvo of ALVOS.filter((a) => a.exigidasAcoes.length > 0)) {
    it(`${alvo.wrapper} → <${alvo.componente}> passa as ${alvo.exigidasAcoes.length} chaves de acoes`, () => {
      expect(
        alvo.passadasAcoes,
        `${alvo.wrapper}: ${alvo.diagnosticoAcoes}. ${alvo.cliente} declara ` +
          `${alvo.exigidasAcoes.length} actions em \`acoes\`, todas com fallback ` +
          `\`?? …Lojista\` — sem injeção provável, a via admin grava na loja do admin logado.`,
      ).not.toBeNull();

      const faltando = alvo.exigidasAcoes.filter(
        (chave) => !(alvo.passadasAcoes ?? []).includes(chave),
      );
      expect(
        faltando,
        `${alvo.wrapper} não injeta acoes.{${faltando.join(", ")}} em ` +
          `<${alvo.componente}>. ${alvo.cliente} faz \`acoes?.<chave> ?? <chave>Lojista\`: ` +
          `chave ausente cai na action do LOJISTA, que resolve a loja por auth.uid() — ` +
          `o admin grava na PRÓPRIA loja em vez da loja-alvo da URL (cross-tenant).`,
      ).toHaveLength(0);
    });
  }
});
