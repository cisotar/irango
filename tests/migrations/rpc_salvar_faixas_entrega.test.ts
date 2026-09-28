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
 * Iteração 1: a função não existia ⇒ RED = 42883. A migration
 * `20260929120000_rpc_salvar_faixas_entrega.sql` está no remoto e NÃO muda.
 *
 * ITERAÇÃO 2 (issue 326, "Iteração 2 — retorno do checklist", C2' substitui C2):
 * cada item passa a ter `ativo` (boolean, OBRIGATÓRIO) e a faixa grava com o
 * `ativo` recebido. Invariante de PREFIXO: nenhuma faixa ativa depois de uma
 * desligada (todas desligadas é válido). A mudança vai numa migration NOVA
 * (`create or replace`, mesma assinatura) da fase GREEN. RED da iteração 2 =
 * a função atual ignora `ativo` e grava sempre true.
 *
 * CONTRATO DE MENSAGENS (P0001, prefixo fixo, internas — a Server Action loga e
 * devolve genérica, seguranca.md §14):
 *   'salvar_faixas_entrega: incremento invalido'   p_incremento ∉ {1,2}
 *   'salvar_faixas_entrega: faixas invalidas'      p_faixas null ou não-array
 *   'salvar_faixas_entrega: lista acima do teto'   > 30 faixas
 *   'salvar_faixas_entrega: sem posse'             T2: nem service_role nem dono de p_loja_id
 *   'salvar_faixas_entrega: taxa invalida'         taxa ausente, < 0 ou com mais de 2 casas
 *   'salvar_faixas_entrega: gratis invalido'       pedido_minimo_gratis < 0 ou com mais de 2 casas
 *   'salvar_faixas_entrega: ativo invalido'        (it. 2) `ativo` ausente, null ou não-boolean
 *   'salvar_faixas_entrega: faixa ativa depois de desligada'
 *                                                  (it. 2) item ativo com algum anterior desligado
 *
 * Ordem (it. 2): as duas mensagens novas são T3 — depois de T1 e T2 (dono A
 * com p_loja_id de B e lista com buraco continua 'sem posse'), antes de
 * qualquer escrita. Os casos só têm UM defeito cada, para a ordem entre as
 * checagens de T3 não importar.
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

/** Faixa como o CONTRATO espera ler de volta (D2 + C2'): `ativo` é o recebido. */
function faixaGravada(
  nome: string,
  raio: number,
  taxa: number,
  gratis: number | null,
  ativo = true,
): Omit<ZonaLida, "id"> {
  return {
    nome,
    tipo: "raio_km",
    ativo,
    taxa,
    pedido_minimo_gratis: gratis,
    raio_max_km: raio,
    cep_inicio: null,
    cep_fim: null,
    bairros: [],
  };
}

const TRES_FAIXAS = [
  { taxa: 4, pedido_minimo_gratis: null, ativo: true },
  { taxa: 6, pedido_minimo_gratis: 60, ativo: true },
  { taxa: 5, pedido_minimo_gratis: null, ativo: true },
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

    await salvar("donoA", lojaA, 1, [{ taxa: 0, pedido_minimo_gratis: 0, ativo: true }]);

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
    { taxa: 4, pedido_minimo_gratis: null, ativo: true },
    { taxa: 6, pedido_minimo_gratis: 60, ativo: true },
  ];

  const casos: Array<[string, number | null, unknown, string]> = [
    [
      "taxa negativa",
      1,
      [...OK, { taxa: -1, pedido_minimo_gratis: null, ativo: true }],
      "salvar_faixas_entrega: taxa invalida",
    ],
    [
      "taxa 4.555 (não é múltiplo de centavo; a coluna arredondaria calada)",
      1,
      [...OK, { taxa: 4.555, pedido_minimo_gratis: null, ativo: true }],
      "salvar_faixas_entrega: taxa invalida",
    ],
    ["taxa ausente", 1, [...OK, { pedido_minimo_gratis: null, ativo: true }], "salvar_faixas_entrega: taxa invalida"],
    [
      "taxa negativa em faixa DESLIGADA (desligada também é validada: é gravada e pode voltar a cobrar)",
      1,
      [...OK, { taxa: -1, pedido_minimo_gratis: null, ativo: false }],
      "salvar_faixas_entrega: taxa invalida",
    ],
    [
      "grátis negativo",
      1,
      [...OK, { taxa: 5, pedido_minimo_gratis: -10, ativo: true }],
      "salvar_faixas_entrega: gratis invalido",
    ],
    [
      "grátis 50.005 (mais de 2 casas)",
      1,
      [...OK, { taxa: 5, pedido_minimo_gratis: 50.005, ativo: true }],
      "salvar_faixas_entrega: gratis invalido",
    ],
    ["incremento 3", 3, OK, "salvar_faixas_entrega: incremento invalido"],
    ["incremento 0", 0, OK, "salvar_faixas_entrega: incremento invalido"],
    ["incremento null", null, OK, "salvar_faixas_entrega: incremento invalido"],
    [
      "31 faixas",
      1,
      Array.from({ length: 31 }, () => ({ taxa: 5, pedido_minimo_gratis: null, ativo: true })),
      "salvar_faixas_entrega: lista acima do teto",
    ],
    [
      "p_faixas objeto (não array)",
      1,
      { taxa: 5, pedido_minimo_gratis: null, ativo: true },
      "salvar_faixas_entrega: faixas invalidas",
    ],
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
    const trinta = Array.from({ length: 30 }, () => ({ taxa: 5, pedido_minimo_gratis: null, ativo: true }));

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

    await salvar("donoA", lojaA, 1, [{ taxa: 4, pedido_minimo_gratis: null, ativo: true }]);

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
// Iteração 2 (C2'): `ativo` DEIXOU de ser ignorado — é respeitado. As demais
// chaves extras (raio_max_km, nome, loja_id, tipo, cep_*) continuam ignoradas.
describe("[326/F1] (h) item com raio_max_km/nome/loja_id/tipo/cep_* é IGNORADO — servidor deriva (D2); `ativo` é RESPEITADO (C2')", () => {
  it("teto vem da posição, nome é derivado, loja é p_loja_id, tipo = raio_km; ativo = o recebido", async () => {
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
        ativo: true,
        tipo: "bairro",
        cep_inicio: 1,
        cep_fim: 2,
      },
      { taxa: 6, pedido_minimo_gratis: null, raio_max_km: 0.5, nome: "Centro", ativo: false },
    ]);

    expect(semId(await zonasDa(lojaA))).toEqual([
      faixaGravada("0–1 km", 1, 4, null, true),
      faixaGravada("1–2 km", 2, 6, null, false),
    ]);
    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });
});

