import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 362 — prova de BANCO da VIA DE SERVIÇO das duas RPCs
 * transacionais do modal sazonal:
 *
 *   public.salvar_modal_sazonal(uuid, uuid, text, timestamptz, timestamptz,
 *                               jsonb, boolean, uuid[], uuid[])   -- assinatura PRESERVADA
 *   public.ativar_modal_sazonal(p_modal_id uuid)                   -- lojista, INTACTA
 *   public.ativar_modal_sazonal(p_modal_id uuid, p_loja_id uuid)   -- OVERLOAD NOVO, só serviço
 *
 * Autoridade: tasks/362-sub-rota-admin-de-avisos.md §Escopo/Banco (alternativa 2:
 * abrir a via de serviço no padrão `v_e_servico` de
 * 20260930120000_rpc_salvar_faixas_entrega_ativo.sql:44-83; overload de 2 args
 * SEM `default`, exigindo `v_e_servico` E `modais_sazonais.loja_id = p_loja_id`,
 * `grant execute` só a `service_role`; o 1-arg do lojista não é tocado) ·
 * RN-M15 (linha + mensagem + junções ou nada) · RN-M16 (nunca dois ativos,
 * nunca zero).
 *
 * ESTADO ANTES DO GREEN (o que faz este arquivo nascer vermelho):
 *   - `salvar_modal_sazonal` tem S1 `if auth.uid() is null then raise
 *     'modal_sazonal: sem sessao'` (20260927121000:53) ⇒ TODO caso de serviço
 *     deste arquivo falha com P0001 'sem sessao';
 *   - `ativar_modal_sazonal` só existe com 1 argumento (20260927125000) ⇒ toda
 *     chamada de 2 args falha com 42883 e as asserções de catálogo do overload
 *     explodem no cast `::regprocedure`.
 *
 * CONTRATO DE MENSAGENS (P0001, prefixo fixo `modal_sazonal:`, internas — a
 * Server Action loga e devolve genérica, seguranca.md §14):
 *   'modal_sazonal: sem sessao'       nem `v_e_servico` nem `auth.uid()`
 *   'modal_sazonal: sem posse'        salvar: autenticado que não é dono de p_loja_id
 *   'modal_sazonal: modal inexistente'
 *                                     p_modal_id inexistente OU de outra loja —
 *                                     a MESMA mensagem nos dois casos, sem o id,
 *                                     para não virar oráculo de existência (regra
 *                                     que as duas funções já seguem hoje). Vale
 *                                     para `salvar` (S4) e para os DOIS overloads
 *                                     de `ativar`.
 *   'modal_sazonal: selecao invalida' / 'selecao nao gravada' / 'teto de modais'
 *                                     inalteradas (não são escopo desta issue).
 *
 * `v_e_servico` = `auth.role() = 'service_role'` E role efetivo da sessão fora de
 * ('authenticated','anon'). Os dois sinais juntos: só divergem por forja de claim
 * ou bug de pool, e aí a via de serviço tem de NEGAR.
 *
 * ANTI-FALSO-VERDE — por que cada afirmação não passa por acidente:
 *  - toda recusa afirma SQLSTATE **e** FRAGMENTO da mensagem (memória
 *    `sqlstate-nao-basta-em-teste-de-escopo`). Sob `service_role` (BYPASSRLS) a
 *    RLS não denuncia NADA: um UPDATE com `p_loja_id` alheio e sem a trava
 *    gravaria calado, e um UPDATE de 0 linhas também passaria calado. Já na via
 *    do lojista a RLS daria 42501 "violates row-level security" por acidente —
 *    só o fragmento prova que a trava da FUNÇÃO disparou, e antes de qualquer
 *    linha;
 *  - "estado intacto" é relido num bloco `asService` SEPARADO, depois do bloco
 *    que lançou (o harness faz rollback no erro), e compara o snapshot COMPLETO
 *    **com ids** e com as junções — não basta "tem modal";
 *  - antes de cada recusa as DUAS lojas recebem um estado CONHECIDO e não vazio
 *    (modal ativo + rascunho + junções), senão "intacto" seria vacuamente
 *    verdadeiro;
 *  - uma função que SEMPRE recusasse passaria nos casos de escopo: os casos de
 *    caminho feliz (serviço grava em A, serviço ativa em A) são o contrapeso, e
 *    são os que hoje falham com 'sem sessao'/42883;
 *  - as asserções de EXECUTE do overload de 2 args afirmam `authenticated: false`:
 *    o projeto concede EXECUTE a `anon`/`authenticated`/`service_role` por
 *    `alter default privileges ... on routines` (20260614008500:31), então a
 *    função nasce executável pelos três. Só um `revoke` EXPLÍCITO de
 *    `authenticated` (além de public/anon) deixa este teste verde — sem ele, o
 *    lojista alcançaria o caminho que amarra a loja por argumento;
 *  - a ativação por serviço é afirmada pela CONTAGEM de ativos da loja (= 1) e
 *    pelo id do ativo, não só por "o alvo está ativo": uma implementação que
 *    esquecesse de desligar o anterior deixaria 2 e o índice único parcial
 *    `modais_sazonais_um_ativo_por_loja` denunciaria com 23505 (o que também é
 *    vermelho, e por isso a asserção de sucesso é a prova da transação única).
 */

