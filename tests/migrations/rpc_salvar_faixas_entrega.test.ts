import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 326 — fatia F1: prova de BANCO da RPC de escrita em
 * lote das faixas de entrega:
 *
 *   public.salvar_faixas_entrega(p_loja_id uuid, p_incremento int, p_faixas jsonb)
 *
 * Autoridade: tasks/326-tabela-de-faixas-de-entrega.md D1 (INVOKER, filtro
 * `loja_id = p_loja_id`, uma transação: apaga TODAS as zonas da loja e insere as
 * faixas), D2 (servidor deriva teto = posição × incremento, nome "<de>–<até> km",
 * tipo raio_km, cep null; payload só tem taxa e pedido_minimo_gratis), C2 (toda
 * faixa grava ativo = true) · plan/loop-faixas-de-entrega.md P3 (T1 forma, T2
 * autoridade antes de qualquer linha, T3 valor por item).
 *
 * Hoje a função não existe ⇒ RED = 42883 (função inexistente), nunca erro de
 * sintaxe do teste. A migration `20260929120000_rpc_salvar_faixas_entrega.sql`
 * é da fase GREEN.
 *
 * CONTRATO DE MENSAGENS (P0001, prefixo fixo, internas — a Server Action loga e
 * devolve genérica, seguranca.md §14):
 *   'salvar_faixas_entrega: incremento invalido'   p_incremento ∉ {1,2}
 *   'salvar_faixas_entrega: faixas invalidas'      p_faixas null ou não-array
 *   'salvar_faixas_entrega: lista acima do teto'   > 30 faixas
 *   'salvar_faixas_entrega: sem posse'             T2: nem service_role nem dono de p_loja_id
 *   'salvar_faixas_entrega: taxa invalida'         taxa ausente, < 0 ou com mais de 2 casas
 *   'salvar_faixas_entrega: gratis invalido'       pedido_minimo_gratis < 0 ou com mais de 2 casas
 *
 * Anti-falso-verde:
 *  - toda recusa afirma SQLSTATE **e** fragmento (memória
 *    `sqlstate-nao-basta-em-teste-de-escopo`): com p_loja_id alheio e lista
 *    cheia, a RLS de `zonas_entrega` já daria 42501 "violates row-level security"
 *    por acidente; só "sem posse" prova que T2 disparou ANTES de qualquer linha.
 *    Com lista vazia a RLS NÃO denuncia nada (delete de 0 linhas passa calado) —
 *    é por isso que T2 é obrigatório;
 *  - "estado intacto" é relido num bloco `asService` SEPARADO, depois do bloco
 *    que lançou (o harness faz rollback no erro), e compara o snapshot COMPLETO
 *    com ids — não basta "tem zonas";
 *  - antes de cada recusa a loja recebe um estado CONHECIDO e não vazio.
 *  - taxa 4.555: `taxas_entrega.taxa` é numeric(10,2) e ARREDONDARIA calado
 *    para 4.56. Só a validação explícita da função recusa.
 */

const DONO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aa0000000326";
const DONO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bb0000000326";

let t: TestDb;
let lojaA: string;
let lojaB: string;

type ErroPg = { code?: string; message?: string };
async function erroDe(p: Promise<unknown>): Promise<ErroPg | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ErroPg;
  }
}
function esperarErro(e: ErroPg | null, code: string, fragmento: string) {
  expect(e, `esperava ${code} "${fragmento}", mas não lançou`).not.toBeNull();
  expect(e?.code, `mensagem recebida: ${e?.message}`).toBe(code);
  expect(e?.message).toContain(fragmento);
}

type Papel = "donoA" | "service" | "anon";
function como<T>(papel: Papel, fn: Parameters<TestDb["asService"]>[0]): Promise<T> {
  if (papel === "donoA") return t.asUser(DONO_A, fn) as Promise<T>;
  if (papel === "anon") return t.asAnon(fn) as Promise<T>;
  return t.asService(fn) as Promise<T>;
}

async function salvar(papel: Papel, lojaId: string, incremento: number | null, faixas: unknown) {
  return como(papel, (s) =>
    s.query(`select public.salvar_faixas_entrega($1::uuid, $2::int, $3::jsonb)`, [
      lojaId,
      incremento,
      faixas === undefined ? null : JSON.stringify(faixas),
    ]),
  );
}

