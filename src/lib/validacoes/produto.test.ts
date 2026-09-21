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
import {
  schemaCategoria,
  schemaProduto,
  schemaProdutoUpdate,
  schemaVisibilidadeEmLote,
  TETO_LOTE,
  mensagemDescontoMaiorQuePreco,
} from "./produto";
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
  // Issue 085: `oculto` passa a ser obrigatório no schema, ao lado de
  // `disponivel`. Incluído na base para que os testes existentes (que não são
  // sobre `oculto`) continuem enviando um payload válido após o schema ficar
  // mais estrito.
  oculto: false,
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

  // --- oculto (issue 085 / migration 083) — visibilidade na vitrine.
  // Obrigatório e boolean, espelhando `disponivel`. O DEFAULT false vive no
  // banco (RN-7); o form sempre envia o valor explícito, logo o schema exige.
  it("rejeita produto sem oculto (campo obrigatório)", () => {
    const { oculto: _o, ...semOculto } = produtoValido;
    const r = schemaProduto.safeParse(semOculto);
    expect(r.success).toBe(false);
  });

  it("rejeita oculto não-booleano", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, oculto: "sim" });
    expect(r.success).toBe(false);
  });

  it("aceita oculto=true e preserva o valor", () => {
    const r = schemaProduto.safeParse({ ...produtoValido, oculto: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.oculto).toBe(true);
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

/* ────────────────────────────────────────────────────────────────────────────
 * Fase RED da issue 230 — colunas de desconto no `schemaProduto` + a mensagem
 * literal de D10.
 *
 * Contrato desta fatia (spec §RN-03..RN-07, D10):
 *   - `desconto_ativo` boolean OBRIGATÓRIO (espelha `disponivel`/`oculto`: o
 *     form sempre manda o valor explícito; o DEFAULT false vive no banco);
 *   - `desconto_tipo` "percentual" | "fixo" | null;
 *   - `desconto_valor` number | null — percentual em (0,100], fixo em (0,preco];
 *   - `desconto_inicio`/`desconto_fim`: HORA LOCAL do lojista no formato do
 *     `<input type="datetime-local">` ("YYYY-MM-DDTHH:MM") ou null. A conversão
 *     para instante absoluto é da Server Action, que é quem conhece
 *     `lojas.timezone` (RN-03) — o schema roda ANTES de qualquer I/O e por isso
 *     NÃO pode depender do fuso;
 *   - nada disso é opcional com default silencioso, e nada é STRIPADO: a action
 *     faz `insert({ ...parsed.data })`, então o que o zod descartar some do
 *     banco (é exatamente aí que RN-07 morreria).
 *
 * Os CHECKs da 219 são backstop; ESTA é a barreira legível.
 * Hoje `schemaProduto` não conhece nenhum destes campos e
 * `mensagemDescontoMaiorQuePreco` é STUB — todo caso abaixo FALHA.
 * ──────────────────────────────────────────────────────────────────────────── */

// Byte a byte, com o U+00A0 que o Intl pt-BR insere entre "R$" e o número
// (`formatarMoeda`). Escrito com   explícito para que a asserção não
// dependa de como o editor salvou o arquivo.
const MSG_8_10 =
  "Não dá para salvar: o preço novo (R$ 8,00) é menor que o desconto " +
  "configurado (R$ 10,00). Reduza o desconto para no máximo R$ 8,00 " +
  "ou desligue a promoção deste produto.";

function comDesconto(over: Record<string, unknown> = {}) {
  return {
    ...produtoValido,
    desconto_ativo: false,
    desconto_tipo: null,
    desconto_valor: null,
    desconto_inicio: null,
    desconto_fim: null,
    ...over,
  };
}

/** Mensagens de TODOS os issues do parse falho (a ordem não é contrato). */
function mensagens(r: ReturnType<typeof schemaProduto.safeParse>): string[] {
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("mensagemDescontoMaiorQuePreco (D10 / M7)", () => {
  it("monta a frase literal, nomeando os dois números e as duas saídas", () => {
    expect(mensagemDescontoMaiorQuePreco(8, 10)).toBe(MSG_8_10);
  });

  it("formata os dois valores com formatarMoeda (milhar e centavos)", () => {
    expect(mensagemDescontoMaiorQuePreco(1234.5, 2000)).toBe(
      "Não dá para salvar: o preço novo (R$ 1.234,50) é menor que o " +
        "desconto configurado (R$ 2.000,00). Reduza o desconto para no " +
        "máximo R$ 1.234,50 ou desligue a promoção deste produto.",
    );
  });
});

describe("schemaProduto — desconto: percentual (RN-04)", () => {
  it("aceita percentual de 20", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
      }),
    );
    expect(r.success).toBe(true);
  });

  it("REJEITA percentual 101", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 101,
      }),
    );
    expect(r.success).toBe(false);
  });

  it("REJEITA percentual 0 e aceita 100 (limite (0,100], igual ao CHECK)", () => {
    const zero = schemaProduto.safeParse(
      comDesconto({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 0,
      }),
    );
    expect(zero.success).toBe(false);

    const cem = schemaProduto.safeParse(
      comDesconto({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 100,
      }),
    );
    expect(cem.success).toBe(true);
  });

  it("REJEITA percentual negativo", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: -10,
      }),
    );
    expect(r.success).toBe(false);
  });

  it("REJEITA desconto_tipo fora do enum", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        desconto_ativo: true,
        desconto_tipo: "cortesia",
        desconto_valor: 10,
      }),
    );
    expect(r.success).toBe(false);
  });
});

