import { describe, it, expect } from "vitest";
// RED: este módulo ainda NÃO existe — a fase GREEN (executar) cria
// src/lib/utils/calcularFrete.ts com a função pura + estes tipos.
import {
  calcularFrete,
  normalizarBairro,
  type ZonaComTaxa,
  type EnderecoEntrega,
} from "./calcularFrete";

// ---------------------------------------------------------------------------
// Builders mínimos de ZonaComTaxa — função PURA, sem pglite. Defaults pensados
// para o caminho feliz; cada teste sobrescreve só o que precisa.
// ---------------------------------------------------------------------------

function zonaBairro(over: Partial<ZonaComTaxa> = {}): ZonaComTaxa {
  return {
    id: "zona-centro",
    tipo: "bairro",
    ativo: true,
    taxa: {
      taxa: 7,
      pedido_minimo_gratis: null,
      raio_max_km: null,
      cep_inicio: null,
      cep_fim: null,
    },
    bairros: [{ nome: "Centro" }],
    ...over,
  };
}

function zonaRaio(over: Partial<ZonaComTaxa> = {}): ZonaComTaxa {
  return {
    id: "zona-raio",
    tipo: "raio_km",
    ativo: true,
    taxa: {
      taxa: 9,
      pedido_minimo_gratis: null,
      raio_max_km: 5,
      cep_inicio: null,
      cep_fim: null,
    },
    bairros: [],
    ...over,
  };
}

const enderecoCentro: EnderecoEntrega = { bairro: "Centro" };

