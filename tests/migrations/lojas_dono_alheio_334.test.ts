import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 334, fatia A: endurecer `public.lojas_exige_dono_lojista()`.
 *
 * Hoje (20261001120000_papel_cliente.sql:66-69), quando `auth.role()` é anon ou
 * authenticated e `new.dono_id is distinct from auth.uid()`, o trigger faz
 * `return new` e confia na policy de `lojas` para recusar. Contrato da migration
 * nova (P2, `20261003130000_lojas_dono_alheio_recusa.sql`): nesse ramo,
 *   raise exception 'loja: dono_id diferente do usuário da sessão' using errcode = '42501'
 * sem ler nem gravar papel de ninguém. Os demais ramos não mudam.
 *
 * Como provar que o TRIGGER recusa sozinho: o superuser cria policies PERMISSIVAS
 * temporárias em `lojas` (INSERT para anon/authenticated, UPDATE para
 * authenticated) e reafirma os GRANTs de escrita. Assim a policy e o ACL deixam
 * passar e só o trigger pode barrar. Como a policy e a falta de GRANT também dão
 * 42501, TODA recusa afirma o SQLSTATE E o fragmento `dono_id diferente` na
 * mensagem (SQLSTATE sozinho passa por acidente).
 *
 * Ordem dos triggers BEFORE (alfabética por nome): `lojas_exige_dono_lojista_trg`
 * dispara antes de `lojas_protege_billing_trg`. Hoje o UPDATE de `dono_id` por
 * autor não-sistema já é barrado pelo billing (P0001, "colunas de billing/
 * identidade"); depois da P2 quem barra primeiro é o trigger de papel (42501).
 * O caso [4] afirma o 42501 + fragmento, então o RED dele é "erro diferente".
 */

// UUIDs sintéticos (sem dado real). Prefixo 3340… próprio desta issue.
const ATACANTE = "33400000-0000-4000-8000-000000000001"; // authenticated SEM papel (ver [1])
const ALVO_SEM = "33400000-0000-4000-8000-000000000002"; // vítima sem papel
const ALVO_SEM_B = "33400000-0000-4000-8000-000000000003"; // 2ª vítima sem papel (oráculo [2])
const ALVO_CLI = "33400000-0000-4000-8000-000000000004"; // vítima só-cliente
const ALVO_ANON = "33400000-0000-4000-8000-000000000005"; // vítima do anon
const DONO_UPD = "33400000-0000-4000-8000-000000000006"; // lojista com loja (troca de dono)
const ALVO_UPD = "33400000-0000-4000-8000-000000000007"; // vítima da troca de dono
const SEM_PROPRIA = "33400000-0000-4000-8000-000000000008"; // controle: cria a própria loja
const SEM_SVC = "33400000-0000-4000-8000-000000000009"; // controle: service cria loja
const ALVO_CTRL = "33400000-0000-4000-8000-00000000000a"; // controle do harness (trigger off)
const ALVO_CTRL_ANON = "33400000-0000-4000-8000-00000000000b";

const FRAGMENTO = "dono_id diferente";

async function criarUsuarios(t: TestDb, ids: string[]): Promise<void> {
  for (const id of ids) {
    await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
      id,
      `u-${id}@teste.local`,
    ]);
  }
}

async function papeis(t: TestDb, id: string): Promise<string[]> {
  const r = await t.asService((db) =>
    db.query<{ papel: string }>(
      `select papel from public.papeis_usuario where usuario_id = $1 order by papel`,
      [id],
    ),
  );
  return r.rows.map((x) => x.papel);
}

function atribuir(t: TestDb, id: string, papel: string) {
  return t.asService((db) =>
    db.query<{ p: string[] }>(`select public.atribuir_papel_inicial($1, $2) as p`, [id, papel]),
  );
}

async function contarLojas(t: TestDb, dono: string): Promise<number> {
  const r = await t.asService((db) =>
    db.query<{ n: number }>(`select count(*)::int as n from public.lojas where dono_id = $1`, [dono]),
  );
  return r.rows[0].n;
}

/** Executa e devolve o erro capturado (ou null se não lançou). */
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

/** Recusa do trigger: lançou, 42501 E a mensagem nova (não a da policy/grant). */
function esperarRecusaDoTrigger(e: { code?: string; message: string } | null): void {
  expect(e, "esperava recusa do trigger (42501 'dono_id diferente'); a operação PASSOU").not.toBeNull();
  expect(e?.code).toBe("42501");
  expect(e?.message).toContain(FRAGMENTO);
}

