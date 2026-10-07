import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TestDb } from "./pglite";

/**
 * Helpers de cenário da galeria de imagens (specs/galeria-imagens-loja.md).
 *
 * Contrato que estes helpers assumem do schema (M1, `imagens_loja`):
 *   id, loja_id, origem_id, caminho, miniatura_caminho, bytes,
 *   remocao_pendente_em, criado_em
 *
 * Tudo aqui é sintético: hosts `exemplo.*`, emails `@teste.local`, nenhum dado real.
 */

export const HOST_STORAGE = "https://exemplo.supabase.co";
export const PREFIXO_PUBLICO_PRODUTOS = "/storage/v1/object/public/produtos/";

/** URL pública do bucket `produtos` para um caminho relativo ao bucket. */
export function urlStorage(caminho: string): string {
  return `${HOST_STORAGE}${PREFIXO_PUBLICO_PRODUTOS}${caminho}`;
}

/** Caminho novo (único) dentro da pasta da loja. `pasta` sem barras nas pontas. */
export function novoCaminho(lojaId: string, pasta?: string, ext = "webp"): string {
  const base = pasta ? `${lojaId}/${pasta}` : lojaId;
  return `${base}/${randomUUID()}.${ext}`;
}

export type OpcoesImagem = {
  /** id da original — preenchido = recorte (cópia). */
  origemId?: string;
  /** caminho da miniatura (só originais). */
  miniatura?: string;
  /** true = `remocao_pendente_em = now()`. */
  pendente?: boolean;
  /** ISO ou expressão aceita por timestamptz; default `now()`. */
  criadoEm?: string;
};

/**
 * Registra uma linha em `imagens_loja` pela via de serviço (como o backfill/admin
 * fariam) e devolve o id. Não passa pela RLS de propósito: é montagem de cenário.
 */
export async function registrarImagem(
  t: TestDb,
  lojaId: string,
  caminho: string,
  opts: OpcoesImagem = {},
): Promise<string> {
  const r = await t.asService((s) =>
    s.query<{ id: string }>(
      `insert into public.imagens_loja
         (loja_id, caminho, origem_id, miniatura_caminho, remocao_pendente_em, criado_em)
       values ($1::uuid, $2, $3::uuid, $4,
               case when $5::boolean then now() else null end,
               coalesce($6::timestamptz, now()))
       returning id`,
      [lojaId, caminho, opts.origemId ?? null, opts.miniatura ?? null, opts.pendente ?? false, opts.criadoEm ?? null],
    ),
  );
  return r.rows[0].id;
}

