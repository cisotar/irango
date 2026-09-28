import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";
import {
  STATUS_VALIDOS,
  transicaoPermitida,
  type StatusPedido,
} from "@/lib/utils/transicaoStatus";

/**
 * Fase RED (TDD) — issue 299 (`tasks/299-pedidos-maquina-de-status-no-banco.md`).
 *
 * A policy `pedidos_acesso_lojista` (FOR ALL, `lojas.dono_id = auth.uid()`)
 * filtra LINHA, não COLUNA: com o próprio JWT o lojista faz PATCH direto na
 * REST API e reescreve `status` e `tipo_entrega` livremente. A máquina de
 * estados (RN-08, `transicaoPermitida`) só existe na Server Action. Isso abre a
 * sequência de 3 PATCHes que descancela, registra frete e recancela, violando
 * D2 de `specs/modalidades-entrega-loja.md`.
 *
 * Correção esperada (ainda NÃO existe): trigger `pedidos_transicao_status_trg`
 * BEFORE UPDATE em `public.pedidos`, função `public.pedidos_transicao_status()`,
 * SECURITY INVOKER, no molde de `pedidos_protege_valor_trg` (whitelist
 * `current_user in ('service_role','postgres','supabase_admin')`).
 *
 * Decisões fechadas:
 *  - D1: diagonal (`de = para`) é no-op PERMITIDO. O trigger só avalia a
 *    transição quando `new.status is distinct from old.status` — um trigger não
 *    distingue "status fora do SET" de "status reescrito com o mesmo valor", e
 *    `registrarFreteCombinado` faz UPDATE sem `status`.
 *  - D3: fragmentos de recusa fixos (abaixo).
 *  - D6: INSERT fora do escopo; o trigger é só `before update`.
 *
 * RED esperado: sem o trigger, os UPDATEs que deveriam ser recusados passam
 * (1 linha, sem erro) e a asserção do fragmento falha. Os controles positivos
 * (9 transições do grafo, 6 da diagonal, frete combinado, service_role) passam
 * hoje e ficam como trava contra um GREEN que bloqueie demais.
 *
 * Anti-falso-verde:
 *  - o esperado da paridade é DERIVADO de `transicaoPermitida` (fonte única das
 *    arestas) — nenhuma lista própria de arestas aqui. Se o trigger codificar o
 *    grafo antigo (sem o atalho para `saiu_entrega`), a paridade fica vermelha.
 *  - recusa = mensagem CONTÉM o fragmento. SQLSTATE sozinho não basta: a RLS e
 *    o `pedidos_protege_valor_trg` também recusam UPDATEs em `pedidos`.
 *  - toda recusa é reconferida via asService (linha intacta); toda permissão
 *    por affectedRows === 1 + leitura via asService.
 */

const DONO = "29929929-9299-4299-8299-299299299299";

// ── Contrato de mensagens do `raise exception` (D3 — a fase GREEN deve CONTER
//    exatamente estes fragmentos; o texto completo pode ter contexto em volta).
const FRAG_TRANSICAO = "transição de status não permitida";
const FRAG_TIPO_IMUTAVEL = "tipo de entrega do pedido é imutável";

type Linha = {
  status: string;
  tipo_entrega: string;
  subtotal: number;
  desconto: number;
  taxa_entrega: number | null;
  total: number;
  frete_a_combinar: boolean;
};

type PedidoOpts = {
  status?: StatusPedido;
  tipo?: "entrega" | "retirada";
  aCombinar?: boolean;
  taxa?: number | null;
};

let t: TestDb;
let lojaId: string;

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1,'dono-status@teste.local') on conflict (id) do nothing`,
    [DONO],
  );
  lojaId = await t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-status-299','Loja Status',true) returning id`,
      [DONO],
    );
    return r.rows[0].id;
  });
});

afterAll(async () => {
  await t.close();
});

/**
 * Pedido novo da loja do DONO, criado via service_role (INSERT fora do escopo
 * do trigger — D6). Default: entrega, frete conhecido (taxa 10), 50 + 10 = 60.
 * Respeita o CHECK do par flag/taxa.
 */