// ── Estado das zonas de uma loja ─────────────────────────────────────────────
type ZonaLida = {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  taxa: number | null;
  pedido_minimo_gratis: number | null;
  raio_max_km: number | null;
  cep_inicio: number | null;
  cep_fim: number | null;
  bairros: string[];
};

async function zonasDa(lojaId: string): Promise<ZonaLida[]> {
  const r = await t.asService((s) =>
    s.query<ZonaLida>(
      `select z.id, z.nome, z.tipo, z.ativo,
              t.taxa, t.pedido_minimo_gratis, t.raio_max_km, t.cep_inicio, t.cep_fim,
              coalesce((select array_agg(b.nome order by b.nome) from public.bairros_zona b
                         where b.zona_id = z.id), '{}') as bairros
         from public.zonas_entrega z
         left join public.taxas_entrega t on t.zona_id = z.id
        where z.loja_id = $1
        order by t.raio_max_km nulls last, z.nome`,
      [lojaId],
    ),
  );
  return r.rows;
}

/** Sem o id — para comparar o que a RPC gravou (ids são novos). */
const semId = (zs: ZonaLida[]) =>
  zs.map(({ id: _id, ...resto }) => {
    void _id;
    return resto;
  });

type ZonaSemente = {
  nome: string;
  tipo: "raio_km" | "bairro" | "faixa_cep";
  ativo?: boolean;
  taxa: number;
  gratis?: number | null;
  raio?: number | null;
  cep?: [number, number] | null;
  bairros?: string[];
};

/** Substitui (como postgres) as zonas da loja por um estado conhecido. */
async function semear(lojaId: string, zonas: ZonaSemente[]) {
  await t.asService(async (s) => {
    await s.query(`delete from public.zonas_entrega where loja_id = $1`, [lojaId]);
    for (const z of zonas) {
      const zr = await s.query<{ id: string }>(
        `insert into public.zonas_entrega (loja_id, nome, tipo, ativo) values ($1, $2, $3, $4) returning id`,
        [lojaId, z.nome, z.tipo, z.ativo ?? true],
      );
      const zonaId = zr.rows[0].id;
      await s.query(
        `insert into public.taxas_entrega (zona_id, taxa, pedido_minimo_gratis, raio_max_km, cep_inicio, cep_fim)
         values ($1, $2, $3, $4, $5, $6)`,
        [zonaId, z.taxa, z.gratis ?? null, z.raio ?? null, z.cep?.[0] ?? null, z.cep?.[1] ?? null],
      );
      for (const b of z.bairros ?? []) {
        await s.query(`insert into public.bairros_zona (zona_id, nome) values ($1, $2)`, [zonaId, b]);
      }
    }
  });
}

const BASE_A: ZonaSemente[] = [
  { nome: "Até 5 km", tipo: "raio_km", taxa: 7, gratis: 90, raio: 5 },
  { nome: "Centro", tipo: "bairro", taxa: 3, bairros: ["Centro", "Sé"] },
];
const BASE_B: ZonaSemente[] = [
  { nome: "Até 4 km (B)", tipo: "raio_km", taxa: 6, raio: 4 },
  { nome: "Vila B", tipo: "bairro", taxa: 2, bairros: ["Vila"] },
];

/** Faixa como o CONTRATO espera ler de volta (D2 + C2). */
function faixaGravada(
  nome: string,
  raio: number,
  taxa: number,
  gratis: number | null,
): Omit<ZonaLida, "id"> {
  return {
    nome,
    tipo: "raio_km",
    ativo: true,
    taxa,
    pedido_minimo_gratis: gratis,
    raio_max_km: raio,
    cep_inicio: null,
    cep_fim: null,
    bairros: [],
  };
}

