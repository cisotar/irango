import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) das issues 325 + 328 — fatias F1 (versão otimista) e F2 (RPC
 * CEP e bairro): prova de BANCO da RPC única de gravação das zonas de entrega
 *
 *   public.salvar_zonas_entrega(p_loja_id uuid, p_versao bigint, p_forma text, p_dados jsonb)
 *     returns bigint  -- a versão NOVA (p_versao + 1)
 *
 * e da coluna `lojas.versao_zonas_entrega bigint not null default 0` com CHECK
 * `lojas_versao_zonas_entrega_nao_negativa`.
 *
 * Autoridade: plan/arquivo/tecnico-formas-de-frete.md §1 (assinatura, shape de p_dados,
 * ordem T1 forma → T2 posse → T3 valor → T4 versão compare-and-set → escrita,
 * mensagens estáveis), §2 (coluna), §4 (regras de valor por forma), §8 itens
 * 1–9 e 12–29.
 *
 * RED esperado: a migration `20261018120000_zonas_entrega_versao_e_formas.sql`
 * ainda não existe ⇒ a função dá 42883 ("function ... does not exist") e a
 * coluna dá 42703 ("column ... does not exist"). O item 9 (assinatura antiga
 * continua existindo) é TRAVA de expand-only e já nasce verde.
 *
 * CONTRATO DE MENSAGENS (P0001, prefixo 'salvar_zonas_entrega: '):
 *   forma invalida · versao invalida · dados invalidos · incremento invalido ·
 *   faixas invalidas · grupos invalidos · lista acima do teto · sem posse ·
 *   taxa invalida · gratis invalido · ativo invalido ·
 *   faixa ativa depois de desligada · cep invalido · faixa de cep invertida ·
 *   faixas de cep sobrepostas · bairro invalido · grupo sem bairro ·
 *   bairro repetido · versao desatualizada
 *
 * Anti-falso-verde (mesmo padrão de rpc_salvar_faixas_entrega.test.ts):
 *  - toda recusa afirma SQLSTATE **e** fragmento da mensagem;
 *  - "estado intacto" compara zonas + taxas + bairros (com ids) **e**
 *    `lojas.versao_zonas_entrega`, relidos num bloco `asService` separado;
 *  - antes de cada recusa a loja recebe um estado CONHECIDO e não vazio.
 *
 * 325 (mudança de requisito, migration 20261018130000_lojas_forma_frete_ativa):
 * gravar numa forma regrava SÓ as zonas daquela forma; as zonas das outras
 * formas ficam guardadas. Por isso as asserções de "o que foi gravado" leem
 * `zonasDa(loja, forma)`. Segunda mudança (20261018140000_definir_forma_frete,
 * plan/loop-ativar-forma-frete.md D1a): salvar NÃO ativa mais a forma —
 * `lojas.forma_frete` só muda por `definir_forma_frete`.
 */

const DONO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aa0000000328";
const DONO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bb0000000328";

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
const P = "salvar_zonas_entrega: ";

type Papel = "donoA" | "service" | "anon";
function como<T>(papel: Papel, fn: Parameters<TestDb["asService"]>[0]): Promise<T> {
  if (papel === "donoA") return t.asUser(DONO_A, fn) as Promise<T>;
  if (papel === "anon") return t.asAnon(fn) as Promise<T>;
  return t.asService(fn) as Promise<T>;
}

type Forma = "raio_km" | "faixa_cep" | "bairro";

/** Chama a RPC com argumentos crus. Devolve a versão nova (como number). */
async function salvar(
  papel: Papel,
  lojaId: string,
  versao: number | null,
  forma: string,
  dados: unknown,
): Promise<number> {
  const r = await como<{ rows: Array<{ v: number }> }>(papel, (s) =>
    s.query<{ v: number }>(
      `select public.salvar_zonas_entrega($1::uuid, $2::bigint, $3::text, $4::jsonb)::int as v`,
      [lojaId, versao, forma, dados === undefined ? null : JSON.stringify(dados)],
    ),
  );
  return r.rows[0].v;
}

async function versaoDe(lojaId: string): Promise<number> {
  const r = await t.asService((s) =>
    s.query<{ v: number }>(`select versao_zonas_entrega::int as v from public.lojas where id = $1`, [lojaId]),
  );
  return r.rows[0].v;
}