/**
 * Policies permissivas + GRANTs de escrita: tira a policy e o ACL do caminho
 * para que só o trigger possa recusar. Superuser (t.db), fora de withRole.
 */
async function abrirPolicyEGrant(t: TestDb): Promise<void> {
  await t.db.exec(`
    grant insert on public.lojas to anon, authenticated;
    grant update on public.lojas to authenticated;
    drop policy if exists "t334_insert_livre" on public.lojas;
    create policy "t334_insert_livre" on public.lojas
      for insert to anon, authenticated with check (true);
    drop policy if exists "t334_update_livre" on public.lojas;
    create policy "t334_update_livre" on public.lojas
      for update to authenticated using (true) with check (true);
  `);
}

const insereComo = (t: TestDb, quem: string, dono: string, slug: string) =>
  t.asUser(quem, (db) =>
    db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, $2, 'X')`, [dono, slug]),
  );

const insereAnon = (t: TestDb, dono: string, slug: string) =>
  t.asAnon((db) =>
    db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, $2, 'X')`, [dono, slug]),
  );

const insereSvc = (t: TestDb, dono: string, slug: string) =>
  t.asService((db) =>
    db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome) values ($1, $2, 'X') returning id`,
      [dono, slug],
    ),
  );

// ===========================================================================
// Recusa de dono alheio + controles positivos
// ===========================================================================
describe("334 [A] lojas_exige_dono_lojista — dono_id alheio é recusado pelo trigger", () => {
  let t: TestDb;
  let lojaUpd: string;

  beforeAll(async () => {
    t = await createTestDb();
    await criarUsuarios(t, [
      ATACANTE,
      ALVO_SEM,
      ALVO_SEM_B,
      ALVO_CLI,
      ALVO_ANON,
      DONO_UPD,
      ALVO_UPD,
      SEM_PROPRIA,
      SEM_SVC,
    ]);
    await atribuir(t, ALVO_CLI, "cliente");
    // DONO_UPD vira lojista pelo próprio trigger (caminho service, ramo inalterado).
    lojaUpd = (await insereSvc(t, DONO_UPD, "p334-dono-upd")).rows[0].id;
    await abrirPolicyEGrant(t);
  });
  afterAll(async () => t?.close());

  it("[0] pré-condição do harness: GRANTs de escrita e policies permissivas ativos", async () => {
    const g = await t.db.query<{ anon_ins: boolean; auth_ins: boolean; auth_upd: boolean }>(
      `select has_table_privilege('anon', 'public.lojas', 'INSERT') as anon_ins,
              has_table_privilege('authenticated', 'public.lojas', 'INSERT') as auth_ins,
              has_table_privilege('authenticated', 'public.lojas', 'UPDATE') as auth_upd`,
    );
    expect(g.rows[0]).toEqual({ anon_ins: true, auth_ins: true, auth_upd: true });
    const p = await t.db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename = 'lojas' and policyname like 't334_%'
        order by policyname`,
    );
    expect(p.rows.map((r) => r.policyname)).toEqual(["t334_insert_livre", "t334_update_livre"]);
    // Pré-estado dos papéis usados nos casos de recusa.
    expect(await papeis(t, ATACANTE)).toEqual([]);
    expect(await papeis(t, ALVO_SEM)).toEqual([]);
    expect(await papeis(t, ALVO_CLI)).toEqual(["cliente"]);
    expect(await papeis(t, DONO_UPD)).toEqual(["lojista"]);
  });

  // ATACANTE escolhido SEM papel: se o trigger gravasse papel de alguém (vítima
  // via new.dono_id, ou o próprio atacante), a asserção [] dos dois pega.
  it("[1] authenticated INSERT com dono_id = ALVO sem papel → 42501 'dono_id diferente'; nada gravado", async () => {
    const e = await erroDe(insereComo(t, ATACANTE, ALVO_SEM, "p334-alheia-sem"));
    esperarRecusaDoTrigger(e);
    expect(await contarLojas(t, ALVO_SEM)).toBe(0);
    expect(await papeis(t, ALVO_SEM)).toEqual([]);
    expect(await papeis(t, ATACANTE)).toEqual([]);
  });

  it("[2] mesmo INSERT com ALVO só-cliente → mesma recusa e mensagem IDÊNTICA à de ALVO sem papel (não é oráculo de papel)", async () => {
    const eSem = await erroDe(insereComo(t, ATACANTE, ALVO_SEM_B, "p334-oraculo-sem"));
    const eCli = await erroDe(insereComo(t, ATACANTE, ALVO_CLI, "p334-oraculo-cli"));
    esperarRecusaDoTrigger(eSem);
    esperarRecusaDoTrigger(eCli);
    expect(eCli?.message).toBe(eSem?.message);
    expect(eCli?.code).toBe(eSem?.code);
    expect(await contarLojas(t, ALVO_CLI)).toBe(0);
    expect(await contarLojas(t, ALVO_SEM_B)).toBe(0);
    expect(await papeis(t, ALVO_CLI)).toEqual(["cliente"]);
    expect(await papeis(t, ALVO_SEM_B)).toEqual([]);
    expect(await papeis(t, ATACANTE)).toEqual([]);
  });

  it("[3] anon INSERT com dono_id = ALVO → 42501 'dono_id diferente'; nada gravado", async () => {
    const e = await erroDe(insereAnon(t, ALVO_ANON, "p334-anon"));
    esperarRecusaDoTrigger(e);
    expect(await contarLojas(t, ALVO_ANON)).toBe(0);
    expect(await papeis(t, ALVO_ANON)).toEqual([]);
  });

  it("[4] dono authenticated UPDATE set dono_id = ALVO na própria loja → 42501 'dono_id diferente'; dono original mantido", async () => {
    const e = await erroDe(
      t.asUser(DONO_UPD, (db) =>
        db.query(`update public.lojas set dono_id = $1 where id = $2`, [ALVO_UPD, lojaUpd]),
      ),
    );
    esperarRecusaDoTrigger(e);
    // Releitura em bloco NOVO (withRole fez rollback no throw).
    const r = await t.asService((db) =>
      db.query<{ dono_id: string }>(`select dono_id from public.lojas where id = $1`, [lojaUpd]),
    );
    expect(r.rows[0].dono_id).toBe(DONO_UPD);
    expect(await contarLojas(t, ALVO_UPD)).toBe(0);
    expect(await papeis(t, ALVO_UPD)).toEqual([]);
    expect(await papeis(t, DONO_UPD)).toEqual(["lojista"]);
  });

  // ── Controles positivos: verdes antes e depois da P2 ──────────────────────
  it("[5a] authenticated sem papel cria a PRÓPRIA loja → criada e papel ['lojista']", async () => {
    await insereComo(t, SEM_PROPRIA, SEM_PROPRIA, "p334-propria");
    expect(await contarLojas(t, SEM_PROPRIA)).toBe(1);
    expect(await papeis(t, SEM_PROPRIA)).toEqual(["lojista"]);
  });

  it("[5b] asService cria loja para conta sem papel → criada e papel ['lojista']", async () => {
    await insereSvc(t, SEM_SVC, "p334-svc");
    expect(await contarLojas(t, SEM_SVC)).toBe(1);
    expect(await papeis(t, SEM_SVC)).toEqual(["lojista"]);
  });
});

// ===========================================================================
// Controle do harness: sem o trigger de papel, policy + GRANT deixam passar.
// Prova (antes e depois da P2) que a recusa de [1]/[3] vem do TRIGGER, não do
// ACL nem da policy. Banco próprio para não vazar estado.
// ===========================================================================
describe("334 [A-ctrl] harness — com o trigger de papel desligado a escrita alheia passa", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await criarUsuarios(t, [ATACANTE, ALVO_CTRL, ALVO_CTRL_ANON]);
    await abrirPolicyEGrant(t);
    await t.db.exec(`alter table public.lojas disable trigger lojas_exige_dono_lojista_trg`);
  });
  afterAll(async () => t?.close());

  it("[ctrl-a] authenticated INSERT com dono alheio passa sem o trigger", async () => {
    await insereComo(t, ATACANTE, ALVO_CTRL, "p334-ctrl");
    expect(await contarLojas(t, ALVO_CTRL)).toBe(1);
  });

  it("[ctrl-b] anon INSERT com dono alheio passa sem o trigger", async () => {
    await insereAnon(t, ALVO_CTRL_ANON, "p334-ctrl-anon");
    expect(await contarLojas(t, ALVO_CTRL_ANON)).toBe(1);
  });
});
