import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";
import { calcularTotal } from "@/lib/utils/calcularTotal";
import { TETO_FRETE_COMBINADO } from "@/lib/validacoes/entrega";

/**
 * Fase RED (TDD). Achado MÉDIO da auditoria de segurança da branch
 * feat/modalidades-entrega-loja (pré-existente, corrigido nesta branch).
 *
 * A policy `pedidos_acesso_lojista` (FOR ALL, `lojas.dono_id = auth.uid()`)
 * filtra LINHA, não COLUNA. Com o próprio JWT, o lojista faz
 * `PATCH /rest/v1/pedidos?id=eq.<proprio>` e reescreve `total`, `subtotal`,
 * `desconto`, `taxa_entrega` e reabre `frete_a_combinar`, contornando D1/D2/D3
 * da spec `specs/modalidades-entrega-loja.md` e o recálculo autoritativo de
 * `src/lib/actions/freteCombinado.ts`.
 *
 * Correção esperada (ainda NÃO existe): trigger `pedidos_protege_valor_trg`
 * BEFORE UPDATE em `public.pedidos`, função `public.pedidos_protege_valor()`,
 * no molde de `20260614004500_lojas_protege_billing.sql` (libera por
 * `current_user in ('service_role','postgres','supabase_admin')`, senão
 * `raise exception` com mensagem específica). A ÚNICA escrita de valor
 * permitida ao dono é a transição do frete combinado que a Server Action faz —
 * ela usa o client AUTENTICADO do dono, então corre sob o mesmo `current_user`
 * (`authenticated`) que o PATCH malicioso.
 *
 * RED esperado: sem o trigger, os UPDATEs que deveriam ser RECUSADOS passam
 * (1 linha afetada, sem erro) e a asserção do fragmento da mensagem falha.
 * Os casos de caminho PERMITIDO (transição legítima, status, service_role)
 * passam hoje e ficam como trava contra o GREEN bloquear demais.
 *
 * Anti-falso-verde:
 *  - recusa = exceção cuja mensagem CONTÉM o fragmento do contrato. SQLSTATE
 *    sozinho não basta: o CHECK `chk_pedidos_frete_a_combinar` e a RLS também
 *    recusam, e um teste que aceitasse "qualquer erro" passaria pelo motivo
 *    errado. Cada caso de recusa viola UMA regra só (o resto do UPDATE é
 *    legítimo e respeita o CHECK), para que a mensagem prove a regra.
 *  - toda recusa é reconferida via asService: os valores do pedido não mudaram.
 *  - toda permissão é conferida por affectedRows === 1 + leitura via asService.
 *  - nunca aceita "relation/function does not exist" como negação.
 */

const DONO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// ── Contrato de mensagens do `raise exception` (fase GREEN deve usar ESTES
//    fragmentos; o texto completo pode ter mais contexto em volta).
const FRAG_SOMENTE_SERVIDOR = "valores do pedido são somente-servidor";
const FRAG_SO_ENTREGA = "frete combinado só vale para entrega";
const FRAG_CANCELADO = "frete combinado não vale para pedido cancelado";
const FRAG_INTERVALO = "frete combinado fora do intervalo";
const FRAG_TOTAL = "total do pedido não confere";

type Valores = {
  subtotal: number;
  desconto: number;
  taxa_entrega: number | null;
  total: number;
  frete_a_combinar: boolean;
  status: string;
  tipo_entrega: string;
};

type PedidoOpts = {
  subtotal?: number;
  desconto?: number;
  taxa?: number | null;
  total?: number;
  aCombinar?: boolean;
  tipo?: "entrega" | "retirada";
  status?: string;
};

let t: TestDb;
let lojaId: string;

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1,'dono-valor@teste.local') on conflict (id) do nothing`,
    [DONO],
  );
  lojaId = await t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-valor','Loja Valor',true) returning id`,
      [DONO],
    );
    return r.rows[0].id;
  });
});

