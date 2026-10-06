import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestDb } from "../helpers/pglite";
import {
  criarLoja,
  criarProduto,
  erroDe,
  esperarErro,
  estadoDa,
  gravarLegado,
  imagem,
  registrarImagem,
  urlStorage,
} from "../helpers/galeria";

/**
 * Travas de regressão vindas da auditoria do vetor de banco da galeria (M1–M4).
 *
 * 1. AFTER `galeria_marca_recorte_sem_uso` é SECURITY DEFINER: o único filtro que
 *    impede o lojista A de marcar pendente (e a action apagar do Storage) um
 *    recorte da loja B é `i.loja_id = v_loja`. Os testes "mesmo nome de arquivo"
 *    da suíte usam caminhos distintos e passam sem esse filtro. Aqui o produto de
 *    A guarda a URL EXATA do recorte de B (estado alcançável na janela entre o
 *    1º push e M4, quando não há trigger BEFORE).
 * 2. TOCTOU recorte × remoção: cópia de original já pendente é recusada
 *    (`imagens_loja_origem_disponivel_trg`); sem isso o DELETE da original levaria
 *    em cascata a linha de uma cópia em uso (produto com foto sem registro).
 * 3. INSERT de `lojas` também passa por `lojas_logo_na_galeria_trg`.
 * 4. Mudar `produtos.loja_id` mantendo a `foto_url` passa pelo BEFORE.
 * 5. CHECK de caminho recusa `%`, `?`, `#`, `\` e `//` (`%2e%2e` normalizado
 *    pelo navegador exibiria imagem de outra loja).
 */

const DONO_A = "a7a5e000-0000-4000-8000-0000000000a7";
const DONO_B = "b7a5e000-0000-4000-8000-0000000000b7";
const DONO_N = "e7a5e000-0000-4000-8000-0000000000e7";

let t: TestDb;
let lojaA: string;
let lojaB: string;

beforeAll(async () => {
  t = await createTestDb();
  lojaA = await criarLoja(t, DONO_A, "galeria-poc-a");
  lojaB = await criarLoja(t, DONO_B, "galeria-poc-b");
}, 60_000);

afterAll(async () => {
  await t?.close();
});

async function recorteDe(lojaId: string) {
  const o = await registrarImagem(t, lojaId, `${lojaId}/galeria/${randomUUID()}.webp`);
  const cam = `${lojaId}/${randomUUID()}.webp`;
  const r = await registrarImagem(t, lojaId, cam, { origemId: o });
  return { o, r, cam };
}

describe("[auditoria] AFTER DEFINER não alcança recorte de outra loja (URL idêntica)", () => {
  it("produto de A com a URL EXATA do recorte de B; A zera a foto ⇒ recorte de B não fica pendente", async () => {
    const b = await recorteDe(lojaB);
    const p = await criarProduto(t, lojaA, { fotoUrl: null });
    await gravarLegado(t, `update public.produtos set foto_url = $2 where id = $1`, [p, urlStorage(b.cam)]);
    const bAntes = await estadoDa(t, lojaB);

    await t.asUser(DONO_A, (s) => s.query(`update public.produtos set foto_url = null where id = $1`, [p]));

    expect((await imagem(t, b.r))?.remocao_pendente_em).toBeNull();
    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });

  it("idem com DELETE do produto de A", async () => {
    const b = await recorteDe(lojaB);
    const p = await criarProduto(t, lojaA, { fotoUrl: null });
    await gravarLegado(t, `update public.produtos set foto_url = $2 where id = $1`, [p, urlStorage(b.cam)]);

    await t.asUser(DONO_A, (s) => s.query(`delete from public.produtos where id = $1`, [p]));

    expect((await imagem(t, b.r))?.remocao_pendente_em).toBeNull();
  });

  it("idem com a logo de A apontando para o recorte de B", async () => {
    const b = await recorteDe(lojaB);
    await gravarLegado(t, `update public.lojas set logo_url = $2 where id = $1`, [lojaA, urlStorage(b.cam)]);

    await t.asUser(DONO_A, (s) => s.query(`update public.lojas set logo_url = null where id = $1`, [lojaA]));

    expect((await imagem(t, b.r))?.remocao_pendente_em).toBeNull();
  });
});