/** Grava com a versão ATUAL da loja (o caso "gravador leu o estado certo"). */
async function salvarAtual(papel: Papel, lojaId: string, forma: Forma, dados: unknown): Promise<number> {
  return salvar(papel, lojaId, await versaoDe(lojaId), forma, dados);
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

/** Zonas da loja; com `tipo`, só as daquela forma (as outras ficam guardadas — 325). */
async function zonasDa(lojaId: string, tipo?: Forma): Promise<ZonaLida[]> {
  const r = await t.asService((s) =>
    s.query<ZonaLida>(
      `select z.id, z.nome, z.tipo, z.ativo,
              t.taxa, t.pedido_minimo_gratis, t.raio_max_km, t.cep_inicio, t.cep_fim,
              coalesce((select array_agg(b.nome order by b.nome) from public.bairros_zona b
                         where b.zona_id = z.id), '{}') as bairros
         from public.zonas_entrega z
         left join public.taxas_entrega t on t.zona_id = z.id
        where z.loja_id = $1 and ($2::text is null or z.tipo = $2::text)
        order by t.raio_max_km nulls last, t.cep_inicio nulls last, z.nome`,
      [lojaId, tipo ?? null],
    ),
  );
  return r.rows;
}

/** Snapshot completo: zonas/taxas/bairros com ids + versão da loja. */
async function estado(lojaId: string) {
  return { zonas: await zonasDa(lojaId), versao: await versaoDe(lojaId) };
}

const semId = (zs: ZonaLida[]) =>
  zs.map(({ id: _id, ...resto }) => {
    void _id;
    return resto;
  });

type ZonaSemente = {
  nome: string;
  tipo: Forma;
  ativo?: boolean;
  taxa: number;
  gratis?: number | null;
  raio?: number | null;
  cep?: [number, number] | null;
  bairros?: string[];
};

/** Substitui (como postgres) as zonas da loja por um estado conhecido. Não mexe na versão. */
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

/** Loja A com as TRÊS formas misturadas (legado): toda gravação tem algo a apagar. */
const MISTA_A: ZonaSemente[] = [
  { nome: "Até 5 km", tipo: "raio_km", taxa: 7, gratis: 90, raio: 5 },
  { nome: "Centro", tipo: "bairro", taxa: 3, bairros: ["Centro", "Sé"] },
  { nome: "CEP 09000", tipo: "faixa_cep", taxa: 9, cep: [9000000, 9099999] },
];
const BASE_B: ZonaSemente[] = [
  { nome: "Até 4 km (B)", tipo: "raio_km", taxa: 6, raio: 4 },
  { nome: "Vila B", tipo: "bairro", taxa: 2, bairros: ["Vila"] },
];

function faixaKm(nome: string, raio: number, taxa: number, gratis: number | null, ativo = true): Omit<ZonaLida, "id"> {
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
function zonaCep(
  nome: string,
  ini: number,
  fim: number,
  taxa: number,
  gratis: number | null,
  ativo = true,
): Omit<ZonaLida, "id"> {
  return {
    nome,
    tipo: "faixa_cep",
    ativo,
    taxa,
    pedido_minimo_gratis: gratis,
    raio_max_km: null,
    cep_inicio: ini,
    cep_fim: fim,
    bairros: [],
  };
}
function zonaBairro(
  nome: string,
  bairros: string[],
  taxa: number,
  gratis: number | null,
  ativo = true,
): Omit<ZonaLida, "id"> {
  return {
    nome,
    tipo: "bairro",
    ativo,
    taxa,
    pedido_minimo_gratis: gratis,
    raio_max_km: null,
    cep_inicio: null,
    cep_fim: null,
    bairros: [...bairros].sort(),
  };
}

// ── Payloads válidos por forma ───────────────────────────────────────────────
const KM_OK = {
  incremento: 1,
  faixas: [
    { taxa: 4, pedido_minimo_gratis: null, ativo: true },
    { taxa: 6, pedido_minimo_gratis: 60, ativo: true },
  ],
};
const cep = (ini: number, fim: number, over: Record<string, unknown> = {}) => ({
  cep_inicio: ini,
  cep_fim: fim,
  taxa: 5,
  pedido_minimo_gratis: null,
  ativo: true,
  ...over,
});
const CEP_OK = { faixas: [cep(1000000, 1999999), cep(2000000, 2999999, { taxa: 7, pedido_minimo_gratis: 50 })] };
const grupo = (bairros: unknown[], over: Record<string, unknown> = {}) => ({
  bairros,
  taxa: 6,
  pedido_minimo_gratis: null,
  ativo: true,
  ...over,
});
const BAIRRO_OK = { grupos: [grupo(["Centro", "Vila Nova"]), grupo(["Sé"], { taxa: 4 })] };

const PAYLOAD_OK: Record<Forma, unknown> = { raio_km: KM_OK, faixa_cep: CEP_OK, bairro: BAIRRO_OK };

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-a-328@teste.local'), ($2, 'dono-b-328@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
  const lojas = await t.asService((s) =>
    s.query<{ id: string; slug: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values
         ($1, 'loja-a-328', 'Loja A 328', true), ($2, 'loja-b-328', 'Loja B 328', true)
       returning id, slug`,
      [DONO_A, DONO_B],
    ),
  );
  lojaA = lojas.rows.find((l) => l.slug === "loja-a-328")!.id;
  lojaB = lojas.rows.find((l) => l.slug === "loja-b-328")!.id;
}, 60_000);

afterAll(async () => {
  await t?.close();
});

// ═══════════════════════════════════════════════════════════ F1 · versão otimista
describe("[328/F1] versão otimista das zonas de entrega", () => {
  it("[328/F1] coluna versao_zonas_entrega nasce 0 em loja existente e em loja nova; CHECK recusa negativa", async () => {
    // Loja existente antes da migration: `add column ... not null default 0`
    // preenche as linhas antigas com 0. Prova pelo catálogo.
    const col = await t.db.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'lojas' and column_name = 'versao_zonas_entrega'`,
    );
    expect(col.rows).toEqual([{ data_type: "bigint", is_nullable: "NO", column_default: "0" }]);

    // Loja criada pelo beforeAll e loja nova agora: as duas em 0.
    // `lojas_dono_unico`: uma loja por dono — a loja C precisa de um dono próprio.
    const DONO_C = "cccccccc-cccc-4ccc-8ccc-cc0000000328";
    await t.db.query(
      `insert into auth.users (id, email) values ($1, 'dono-c-328@teste.local') on conflict (id) do nothing`,
      [DONO_C],
    );
    const nova = await t.asService((s) =>
      s.query<{ id: string; v: number }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, 'loja-c-328', 'Loja C 328', true)
         returning id, versao_zonas_entrega::int as v`,
        [DONO_C],
      ),
    );
    expect(nova.rows[0].v).toBe(0);
    expect(await versaoDe(lojaB)).toBeGreaterThanOrEqual(0);

    esperarErro(
      await erroDe(
        t.asService((s) =>
          s.query(`update public.lojas set versao_zonas_entrega = -1 where id = $1`, [nova.rows[0].id]),
        ),
      ),
      "23514",
      "lojas_versao_zonas_entrega_nao_negativa",
    );

    // A1: teto em Number.MAX_SAFE_INTEGER — a versão trafega como number no JS.
    const cheque = await t.db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'lojas_versao_zonas_entrega_nao_negativa'`,
    );
    expect(cheque.rows).toHaveLength(1);
    expect(cheque.rows[0].def).toContain("9007199254740991");
    await t.asService((s) =>
      s.query(`update public.lojas set versao_zonas_entrega = 9007199254740991 where id = $1`, [nova.rows[0].id]),
    );
    esperarErro(
      await erroDe(
        t.asService((s) =>
          s.query(`update public.lojas set versao_zonas_entrega = 9007199254740992 where id = $1`, [nova.rows[0].id]),
        ),
      ),
      "23514",
      "lojas_versao_zonas_entrega_nao_negativa",
    );
    await t.asService((s) => s.query(`delete from public.lojas where id = $1`, [nova.rows[0].id]));
  });

  it.each<[Forma]>([["raio_km"], ["faixa_cep"], ["bairro"]])(
    "[328/F1] gravação ok devolve versão + 1 e lojas.versao_zonas_entrega = versão devolvida (%s)",
    async (forma) => {
      await semear(lojaA, MISTA_A);
      const antes = await versaoDe(lojaA);

      const nova = await salvar("donoA", lojaA, antes, forma, PAYLOAD_OK[forma]);

      expect(nova).toBe(antes + 1);
      expect(await versaoDe(lojaA)).toBe(antes + 1);
    },
  );

  it("[328/F1] versão desatualizada ⇒ P0001 'salvar_zonas_entrega: versao desatualizada'; zonas, taxas, bairros e versão da loja intactos", async () => {
    await semear(lojaA, MISTA_A);
    const lida = await versaoDe(lojaA);
    // Outra aba grava no meio: a versão no banco vira lida + 1 e o estado muda.
    await salvar("donoA", lojaA, lida, "bairro", BAIRRO_OK);
    const antes = await estado(lojaA);
    expect(antes.zonas.length).toBeGreaterThan(0);

    for (const forma of ["raio_km", "faixa_cep", "bairro"] as const) {
      esperarErro(
        await erroDe(salvar("donoA", lojaA, lida, forma, PAYLOAD_OK[forma])),
        "P0001",
        `${P}versao desatualizada`,
      );
    }
    // Versão "do futuro" também não casa.
    esperarErro(
      await erroDe(salvar("donoA", lojaA, antes.versao + 7, "raio_km", KM_OK)),
      "P0001",
      `${P}versao desatualizada`,
    );

    expect(await estado(lojaA)).toEqual(antes);
  });

  it("[328/F1] duas gravações com a mesma versão: a 1ª devolve v+1, a 2ª é recusada com 'versao desatualizada' e o estado é o da 1ª", async () => {
    await semear(lojaA, MISTA_A);
    const v = await versaoDe(lojaA);

    const primeira = await salvar("donoA", lojaA, v, "faixa_cep", CEP_OK);
    expect(primeira).toBe(v + 1);
    const depoisDaPrimeira = await estado(lojaA);

    esperarErro(
      await erroDe(salvar("donoA", lojaA, v, "raio_km", KM_OK)),
      "P0001",
      `${P}versao desatualizada`,
    );

    const final = await estado(lojaA);
    expect(final).toEqual(depoisDaPrimeira);
    expect(final.versao).toBe(v + 1);
    expect(semId(final.zonas.filter((z) => z.tipo === "faixa_cep"))).toEqual([
      zonaCep("CEP 01000-000 a 01999-999", 1000000, 1999999, 5, null),
      zonaCep("CEP 02000-000 a 02999-999", 2000000, 2999999, 7, 50),
    ]);
  });

  it("[328/F1] service_role com versão desatualizada também é recusado (admin não atropela o lojista)", async () => {
    await semear(lojaA, MISTA_A);
    const lida = await versaoDe(lojaA);
    await salvar("donoA", lojaA, lida, "raio_km", KM_OK);
    const antes = await estado(lojaA);

    esperarErro(
      await erroDe(salvar("service", lojaA, lida, "bairro", BAIRRO_OK)),
      "P0001",
      `${P}versao desatualizada`,
    );

    expect(await estado(lojaA)).toEqual(antes);
  });

  it("[328/F1] payload inválido com versão certa ⇒ erro de valor e versão NÃO incrementa", async () => {
    await semear(lojaA, MISTA_A);
    const antes = await estado(lojaA);

    esperarErro(
      await erroDe(
        salvar("donoA", lojaA, antes.versao, "faixa_cep", {
          faixas: [cep(1000000, 1999999), cep(3000000, 3999999, { taxa: -1 })],
        }),
      ),
      "P0001",
      `${P}taxa invalida`,
    );

    expect(await estado(lojaA)).toEqual(antes);
  });

  it.each<[string, number | null]>([
    ["null", null],
    ["-1", -1],
  ])("[328/F1] p_versao %s ⇒ 'versao invalida'; nada muda", async (_n, versao) => {
    await semear(lojaA, MISTA_A);
    const antes = await estado(lojaA);

    esperarErro(await erroDe(salvar("donoA", lojaA, versao, "raio_km", KM_OK)), "P0001", `${P}versao invalida`);

    expect(await estado(lojaA)).toEqual(antes);
  });

  it("[328/F1] dono A com p_loja_id de B e a versão CERTA de B ⇒ 'sem posse' (T2 antes de T4); versão e zonas de B intactas", async () => {
    await semear(lojaB, BASE_B);
    const bAntes = await estado(lojaB);

    for (const forma of ["raio_km", "faixa_cep", "bairro"] as const) {
      esperarErro(
        await erroDe(salvar("donoA", lojaB, bAntes.versao, forma, PAYLOAD_OK[forma])),
        "P0001",
        `${P}sem posse`,
      );
    }

    expect(await estado(lojaB)).toEqual(bAntes);
  });

  it("[328/F1] salvar_faixas_entrega(uuid,int,jsonb) continua existindo e executável por authenticated e service_role (expand-only)", async () => {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
      ["public.salvar_faixas_entrega(uuid, integer, jsonb)"],
    );
    expect(r.rows[0]).toEqual({ anon: false, auth: true, svc: true });
  });
});