const DONO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aa0000000362";
const DONO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bb0000000362";

const MODAL_A1 = "11111111-1111-4111-8111-aa0000000362";
const MODAL_A2 = "22222222-2222-4222-8222-aa0000000362";
const MODAL_B1 = "33333333-3333-4333-8333-bb0000000362";
const MODAL_B2 = "44444444-4444-4444-8444-bb0000000362";

const INICIO = "2026-06-01T00:00:00-03:00";
const FIM = "2026-06-30T23:59:59-03:00";

/** Satisfaz os CHECKs `modais_sazonais_mensagem_forma`/`_tamanho` (20260927120000). */
const MENSAGEM = {
  versao: 1,
  paragrafos: [{ trechos: [{ texto: "Festa junina na loja" }] }],
};
const MENSAGEM_2 = {
  versao: 1,
  paragrafos: [{ trechos: [{ texto: "Editado pelo admin" }] }],
};

let t: TestDb;
let lojaA: string;
let lojaB: string;
let catA: string;
let catB: string;
let cardA: string;

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

type Papel = "donoA" | "donoB" | "service" | "anon";
function como<T>(papel: Papel, fn: Parameters<TestDb["asService"]>[0]): Promise<T> {
  if (papel === "donoA") return t.asUser(DONO_A, fn) as Promise<T>;
  if (papel === "donoB") return t.asUser(DONO_B, fn) as Promise<T>;
  if (papel === "anon") return t.asAnon(fn) as Promise<T>;
  return t.asService(fn) as Promise<T>;
}

type ArgsSalvar = {
  lojaId: string;
  modalId?: string | null;
  titulo?: string;
  inicio?: string;
  fim?: string;
  mensagem?: unknown;
  mostrarPromocoes?: boolean | null;
  categorias?: string[];
  cardapios?: string[];
};

/** Chamada POSICIONAL da RPC — a assinatura é parte do contrato (não muda). */
async function salvar(papel: Papel, a: ArgsSalvar): Promise<string | undefined> {
  const r = await como<{ rows: Array<{ salvar_modal_sazonal: string }> }>(papel, (s) =>
    s.query(
      `select public.salvar_modal_sazonal(
         $1::uuid, $2::uuid, $3::text, $4::timestamptz, $5::timestamptz,
         $6::jsonb, $7::boolean, $8::uuid[], $9::uuid[]
       ) as salvar_modal_sazonal`,
      [
        a.lojaId,
        a.modalId ?? null,
        a.titulo ?? "Festa junina",
        a.inicio ?? INICIO,
        a.fim ?? FIM,
        a.mensagem === undefined ? JSON.stringify(MENSAGEM) : JSON.stringify(a.mensagem),
        a.mostrarPromocoes ?? null,
        a.categorias ?? [],
        a.cardapios ?? [],
      ],
    ),
  );
  return r.rows[0]?.salvar_modal_sazonal;
}

