import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 220 — `lojas.modal_promocoes` (D6) + recriação da
 * view pública `public.vitrine_lojas` (spec
 * `desconto-por-produto-e-pratos-promocionais.md`, §Modelos de Dados,
 * migrations 2 e 3; RN-16).
 *
 * Escrito a partir da ISSUE e do SPEC, nunca do SQL. O risco desta issue é de
 * DISPONIBILIDADE, não de escalonamento: `drop view` + `create view` reescreve
 * a projeção inteira e recria os privilégios do zero. Uma coluna a menos, ou o
 * `grant select` não reaplicado, derruba a vitrine pública para todo mundo sem
 * erro de migration e sem erro de CI (o tipo `LojaPublica` é gerado DEPOIS).
 *
 * O que fica provado:
 *
 *  [1] a view expõe EXATAMENTE o conjunto anterior (20 colunas, lista literal
 *      abaixo, levantada da última migration que recriou a view —
 *      20260704120000) MAIS `modal_promocoes`. Asserção por lista de colunas
 *      no catálogo, não por "o select não deu erro".
 *  [2] `anon` lê a vitrine pela view recriada nomeando as 21 colunas uma a uma
 *      (coluna faltando ⇒ 42703, não silêncio) e vê `modal_promocoes = true`.
 *  [3] loja nova nasce `modal_promocoes = true` (D6, DEFAULT) e a coluna é
 *      NOT NULL — a recusa cita o nome da coluna, não só o SQLSTATE.
 *  [4] a view reflete `false` ao vivo quando o lojista desliga (não é valor
 *      congelado no `create view`).
 *  [5] `anon` é recusado em UPDATE/INSERT/DELETE na view (42501) e o catálogo
 *      mostra exatamente SELECT — defesa em profundidade (`seguranca.md` §19).
 *  [6] loja inativa continua fora da view (o filtro `ativo = true` não afrouxou
 *      ao trocar a lista de colunas).
 *  [7] a recriação NÃO vazou coluna sensível: `dono_id`, `hotmart_*`,
 *      `modulo_impressao_*`, coords continuam AUSENTES da projeção (42703).
 *
 * Anti-falso-verde: toda leitura via view é reconferida via `asService` na
 * tabela base; toda negação é reconferida como "o dado não mudou".
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aa0000000220";
const DONO_INATIVA = "bbbbbbbb-bbbb-bbbb-bbbb-bb0000000220";
// Terceiro dono: `lojas_dono_unico` (20260614003500) permite UMA loja por dono.
const DONO_DEFAULT = "cccccccc-cccc-cccc-cccc-cc0000000220";
const SLUG_A = "loja-a-modal-220";
const SLUG_INATIVA = "loja-inativa-modal-220";
const NOME_A = "Loja A 220";

/**
 * Conjunto VIGENTE antes desta issue — copiado da última migration que recriou
 * a view (`20260704120000_lojas_whatsapp_envio_automatico.sql`) e conferido
 * contra `Tables<"vitrine_lojas">` em `src/lib/database.types.ts`. Se qualquer
 * um destes sumir da projeção, a vitrine quebra em produção sem aviso.
 */
const COLUNAS_ANTERIORES = [
  "id",
  "slug",
  "nome",
  "telefone",
  "whatsapp",
  "ativo",
  "endereco_rua",
  "endereco_numero",
  "endereco_bairro",
  "endereco_cidade",
  "endereco_estado",
  "endereco_cep",
  "tema",
  "horarios",
  "timezone",
  "assinatura_status",
  "assinatura_fim_periodo",
  "taxa_entrega_fora_zona",
  "logo_url",
  "whatsapp_envio_automatico",
] as const;

const COLUNA_NOVA = "modal_promocoes";

const COLUNAS_ESPERADAS = [...COLUNAS_ANTERIORES, COLUNA_NOVA];