// ═══════════════════════════════════════ (i) iteração 2 — `ativo` por faixa (C2')
describe("[326/F1 it.2] (i) `ativo` por faixa: gravado como recebido, ativas formam PREFIXO", () => {
  it("[t,t,f,f] inc 1 ⇒ aceito; 4 zonas com ativo t/t/f/f, tetos/nomes/taxas derivados como sempre; B intacta", async () => {
    await semear(lojaA, BASE_A);
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    await salvar("donoA", lojaA, 1, [
      { taxa: 4, pedido_minimo_gratis: null, ativo: true },
      { taxa: 6, pedido_minimo_gratis: 60, ativo: true },
      { taxa: 7, pedido_minimo_gratis: null, ativo: false },
      { taxa: 9, pedido_minimo_gratis: 90, ativo: false },
    ]);

    expect(semId(await zonasDa(lojaA))).toEqual([
      faixaGravada("0–1 km", 1, 4, null, true),
      faixaGravada("1–2 km", 2, 6, 60, true),
      faixaGravada("2–3 km", 3, 7, null, false),
      faixaGravada("3–4 km", 4, 9, 90, false),
    ]);
    expect(await zonasDa(lojaB)).toEqual(bAntes);
  });

  it("[f,f] inc 2 ⇒ aceito (lojista pode desligar tudo): 2 zonas desligadas, tetos 2/4, preços preservados", async () => {
    await semear(lojaA, BASE_A);

    await salvar("donoA", lojaA, 2, [
      { taxa: 4, pedido_minimo_gratis: null, ativo: false },
      { taxa: 6, pedido_minimo_gratis: 60, ativo: false },
    ]);

    expect(semId(await zonasDa(lojaA))).toEqual([
      faixaGravada("0–2 km", 2, 4, null, false),
      faixaGravada("2–4 km", 4, 6, 60, false),
    ]);
  });

  it("service_role também grava o `ativo` recebido ([t,f]) — a via admin segue o mesmo contrato", async () => {
    await semear(lojaA, BASE_A);

    await salvar("service", lojaA, 1, [
      { taxa: 4, pedido_minimo_gratis: null, ativo: true },
      { taxa: 6, pedido_minimo_gratis: null, ativo: false },
    ]);

    expect(semId(await zonasDa(lojaA))).toEqual([
      faixaGravada("0–1 km", 1, 4, null, true),
      faixaGravada("1–2 km", 2, 6, null, false),
    ]);
  });

  // Recusas: mesmo padrão de (f) — estado anterior CONHECIDO e não vazio, relido
  // com ids num bloco separado depois da exceção.
  const recusas: Array<[string, unknown, string]> = [
    [
      "[t,f,t] (buraco)",
      [
        { taxa: 4, pedido_minimo_gratis: null, ativo: true },
        { taxa: 6, pedido_minimo_gratis: null, ativo: false },
        { taxa: 8, pedido_minimo_gratis: null, ativo: true },
      ],
      "salvar_faixas_entrega: faixa ativa depois de desligada",
    ],
    [
      "[f,t] (primeira desligada, segunda ativa)",
      [
        { taxa: 4, pedido_minimo_gratis: null, ativo: false },
        { taxa: 6, pedido_minimo_gratis: null, ativo: true },
      ],
      "salvar_faixas_entrega: faixa ativa depois de desligada",
    ],
    [
      "[t,t,f,f,t] (ativa só no fim, depois de duas desligadas)",
      [
        { taxa: 4, pedido_minimo_gratis: null, ativo: true },
        { taxa: 5, pedido_minimo_gratis: null, ativo: true },
        { taxa: 6, pedido_minimo_gratis: null, ativo: false },
        { taxa: 7, pedido_minimo_gratis: null, ativo: false },
        { taxa: 8, pedido_minimo_gratis: null, ativo: true },
      ],
      "salvar_faixas_entrega: faixa ativa depois de desligada",
    ],
    [
      "`ativo` AUSENTE no último item",
      [
        { taxa: 4, pedido_minimo_gratis: null, ativo: true },
        { taxa: 6, pedido_minimo_gratis: null },
      ],
      "salvar_faixas_entrega: ativo invalido",
    ],
    [
      "`ativo` null",
      [{ taxa: 4, pedido_minimo_gratis: null, ativo: null }],
      "salvar_faixas_entrega: ativo invalido",
    ],
    [
      "`ativo` string 'true'",
      [{ taxa: 4, pedido_minimo_gratis: null, ativo: "true" }],
      "salvar_faixas_entrega: ativo invalido",
    ],
    [
      "`ativo` número 1",
      [{ taxa: 4, pedido_minimo_gratis: null, ativo: 1 }],
      "salvar_faixas_entrega: ativo invalido",
    ],
    [
      "`ativo` string 'false' depois de ativa (não pode virar desligada por coerção)",
      [
        { taxa: 4, pedido_minimo_gratis: null, ativo: true },
        { taxa: 6, pedido_minimo_gratis: null, ativo: "false" },
      ],
      "salvar_faixas_entrega: ativo invalido",
    ],
  ];

  it.each(recusas)("%s ⇒ P0001 + mensagem; zonas/taxas/bairros de A idênticos (com ids)", async (_n, faixas, msg) => {
    await semear(lojaA, BASE_A);
    const aAntes = await zonasDa(lojaA);
    expect(aAntes).toHaveLength(2); // estado conhecido e não vazio

    esperarErro(await erroDe(salvar("donoA", lojaA, 1, faixas)), "P0001", msg);

    expect(await zonasDa(lojaA)).toEqual(aAntes);
  });

  it("service_role com buraco [t,f,t] ⇒ também recusado (a regra é do dado, não do papel); A intacta", async () => {
    await semear(lojaA, BASE_A);
    const aAntes = await zonasDa(lojaA);

    esperarErro(
      await erroDe(
        salvar("service", lojaA, 1, [
          { taxa: 4, pedido_minimo_gratis: null, ativo: true },
          { taxa: 6, pedido_minimo_gratis: null, ativo: false },
          { taxa: 8, pedido_minimo_gratis: null, ativo: true },
        ]),
      ),
      "P0001",
      "salvar_faixas_entrega: faixa ativa depois de desligada",
    );

    expect(await zonasDa(lojaA)).toEqual(aAntes);
  });

  it("dono A com p_loja_id de B E lista com buraco ⇒ 'sem posse' (T2 continua antes de T3); B intacta", async () => {
    await semear(lojaB, BASE_B);
    const bAntes = await zonasDa(lojaB);

    esperarErro(
      await erroDe(
        salvar("donoA", lojaB, 1, [
          { taxa: 4, pedido_minimo_gratis: null, ativo: false },
          { taxa: 6, pedido_minimo_gratis: null, ativo: true },
        ]),
      ),
      "P0001",
      "salvar_faixas_entrega: sem posse",
    );

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