afterAll(async () => {
  await t.close();
});

/**
 * Pedido novo da loja do DONO, criado via service_role (bypass RLS/trigger).
 * Default: frete A COMBINAR (taxa NULL), entrega, pendente, 50 − 0.
 * Respeita o CHECK do par flag/taxa.
 */
async function novoPedido(o: PedidoOpts = {}): Promise<string> {
  const aCombinar = o.aCombinar ?? true;
  const subtotal = o.subtotal ?? 50;
  const desconto = o.desconto ?? 0;
  const taxa = o.taxa !== undefined ? o.taxa : aCombinar ? null : 0;
  const total =
    o.total ?? calcularTotal({ subtotal, desconto, taxaEntrega: taxa ?? 0 }).total;
  return t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.pedidos
         (loja_id, nome_cliente, subtotal, desconto, taxa_entrega, total,
          forma_pagamento, tipo_entrega, status, frete_a_combinar)
       values ($1,'Cliente Valor',$2,$3,$4,$5,'pix',$6,$7,$8)
       returning id`,
      [lojaId, subtotal, desconto, taxa, total, o.tipo ?? "entrega", o.status ?? "pendente", aCombinar],
    );
    return r.rows[0].id;
  });
}

/** Fonte da verdade (BYPASSRLS). */
async function lerValores(id: string): Promise<Valores> {
  const r = await t.asService((db) =>
    db.query<Valores>(
      `select subtotal, desconto, taxa_entrega, total, frete_a_combinar, status, tipo_entrega
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

/**
 * Exige recusa pelo TRIGGER (fragmento da mensagem) e valores intactos.
 * Sem o trigger, o UPDATE passa e o placeholder abaixo falha a asserção.
 */
async function esperarRecusa(
  id: string,
  sql: string,
  params: unknown[],
  fragmento: string,
): Promise<void> {
  const antes = await lerValores(id);
  const r = await updateComoDono(sql, params);
  expect(
    r.erro ?? `UPDATE PASSOU sem erro (affectedRows=${r.affected}) — nada recusou`,
  ).toContain(fragmento);
  expect(await lerValores(id)).toEqual(antes);
}

/** Exige que o dono consiga (1 linha afetada, sem erro). */
async function esperarPermitido(sql: string, params: unknown[]): Promise<void> {
  const r = await updateComoDono(sql, params);
  expect(r.erro).toBeNull();
  expect(r.affected).toBe(1);
}

// ═════════════════════════════════════════════════════════════ estrutura
describe("pedidos_protege_valor — estrutura", () => {
  it("[0] trigger pedidos_protege_valor_trg existe, BEFORE UPDATE em public.pedidos, função SECURITY INVOKER", async () => {
    // SECURITY DEFINER aqui seria um bypass total: dentro da função
    // current_user viraria o dono da função (postgres) e todo autor passaria.
    const r = await t.db.query<{ tgname: string; proname: string; prosecdef: boolean; tgtype: number }>(
      `select tg.tgname, p.proname, p.prosecdef, tg.tgtype
         from pg_trigger tg
         join pg_proc p on p.oid = tg.tgfoid
        where tg.tgrelid = 'public.pedidos'::regclass
          and tg.tgname = 'pedidos_protege_valor_trg'
          and not tg.tgisinternal`,
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].proname).toBe("pedidos_protege_valor");
    expect(r.rows[0].prosecdef).toBe(false);
    // tgtype: bit 0 = ROW, bit 1 = BEFORE, bit 4 = UPDATE
    const tipo = r.rows[0].tgtype;
    expect(tipo & 1).toBe(1);
    expect(tipo & 2).toBe(2);
    expect(tipo & 16).toBe(16);
  });
});