describe("[auditoria] TOCTOU: cópia de original já pendente é recusada", () => {
  it("remoção commitada, depois INSERT da cópia ⇒ 23503 'origem indisponível'; nada gravado", async () => {
    const o = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    await t.asUser(DONO_A, (s) => s.query(`select public.remover_imagens_loja($1, $2::uuid[])`, [lojaA, [o]]));
    expect((await imagem(t, o))?.remocao_pendente_em).not.toBeNull();

    const camX3 = `${lojaA}/${randomUUID()}.webp`;
    esperarErro(
      await erroDe(
        t.asUser(DONO_A, (s) =>
          s.query(`insert into public.imagens_loja (loja_id, origem_id, caminho) values ($1, $2, $3)`, [lojaA, o, camX3]),
        ),
      ),
      "23503",
      "origem indisponível",
    );
    const r = await t.asService((s) => s.query(`select 1 from public.imagens_loja where caminho = $1`, [camX3]));
    expect(r.rows).toHaveLength(0);
  });

  it("controle: cópia de original disponível é aceita", async () => {
    const o = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const camX = `${lojaA}/${randomUUID()}.webp`;
    expect(
      await erroDe(
        t.asUser(DONO_A, (s) =>
          s.query(`insert into public.imagens_loja (loja_id, origem_id, caminho) values ($1, $2, $3)`, [lojaA, o, camX]),
        ),
      ),
    ).toBeNull();
  });
});

describe("[auditoria] INSERT de lojas passa pelo trigger de logo", () => {
  it("conta nova cria a própria loja com logo_url externa (https) ⇒ P0001 'imagem_fora_da_galeria'; nenhuma loja criada", async () => {
    await t.db.query(`insert into auth.users (id, email) values ($1, 'poc-n@teste.local') on conflict do nothing`, [DONO_N]);
    esperarErro(
      await erroDe(
        t.asUser(DONO_N, (s) =>
          s.query(`insert into public.lojas (dono_id, slug, nome, logo_url) values ($1, 'galeria-poc-n', 'Loja N', 'https://exemplo.com/pixel.gif')`, [
            DONO_N,
          ]),
        ),
      ),
      "P0001",
      "imagem_fora_da_galeria",
    );
    const r = await t.asService((s) => s.query(`select 1 from public.lojas where dono_id = $1`, [DONO_N]));
    expect(r.rows).toHaveLength(0);
  });

  it("controle: o mesmo valor num UPDATE é recusado pelo trigger", async () => {
    esperarErro(
      await erroDe(
        t.asUser(DONO_A, (s) => s.query(`update public.lojas set logo_url = 'https://exemplo.com/pixel.gif' where id = $1`, [lojaA])),
      ),
      "P0001",
      "imagem_fora_da_galeria",
    );
  });
});

describe("[auditoria] mudar loja_id do produto mantendo a foto", () => {
  it("via de serviço move produto de A para B com a mesma foto_url de A ⇒ P0001; produto intacto em A", async () => {
    const camO = `${lojaA}/galeria/${randomUUID()}.webp`;
    await registrarImagem(t, lojaA, camO);
    const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(camO) });

    esperarErro(
      await erroDe(t.asService((s) => s.query(`update public.produtos set loja_id = $2 where id = $1`, [p, lojaB]))),
      "P0001",
      "imagem_fora_da_galeria",
    );
    const r = await t.asService((s) => s.query<{ loja_id: string; foto_url: string }>(`select loja_id, foto_url from public.produtos where id = $1`, [p]));
    expect(r.rows[0]).toEqual({ loja_id: lojaA, foto_url: urlStorage(camO) });
  });
});

