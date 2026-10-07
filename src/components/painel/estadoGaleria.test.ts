import { describe, it, expect } from "vitest";

import {
  MSG_ENVIO_FALHOU,
  MSG_IMAGEM_INVALIDA,
  MSG_MUITAS_TENTATIVAS,
  MSG_TETO,
  type ImagemGaleria,
  type UsoImagem,
} from "@/lib/actions/galeria-contrato";
import {
  alternarSelecao,
  anexarPagina,
  atingiuTeto,
  descreverRemocao,
  fraseOndeEstaEmUso,
  idsEmUso,
  incluirNoInicio,
  interrompeFila,
  produtosDoUso,
  resumoEnvio,
  rotuloContador,
  rotuloProgressoEnvio,
  rotuloSelecao,
  tirarIds,
} from "./estadoGaleria";

function img(id: string): ImagemGaleria {
  return {
    id,
    url: `https://exemplo.supabase.co/storage/v1/object/public/produtos/l/galeria/${id}.webp`,
    miniatura_url: null,
    criado_em: "2026-10-06T12:00:00.000Z",
  };
}

function uso(
  imagem_id: string,
  produtos: { nome: string; oculto?: boolean }[] = [],
  na_logo = false,
  produtos_total = produtos.length,
): UsoImagem {
  return {
    imagem_id,
    produtos: produtos.map((p, i) => ({ id: `${imagem_id}-p${i}`, nome: p.nome, oculto: p.oculto ?? false })),
    produtos_total,
    na_logo,
  };
}

