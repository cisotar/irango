import { describe, it, expect } from "vitest";
import { calcularFrete, type ZonaComTaxa, type ResultadoFrete } from "./calcularFrete";
import { formatarMoeda } from "./formatarMoeda";

/**
 * Fase RED (TDD) da issue 326 — fatias F3 (`lerFaixas`, abre zonas antigas sem
 * mudar preço) e F4 (helpers puros da tela `TabelaFaixasEntrega`).
 *
 * Autoridade: tasks/326-tabela-de-faixas-de-entrega.md D2, D4, D7, C1, C4 ·
 * plan/loop-faixas-de-entrega.md "Risco por fatia" F3/F4.
 *
 * `src/lib/utils/faixasEntrega.ts` ainda NÃO existe: resolvido por import
 * dinâmico (padrão de frequencia.test.ts) para o RED ser "módulo/export
 * ausente" em CADA teste, não um erro de import que derruba o arquivo.
 *
 * `calcularFrete.ts` NÃO muda (D3) e é o JUIZ da equivalência: o teste não
 * reimplementa a regra de faixa — compara `calcularFrete(legado, d)` com
 * `calcularFrete(faixasExpandidas, d)`.
 *
 * CONTRATO que o GREEN deve satisfazer (src/lib/utils/faixasEntrega.ts):
 *
 *   type FaixaEntrega = { taxa: number; pedido_minimo_gratis: number | null };
 *   type LeituraFaixas = {
 *     modo: "faixas" | "legado";
 *     incremento: 1 | 2;
 *     faixas: FaixaEntrega[];
 *     // zonas atuais citadas no aviso: no legado, TODAS; em "faixas", as inativas
 *     // (só quando há alguma ativa; só inativas ⇒ vazio sem aviso)
 *     zonasNoAviso: Array<{ id: string; nome: string }>;
 *   };
 *
 * Decisões do usuário (2026-09-27), além de D4/C1:
 *   - expande só se o resultado tiver ≤ 30 faixas; acima ⇒ legado;
 *   - nenhuma zona ATIVA ⇒ igual a sem zonas (faixas, inc 1, [], sem aviso);
 *   - C1 com empate no maior preço anterior ⇒ cita a faixa empatada MAIS PRÓXIMA.
 *   lerFaixas(zonas: ZonaVitrine[]): LeituraFaixas
 *   rotuloFaixa(indice: number, incremento: 1 | 2): string        // "1–2 km" (en dash)
 *   limiteEntregaKm(quantidade: number, incremento: 1 | 2): number | null
 *   alertaDePreco(faixas: { taxa: number }[], indice: number, incremento: 1 | 2): string | null
 *   textoLimiteEntrega(limiteKm: number | null, taxaForaZona: number | null): string
 */

const MODULO = "@/lib/utils/faixasEntrega";

type Incremento = 1 | 2;
type FaixaEntrega = { taxa: number; pedido_minimo_gratis: number | null };
type ZonaVitrine = ZonaComTaxa & { nome: string };
type LeituraFaixas = {
  modo: "faixas" | "legado";
  incremento: Incremento;
  faixas: FaixaEntrega[];
  zonasNoAviso: Array<{ id: string; nome: string }>;
};
type ModuloFaixas = {
  lerFaixas(zonas: ZonaVitrine[]): LeituraFaixas;
  rotuloFaixa(indice: number, incremento: Incremento): string;
  limiteEntregaKm(quantidade: number, incremento: Incremento): number | null;
  alertaDePreco(faixas: { taxa: number }[], indice: number, incremento: Incremento): string | null;
  textoLimiteEntrega(limiteKm: number | null, taxaForaZona: number | null): string;
};
const EXPORTS = [
  "lerFaixas",
  "rotuloFaixa",
  "limiteEntregaKm",
  "alertaDePreco",
  "textoLimiteEntrega",
] as const;