/** Cria dono (auth.users) + loja e devolve o id da loja. */
export async function criarLoja(t: TestDb, donoId: string, slug: string): Promise<string> {
  await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
    donoId,
    `${slug}@teste.local`,
  ]);
  const r = await t.asService((s) =>
    s.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, $3, true) returning id`,
      [donoId, slug, `Loja ${slug}`],
    ),
  );
  return r.rows[0].id;
}

export type OpcoesProduto = {
  nome?: string;
  fotoUrl?: string | null;
  oculto?: boolean;
  disponivel?: boolean;
  /** true = `dias_semana = '{}'` (nunca aparece na vitrine, RN-8). */
  nuncaNaVitrine?: boolean;
};

/** Cria produto pela via de serviço (o trigger BEFORE de M4 vale também aqui). */
export async function criarProduto(t: TestDb, lojaId: string, opts: OpcoesProduto = {}): Promise<string> {
  const r = await t.asService((s) =>
    s.query<{ id: string }>(
      `insert into public.produtos (loja_id, nome, preco, disponivel, oculto, foto_url, dias_semana)
       values ($1, $2, 10.00, $3, $4, $5,
               case when $6::boolean then '{}'::smallint[] else null end)
       returning id`,
      [
        lojaId,
        opts.nome ?? `Produto ${randomUUID().slice(0, 8)}`,
        opts.disponivel ?? true,
        opts.oculto ?? false,
        opts.fotoUrl ?? null,
        opts.nuncaNaVitrine ?? false,
      ],
    ),
  );
  return r.rows[0].id;
}

/** Grava `lojas.logo_url` pela via de serviço. */
export async function definirLogo(t: TestDb, lojaId: string, url: string | null): Promise<void> {
  await t.asService((s) => s.query(`update public.lojas set logo_url = $2 where id = $1`, [lojaId, url]));
}

/**
 * Grava um valor LEGADO (não registrado na galeria) contornando os triggers de
 * usuário — como um dado anterior a M4. Usa `session_replication_role = replica`
 * na sessão dona (superuser do pglite), sem depender do nome do trigger.
 */
export async function gravarLegado(
  t: TestDb,
  sql: string,
  params: unknown[],
): Promise<{ rows: Record<string, unknown>[] }> {
  await t.db.exec("begin");
  try {
    await t.db.query("set local session_replication_role = replica");
    const r = await t.db.query<Record<string, unknown>>(sql, params);
    await t.db.exec("commit");
    return r;
  } catch (e) {
    await t.db.exec("rollback");
    throw e;
  }
}

/**
 * Sessão `authenticated` com claims arbitrárias — usada para FORJAR o claim
 * `role: service_role` mantendo o role SQL efetivo `authenticated` (ou o
 * inverso). Molde: rpc_salvar_faixas_entrega.test.ts.
 */
export async function comoSessao<T>(
  t: TestDb,
  roleSql: "authenticated" | "service_role" | "anon",
  claims: Record<string, unknown>,
  fn: (db: PGlite) => Promise<T>,
): Promise<T> {
  await t.db.exec("begin");
  try {
    await t.db.query(`set local role ${roleSql}`);
    await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const r = await fn(t.db);
    await t.db.exec("commit");
    return r;
  } catch (e) {
    await t.db.exec("rollback");
    throw e;
  }
}

// ── Erros ─────────────────────────────────────────────────────────────────────

export type ErroPg = { code?: string; message?: string; constraint?: string };

export async function erroDe(p: Promise<unknown>): Promise<ErroPg | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ErroPg;
  }
}

/** SQLSTATE **e** fragmento da mensagem (memória sqlstate-nao-basta-em-teste-de-escopo). */
export function esperarErro(e: ErroPg | null, code: string, fragmento: string): void {
  expect(e, `esperava ${code} "${fragmento}", mas não lançou`).not.toBeNull();
  expect(e?.code, `mensagem recebida: ${e?.message}`).toBe(code);
  expect(e?.message).toContain(fragmento);
}

// ── Leitura de estado (sempre pela via de serviço, em bloco separado) ────────

export type ImagemLida = {
  id: string;
  loja_id: string;
  origem_id: string | null;
  caminho: string;
  miniatura_caminho: string | null;
  remocao_pendente_em: string | null;
  criado_em: string;
};

export async function imagensDa(t: TestDb, lojaId: string): Promise<ImagemLida[]> {
  const r = await t.asService((s) =>
    s.query<ImagemLida>(
      `select id, loja_id, origem_id, caminho, miniatura_caminho, remocao_pendente_em, criado_em
         from public.imagens_loja where loja_id = $1 order by caminho`,
      [lojaId],
    ),
  );
  return r.rows;
}

export async function imagem(t: TestDb, id: string): Promise<ImagemLida | undefined> {
  const r = await t.asService((s) =>
    s.query<ImagemLida>(
      `select id, loja_id, origem_id, caminho, miniatura_caminho, remocao_pendente_em, criado_em
         from public.imagens_loja where id = $1`,
      [id],
    ),
  );
  return r.rows[0];
}

export type ProdutoLido = {
  id: string;
  nome: string;
  foto_url: string | null;
  oculto: boolean;
  disponivel: boolean;
};

export async function produtosDa(t: TestDb, lojaId: string): Promise<ProdutoLido[]> {
  const r = await t.asService((s) =>
    s.query<ProdutoLido>(
      `select id, nome, foto_url, oculto, disponivel from public.produtos where loja_id = $1 order by id`,
      [lojaId],
    ),
  );
  return r.rows;
}

export async function produto(t: TestDb, id: string): Promise<ProdutoLido | undefined> {
  const r = await t.asService((s) =>
    s.query<ProdutoLido>(`select id, nome, foto_url, oculto, disponivel from public.produtos where id = $1`, [id]),
  );
  return r.rows[0];
}

export async function logoDa(t: TestDb, lojaId: string): Promise<string | null> {
  const r = await t.asService((s) =>
    s.query<{ logo_url: string | null }>(`select logo_url from public.lojas where id = $1`, [lojaId]),
  );
  return r.rows[0]?.logo_url ?? null;
}

/** Snapshot completo de uma loja: imagens (com timestamps), produtos e logo. */
export async function estadoDa(t: TestDb, lojaId: string) {
  return {
    imagens: await imagensDa(t, lojaId),
    produtos: await produtosDa(t, lojaId),
    logo: await logoDa(t, lojaId),
  };
}