describe("calcularFrete", () => {
  // 1. Caminho feliz — frete por bairro
  it("retorna a taxa da zona quando o bairro casa", () => {
    const r = calcularFrete([zonaBairro()], enderecoCentro, 30);
    expect(r).toEqual({
      atendido: true,
      taxa: 7,
      zonaId: "zona-centro",
      gratis: false,
    });
  });

  // 2. Normalização de bairro (trim + case-insensitive)
  it("casa o bairro ignorando caixa e espaços nas pontas", () => {
    const r = calcularFrete([zonaBairro()], { bairro: "  CENTRO " }, 30);
    expect(r.atendido).toBe(true);
    expect(r.zonaId).toBe("zona-centro");
    expect(r.taxa).toBe(7);
  });

  // 3a. Frete grátis: subtotal >= pedido_minimo_gratis
  it("dá frete grátis quando subtotal atinge o mínimo (>=), preservando zonaId", () => {
    const zona = zonaBairro({
      taxa: { taxa: 7, pedido_minimo_gratis: 50, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], enderecoCentro, 50);
    expect(r).toEqual({
      atendido: true,
      taxa: 0,
      zonaId: "zona-centro",
      gratis: true,
    });
  });

  // 3b. Borda: subtotal um centavo abaixo do mínimo → taxa cheia
  it("cobra taxa cheia quando subtotal está logo abaixo do mínimo", () => {
    const zona = zonaBairro({
      taxa: { taxa: 7, pedido_minimo_gratis: 50, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], enderecoCentro, 49.99);
    expect(r.gratis).toBe(false);
    expect(r.taxa).toBe(7);
    expect(r.atendido).toBe(true);
  });

  // 4. pedido_minimo_gratis null → nunca grátis
  it("nunca dá frete grátis quando pedido_minimo_gratis é null", () => {
    const r = calcularFrete([zonaBairro()], enderecoCentro, 9999);
    expect(r.gratis).toBe(false);
    expect(r.taxa).toBe(7);
  });

  // 5. Fora de área — sentinela distinguível de frete grátis
  it("retorna sentinela atendido:false quando o bairro não é atendido", () => {
    const r = calcularFrete([zonaBairro()], { bairro: "Bairro Inexistente" }, 30);
    expect(r).toEqual({
      atendido: false,
      taxa: 0,
      zonaId: null,
      gratis: false,
    });
    // distinção explícita: taxa 0 aqui NÃO é frete grátis
    expect(r.atendido).toBe(false);
    expect(r.gratis).toBe(false);
  });

  // 6. Zona inativa ignorada
  it("ignora zona que contém o bairro mas está inativa", () => {
    const r = calcularFrete([zonaBairro({ ativo: false })], enderecoCentro, 30);
    expect(r.atendido).toBe(false);
    expect(r.zonaId).toBeNull();
  });

  // 7. Zona sem taxa (mal configurada) ignorada
  it("ignora zona com taxa null", () => {
    const r = calcularFrete([zonaBairro({ taxa: null })], enderecoCentro, 30);
    expect(r.atendido).toBe(false);
  });

  // 8. Raio_km (assinatura extensível)
  it("atende por raio quando distanciaKm <= raio_max_km", () => {
    const r = calcularFrete([zonaRaio()], { distanciaKm: 3 }, 30);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(9);
    expect(r.zonaId).toBe("zona-raio");
  });

  it("não atende por raio quando distanciaKm excede raio_max_km", () => {
    const r = calcularFrete([zonaRaio()], { distanciaKm: 6 }, 30);
    expect(r.atendido).toBe(false);
  });

  it("não atende por raio quando distanciaKm está ausente", () => {
    const r = calcularFrete([zonaRaio()], {}, 30);
    expect(r.atendido).toBe(false);
  });

  // 9. Faixa CEP — schema de faixa NÃO existe (cep_inicio/cep_fim).
  //    Comportamento atual: não-atendido. NÃO inventar colunas.
  it("não atende por faixa de CEP enquanto o schema de faixa não existir", () => {
    const zonaFaixa = zonaBairro({
      id: "zona-faixa",
      tipo: "faixa_cep",
      bairros: [],
    });
    const r = calcularFrete([zonaFaixa], { cep: "01001000" }, 30);
    expect(r.atendido).toBe(false);
  });

  // 10. Arredondamento — saída 2 casas, tipo number, sem float drift
  it("arredonda a taxa para 2 casas sem drift e retorna number", () => {
    const zona = zonaBairro({
      taxa: { taxa: 5.1, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], enderecoCentro, 30);
    expect(r.taxa).toBe(5.1);
    expect(typeof r.taxa).toBe("number");
  });

  it("normaliza taxa com mais de 2 casas para exatamente 2 casas", () => {
    const zona = zonaBairro({
      taxa: { taxa: 10.999, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], enderecoCentro, 30);
    expect(r.taxa).toBe(11);
  });

  // 11. Múltiplas zonas casando → menor taxa; empate → primeira
  it("escolhe a zona de menor taxa quando várias casam", () => {
    const cara = zonaBairro({ id: "zona-cara", taxa: { taxa: 7, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null } });
    const barata = zonaBairro({ id: "zona-barata", taxa: { taxa: 5, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null } });
    const r = calcularFrete([cara, barata], enderecoCentro, 30);
    expect(r.taxa).toBe(5);
    expect(r.zonaId).toBe("zona-barata");
  });

  it("em empate de taxa escolhe a primeira zona da lista (determinístico)", () => {
    const a = zonaBairro({ id: "zona-a", taxa: { taxa: 6, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null } });
    const b = zonaBairro({ id: "zona-b", taxa: { taxa: 6, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null } });
    const r = calcularFrete([a, b], enderecoCentro, 30);
    expect(r.taxa).toBe(6);
    expect(r.zonaId).toBe("zona-a");
  });

  // 12. Lista vazia / endereço vazio
  it("retorna atendido:false para lista de zonas vazia", () => {
    const r = calcularFrete([], enderecoCentro, 30);
    expect(r.atendido).toBe(false);
    expect(r.zonaId).toBeNull();
  });

  it("retorna atendido:false para endereço sem bairro nem distância", () => {
    const r = calcularFrete([zonaBairro()], {}, 30);
    expect(r.atendido).toBe(false);
  });

  // PARIDADE preview ↔ servidor: a MESMA chamada (mesmo input) deve dar o MESMO
  // resultado, seja no preview da vitrine (cliente) ou no recálculo autoritativo
  // da Server Action. É o teste que pega drift cliente/servidor.
  it("é determinística — mesmo input produz o mesmo resultado (preview ≡ servidor)", () => {
    const zonas = [zonaBairro()];
    const preview = calcularFrete(zonas, enderecoCentro, 30);
    const servidor = calcularFrete(zonas, enderecoCentro, 30);
    expect(preview).toEqual(servidor);
  });

  // 13. pedido_minimo_gratis = 0 → todo pedido é grátis (semantica: 0 ≠ null)
  // Risco financeiro: lojista que salva 0 por engano faz a loja nunca cobrar frete.
  // O teste documenta o comportamento DEFINIDO — 0 = "sempre grátis" — para que
  // qualquer mudança futura seja uma decisão consciente, não regressão silenciosa.
  it("pedido_minimo_gratis=0 concede frete grátis para qualquer subtotal >= 0", () => {
    const zona = zonaBairro({
      taxa: { taxa: 7, pedido_minimo_gratis: 0, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], enderecoCentro, 0);
    expect(r.gratis).toBe(true);
    expect(r.taxa).toBe(0);
    expect(r.atendido).toBe(true);
  });

  // 14. taxa = 0 legítima (zona com frete fixo grátis, sem mínimo exigido)
  // Distinguível de "fora de área" pelo campo atendido: true.
  // Garante que o caller não confunde taxa:0 com sentinela de fora-de-área.
  it("zona com taxa=0 e pedido_minimo_gratis=null retorna atendido:true taxa:0 gratis:false", () => {
    const zona = zonaBairro({
      taxa: { taxa: 0, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], enderecoCentro, 30);
    expect(r).toEqual({
      atendido: true,
      taxa: 0,
      zonaId: "zona-centro",
      gratis: false,
    });
    // estado distinguível de fora-de-área (atendido:false, taxa:0, gratis:false)
    expect(r.atendido).toBe(true);
    expect(r.gratis).toBe(false);
  });

  // 15. raio_max_km null em zona tipo raio_km → zona ignorada (mal configurada)
  // Sem este teste, loja que salva zona raio sem raio_max_km fica silenciosamente
  // sem entregar para nenhum endereço — bug operacional sem mensagem de erro.
  it("zona raio_km sem raio_max_km (null) não atende nenhuma distância", () => {
    const zona = zonaRaio({
      taxa: { taxa: 9, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], { distanciaKm: 1 }, 30);
    expect(r.atendido).toBe(false);
    expect(r.zonaId).toBeNull();
  });

  // 16. FIX auditoria: taxa negativa no banco NÃO pode reduzir o total.
  // Piso 0 — o cliente nunca paga frete negativo.
  it("zona com taxa negativa retorna taxa:0 (piso), atendido:true", () => {
    const zona = zonaBairro({
      taxa: { taxa: -5, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], enderecoCentro, 30);
    expect(r.taxa).toBe(0);
    expect(r.atendido).toBe(true);
  });
});

// ===========================================================================
// [070] normalizarBairro — função pura exportada
// TDD RED — testes escritos antes da exportação (issue 070, crítica).
// A fase GREEN exporta normalizarBairro de calcularFrete.ts.
// normalizarBairro já importada no topo junto com calcularFrete.
// ===========================================================================

// ===========================================================================
// [064] faixa_cep habilitado — schema ganha cep_inicio/cep_fim em taxas_entrega
// TDD RED — escritos ANTES da migration + da extensão de zonaAtende('faixa_cep').
// Hoje calcularFrete retorna atendido:false para faixa_cep (TODO no código) e o
// tipo Taxa NÃO tem cep_inicio/cep_fim. A fase GREEN: migration das colunas +
// zonaAtende casando CEP numérico vs [cep_inicio, cep_fim] (plano D2/D5).
//
// Estes testes EXIGEM cep_inicio/cep_fim no objeto taxa — referenciar campos
// inexistentes no tipo Taxa quebra o type-check ⇒ RED por contrato de tipo, e
// quando o tipo existir mas a lógica não, RED por asserção (atendido:false).
// ===========================================================================

function zonaFaixaCep(over: Partial<ZonaComTaxa> = {}): ZonaComTaxa {
  return {
    id: "zona-faixa",
    tipo: "faixa_cep",
    ativo: true,
    taxa: {
      taxa: 8,
      pedido_minimo_gratis: null,
      raio_max_km: null,
      // colunas novas (issue 064) — só dígitos, sem hífen.
      cep_inicio: 1000000,
      cep_fim: 1099999,
    },
    bairros: [],
    ...over,
  };
}

describe("calcularFrete — [064] faixa_cep", () => {
  // CASO 4 — CEP dentro da faixa → atendido com a taxa da zona.
  it("atende quando o CEP (numérico) está dentro de [cep_inicio, cep_fim]", () => {
    const r = calcularFrete([zonaFaixaCep()], { cep: "01001-000" }, 30);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(8);
    expect(r.zonaId).toBe("zona-faixa");
  });

  it("aceita CEP com ou sem hífen — normaliza para dígitos antes de comparar", () => {
    const semHifen = calcularFrete([zonaFaixaCep()], { cep: "01001000" }, 30);
    const comHifen = calcularFrete([zonaFaixaCep()], { cep: "01001-000" }, 30);
    expect(semHifen).toEqual(comHifen);
    expect(semHifen.atendido).toBe(true);
  });

  // Borda inferior e superior inclusivas.
  it("inclui as bordas da faixa (cep_inicio e cep_fim inclusivos)", () => {
    const inicio = calcularFrete([zonaFaixaCep()], { cep: "01000000" }, 30);
    const fim = calcularFrete([zonaFaixaCep()], { cep: "01099999" }, 30);
    expect(inicio.atendido).toBe(true);
    expect(fim.atendido).toBe(true);
  });

  it("NÃO atende CEP fora da faixa (acima do cep_fim)", () => {
    const r = calcularFrete([zonaFaixaCep()], { cep: "02000-000" }, 30);
    expect(r.atendido).toBe(false);
    expect(r.zonaId).toBeNull();
  });

  it("NÃO atende quando o endereço não traz CEP", () => {
    const r = calcularFrete([zonaFaixaCep()], { bairro: "Centro" }, 30);
    expect(r.atendido).toBe(false);
  });

  it("zona faixa_cep mal configurada (cep_inicio/cep_fim null) não atende", () => {
    const zona = zonaFaixaCep({
      taxa: { taxa: 8, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], { cep: "01001-000" }, 30);
    expect(r.atendido).toBe(false);
  });
});

describe("normalizarBairro — [070]", () => {
  it("converte para minúsculas", () => {
    expect(normalizarBairro("CENTRO")).toBe("centro");
  });

  it("remove espaços nas pontas (trim)", () => {
    expect(normalizarBairro("  centro  ")).toBe("centro");
  });

  it("colapsa múltiplos espaços internos em um único", () => {
    expect(normalizarBairro("jardim  america")).toBe("jardim america");
  });

  it("remove acentos via NFD (a diferença central da issue 070 vs. impl anterior)", () => {
    // 'Águas Claras' → 'aguas claras' (remove á, â, etc.)
    expect(normalizarBairro("Águas Claras")).toBe("aguas claras");
    expect(normalizarBairro("São Paulo")).toBe("sao paulo");
    expect(normalizarBairro("Jardim América")).toBe("jardim america");
  });

  it('"Jardim América", "jardim america" e " JARDIM  AMÉRICA " todos produzem o mesmo resultado', () => {
    const a = normalizarBairro("Jardim América");
    const b = normalizarBairro("jardim america");
    const c = normalizarBairro(" JARDIM  AMÉRICA ");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("é determinística — mesmo input sempre produz mesmo output", () => {
    const entrada = "Bairro Ñoño";
    expect(normalizarBairro(entrada)).toBe(normalizarBairro(entrada));
  });

  it("não colapsa espaços internos legítimos de um só espaço", () => {
    expect(normalizarBairro("Vila Nova")).toBe("vila nova");
  });
});

// ===========================================================================
// [070] calcularFrete com taxaForaZona (fallback fora-de-zona)
// TDD RED — testes escritos antes da extensão de assinatura (issue 070, crítica).
// A fase GREEN adiciona o parâmetro taxaForaZona: number | null a calcularFrete.
// ===========================================================================

describe("calcularFrete — [070] fallback taxaForaZona", () => {
  it("bairro sem zona + taxaForaZona definida → atendido:true com taxa do fallback", () => {
    // Nenhuma zona cobre "Bairro Remoto", mas loja aceita entrega fora de zona
    const r = calcularFrete([zonaBairro()], { bairro: "Bairro Remoto" }, 30, 8);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(8);
    expect(r.zonaId).toBeNull(); // fallback, não zona específica
    expect(r.gratis).toBe(false);
  });

  it("bairro sem zona + taxaForaZona=null → atendido:false (entrega indisponível)", () => {
    const r = calcularFrete([zonaBairro()], { bairro: "Bairro Remoto" }, 30, null);
    expect(r.atendido).toBe(false);
    expect(r.taxa).toBe(0);
    expect(r.zonaId).toBeNull();
  });

  it("bairro sem zona + taxaForaZona omitido (undefined) → atendido:false (backward compat)", () => {
    // Sem o 4º argumento — comportamento atual preservado
    const r = calcularFrete([zonaBairro()], { bairro: "Bairro Remoto" }, 30);
    expect(r.atendido).toBe(false);
  });

  it("bairro com zona casa → usa zona, ignora taxaForaZona (zona vence o fallback)", () => {
    const r = calcularFrete([zonaBairro()], enderecoCentro, 30, 99);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(7); // taxa da zona, não 99 do fallback
    expect(r.zonaId).toBe("zona-centro");
  });

  it("acento/caixa não impedem match — 'Águas Claras' casa com bairro_zona.nome 'aguas claras'", () => {
    const zona = zonaBairro({
      id: "zona-aguas-claras",
      bairros: [{ nome: "aguas claras" }],
      taxa: { taxa: 6, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], { bairro: "Águas Claras" }, 30, null);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(6);
    expect(r.zonaId).toBe("zona-aguas-claras");
  });

  it("acento no nome da zona também é normalizado — 'Jardim América' no banco casa com 'jardim america' no cliente", () => {
    const zona = zonaBairro({
      id: "zona-jardim",
      bairros: [{ nome: "Jardim América" }], // nome com acento no banco
      taxa: { taxa: 5, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
    });
    const r = calcularFrete([zona], { bairro: "jardim america" }, 30, null);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(5);
  });

  it("taxaForaZona=0 é taxa válida (frete grátis fora de zona = decisão do lojista)", () => {
    const r = calcularFrete([zonaBairro()], { bairro: "Bairro Remoto" }, 30, 0);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(0);
    expect(r.zonaId).toBeNull();
  });

  it("lista de zonas vazia + taxaForaZona definida → atendido:true com fallback", () => {
    const r = calcularFrete([], { bairro: "Qualquer Bairro" }, 30, 12);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(12);
    expect(r.zonaId).toBeNull();
  });

  it("lista de zonas vazia + taxaForaZona=null → atendido:false", () => {
    const r = calcularFrete([], { bairro: "Qualquer Bairro" }, 30, null);
    expect(r.atendido).toBe(false);
  });
});

// ===========================================================================
// [181] Faixas EXCLUSIVAS de raio_km (anel), não discos concorrentes
// TDD RED — escritos ANTES de qualquer alteração em calcularFrete.ts.
// Regra alvo (plano técnico D1): entre as zonas raio_km que atendem
// (dist <= raio_max_km, predicado inalterado), a faixa é a de MENOR
// raio_max_km — nunca a de menor taxa. O piso do anel é o teto da faixa
// anterior, derivado por ordenação; não há comparação de preço ENTRE faixas
// de raio. Depois disso (etapa 3 do D1) a faixa eleita ainda disputa por
// MENOR taxa com as candidatas bairro/faixa_cep (D2 — regra preservada).
// Desempate de raio_max_km igual (D5): taxa DECRESCENTE, depois id crescente.
// ===========================================================================

/** Faixa de raio: teto (raio_max_km), taxa e id explícitos — o essencial do #181. */
function faixaRaio(
  id: string,
  raio_max_km: number,
  taxa: number,
  pedido_minimo_gratis: number | null = null,
): ZonaComTaxa {
  return {
    id,
    tipo: "raio_km",
    ativo: true,
    taxa: {
      taxa,
      pedido_minimo_gratis,
      raio_max_km,
      cep_inicio: null,
      cep_fim: null,
    },
    bairros: [],
  };
}

// Caso numérico validado pelo usuário: 0–1 = R$ 4, 1,1–2 = R$ 6, 2,1–3 = R$ 8.
const FAIXAS_1_2_3 = [
  faixaRaio("faixa-1km", 1, 4),
  faixaRaio("faixa-2km", 2, 6),
  faixaRaio("faixa-3km", 3, 8),
];

describe("calcularFrete — [181] faixas exclusivas de raio_km", () => {
  // Caminho feliz: o caso do enunciado da issue.
  it("cliente a 1,5 km paga a faixa 1,1–2 km (R$ 6), não a mais barata que atende", () => {
    const r = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 1.5 }, 30, null);
    expect(r).toEqual({
      atendido: true,
      taxa: 6,
      zonaId: "faixa-2km",
      gratis: false,
    });
  });

  // Bordas exatas — teto inclusivo, piso implícito = teto da faixa anterior.
  it("1,0 km cai na faixa 0–1 km (R$ 4) — teto inclusivo", () => {
    const r = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 1.0 }, 30, null);
    expect(r.taxa).toBe(4);
    expect(r.zonaId).toBe("faixa-1km");
  });

  it("1,1 km cai na faixa 1,1–2 km (R$ 6)", () => {
    const r = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 1.1 }, 30, null);
    expect(r.taxa).toBe(6);
    expect(r.zonaId).toBe("faixa-2km");
  });

  it("2,0 km ainda cai na faixa 1,1–2 km (R$ 6) — teto inclusivo", () => {
    const r = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 2.0 }, 30, null);
    expect(r.taxa).toBe(6);
    expect(r.zonaId).toBe("faixa-2km");
  });

  it("2,1 km cai na faixa 2,1–3 km (R$ 8)", () => {
    const r = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 2.1 }, 30, null);
    expect(r.taxa).toBe(8);
    expect(r.zonaId).toBe("faixa-3km");
  });

  it("distância fracionária logo acima do teto (1,02 km) cai na faixa seguinte", () => {
    // haversine devolve float cru; o piso implícito é '> 1', não '>= 1,1'.
    const r = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 1.02 }, 30, null);
    expect(r.taxa).toBe(6);
    expect(r.zonaId).toBe("faixa-2km");
  });

  // Acima da última faixa → fallback fora-de-zona (bloco inalterado, aqui pela
  // via de raio: nenhum teste existente cobre 'acima da última FAIXA').
  it("3,1 km está fora de todas as faixas → taxaForaZona quando definida", () => {
    const r = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 3.1 }, 30, 15);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(15);
    expect(r.zonaId).toBeNull();
    expect(r.gratis).toBe(false);
  });

  it("3,1 km com taxaForaZona=null → entrega indisponível", () => {
    const r = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 3.1 }, 30, null);
    expect(r).toEqual({
      atendido: false,
      taxa: 0,
      zonaId: null,
      gratis: false,
    });
  });

  // A regressão que motivou a issue: preço fora de ordem.
  it("preço fora de ordem (até 2km=R$6, até 3km=R$5) NÃO dá o frete mais barato a 1,5 km", () => {
    const zonas = [faixaRaio("ate-2km", 2, 6), faixaRaio("ate-3km", 3, 5)];
    const r = calcularFrete(zonas, { distanciaKm: 1.5 }, 30, null);
    expect(r.taxa).toBe(6);
    expect(r.zonaId).toBe("ate-2km");
  });

  // pedido_minimo_gratis avaliado NA FAIXA ESCOLHIDA — não em qualquer faixa
  // que atenda. Grátis não pode "puxar" a eleição para a faixa errada.
  it("pedido_minimo_gratis de faixa que NÃO cobre a distância não concede frete grátis", () => {
    const zonas = [
      faixaRaio("faixa-certa-2km", 2, 6, null), // a que cobre 1,5 km
      faixaRaio("faixa-errada-3km", 3, 5, 30), // mínimo atingido pelo subtotal
    ];
    const r = calcularFrete(zonas, { distanciaKm: 1.5 }, 50, null);
    expect(r.gratis).toBe(false);
    expect(r.taxa).toBe(6);
    expect(r.zonaId).toBe("faixa-certa-2km");
  });

  it("pedido_minimo_gratis DA faixa escolhida concede grátis normalmente", () => {
    const zonas = [
      faixaRaio("faixa-certa-2km", 2, 6, 40),
      faixaRaio("faixa-errada-3km", 3, 5, null),
    ];
    const r = calcularFrete(zonas, { distanciaKm: 1.5 }, 50, null);
    expect(r.gratis).toBe(true);
    expect(r.taxa).toBe(0);
    expect(r.zonaId).toBe("faixa-certa-2km");
  });

  // D3 — a query (listarZonasComTaxas) não tem ORDER BY: a ordem das zonas é
  // NÃO determinística. O resultado não pode depender dela.
  it("ordem da lista de zonas não altera o resultado (D3 — query sem ORDER BY)", () => {
    const a = faixaRaio("ate-2km", 2, 6);
    const b = faixaRaio("ate-3km", 3, 5);
    const c = faixaRaio("ate-1km", 1, 4);
    const ordem1 = calcularFrete([a, b, c], { distanciaKm: 1.5 }, 30, null);
    const ordem2 = calcularFrete([b, c, a], { distanciaKm: 1.5 }, 30, null);
    const ordem3 = calcularFrete([c, a, b], { distanciaKm: 1.5 }, 30, null);
    expect(ordem1).toEqual(ordem2);
    expect(ordem2).toEqual(ordem3);
    expect(ordem1.taxa).toBe(6);
    expect(ordem1.zonaId).toBe("ate-2km");
  });

  // D5 — misconfiguração: dois tetos iguais. Ambiguidade NUNCA reduz o frete.
  it("empate de raio_max_km resolve pela MAIOR taxa (D5 — ambiguidade não barateia)", () => {
    const zonas = [faixaRaio("empate-barata", 2, 6), faixaRaio("empate-cara", 2, 9)];
    const r = calcularFrete(zonas, { distanciaKm: 1.5 }, 30, null);
    expect(r.taxa).toBe(9);
    expect(r.zonaId).toBe("empate-cara");
  });

  it("empate de raio_max_km E de taxa resolve por id crescente, não pela ordem da lista", () => {
    const zonas = [faixaRaio("zona-b", 2, 6), faixaRaio("zona-a", 2, 6)];
    const r = calcularFrete(zonas, { distanciaKm: 1.5 }, 30, null);
    expect(r.zonaId).toBe("zona-a");
    expect(r.taxa).toBe(6);
  });

  // D2 — bairro/faixa_cep continuam na regra de MENOR taxa, agora disputando
  // com a FAIXA já eleita (não com todas as faixas de raio).
  it("faixa de raio eleita disputa por menor taxa com zona de bairro (D2 preservado)", () => {
    // Faixa correta para 1,5 km = ate-2km (R$ 6); a faixa ate-3km (R$ 5) não
    // pode mais entrar na disputa. A zona de bairro custa R$ 7 → vence a faixa.
    const zonas = [
      faixaRaio("ate-2km", 2, 6),
      faixaRaio("ate-3km", 3, 5),
      zonaBairro({
        id: "zona-centro",
        taxa: { taxa: 7, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
      }),
    ];
    const r = calcularFrete(zonas, { bairro: "Centro", distanciaKm: 1.5 }, 30, null);
    expect(r.taxa).toBe(6);
    expect(r.zonaId).toBe("ate-2km");
  });

  it("zona de bairro mais barata que a faixa eleita continua vencendo (menor taxa entre categorias)", () => {
    const zonas = [
      faixaRaio("ate-2km", 2, 6),
      faixaRaio("ate-3km", 3, 5),
      zonaBairro({
        id: "zona-centro",
        taxa: { taxa: 3, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: null, cep_fim: null },
      }),
    ];
    const r = calcularFrete(zonas, { bairro: "Centro", distanciaKm: 1.5 }, 30, null);
    expect(r.taxa).toBe(3);
    expect(r.zonaId).toBe("zona-centro");
  });

  // D4 — distância ausente: nenhuma candidata de raio, a seleção de faixa nem roda.
  it("distanciaKm ausente com faixas cadastradas → sem candidata de raio, cai no fallback", () => {
    const r = calcularFrete(FAIXAS_1_2_3, { bairro: "Centro" }, 30, 15);
    expect(r.atendido).toBe(true);
    expect(r.taxa).toBe(15);
    expect(r.zonaId).toBeNull();
  });

  // Paridade preview (frete.ts:136) ≡ autoritativo (pedido.ts:288): os dois
  // call sites chamam ESTA função pura com as mesmas zonas do banco.
  it("preview ≡ valor autoritativo — mesma entrada, mesmo ResultadoFrete", () => {
    const preview = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 1.5 }, 30, null);
    const autoritativo = calcularFrete(FAIXAS_1_2_3, { distanciaKm: 1.5 }, 30, null);
    expect(preview).toEqual(autoritativo);
    expect(autoritativo.taxa).toBe(6);
  });

  // ---------------------------------------------------------------------
  // [testar] Gaps encontrados na revisão de cobertura pós-implementação.
  // ---------------------------------------------------------------------

  // Zona raio_km INATIVA com teto menor não pode competir pela eleição —
  // o filtro de `ativo` (etapa 1) precisa rodar ANTES da regra de menor
  // teto (etapa 2a). Sem este teste, um bug que movesse o filtro `ativo`
  // para depois da seleção de faixa faria a zona inativa (teto 1, mais
  // barata) vencer por engano — passaria despercebido porque nenhum caso
  // existente combina `ativo:false` com `tipo:"raio_km"`.
  it("zona raio_km inativa com raio_max_km menor não compete com a ativa de raio maior", () => {
    const inativaMaisBarata = faixaRaio("inativa-1km", 1, 4);
    inativaMaisBarata.ativo = false;
    const ativaMaisCara = faixaRaio("ativa-3km", 3, 8);
    const r = calcularFrete(
      [inativaMaisBarata, ativaMaisCara],
      { distanciaKm: 0.5 },
      30,
      null,
    );
    expect(r.zonaId).toBe("ativa-3km");
    expect(r.taxa).toBe(8);
  });

  // raio_max_km = 0 (dado malformado, mas não null): trava o comportamento
  // atual — só atende dist exatamente 0. Documenta que o código não trata
  // 0 como "sem limite" nem como zona desabilitada; é o predicado `<=` cru.
  it("raio_max_km = 0 só atende distância exatamente 0 (dado malformado travado)", () => {
    const zero = faixaRaio("raio-zero", 0, 100);
    const distanciaZero = calcularFrete([zero], { distanciaKm: 0 }, 30, null);
    expect(distanciaZero.atendido).toBe(true);
    expect(distanciaZero.zonaId).toBe("raio-zero");

    const distanciaPositiva = calcularFrete([zero], { distanciaKm: 0.01 }, 30, null);
    expect(distanciaPositiva.atendido).toBe(false);
  });

  // raio_max_km negativo (dado malformado): nunca atende nenhuma distância
  // não-negativa. Trava que a comparação `dist <= raio_max_km` não recebe
  // tratamento especial para negativos — continua simplesmente falso.
  it("raio_max_km negativo nunca atende nenhuma distância (dado malformado travado)", () => {
    const negativa = faixaRaio("raio-negativo", -1, 50);
    const r = calcularFrete([negativa], { distanciaKm: 0 }, 30, null);
    expect(r.atendido).toBe(false);
  });

  // Precisão de ponto flutuante: tetos muito próximos (1.99 vs 2.00) não
  // podem colidir por erro de arredondamento binário no comparador
  // `tetoA !== tetoB` / `tetoA < tetoB`. Se o comparador algum dia trocar
  // para uma comparação com epsilon mal calibrada, este teste denuncia.
  it("tetos próximos mas distintos (1,99 vs 2,00) não colidem por erro de ponto flutuante", () => {
    const teto199 = faixaRaio("teto-199", 1.99, 5);
    const teto200 = faixaRaio("teto-200", 2.0, 7);

    // 1,995 km só é coberto pelo teto de 2,00 — a faixa mais estreita fica de fora.
    const acimaDe199 = calcularFrete(
      [teto199, teto200],
      { distanciaKm: 1.995 },
      30,
      null,
    );
    expect(acimaDe199.zonaId).toBe("teto-200");
    expect(acimaDe199.taxa).toBe(7);

    // 1,99 km é coberto pelos dois — a de MENOR teto (1,99) deve vencer,
    // não a de 2,00 por causa de alguma comparação aproximada.
    const exatamente199 = calcularFrete(
      [teto199, teto200],
      { distanciaKm: 1.99 },
      30,
      null,
    );
    expect(exatamente199.zonaId).toBe("teto-199");
    expect(exatamente199.taxa).toBe(5);
  });

  // 3+ faixas de raio disputando simultaneamente (não só um par) — prova
  // que "menor raio_max_km entre as candidatas" generaliza além de dois
  // elementos, e que a vencedora não depende de qual delas aparece
  // primeiro/segunda na lista.
  it("com 3+ faixas de raio candidatas, vence a de menor teto entre todas elas", () => {
    const t2 = faixaRaio("teto-2km", 2, 6);
    const t3 = faixaRaio("teto-3km", 3, 5);
    const t4 = faixaRaio("teto-4km", 4, 3);
    // 1,5 km é coberto pelas três (todas têm teto >= 1,5).
    const comTres = calcularFrete([t2, t3, t4], { distanciaKm: 1.5 }, 30, null);
    expect(comTres.zonaId).toBe("teto-2km");
    expect(comTres.taxa).toBe(6);

    // Ordem embaralhada não muda o resultado.
    const embaralhado = calcularFrete([t4, t2, t3], { distanciaKm: 1.5 }, 30, null);
    expect(embaralhado).toEqual(comTres);

    // Sem a faixa de menor teto (t2), a de menor teto ENTRE AS RESTANTES
    // (t3) precisa vencer — não pode "pular" direto para t4.
    const semT2 = calcularFrete([t3, t4], { distanciaKm: 1.5 }, 30, null);
    expect(semT2.zonaId).toBe("teto-3km");
    expect(semT2.taxa).toBe(5);
  });

  // Zona raio_km ATIVA mas com taxa:null (mal configurada, sem linha em
  // taxas_entrega) precisa ser excluída na etapa 1 (candidatas), ANTES de
  // qualquer comparação de raio_max_km — nenhum teste existente combina
  // `taxa:null` com `tipo:"raio_km"` disputando junto com outra faixa de
  // raio válida.
  it("zona raio_km ativa com taxa:null é excluída antes da seleção de faixa, mesmo concorrendo com outra de raio", () => {
    const semTaxa: ZonaComTaxa = {
      id: "raio-sem-taxa",
      tipo: "raio_km",
      ativo: true,
      taxa: null,
      bairros: [],
    };
    const valida = faixaRaio("raio-valida-3km", 3, 8);
    const r = calcularFrete([semTaxa, valida], { distanciaKm: 0.5 }, 30, null);
    expect(r.zonaId).toBe("raio-valida-3km");
    expect(r.taxa).toBe(8);
  });
});