async function mod(): Promise<ModuloFaixas> {
  let m: Partial<Record<(typeof EXPORTS)[number], unknown>>;
  try {
    m = (await import(/* @vite-ignore */ MODULO)) as typeof m;
  } catch (e) {
    throw new Error(
      `[RED 326] \`src/lib/utils/faixasEntrega.ts\` ainda não existe (${(e as Error).message}). ` +
        `É a fase GREEN da issue 326 (D4, P3 do plano).`,
    );
  }
  const faltando = EXPORTS.filter((n) => typeof m[n] !== "function");
  if (faltando.length > 0) {
    throw new Error(`[RED 326] \`src/lib/utils/faixasEntrega.ts\` ainda não exporta: ${faltando.join(", ")}.`);
  }
  return m as unknown as ModuloFaixas;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
let seq = 0;
function zonaRaio(
  nome: string,
  raio: number,
  taxa: number,
  gratis: number | null = null,
  ativo = true,
): ZonaVitrine {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    nome,
    tipo: "raio_km",
    ativo,
    taxa: { taxa, pedido_minimo_gratis: gratis, raio_max_km: raio, cep_inicio: null, cep_fim: null },
    bairros: [],
  };
}

/**
 * O que a RPC grava a partir do payload (D2): teto = posição × incremento,
 * tipo raio_km, ativo = true (C2). É o contrato da gravação, não a regra de
 * preço — o preço quem decide é `calcularFrete`.
 */
function comoGravado(leitura: LeituraFaixas): ZonaComTaxa[] {
  return leitura.faixas.map((f, i) => ({
    id: `ffffffff-0000-4000-8000-${String(i).padStart(12, "0")}`,
    tipo: "raio_km",
    ativo: true,
    taxa: {
      taxa: f.taxa,
      pedido_minimo_gratis: f.pedido_minimo_gratis,
      raio_max_km: (i + 1) * leitura.incremento,
      cep_inicio: null,
      cep_fim: null,
    },
    bairros: [],
  }));
}

const preco = (r: ResultadoFrete) => ({ atendido: r.atendido, taxa: r.taxa, gratis: r.gratis });

/**
 * Varre d = 0,00 … (tetoMax + 1) km em passos de 0,01 para cada subtotal e cada
 * fallback fora-de-zona, e devolve as divergências (vazio = mesmo preço sempre).
 */
function divergencias(
  legado: ZonaComTaxa[],
  novas: ZonaComTaxa[],
  tetoMax: number,
  subtotais: number[],
): string[] {
  const erros: string[] = [];
  const passos = Math.round((tetoMax + 1) * 100);
  for (const foraZona of [undefined, 15]) {
    for (const subtotal of subtotais) {
      for (let k = 0; k <= passos; k += 1) {
        const d = k / 100;
        const antes = preco(calcularFrete(legado, { distanciaKm: d }, subtotal, foraZona));
        const depois = preco(calcularFrete(novas, { distanciaKm: d }, subtotal, foraZona));
        if (JSON.stringify(antes) !== JSON.stringify(depois)) {
          erros.push(
            `d=${d} subtotal=${subtotal} foraZona=${foraZona}: legado ${JSON.stringify(antes)} ≠ faixas ${JSON.stringify(depois)}`,
          );
        }
      }
    }
  }
  return erros;
}

// ═════════════════════════════════════════════════════════ F3 — lerFaixas
describe("[326/F3] lerFaixas — sem zonas", () => {
  it("[] ⇒ modo faixas, incremento 1, lista vazia, nada no aviso", async () => {
    const { lerFaixas } = await mod();
    expect(lerFaixas([])).toEqual({ modo: "faixas", incremento: 1, faixas: [], zonasNoAviso: [] });
  });
});

