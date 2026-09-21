import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 265 — `public.vitrine_produtos` (projeção pública do
 * catálogo, mascarada por vigência) + `drop policy produtos_leitura_publica`.
 *
 * Escrito a partir da ISSUE e do SPEC (`desconto-por-produto-e-pratos-promocionais.md`,
 * RN-03/RN-07; `seguranca.md` §19), NUNCA do SQL — as duas migrations
 * (`20260920124000_vitrine_produtos_view.sql` e
 * `20260920125000_produtos_drop_leitura_publica.sql`) ainda não existem.
 *
 * O buraco que esta issue fecha: `produtos_leitura_publica` não tem cláusula
 * `TO`, então libera a LINHA INTEIRA de todo produto `oculto = false` de loja
 * ativa para `anon` E `authenticated`. Desde a 219 essa linha carrega
 * `desconto_ativo/tipo/valor/inicio/fim` — o calendário promocional da
 * plataforma inteira, legível com a anon key do bundle ou por um lojista
 * concorrente logado. RLS filtra LINHA, não COLUNA.
 *
 * O que precisa ficar provado (§Ordem de Implementação da 265):
 *
 *  [1] `anon` e `asUser(DONO_A)` lendo `public.produtos` da loja B ⇒ 0 linhas;
 *      `asService` confirma que a linha EXISTE (negada por policy, não por dado
 *      ausente). Consulta SEM cláusula de escopo: quem nega é a RLS, não o
 *      WHERE do teste.
 *  [2] não-regressão por CONJUNTO DE IDS: o que `anon` via em `public.produtos`
 *      sob a policy antiga é EXATAMENTE o que passa a ver em
 *      `public.vitrine_produtos` (ativa/inativa/oculto/esgotado).
 *  [3] máscara por vigência nos quatro estados de RN-03/RN-07, com
 *      reconferência via `asService` de que a BASE preservou a configuração.
 *  [4] bordas de `public.desconto_vigente(ativo, inicio, fim, agora)` com
 *      instantes LITERAIS — início inclusivo, fim exclusivo. É o contrato de
 *      igualdade SQL ↔ `precoEfetivo` (223): divergência vira teste vermelho.
 *  [5] lista EXATA das 14 colunas da projeção; `oculto`, `criado_em` e
 *      `atualizado_em` AUSENTES (42703 ao nomeá-las).
 *  [6] `anon` recusado em insert/update/delete na view (42501) e
 *      `has_table_privilege` mostrando SÓ SELECT (`seguranca.md` §19).
 *
 * ([7], o scanner estático de revoke, vive em `vitrine_lojas_select_only.test.ts`,
 * parametrizado pelo nome da view — não se duplica o scanner.)
 *
 * Anti-falso-verde (padrão de `rls_lojas.test.ts` / `lojas_modal_promocoes_vitrine.test.ts`):
 *  - toda negação é 0 linhas via role restrita + `asService` provando que a
 *    linha existe;
 *  - toda máscara é reconferida na tabela base (a config NÃO pode ter sido
 *    apagada — RN-07);
 *  - coluna ausente é provada por 42703 nomeando a coluna, não por silêncio.
 *
 * Nenhum código de produção e nenhuma migration são escritos aqui. Quem deixa
 * verde é `migrar` (A e B) + `executar`.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aa0000000265";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bb0000000265";
// `lojas_dono_unico` (20260614003500): UMA loja por dono — daí três donos.
const DONO_INATIVA = "cccccccc-cccc-cccc-cccc-cc0000000265";
const DONO_MASCARA = "dddddddd-dddd-dddd-dddd-dd0000000265";

/**
 * Instantes de referência das bordas de vigência, RELATIVOS ao relógio do
 * request.
 *
 * Eram três literais de setembro de 2026 e apodreceram no dia em que o
 * calendário passou por cima deles: `vitrine_produtos` compara com `now()` do
 * Postgres, então o produto "Agendado" (início no `DEPOIS`) virou vigente e o
 * "Vigente" virou terminado — três casos vermelhos sem nenhuma mudança de
 * código. Data fixa num teste que fala com `now()` é uma bomba-relógio; a
 * ordem ANTES < AGORA < DEPOIS é o que os casos afirmam, e ela agora é
 * verdadeira em qualquer dia.
 */