// ═════════════════════════════════════════════════════════════ recusas
describe("pedidos_protege_valor — dono NÃO reescreve valor via UPDATE direto", () => {
  it("[1] dono grava total arbitrário (0.01) num pedido de frete conhecido → recusado", async () => {
    const id = await novoPedido({ aCombinar: false, taxa: 10 }); // total 60
    await esperarRecusa(
      id,
      `update public.pedidos set total = 0.01 where id = $1`,
      [id],
      FRAG_SOMENTE_SERVIDOR,
    );
  });

  it("[1b] dono grava total arbitrário num pedido AINDA a combinar (sem mexer na flag) → recusado", async () => {
    const id = await novoPedido(); // a combinar, total 50
    await esperarRecusa(
      id,
      `update public.pedidos set total = 1 where id = $1`,
      [id],
      FRAG_SOMENTE_SERVIDOR,
    );
  });

  it("[2] dono REABRE frete_a_combinar (false → true, taxa NULL, total coerente com o CHECK) → recusado", async () => {
    const id = await novoPedido({ aCombinar: false, taxa: 10 }); // total 60
    await esperarRecusa(
      id,
      `update public.pedidos set frete_a_combinar = true, taxa_entrega = null, total = 50 where id = $1`,
      [id],
      FRAG_SOMENTE_SERVIDOR,
    );
  });

  it("[2b] D1: depois do 1º registro legítimo, o 2º registro (novo valor coerente) é recusado", async () => {
    const id = await novoPedido(); // a combinar
    await esperarPermitido(
      `update public.pedidos set taxa_entrega = 8, total = 58, frete_a_combinar = false where id = $1`,
      [id],
    );
    await esperarRecusa(
      id,
      `update public.pedidos set taxa_entrega = 20, total = 70 where id = $1`,
      [id],
      FRAG_SOMENTE_SERVIDOR,
    );
  });

  it("[2c] dono muda taxa_entrega de pedido com frete CALCULADO pelo sistema (flag false) → recusado", async () => {
    const id = await novoPedido({ aCombinar: false, taxa: 12 }); // total 62
    await esperarRecusa(
      id,
      `update public.pedidos set taxa_entrega = 0, total = 50 where id = $1`,
      [id],
      FRAG_SOMENTE_SERVIDOR,
    );
  });

  it("[3] D2: registrar frete (transição) em pedido de RETIRADA → recusado", async () => {
    const id = await novoPedido({ tipo: "retirada" }); // a combinar, retirada
    await esperarRecusa(
      id,
      `update public.pedidos set taxa_entrega = 5, total = 55, frete_a_combinar = false where id = $1`,
      [id],
      FRAG_SO_ENTREGA,
    );
  });

  it("[3b] bypass: trocar tipo_entrega para 'entrega' NO MESMO UPDATE do registro não libera (vale o OLD) → recusado", async () => {
    const id = await novoPedido({ tipo: "retirada" });
    await esperarRecusa(
      id,
      `update public.pedidos
          set tipo_entrega = 'entrega', taxa_entrega = 5, total = 55, frete_a_combinar = false
        where id = $1`,
      [id],
      FRAG_SO_ENTREGA,
    );
  });

  it("[3c] retirada com frete conhecido: mudar taxa/total → recusado", async () => {
    const id = await novoPedido({ tipo: "retirada", aCombinar: false, taxa: 0 }); // total 50
    await esperarRecusa(
      id,
      `update public.pedidos set taxa_entrega = 7, total = 57 where id = $1`,
      [id],
      FRAG_SOMENTE_SERVIDOR,
    );
  });

  it("[4] D2: registrar frete em pedido CANCELADO → recusado", async () => {
    const id = await novoPedido({ status: "cancelado" });
    await esperarRecusa(
      id,
      `update public.pedidos set taxa_entrega = 5, total = 55, frete_a_combinar = false where id = $1`,
      [id],
      FRAG_CANCELADO,
    );
  });

  it("[4b] bypass: 'descancelar' no MESMO UPDATE do registro não libera (vale o OLD) → recusado", async () => {
    const id = await novoPedido({ status: "cancelado" });
    await esperarRecusa(
      id,
      `update public.pedidos
          set status = 'confirmado', taxa_entrega = 5, total = 55, frete_a_combinar = false
        where id = $1`,
      [id],
      FRAG_CANCELADO,
    );
  });

  it("[5] D3: taxa_entrega acima do teto na transição, total coerente → recusado", async () => {
    // Usa TETO_FRETE_COMBINADO (não um número fixo): se o teto do app mudar
    // sem o trigger acompanhar, este caso precisa acusar a divergência junto
    // com [7] ("frete no TETO exato"), nunca ficar verde sozinho.
    const id = await novoPedido(); // 50 − 0
    const taxa = TETO_FRETE_COMBINADO + 0.01;
    await esperarRecusa(
      id,
      `update public.pedidos set taxa_entrega = ${taxa}, total = ${50 + taxa}, frete_a_combinar = false where id = $1`,
      [id],
      FRAG_INTERVALO,
    );
  });

  it("[5b] D3: taxa_entrega NEGATIVA na transição, total coerente → recusado", async () => {
    const id = await novoPedido(); // 50 − 0
    await esperarRecusa(
      id,
      `update public.pedidos set taxa_entrega = -1, total = 49, frete_a_combinar = false where id = $1`,
      [id],
      FRAG_INTERVALO,
    );
  });

  it("[5c] transição com taxa válida mas total DIVERGENTE do recálculo → recusado", async () => {
    const id = await novoPedido({ subtotal: 50, desconto: 5 }); // base 45
    await esperarRecusa(
      id,
      `update public.pedidos set taxa_entrega = 10, total = 0.01, frete_a_combinar = false where id = $1`,
      [id],
      FRAG_TOTAL,
    );
  });

  it("[6] dono grava subtotal diferente → recusado", async () => {
    const id = await novoPedido({ aCombinar: false, taxa: 10 });
    await esperarRecusa(
      id,
      `update public.pedidos set subtotal = 1, total = 11 where id = $1`,
      [id],
      FRAG_SOMENTE_SERVIDOR,
    );
  });

  it("[6b] dono grava desconto diferente → recusado", async () => {
    const id = await novoPedido({ aCombinar: false, taxa: 10 }); // 50 − 0 + 10
    await esperarRecusa(
      id,
      `update public.pedidos set desconto = 49, total = 11 where id = $1`,
      [id],
      FRAG_SOMENTE_SERVIDOR,
    );
  });

  it("[6c] transição legítima CONTRABANDEANDO desconto no mesmo UPDATE → recusado", async () => {
    const id = await novoPedido(); // a combinar, 50 − 0
    await esperarRecusa(
      id,
      `update public.pedidos
          set desconto = 50, taxa_entrega = 5, total = 5, frete_a_combinar = false
        where id = $1`,
      [id],
      FRAG_SOMENTE_SERVIDOR,
    );
  });
});