// ═══════════════ F2 · zonas guardadas: salvar NÃO ativa a forma, não apaga as outras
// Mudança de requisito da 325 (plan/loop-ativar-forma-frete.md D1a, fatia F1):
// salvar zonas (autosave) só grava as zonas de `p_forma` (DELETE ... and
// tipo = p_forma) e sobe a versão; NÃO mexe em `lojas.forma_frete`. Ativar uma
// forma é só por `definir_forma_frete` (tests/migrations/rpc_definir_forma_frete.test.ts).
// Caso do usuário: loja cobra por km (0–5 km R$ 6), lojista salva bairros →
// cliente a 3 km continua pagando R$ 6 até clicar "Usar esta forma".
describe("[325/F1] zonas guardadas: salvar numa forma preserva as outras e NÃO muda a forma ativa", () => {
  async function formaDe(lojaId: string): Promise<string> {
    const r = await t.asService((s) =>
      s.query<{ forma_frete: string }>(`select forma_frete from public.lojas where id = $1`, [lojaId]),
    );
    return r.rows[0].forma_frete;
  }
  async function definirForma(lojaId: string, forma: Forma) {
    await t.asService((s) => s.query(`update public.lojas set forma_frete = $2 where id = $1`, [lojaId, forma]));
  }

  it("[325/F1] salvar bairro em loja raio_km mantém forma_frete = raio_km, preserva km, grava bairro e sobe a versão", async () => {
    await semear(lojaA, [{ nome: "0–5 km", tipo: "raio_km", taxa: 6, raio: 5 }, MISTA_A[1]]);
    await definirForma(lojaA, "raio_km");
    const kmAntes = await zonasDa(lojaA, "raio_km");
    expect(kmAntes).toHaveLength(1);
    const vAntes = await versaoDe(lojaA);

    const nova = await salvarAtual("donoA", lojaA, "bairro", BAIRRO_OK);

    expect(nova).toBe(vAntes + 1);
    expect(await versaoDe(lojaA)).toBe(vAntes + 1);
    // km guardado com os MESMOS ids (não apagado e reinserido), taxa intacta.
    expect(await zonasDa(lojaA, "raio_km")).toEqual(kmAntes);
    // bairro: a zona antiga ("Centro") sai, entram as do payload.
    expect(semId(await zonasDa(lojaA, "bairro"))).toEqual([
      zonaBairro("Centro e mais 1", ["Centro", "Vila Nova"], 6, null),
      zonaBairro("Sé", ["Sé"], 4, null),
    ]);
    // A forma ativa NÃO muda: o cliente a 3 km continua pagando os R$ 6 do km.
    expect(await formaDe(lojaA)).toBe("raio_km");
  });

  it("[325/F1] salvar faixa_cep em loja bairro regrava só as faixas de CEP; km e bairro intactos; forma_frete continua bairro", async () => {
    await semear(lojaA, MISTA_A);
    await definirForma(lojaA, "bairro");
    const kmAntes = await zonasDa(lojaA, "raio_km");
    const bairroAntes = await zonasDa(lojaA, "bairro");

    await salvarAtual("donoA", lojaA, "faixa_cep", CEP_OK);

    expect(await zonasDa(lojaA, "raio_km")).toEqual(kmAntes);
    expect(await zonasDa(lojaA, "bairro")).toEqual(bairroAntes);
    expect(semId(await zonasDa(lojaA, "faixa_cep"))).toEqual([
      zonaCep("CEP 01000-000 a 01999-999", 1000000, 1999999, 5, null),
      zonaCep("CEP 02000-000 a 02999-999", 2000000, 2999999, 7, 50),
    ]);
    expect(await formaDe(lojaA)).toBe("bairro");
  });

  it("[325/F1] salvar raio_km em loja faixa_cep (via serviço) também não muda forma_frete", async () => {
    await semear(lojaA, MISTA_A);
    await definirForma(lojaA, "faixa_cep");

    await salvarAtual("service", lojaA, "raio_km", KM_OK);

    expect(semId(await zonasDa(lojaA, "raio_km"))).toEqual([faixaKm("0–1 km", 1, 4, null), faixaKm("1–2 km", 2, 6, 60)]);
    expect(await formaDe(lojaA)).toBe("faixa_cep");
  });

  it("[325/F1] não toca zonas de outra loja (nem a forma_frete dela); a forma de A também fica onde estava", async () => {
    await semear(lojaA, MISTA_A);
    await semear(lojaB, BASE_B);
    await definirForma(lojaA, "bairro");
    await definirForma(lojaB, "raio_km");
    const bAntes = await estado(lojaB);

    for (const forma of ["bairro", "faixa_cep", "raio_km"] as const) {
      await salvarAtual("donoA", lojaA, forma, PAYLOAD_OK[forma]);
      await salvarAtual("service", lojaA, forma, PAYLOAD_OK[forma]);
    }

    expect(await estado(lojaB)).toEqual(bAntes);
    expect(await formaDe(lojaB)).toBe("raio_km");
    expect(await formaDe(lojaA)).toBe("bairro");
  });

  it("[325/F1] versão velha → 'versao desatualizada' e forma_frete inalterada", async () => {
    await semear(lojaA, MISTA_A);
    await definirForma(lojaA, "raio_km");
    const lida = await versaoDe(lojaA);
    await salvar("donoA", lojaA, lida, "raio_km", KM_OK); // outra aba grava antes
    const antes = await estado(lojaA);

    for (const forma of ["bairro", "faixa_cep"] as const) {
      esperarErro(
        await erroDe(salvar("donoA", lojaA, lida, forma, PAYLOAD_OK[forma])),
        "P0001",
        `${P}versao desatualizada`,
      );
      expect(await formaDe(lojaA)).toBe("raio_km");
    }
    expect(await estado(lojaA)).toEqual(antes);
  });

  it("[325/F1] sem posse → 'sem posse' e forma_frete inalterada", async () => {
    await semear(lojaB, BASE_B);
    await definirForma(lojaB, "bairro");
    const bAntes = await estado(lojaB);

    for (const forma of ["raio_km", "faixa_cep"] as const) {
      esperarErro(
        await erroDe(salvar("donoA", lojaB, bAntes.versao, forma, PAYLOAD_OK[forma])),
        "P0001",
        `${P}sem posse`,
      );
      expect(await formaDe(lojaB)).toBe("bairro");
    }
    expect(await estado(lojaB)).toEqual(bAntes);
  });

  it("[325/F1] payload inválido (T3) → forma_frete inalterada", async () => {
    await semear(lojaA, MISTA_A);
    await definirForma(lojaA, "raio_km");

    esperarErro(
      await erroDe(salvarAtual("donoA", lojaA, "bairro", { grupos: [grupo(["Centro"]), grupo([])] })),
      "P0001",
      `${P}grupo sem bairro`,
    );
    expect(await formaDe(lojaA)).toBe("raio_km");
  });
  // "voltar para raio_km reativa" saiu daqui: voltar é `definir_forma_frete`
  // sem regravar zonas (rpc_definir_forma_frete.test.ts).
});