const DIA = 24 * 60 * 60 * 1000;
const emRelacaoAAgora = (dias: number): string =>
  new Date(Date.now() + dias * DIA).toISOString();

const AGORA = emRelacaoAAgora(0);
const ANTES = emRelacaoAAgora(-1);
const DEPOIS = emRelacaoAAgora(1);
/** Antes do `ANTES`: é o INÍCIO da promoção já terminada. */
const MUITO_ANTES = emRelacaoAAgora(-3);

/**
 * Contrato de colunas de `public.vitrine_produtos` — §Contratos de Dados da
 * 265, na ordem fixa que vira `COLUNAS_PRODUTO_PUBLICO` no TS.
 *
 * 245: passa de 14 para 15. `visibilidade` entra NO FIM e as 14 anteriores
 * ficam na MESMA ordem — o `create or replace view` da 132000 só aceita coluna
 * nova no fim e recusa (42P16) qualquer mudança de nome/tipo nas existentes, o
 * que faz desta lista um gate mecânico de não-regressão do contrato.
 */
const COLUNAS_VITRINE_PRODUTOS = [
  "id",
  "loja_id",
  "categoria_id",
  "nome",
  "descricao",
  "preco",
  "disponivel",
  "ordem",
  "foto_url",
  "desconto_ativo",
  "desconto_tipo",
  "desconto_valor",
  "desconto_inicio",
  "desconto_fim",
  "visibilidade",
] as const;

/** Ausentes por decisão (D6 + projeção mínima): nomeá-las tem de dar 42703. */
const COLUNAS_AUSENTES = ["oculto", "criado_em", "atualizado_em"] as const;

type Cenario = {
  lojaA: string;
  lojaB: string;
  lojaInativa: string;
  lojaMascara: string;
  catA: string;
  /** loja A ativa, oculto=false, disponivel=true → público */
  prodADisp: string;
  /** loja A ativa, oculto=false, disponivel=false (esgotado) → público */
  prodAIndisp: string;
  /** loja A ativa, oculto=true → NUNCA público */
  prodAOculto: string;
  /** loja B ativa, oculto=false → público (catálogo de outro tenant é público) */
  prodBDisp: string;
  /** loja INATIVA, oculto=false → NUNCA público */
  prodInativaDisp: string;
  /** loja de máscara: os quatro estados de desconto (RN-03/RN-07) */
  prodVigente: string;
  prodDesligadoComConfig: string;
  prodAgendado: string;
  prodTerminado: string;
};

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a-265@teste.local'),
       ($2, 'dono-b-265@teste.local'),
       ($3, 'dono-inativa-265@teste.local'),
       ($4, 'dono-mascara-265@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_INATIVA, DONO_MASCARA],
  );
}