async function novoPedido(o: PedidoOpts = {}): Promise<string> {
  const aCombinar = o.aCombinar ?? false;
  const taxa = o.taxa !== undefined ? o.taxa : aCombinar ? null : 10;
  const total = 50 + (taxa ?? 0);
  return t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.pedidos
         (loja_id, nome_cliente, subtotal, desconto, taxa_entrega, total,
          forma_pagamento, tipo_entrega, status, frete_a_combinar)
       values ($1,'Cliente Status',50,0,$2,$3,'pix',$4,$5,$6)
       returning id`,
      [lojaId, taxa, total, o.tipo ?? "entrega", o.status ?? "pendente", aCombinar],
    );
    return r.rows[0].id;
  });
}

/** Fonte da verdade (BYPASSRLS). */
async function lerLinha(id: string): Promise<Linha> {
  const r = await t.asService((db) =>
    db.query<Linha>(
      `select status, tipo_entrega, subtotal, desconto, taxa_entrega, total, frete_a_combinar
         from public.pedidos where id = $1`,
      [id],
    ),
  );
  return r.rows[0];
}

type Tentativa = { affected: number | null; erro: string | null };

/** UPDATE direto como o dono autenticado — o equivalente ao PATCH no PostgREST. */
async function updateComoDono(sql: string, params: unknown[]): Promise<Tentativa> {
  try {
    const r = await t.asUser(DONO, (db) => db.query(sql, params));
    return { affected: r.affectedRows ?? null, erro: null };
  } catch (e) {
    return { affected: null, erro: (e as Error).message };
  }
}

/** Exige recusa pelo TRIGGER (fragmento da mensagem) e linha intacta via asService. */
async function esperarRecusa(
  id: string,
  sql: string,
  params: unknown[],
  fragmento: string,
): Promise<void> {
  const antes = await lerLinha(id);
  const r = await updateComoDono(sql, params);
  expect(
    r.erro ?? `UPDATE PASSOU sem erro (affectedRows=${r.affected}) — nada recusou`,
  ).toContain(fragmento);
  expect(await lerLinha(id)).toEqual(antes);
}

/** Exige que o dono consiga (1 linha afetada, sem erro). */
async function esperarPermitido(sql: string, params: unknown[]): Promise<void> {
  const r = await updateComoDono(sql, params);
  expect(r.erro).toBeNull();
  expect(r.affected).toBe(1);
}

const UPDATE_STATUS = `update public.pedidos set status = $2 where id = $1`;

// ═════════════════════════════════════════════ paridade com transicaoPermitida
describe("pedidos_transicao_status — paridade dos 30 pares de ≠ para com transicaoPermitida (RN-08)", () => {
  const pares: Array<{ de: StatusPedido; para: StatusPedido }> = [];
  for (const de of STATUS_VALIDOS) {
    for (const para of STATUS_VALIDOS) {
      if (de !== para) pares.push({ de, para });
    }
  }

  it("sanidade: 30 pares fora da diagonal (6 × 5)", () => {
    expect(pares).toHaveLength(30);
  });

  for (const { de, para } of pares) {
    const permitido = transicaoPermitida(de, para);
    it(`${de} → ${para}: ${permitido ? "PERMITIDO" : "RECUSADO"} (derivado de transicaoPermitida)`, async () => {
      const id = await novoPedido({ status: de });
      if (permitido) {
        await esperarPermitido(UPDATE_STATUS, [id, para]);
        expect((await lerLinha(id)).status).toBe(para);
      } else {
        await esperarRecusa(id, UPDATE_STATUS, [id, para], FRAG_TRANSICAO);
        expect((await lerLinha(id)).status).toBe(de);
      }
    });
  }
});

// ═════════════════════════════════════════════ diagonal (D1)
describe("pedidos_transicao_status — diagonal é no-op permitido (D1)", () => {
  for (const s of STATUS_VALIDOS) {
    it(`${s} → ${s} (status reescrito com o mesmo valor) passa sem erro`, async () => {
      const id = await novoPedido({ status: s });
      await esperarPermitido(UPDATE_STATUS, [id, s]);
      expect((await lerLinha(id)).status).toBe(s);
    });
  }

  it("registro de frete combinado (UPDATE sem status, shape de registrarFreteCombinado) continua passando", async () => {
    const id = await novoPedido({ status: "confirmado", aCombinar: true }); // 50, a combinar
    await esperarPermitido(
      `update public.pedidos
          set taxa_entrega = $2, total = $3, frete_a_combinar = false
        where id = $1
          and frete_a_combinar = true
          and tipo_entrega = 'entrega'
          and status <> 'cancelado'`,
      [id, 7, 57],
    );
    const v = await lerLinha(id);
    expect(v).toMatchObject({ status: "confirmado", taxa_entrega: 7, total: 57, frete_a_combinar: false });
  });
});

// ═════════════════════════════════════════════ critério de pronto da issue
describe("pedidos_transicao_status — critério de pronto (issue 299)", () => {
  it("sequência de 3 PATCHes: passo 1 (cancelado → confirmado) é recusado e o pedido cancelado não ganha frete", async () => {
    const id = await novoPedido({ status: "cancelado", aCombinar: true }); // 50, frete a combinar

    // Passo 1 — descancelar. É ESTE que o trigger novo recusa.
    const p1 = await updateComoDono(`update public.pedidos set status = 'confirmado' where id = $1`, [id]);
    expect(
      p1.erro ?? `passo 1 PASSOU sem erro (affectedRows=${p1.affected}) — pedido descancelado`,
    ).toContain(FRAG_TRANSICAO);

    // Passos 2 e 3 — o atacante insiste. Com o passo 1 barrado, o 2 esbarra no
    // D2 do pedidos_protege_valor_trg (old.status = 'cancelado'); o 3 é no-op.
    await updateComoDono(
      `update public.pedidos set taxa_entrega = 5, total = 55, frete_a_combinar = false where id = $1`,
      [id],
    );
    await updateComoDono(`update public.pedidos set status = 'cancelado' where id = $1`, [id]);

    const v = await lerLinha(id);
    expect(v.status).toBe("cancelado");
    expect(v.frete_a_combinar).toBe(true);
    expect(v.taxa_entrega).toBeNull();
    expect(v.total).toBe(50);
  });
});

// ═════════════════════════════════════════════ tipo_entrega imutável
describe("pedidos_transicao_status — tipo_entrega é imutável para o dono", () => {
  it("entrega → retirada (UPDATE só de tipo_entrega) → recusado", async () => {
    const id = await novoPedido({ tipo: "entrega" });
    await esperarRecusa(
      id,
      `update public.pedidos set tipo_entrega = 'retirada' where id = $1`,
      [id],
      FRAG_TIPO_IMUTAVEL,
    );
    expect((await lerLinha(id)).tipo_entrega).toBe("entrega");
  });

  it("retirada → entrega (UPDATE só de tipo_entrega) → recusado", async () => {
    const id = await novoPedido({ tipo: "retirada", taxa: 0 });
    await esperarRecusa(
      id,
      `update public.pedidos set tipo_entrega = 'entrega' where id = $1`,
      [id],
      FRAG_TIPO_IMUTAVEL,
    );
    expect((await lerLinha(id)).tipo_entrega).toBe("retirada");
  });

  it("controle: tipo_entrega reescrito com o MESMO valor (no-op) passa", async () => {
    const id = await novoPedido({ tipo: "retirada", taxa: 0 });
    await esperarPermitido(`update public.pedidos set tipo_entrega = 'retirada' where id = $1`, [id]);
    expect((await lerLinha(id)).tipo_entrega).toBe("retirada");
  });
});

// ═════════════════════════════════════════════ whitelist de sistema
describe("pedidos_transicao_status — service_role continua escrevendo (whitelist)", () => {
  it("service_role: cancelado → confirmado passa (caminho admin/rotina)", async () => {
    const id = await novoPedido({ status: "cancelado" });
    const r = await t.asService((db) =>
      db.query(`update public.pedidos set status = 'confirmado' where id = $1`, [id]),
    );
    expect(r.affectedRows).toBe(1);
    expect((await lerLinha(id)).status).toBe("confirmado");
  });

  it("service_role: troca de tipo_entrega passa", async () => {
    const id = await novoPedido({ tipo: "entrega" });
    const r = await t.asService((db) =>
      db.query(`update public.pedidos set tipo_entrega = 'retirada' where id = $1`, [id]),
    );
    expect(r.affectedRows).toBe(1);
    expect((await lerLinha(id)).tipo_entrega).toBe("retirada");
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar / migrar):
 *
 * Criar `supabase/migrations/<timestamp > 20260930120000>_pedidos_transicao_status.sql`,
 * aditiva, no molde de `20260925130000_pedidos_protege_valor.sql`:
 *
 *   create or replace function public.pedidos_transicao_status() returns trigger
 *     language plpgsql            -- SECURITY INVOKER (default). NUNCA definer.
 *
 *   1. current_user in ('service_role','postgres','supabase_admin') → return new
 *   2. new.tipo_entrega is distinct from old.tipo_entrega → raise FRAG_TIPO_IMUTAVEL
 *   3. new.status is distinct from old.status e a aresta (old.status, new.status)
 *      NÃO está no grafo de `transicaoPermitida` → raise FRAG_TRANSICAO
 *      Grafo (espelho de TRANSICOES em src/lib/utils/transicaoStatus.ts):
 *        pendente   → confirmado | saiu_entrega | cancelado
 *        confirmado → em_preparo | saiu_entrega | cancelado
 *        em_preparo → saiu_entrega | cancelado
 *        saiu_entrega → entregue
 *        entregue, cancelado: terminais
 *   4. return new   (diagonal e UPDATE sem status = no-op permitido — D1)
 *
 *   create trigger pedidos_transicao_status_trg before update on public.pedidos
 *     for each row execute function public.pedidos_transicao_status();
 *   (nome ordena depois de pedidos_protege_valor_trg — D2)
 *
 * Fragmentos (o `raise exception` deve CONTER exatamente):
 *   FRAG_TRANSICAO     = "transição de status não permitida"
 *   FRAG_TIPO_IMUTAVEL = "tipo de entrega do pedido é imutável"
 */