// ═════════════════════════════════════════════════ F2 · o que é gravado por forma
describe("[325/F2] gravação por forma: servidor deriva nome, tipo e loja", () => {
  it("[325/F2] faixa_cep grava cep_inicio/cep_fim inteiros, taxa, grátis e ativo; nome 'CEP 01000-000 a 01999-999'; raio_max_km null; tipo e loja_id do payload ignorados", async () => {
    await semear(lojaA, MISTA_A);
    await semear(lojaB, BASE_B);
    const bAntes = await estado(lojaB);

    await salvarAtual("donoA", lojaA, "faixa_cep", {
      tipo: "bairro",
      loja_id: lojaB,
      faixas: [
        // Fora de ordem de propósito: a RPC grava em ordem de cep_inicio.
        cep(2000000, 2999999, { taxa: 7.5, pedido_minimo_gratis: 80, ativo: false, tipo: "raio_km", nome: "Grátis" }),
        cep(1000000, 1999999, { taxa: 5, loja_id: lojaB, raio_max_km: 99 }),
      ],
    });

    expect(semId(await zonasDa(lojaA, "faixa_cep"))).toEqual([
      zonaCep("CEP 01000-000 a 01999-999", 1000000, 1999999, 5, null, true),
      zonaCep("CEP 02000-000 a 02999-999", 2000000, 2999999, 7.5, 80, false),
    ]);
    expect(await estado(lojaB)).toEqual(bAntes);
  });

  it("[325/F2] bairro grava uma zona por grupo, bairros_zona com nomes aparados e espaço colapsado, nome derivado 'Centro e mais 1'", async () => {
    await semear(lojaA, MISTA_A);

    await salvarAtual("donoA", lojaA, "bairro", {
      grupos: [
        grupo(["  Centro ", "Vila   Nova"], { taxa: 6, pedido_minimo_gratis: 80, nome: "x", tipo: "raio_km" }),
        grupo(["Sé"], { taxa: 4, ativo: false }),
      ],
    });

    expect(semId(await zonasDa(lojaA, "bairro"))).toEqual([
      zonaBairro("Centro e mais 1", ["Centro", "Vila Nova"], 6, 80, true),
      zonaBairro("Sé", ["Sé"], 4, null, false),
    ]);
  });
});