/** Overload de 1 arg (lojista) — INTACTO. */
async function ativar1(papel: Papel, modalId: string) {
  return como(papel, (s) =>
    s.query(`select public.ativar_modal_sazonal($1::uuid)`, [modalId]),
  );
}

/** Overload de 2 args (serviço) — NOVO; hoje 42883. */
async function ativar2(papel: Papel, modalId: string, lojaId: string) {
  return como(papel, (s) =>
    s.query(`select public.ativar_modal_sazonal($1::uuid, $2::uuid)`, [modalId, lojaId]),
  );
}

// ── Snapshot COMPLETO (com ids e junções) dos modais de uma loja ─────────────
type ModalLido = {
  id: string;
  loja_id: string;
  titulo: string;
  ativo: boolean;
  mensagem: unknown;
  mostrar_promocoes_junto: boolean;
  exibicao_inicio: string;
  exibicao_fim: string;
  categorias: string[];
  cardapios: string[];
};

async function modaisDa(lojaId: string): Promise<ModalLido[]> {
  const r = await t.asService((s) =>
    s.query<ModalLido>(
      `select m.id, m.loja_id, m.titulo, m.ativo, m.mensagem, m.mostrar_promocoes_junto,
              m.exibicao_inicio, m.exibicao_fim,
              coalesce((select array_agg(c.categoria_id::text order by c.categoria_id)
                          from public.modal_sazonal_categorias c
                         where c.modal_sazonal_id = m.id), '{}') as categorias,
              coalesce((select array_agg(k.cardapio_id::text order by k.cardapio_id)
                          from public.modal_sazonal_cardapios k
                         where k.modal_sazonal_id = m.id), '{}') as cardapios
         from public.modais_sazonais m
        where m.loja_id = $1
        order by m.titulo, m.id`,
      [lojaId],
    ),
  );
  return r.rows;
}

/** Ids dos modais ATIVOS da loja — o invariante de RN-M16 em uma linha. */
async function ativosDa(lojaId: string): Promise<string[]> {
  return (await modaisDa(lojaId)).filter((m) => m.ativo).map((m) => m.id);
}

type Semente = { id: string; titulo: string; ativo: boolean; comSelecao?: boolean };

/** Estado CONHECIDO e não vazio: um ativo + um rascunho, com junções. */
async function semear(lojaId: string, sementes: Semente[], catId: string, cardId?: string) {
  await t.asService(async (s) => {
    await s.query(`delete from public.modais_sazonais where loja_id = $1`, [lojaId]);
    for (const m of sementes) {
      await s.query(
        `insert into public.modais_sazonais
           (id, loja_id, titulo, ativo, exibicao_inicio, exibicao_fim, mensagem, mostrar_promocoes_junto)
         values ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb, false)`,
        [m.id, lojaId, m.titulo, m.ativo, INICIO, FIM, JSON.stringify(MENSAGEM)],
      );
      if (m.comSelecao) {
        await s.query(
          `insert into public.modal_sazonal_categorias (loja_id, modal_sazonal_id, categoria_id)
           values ($1, $2, $3)`,
          [lojaId, m.id, catId],
        );
        if (cardId) {
          await s.query(
            `insert into public.modal_sazonal_cardapios (loja_id, modal_sazonal_id, cardapio_id)
             values ($1, $2, $3)`,
            [lojaId, m.id, cardId],
          );
        }
      }
    }
  });
}

async function semearAmbas() {
  await semear(
    lojaA,
    [
      { id: MODAL_A1, titulo: "A1 ativo", ativo: true, comSelecao: true },
      { id: MODAL_A2, titulo: "A2 rascunho", ativo: false },
    ],
    catA,
    cardA,
  );
  await semear(
    lojaB,
    [
      { id: MODAL_B1, titulo: "B1 ativo", ativo: true, comSelecao: true },
      { id: MODAL_B2, titulo: "B2 rascunho", ativo: false },
    ],
    catB,
  );
}

