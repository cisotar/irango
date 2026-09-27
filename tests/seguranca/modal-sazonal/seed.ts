import type { PGlite } from "@electric-sql/pglite";
import type { TestDb } from "../../helpers/pglite";

/**
 * Seed pglite COMPARTILHADO das suítes de vetor do modal sazonal com mensagem
 * (spec `specs/modal-sazonal-mensagem-formatada.md`; suítes V4, V5, V6, V8 em
 * `tests/seguranca/modal-sazonal/`). Molde: `tests/migrations/modais_sazonais_rls.test.ts`.
 *
 * Só usa colunas que JÁ existem antes das migrations 20260927120000/121000
 * (nada de `mensagem` aqui): o seed precisa rodar na fase RED sem quebrar, para
 * que o vermelho de cada teste venha da ASSERÇÃO, não do arranjo.
 *
 * Cenário: duas lojas ativas A e B, cada uma com dono próprio, 3 categorias,
 * 2 cardápios e 1 modal rascunho (`ativo = false`) com junções (2 categorias +
 * 1 cardápio). Sem PII real: e-mails `@teste.local`.
 */

export const DONO_A = "a7000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const DONO_B = "b7000000-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const INICIO = "2026-10-01T00:00:00-03:00";
export const FIM = "2026-10-16T00:00:00-03:00";

export type LojaSemeada = {
  id: string;
  donoId: string;
  categorias: string[];
  cardapios: string[];
  /** Modal rascunho da loja, com junções. */
  modalId: string;
  /** Categorias ligadas ao modal (subconjunto de `categorias`). */
  modalCategorias: string[];
  /** Cardápios ligados ao modal (subconjunto de `cardapios`). */
  modalCardapios: string[];
};

export type CenarioModalSazonal = { a: LojaSemeada; b: LojaSemeada };

async function semearLoja(
  db: PGlite,
  donoId: string,
  rotulo: "a" | "b",
): Promise<LojaSemeada> {
  const loja = await db.query<{ id: string }>(
    `insert into public.lojas (dono_id, slug, nome, ativo)
     values ($1, $2, $3, true) returning id`,
    [donoId, `loja-${rotulo}-modal-mensagem`, `Loja ${rotulo.toUpperCase()}`],
  );
  const lojaId = loja.rows[0].id;

  const cats = await db.query<{ id: string }>(
    `insert into public.categorias (loja_id, nome)
     select $1, 'Categoria ' || g from generate_series(1, 3) g
     returning id`,
    [lojaId],
  );
  const categorias = cats.rows.map((r) => r.id);

  const cards = await db.query<{ id: string }>(
    `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim)
     select $1, 'Cardapio ' || g, 'recorrente', array[6]::smallint[], time '11:00', time '15:00'
       from generate_series(1, 2) g
     returning id`,
    [lojaId],
  );
  const cardapios = cards.rows.map((r) => r.id);

  const modal = await db.query<{ id: string }>(
    `insert into public.modais_sazonais (loja_id, titulo, ativo, exibicao_inicio, exibicao_fim)
     values ($1, $2, false, $3, $4) returning id`,
    [lojaId, `Modal original ${rotulo.toUpperCase()}`, INICIO, FIM],
  );
  const modalId = modal.rows[0].id;

  const modalCategorias = categorias.slice(0, 2);
  const modalCardapios = cardapios.slice(0, 1);
  await db.query(
    `insert into public.modal_sazonal_categorias (loja_id, modal_sazonal_id, categoria_id)
     select $1, $2, unnest($3::uuid[])`,
    [lojaId, modalId, modalCategorias],
  );
  await db.query(
    `insert into public.modal_sazonal_cardapios (loja_id, modal_sazonal_id, cardapio_id)
     select $1, $2, unnest($3::uuid[])`,
    [lojaId, modalId, modalCardapios],
  );

  return { id: lojaId, donoId, categorias, cardapios, modalId, modalCategorias, modalCardapios };
}

/** Cria o cenário A/B. Chamar uma vez por `createTestDb()`. */
export async function semearCenario(t: TestDb): Promise<CenarioModalSazonal> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a-modal-mensagem@teste.local'),
       ($2, 'dono-b-modal-mensagem@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
  return t.asService(async (db) => ({
    a: await semearLoja(db, DONO_A, "a"),
    b: await semearLoja(db, DONO_B, "b"),
  }));
}

/** Estado completo de um modal: linha inteira (jsonb) + junções ordenadas. */
export type FotoModal = {
  linha: Record<string, unknown> | null;
  categorias: string[];
  cardapios: string[];
};

