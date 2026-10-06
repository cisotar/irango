import { describe, it, expect } from "vitest";

/**
 * Fase RED (TDD) — galeria de imagens da loja, contrato NEUTRO
 * (`src/lib/actions/galeria-contrato.ts`, sem I/O, sem `'use server'`).
 *
 * Por que é RED hoje: o módulo `./galeria-contrato` ainda não existe — o import
 * falha na coleta. A fase GREEN (`executar`) cria o módulo com estes nomes.
 *
 * O contrato é a fonte única dos dois mundos (lojista e admin): constantes do
 * spec (D6, P11, P9, D10), montadores de caminho do Storage (RN-G16), a trava de
 * prefixo usada antes de todo `storage.remove` (Segurança item 5, admin item 4),
 * os reconhecedores dos erros do banco (trigger de M4, trigger de origem
 * pendente, deadlock) e as mensagens literais que o lojista lê.
 */

import {
  TETO_IMAGENS_POR_LOJA,
  MAXIMO_LOTE_REMOCAO,
  POR_PAGINA_GALERIA,
  LADO_MAXIMO_ORIGINAL,
  LADO_MINIATURA,
  LARGURA_MINIMA_RECOMENDADA_PRODUTO,
  LARGURA_MINIMA_RECOMENDADA_LOGO,
  CAMPO_MINIATURA,
  CAMPO_ORIGEM,
  caminhoOriginal,
  caminhoMiniatura,
  caminhoRecorte,
  caminhoDaLoja,
  urlParaRecorte,
  ehErroImagemForaDaGaleria,
  ehErroOrigemIndisponivel,
  ehDeadlock,
  MSG_FOTO_REMOVIDA_DA_GALERIA,
  MSG_TENTE_DE_NOVO,
  MSG_TETO,
  MSG_ORIGEM_REMOVIDA,
  MSG_RECORTE_FALHOU,
  mensagemResultadoRemocao,
} from "./galeria-contrato";
import { CAMPO_ARQUIVO } from "./upload-contrato";

const LOJA = "11111111-1111-1111-1111-111111111111";
const OUTRA = "22222222-2222-2222-2222-222222222222";
const ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("constantes do spec (D6, P11, P9, D7, D10)", () => {
  it("teto, lote, página e lados", () => {
    expect(TETO_IMAGENS_POR_LOJA).toBe(200);
    expect(MAXIMO_LOTE_REMOCAO).toBe(50);
    expect(POR_PAGINA_GALERIA).toBe(40);
    expect(LADO_MAXIMO_ORIGINAL).toBe(2048);
    expect(LADO_MINIATURA).toBe(400);
    expect(LARGURA_MINIMA_RECOMENDADA_PRODUTO).toBe(800);
    expect(LARGURA_MINIMA_RECOMENDADA_LOGO).toBe(400);
  });

  it("campos do FormData: miniatura e origem_id, distintos do campo do arquivo", () => {
    expect(CAMPO_MINIATURA).toBe("miniatura");
    expect(CAMPO_ORIGEM).toBe("origem_id");
    expect(CAMPO_MINIATURA).not.toBe(CAMPO_ARQUIVO);
    expect(CAMPO_ORIGEM).not.toBe(CAMPO_ARQUIVO);
  });
});

describe("montadores de caminho (RN-G16, relativos ao bucket, sem prefixo produtos/)", () => {
  it("original: {loja}/galeria/{id}.{ext}", () => {
    expect(caminhoOriginal(LOJA, ID, "webp")).toBe(`${LOJA}/galeria/${ID}.webp`);
    expect(caminhoOriginal(LOJA, ID, "jpg")).toBe(`${LOJA}/galeria/${ID}.jpg`);
  });

  it("miniatura: {loja}/galeria/mini/{id}.webp (sempre webp)", () => {
    expect(caminhoMiniatura(LOJA, ID)).toBe(`${LOJA}/galeria/mini/${ID}.webp`);
  });

  it("recorte de produto: {loja}/{id}.{ext} (igual a hoje)", () => {
    expect(caminhoRecorte(LOJA, "produto", ID, "webp")).toBe(`${LOJA}/${ID}.webp`);
  });

  it("recorte de logo: {loja}/logo/{id}.{ext} (igual a hoje)", () => {
    expect(caminhoRecorte(LOJA, "logo", ID, "png")).toBe(`${LOJA}/logo/${ID}.png`);
  });

  it("todo caminho montado passa na trava de prefixo da própria loja", () => {
    for (const c of [
      caminhoOriginal(LOJA, ID, "webp"),
      caminhoMiniatura(LOJA, ID),
      caminhoRecorte(LOJA, "produto", ID, "webp"),
      caminhoRecorte(LOJA, "logo", ID, "webp"),
    ]) {
      expect(c.startsWith("produtos/")).toBe(false);
      expect(caminhoDaLoja(c, LOJA)).toBe(true);
      expect(caminhoDaLoja(c, OUTRA)).toBe(false);
    }
  });
});