/** Colunas que NUNCA podem entrar na projeção pública (PII, billing, entitlement, coords). */
const COLUNAS_PROIBIDAS = [
  "dono_id",
  "hotmart_subscriber_code",
  "modulo_impressao_a4",
  "modulo_impressao_termica",
  "latitude",
  "longitude",
] as const;

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a-220@teste.local'),
       ($2, 'dono-inativa-220@teste.local'),
       ($3, 'dono-default-220@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_INATIVA, DONO_DEFAULT],
  );
}

async function colunasDaView(t: TestDb): Promise<string[]> {
  const r = await t.db.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = 'vitrine_lojas'
      order by ordinal_position`,
  );
  return r.rows.map((x) => x.column_name);
}

async function privilegioTabela(t: TestDb, role: string, priv: string): Promise<boolean> {
  const r = await t.db.query<{ ok: boolean }>(
    `select has_table_privilege($1, 'public.vitrine_lojas', $2) as ok`,
    [role, priv],
  );
  return r.rows[0].ok;
}

describe("220 · lojas.modal_promocoes + recriação de vitrine_lojas", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await garantirDonos(t);
    await t.asService((db) =>
      db.query(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, $3, true)`,
        [DONO_A, SLUG_A, NOME_A],
      ),
    );
  });

  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────────────────────────── [1] contrato de colunas da view

  it("[1] vitrine_lojas expõe EXATAMENTE as 20 colunas anteriores + modal_promocoes", async () => {
    const atuais = await colunasDaView(t);

    // Nenhuma coluna anterior pode ter sumido — a lista de faltantes aparece
    // no output de falha, não só um "arrays diferentes".
    const faltantes = COLUNAS_ANTERIORES.filter((c) => !atuais.includes(c));
    expect({ faltantes }).toEqual({ faltantes: [] });

    // A nova entrou.
    expect(atuais).toContain(COLUNA_NOVA);

    // E nada além disso (sem `select *` acidental expondo coluna sensível).
    expect([...atuais].sort()).toEqual([...COLUNAS_ESPERADAS].sort());
  });

  // ─────────────────────────────────────────── [2] anon lê a vitrine pela view

  it("[2] anon lê a vitrine nomeando as 21 colunas e vê modal_promocoes = true", async () => {
    const r = await t.asAnon((db) =>
      db.query<Record<string, unknown>>(
        `select ${COLUNAS_ESPERADAS.join(", ")}
           from public.vitrine_lojas
          where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(Object.keys(r.rows[0]).sort()).toEqual([...COLUNAS_ESPERADAS].sort());
    expect(r.rows[0].nome).toBe(NOME_A);
    expect(r.rows[0].modal_promocoes).toBe(true);
  });

  // ───────────────────────────────────────────── [3] D6: default ligado, NOT NULL

  it("[3a] loja nova nasce modal_promocoes = true sem mencionar a coluna (D6)", async () => {
    const r = await t.asService((db) =>
      db.query<{ modal_promocoes: boolean }>(
        `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, 'loja-default-220', 'Loja Default', true)
         returning modal_promocoes`,
        [DONO_DEFAULT],
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].modal_promocoes).toBe(true);
  });

  it("[3b] modal_promocoes é NOT NULL — a recusa cita a coluna", async () => {
    let mensagem = "";
    try {
      await t.asService((db) =>
        db.query(
          `update public.lojas set modal_promocoes = null where slug = $1`,
          [SLUG_A],
        ),
      );
    } catch (err) {
      mensagem = (err as Error).message;
    }
    expect(mensagem).toMatch(/modal_promocoes/);
    expect(mensagem).toMatch(/null/i);

    // anti-falso-verde: a linha continua true
    const conf = await t.asService((db) =>
      db.query<{ modal_promocoes: boolean }>(
        `select modal_promocoes from public.lojas where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(conf.rows[0].modal_promocoes).toBe(true);
  });

  // ────────────────────────────────────────────── [4] a view lê a coluna ao vivo

  it("[4] lojista desliga o modal e a view reflete false ao vivo", async () => {
    await t.asService((db) =>
      db.query(`update public.lojas set modal_promocoes = false where slug = $1`, [SLUG_A]),
    );

    const viaView = await t.asAnon((db) =>
      db.query<{ modal_promocoes: boolean }>(
        `select modal_promocoes from public.vitrine_lojas where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(viaView.rows[0].modal_promocoes).toBe(false);

    const viaBase = await t.asService((db) =>
      db.query<{ modal_promocoes: boolean }>(
        `select modal_promocoes from public.lojas where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(viaBase.rows[0].modal_promocoes).toBe(false);

    // devolve ao default para os casos seguintes
    await t.asService((db) =>
      db.query(`update public.lojas set modal_promocoes = true where slug = $1`, [SLUG_A]),
    );
  });

  // ───────────────────────────────────────── [5] view SELECT-only para a API

  it("[5a] anon NÃO faz UPDATE na view (42501); base intacta", async () => {
    await expect(
      t.asAnon((db) =>
        db.query(
          `update public.vitrine_lojas set modal_promocoes = false where slug = $1`,
          [SLUG_A],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const conf = await t.asService((db) =>
      db.query<{ modal_promocoes: boolean; nome: string }>(
        `select modal_promocoes, nome from public.lojas where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(conf.rows[0]).toEqual({ modal_promocoes: true, nome: NOME_A });
  });

  it("[5b] anon NÃO faz INSERT nem DELETE na view (42501); nada mudou", async () => {
    await expect(
      t.asAnon((db) =>
        db.query(
          `insert into public.vitrine_lojas (slug, nome, ativo)
           values ('loja-invasora-220', 'Invasora', true)`,
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      t.asAnon((db) => db.query(`delete from public.vitrine_lojas where slug = $1`, [SLUG_A])),
    ).rejects.toMatchObject({ code: "42501" });

    const conf = await t.asService((db) =>
      db.query<{ slug: string }>(
        `select slug from public.lojas where slug in ($1, 'loja-invasora-220') order by slug`,
        [SLUG_A],
      ),
    );
    expect(conf.rows.map((x) => x.slug)).toEqual([SLUG_A]);
  });

  it("[5c] catálogo: anon/authenticated têm exatamente SELECT na view recriada", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect({ role, select: await privilegioTabela(t, role, "SELECT") }).toEqual({
        role,
        select: true,
      });
      const proibidos: string[] = [];
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"]) {
        if (await privilegioTabela(t, role, priv)) proibidos.push(priv);
      }
      expect({ role, proibidos }).toEqual({ role, proibidos: [] });
    }
  });

  // ─────────────────────────────────────────── [6] filtro ativo = true intacto

  it("[6] loja INATIVA continua fora da view após a recriação", async () => {
    await t.asService((db) =>
      db.query(
        `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, $2, 'Loja Inativa', false)`,
        [DONO_INATIVA, SLUG_INATIVA],
      ),
    );

    const viaView = await t.asAnon((db) =>
      db.query(`select 1 from public.vitrine_lojas where slug = $1`, [SLUG_INATIVA]),
    );
    expect(viaView.rows).toHaveLength(0);

    const conf = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = $1`, [SLUG_INATIVA]),
    );
    expect(conf.rows).toHaveLength(1);
  });

  // ───────────────────────────────────────── [7] nenhuma coluna sensível vazou

  it("[7] colunas sensíveis continuam AUSENTES da projeção (42703 para cada uma)", async () => {
    const atuais = await colunasDaView(t);
    const vazadas = COLUNAS_PROIBIDAS.filter((c) => atuais.includes(c));
    expect({ vazadas }).toEqual({ vazadas: [] });

    for (const coluna of COLUNAS_PROIBIDAS) {
      await expect(
        t.asAnon((db) => db.query(`select ${coluna} from public.vitrine_lojas limit 1`)),
      ).rejects.toMatchObject({ code: "42703" });
    }
  });
});
