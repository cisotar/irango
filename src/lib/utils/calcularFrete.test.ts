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