describe("schemaProduto — desconto: fixo maior que o preço (RN-05/RN-06, D10)", () => {
  it("REJEITA fixo > preco com a MENSAGEM LITERAL de D10", () => {
    // preco 8,00 e desconto fixo 10,00 — o caso do design §8.2.
    const r = schemaProduto.safeParse(
      comDesconto({
        preco: 8,
        desconto_ativo: true,
        desconto_tipo: "fixo",
        desconto_valor: 10,
      }),
    );
    expect(r.success).toBe(false);
    expect(mensagens(r)).toContain(MSG_8_10);
  });

  it("o issue de D10 aponta para desconto_valor (o form precisa da chave)", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        preco: 8,
        desconto_ativo: true,
        desconto_tipo: "fixo",
        desconto_valor: 10,
      }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.message === MSG_8_10);
    expect(issue?.path[0]).toBe("desconto_valor");
  });

  it("aceita fixo IGUAL ao preco (limite (0, preco], igual ao CHECK)", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        preco: 8,
        desconto_ativo: true,
        desconto_tipo: "fixo",
        desconto_valor: 8,
      }),
    );
    expect(r.success).toBe(true);
  });

  it("REJEITA fixo 0 (RN-05: valor fixo > 0)", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        preco: 8,
        desconto_ativo: true,
        desconto_tipo: "fixo",
        desconto_valor: 0,
      }),
    );
    expect(r.success).toBe(false);
  });

  it("RN-06: baixar o preco abaixo do fixo já configurado é recusado MESMO DESLIGADO", () => {
    // `produtos_desconto_fixo_check` NÃO depende de `desconto_ativo`. Se o zod
    // só checasse com a promoção ligada, o lojista que desligou e baixou o preço
    // levaria um 23514 cru em vez da mensagem de D10.
    const r = schemaProduto.safeParse(
      comDesconto({
        preco: 8,
        desconto_ativo: false,
        desconto_tipo: "fixo",
        desconto_valor: 10,
      }),
    );
    expect(r.success).toBe(false);
    expect(mensagens(r)).toContain(MSG_8_10);
  });

  it("percentual 100 NÃO dispara a mensagem de D10 (ela é só do tipo fixo)", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        preco: 8,
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 100,
      }),
    );
    expect(r.success).toBe(true);
  });
});

describe("schemaProduto — desconto: coerência de ligado (RN-07)", () => {
  it("REJEITA desconto_ativo = true SEM tipo", () => {
    const r = schemaProduto.safeParse(
      comDesconto({ desconto_ativo: true, desconto_valor: 20 }),
    );
    expect(r.success).toBe(false);
  });

  it("REJEITA desconto_ativo = true SEM valor", () => {
    const r = schemaProduto.safeParse(
      comDesconto({ desconto_ativo: true, desconto_tipo: "percentual" }),
    );
    expect(r.success).toBe(false);
  });

  it("REJEITA desconto_ativo = true sem tipo NEM valor", () => {
    const r = schemaProduto.safeParse(comDesconto({ desconto_ativo: true }));
    expect(r.success).toBe(false);
  });

  it("aceita desligado com tudo NULL (o estado em que toda linha nasce)", () => {
    const r = schemaProduto.safeParse(comDesconto());
    expect(r.success).toBe(true);
  });

  it("RN-07: desligado PRESERVA tipo, valor e prazo no objeto parseado", () => {
    // Se o zod estripar estes campos, `insert({ ...parsed.data })` apaga a
    // promoção do lojista no banco — desligar viraria apagar.
    const r = schemaProduto.safeParse(
      comDesconto({
        desconto_ativo: false,
        desconto_tipo: "percentual",
        desconto_valor: 20,
        desconto_inicio: "2026-12-01T00:00",
        desconto_fim: "2026-12-31T23:59",
      }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({
      desconto_ativo: false,
      desconto_tipo: "percentual",
      desconto_valor: 20,
    });
  });

  it("REJEITA desconto_ativo ausente (obrigatório, sem default silencioso)", () => {
    const { desconto_ativo: _a, ...semAtivo } = comDesconto();
    const r = schemaProduto.safeParse(semAtivo);
    expect(r.success).toBe(false);
  });
});

describe("schemaProduto — desconto: prazo (RN-03)", () => {
  it("aceita prazo aberto dos dois lados (null/null)", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
      }),
    );
    expect(r.success).toBe(true);
  });

  it("aceita só início, e só fim", () => {
    const soInicio = schemaProduto.safeParse(
      comDesconto({ desconto_inicio: "2026-12-01T00:00" }),
    );
    expect(soInicio.success).toBe(true);

    const soFim = schemaProduto.safeParse(
      comDesconto({ desconto_fim: "2026-12-31T23:59" }),
    );
    expect(soFim.success).toBe(true);
  });

  it("aceita fim > inicio", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        desconto_inicio: "2026-12-01T00:00",
        desconto_fim: "2026-12-31T23:59",
      }),
    );
    expect(r.success).toBe(true);
  });

  it("REJEITA desconto_fim IGUAL a desconto_inicio (janela vazia)", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        desconto_inicio: "2026-12-01T00:00",
        desconto_fim: "2026-12-01T00:00",
      }),
    );
    expect(r.success).toBe(false);
  });

  it("REJEITA desconto_fim ANTES de desconto_inicio", () => {
    const r = schemaProduto.safeParse(
      comDesconto({
        desconto_inicio: "2026-12-31T23:59",
        desconto_fim: "2026-12-01T00:00",
      }),
    );
    expect(r.success).toBe(false);
  });

  it("REJEITA instante absoluto no lugar da hora local (o fuso é da action)", () => {
    // Aceitar um ISO com Z aqui faria o campo significar duas coisas
    // diferentes conforme quem o preencheu — e a action converteria de novo.
    const r = schemaProduto.safeParse(
      comDesconto({ desconto_fim: "2026-12-31T23:59:00.000Z" }),
    );
    expect(r.success).toBe(false);
  });

  it("REJEITA data local malformada", () => {
    expect(
      schemaProduto.safeParse(comDesconto({ desconto_fim: "31/12/2026 23:59" }))
        .success,
    ).toBe(false);
    expect(
      schemaProduto.safeParse(comDesconto({ desconto_fim: "amanhã" })).success,
    ).toBe(false);
  });
});