describe("[326/F3] lerFaixas — equivalência de preço (pré-preenchimento NÃO pode mudar preço)", () => {
  it("C4: 'até 7 km R$8' ⇒ 7 faixas de 1 km a R$8, nada no aviso", async () => {
    const { lerFaixas } = await mod();
    const r = lerFaixas([zonaRaio("Até 7 km", 7, 8)]);

    expect(r.modo).toBe("faixas");
    expect(r.incremento).toBe(1);
    expect(r.faixas).toEqual(Array.from({ length: 7 }, () => ({ taxa: 8, pedido_minimo_gratis: null })));
    expect(r.zonasNoAviso).toEqual([]);
  });

  it("3 km R$5 (grátis ≥50) + 7 km R$8 (grátis ≥80) + 7 km R$9 (empate, grátis ≥100) + INATIVA 10 km R$1 ⇒ expansão concreta", async () => {
    const { lerFaixas } = await mod();
    const inativa = zonaRaio("Promo 10 km", 10, 1, null, false);
    const r = lerFaixas([
      zonaRaio("Perto", 3, 5, 50),
      zonaRaio("Longe", 7, 8, 80),
      zonaRaio("Longe dup", 7, 9, 100),
      inativa,
    ]);

    expect(r.modo).toBe("faixas");
    expect(r.incremento).toBe(1); // 3 e 7 são ímpares
    // empate de teto 7 ⇒ calcularFrete escolhe a MAIOR taxa (RN-C8): R$9 / grátis 100
    expect(r.faixas).toEqual([
      { taxa: 5, pedido_minimo_gratis: 50 },
      { taxa: 5, pedido_minimo_gratis: 50 },
      { taxa: 5, pedido_minimo_gratis: 50 },
      { taxa: 9, pedido_minimo_gratis: 100 },
      { taxa: 9, pedido_minimo_gratis: 100 },
      { taxa: 9, pedido_minimo_gratis: 100 },
      { taxa: 9, pedido_minimo_gratis: 100 },
    ]);
    // D4: a inativa NÃO entra na expansão (limite 7, não 10) e aparece no aviso
    expect(r.zonasNoAviso.map((z) => z.id)).toEqual([inativa.id]);
  });

  it("mesmo fixture: calcularFrete(legado, d) === calcularFrete(faixas, d) para d = 0,00…11,00 (passo 0,01), subtotais abaixo/acima do grátis, com e sem taxaForaZona", async () => {
    const { lerFaixas } = await mod();
    const legado = [
      zonaRaio("Perto", 3, 5, 50),
      zonaRaio("Longe", 7, 8, 80),
      zonaRaio("Longe dup", 7, 9, 100),
      zonaRaio("Promo 10 km", 10, 1, null, false),
    ];
    const r = lerFaixas(legado);
    expect(r.modo).toBe("faixas");

    expect(divergencias(legado, comoGravado(r), 10, [0, 49.99, 50, 79.99, 80, 99.99, 100, 500])).toEqual([]);
  });

  it("tetos todos pares (4 km R$5 + 6 km R$8 grátis ≥70) ⇒ incremento 2, 3 faixas, mesmo preço em toda distância", async () => {
    const { lerFaixas } = await mod();
    const legado = [zonaRaio("Até 4", 4, 5), zonaRaio("Até 6", 6, 8, 70)];
    const r = lerFaixas(legado);

    expect(r.modo).toBe("faixas");
    expect(r.incremento).toBe(2);
    expect(r.faixas).toEqual([
      { taxa: 5, pedido_minimo_gratis: null },
      { taxa: 5, pedido_minimo_gratis: null },
      { taxa: 8, pedido_minimo_gratis: 70 },
    ]);
    expect(divergencias(legado, comoGravado(r), 6, [0, 69.99, 70, 300])).toEqual([]);
  });

  // Continua válido com a decisão de 2026-09-27 (só inativas ⇒ vazio): aqui há
  // uma ATIVA no padrão, então expande e a inativa vai para o aviso.
  it("inativa com teto DECIMAL não impede a expansão (D4: só os tetos das ATIVAS contam)", async () => {
    const { lerFaixas } = await mod();
    const inativa = zonaRaio("Velha 2,5 km", 2.5, 1, null, false);
    const legado = [zonaRaio("Até 3", 3, 5), inativa];
    const r = lerFaixas(legado);

    expect(r.modo).toBe("faixas");
    expect(r.faixas).toEqual(Array.from({ length: 3 }, () => ({ taxa: 5, pedido_minimo_gratis: null })));
    expect(r.zonasNoAviso.map((z) => z.id)).toEqual([inativa.id]);
    expect(divergencias(legado, comoGravado(r), 3, [0, 100])).toEqual([]);
  });
});

