import { describe, expect, it, vi } from "vitest";
// Issue 072 (RED): garante uma base de URL válida ANTES da avaliação do módulo
// `storage.ts`, que deriva STORAGE_URL_PREFIX de NEXT_PUBLIC_SUPABASE_URL. No
// runner vitest essa env não está definida; sem isto, o prefixo seria
// "undefined/..." e o caso de URL válida do Storage falharia em z.url() por
// motivo errado (env), mascarando o contrato real. vi.hoisted roda antes dos
// imports ESM, então a constante do módulo é avaliada com a base correta.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});
import { schemaCategoria, schemaProduto } from "./produto";
import { STORAGE_URL_PREFIX } from "./storage";

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

// ---------------------------------------------------------------------------
// foto_url (issue 072) — camada autoritativa anti-injeção de URL.
//
// Contrato:
//   - ausente/undefined  → válido (produto sem foto).
//   - null               → válido.
//   - "" (form sem foto) → válido E normalizado para null (preprocess "" → null);
//                          a coluna nunca recebe "".
//   - URL externa        → rejeitada (renderizada como <Image src> na vitrine).
//   - "javascript:..."   → rejeitada.
//   - URL do Storage do iRango (startsWith STORAGE_URL_PREFIX) → válida e preservada.
//
// STORAGE_URL_PREFIX é importado de ./storage (módulo neutro, decisão do plano):
// o teste NÃO hardcoda o prefixo, monta a URL válida A PARTIR da constante real.
// ---------------------------------------------------------------------------
describe("schemaProduto — foto_url (anti-injeção de URL)", () => {
  const urlStorageValida = `${STORAGE_URL_PREFIX}produtos/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png`;

  it("aceita produto sem foto_url (campo ausente)", () => {
    const r = schemaProduto.safeParse(produtoValido);
    expect(r.success).toBe(true);
  });

  it("aceita foto_url undefined explícito e mantém undefined (não vira null)", () => {
    // undefined → preprocess não transforma (só "" → null) → .nullish() aceita.
    // data.foto_url permanece undefined: o spread no insert omite o campo,
    // sem sobrescrever foto existente com null inadvertidamente.
    const r = schemaProduto.safeParse({ ...produtoValido, foto_url: undefined });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.foto_url).toBeUndefined();
  });

  it("aceita foto_url null", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, foto_url: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.foto_url).toBeNull();
  });

  it('normaliza foto_url "" (form sem foto) para null', () => {
    const r = schemaProduto.safeParse({ ...produtoValido, foto_url: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.foto_url).toBeNull();
  });

  it("rejeita foto_url externa (https://evil.com)", () => {
    const r = schemaProduto.safeParse({
      ...produtoValido,
      foto_url: "https://evil.com/x.png",
    });
    expect(r.success).toBe(false);
  });

  it("rejeita foto_url javascript: (XSS)", () => {
    const r = schemaProduto.safeParse({
      ...produtoValido,
      foto_url: "javascript:alert(1)",
    });
    expect(r.success).toBe(false);
  });

  it("aceita foto_url do Storage do iRango e preserva o valor", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, foto_url: urlStorageValida });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.foto_url).toBe(urlStorageValida);
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