describe("lista da grade", () => {
  it("incluirNoInicio põe a nova no topo e não duplica", () => {
    const lista = [img("a"), img("b")];
    expect(incluirNoInicio(lista, img("c")).map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(incluirNoInicio(lista, img("b")).map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("anexarPagina acrescenta no fim sem repetir", () => {
    const lista = [img("a"), img("b")];
    expect(anexarPagina(lista, [img("b"), img("c")]).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("tirarIds remove só os ids pedidos", () => {
    expect(tirarIds([img("a"), img("b"), img("c")], ["b", "x"]).map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("seleção", () => {
  it("marca e desmarca", () => {
    const um = alternarSelecao(new Set(), "a");
    expect([...um.selecao]).toEqual(["a"]);
    expect(um.recusada).toBe(false);
    expect([...alternarSelecao(um.selecao, "a").selecao]).toEqual([]);
  });

  it("recusa passar do limite, mas sempre deixa desmarcar", () => {
    const cheia = new Set(["a", "b"]);
    const r = alternarSelecao(cheia, "c", 2);
    expect(r.recusada).toBe(true);
    expect([...r.selecao].sort()).toEqual(["a", "b"]);
    expect(alternarSelecao(cheia, "a", 2).recusada).toBe(false);
  });

  it("o limite padrão é o do lote de remoção (50)", () => {
    const cheia = new Set(Array.from({ length: 50 }, (_, i) => `id${i}`));
    expect(alternarSelecao(cheia, "novo").recusada).toBe(true);
  });

  it("não muta a seleção recebida", () => {
    const original = new Set(["a"]);
    alternarSelecao(original, "b");
    expect([...original]).toEqual(["a"]);
  });

  it("rotuloSelecao", () => {
    expect(rotuloSelecao(0)).toBe("Nenhuma imagem selecionada");
    expect(rotuloSelecao(1)).toBe("1 imagem selecionada");
    expect(rotuloSelecao(3)).toBe("3 imagens selecionadas");
  });
});

describe("contador e teto (D6)", () => {
  it("rotuloContador", () => {
    expect(rotuloContador(37)).toBe("37 de 200 imagens");
  });

  it("atingiuTeto em 200 ou mais (loja legada pode passar)", () => {
    expect(atingiuTeto(199)).toBe(false);
    expect(atingiuTeto(200)).toBe(true);
    expect(atingiuTeto(240)).toBe(true);
  });
});

describe("fila de envio", () => {
  it("rotuloProgressoEnvio", () => {
    expect(rotuloProgressoEnvio(2, 5)).toBe("Enviando 2 de 5");
  });

  it("teto e rate limit interrompem; erro do arquivo não", () => {
    expect(interrompeFila(MSG_TETO)).toBe(true);
    expect(interrompeFila(MSG_MUITAS_TENTATIVAS)).toBe(true);
    expect(interrompeFila(MSG_IMAGEM_INVALIDA)).toBe(false);
    expect(interrompeFila(MSG_ENVIO_FALHOU)).toBe(false);
  });

  it("resumoEnvio", () => {
    expect(resumoEnvio(1, 1)).toBe("1 imagem enviada.");
    expect(resumoEnvio(5, 5)).toBe("5 imagens enviadas.");
    expect(resumoEnvio(3, 5)).toBe("3 de 5 imagens enviadas.");
  });
});

describe("uso (prévia do servidor)", () => {
  it("produtosDoUso lê o jsonb de forma defensiva", () => {
    expect(
      produtosDoUso([
        { id: "p1", nome: "X-Burguer", oculto: false },
        { id: "p2", nome: "Suco", oculto: true },
        { id: 3, nome: "inválido" },
        null,
        "lixo",
      ]),
    ).toEqual([
      { id: "p1", nome: "X-Burguer", oculto: false },
      { id: "p2", nome: "Suco", oculto: true },
    ]);
    expect(produtosDoUso(null)).toEqual([]);
    expect(produtosDoUso({ id: "p1" })).toEqual([]);
  });

  it("idsEmUso marca quem está em produto ou na logo", () => {
    const usos = [uso("a", [{ nome: "X" }]), uso("b", [], true), uso("c")];
    expect([...idsEmUso(usos)].sort()).toEqual(["a", "b"]);
  });

  it("fraseOndeEstaEmUso (D1)", () => {
    expect(fraseOndeEstaEmUso(2, true)).toBe("em 2 produtos e na logo");
    expect(fraseOndeEstaEmUso(1, false)).toBe("em 1 produto");
    expect(fraseOndeEstaEmUso(0, true)).toBe("na logo");
  });
});

describe("descreverRemocao", () => {
  it("uma imagem sem uso", () => {
    const d = descreverRemocao([uso("a")]);
    expect(d.titulo).toBe("Remover esta imagem?");
    expect(d.paragrafos).toEqual([
      "Ela não está em nenhum produto nem na logo.",
      "A remoção é definitiva, mas a imagem pode levar um tempo para sumir de todo lugar.",
    ]);
    expect(d.produtos).toEqual([]);
  });

  it("uma imagem em 2 produtos e na logo, com o oculto marcado", () => {
    const d = descreverRemocao([uso("a", [{ nome: "X-Burguer" }, { nome: "Suco", oculto: true }], true)]);
    expect(d.paragrafos[0]).toBe("Esta imagem é usada em 2 produtos e na logo.");
    expect(d.paragrafos[1]).toBe("Ao remover, esses produtos ficam sem foto e a loja fica sem logo.");
    expect(d.produtos).toEqual(["X-Burguer", "Suco (oculto)"]);
    expect(d.produtosAlemDaLista).toBe(0);
  });

  it("três imagens, uma em uso: a contagem é a do servidor", () => {
    const d = descreverRemocao([uso("a", [{ nome: "X" }, { nome: "Y" }], true), uso("b"), uso("c")]);
    expect(d.titulo).toBe("Remover 3 imagens?");
    expect(d.paragrafos[0]).toBe("1 é usada em 2 produtos e na logo.");
    expect(d.paragrafos.at(-1)).toBe(
      "A remoção é definitiva, mas as imagens podem levar um tempo para sumir de todo lugar.",
    );
  });

  it("todas em uso", () => {
    const d = descreverRemocao([uso("a", [{ nome: "X" }]), uso("b", [{ nome: "Y" }])]);
    expect(d.paragrafos[0]).toBe("As 2 são usadas em 2 produtos.");
    expect(d.paragrafos[1]).toBe("Ao remover, esses produtos ficam sem foto.");
  });

  it("só na logo", () => {
    const d = descreverRemocao([uso("a", [], true)]);
    expect(d.paragrafos[0]).toBe("Esta imagem é usada na logo.");
    expect(d.paragrafos[1]).toBe("Ao remover, a loja fica sem logo.");
  });

  it("um produto: singular", () => {
    const d = descreverRemocao([uso("a", [{ nome: "X" }])]);
    expect(d.paragrafos[1]).toBe("Ao remover, esse produto fica sem foto.");
  });

  it("produtos além dos 5 listados pela RPC viram 'e mais N'", () => {
    const cinco = ["A", "B", "C", "D", "E"].map((nome) => ({ nome }));
    const d = descreverRemocao([uso("a", cinco, false, 8)]);
    expect(d.produtos).toHaveLength(5);
    expect(d.produtosAlemDaLista).toBe(3);
    expect(d.paragrafos[0]).toBe("Esta imagem é usada em 8 produtos.");
  });

  it("nenhuma de várias em uso", () => {
    const d = descreverRemocao([uso("a"), uso("b")]);
    expect(d.paragrafos[0]).toBe("Nenhuma delas está em produto ou na logo.");
  });
});