const mesmoInstante = (lido: string, esperado: string) =>
  expect(new Date(lido).toISOString()).toBe(new Date(esperado).toISOString());

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-a-362@teste.local'), ($2, 'dono-b-362@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
  const lojas = await t.asService((s) =>
    s.query<{ id: string; slug: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values
         ($1, 'loja-a-362', 'Loja A 362', true), ($2, 'loja-b-362', 'Loja B 362', true)
       returning id, slug`,
      [DONO_A, DONO_B],
    ),
  );
  lojaA = lojas.rows.find((l) => l.slug === "loja-a-362")!.id;
  lojaB = lojas.rows.find((l) => l.slug === "loja-b-362")!.id;

  const cats = await t.asService((s) =>
    s.query<{ id: string; loja_id: string }>(
      `insert into public.categorias (loja_id, nome) values ($1, 'Doces 362'), ($2, 'Salgados 362')
       returning id, loja_id`,
      [lojaA, lojaB],
    ),
  );
  catA = cats.rows.find((c) => c.loja_id === lojaA)!.id;
  catB = cats.rows.find((c) => c.loja_id === lojaB)!.id;

  const cards = await t.asService((s) =>
    s.query<{ id: string }>(
      `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim, ativo)
       values ($1, 'Junino 362', 'recorrente', array[1,2,3,4,5]::smallint[], time '11:00', time '15:00', true)
       returning id`,
      [lojaA],
    ),
  );
  cardA = cards.rows[0].id;
}, 60_000);

afterAll(async () => {
  await t?.close();
});

// ═══════════════════════════════════ 1. via de serviço grava (salvar_modal_sazonal)
describe("[362] salvar_modal_sazonal — via de serviço (admin na loja-alvo)", () => {
  it("service_role CRIA na loja A: linha + mensagem + junções gravadas juntas (RN-M15); nasce rascunho; B intacta", async () => {
    await semearAmbas();
    const bAntes = await modaisDa(lojaB);
    expect(bAntes).toHaveLength(2); // estado conhecido e não vazio

    const id = await salvar("service", {
      lojaId: lojaA,
      titulo: "Criado pelo admin",
      categorias: [catA],
      cardapios: [cardA],
    });

    expect(id).toBeTruthy();
    const criado = (await modaisDa(lojaA)).find((m) => m.id === id);
    expect(criado).toBeDefined();
    expect(criado!.loja_id).toBe(lojaA);
    expect(criado!.titulo).toBe("Criado pelo admin");
    expect(criado!.mensagem).toEqual(MENSAGEM);
    expect(criado!.categorias).toEqual([catA]);
    expect(criado!.cardapios).toEqual([cardA]);
    // `ativo` NUNCA é escrito por salvar (transição de estado é de ativar, RN-05).
    expect(criado!.ativo).toBe(false);
    mesmoInstante(criado!.exibicao_inicio, INICIO);
    mesmoInstante(criado!.exibicao_fim, FIM);
    // o ativo da loja A continua sendo o que já era
    expect(await ativosDa(lojaA)).toEqual([MODAL_A1]);

    expect(await modaisDa(lojaB)).toEqual(bAntes);
  });

  it("service_role EDITA modal de A (p_modal_id + p_loja_id de A): título, mensagem e junções SUBSTITUÍDOS; B intacta", async () => {
    await semearAmbas();
    const bAntes = await modaisDa(lojaB);

    const id = await salvar("service", {
      lojaId: lojaA,
      modalId: MODAL_A1,
      titulo: "A1 editado pelo admin",
      mensagem: MENSAGEM_2,
      categorias: [],
      cardapios: [cardA],
    });

    expect(id).toBe(MODAL_A1);
    const editado = (await modaisDa(lojaA)).find((m) => m.id === MODAL_A1)!;
    expect(editado.titulo).toBe("A1 editado pelo admin");
    expect(editado.mensagem).toEqual(MENSAGEM_2);
    expect(editado.categorias).toEqual([]); // a junção anterior foi APAGADA
    expect(editado.cardapios).toEqual([cardA]);
    expect(editado.ativo).toBe(true); // editar não mexe no estado

    expect(await modaisDa(lojaB)).toEqual(bAntes);
  });

  it("service_role com p_modal_id de B e p_loja_id de A ⇒ P0001 'modal inexistente'; B INTACTA (snapshot com ids, bloco separado)", async () => {
    await semearAmbas();
    const bAntes = await modaisDa(lojaB);
    const aAntes = await modaisDa(lojaA);
    expect(bAntes).toHaveLength(2);

    esperarErro(
      await erroDe(
        salvar("service", {
          lojaId: lojaA,
          modalId: MODAL_B1,
          titulo: "Sequestro de modal",
          mensagem: MENSAGEM_2,
          categorias: [catA],
        }),
      ),
      "P0001",
      "modal_sazonal: modal inexistente",
    );

    // Releitura em bloco `asService` SEPARADO, depois da exceção.
    expect(await modaisDa(lojaB)).toEqual(bAntes);
    expect(await modaisDa(lojaA)).toEqual(aAntes);
  });

  it("CONTRAPESO: service_role com p_modal_id E p_loja_id de B GRAVA (a via de serviço é legítima na loja certa)", async () => {
    // Contrapeso: sem este caso, uma função que sempre recusasse passaria no de cima.
    await semearAmbas();
    const aAntes = await modaisDa(lojaA);

    const id = await salvar("service", {
      lojaId: lojaB,
      modalId: MODAL_B2,
      titulo: "B2 editado pelo admin",
      mensagem: MENSAGEM_2,
      categorias: [catB],
    });

    expect(id).toBe(MODAL_B2);
    const editado = (await modaisDa(lojaB)).find((m) => m.id === MODAL_B2)!;
    expect(editado.titulo).toBe("B2 editado pelo admin");
    expect(editado.categorias).toEqual([catB]);
    expect(await modaisDa(lojaA)).toEqual(aAntes);
  });
});

// ═══════════════════════ 2. overload de 2 args — ativação pela via de serviço
describe("[362] ativar_modal_sazonal(p_modal_id, p_loja_id) — overload de serviço", () => {
  it("service_role ativa o rascunho de A: o alvo fica ativo e o anterior é desligado na MESMA transação (RN-M16)", async () => {
    await semearAmbas();
    expect(await ativosDa(lojaA)).toEqual([MODAL_A1]);
    const bAntes = await modaisDa(lojaB);

    await ativar2("service", MODAL_A2, lojaA);

    // Exatamente UM ativo, e é o alvo: nunca dois, nunca zero.
    expect(await ativosDa(lojaA)).toEqual([MODAL_A2]);
    expect(await modaisDa(lojaB)).toEqual(bAntes);
  });

  it("idempotente: ativar o que JÁ está ativo mantém um único ativo, sem erro", async () => {
    await semearAmbas();

    await ativar2("service", MODAL_A1, lojaA);

    expect(await ativosDa(lojaA)).toEqual([MODAL_A1]);
  });

  it("ESCOPO: service_role com (modal de B, loja A) ⇒ P0001 'modal inexistente'; ativos de A e B INTACTOS", async () => {
    await semearAmbas();
    const aAntes = await modaisDa(lojaA);
    const bAntes = await modaisDa(lojaB);

    esperarErro(
      await erroDe(ativar2("service", MODAL_B2, lojaA)),
      "P0001",
      "modal_sazonal: modal inexistente",
    );

    // Releitura em bloco separado: nem B ganhou ativo novo, nem A perdeu o seu
    // (uma implementação que desligasse o anterior ANTES de conferir o escopo
    // deixaria A com zero ativos — o defeito que RN-M16 existe para impedir).
    expect(await modaisDa(lojaA)).toEqual(aAntes);
    expect(await modaisDa(lojaB)).toEqual(bAntes);
    expect(await ativosDa(lojaA)).toEqual([MODAL_A1]);
    expect(await ativosDa(lojaB)).toEqual([MODAL_B1]);
  });

  it("ESCOPO: service_role com (modal de A, loja B) ⇒ P0001 'modal inexistente'; nada muda nas duas lojas", async () => {
    await semearAmbas();
    const aAntes = await modaisDa(lojaA);
    const bAntes = await modaisDa(lojaB);

    esperarErro(
      await erroDe(ativar2("service", MODAL_A2, lojaB)),
      "P0001",
      "modal_sazonal: modal inexistente",
    );

    expect(await modaisDa(lojaA)).toEqual(aAntes);
    expect(await modaisDa(lojaB)).toEqual(bAntes);
  });

  it("ESCOPO: service_role com modal INEXISTENTE ⇒ MESMA mensagem 'modal inexistente' (sem oráculo de existência)", async () => {
    await semearAmbas();
    const aAntes = await modaisDa(lojaA);

    esperarErro(
      await erroDe(ativar2("service", "99999999-9999-4999-8999-999999999362", lojaA)),
      "P0001",
      "modal_sazonal: modal inexistente",
    );

    expect(await modaisDa(lojaA)).toEqual(aAntes);
  });

  it("o overload de 2 args é INALCANÇÁVEL por sessão authenticated, mesmo com claim role FORJADO 'service_role' ⇒ 42501", async () => {
    // Os dois sinais de `v_e_servico` divergem só por forja ou bug de pool: o
    // claim diz service_role, o role SQL efetivo continua 'authenticated'. Aqui
    // a primeira camada é o próprio ACL (grant só a service_role), então o
    // 42501 chega ANTES do corpo da função — fail-closed por construção.
    await semearAmbas();
    const aAntes = await modaisDa(lojaA);

    const erro = await erroDe(
      (async () => {
        await t.db.exec("begin");
        try {
          await t.db.query("set local role authenticated");
          await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: DONO_A, role: "service_role" }),
          ]);
          await t.db.query(`select public.ativar_modal_sazonal($1::uuid, $2::uuid)`, [
            MODAL_A2,
            lojaA,
          ]);
          await t.db.exec("commit");
        } catch (e) {
          await t.db.exec("rollback");
          throw e;
        }
      })(),
    );
    esperarErro(erro, "42501", "ativar_modal_sazonal");

    expect(await modaisDa(lojaA)).toEqual(aAntes);
  });
});

// ═══════════════════════════════ 3. não-regressão da via do LOJISTA (1 arg)
describe("[362] não-regressão: o caminho do dono continua byte-idêntico", () => {
  it("dono de A CRIA por salvar_modal_sazonal (linha + mensagem + junções); B intacta", async () => {
    await semearAmbas();
    const bAntes = await modaisDa(lojaB);

    const id = await salvar("donoA", {
      lojaId: lojaA,
      titulo: "Criado pelo lojista",
      categorias: [catA],
      cardapios: [cardA],
    });

    expect(id).toBeTruthy();
    const criado = (await modaisDa(lojaA)).find((m) => m.id === id)!;
    expect(criado.titulo).toBe("Criado pelo lojista");
    expect(criado.mensagem).toEqual(MENSAGEM);
    expect(criado.categorias).toEqual([catA]);
    expect(criado.cardapios).toEqual([cardA]);
    expect(criado.ativo).toBe(false);
    expect(await modaisDa(lojaB)).toEqual(bAntes);
  });

  it("dono de A ATIVA pelo overload de 1 ARG: alvo ativo, anterior desligado (o 1-arg não foi tocado)", async () => {
    await semearAmbas();
    expect(await ativosDa(lojaA)).toEqual([MODAL_A1]);

    await ativar1("donoA", MODAL_A2);

    expect(await ativosDa(lojaA)).toEqual([MODAL_A2]);
  });

  it("autenticado SEM posse (dono de B) com p_loja_id de A ⇒ P0001 'sem posse' (não o 42501 acidental da RLS); A intacta", async () => {
    await semearAmbas();
    const aAntes = await modaisDa(lojaA);

    esperarErro(
      await erroDe(
        salvar("donoB", { lojaId: lojaA, titulo: "Invasão", categorias: [catA] }),
      ),
      "P0001",
      "modal_sazonal: sem posse",
    );

    expect(await modaisDa(lojaA)).toEqual(aAntes);
  });

  it("autenticado SEM posse editando modal de A (p_modal_id de A, p_loja_id de A) ⇒ 'sem posse'; A intacta", async () => {
    await semearAmbas();
    const aAntes = await modaisDa(lojaA);

    esperarErro(
      await erroDe(
        salvar("donoB", {
          lojaId: lojaA,
          modalId: MODAL_A1,
          titulo: "Invasão por edição",
          mensagem: MENSAGEM_2,
        }),
      ),
      "P0001",
      "modal_sazonal: sem posse",
    );

    expect(await modaisDa(lojaA)).toEqual(aAntes);
  });

  it("autenticado SEM posse ativando modal de A pelo 1-arg ⇒ P0001 'modal inexistente'; ativos de A intactos", async () => {
    await semearAmbas();
    const aAntes = await modaisDa(lojaA);

    esperarErro(
      await erroDe(ativar1("donoB", MODAL_A2)),
      "P0001",
      "modal_sazonal: modal inexistente",
    );

    expect(await modaisDa(lojaA)).toEqual(aAntes);
    expect(await ativosDa(lojaA)).toEqual([MODAL_A1]);
  });

  it("anon continua recusado nas DUAS funções (42501 nomeando a função); A intacta", async () => {
    await semearAmbas();
    const aAntes = await modaisDa(lojaA);

    esperarErro(
      await erroDe(salvar("anon", { lojaId: lojaA, titulo: "Anon" })),
      "42501",
      "salvar_modal_sazonal",
    );
    esperarErro(await erroDe(ativar1("anon", MODAL_A2)), "42501", "ativar_modal_sazonal");
    esperarErro(await erroDe(ativar2("anon", MODAL_A2, lojaA)), "42501", "ativar_modal_sazonal");

    expect(await modaisDa(lojaA)).toEqual(aAntes);
  });
});

// ═══════════════════════════════════════════════════════════════ 4. catálogo
describe("[362] catálogo das funções", () => {
  const SALVAR =
    "public.salvar_modal_sazonal(uuid, uuid, text, timestamptz, timestamptz, jsonb, boolean, uuid[], uuid[])";
  const ATIVAR_1 = "public.ativar_modal_sazonal(uuid)";
  const ATIVAR_2 = "public.ativar_modal_sazonal(uuid, uuid)";

  async function priv(assinatura: string) {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
      [assinatura],
    );
    return r.rows[0];
  }

  async function catalogo(assinatura: string) {
    const r = await t.db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where oid = $1::regprocedure`,
      [assinatura],
    );
    return r.rows[0];
  }

  it("as DUAS assinaturas de ativar_modal_sazonal coexistem (overload de 2 args SEM `default`, senão a de 1 arg viraria ambígua)", async () => {
    const r = await t.db.query<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'ativar_modal_sazonal'`,
    );
    expect(r.rows[0].n).toBe(2);
    // Nenhum dos dois tem argumento com default: `pronargdefaults = 0`.
    const d = await t.db.query<{ comdefault: number }>(
      `select count(*)::int as comdefault
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'ativar_modal_sazonal'
          and p.pronargdefaults > 0`,
    );
    expect(d.rows[0].comdefault).toBe(0);
  });

  it("overload de 2 args: SECURITY INVOKER e search_path fixado", async () => {
    const c = await catalogo(ATIVAR_2);
    expect(c.prosecdef).toBe(false);
    expect((c.proconfig ?? []).some((x) => x.startsWith("search_path="))).toBe(true);
  });

  it("EXECUTE do overload de 2 args: SÓ service_role (anon e authenticated revogados EXPLICITAMENTE)", async () => {
    expect(await priv(ATIVAR_2)).toEqual({ anon: false, auth: false, svc: true });
  });

  it("salvar_modal_sazonal: authenticated E service_role executam; anon não", async () => {
    expect(await priv(SALVAR)).toEqual({ anon: false, auth: true, svc: true });
    const c = await catalogo(SALVAR);
    expect(c.prosecdef).toBe(false);
    expect((c.proconfig ?? []).some((x) => x.startsWith("search_path="))).toBe(true);
  });

  it("ativar_modal_sazonal de 1 arg: authenticated continua executando; anon não", async () => {
    const p = await priv(ATIVAR_1);
    expect(p.anon).toBe(false);
    expect(p.auth).toBe(true);
  });
});