const TRES_FAIXAS = [
  { taxa: 4, pedido_minimo_gratis: null },
  { taxa: 6, pedido_minimo_gratis: 60 },
  { taxa: 5, pedido_minimo_gratis: null },
];

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-a-326@teste.local'), ($2, 'dono-b-326@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
  const lojas = await t.asService((s) =>
    s.query<{ id: string; slug: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values
         ($1, 'loja-a-326', 'Loja A 326', true), ($2, 'loja-b-326', 'Loja B 326', true)
       returning id, slug`,
      [DONO_A, DONO_B],
    ),
  );
  lojaA = lojas.rows.find((l) => l.slug === "loja-a-326")!.id;
  lojaB = lojas.rows.find((l) => l.slug === "loja-b-326")!.id;
}, 60_000);

afterAll(async () => {
  await t?.close();
});

// ═══════════════════════════════════════════════════════ (a) (b) caminho feliz
describe("[326/F1] salvar_faixas_entrega — dono grava as faixas (D1/D2/C2)", () => {
  it("(a) inc 1, 3 faixas ⇒ 3 zonas raio_km, tetos 1/2/3, nomes derivados, taxas e grátis gravados; zonas antigas somem; B intacta", async () => {
    await semear(lojaA, BASE_A);
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    await salvar("donoA", lojaA, 1, TRES_FAIXAS);

    expect(semId(await zonasDa(lojaA))).toEqual([
      faixaGravada("0–1 km", 1, 4, null),
      faixaGravada("1–2 km", 2, 6, 60),
      faixaGravada("2–3 km", 3, 5, null),
    ]);
    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });

  it("(b) inc 2 ⇒ tetos 2/4/6 e nomes 0–2 / 2–4 / 4–6 km", async () => {
    await semear(lojaA, BASE_A);

    await salvar("donoA", lojaA, 2, TRES_FAIXAS);

    expect(semId(await zonasDa(lojaA))).toEqual([
      faixaGravada("0–2 km", 2, 4, null),
      faixaGravada("2–4 km", 4, 6, 60),
      faixaGravada("4–6 km", 6, 5, null),
    ]);
  });

  it("lista vazia na PRÓPRIA loja ⇒ apaga todas as zonas dela (0 faixas é válido); B intacta", async () => {
    await semear(lojaA, BASE_A);
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    await salvar("donoA", lojaA, 1, []);

    expect(await zonasDa(lojaA)).toEqual([]);
    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });

  it("taxa 0 e grátis 0 são valores válidos (limite inferior)", async () => {
    await semear(lojaA, BASE_A);

    await salvar("donoA", lojaA, 1, [{ taxa: 0, pedido_minimo_gratis: 0 }]);

    expect(semId(await zonasDa(lojaA))).toEqual([faixaGravada("0–1 km", 1, 0, 0)]);
  });
});

// ═══════════════════════════════════════════════ (c) (d) (e) escopo e autoridade
describe("[326/F1] escopo por loja e autoridade (T2 antes de qualquer linha)", () => {
  it("(c) dono A com p_loja_id de B e lista VAZIA ⇒ P0001 'sem posse'; zonas de B intactas", async () => {
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    esperarErro(await erroDe(salvar("donoA", lojaB, 1, [])), "P0001", "salvar_faixas_entrega: sem posse");

    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });

  it("(c) dono A com p_loja_id de B e lista CHEIA ⇒ P0001 'sem posse' (não o 42501 acidental da RLS); B intacta", async () => {
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    esperarErro(
      await erroDe(salvar("donoA", lojaB, 1, TRES_FAIXAS)),
      "P0001",
      "salvar_faixas_entrega: sem posse",
    );

    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });

  it("(c) dono A com p_loja_id de B não toca A também (a exceção desfaz tudo)", async () => {
    await semear(lojaA, BASE_A);
    const aAntes = await zonasDa(lojaA);

    esperarErro(
      await erroDe(salvar("donoA", lojaB, 1, TRES_FAIXAS)),
      "P0001",
      "salvar_faixas_entrega: sem posse",
    );

    expect(await zonasDa(lojaA)).toEqual(aAntes);
  });

  it("sessão 'authenticated' com claim role FORJADO 'service_role' ⇒ 'sem posse' pela via do dono; B intacta", async () => {
    // Os dois sinais de v_e_servico divergem só por forja ou bug de pool
    // (padrão 20260918130000): o claim diz service_role, o role SQL efetivo
    // continua 'authenticated'. A via de serviço tem de NEGAR.
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    const erro = await erroDe(
      (async () => {
        await t.db.exec("begin");
        try {
          await t.db.query("set local role authenticated");
          await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: DONO_A, role: "service_role" }),
          ]);
          await t.db.query(`select public.salvar_faixas_entrega($1::uuid, 1, $2::jsonb)`, [
            lojaB,
            JSON.stringify(TRES_FAIXAS),
          ]);
          await t.db.exec("commit");
        } catch (e) {
          await t.db.exec("rollback");
          throw e;
        }
      })(),
    );
    esperarErro(erro, "P0001", "salvar_faixas_entrega: sem posse");

    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });

  it("(d) anon ⇒ 42501 nomeando a função; A intacta", async () => {
    await semear(lojaA, BASE_A);
    const aAntes = await zonasDa(lojaA);

    esperarErro(await erroDe(salvar("anon", lojaA, 1, TRES_FAIXAS)), "42501", "salvar_faixas_entrega");

    expect(await zonasDa(lojaA)).toEqual(aAntes);
  });

  it("(e) service_role com p_loja_id A ⇒ só A muda; B intacta (o filtro vale sem RLS)", async () => {
    await semear(lojaA, BASE_A);
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    await salvar("service", lojaA, 1, TRES_FAIXAS);

    expect(semId(await zonasDa(lojaA))).toEqual([
      faixaGravada("0–1 km", 1, 4, null),
      faixaGravada("1–2 km", 2, 6, 60),
      faixaGravada("2–3 km", 3, 5, null),
    ]);
    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });

  it("(e) service_role com lista vazia em A ⇒ apaga só as de A; B intacta", async () => {
    await semear(lojaA, BASE_A);
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    await salvar("service", lojaA, 1, []);

    expect(await zonasDa(lojaA)).toEqual([]);
    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });
});

// ═════════════════════════════════════════════════ (f) validação + atomicidade
describe("[326/F1] (f) valor inválido ⇒ exceção e estado ANTERIOR intacto (atomicidade)", () => {
  // O item inválido vem DEPOIS de dois válidos: uma implementação que apagasse
  // e inserisse antes de validar teria linhas novas — o rollback da exceção (ou
  // a validação antecipada) é o que devolve o snapshot idêntico.
  const OK = [
    { taxa: 4, pedido_minimo_gratis: null },
    { taxa: 6, pedido_minimo_gratis: 60 },
  ];

  const casos: Array<[string, number | null, unknown, string]> = [
    ["taxa negativa", 1, [...OK, { taxa: -1, pedido_minimo_gratis: null }], "salvar_faixas_entrega: taxa invalida"],
    [
      "taxa 4.555 (não é múltiplo de centavo; a coluna arredondaria calada)",
      1,
      [...OK, { taxa: 4.555, pedido_minimo_gratis: null }],
      "salvar_faixas_entrega: taxa invalida",
    ],
    ["taxa ausente", 1, [...OK, { pedido_minimo_gratis: null }], "salvar_faixas_entrega: taxa invalida"],
    [
      "grátis negativo",
      1,
      [...OK, { taxa: 5, pedido_minimo_gratis: -10 }],
      "salvar_faixas_entrega: gratis invalido",
    ],
    [
      "grátis 50.005 (mais de 2 casas)",
      1,
      [...OK, { taxa: 5, pedido_minimo_gratis: 50.005 }],
      "salvar_faixas_entrega: gratis invalido",
    ],
    ["incremento 3", 3, OK, "salvar_faixas_entrega: incremento invalido"],
    ["incremento 0", 0, OK, "salvar_faixas_entrega: incremento invalido"],
    ["incremento null", null, OK, "salvar_faixas_entrega: incremento invalido"],
    [
      "31 faixas",
      1,
      Array.from({ length: 31 }, () => ({ taxa: 5, pedido_minimo_gratis: null })),
      "salvar_faixas_entrega: lista acima do teto",
    ],
    ["p_faixas objeto (não array)", 1, { taxa: 5, pedido_minimo_gratis: null }, "salvar_faixas_entrega: faixas invalidas"],
    ["p_faixas null", 1, undefined, "salvar_faixas_entrega: faixas invalidas"],
  ];

  it.each(casos)("%s ⇒ P0001 + mensagem; zonas/taxas/bairros de A idênticos (com ids)", async (_n, inc, faixas, msg) => {
    await semear(lojaA, BASE_A);
    const aAntes = await zonasDa(lojaA);
    expect(aAntes).toHaveLength(2); // estado conhecido e não vazio

    esperarErro(await erroDe(salvar("donoA", lojaA, inc, faixas)), "P0001", msg);

    expect(await zonasDa(lojaA)).toEqual(aAntes);
  });

  it("30 faixas (teto) é aceito ⇒ último teto 30 km / 60 km no inc 2", async () => {
    await semear(lojaA, BASE_A);
    const trinta = Array.from({ length: 30 }, () => ({ taxa: 5, pedido_minimo_gratis: null }));

    await salvar("donoA", lojaA, 2, trinta);

    const zs = await zonasDa(lojaA);
    expect(zs).toHaveLength(30);
    expect(zs[29].raio_max_km).toBe(60);
    expect(zs[29].nome).toBe("58–60 km");
  });
});

// ═══════════════════════════════════════════════════════════ (g) cascata
describe("[326/F1] (g) zonas bairro/faixa_cep antigas somem com filhas (cascata)", () => {
  it("salvar faixas apaga zonas bairro e faixa_cep da loja, as taxas e os bairros delas; B intacta", async () => {
    await semear(lojaA, [
      { nome: "Centro", tipo: "bairro", taxa: 3, bairros: ["Centro", "Sé", "Luz"] },
      { nome: "CEP 01000", tipo: "faixa_cep", taxa: 9, cep: [1000000, 1099999] },
      { nome: "Até 7 km", tipo: "raio_km", taxa: 8, raio: 7 },
    ]);
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);
    const idsAntigos = (await zonasDa(lojaA)).map((z) => z.id);
    expect(idsAntigos).toHaveLength(3);

    await salvar("donoA", lojaA, 1, [{ taxa: 4, pedido_minimo_gratis: null }]);

    expect(semId(await zonasDa(lojaA))).toEqual([faixaGravada("0–1 km", 1, 4, null)]);
    const orfas = await t.asService((s) =>
      s.query<{ taxas: number; bairros: number }>(
        `select (select count(*)::int from public.taxas_entrega where zona_id = any($1::uuid[])) as taxas,
                (select count(*)::int from public.bairros_zona  where zona_id = any($1::uuid[])) as bairros`,
        [idsAntigos],
      ),
    );
    expect(orfas.rows[0]).toEqual({ taxas: 0, bairros: 0 });
    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });
});

// ═══════════════════════════════════════════════ (h) chaves do cliente ignoradas
describe("[326/F1] (h) item com raio_max_km/nome/loja_id/ativo/tipo é IGNORADO — servidor deriva (D2/C2)", () => {
  it("teto vem da posição, nome é derivado, loja é p_loja_id, ativo = true, tipo = raio_km", async () => {
    await semear(lojaA, BASE_A);
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    await salvar("donoA", lojaA, 1, [
      {
        taxa: 4,
        pedido_minimo_gratis: null,
        raio_max_km: 99,
        nome: "Frete grátis",
        loja_id: lojaB,
        ativo: false,
        tipo: "bairro",
        cep_inicio: 1,
        cep_fim: 2,
      },
      { taxa: 6, pedido_minimo_gratis: null, raio_max_km: 0.5, ativo: false },
    ]);

    expect(semId(await zonasDa(lojaA))).toEqual([
      faixaGravada("0–1 km", 1, 4, null),
      faixaGravada("1–2 km", 2, 6, null),
    ]);
    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });
});

// ═══════════════════════════════════════════════════════════════ catálogo
describe("[326/D1] catálogo da função", () => {
  const ASSINATURA = "public.salvar_faixas_entrega(uuid, integer, jsonb)";

  it("SECURITY INVOKER (prosecdef = false) e search_path fixado", async () => {
    const r = await t.db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where oid = $1::regprocedure`,
      [ASSINATURA],
    );
    expect(r.rows[0].prosecdef).toBe(false);
    expect((r.rows[0].proconfig ?? []).some((x) => x.startsWith("search_path="))).toBe(true);
  });

  it("EXECUTE: anon não; authenticated e service_role sim", async () => {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
      [ASSINATURA],
    );
    expect(r.rows[0]).toEqual({ anon: false, auth: true, svc: true });
  });
});
