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
 *   - nenhuma zona ATIVA ⇒ igual a sem zonas (faixas, inc 1, [], sem aviso) —
 *     EXCETO quando as zonas estão no formato gravado (ver iteração 2);
 *   - C1 com empate no maior preço anterior ⇒ cita a faixa empatada MAIS PRÓXIMA.
 *   lerFaixas(zonas: ZonaVitrine[]): LeituraFaixas
 *   rotuloFaixa(indice: number, incremento: 1 | 2): string        // "1–2 km" (en dash)
 *   textoLimiteEntrega(limiteKm: number | null, taxaForaZona: number | null): string
 *
 * ── ITERAÇÃO 2 (C2', C3', C1 ajuste, D4 ajuste — seção final da issue) ─────────
 *   type FaixaEntrega = { taxa: number; pedido_minimo_gratis: number | null; ativo: boolean };
 *
 *   lerFaixas — "FORMATO GRAVADO" (o que a RPC grava): TODAS as zonas raio_km
 *     com taxa; ordenadas por teto, o 1º teto ∈ {1,2} é o incremento e o i-ésimo
 *     (0-based) é (i+1)×inc; nome === rotuloFaixa(i, inc); ativas formam PREFIXO.
 *     ⇒ modo "faixas", uma faixa por zona NA ORDEM DO TETO (a ordem de entrada
 *     não importa), `ativo` = o da zona, `zonasNoAviso` = [] — inclusive com o
 *     final desligado e com TODAS desligadas (a RPC aceita [f,f]; reabrir tem de
 *     mostrar as faixas com os preços, não uma tabela vazia).
 *     Fora do formato gravado (tetos arbitrários, nome livre, buraco t/f/t,
 *     teto decimal, bairro/CEP) o caminho de iteração 1 NÃO muda: expande só as
 *     ativas via calcularFrete, e cada faixa expandida sai com `ativo: true`.
 *   zonasJaSaoFaixas(zonas): true também no formato gravado com final desligado
 *     ou todas desligadas; false com buraco.
 *
 *   limiteEntregaKm(faixas: ReadonlyArray<{ ativo: boolean }>, incremento: 1 | 2): number | null
 *     ASSINATURA NOVA (antes recebia a quantidade): teto da ÚLTIMA faixa ATIVA
 *     = (índice dela + 1) × incremento; null se nenhuma ativa. Recebe as faixas
 *     (não a contagem de ativas) para não depender do invariante de prefixo.
 *   alertaDePreco(faixas: ReadonlyArray<{ taxa: number; ativo: boolean }>, indice, incremento): string | null
 *     compara só ATIVAS: faixa desligada nunca recebe alerta nem é citada.
 *
 *   Helpers novos da tela (puros; devolvem ARRAY NOVO, não mutam a entrada;
 *   preservam taxa/grátis; genéricos no tipo da faixa):
 *   desligarAPartirDe<T extends { ativo: boolean }>(faixas: readonly T[], indice: number): T[]
 *     desliga `indice` e todas as abaixo (C2').
 *   ligarAte<T extends { ativo: boolean }>(faixas: readonly T[], indice: number): T[]
 *     liga da primeira desligada até `indice` (C2'); as abaixo de `indice` seguem como estão.
 *   removerAPartirDe<T>(faixas: readonly T[], indice: number): T[]
 *     apaga `indice` e todas as abaixo (C3').
 */

const MODULO = "@/lib/utils/faixasEntrega";

type Incremento = 1 | 2;
type FaixaEntrega = { taxa: number; pedido_minimo_gratis: number | null; ativo: boolean };
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
  limiteEntregaKm(faixas: ReadonlyArray<{ ativo: boolean }>, incremento: Incremento): number | null;
  alertaDePreco(
    faixas: ReadonlyArray<{ taxa: number; ativo: boolean }>,
    indice: number,
    incremento: Incremento,
  ): string | null;
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

// Helpers novos da iteração 2 resolvidos À PARTE: a ausência deles derruba só
// os testes que os usam, não os de lerFaixas/rótulo/texto (que seguem valendo).
type ModuloTela = {
  desligarAPartirDe<T extends { ativo: boolean }>(faixas: readonly T[], indice: number): T[];
  ligarAte<T extends { ativo: boolean }>(faixas: readonly T[], indice: number): T[];
  removerAPartirDe<T>(faixas: readonly T[], indice: number): T[];
};
const EXPORTS_TELA = ["desligarAPartirDe", "ligarAte", "removerAPartirDe"] as const;

async function modTela(): Promise<ModuloTela> {
  const m = (await import(/* @vite-ignore */ MODULO)) as Partial<Record<(typeof EXPORTS_TELA)[number], unknown>>;
  const faltando = EXPORTS_TELA.filter((n) => typeof m[n] !== "function");
  if (faltando.length > 0) {
    throw new Error(`[RED 326 it.2] \`src/lib/utils/faixasEntrega.ts\` ainda não exporta: ${faltando.join(", ")}.`);
  }
  return m as unknown as ModuloTela;
}

/** Faixa como a tela/lerFaixas devolve (iteração 2: com `ativo`). */
const fx = (taxa: number, gratis: number | null = null, ativo = true): FaixaEntrega => ({
  taxa,
  pedido_minimo_gratis: gratis,
  ativo,
});

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
 * tipo raio_km, ativo = o da faixa (C2', iteração 2). É o contrato da gravação,
 * não a regra de preço — o preço quem decide é `calcularFrete`.
 */
function comoGravado(leitura: LeituraFaixas): ZonaComTaxa[] {
  return leitura.faixas.map((f, i) => ({
    id: `ffffffff-0000-4000-8000-${String(i).padStart(12, "0")}`,
    tipo: "raio_km",
    // Só `false` EXPLÍCITO desliga: mantém os testes de equivalência de preço
    // medindo PREÇO (não quebram por `ativo` ausente); a presença de `ativo`
    // em cada faixa é cobrada pelos toEqual exatos.
    ativo: f.ativo !== false,
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
    expect(r.faixas).toEqual(Array.from({ length: 7 }, () => fx(8)));
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
    // iteração 2: faixa expandida do legado sai SEMPRE com ativo: true
    expect(r.faixas).toEqual([
      fx(5, 50),
      fx(5, 50),
      fx(5, 50),
      fx(9, 100),
      fx(9, 100),
      fx(9, 100),
      fx(9, 100),
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
    expect(r.faixas).toEqual([fx(5), fx(5), fx(8, 70)]);
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
    expect(r.faixas).toEqual(Array.from({ length: 3 }, () => fx(5)));
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
    expect(r.faixas[29]).toEqual(fx(12));
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

// ═════════════════════════════════ F3 it.2 — lerFaixas no FORMATO GRAVADO (D4 ajuste)
/** Zona exatamente como a RPC grava a faixa `i` (0-based). */
const gravadaRpc = (i: number, inc: Incremento, taxa: number, gratis: number | null = null, ativo = true) =>
  zonaRaio(`${i * inc}–${(i + 1) * inc} km`, (i + 1) * inc, taxa, gratis, ativo);

describe("[326/F3 it.2] lerFaixas — zonas no formato gravado abrem UMA faixa por zona, com o `ativo` de cada", () => {
  it("inc 1 [t,t,f] ⇒ 3 faixas (a desligada INCLUSIVE), ativo t/t/f, nada no aviso", async () => {
    const { lerFaixas } = await mod();
    const r = lerFaixas([gravadaRpc(0, 1, 4), gravadaRpc(1, 1, 6, 60), gravadaRpc(2, 1, 7, null, false)]);

    expect(r).toEqual({
      modo: "faixas",
      incremento: 1,
      faixas: [fx(4), fx(6, 60), fx(7, null, false)],
      zonasNoAviso: [],
    });
  });

  it("inc 2 [t,f,f] ⇒ incremento 2 e 3 faixas com ativo t/f/f (preço das desligadas preservado)", async () => {
    const { lerFaixas } = await mod();
    const r = lerFaixas([
      gravadaRpc(0, 2, 4),
      gravadaRpc(1, 2, 6, null, false),
      gravadaRpc(2, 2, 9, 90, false),
    ]);

    expect(r).toEqual({
      modo: "faixas",
      incremento: 2,
      faixas: [fx(4), fx(6, null, false), fx(9, 90, false)],
      zonasNoAviso: [],
    });
  });

  it("TODAS desligadas no formato gravado [f,f] ⇒ abre as 2 faixas desligadas (não a tabela vazia), nada no aviso", async () => {
    const { lerFaixas } = await mod();
    const r = lerFaixas([gravadaRpc(0, 1, 4, null, false), gravadaRpc(1, 1, 6, null, false)]);

    expect(r).toEqual({
      modo: "faixas",
      incremento: 1,
      faixas: [fx(4, null, false), fx(6, null, false)],
      zonasNoAviso: [],
    });
  });

  it("ordem de entrada embaralhada ⇒ faixas na ordem do TETO", async () => {
    const { lerFaixas } = await mod();
    const r = lerFaixas([gravadaRpc(2, 1, 7, null, false), gravadaRpc(0, 1, 4), gravadaRpc(1, 1, 6)]);

    expect(r.faixas).toEqual([fx(4), fx(6), fx(7, null, false)]);
  });

  it("ida e volta: calcularFrete(zonas gravadas [t,t,f], d) === calcularFrete(regravadas de lerFaixas, d)", async () => {
    const { lerFaixas } = await mod();
    const zonas = [gravadaRpc(0, 1, 4), gravadaRpc(1, 1, 6, 60), gravadaRpc(2, 1, 7, null, false)];
    const r = lerFaixas(zonas);

    expect(divergencias(zonas, comoGravado(r), 3, [0, 59.99, 60, 200])).toEqual([]);
  });

  it("BURACO [t,f,t] com nomes derivados NÃO é formato gravado ⇒ caminho da iteração 1 (só ativas, via calcularFrete, ativo true), inativa no aviso", async () => {
    // A RPC nova recusa esse estado; ele só existe se veio de outra via (ex.:
    // Server Action de zona antiga). Abrir tem de manter o preço de HOJE.
    const { lerFaixas } = await mod();
    const buraco = gravadaRpc(1, 1, 6, null, false);
    const zonas = [gravadaRpc(0, 1, 4), buraco, gravadaRpc(2, 1, 8)];
    const r = lerFaixas(zonas);

    expect(r.modo).toBe("faixas");
    expect(r.incremento).toBe(1);
    // d=2 cai na zona ativa de teto 3 (faixa exclusiva) ⇒ R$8
    expect(r.faixas).toEqual([fx(4), fx(8), fx(8)]);
    expect(r.zonasNoAviso.map((z) => z.id)).toEqual([buraco.id]);
    expect(divergencias(zonas, comoGravado(r), 3, [0, 100])).toEqual([]);
  });

  it("inativa com NOME LIVRE no fim (tetos contíguos, mas não é o nome derivado) ⇒ caminho da iteração 1: só a ativa expande, inativa no aviso", async () => {
    const { lerFaixas } = await mod();
    const velha = zonaRaio("Promo", 2, 1, null, false);
    const r = lerFaixas([gravadaRpc(0, 1, 4), velha]);

    expect(r.faixas).toEqual([fx(4)]);
    expect(r.zonasNoAviso.map((z) => z.id)).toEqual([velha.id]);
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

describe("[326/F4 it.2] limiteEntregaKm(faixas, inc) — teto da última faixa ATIVA", () => {
  const ativos = (...v: boolean[]) => v.map((ativo) => ({ ativo }));

  it.each([
    ["[t,t,t] inc 1 ⇒ 3 km", [true, true, true], 1, 3],
    ["[t,t,t] inc 2 ⇒ 6 km", [true, true, true], 2, 6],
    ["[t] inc 1 ⇒ 1 km", [true], 1, 1],
    ["[t,t,f,f,f] inc 1 ⇒ 2 km (desligadas não contam)", [true, true, false, false, false], 1, 2],
    ["[t,f] inc 2 ⇒ 2 km", [true, false], 2, 2],
  ] as const)("%s", async (_n, v, inc, esperado) => {
    const { limiteEntregaKm } = await mod();
    expect(limiteEntregaKm(ativos(...v), inc)).toBe(esperado);
  });

  it("30 faixas ativas inc 2 ⇒ 60 km", async () => {
    const { limiteEntregaKm } = await mod();
    expect(limiteEntregaKm(Array.from({ length: 30 }, () => ({ ativo: true })), 2)).toBe(60);
  });

  it("0 faixas ⇒ null (estado vazio)", async () => {
    const { limiteEntregaKm } = await mod();
    expect(limiteEntregaKm([], 1)).toBeNull();
  });

  it("todas desligadas [f,f,f] ⇒ null (não entrega em distância nenhuma)", async () => {
    const { limiteEntregaKm } = await mod();
    expect(limiteEntregaKm(ativos(false, false, false), 1)).toBeNull();
  });
});

describe("[326/F4] alertaDePreco — C1: preço menor que o MAIOR entre as faixas anteriores", () => {
  const taxas = (...v: number[]) => v.map((taxa) => ({ taxa, ativo: true }));

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

describe("[326/F4 it.2] alertaDePreco — C1 ajuste: compara SÓ faixas ativas", () => {
  const f = (taxa: number, ativo = true) => ({ taxa, ativo });

  it("[4t, 6t, 5f] ⇒ a desligada NÃO recebe alerta (seria 'menor que 1–2 km' se contasse)", async () => {
    const { alertaDePreco } = await mod();
    const faixas = [f(4), f(6), f(5, false)];
    expect([0, 1, 2].map((i) => alertaDePreco(faixas, i, 1))).toEqual([null, null, null]);
  });

  it("[4t, 6t, 5f, 3f] ⇒ nenhuma desligada recebe alerta", async () => {
    const { alertaDePreco } = await mod();
    const faixas = [f(4), f(6), f(5, false), f(3, false)];
    expect([0, 1, 2, 3].map((i) => alertaDePreco(faixas, i, 1))).toEqual([null, null, null, null]);
  });

  it("[4t, 6t, 5t, 9f] ⇒ alerta só na 3ª (ativa), citando 1–2 km; a 4ª desligada fica sem alerta", async () => {
    const { alertaDePreco } = await mod();
    const faixas = [f(4), f(6), f(5), f(9, false)];
    expect(alertaDePreco(faixas, 2, 1)).toBe(
      `Confira o preço: está menor que o da faixa de 1–2 km (${formatarMoeda(6)}). ` +
        `Quem está a 2–3 km vai pagar ${formatarMoeda(5)}.`,
    );
    expect(alertaDePreco(faixas, 3, 1)).toBeNull();
  });

  it("desligada NUNCA é citada: [4t, 9f, 5t] (estado fora do invariante) ⇒ 5 ≥ 4 (única ativa anterior) ⇒ sem alerta", async () => {
    // A tela nunca produz esse estado (helpers mantêm o prefixo), mas o helper
    // não pode depender disso para não citar a faixa de R$9 desligada.
    const { alertaDePreco } = await mod();
    const faixas = [f(4), f(9, false), f(5)];
    expect(alertaDePreco(faixas, 2, 1)).toBeNull();
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

  it("legado (teto decimal) ⇒ false", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(zonasJaSaoFaixas([zonaRaio("0–2.5 km", 2.5, 4)])).toBe(false);
  });

  // Iteração 2 (D4 ajuste): antes, QUALQUER inativa dava false. Agora o formato
  // gravado com final desligado — o que a RPC nova grava — é true.
  it("[it.2] formato gravado com FINAL DESLIGADO [t,f] (inc 1) e [t,t,f] (inc 2) ⇒ true", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(zonasJaSaoFaixas([faixaGravada(0, 1, 4), zonaRaio("1–2 km", 2, 6, null, false)])).toBe(true);
    expect(
      zonasJaSaoFaixas([faixaGravada(0, 2, 4), faixaGravada(1, 2, 6), zonaRaio("4–6 km", 6, 8, null, false)]),
    ).toBe(true);
  });

  it("[it.2] formato gravado com TODAS desligadas ([f] e [f,f]) ⇒ true", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(zonasJaSaoFaixas([zonaRaio("0–1 km", 1, 4, null, false)])).toBe(true);
    expect(
      zonasJaSaoFaixas([zonaRaio("0–1 km", 1, 4, null, false), zonaRaio("1–2 km", 2, 6, null, false)]),
    ).toBe(true);
  });

  it("[it.2] BURACO [t,f,t] com nomes derivados ⇒ false (a RPC nova não grava isso: o Salvar substitui)", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(
      zonasJaSaoFaixas([faixaGravada(0, 1, 4), zonaRaio("1–2 km", 2, 6, null, false), faixaGravada(2, 1, 8)]),
    ).toBe(false);
  });

  it("[it.2] inativa com nome LIVRE ⇒ false (não é o formato gravado)", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(zonasJaSaoFaixas([faixaGravada(0, 1, 4), zonaRaio("Promo", 2, 6, null, false)])).toBe(false);
    expect(zonasJaSaoFaixas([zonaRaio("Velha 3", 3, 5, null, false)])).toBe(false);
  });

  it("teto repetido (duas zonas '0–1 km' + '2–3 km') ⇒ false", async () => {
    const { zonasJaSaoFaixas } = await import("./faixasEntrega");
    expect(
      zonasJaSaoFaixas([faixaGravada(0, 1, 4), faixaGravada(0, 1, 5), faixaGravada(2, 1, 8)]),
    ).toBe(false);
  });
});

// ═════════════════════════════════ F4 it.2 — helpers de switch e lixeira (C2'/C3')
describe("[326/F4 it.2] desligarAPartirDe / ligarAte / removerAPartirDe — mantêm o PREFIXO de ativas", () => {
  const cinco = (...ativos: boolean[]) => ativos.map((ativo, i) => fx(4 + i, i === 1 ? 60 : null, ativo));
  const soAtivo = (fs: ReadonlyArray<{ ativo: boolean }>) => fs.map((f) => f.ativo);

  it("5 ativas, desligar índice 2 ⇒ [t,t,f,f,f] (a faixa e todas abaixo)", async () => {
    const { desligarAPartirDe } = await modTela();
    expect(soAtivo(desligarAPartirDe(cinco(true, true, true, true, true), 2))).toEqual([true, true, false, false, false]);
  });

  it("desligar índice 0 ⇒ todas desligadas", async () => {
    const { desligarAPartirDe } = await modTela();
    expect(soAtivo(desligarAPartirDe(cinco(true, true, true, true, true), 0))).toEqual([false, false, false, false, false]);
  });

  it("de [t,t,f,f,f], ligar índice 4 ⇒ [t,t,t,t,t] (liga da 1ª desligada até ela)", async () => {
    const { ligarAte } = await modTela();
    expect(soAtivo(ligarAte(cinco(true, true, false, false, false), 4))).toEqual([true, true, true, true, true]);
  });

  it("de [t,t,f,f,f], ligar índice 2 ⇒ [t,t,t,f,f] (as abaixo seguem desligadas)", async () => {
    const { ligarAte } = await modTela();
    expect(soAtivo(ligarAte(cinco(true, true, false, false, false), 2))).toEqual([true, true, true, false, false]);
  });

  it("de [f,f,f,f,f], ligar índice 1 ⇒ [t,t,f,f,f]", async () => {
    const { ligarAte } = await modTela();
    expect(soAtivo(ligarAte(cinco(false, false, false, false, false), 1))).toEqual([true, true, false, false, false]);
  });

  it("remover a partir do índice 2 de 5 ⇒ restam as 2 primeiras, intactas", async () => {
    const { removerAPartirDe } = await modTela();
    const antes = cinco(true, true, true, false, false);
    expect(removerAPartirDe(antes, 2)).toEqual([antes[0], antes[1]]);
  });

  it("remover a partir do índice 0 ⇒ lista vazia", async () => {
    const { removerAPartirDe } = await modTela();
    expect(removerAPartirDe(cinco(true, true, true, true, true), 0)).toEqual([]);
  });

  it("preservam taxa e grátis de cada faixa (só `ativo` muda)", async () => {
    const { desligarAPartirDe, ligarAte } = await modTela();
    const antes = cinco(true, true, true, true, true);
    const desligadas = desligarAPartirDe(antes, 1);
    expect(desligadas.map(({ taxa, pedido_minimo_gratis }) => ({ taxa, pedido_minimo_gratis }))).toEqual(
      antes.map(({ taxa, pedido_minimo_gratis }) => ({ taxa, pedido_minimo_gratis })),
    );
    const religadas = ligarAte(desligadas, 4);
    expect(religadas).toEqual(antes);
  });

  it("são PUROS: devolvem array novo e não mutam a entrada nem os objetos dela (estado React)", async () => {
    const { desligarAPartirDe, ligarAte, removerAPartirDe } = await modTela();
    const entrada = cinco(true, true, false, false, false);
    const copia = structuredClone(entrada);

    const a = desligarAPartirDe(entrada, 0);
    const b = ligarAte(entrada, 4);
    const c = removerAPartirDe(entrada, 1);

    expect(entrada).toEqual(copia);
    expect(a).not.toBe(entrada);
    expect(b).not.toBe(entrada);
    expect(c).not.toBe(entrada);
  });

  it("qualquer sequência de operações mantém o invariante de prefixo (nenhuma ativa depois de desligada)", async () => {
    const { desligarAPartirDe, ligarAte, removerAPartirDe } = await modTela();
    let fs = cinco(true, true, true, true, true);
    fs = desligarAPartirDe(fs, 1);
    fs = ligarAte(fs, 3);
    fs = desligarAPartirDe(fs, 2);
    fs = removerAPartirDe(fs, 4);
    fs = ligarAte(fs, 2);
    const v = soAtivo(fs);
    expect(v).toEqual([true, true, true, false]);
    expect(v.findIndex((x, i) => x && v.slice(0, i).includes(false))).toBe(-1);
  });
});