describe("[326/F3] lerFaixas — o que não expande vira LEGADO (tabela vazia + aviso com todas as zonas)", () => {
  function esperarLegado(r: LeituraFaixas, zonas: ZonaVitrine[]) {
    expect(r.modo).toBe("legado");
    expect(r.incremento).toBe(1);
    expect(r.faixas).toEqual([]);
    expect(r.zonasNoAviso.map((z) => z.id).sort()).toEqual(zonas.map((z) => z.id).sort());
  }

  it("teto ativo 2,5 km ⇒ legado", async () => {
    const { lerFaixas } = await mod();
    const zonas = [zonaRaio("Até 2,5", 2.5, 5), zonaRaio("Até 5", 5, 8)];
    esperarLegado(lerFaixas(zonas), zonas);
  });

  it("zona bairro presente ⇒ legado", async () => {
    const { lerFaixas } = await mod();
    const bairro: ZonaVitrine = {
      id: "00000000-0000-4000-8000-00000000b41a",
      nome: "Centro",
      tipo: "bairro",
      ativo: true,
      taxa: { taxa: 3, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
      bairros: [{ nome: "Centro" }],
    };
    const zonas = [zonaRaio("Até 3", 3, 5), bairro];
    esperarLegado(lerFaixas(zonas), zonas);
  });

  it("zona faixa_cep presente ⇒ legado", async () => {
    const { lerFaixas } = await mod();
    const cep: ZonaVitrine = {
      id: "00000000-0000-4000-8000-0000000cef00",
      nome: "CEP 01000",
      tipo: "faixa_cep",
      ativo: true,
      taxa: { taxa: 9, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: 1000000, cep_fim: 1099999 },
      bairros: [],
    };
    const zonas = [cep];
    esperarLegado(lerFaixas(zonas), zonas);
  });

  it("zona raio ativa SEM taxa ⇒ legado (D4: 'todas raio_km, com taxa')", async () => {
    const { lerFaixas } = await mod();
    const semTaxa: ZonaVitrine = { ...zonaRaio("Sem taxa", 4, 1), taxa: null };
    const zonas = [zonaRaio("Até 2", 2, 5), semTaxa];
    esperarLegado(lerFaixas(zonas), zonas);
  });

  // Decisão do usuário (2026-09-27): lerFaixas só expande se o resultado tiver
  // NO MÁXIMO 30 faixas (o teto do zod/RPC); acima disso, legado — mesmo
  // critério de teto decimal/bairro/faixa_cep. A contagem é teto máx ÷ incremento.
  it("inc 1 com 31 faixas (3 km + 31 km) ⇒ legado", async () => {
    const { lerFaixas } = await mod();
    const zonas = [zonaRaio("Até 3", 3, 5), zonaRaio("Até 31", 31, 12)];
    esperarLegado(lerFaixas(zonas), zonas);
  });

  it("inc 1 com 35 faixas (zona única de 35 km) ⇒ legado", async () => {
    const { lerFaixas } = await mod();
    const zonas = [zonaRaio("Até 35", 35, 15)];
    esperarLegado(lerFaixas(zonas), zonas);
  });

  it("inc 2 com 32 faixas (4 km + 64 km, todos pares) ⇒ legado", async () => {
    const { lerFaixas } = await mod();
    const zonas = [zonaRaio("Até 4", 4, 5), zonaRaio("Até 64", 64, 20)];
    esperarLegado(lerFaixas(zonas), zonas);
  });
});

describe("[326/F3] lerFaixas — limite de 30 faixas: 30 ainda EXPANDE (borda)", () => {
  it("inc 1 com 30 faixas (3 km + 30 km; o 3 ímpar força inc 1) ⇒ faixas, 30 linhas", async () => {
    const { lerFaixas } = await mod();
    const r = lerFaixas([zonaRaio("Até 3", 3, 5), zonaRaio("Até 30", 30, 12)]);
    expect(r.modo).toBe("faixas");
    expect(r.incremento).toBe(1);
    expect(r.faixas).toHaveLength(30);
    expect(r.faixas[29]).toEqual({ taxa: 12, pedido_minimo_gratis: null });
  });

  it("inc 2 com 30 faixas (zona única de 60 km) ⇒ faixas, 30 linhas", async () => {
    const { lerFaixas } = await mod();
    const r = lerFaixas([zonaRaio("Até 60", 60, 20)]);
    expect(r.modo).toBe("faixas");
    expect(r.incremento).toBe(2);
    expect(r.faixas).toHaveLength(30);
  });
});

describe("[326/F3] lerFaixas — só zonas INATIVAS ⇒ vazio, sem aviso (decisão 2026-09-27)", () => {
  it("duas raio_km inativas ⇒ igual a não ter zona: faixas, inc 1, [], sem aviso", async () => {
    const { lerFaixas } = await mod();
    const r = lerFaixas([
      zonaRaio("Velha 3", 3, 5, null, false),
      zonaRaio("Velha 7", 7, 8, 80, false),
    ]);
    expect(r).toEqual({ modo: "faixas", incremento: 1, faixas: [], zonasNoAviso: [] });
  });

  it("inativa com teto DECIMAL e nenhuma ativa ⇒ vazio (não é legado: legado exige ALGUMA ativa fora do padrão)", async () => {
    const { lerFaixas } = await mod();
    const r = lerFaixas([zonaRaio("Velha 2,5", 2.5, 1, null, false)]);
    expect(r).toEqual({ modo: "faixas", incremento: 1, faixas: [], zonasNoAviso: [] });
  });
});

// ═════════════════════════════════════════════════ F4 — helpers da tela
describe("[326/F4] rotuloFaixa — 'de–até km' (en dash)", () => {
  it.each([
    [0, 1, "0–1 km"],
    [1, 1, "1–2 km"],
    [2, 1, "2–3 km"],
    [0, 2, "0–2 km"],
    [2, 2, "4–6 km"],
  ] as const)("índice %i, incremento %i ⇒ %s", async (indice, inc, esperado) => {
    const { rotuloFaixa } = await mod();
    expect(rotuloFaixa(indice, inc)).toBe(esperado);
  });
});

describe("[326/F4] limiteEntregaKm — teto da última faixa", () => {
  it.each([
    [3, 1, 3],
    [3, 2, 6],
    [1, 1, 1],
    [30, 2, 60],
  ] as const)("%i faixas de %i km ⇒ %i km", async (n, inc, esperado) => {
    const { limiteEntregaKm } = await mod();
    expect(limiteEntregaKm(n, inc)).toBe(esperado);
  });

  it("0 faixas ⇒ null (não há limite: estado vazio)", async () => {
    const { limiteEntregaKm } = await mod();
    expect(limiteEntregaKm(0, 1)).toBeNull();
  });
});

describe("[326/F4] alertaDePreco — C1: preço menor que o MAIOR entre as faixas anteriores", () => {
  const taxas = (...v: number[]) => v.map((taxa) => ({ taxa }));

  it("4/6/5 ⇒ alerta só na 3ª, com a copy EXATA citando 1–2 km", async () => {
    const { alertaDePreco } = await mod();
    const f = taxas(4, 6, 5);
    expect(alertaDePreco(f, 0, 1)).toBeNull();
    expect(alertaDePreco(f, 1, 1)).toBeNull();
    expect(alertaDePreco(f, 2, 1)).toBe(
      `Confira o preço: está menor que o da faixa de 1–2 km (${formatarMoeda(6)}). ` +
        `Quem está a 2–3 km vai pagar ${formatarMoeda(5)}.`,
    );
  });

  it("4/6/6 ⇒ nenhum alerta (preço igual ao maior anterior não é menor)", async () => {
    const { alertaDePreco } = await mod();
    const f = taxas(4, 6, 6);
    expect([0, 1, 2].map((i) => alertaDePreco(f, i, 1))).toEqual([null, null, null]);
  });

  it("4/6/5/5 ⇒ alerta na 3ª E na 4ª, ambos citando 1–2 km (o MAIOR anterior, não o vizinho)", async () => {
    const { alertaDePreco } = await mod();
    const f = taxas(4, 6, 5, 5);
    expect(alertaDePreco(f, 0, 1)).toBeNull();
    expect(alertaDePreco(f, 1, 1)).toBeNull();
    expect(alertaDePreco(f, 2, 1)).toBe(
      `Confira o preço: está menor que o da faixa de 1–2 km (${formatarMoeda(6)}). ` +
        `Quem está a 2–3 km vai pagar ${formatarMoeda(5)}.`,
    );
    expect(alertaDePreco(f, 3, 1)).toBe(
      `Confira o preço: está menor que o da faixa de 1–2 km (${formatarMoeda(6)}). ` +
        `Quem está a 3–4 km vai pagar ${formatarMoeda(5)}.`,
    );
  });

  it("EMPATE no maior anterior (4/6/6/5) ⇒ cita a MAIS PRÓXIMA das empatadas (2–3 km), não 1–2 km (decisão 2026-09-27)", async () => {
    const { alertaDePreco } = await mod();
    const f = taxas(4, 6, 6, 5);
    expect([0, 1, 2].map((i) => alertaDePreco(f, i, 1))).toEqual([null, null, null]);
    expect(alertaDePreco(f, 3, 1)).toBe(
      `Confira o preço: está menor que o da faixa de 2–3 km (${formatarMoeda(6)}). ` +
        `Quem está a 3–4 km vai pagar ${formatarMoeda(5)}.`,
    );
  });

  it("incremento 2 muda os rótulos da copy (4/6/5 ⇒ 2–4 km e 4–6 km)", async () => {
    const { alertaDePreco } = await mod();
    expect(alertaDePreco(taxas(4, 6, 5), 2, 2)).toBe(
      `Confira o preço: está menor que o da faixa de 2–4 km (${formatarMoeda(6)}). ` +
        `Quem está a 4–6 km vai pagar ${formatarMoeda(5)}.`,
    );
  });

  it("a copy antiga do mockup (regra de menor preço) NUNCA aparece", async () => {
    const { alertaDePreco } = await mod();
    const txt = alertaDePreco(taxas(4, 6, 5), 2, 1) ?? "";
    expect(txt).not.toMatch(/menor preço entre as faixas/);
    expect(txt).not.toMatch(/Mais barato que/);
  });
});

describe("[326/F4] textoLimiteEntrega — D7: copy derivada do estado real", () => {
  it("com faixas e SEM taxaForaZona ⇒ texto do mockup", async () => {
    const { textoLimiteEntrega } = await mod();
    expect(textoLimiteEntrega(3, null)).toBe(
      "Você entrega até 3 km. Acima disso, a vitrine mostra “fora da área de entrega”.",
    );
  });

  it("com faixas e COM taxaForaZona ⇒ 'acima disso cobra R$ X (fora da área)', sem prometer 'fora da área de entrega'", async () => {
    const { textoLimiteEntrega } = await mod();
    const txt = textoLimiteEntrega(6, 15);
    expect(txt).toContain("Você entrega até 6 km.");
    expect(txt.toLowerCase()).toContain(`acima disso cobra ${formatarMoeda(15).toLowerCase()} (fora da área)`);
    expect(txt).not.toContain("“fora da área de entrega”");
  });

  it("sem faixas e SEM taxaForaZona ⇒ texto do mockup (entrega indisponível, só retirada)", async () => {
    const { textoLimiteEntrega } = await mod();
    expect(textoLimiteEntrega(null, null)).toBe(
      "Sem faixa cadastrada, a vitrine mostra entrega indisponível — só retirada.",
    );
  });

  it("sem faixas e COM taxaForaZona ⇒ NÃO diz 'indisponível' (a vitrine cobra a taxa fora da área) e cita o valor", async () => {
    const { textoLimiteEntrega } = await mod();
    const txt = textoLimiteEntrega(null, 15);
    expect(txt).not.toMatch(/indispon[ií]vel/i);
    expect(txt).toContain(formatarMoeda(15));
  });
});

// ═════════════════════════════════════════ tela — confirmação do 1º Salvar
describe("[326/F4] zonasJaSaoFaixas — decide se o Salvar SUBSTITUI zonas de outro formato (D4/C4)", () => {
  const faixaGravada = (i: number, inc: Incremento, taxa: number) =>
    zonaRaio(`${i * inc}–${(i + 1) * inc} km`, (i + 1) * inc, taxa);

  it("sem zonas ⇒ true (nada a substituir)", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(zonasJaSaoFaixas([])).toBe(true);
  });

  it("zonas no formato que a RPC grava (inc 1 e inc 2) ⇒ true", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(zonasJaSaoFaixas([faixaGravada(0, 1, 4), faixaGravada(1, 1, 6), faixaGravada(2, 1, 8)])).toBe(true);
    expect(zonasJaSaoFaixas([faixaGravada(0, 2, 4), faixaGravada(1, 2, 6)])).toBe(true);
  });

  it("zona antiga 'até 7 km' (expande em 7 faixas) ⇒ false", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(zonasJaSaoFaixas([zonaRaio("Centro", 7, 8)])).toBe(false);
  });

  it("nome fora do padrão derivado, mesmo com teto contíguo ⇒ false", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(zonasJaSaoFaixas([zonaRaio("Perto", 1, 4), faixaGravada(1, 1, 6)])).toBe(false);
  });

  it("alguma zona inativa, legado (teto decimal) ou só inativas ⇒ false", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(zonasJaSaoFaixas([faixaGravada(0, 1, 4), zonaRaio("1–2 km", 2, 6, null, false)])).toBe(false);
    expect(zonasJaSaoFaixas([zonaRaio("0–2.5 km", 2.5, 4)])).toBe(false);
    expect(zonasJaSaoFaixas([zonaRaio("0–1 km", 1, 4, null, false)])).toBe(false);
  });

  it("teto repetido (duas zonas '0–1 km' + '2–3 km') ⇒ false", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(
      zonasJaSaoFaixas([faixaGravada(0, 1, 4), faixaGravada(0, 1, 5), faixaGravada(2, 1, 8)]),
    ).toBe(false);
  });
});