describe("[auditoria] CHECK de caminho recusa caracteres que o navegador normaliza", () => {
  it.each([
    ["%2e%2e", (l: string, b: string) => `${l}/%2e%2e/${b}/x.webp`],
    ["barra dupla", (l: string) => `${l}//x.webp`],
    ["query", (l: string) => `${l}/x.webp?v=1`],
    ["fragmento", (l: string) => `${l}/x.webp#a`],
    ["contrabarra", (l: string) => `${l}/a\\x.webp`],
  ])("caminho com %s ⇒ 23514 imagens_loja_caminho_da_loja", async (_n, montar) => {
    const cam = montar(lojaA, lojaB);
    esperarErro(
      await erroDe(t.asService((s) => s.query(`insert into public.imagens_loja (loja_id, caminho) values ($1, $2)`, [lojaA, cam]))),
      "23514",
      "imagens_loja_caminho_da_loja",
    );
  });

  it("miniatura com %2e%2e ⇒ 23514 imagens_loja_miniatura_da_loja", async () => {
    esperarErro(
      await erroDe(
        t.asService((s) =>
          s.query(`insert into public.imagens_loja (loja_id, caminho, miniatura_caminho) values ($1, $2, $3)`, [
            lojaA,
            `${lojaA}/galeria/${randomUUID()}.webp`,
            `${lojaA}/galeria/mini/%2e%2e/x.webp`,
          ]),
        ),
      ),
      "23514",
      "imagens_loja_miniatura_da_loja",
    );
  });
});

describe("[auditoria] RPCs via de serviço: produto/logo de B com a URL EXATA de imagem de A", () => {
  // Estado alcançável: foto_url não tinha restrição antes de M4, e o BEFORE não
  // existe na janela entre os dois pushes. Sem estes testes, apagar o filtro
  // `loja_id = p_loja_id` dos passos 5–6 de remover_imagens_loja deixa a suíte verde.
  async function cenarioCruzado() {
    const camO = `${lojaA}/galeria/${randomUUID()}.webp`;
    const o = await registrarImagem(t, lojaA, camO);
    const pb = await criarProduto(t, lojaB, { fotoUrl: null });
    await gravarLegado(t, `update public.produtos set foto_url = $2 where id = $1`, [pb, urlStorage(camO)]);
    await gravarLegado(t, `update public.lojas set logo_url = $2 where id = $1`, [lojaB, urlStorage(camO)]);
    return { o, camO, pb };
  }

  it("remover_imagens_loja(A) pela via de serviço não zera produto nem logo de B", async () => {
    const c = await cenarioCruzado();
    const bAntes = await estadoDa(t, lojaB);

    const r = await t.asService((s) =>
      s.query<{ r: { removidas: number; produtos_limpos: number; logo_limpa: boolean } }>(
        `select public.remover_imagens_loja($1, $2::uuid[]) as r`,
        [lojaA, [c.o]],
      ),
    );

    expect(r.rows[0].r).toMatchObject({ removidas: 1, produtos_limpos: 0, logo_limpa: false });
    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
    await gravarLegado(t, `update public.lojas set logo_url = null where id = $1`, [lojaB]);
  });

  it("uso_imagens_loja(A) pela via de serviço não conta produto nem logo de B", async () => {
    const c = await cenarioCruzado();
    const r = await t.asService((s) =>
      s.query<{ produtos_total: number; na_logo: boolean }>(
        `select produtos_total, na_logo from public.uso_imagens_loja($1, $2::uuid[])`,
        [lojaA, [c.o]],
      ),
    );
    expect(r.rows[0]).toEqual({ produtos_total: 0, na_logo: false });
    await gravarLegado(t, `update public.lojas set logo_url = null where id = $1`, [lojaB]);
  });
});