/**
 * [Auditoria 260/261] INSERT e UPDATE divergem em UM ponto só: `visibilidade`.
 *
 * O `.default("menu")` é da COLUNA e vale no INSERT. No UPDATE, que grava a
 * linha inteira, o mesmo default seria o SISTEMA reescrevendo a declaração do
 * lojista — um prato exclusivo de cardápio voltaria ao menu em silêncio.
 */
describe("schemaProdutoUpdate — `visibilidade` obrigatória no UPDATE", () => {
  function semVisibilidade() {
    const p: Record<string, unknown> = { ...produtoValido };
    delete p.visibilidade;
    return p;
  }

  it("INSERT sem o campo passa e recebe o default da coluna", () => {
    const r = schemaProduto.safeParse(semVisibilidade());
    expect(r.success).toBe(true);
    expect(r.success && r.data.visibilidade).toBe("menu");
  });

  it("UPDATE sem o campo é RECUSADO (nenhum default entra no patch)", () => {
    const r = schemaProdutoUpdate.safeParse(semVisibilidade());
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0]?.path).toEqual([
      "visibilidade",
    ]);
  });

  it("UPDATE com o campo explícito preserva o valor declarado", () => {
    for (const valor of ["menu", "cardapio"] as const) {
      const r = schemaProdutoUpdate.safeParse({
        ...produtoValido,
        visibilidade: valor,
      });
      expect(r.success && r.data.visibilidade).toBe(valor);
    }
  });

  it("UPDATE recusa valor fora do domínio (nada de terceira opção)", () => {
    const r = schemaProdutoUpdate.safeParse({
      ...produtoValido,
      visibilidade: "invisivel",
    });
    expect(r.success).toBe(false);
  });

  it("as demais regras (D10) valem IGUAIS nos dois schemas", () => {
    const payload = {
      ...produtoValido,
      visibilidade: "menu",
      preco: 8,
      desconto_ativo: true,
      desconto_tipo: "fixo",
      desconto_valor: 10,
      desconto_inicio: null,
      desconto_fim: null,
    };
    const insert = schemaProduto.safeParse(payload);
    const update = schemaProdutoUpdate.safeParse(payload);
    expect(insert.success).toBe(false);
    expect(update.success).toBe(false);
    expect(
      update.success === false && update.error.issues.map((i) => i.message),
    ).toEqual(
      insert.success === false && insert.error.issues.map((i) => i.message),
    );
  });
});

/**
 * [Auditoria 260/261] O teto que a UI explica é o MESMO que o zod recusa. Se um
 * dos dois mudar sozinho, o lojista volta a ler "não foi possível" sem saber
 * que existe limite — ou lê um número que não é o que decide.
 */
describe("TETO_LOTE — o número da frase é o número da recusa", () => {
  const id = (n: number) =>
    `${String(n).padStart(8, "0")}-0000-0000-0000-000000000000`;

  it(`aceita exatamente ${TETO_LOTE} ids`, () => {
    const r = schemaVisibilidadeEmLote.safeParse({
      produto_ids: Array.from({ length: TETO_LOTE }, (_, i) => id(i)),
      visibilidade: "menu",
    });
    expect(r.success).toBe(true);
  });

  it("recusa um id a mais", () => {
    const r = schemaVisibilidadeEmLote.safeParse({
      produto_ids: Array.from({ length: TETO_LOTE + 1 }, (_, i) => id(i)),
      visibilidade: "menu",
    });
    expect(r.success).toBe(false);
  });
});