/** Fotografa via service_role (BYPASSRLS): o que está REALMENTE gravado. */
export async function fotografarModal(t: TestDb, modalId: string): Promise<FotoModal> {
  return t.asService(async (db) => {
    const linha = await db.query<{ l: Record<string, unknown> }>(
      `select to_jsonb(m) as l from public.modais_sazonais m where id = $1`,
      [modalId],
    );
    const cats = await db.query<{ id: string }>(
      `select categoria_id as id from public.modal_sazonal_categorias
        where modal_sazonal_id = $1 order by categoria_id`,
      [modalId],
    );
    const cards = await db.query<{ id: string }>(
      `select cardapio_id as id from public.modal_sazonal_cardapios
        where modal_sazonal_id = $1 order by cardapio_id`,
      [modalId],
    );
    return {
      linha: linha.rows[0]?.l ?? null,
      categorias: cats.rows.map((r) => r.id),
      cardapios: cards.rows.map((r) => r.id),
    };
  });
}

/** Contagem de modais e de linhas de junção de uma loja (detecta órfão/criação). */
export async function contarDaLoja(
  t: TestDb,
  lojaId: string,
): Promise<{ modais: number; categorias: number; cardapios: number }> {
  return t.asService(async (db) => {
    const r = await db.query<{ modais: number; categorias: number; cardapios: number }>(
      `select
         (select count(*)::int from public.modais_sazonais where loja_id = $1) as modais,
         (select count(*)::int from public.modal_sazonal_categorias where loja_id = $1) as categorias,
         (select count(*)::int from public.modal_sazonal_cardapios where loja_id = $1) as cardapios`,
      [lojaId],
    );
    return r.rows[0];
  });
}

/** Erro de banco normalizado: SQLSTATE + mensagem (afirmar SEMPRE os dois). */
export type ErroBanco = { code: string | undefined; message: string };

/**
 * Executa `fn` esperando que o banco RECUSE. Se passar, lança — assim uma
 * escrita silenciosa vira FAIL explícito, nunca verde por acidente.
 */
export async function capturarErro(fn: () => Promise<unknown>): Promise<ErroBanco> {
  try {
    await fn();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code, message: String(e.message ?? err) };
  }
  throw new Error("Esperava recusa do banco, mas a operação PASSOU");
}

/** Argumentos da RPC `public.salvar_modal_sazonal` (RN-M15), por nome. */
export type ArgsSalvarModal = {
  p_loja_id: string;
  p_modal_id: string | null;
  p_titulo: string;
  p_exibicao_inicio: string;
  p_exibicao_fim: string;
  /** Objeto (serializado aqui) ou `null`. */
  p_mensagem: unknown;
  p_mostrar_promocoes_junto: boolean | null;
  /** Array JS de ids OU literal de array Postgres cru (ex.: `'{{a,b},{c,d}}'`). */
  p_categorias: string[] | string;
  p_cardapios: string[] | string;
};

/** Literal de array Postgres a partir de ids (aceita `null` como elemento). */
export function literalArray(ids: (string | null)[]): string {
  return `{${ids.map((id) => (id === null ? "NULL" : id)).join(",")}}`;
}

/**
 * Chama a RPC em NOTAÇÃO NOMEADA (é assim que o PostgREST chama): fixa o
 * contrato dos nomes de parâmetro, não só a ordem.
 */
export async function chamarSalvarModal(db: PGlite, a: ArgsSalvarModal): Promise<string> {
  const arr = (v: string[] | string) => (typeof v === "string" ? v : literalArray(v));
  const r = await db.query<{ id: string }>(
    `select public.salvar_modal_sazonal(
       p_loja_id                 => $1::uuid,
       p_modal_id                => $2::uuid,
       p_titulo                  => $3::text,
       p_exibicao_inicio         => $4::timestamptz,
       p_exibicao_fim            => $5::timestamptz,
       p_mensagem                => $6::jsonb,
       p_mostrar_promocoes_junto => $7::boolean,
       p_categorias              => $8::uuid[],
       p_cardapios               => $9::uuid[]
     ) as id`,
    [
      a.p_loja_id,
      a.p_modal_id,
      a.p_titulo,
      a.p_exibicao_inicio,
      a.p_exibicao_fim,
      a.p_mensagem === null ? null : JSON.stringify(a.p_mensagem),
      a.p_mostrar_promocoes_junto,
      arr(a.p_categorias),
      arr(a.p_cardapios),
    ],
  );
  return r.rows[0].id;
}

/** Args válidos de EDIÇÃO do modal da loja (sobrescreva o que o caso ataca). */
export function argsEdicaoValidos(loja: LojaSemeada): ArgsSalvarModal {
  return {
    p_loja_id: loja.id,
    p_modal_id: loja.modalId,
    p_titulo: "Titulo editado",
    p_exibicao_inicio: INICIO,
    p_exibicao_fim: FIM,
    p_mensagem: null,
    p_mostrar_promocoes_junto: null,
    p_categorias: loja.modalCategorias,
    p_cardapios: loja.modalCardapios,
  };
}

/** Mensagem mínima válida no formato `versao: 1` (topo aceito pelo CHECK de forma). */
export function mensagemMinima(texto = "Aviso da loja"): {
  versao: 1;
  paragrafos: { trechos: { texto: string }[] }[];
} {
  return { versao: 1, paragrafos: [{ trechos: [{ texto }] }] };
}