// ═══════════════════════════════════════ F2 · recusas de valor (T3) e de forma (T1)
describe("[325/F2] valor inválido ⇒ P0001 + mensagem; estado anterior intacto (versão inclusa)", () => {
  async function recusa(forma: string, dados: unknown, fragmento: string) {
    await semear(lojaA, MISTA_A);
    const antes = await estado(lojaA);
    expect(antes.zonas).toHaveLength(3); // estado conhecido e não vazio

    esperarErro(await erroDe(salvar("donoA", lojaA, antes.versao, forma, dados)), "P0001", `${P}${fragmento}`);

    expect(await estado(lojaA)).toEqual(antes);
  }

  // Item inválido DEPOIS de um válido: apagar+inserir antes de validar deixaria rastro.
  it.each<[string, Record<string, unknown>]>([
    ["cep_inicio com 9 dígitos (123456789)", { cep_inicio: 123456789 }],
    ["cep_fim com 9 dígitos (123456789)", { cep_fim: 123456789 }],
    ["cep_inicio fracionário (1.5)", { cep_inicio: 1.5 }],
    ["cep_inicio string ('01000000')", { cep_inicio: "01000000" }],
    ["cep_fim null", { cep_fim: null }],
    ["cep_inicio ausente", { cep_inicio: undefined }],
    ["cep_inicio negativo", { cep_inicio: -1 }],
  ])("[325/F2] CEP inválido — %s ⇒ 'cep invalido'; estado anterior intacto", async (_n, over) => {
    await recusa("faixa_cep", { faixas: [cep(1000000, 1999999), cep(3000000, 3999999, over)] }, "cep invalido");
  });

  it("[325/F2] início > fim ⇒ 'faixa de cep invertida'; estado anterior intacto", async () => {
    await recusa("faixa_cep", { faixas: [cep(1000000, 1999999), cep(3999999, 3000000)] }, "faixa de cep invertida");
  });

  it.each<[string, unknown[]]>([
    ["01000000–01999999 e 01500000–02000000", [cep(1000000, 1999999), cep(1500000, 2000000)]],
    ["fim de uma = início da outra (01999999)", [cep(1000000, 1999999), cep(1999999, 2500000)]],
    ["sobreposição fora de ordem (a de cima cruza a de baixo)", [cep(1500000, 2000000), cep(1000000, 1999999)]],
    ["sobreposta DESLIGADA também conta (pode voltar)", [cep(1000000, 1999999), cep(1500000, 2000000, { ativo: false })]],
    ["uma contida na outra", [cep(1000000, 3000000), cep(1500000, 1600000)]],
  ])("[325/F2] faixas sobrepostas — %s ⇒ 'faixas de cep sobrepostas'", async (_n, faixas) => {
    await recusa("faixa_cep", { faixas }, "faixas de cep sobrepostas");
  });

  it("[325/F2] faixas ENCOSTADAS (…01999999 / 02000000…) são aceitas", async () => {
    await semear(lojaA, MISTA_A);
    await salvarAtual("donoA", lojaA, "faixa_cep", { faixas: [cep(1000000, 1999999), cep(2000000, 2000000)] });

    expect(semId(await zonasDa(lojaA, "faixa_cep"))).toEqual([
      zonaCep("CEP 01000-000 a 01999-999", 1000000, 1999999, 5, null),
      zonaCep("CEP 02000-000 a 02000-000", 2000000, 2000000, 5, null),
    ]);
  });

  it.each<[string, unknown[]]>([
    ["mesmo grupo: 'Centro' e ' cêntro '", [grupo(["Centro", " cêntro "])]],
    ["grupos diferentes: 'Centro' e ' cêntro '", [grupo(["Centro"]), grupo([" cêntro "], { taxa: 4 })]],
    ["grupos diferentes: 'Jardim São José' e 'jardim   sao jose'", [grupo(["Jardim São José"]), grupo(["jardim   sao jose"])]],
    // A4: `btrim` só apara ' '; o tab tem de virar espaço ANTES, como no `trim()` de `normalizarBairro`.
    ["grupos diferentes: 'Centro\\t' e 'Centro'", [grupo(["Centro\t"]), grupo(["Centro"], { taxa: 4 })]],
  ])("[325/F2] bairro repetido normalizado — %s ⇒ 'bairro repetido'; estado anterior intacto", async (_n, grupos) => {
    await recusa("bairro", { grupos }, "bairro repetido");
  });

  it.each<[string, unknown]>([
    ["vazio ''", ""],
    ["só espaço '   '", "   "],
    ["não-string 123", 123],
    ["null", null],
    ["121 caracteres", "B".repeat(121)],
  ])("[325/F2] bairro %s ⇒ 'bairro invalido'", async (_n, bairro) => {
    await recusa("bairro", { grupos: [grupo(["Centro"]), grupo(["Sé", bairro])] }, "bairro invalido");
  });

  it("[325/F2] grupo com bairros [] ⇒ 'grupo sem bairro'", async () => {
    await recusa("bairro", { grupos: [grupo(["Centro"]), grupo([])] }, "grupo sem bairro");
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["taxa 4.555", { taxa: 4.555 }, "taxa invalida"],
    ["taxa -1", { taxa: -1 }, "taxa invalida"],
    ["taxa '5' (string)", { taxa: "5" }, "taxa invalida"],
    ["taxa ausente", { taxa: undefined }, "taxa invalida"],
    ["grátis 4.555", { pedido_minimo_gratis: 4.555 }, "gratis invalido"],
    ["grátis -1", { pedido_minimo_gratis: -1 }, "gratis invalido"],
    ["ativo 'true'", { ativo: "true" }, "ativo invalido"],
    ["ativo ausente", { ativo: undefined }, "ativo invalido"],
  ])("[325/F2] %s ⇒ mensagem do contrato em faixa_cep E em bairro", async (_n, over, fragmento) => {
    await recusa("faixa_cep", { faixas: [cep(1000000, 1999999), cep(3000000, 3999999, over)] }, fragmento);
    await recusa("bairro", { grupos: [grupo(["Centro"]), grupo(["Sé"], over)] }, fragmento);
  });

  const cepsSemCruzar = (n: number) =>
    Array.from({ length: n }, (_v, i) => cep(1000000 + i * 100000, 1000000 + i * 100000 + 99999));
  const gruposUnicos = (n: number, porGrupo = 1) =>
    Array.from({ length: n }, (_v, g) => grupo(Array.from({ length: porGrupo }, (_w, b) => `Bairro ${g}-${b}`)));

  it.each<[string, Forma, unknown]>([
    ["51 faixas de CEP", "faixa_cep", { faixas: cepsSemCruzar(51) }],
    ["31 grupos", "bairro", { grupos: gruposUnicos(31) }],
    ["grupo com 101 bairros", "bairro", { grupos: gruposUnicos(1, 101) }],
    ["301 bairros no total (100+100+100+1)", "bairro", { grupos: [...gruposUnicos(3, 100), grupo(["Último"])] }],
    [
      "31 faixas de km",
      "raio_km",
      { incremento: 1, faixas: Array.from({ length: 31 }, () => ({ taxa: 5, pedido_minimo_gratis: null, ativo: true })) },
    ],
  ])("[325/F2] teto — %s ⇒ 'lista acima do teto'", async (_n, forma, dados) => {
    await recusa(forma, dados, "lista acima do teto");
  });

  it.each<[string, Forma, unknown, number]>([
    ["50 faixas de CEP", "faixa_cep", { faixas: cepsSemCruzar(50) }, 50],
    ["30 grupos", "bairro", { grupos: gruposUnicos(30) }, 30],
    ["300 bairros no total (3 × 100)", "bairro", { grupos: gruposUnicos(3, 100) }, 3],
  ])("[325/F2] teto — %s ⇒ aceito", async (_n, forma, dados, zonas) => {
    await semear(lojaA, MISTA_A);
    await salvarAtual("donoA", lojaA, forma, dados);
    expect(await zonasDa(lojaA, forma)).toHaveLength(zonas);
  });

  it.each<[string, string, unknown, string]>([
    ["p_forma 'cidade'", "cidade", { faixas: [] }, "forma invalida"],
    ["p_forma ''", "", { faixas: [] }, "forma invalida"],
    ["p_dados array", "faixa_cep", [cep(1000000, 1999999)], "dados invalidos"],
    ["p_dados null", "bairro", undefined, "dados invalidos"],
    ["faixa_cep sem `faixas`", "faixa_cep", { grupos: [] }, "faixas invalidas"],
    ["bairro com `grupos` objeto", "bairro", { grupos: grupo(["Centro"]) }, "grupos invalidos"],
    ["raio_km incremento 3", "raio_km", { incremento: 3, faixas: [] }, "incremento invalido"],
    [
      "raio_km ativa depois de desligada",
      "raio_km",
      {
        incremento: 1,
        faixas: [
          { taxa: 4, pedido_minimo_gratis: null, ativo: false },
          { taxa: 6, pedido_minimo_gratis: null, ativo: true },
        ],
      },
      "faixa ativa depois de desligada",
    ],
  ])("[325/F2] %s ⇒ mensagem do contrato", async (_n, forma, dados, fragmento) => {
    await recusa(forma, dados, fragmento);
  });
});