// ═════════════════════════════════════════════════════════════ permitidos
describe("pedidos_protege_valor — caminhos legítimos continuam passando", () => {
  // Espelho da Server Action registrarFreteCombinado: total = calcularTotal(
  // subtotal e desconto DO BANCO, valor). O trigger precisa aceitar exatamente
  // o que a Action grava — anti-drift entre a aritmética do app e a do banco.
  const casosTransicao: Array<{ nome: string; subtotal: number; desconto: number; valor: number }> = [
    { nome: "frete comum com desconto", subtotal: 50, desconto: 5, valor: 12.5 },
    { nome: "frete ZERO (grátis legítimo)", subtotal: 50, desconto: 0, valor: 0 },
    { nome: "frete no TETO exato", subtotal: 50, desconto: 0, valor: TETO_FRETE_COMBINADO },
    { nome: "desconto maior que subtotal (clamp em 0 antes do frete)", subtotal: 20, desconto: 30, valor: 8 },
  ];

  for (const c of casosTransicao) {
    it(`[7] transição legítima do frete combinado passa — ${c.nome}`, async () => {
      const id = await novoPedido({ subtotal: c.subtotal, desconto: c.desconto });
      const { total } = calcularTotal({
        subtotal: c.subtotal,
        desconto: c.desconto,
        taxaEntrega: c.valor,
      });
      // Mesmo shape do UPDATE da Action (filtros D1/D2 no WHERE).
      await esperarPermitido(
        `update public.pedidos
            set taxa_entrega = $2, total = $3, frete_a_combinar = false
          where id = $1
            and frete_a_combinar = true
            and tipo_entrega = 'entrega'
            and status <> 'cancelado'`,
        [id, c.valor, total],
      );
      const v = await lerValores(id);
      expect(v.taxa_entrega).toBe(c.valor);
      expect(v.total).toBe(total);
      expect(v.frete_a_combinar).toBe(false);
      expect(v.subtotal).toBe(c.subtotal);
      expect(v.desconto).toBe(c.desconto);
    });
  }

  it("[7b] transição legítima em pedido já avançado (status 'saiu_entrega') passa — D2 só exclui cancelado", async () => {
    const id = await novoPedido({ status: "saiu_entrega" });
    await esperarPermitido(
      `update public.pedidos set taxa_entrega = 6, total = 56, frete_a_combinar = false where id = $1`,
      [id],
    );
    expect((await lerValores(id)).total).toBe(56);
  });

  it("[8] UPDATE só de status (fluxo de src/lib/actions/status.ts) não é bloqueado", async () => {
    const id = await novoPedido({ aCombinar: false, taxa: 10 });
    await esperarPermitido(`update public.pedidos set status = 'confirmado' where id = $1`, [id]);
    expect((await lerValores(id)).status).toBe("confirmado");
  });

  it("[8b] cancelar pedido A COMBINAR (só status) não é bloqueado", async () => {
    const id = await novoPedido();
    await esperarPermitido(`update public.pedidos set status = 'cancelado' where id = $1`, [id]);
    expect((await lerValores(id)).status).toBe("cancelado");
  });

  it("[8c] UPDATE que reescreve colunas protegidas com o MESMO valor (no-op) não é bloqueado", async () => {
    // Trava contra um GREEN que compare "coluna presente no SET" em vez de
    // `is distinct from`: um PATCH com a linha inteira inalterada é inofensivo.
    const id = await novoPedido({ aCombinar: false, taxa: 10 }); // total 60
    await esperarPermitido(
      `update public.pedidos
          set status = 'em_preparo', subtotal = 50, desconto = 0, taxa_entrega = 10,
              total = 60, frete_a_combinar = false
        where id = $1`,
      [id],
    );
    const v = await lerValores(id);
    expect(v.status).toBe("em_preparo");
    expect(v.total).toBe(60);
  });
});

