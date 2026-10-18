import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 325 — ativação EXPLÍCITA da forma de frete
 * (plan/loop-ativar-forma-frete.md D1b, fatia F2). Prova de BANCO da RPC
 *
 *   public.definir_forma_frete(p_loja_id uuid, p_forma text, p_versao bigint)
 *     returns bigint  -- a versão NOVA (p_versao + 1)
 *
 * criada pela migration futura `20261018140000_definir_forma_frete.sql`
 * (`createTestDb` aplica todas as migrations de supabase/migrations/).
 *
 * Ordem do contrato: T1 forma no enum → versão null/<0 → T2 posse (via de
 * serviço fail-closed OU dono_id = auth.uid()) → T4 UPDATE compare-and-set
 * (versão + 1, forma_frete = p_forma) → exige zona ativa do tipo p_forma COM
 * linha em taxas_entrega (senão raise, que desfaz o UPDATE).
 *
 * CONTRATO DE MENSAGENS (P0001, prefixo 'definir_forma_frete: '):
 *   forma invalida · versao invalida · sem posse · versao desatualizada ·
 *   forma sem zona ativa
 *
 * RED esperado: a função ainda não existe ⇒ 42883 ("function ... does not
 * exist") nas chamadas e erro de regprocedure no catálogo.
 *
 * Anti-falso-verde (memória do projeto: SQLSTATE sozinho não basta): toda
 * recusa afirma SQLSTATE **e** fragmento da mensagem; "nada muda" relê
 * forma_frete, versao_zonas_entrega e as zonas (com ids) num bloco asService.
 *
 * Fora daqui (já coberto, não duplicar): `salvar_faixas_entrega` continua
 * forçando raio_km (lojas_forma_frete_ativa.test.ts); salvar zonas não muda a
 * forma (rpc_salvar_zonas_entrega.test.ts [325/F1]).
 */

const DONO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aa0000000325";
const DONO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bb0000000325";

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
const P = "definir_forma_frete: ";

type Papel = "donoA" | "donoB" | "service" | "anon";
function como<T>(papel: Papel, fn: Parameters<TestDb["asService"]>[0]): Promise<T> {
  if (papel === "donoA") return t.asUser(DONO_A, fn) as Promise<T>;
  if (papel === "donoB") return t.asUser(DONO_B, fn) as Promise<T>;
  if (papel === "anon") return t.asAnon(fn) as Promise<T>;
  return t.asService(fn) as Promise<T>;
}

type Forma = "raio_km" | "faixa_cep" | "bairro";

/** Chama a RPC nova com argumentos crus. Devolve a versão nova (como number). */
async function definir(papel: Papel, lojaId: string, forma: string | null, versao: number | null): Promise<number> {
  const r = await como<{ rows: Array<{ v: number }> }>(papel, (s) =>
    s.query<{ v: number }>(`select public.definir_forma_frete($1::uuid, $2::text, $3::bigint)::int as v`, [
      lojaId,
      forma,
      versao,
    ]),
  );
  return r.rows[0].v;
}

/** RPC de gravação (salvar NÃO ativa — F1). */
async function salvarZonas(papel: Papel, lojaId: string, versao: number, forma: Forma, dados: unknown): Promise<number> {
  const r = await como<{ rows: Array<{ v: number }> }>(papel, (s) =>
    s.query<{ v: number }>(
      `select public.salvar_zonas_entrega($1::uuid, $2::bigint, $3::text, $4::jsonb)::int as v`,
      [lojaId, versao, forma, JSON.stringify(dados)],
    ),
  );
  return r.rows[0].v;
}

async function lojaDe(lojaId: string): Promise<{ forma: string; versao: number }> {
  const r = await t.asService((s) =>
    s.query<{ forma: string; versao: number }>(
      `select forma_frete as forma, versao_zonas_entrega::int as versao from public.lojas where id = $1`,
      [lojaId],
    ),
  );
  return r.rows[0];
}

type ZonaLida = { id: string; tipo: string; ativo: boolean; taxa: number | null };
async function zonasDa(lojaId: string, tipo?: Forma): Promise<ZonaLida[]> {
  const r = await t.asService((s) =>
    s.query<ZonaLida>(
      `select z.id, z.tipo, z.ativo, t.taxa
         from public.zonas_entrega z
         left join public.taxas_entrega t on t.zona_id = z.id
        where z.loja_id = $1 and ($2::text is null or z.tipo = $2::text)
        order by z.tipo, z.id`,
      [lojaId, tipo ?? null],
    ),
  );
  return r.rows;
}

/** Zonas que COBRAM hoje: só as da forma ativa (filtro de `listarZonasComTaxas`). */
async function taxasQueCobram(lojaId: string): Promise<number[]> {
  const r = await t.asService((s) =>
    s.query<{ taxa: number }>(
      `select t.taxa from public.zonas_entrega z
         join public.taxas_entrega t on t.zona_id = z.id
         join public.lojas l on l.id = z.loja_id
        where z.loja_id = $1 and z.ativo and z.tipo = l.forma_frete
        order by t.taxa`,
      [lojaId],
    ),
  );
  return r.rows.map((x) => Number(x.taxa));
}

async function contagemPorTipo(lojaId: string): Promise<Record<string, number>> {
  const r = await t.asService((s) =>
    s.query<{ tipo: string; n: number }>(
      `select tipo, count(*)::int as n from public.zonas_entrega where loja_id = $1 group by tipo order by tipo`,
      [lojaId],
    ),
  );
  return Object.fromEntries(r.rows.map((x) => [x.tipo, x.n]));
}

async function estado(lojaId: string) {
  return { loja: await lojaDe(lojaId), zonas: await zonasDa(lojaId) };
}

type ZonaSemente = {
  nome: string;
  tipo: Forma;
  ativo?: boolean;
  taxa?: number | null; // null = zona SEM linha em taxas_entrega
  raio?: number | null;
  cep?: [number, number] | null;
  bairros?: string[];
};

/** Substitui (como postgres) as zonas da loja e fixa a forma ativa. Não mexe na versão. */
async function semear(lojaId: string, forma: Forma, zonas: ZonaSemente[]) {
  await t.asService(async (s) => {
    await s.query(`delete from public.zonas_entrega where loja_id = $1`, [lojaId]);
    await s.query(`update public.lojas set forma_frete = $2 where id = $1`, [lojaId, forma]);
    for (const z of zonas) {
      const zr = await s.query<{ id: string }>(
        `insert into public.zonas_entrega (loja_id, nome, tipo, ativo) values ($1, $2, $3, $4) returning id`,
        [lojaId, z.nome, z.tipo, z.ativo ?? true],
      );
      const zonaId = zr.rows[0].id;
      if (z.taxa !== null) {
        await s.query(
          `insert into public.taxas_entrega (zona_id, taxa, pedido_minimo_gratis, raio_max_km, cep_inicio, cep_fim)
           values ($1, $2, null, $3, $4, $5)`,
          [zonaId, z.taxa ?? 5, z.raio ?? null, z.cep?.[0] ?? null, z.cep?.[1] ?? null],
        );
      }
      for (const b of z.bairros ?? []) {
        await s.query(`insert into public.bairros_zona (zona_id, nome) values ($1, $2)`, [zonaId, b]);
      }
    }
  });
}

const KM_0_5: ZonaSemente = { nome: "0–5 km", tipo: "raio_km", taxa: 6, raio: 5 };
const BAIRRO_CENTRO: ZonaSemente = { nome: "Centro", tipo: "bairro", taxa: 8, bairros: ["Centro"] };
const CEP_09: ZonaSemente = { nome: "CEP 09000", tipo: "faixa_cep", taxa: 9, cep: [9000000, 9099999] };

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-a-325f@teste.local'), ($2, 'dono-b-325f@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
  const lojas = await t.asService((s) =>
    s.query<{ id: string; slug: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values
         ($1, 'loja-a-325f', 'Loja A 325f', true), ($2, 'loja-b-325f', 'Loja B 325f', true)
       returning id, slug`,
      [DONO_A, DONO_B],
    ),
  );
  lojaA = lojas.rows.find((l) => l.slug === "loja-a-325f")!.id;
  lojaB = lojas.rows.find((l) => l.slug === "loja-b-325f")!.id;
}, 60_000);

afterAll(async () => {
  await t?.close();
});

// ═══════════════════════════════════════════════════════════════ ativação
describe("[325/F2] definir_forma_frete — ativa a forma e sobe a versão", () => {
  it("[325/F2] dono ativa 'bairro' com grupo ativo com taxa ⇒ devolve versão + 1, forma_frete = bairro, zonas de km intactas", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const antes = await lojaDe(lojaA);
    const kmAntes = await zonasDa(lojaA, "raio_km");
    const bairroAntes = await zonasDa(lojaA, "bairro");

    const nova = await definir("donoA", lojaA, "bairro", antes.versao);

    expect(nova).toBe(antes.versao + 1);
    expect(await lojaDe(lojaA)).toEqual({ forma: "bairro", versao: antes.versao + 1 });
    expect(await contagemPorTipo(lojaA)).toEqual({ bairro: 1, raio_km: 1 });
    // Ativar não regrava zona nenhuma: mesmos ids.
    expect(await zonasDa(lojaA, "raio_km")).toEqual(kmAntes);
    expect(await zonasDa(lojaA, "bairro")).toEqual(bairroAntes);
  });

  it("[325/F2] caso do usuário: loja raio_km (0–5 km R$ 6) salva bairros ⇒ continua cobrando R$ 6 até definir_forma_frete('bairro')", async () => {
    await semear(lojaA, "raio_km", [KM_0_5]);
    const v0 = (await lojaDe(lojaA)).versao;

    const v1 = await salvarZonas("donoA", lojaA, v0, "bairro", {
      grupos: [{ bairros: ["Centro", "Vila Nova"], taxa: 4, pedido_minimo_gratis: null, ativo: true }],
    });

    // Salvar NÃO ativou: o cliente a 3 km ainda paga os R$ 6 do km.
    expect(await lojaDe(lojaA)).toEqual({ forma: "raio_km", versao: v1 });
    expect(await taxasQueCobram(lojaA)).toEqual([6]);

    const v2 = await definir("donoA", lojaA, "bairro", v1);

    expect(v2).toBe(v1 + 1);
    expect(await lojaDe(lojaA)).toEqual({ forma: "bairro", versao: v1 + 1 });
    expect(await taxasQueCobram(lojaA)).toEqual([4]);
  });

  it("[325/F2] voltar a raio_km sem regravar zonas: definir('raio_km') com a versão nova ⇒ forma raio_km, faixas km com os MESMOS ids", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const kmGuardado = await zonasDa(lojaA, "raio_km");
    const bairroGuardado = await zonasDa(lojaA, "bairro");
    const v0 = (await lojaDe(lojaA)).versao;

    const v1 = await definir("donoA", lojaA, "bairro", v0);
    const v2 = await definir("donoA", lojaA, "raio_km", v1);

    expect(v2).toBe(v0 + 2);
    expect(await lojaDe(lojaA)).toEqual({ forma: "raio_km", versao: v0 + 2 });
    expect(await zonasDa(lojaA, "raio_km")).toEqual(kmGuardado);
    expect(await zonasDa(lojaA, "bairro")).toEqual(bairroGuardado);
    expect(await taxasQueCobram(lojaA)).toEqual([6]);
  });

  it("[325/F2] via de serviço (asService) ativa normalmente na loja do p_loja_id; a outra loja fica intacta", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, CEP_09]);
    await semear(lojaB, "raio_km", [KM_0_5, CEP_09]);
    const antes = await lojaDe(lojaA);
    const bAntes = await estado(lojaB);

    const nova = await definir("service", lojaA, "faixa_cep", antes.versao);

    expect(nova).toBe(antes.versao + 1);
    expect(await lojaDe(lojaA)).toEqual({ forma: "faixa_cep", versao: antes.versao + 1 });
    expect(await estado(lojaB)).toEqual(bAntes);
  });
});

// ═══════════════════════════════════════════ forma sem zona que cobra
describe("[325/F2] definir_forma_frete — forma sem zona ativa com taxa é recusada; nada muda", () => {
  it.each<[string, ZonaSemente[]]>([
    ["sem nenhuma zona de faixa_cep", [KM_0_5, BAIRRO_CENTRO]],
    ["só zona de faixa_cep INATIVA (ativo=false)", [KM_0_5, { ...CEP_09, ativo: false }]],
    ["zona de faixa_cep ativa SEM linha em taxas_entrega", [KM_0_5, { ...CEP_09, taxa: null }]],
  ])("[325/F2] %s ⇒ P0001 'definir_forma_frete: forma sem zona ativa'; forma_frete e versao_zonas_entrega inalteradas", async (_n, zonas) => {
    await semear(lojaA, "raio_km", zonas);
    const antes = await estado(lojaA);

    esperarErro(
      await erroDe(definir("donoA", lojaA, "faixa_cep", antes.loja.versao)),
      "P0001",
      `${P}forma sem zona ativa`,
    );

    expect(await estado(lojaA)).toEqual(antes);
    expect(antes.loja.forma).toBe("raio_km");
  });

  it("[325/F2] via de serviço também é recusada em forma sem zona (admin não ativa forma vazia)", async () => {
    await semear(lojaA, "raio_km", [KM_0_5]);
    const antes = await estado(lojaA);

    esperarErro(await erroDe(definir("service", lojaA, "bairro", antes.loja.versao)), "P0001", `${P}forma sem zona ativa`);

    expect(await estado(lojaA)).toEqual(antes);
  });
});

// ═══════════════════════════════════════════════════════════════ versão
describe("[325/F2] definir_forma_frete — trava de versão otimista", () => {
  it("[325/F2] versão velha (outra aba salvou antes) ⇒ 'versao desatualizada'; forma e versão inalteradas", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const lida = (await lojaDe(lojaA)).versao;
    await salvarZonas("donoA", lojaA, lida, "faixa_cep", {
      faixas: [{ cep_inicio: 1000000, cep_fim: 1999999, taxa: 5, pedido_minimo_gratis: null, ativo: true }],
    });
    const antes = await estado(lojaA);
    expect(antes.loja.versao).toBe(lida + 1);

    esperarErro(await erroDe(definir("donoA", lojaA, "bairro", lida)), "P0001", `${P}versao desatualizada`);
    // Versão "do futuro" também não casa.
    esperarErro(
      await erroDe(definir("donoA", lojaA, "bairro", antes.loja.versao + 5)),
      "P0001",
      `${P}versao desatualizada`,
    );

    expect(await estado(lojaA)).toEqual(antes);
  });

  it("[325/F2] via de serviço com versão velha também é recusada (admin não atropela o lojista)", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const lida = (await lojaDe(lojaA)).versao;
    await definir("donoA", lojaA, "bairro", lida);
    const antes = await estado(lojaA);

    esperarErro(await erroDe(definir("service", lojaA, "raio_km", lida)), "P0001", `${P}versao desatualizada`);

    expect(await estado(lojaA)).toEqual(antes);
  });

  it("[325/F2] duas ativações com a mesma versão: a 1ª vale, a 2ª é recusada e o estado é o da 1ª", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO, CEP_09]);
    const v = (await lojaDe(lojaA)).versao;

    expect(await definir("donoA", lojaA, "bairro", v)).toBe(v + 1);
    esperarErro(await erroDe(definir("donoA", lojaA, "faixa_cep", v)), "P0001", `${P}versao desatualizada`);

    expect(await lojaDe(lojaA)).toEqual({ forma: "bairro", versao: v + 1 });
  });
});

// ═══════════════════════════════════════════════════════════ posse
describe("[325/F2] definir_forma_frete — autoridade (T2 antes de tocar a loja)", () => {
  it("[325/F2] dono B com p_loja_id de A e a versão CERTA de A ⇒ 'sem posse'; nada muda em A", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const aAntes = await estado(lojaA);

    esperarErro(await erroDe(definir("donoB", lojaA, "bairro", aAntes.loja.versao)), "P0001", `${P}sem posse`);

    expect(await estado(lojaA)).toEqual(aAntes);
  });

  it("[325/F2] dono B com p_loja_id de A e versão ERRADA ⇒ 'sem posse' (não descobre se a versão bate)", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const aAntes = await estado(lojaA);

    esperarErro(await erroDe(definir("donoB", lojaA, "bairro", aAntes.loja.versao + 9)), "P0001", `${P}sem posse`);

    expect(await estado(lojaA)).toEqual(aAntes);
  });

  it("[325/F2] sessão 'authenticated' com claim role FORJADO 'service_role' ⇒ 'sem posse'; A intacta", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const aAntes = await estado(lojaA);

    const erro = await erroDe(
      (async () => {
        await t.db.exec("begin");
        try {
          await t.db.query("set local role authenticated");
          await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: DONO_B, role: "service_role" }),
          ]);
          await t.db.query(`select public.definir_forma_frete($1::uuid, 'bairro'::text, $2::bigint)`, [
            lojaA,
            aAntes.loja.versao,
          ]);
          await t.db.exec("commit");
        } catch (e) {
          await t.db.exec("rollback");
          throw e;
        }
      })(),
    );
    esperarErro(erro, "P0001", `${P}sem posse`);

    expect(await estado(lojaA)).toEqual(aAntes);
  });

  it("[325/F2] anon ⇒ 42501 nomeando definir_forma_frete; A intacta", async () => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const aAntes = await estado(lojaA);

    esperarErro(await erroDe(definir("anon", lojaA, "bairro", aAntes.loja.versao)), "42501", "definir_forma_frete");

    expect(await estado(lojaA)).toEqual(aAntes);
  });
});

// ═══════════════════════════════════════════════════ argumentos inválidos
describe("[325/F2] definir_forma_frete — argumentos inválidos (T1)", () => {
  it.each<[string, string | null]>([
    ["'cidade'", "cidade"],
    ["''", ""],
    ["null", null],
    ["'RAIO_KM' (caixa)", "RAIO_KM"],
  ])("[325/F2] p_forma %s ⇒ 'forma invalida'; nada muda", async (_n, forma) => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const antes = await estado(lojaA);

    esperarErro(await erroDe(definir("donoA", lojaA, forma, antes.loja.versao)), "P0001", `${P}forma invalida`);

    expect(await estado(lojaA)).toEqual(antes);
  });

  it.each<[string, number | null]>([
    ["null", null],
    ["-1", -1],
  ])("[325/F2] p_versao %s ⇒ 'versao invalida'; nada muda", async (_n, versao) => {
    await semear(lojaA, "raio_km", [KM_0_5, BAIRRO_CENTRO]);
    const antes = await estado(lojaA);

    esperarErro(await erroDe(definir("donoA", lojaA, "bairro", versao)), "P0001", `${P}versao invalida`);

    expect(await estado(lojaA)).toEqual(antes);
  });
});

// ═══════════════════════════════════════════════════════════════ catálogo
describe("[325/F2] definir_forma_frete — catálogo", () => {
  const ASSINATURA = "public.definir_forma_frete(uuid, text, bigint)";

  it("[325/F2] catálogo: SECURITY INVOKER, search_path=public, pg_temp, devolve bigint", async () => {
    const r = await t.db.query<{ prosecdef: boolean; proconfig: string[] | null; ret: string }>(
      `select prosecdef, proconfig, prorettype::regtype::text as ret from pg_proc where oid = $1::regprocedure`,
      [ASSINATURA],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].prosecdef).toBe(false);
    expect(r.rows[0].proconfig ?? []).toContain("search_path=public, pg_temp");
    expect(r.rows[0].ret).toBe("bigint");
  });

  it("[325/F2] catálogo: EXECUTE só authenticated e service_role (anon e public sem)", async () => {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('public', $1, 'EXECUTE') as publico,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
      [ASSINATURA],
    );
    expect(r.rows[0]).toEqual({ anon: false, publico: false, auth: true, svc: true });
  });

  it("[325/F2] catálogo: corpo não depende da RPC de gravação (salvar_zonas_entrega)", async () => {
    const r = await t.db.query<{ src: string }>(`select prosrc as src from pg_proc where oid = $1::regprocedure`, [
      ASSINATURA,
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].src).not.toContain("salvar_zonas_entrega");
    expect(r.rows[0].src).toContain("versao_zonas_entrega");
  });
});