describe("caminhoDaLoja — trava de prefixo antes de todo storage.remove", () => {
  it.each([
    [`${LOJA}/x.webp`],
    [`${LOJA}/logo/x.webp`],
    [`${LOJA}/galeria/mini/x.webp`],
  ])("aceita caminho da própria loja: %s", (c) => {
    expect(caminhoDaLoja(c, LOJA)).toBe(true);
  });

  it.each([
    ["outra loja", `${OUTRA}/x.webp`],
    ["traversal saindo da pasta", `${LOJA}/../${OUTRA}/x.webp`],
    ["traversal no meio", `${LOJA}/galeria/../../${OUTRA}/x.webp`],
    ["prefixo sem a barra (colisão de id)", `${LOJA}0/x.webp`],
    ["só o id da loja, sem objeto", LOJA],
    ["prefixado pelo bucket", `produtos/${LOJA}/x.webp`],
    ["loja no meio do caminho", `${OUTRA}/${LOJA}/x.webp`],
    ["vazio", ""],
  ])("recusa %s", (_rotulo, c) => {
    expect(caminhoDaLoja(c, LOJA)).toBe(false);
  });
});

describe("urlParaRecorte — URL que o service worker nunca guardou (?recorte=1)", () => {
  const base = `https://projeto-teste.supabase.co/storage/v1/object/public/produtos/${LOJA}/galeria/${ID}.webp`;

  it("acrescenta recorte=1 a uma URL sem query", () => {
    expect(urlParaRecorte(base)).toBe(`${base}?recorte=1`);
  });

  it("preserva a query existente e acrescenta recorte=1", () => {
    const u = new URL(urlParaRecorte(`${base}?v=2`));
    expect(u.searchParams.get("v")).toBe("2");
    expect(u.searchParams.get("recorte")).toBe("1");
    expect(u.pathname).toBe(new URL(base).pathname);
  });
});

describe("reconhecedores de erro do banco (par errcode + fragmento literal)", () => {
  it("imagem_fora_da_galeria: P0001 + mensagem do trigger de M4", () => {
    expect(
      ehErroImagemForaDaGaleria({ code: "P0001", message: "imagem_fora_da_galeria" }),
    ).toBe(true);
  });

  it.each([
    ["P0001 com outra mensagem", { code: "P0001", message: "outra coisa" }],
    ["fragmento com outro errcode", { code: "23505", message: "imagem_fora_da_galeria" }],
    ["null", null],
    ["string crua", "imagem_fora_da_galeria"],
    ["objeto vazio", {}],
  ])("imagem_fora_da_galeria NÃO reconhece %s", (_r, e) => {
    expect(ehErroImagemForaDaGaleria(e)).toBe(false);
  });

  it("origem indisponível: 23503 + mensagem do trigger de imagens_loja", () => {
    expect(
      ehErroOrigemIndisponivel({
        code: "23503",
        message: "imagens_loja: origem indisponível",
      }),
    ).toBe(true);
  });

  it.each([
    [
      "FK de outra tabela (23503 sem o fragmento)",
      {
        code: "23503",
        message:
          'insert or update on table "produtos" violates foreign key constraint "produtos_categoria_id_fkey"',
      },
    ],
    ["fragmento com outro errcode", { code: "P0001", message: "imagens_loja: origem indisponível" }],
    ["undefined", undefined],
  ])("origem indisponível NÃO reconhece %s", (_r, e) => {
    expect(ehErroOrigemIndisponivel(e)).toBe(false);
  });

  it("deadlock: errcode 40P01", () => {
    expect(ehDeadlock({ code: "40P01", message: "deadlock detected" })).toBe(true);
  });

  it.each([
    ["serialization_failure 40001", { code: "40001", message: "could not serialize" }],
    ["sem code", { message: "deadlock detected" }],
    ["null", null],
  ])("deadlock NÃO reconhece %s", (_r, e) => {
    expect(ehDeadlock(e)).toBe(false);
  });
});