// ═════════════════════════════════════════════ F2 · escopo por loja e autoridade
describe("[325/F2] escopo por loja e autoridade (T2 antes de qualquer linha)", () => {
  it.each<[Forma, unknown]>([
    ["raio_km", { incremento: 1, faixas: [] }],
    ["faixa_cep", { faixas: [] }],
    ["bairro", { grupos: [] }],
  ])("[325/F2] p_loja_id alheio com lista vazia (%s) ⇒ 'sem posse'; zonas da outra loja intactas", async (forma, dados) => {
    await semear(lojaB, BASE_B);
    const bAntes = await estado(lojaB);

    esperarErro(await erroDe(salvar("donoA", lojaB, bAntes.versao, forma, dados)), "P0001", `${P}sem posse`);

    expect(await estado(lojaB)).toEqual(bAntes);
  });

  it("[325/F2] sessão 'authenticated' com claim role FORJADO 'service_role' ⇒ 'sem posse'; B intacta", async () => {
    await semear(lojaB, BASE_B);
    const bAntes = await estado(lojaB);

    const erro = await erroDe(
      (async () => {
        await t.db.exec("begin");
        try {
          await t.db.query("set local role authenticated");
          await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: DONO_A, role: "service_role" }),
          ]);
          await t.db.query(`select public.salvar_zonas_entrega($1::uuid, $2::bigint, 'faixa_cep', $3::jsonb)`, [
            lojaB,
            bAntes.versao,
            JSON.stringify(CEP_OK),
          ]);
          await t.db.exec("commit");
        } catch (e) {
          await t.db.exec("rollback");
          throw e;
        }
      })(),
    );
    esperarErro(erro, "P0001", `${P}sem posse`);

    expect(await estado(lojaB)).toEqual(bAntes);
  });

  it("[325/F2] anon ⇒ 42501 nomeando salvar_zonas_entrega; A intacta", async () => {
    await semear(lojaA, MISTA_A);
    const aAntes = await estado(lojaA);

    esperarErro(await erroDe(salvar("anon", lojaA, aAntes.versao, "faixa_cep", CEP_OK)), "42501", "salvar_zonas_entrega");

    expect(await estado(lojaA)).toEqual(aAntes);
  });

  it("[325/F2] service_role com p_loja_id A ⇒ só A muda; B intacta (filtro vale sem RLS)", async () => {
    await semear(lojaA, MISTA_A);
    await semear(lojaB, BASE_B);
    const bAntes = await estado(lojaB);

    await salvarAtual("service", lojaA, "bairro", BAIRRO_OK);

    expect(semId(await zonasDa(lojaA, "bairro"))).toEqual([
      zonaBairro("Centro e mais 1", ["Centro", "Vila Nova"], 6, null),
      zonaBairro("Sé", ["Sé"], 4, null),
    ]);
    expect(await estado(lojaB)).toEqual(bAntes);
  });
});

// ═══════════════════════════════════════════════════════════════ catálogo
describe("[325/F2] catálogo da função", () => {
  const ASSINATURA = "public.salvar_zonas_entrega(uuid, bigint, text, jsonb)";

  it("[325/F2] catálogo: SECURITY INVOKER, search_path fixado", async () => {
    const r = await t.db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where oid = $1::regprocedure`,
      [ASSINATURA],
    );
    expect(r.rows[0].prosecdef).toBe(false);
    expect((r.rows[0].proconfig ?? []).some((x) => x.startsWith("search_path="))).toBe(true);
  });

  it("[325/F2] catálogo: EXECUTE só authenticated e service_role", async () => {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('public', $1, 'EXECUTE') as publico,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
      [ASSINATURA],
    );
    expect(r.rows[0]).toEqual({ anon: false, publico: false, auth: true, svc: true });
  });
});
