import { describe, expect, it } from "vitest";
import { schemaCategoria, schemaProduto } from "./produto";

// Contrato: validação isomórfica (form + Server Action). Espelha as constraints
// do banco (references/schema.md):
//   produtos: nome NOT NULL, descricao nullable, preco numeric(10,2) CHECK >= 0,
//             categoria_id uuid nullable, disponivel boolean, ordem int >= 0
//   categorias: nome NOT NULL, ordem int >= 0
//
// Decisão de contrato (RN-11 / seguranca.md §6):
// - `preco` é tratado como NÚMERO (não string do form). A coerção string->number
//   é responsabilidade da borda (form), não do schema autoritativo do servidor.
//   O schema do servidor recebe número; string deve ser REJEITADA.
// - `preco` nunca pode aceitar um valor que numeric(10,2) rejeitaria:
//   negativo rejeitado; mais de 2 casas decimais (ex.: 10.999) rejeitado;
//   NaN/Infinity rejeitados.

const produtoValido = {
  nome: "X-Burger",
  descricao: "Hambúrguer artesanal",
  preco: 25.9,
  categoria_id: "11111111-1111-1111-1111-111111111111",
  disponivel: true,
  ordem: 0,
};

describe("schemaProduto", () => {
  it("aceita um produto válido completo", () => {
    const r = schemaProduto.safeParse(produtoValido);
    expect(r.success).toBe(true);
  });

  it("aceita produto sem descricao (opcional) e categoria_id null", () => {
    const { descricao: _d, ...semDescricao } = produtoValido;
    const r = schemaProduto.safeParse({ ...semDescricao, categoria_id: null });
    expect(r.success).toBe(true);
  });

  // --- nome ---
  it("rejeita nome vazio", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, nome: "" });
    expect(r.success).toBe(false);
  });

  it("rejeita nome só com espaços (trim)", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, nome: "   " });
    expect(r.success).toBe(false);
  });

  it("rejeita nome maior que 200 caracteres", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, nome: "a".repeat(201) });
    expect(r.success).toBe(false);
  });

  // --- preco (CHECK preco >= 0, numeric(10,2)) ---
  it("rejeita preco negativo (CHECK >= 0)", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, preco: -5 });
    expect(r.success).toBe(false);
  });

  it("aceita preco zero", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, preco: 0 });
    expect(r.success).toBe(true);
  });

  it("rejeita preco com 3 casas decimais (10.999) — banco é numeric(10,2)", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, preco: 10.999 });
    expect(r.success).toBe(false);
  });

  it("aceita preco com exatamente 2 casas decimais", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, preco: 10.99 });
    expect(r.success).toBe(true);
  });

  it("rejeita preco como string (servidor recebe número, não string do form)", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, preco: "10.00" });
    expect(r.success).toBe(false);
  });

  it("rejeita preco NaN", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, preco: Number.NaN });
    expect(r.success).toBe(false);
  });

  it("rejeita preco Infinity", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, preco: Number.POSITIVE_INFINITY });
    expect(r.success).toBe(false);
  });

  // --- categoria_id ---
  it("rejeita categoria_id que não é uuid", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, categoria_id: "nao-uuid" });
    expect(r.success).toBe(false);
  });

  // --- disponivel ---
  it("rejeita disponivel não booleano", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, disponivel: "sim" });
    expect(r.success).toBe(false);
  });

  // --- ordem (int >= 0) ---
  it("rejeita ordem negativa", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, ordem: -1 });
    expect(r.success).toBe(false);
  });

  it("rejeita ordem não inteira", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, ordem: 1.5 });
    expect(r.success).toBe(false);
  });
});

describe("schemaCategoria", () => {
  const categoriaValida = { nome: "Lanches", ordem: 0 };

  it("aceita uma categoria válida", () => {
    const r = schemaCategoria.safeParse(categoriaValida);
    expect(r.success).toBe(true);
  });

  it("rejeita nome vazio", () => {
    const r = schemaCategoria.safeParse({ ...categoriaValida, nome: "" });
    expect(r.success).toBe(false);
  });

  it("rejeita nome só com espaços (trim)", () => {
    const r = schemaCategoria.safeParse({ ...categoriaValida, nome: "  " });
    expect(r.success).toBe(false);
  });

  it("rejeita ordem negativa", () => {
    const r = schemaCategoria.safeParse({ ...categoriaValida, ordem: -1 });
    expect(r.success).toBe(false);
  });

  it("rejeita ordem não inteira", () => {
    const r = schemaCategoria.safeParse({ ...categoriaValida, ordem: 2.5 });
    expect(r.success).toBe(false);
  });
});