async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const lojas = await db.query<{ id: string; slug: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values
         ($1, 'loja-a-265',       'Loja A 265',       true),
         ($2, 'loja-b-265',       'Loja B 265',       true),
         ($3, 'loja-inativa-265', 'Loja Inativa 265', false),
         ($4, 'loja-mascara-265', 'Loja Mascara 265', true)
       returning id, slug`,
      [DONO_A, DONO_B, DONO_INATIVA, DONO_MASCARA],
    );
    const porSlug = (s: string) => lojas.rows.find((l) => l.slug === s)!.id;
    const lojaA = porSlug("loja-a-265");
    const lojaB = porSlug("loja-b-265");
    const lojaInativa = porSlug("loja-inativa-265");
    const lojaMascara = porSlug("loja-mascara-265");

    const cat = await db.query<{ id: string }>(
      `insert into public.categorias (loja_id, nome, ordem) values ($1, 'Pratos', 0) returning id`,
      [lojaA],
    );

    const prods = await db.query<{ id: string; nome: string }>(
      `insert into public.produtos
         (loja_id, categoria_id, nome, descricao, preco, disponivel, oculto, ordem)
       values
         ($1, $4, 'A disponivel', 'desc A1', 100.00, true,  false, 0),
         ($1, $4, 'A esgotado',   'desc A2',  50.00, false, false, 1),
         ($1, $4, 'A oculto',     'desc A3',  30.00, true,  true,  2),
         ($2, null, 'B disponivel','desc B1',  20.00, true,  false, 0),
         ($3, null, 'Inativa disponivel', 'desc I1', 10.00, true, false, 0)
       returning id, nome`,
      [lojaA, lojaB, lojaInativa, cat.rows[0].id],
    );
    const prod = (nome: string) => prods.rows.find((p) => p.nome === nome)!.id;

    // Os quatro estados de RN-03/RN-07, numa loja separada para não poluir o
    // conjunto de ids de [2]. Todos oculto=false em loja ATIVA: o que muda entre
    // eles é SÓ a vigência.
    const mascara = await db.query<{ id: string; nome: string }>(
      `insert into public.produtos
         (loja_id, nome, preco, disponivel, oculto, ordem,
          desconto_ativo, desconto_tipo, desconto_valor, desconto_inicio, desconto_fim)
       values
         ($1, 'Vigente',            200.00, true, false, 0, true,  'percentual', 10.00, $2, $3),
         ($1, 'Desligado com config',200.00, true, false, 1, false, 'percentual', 25.00, null, null),
         ($1, 'Agendado',           200.00, true, false, 2, true,  'fixo',        30.00, $3, null),
         ($1, 'Terminado',          200.00, true, false, 3, true,  'percentual',  40.00, $4, $2)
       returning id, nome`,
      [lojaMascara, ANTES, DEPOIS, MUITO_ANTES],
    );
    const masc = (nome: string) => mascara.rows.find((p) => p.nome === nome)!.id;

    return {
      lojaA,
      lojaB,
      lojaInativa,
      lojaMascara,
      catA: cat.rows[0].id,
      prodADisp: prod("A disponivel"),
      prodAIndisp: prod("A esgotado"),
      prodAOculto: prod("A oculto"),
      prodBDisp: prod("B disponivel"),
      prodInativaDisp: prod("Inativa disponivel"),
      prodVigente: masc("Vigente"),
      prodDesligadoComConfig: masc("Desligado com config"),
      prodAgendado: masc("Agendado"),
      prodTerminado: masc("Terminado"),
    };
  });
}

async function existeNaBase(t: TestDb, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.produtos where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

type LinhaDesconto = {
  desconto_ativo: boolean | null;
  desconto_tipo: string | null;
  desconto_valor: string | null;
  desconto_inicio: string | null;
  desconto_fim: string | null;
};

async function descontoNaView(t: TestDb, id: string): Promise<LinhaDesconto> {
  const r = await t.asAnon((db) =>
    db.query<LinhaDesconto>(
      `select desconto_ativo, desconto_tipo, desconto_valor, desconto_inicio, desconto_fim
         from public.vitrine_produtos where id = $1`,
      [id],
    ),
  );
  expect(r.rows).toHaveLength(1);
  return r.rows[0];
}

async function descontoNaBase(t: TestDb, id: string): Promise<LinhaDesconto> {
  const r = await t.asService((db) =>
    db.query<LinhaDesconto>(
      `select desconto_ativo, desconto_tipo, desconto_valor, desconto_inicio, desconto_fim
         from public.produtos where id = $1`,
      [id],
    ),
  );
  return r.rows[0];
}

/** `public.desconto_vigente(ativo, inicio, fim, agora)` — avaliada como anon. */
async function vigente(
  t: TestDb,
  ativo: boolean | null,
  inicio: string | null,
  fim: string | null,
  agora: string,
): Promise<boolean | null> {
  const r = await t.asAnon((db) =>
    db.query<{ v: boolean | null }>(
      `select public.desconto_vigente($1::boolean, $2::timestamptz, $3::timestamptz, $4::timestamptz) as v`,
      [ativo, inicio, fim, agora],
    ),
  );
  return r.rows[0].v;
}

describe("265 · vitrine_produtos (projeção pública mascarada) + drop da policy pública", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });

  afterAll(async () => {
    await t.close();
  });

  // ─────────────────── [1] a tabela base perde o SELECT público (migration B)

  it("[1a] anon NÃO lê public.produtos de loja ATIVA (0 linhas; a linha existe)", async () => {
    // Sem cláusula de escopo: quem nega é a ausência de policy pública, não o
    // WHERE do teste. Depois da migration B, `produtos` só tem
    // `produtos_leitura_propria` (dono) e o bypass do service_role.
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.produtos`),
    );
    expect(r.rows.map((x) => x.id)).toEqual([]);
    expect(await existeNaBase(t, c.prodADisp)).toBe(true);
  });

  it("[1b] lojista A NÃO lê public.produtos da loja B (0 linhas; a linha existe)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.produtos where id = $1`, [c.prodBDisp]),
    );
    expect(r.rows).toHaveLength(0);
    expect(await existeNaBase(t, c.prodBDisp)).toBe(true);
  });

  it("[1c] lojista A NÃO lê o CALENDÁRIO PROMOCIONAL de outra loja na base", async () => {
    // O vazamento nomeado pela issue: as cinco colunas da 219 na linha inteira.
    const r = await t.asUser(DONO_A, (db) =>
      db.query(
        `select desconto_ativo, desconto_tipo, desconto_valor, desconto_inicio, desconto_fim
           from public.produtos where id = $1`,
        [c.prodAgendado],
      ),
    );
    expect(r.rows).toHaveLength(0);

    // anti-falso-verde: a promoção agendada EXISTE e está configurada na base.
    const base = await descontoNaBase(t, c.prodAgendado);
    expect(base.desconto_tipo).toBe("fixo");
  });

  it("[1d] o dono continua lendo os PRÓPRIOS produtos na base (produtos_leitura_propria intacta)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.produtos where loja_id = $1 order by ordem`, [
        c.lojaA,
      ]),
    );
    expect(r.rows.map((x) => x.id)).toEqual([c.prodADisp, c.prodAIndisp, c.prodAOculto]);
  });

  // ────────────── [2] não-regressão: a view devolve o conjunto da policy antiga

  it("[2a] anon vê pela view EXATAMENTE o conjunto de ids que a policy antiga devolvia", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(
        `select id from public.vitrine_produtos
          where loja_id = any($1::uuid[]) order by loja_id, ordem`,
        [[c.lojaA, c.lojaB, c.lojaInativa]],
      ),
    );
    // Contrato literal da 099000: oculto = false AND loja_esta_ativa(loja_id).
    expect([...r.rows.map((x) => x.id)].sort()).toEqual(
      [c.prodADisp, c.prodAIndisp, c.prodBDisp].sort(),
    );
  });

  it("[2b] produto OCULTO e produto de loja INATIVA ficam fora da view (existem na base)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.vitrine_produtos`),
    );
    const vistos = r.rows.map((x) => x.id);
    expect(vistos).not.toContain(c.prodAOculto);
    expect(vistos).not.toContain(c.prodInativaDisp);
    expect(await existeNaBase(t, c.prodAOculto)).toBe(true);
    expect(await existeNaBase(t, c.prodInativaDisp)).toBe(true);
  });

  it("[2c] esgotado não-oculto CONTINUA na vitrine com disponivel = false", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string; disponivel: boolean }>(
        `select id, disponivel from public.vitrine_produtos where id = $1`,
        [c.prodAIndisp],
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].disponivel).toBe(false);
  });

  it("[2d] lojista logado navegando OUTRA vitrine lê a view igual a um anon (definer)", async () => {
    // Por que a view é definer e não invoker (§Segurança da 265): o SSR do
    // lojista logado roda como `authenticated`. Se a view rodasse com as
    // permissões do invoker, sem SELECT público na base, devolveria 0 linhas.
    const comoLojista = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(
        `select id from public.vitrine_produtos where loja_id = $1 order by ordem`,
        [c.lojaB],
      ),
    );
    const comoAnon = await t.asAnon((db) =>
      db.query<{ id: string }>(
        `select id from public.vitrine_produtos where loja_id = $1 order by ordem`,
        [c.lojaB],
      ),
    );
    expect(comoLojista.rows.map((x) => x.id)).toEqual([c.prodBDisp]);
    expect(comoLojista.rows.map((x) => x.id)).toEqual(comoAnon.rows.map((x) => x.id));
  });

  // ───────────────────────── [3] máscara por vigência (RN-03) preservando RN-07

  it("[3a] promoção VIGENTE sai da view com os cinco campos preenchidos", async () => {
    const v = await descontoNaView(t, c.prodVigente);
    expect(v.desconto_ativo).toBe(true);
    expect(v.desconto_tipo).toBe("percentual");
    expect(Number(v.desconto_valor)).toBe(10);
    expect(v.desconto_inicio).not.toBeNull();
    expect(v.desconto_fim).not.toBeNull();
  });

  it("[3b] promoção DESLIGADA com config sai mascarada; a base PRESERVA a config (RN-07)", async () => {
    const v = await descontoNaView(t, c.prodDesligadoComConfig);
    expect(v).toEqual({
      desconto_ativo: false,
      desconto_tipo: null,
      desconto_valor: null,
      desconto_inicio: null,
      desconto_fim: null,
    });

    // RN-07: desligar NÃO apaga. O painel do dono (tabela) continua vendo tudo.
    const base = await descontoNaBase(t, c.prodDesligadoComConfig);
    expect(base.desconto_ativo).toBe(false);
    expect(base.desconto_tipo).toBe("percentual");
    expect(Number(base.desconto_valor)).toBe(25);
  });

  it("[3c] promoção AGENDADA para o futuro sai mascarada; a base preserva a data de início", async () => {
    const v = await descontoNaView(t, c.prodAgendado);
    expect(v).toEqual({
      desconto_ativo: false,
      desconto_tipo: null,
      desconto_valor: null,
      desconto_inicio: null,
      desconto_fim: null,
    });

    const base = await descontoNaBase(t, c.prodAgendado);
    expect(base.desconto_ativo).toBe(true);
    expect(base.desconto_inicio).not.toBeNull();
  });

  it("[3d] promoção JÁ TERMINADA sai mascarada; a base preserva a data de término", async () => {
    const v = await descontoNaView(t, c.prodTerminado);
    expect(v).toEqual({
      desconto_ativo: false,
      desconto_tipo: null,
      desconto_valor: null,
      desconto_inicio: null,
      desconto_fim: null,
    });

    const base = await descontoNaBase(t, c.prodTerminado);
    expect(base.desconto_ativo).toBe(true);
    expect(base.desconto_fim).not.toBeNull();
  });

  it("[3e] produto SEM desconto nenhum sai com false/NULL (não é 'mascarado por acidente')", async () => {
    const v = await descontoNaView(t, c.prodADisp);
    expect(v).toEqual({
      desconto_ativo: false,
      desconto_tipo: null,
      desconto_valor: null,
      desconto_inicio: null,
      desconto_fim: null,
    });
  });

  it("[3f] a view é AO VIVO: desligar a promoção vigente a mascara no request seguinte", async () => {
    await t.asService((db) =>
      db.query(`update public.produtos set desconto_ativo = false where id = $1`, [c.prodVigente]),
    );
    const depois = await descontoNaView(t, c.prodVigente);
    expect(depois.desconto_ativo).toBe(false);
    expect(depois.desconto_valor).toBeNull();

    // religa para não contaminar os casos seguintes
    await t.asService((db) =>
      db.query(`update public.produtos set desconto_ativo = true where id = $1`, [c.prodVigente]),
    );
    expect((await descontoNaView(t, c.prodVigente)).desconto_ativo).toBe(true);
  });

  // ────────── [4] bordas de desconto_vigente — contrato SQL ↔ precoEfetivo (223)

  it("[4a] inicio = agora ⇒ true (início INCLUSIVO — RN-03)", async () => {
    expect(await vigente(t, true, AGORA, DEPOIS, AGORA)).toBe(true);
  });

  it("[4b] fim = agora ⇒ false (fim EXCLUSIVO — mesma convenção de lojaAberta/validarUsoCupom)", async () => {
    expect(await vigente(t, true, ANTES, AGORA, AGORA)).toBe(false);
  });

  it("[4c] ativo = false com prazo vigente ⇒ false", async () => {
    expect(await vigente(t, false, ANTES, DEPOIS, AGORA)).toBe(false);
  });

  it("[4d] ativo = true sem prazo nenhum ⇒ true (prazo aberto dos dois lados)", async () => {
    expect(await vigente(t, true, null, null, AGORA)).toBe(true);
  });

  it("[4e] prazo aberto de um lado só respeita o lado fechado", async () => {
    expect(await vigente(t, true, ANTES, null, AGORA)).toBe(true);
    expect(await vigente(t, true, DEPOIS, null, AGORA)).toBe(false);
    expect(await vigente(t, true, null, DEPOIS, AGORA)).toBe(true);
    expect(await vigente(t, true, null, ANTES, AGORA)).toBe(false);
  });

  it("[4f] ativo NULL ⇒ false, não NULL (a máscara nunca pode ficar indefinida)", async () => {
    expect(await vigente(t, null, null, null, AGORA)).toBe(false);
  });

  // ───────────────────────────────── [5] contrato de colunas da projeção

  it("[5a] vitrine_produtos expõe EXATAMENTE as 15 colunas do contrato, na ordem fixa (245)", async () => {
    const r = await t.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'vitrine_produtos'
        order by ordinal_position`,
    );
    expect(r.rows.map((x) => x.column_name)).toEqual([...COLUNAS_VITRINE_PRODUTOS]);
  });

  it("[5b] anon lê nomeando as 15 colunas uma a uma (coluna faltando ⇒ 42703, não silêncio)", async () => {
    const r = await t.asAnon((db) =>
      db.query<Record<string, unknown>>(
        `select ${COLUNAS_VITRINE_PRODUTOS.join(", ")}
           from public.vitrine_produtos where id = $1`,
        [c.prodADisp],
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(Object.keys(r.rows[0]).sort()).toEqual([...COLUNAS_VITRINE_PRODUTOS].sort());
  });

  it("[5c] oculto, criado_em e atualizado_em estão AUSENTES da projeção (42703 em cada)", async () => {
    for (const coluna of COLUNAS_AUSENTES) {
      await expect(
        t.asAnon((db) => db.query(`select ${coluna} from public.vitrine_produtos limit 1`)),
      ).rejects.toMatchObject({ code: "42703" });
    }
  });

  // ───────────────────────────── [6] view SELECT-only (seguranca.md §19)

  it("[6a] anon é recusado em INSERT/UPDATE/DELETE na view (42501); a base não muda", async () => {
    await expect(
      t.asAnon((db) =>
        db.query(`update public.vitrine_produtos set preco = 0.01 where id = $1`, [c.prodADisp]),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      t.asAnon((db) =>
        db.query(
          `insert into public.vitrine_produtos (loja_id, nome, preco) values ($1, 'Invasor', 1.00)`,
          [c.lojaA],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      t.asAnon((db) => db.query(`delete from public.vitrine_produtos where id = $1`, [c.prodADisp])),
    ).rejects.toMatchObject({ code: "42501" });

    const conf = await t.asService((db) =>
      db.query<{ preco: string; nome: string }>(
        `select preco, nome from public.produtos where id = $1`,
        [c.prodADisp],
      ),
    );
    expect(Number(conf.rows[0].preco)).toBe(100);
    expect(conf.rows[0].nome).toBe("A disponivel");

    const invasor = await t.asService((db) =>
      db.query(`select 1 from public.produtos where nome = 'Invasor'`),
    );
    expect(invasor.rows).toHaveLength(0);
  });

  it("[6b] catálogo: anon e authenticated têm exatamente SELECT na view", async () => {
    for (const role of ["anon", "authenticated"]) {
      const select = await t.db.query<{ ok: boolean }>(
        `select has_table_privilege($1, 'public.vitrine_produtos', 'SELECT') as ok`,
        [role],
      );
      expect({ role, select: select.rows[0].ok }).toEqual({ role, select: true });

      const proibidos: string[] = [];
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"]) {
        const r = await t.db.query<{ ok: boolean }>(
          `select has_table_privilege($1, 'public.vitrine_produtos', $2) as ok`,
          [role, priv],
        );
        if (r.rows[0].ok) proibidos.push(priv);
      }
      expect({ role, proibidos }).toEqual({ role, proibidos: [] });
    }
  });

  it("[7a] qual do usuário NÃO é empurrado para dentro da view — nome de loja inativa não vaza por erro de cast", async () => {
    // Achado do `auditar` (BAIXA): sem `security_barrier`, o planner avalia o
    // cast do atacante ANTES de `loja_esta_ativa()`, e a mensagem de erro cita o
    // dado da linha escondida:
    //   invalid input syntax for type integer: "Inativa disponivel"
    // Com a barreira, o filtro do usuário roda depois dos quais da view: a
    // consulta resolve sem erro e devolve 0 linhas.
    const linhas = await t.asAnon((db) =>
      db.query<{ id: string }>(
        `select id from public.vitrine_produtos where id = $1 and nome::int = 1`,
        [c.prodInativaDisp],
      ),
    );
    expect(linhas.rows).toHaveLength(0);
    // a linha existe: o que muda é só quem enxerga.
    expect(await existeNaBase(t, c.prodInativaDisp)).toBe(true);
  });

  it("[7b] o mesmo vale com expressão composta, que é como a sonda do auditor vazou o dado", async () => {
    const linhas = await t.asAnon((db) =>
      db.query<{ id: string }>(
        `select id from public.vitrine_produtos
          where id = $1 and (preco::text || nome)::int = 1`,
        [c.prodInativaDisp],
      ),
    );
    expect(linhas.rows).toHaveLength(0);
  });

  it("[7c] 245: a barreira sobrevive ao `create or replace view` — sonda pela 15ª coluna", async () => {
    // `create or replace view` executa AT_ReplaceRelOptions: SUBSTITUI todo o
    // conjunto de reloptions pelo que a instrução declara. A 132000 que omitir
    // `security_barrier = true` no `with (…)` desliga a barreira EM SILÊNCIO,
    // desfazendo a 124500 sem erro nenhum. A sonda usa a coluna NOVA para que
    // este caso só possa ficar verde depois da recriação.
    const linhas = await t.asAnon((db) =>
      db.query<{ id: string }>(
        `select id from public.vitrine_produtos where id = $1 and visibilidade::int = 1`,
        [c.prodInativaDisp],
      ),
    );
    expect(linhas.rows).toHaveLength(0);
    expect(await existeNaBase(t, c.prodInativaDisp)).toBe(true);
  });

  it("[6c] service_role continua lendo a TABELA (recálculo autoritativo não passa pela view)", async () => {
    // `criarPedido`/`revisarCarrinhoAction` precisam ver oculto, disponivel,
    // loja inativa e a configuração COMPLETA para recusar — por isso leem a base.
    const r = await t.asService((db) =>
      db.query<{ id: string; oculto: boolean }>(
        `select id, oculto from public.produtos where id = any($1::uuid[]) order by ordem`,
        [[c.prodAOculto, c.prodInativaDisp]],
      ),
    );
    expect(r.rows).toHaveLength(2);
  });
});