describe("mensagens literais do spec", () => {
  it("textos exatos", () => {
    expect(MSG_FOTO_REMOVIDA_DA_GALERIA).toBe(
      "A foto escolhida foi removida da galeria. Escolha outra.",
    );
    expect(MSG_TENTE_DE_NOVO).toBe("Não foi possível salvar. Tente de novo.");
    expect(MSG_TETO).toBe(
      "Você chegou a 200 imagens. Remova as que não usa para enviar novas.",
    );
    expect(MSG_ORIGEM_REMOVIDA).toBe("Essa imagem foi removida da galeria.");
    expect(MSG_RECORTE_FALHOU).toBe(
      "A imagem foi para a galeria, mas o recorte falhou. Tente de novo pela galeria.",
    );
  });

  it("nenhuma mensagem expõe termo técnico do banco", () => {
    for (const m of [
      MSG_FOTO_REMOVIDA_DA_GALERIA,
      MSG_TENTE_DE_NOVO,
      MSG_TETO,
      MSG_ORIGEM_REMOVIDA,
      MSG_RECORTE_FALHOU,
    ]) {
      expect(m).not.toMatch(/imagem_fora_da_galeria|40P01|deadlock|imagens_loja|P0001/);
    }
  });
});

describe("mensagemResultadoRemocao — números do servidor, não da seleção", () => {
  it("exemplo do spec: removidas + produtos limpos", () => {
    expect(
      mensagemResultadoRemocao({ removidas: 3, ignoradas: 0, produtosLimpos: 2, logoLimpa: false }),
    ).toBe("3 imagens removidas. 2 produtos ficaram sem foto.");
  });

  it("exemplo do spec: removidas + ignoradas (D8)", () => {
    expect(
      mensagemResultadoRemocao({ removidas: 4, ignoradas: 1, produtosLimpos: 0, logoLimpa: false }),
    ).toBe("4 imagens removidas. 1 já tinha sido removida.");
  });

  it("exemplo do spec: nenhuma válida", () => {
    expect(
      mensagemResultadoRemocao({ removidas: 0, ignoradas: 2, produtosLimpos: 0, logoLimpa: false }),
    ).toBe("As imagens selecionadas já tinham sido removidas.");
  });

  it("singular: 1 imagem, 1 produto", () => {
    expect(
      mensagemResultadoRemocao({ removidas: 1, ignoradas: 0, produtosLimpos: 1, logoLimpa: false }),
    ).toBe("1 imagem removida. 1 produto ficou sem foto.");
  });

  it("só removidas, sem efeito colateral", () => {
    expect(
      mensagemResultadoRemocao({ removidas: 1, ignoradas: 0, produtosLimpos: 0, logoLimpa: false }),
    ).toBe("1 imagem removida.");
  });

  it("plural das ignoradas", () => {
    expect(
      mensagemResultadoRemocao({ removidas: 2, ignoradas: 3, produtosLimpos: 0, logoLimpa: false }),
    ).toBe("2 imagens removidas. 3 já tinham sido removidas.");
  });

  it("logo limpa entra depois dos produtos e antes das ignoradas", () => {
    expect(
      mensagemResultadoRemocao({ removidas: 3, ignoradas: 1, produtosLimpos: 2, logoLimpa: true }),
    ).toBe("3 imagens removidas. 2 produtos ficaram sem foto. A loja ficou sem logo. 1 já tinha sido removida.");
  });

  it("logo limpa sem produtos", () => {
    expect(
      mensagemResultadoRemocao({ removidas: 1, ignoradas: 0, produtosLimpos: 0, logoLimpa: true }),
    ).toBe("1 imagem removida. A loja ficou sem logo.");
  });
});