// ═════════════════════════════════════════════════════════════ sistema
describe("pedidos_protege_valor — service_role e postgres continuam escrevendo", () => {
  it("[9] service_role reescreve total/subtotal/desconto arbitrários", async () => {
    const id = await novoPedido({ aCombinar: false, taxa: 10 });
    const r = await t.asService((db) =>
      db.query(
        `update public.pedidos set subtotal = 1, desconto = 0.5, total = 0.01 where id = $1`,
        [id],
      ),
    );
    expect(r.affectedRows).toBe(1);
    const v = await lerValores(id);
    expect(v).toMatchObject({ subtotal: 1, desconto: 0.5, total: 0.01 });
  });

  it("[9b] service_role reabre frete_a_combinar", async () => {
    const id = await novoPedido({ aCombinar: false, taxa: 10 });
    const r = await t.asService((db) =>
      db.query(
        `update public.pedidos set frete_a_combinar = true, taxa_entrega = null, total = 50 where id = $1`,
        [id],
      ),
    );
    expect(r.affectedRows).toBe(1);
    expect((await lerValores(id)).frete_a_combinar).toBe(true);
  });

  it("[9c] service_role registra frete em retirada, cancelado e acima do teto (caminho admin/rotina)", async () => {
    const retirada = await novoPedido({ tipo: "retirada" });
    const cancelado = await novoPedido({ status: "cancelado" });
    const acimaTeto = await novoPedido();
    const r = await t.asService(async (db) => {
      const a = await db.query(
        `update public.pedidos set taxa_entrega = 5, total = 55, frete_a_combinar = false where id = $1`,
        [retirada],
      );
      const b = await db.query(
        `update public.pedidos set taxa_entrega = 5, total = 55, frete_a_combinar = false where id = $1`,
        [cancelado],
      );
      const c = await db.query(
        `update public.pedidos set taxa_entrega = 5000, total = 1, frete_a_combinar = false where id = $1`,
        [acimaTeto],
      );
      return [a.affectedRows, b.affectedRows, c.affectedRows];
    });
    expect(r).toEqual([1, 1, 1]);
    expect((await lerValores(acimaTeto)).taxa_entrega).toBe(5000);
  });

  it("[9d] postgres (migrations/backfill, superuser sem SET ROLE) reescreve total", async () => {
    const id = await novoPedido({ aCombinar: false, taxa: 10 });
    const r = await t.db.query(`update public.pedidos set total = 99 where id = $1`, [id]);
    expect(r.affectedRows).toBe(1);
    expect((await lerValores(id)).total).toBe(99);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar / migrar):
 *
 * Criar `supabase/migrations/<timestamp > 20260925120000>_pedidos_protege_valor.sql`,
 * aditiva, no molde de `20260614004500_lojas_protege_billing.sql`:
 *
 *   create or replace function public.pedidos_protege_valor() returns trigger
 *     language plpgsql            -- SECURITY INVOKER (default). NUNCA definer.
 *
 *   ordem das checagens (cada teste isola UMA violação; a ordem define a mensagem):
 *     1. current_user in ('service_role','postgres','supabase_admin') → return new
 *     2. nenhuma de subtotal/desconto/taxa_entrega/total/frete_a_combinar mudou
 *        (`is distinct from`)                                          → return new
 *     3. subtotal ou desconto mudou              → raise FRAG_SOMENTE_SERVIDOR
 *     4. transição old.frete_a_combinar = true AND new.frete_a_combinar = false:
 *          old.tipo_entrega <> 'entrega'         → raise FRAG_SO_ENTREGA
 *          old.status = 'cancelado'              → raise FRAG_CANCELADO
 *          new.taxa_entrega fora de [0, 1000]    → raise FRAG_INTERVALO
 *          new.total <> greatest(0, old.subtotal - old.desconto) + new.taxa_entrega
 *                                                → raise FRAG_TOTAL
 *          senão                                 → return new
 *     5. qualquer outra mudança de total/taxa_entrega/frete_a_combinar
 *                                                → raise FRAG_SOMENTE_SERVIDOR
 *   Regras de D2 leem OLD (tipo_entrega/status), nunca NEW — casos [3b]/[4b].
 *   A fórmula do total espelha `calcularTotal` (clamp em 0 antes do frete).
 *
 *   create trigger pedidos_protege_valor_trg before update on public.pedidos
 *     for each row execute function public.pedidos_protege_valor();
 *
 * Fragmentos (o `raise exception` deve CONTER exatamente):
 *   FRAG_SOMENTE_SERVIDOR = "valores do pedido são somente-servidor"
 *   FRAG_SO_ENTREGA       = "frete combinado só vale para entrega"
 *   FRAG_CANCELADO        = "frete combinado não vale para pedido cancelado"
 *   FRAG_INTERVALO        = "frete combinado fora do intervalo"
 *   FRAG_TOTAL            = "total do pedido não confere"
 *
 * Casos que precisam passar: [0]..[9d]. [7]..[9d] já passam hoje (trava
 * contra bloquear demais); [0]..[6c] são o RED.
 */
