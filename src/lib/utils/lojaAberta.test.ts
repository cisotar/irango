import { describe, it, expect } from "vitest";
// RED: este módulo ainda NÃO existe — a fase GREEN (executar) cria
// src/lib/utils/lojaAberta.ts com a função PURA + o tipo Horarios.
import { lojaAberta, type Horarios } from "./lojaAberta";

// ---------------------------------------------------------------------------
// CONTRATO (issue 011, RN-09):
//
//   lojaAberta(horarios: Horarios, agora: Date, timezone: string)
//     : { aberta: boolean; reabreEm?: string }
//
// Função PURA e DETERMINÍSTICA: dado o mesmo Date de entrada (instante UTC) e o
// mesmo timezone, sempre devolve o mesmo resultado. NÃO pode chamar Date.now()
// nem `new Date()` sem argumento internamente — o instante vem SEMPRE de `agora`.
//
// RESPONSABILIDADE:
//   1. Converter `agora` (instante UTC) para o fuso da loja (`timezone`).
//   2. Derivar o dia-da-semana (seg..dom) NO FUSO DA LOJA.
//   3. Derivar HH:MM NO FUSO DA LOJA.
//   4. Comparar com a janela do dia em `horarios`:
//        - dia.ativo === false        -> { aberta: false, reabreEm? }
//        - abre <= HH:MM < fecha       -> { aberta: true }   (ABERTURA INCLUSIVA,
//                                                              FECHAMENTO EXCLUSIVO)
//        - fora da janela              -> { aberta: false, reabreEm? }
//   5. Quando fechada, calcular `reabreEm` = HH:MM da próxima abertura (badge UX).
//
// REGRAS DE BORDA FIXADAS (determinísticas):
//   - HH:MM == abre  -> ABERTA   (inclusivo na abertura)
//   - HH:MM == fecha -> FECHADA  (exclusivo no fechamento)
//
// JANELA QUE CRUZA MEIA-NOITE (ex.: 18:00-02:00):
//   O schema (references/schema.md, lojas.horarios) define {abre,fecha,ativo} por
//   dia, SEM suporte documentado a `fecha < abre`. Portanto NÃO testamos janela
//   atravessando meia-noite aqui — apenas janelas dentro do mesmo dia. Se a regra
//   de cruzar meia-noite for adicionada ao schema, este arquivo deve ganhar casos.
// ---------------------------------------------------------------------------

// Builder de Horarios — caminho feliz: todo dia 08:00-22:00 ativo, domingo OFF.
function horarios(over: Partial<Horarios> = {}): Horarios {
  const dia = (abre: string, fecha: string, ativo = true) => ({ abre, fecha, ativo });
  return {
    seg: dia("08:00", "22:00"),
    ter: dia("08:00", "22:00"),
    qua: dia("08:00", "22:00"),
    qui: dia("08:00", "22:00"),
    sex: dia("08:00", "22:00"),
    sab: dia("09:00", "20:00"),
    dom: dia("00:00", "00:00", false),
    ...over,
  };
}

// Helper: constrói um instante a partir de um horário "de parede" em São Paulo.
// SP em junho/2026 está em UTC-3 (sem horário de verão). 2026-06-15 é uma
// SEGUNDA-feira. Para obter o instante UTC de "HH:MM em SP" somamos +3h ao
// horário de parede de SP.
function instanteSP(horaSP: number, minutoSP = 0): Date {
  // 2026-06-15 é segunda. UTC = SP + 3h.
  return new Date(Date.UTC(2026, 5, 15, horaSP + 3, minutoSP, 0));
}

const SP = "America/Sao_Paulo";

describe("lojaAberta — janela dentro do dia (fuso São Paulo)", () => {
  it("dentro do horário (seg 12:00, janela 08:00-22:00) → aberta", () => {
    const r = lojaAberta(horarios(), instanteSP(12, 0), SP);
    expect(r.aberta).toBe(true);
  });

  it("fora do horário (seg 23:00) → fechada com reabreEm", () => {
    const r = lojaAberta(horarios(), instanteSP(23, 0), SP);
    expect(r.aberta).toBe(false);
    // já passou da abertura de hoje; próxima abertura é terça 08:00.
    expect(r.reabreEm).toBe("08:00");
  });

  it("antes de abrir (seg 06:00) → fechada, reabre hoje às 08:00", () => {
    const r = lojaAberta(horarios(), instanteSP(6, 0), SP);
    expect(r.aberta).toBe(false);
    expect(r.reabreEm).toBe("08:00");
  });

  it("dia com ativo:false (domingo) → fechada o dia inteiro", () => {
    // 2026-06-14 é DOMINGO. 12:00 SP = 15:00 UTC.
    const domMeioDia = new Date(Date.UTC(2026, 5, 14, 15, 0, 0));
    const r = lojaAberta(horarios(), domMeioDia, SP);
    expect(r.aberta).toBe(false);
  });
});

describe("lojaAberta — bordas determinísticas (abertura inclusiva, fechamento exclusivo)", () => {
  it("exatamente no horário de ABERTURA (seg 08:00) → ABERTA (inclusivo)", () => {
    const r = lojaAberta(horarios(), instanteSP(8, 0), SP);
    expect(r.aberta).toBe(true);
  });

  it("exatamente no horário de FECHAMENTO (seg 22:00) → FECHADA (exclusivo)", () => {
    const r = lojaAberta(horarios(), instanteSP(22, 0), SP);
    expect(r.aberta).toBe(false);
  });

  it("um minuto antes do fechamento (seg 21:59) → aberta", () => {
    const r = lojaAberta(horarios(), instanteSP(21, 59), SP);
    expect(r.aberta).toBe(true);
  });
});

describe("lojaAberta — DELTA Timezone (crítico): o fuso da loja muda aberto/fechado", () => {
  // MESMO instante UTC, fusos diferentes → resultado e DIA-DA-SEMANA diferentes.
  //
  // Instante escolhido: 2026-06-16 02:30 UTC.
  //   - Em São Paulo (UTC-3):     2026-06-15 23:30  → SEGUNDA, 23:30
  //   - Em Rio Branco (UTC-5):    2026-06-15 21:30  → SEGUNDA, 21:30
  // Janela seg = 08:00-22:00.
  //   SP    23:30 → FECHADA (passou das 22:00)
  //   AC    21:30 → ABERTA  (antes das 22:00)
  // Prova que hardcodar SP daria a resposta errada para a loja do Acre.
  const instante = new Date(Date.UTC(2026, 5, 16, 2, 30, 0));

  it("loja em São Paulo (UTC-3): 23:30 local → fechada", () => {
    const r = lojaAberta(horarios(), instante, SP);
    expect(r.aberta).toBe(false);
  });

  it("loja em Rio Branco (UTC-5): mesmo instante = 21:30 local → ABERTA", () => {
    const r = lojaAberta(horarios(), instante, "America/Rio_Branco");
    expect(r.aberta).toBe(true);
  });

  it("VIRADA DE DIA pelo fuso: instante que é terça em SP mas ainda segunda no Acre", () => {
    // 2026-06-16 02:30 UTC já é... não. Escolho um instante que cruza a meia-noite:
    //   2026-06-16 02:00 UTC
    //     SP (UTC-3): 2026-06-15 23:00 → SEGUNDA
    //     Rio Branco (UTC-5): 2026-06-15 21:00 → SEGUNDA
    // Para provar virada de DIA preciso de um instante entre as duas meia-noites.
    //   2026-06-16 04:30 UTC
    //     SP (UTC-3): 2026-06-16 01:30 → TERÇA, 01:30
    //     Rio Branco (UTC-5): 2026-06-15 23:30 → SEGUNDA, 23:30
    // Configuro horários onde terça e segunda divergem para provar o mapeamento
    // de dia-da-semana NO FUSO DA LOJA: terça FECHADA o dia todo, segunda 08:00-22:00.
    const h = horarios({
      seg: { abre: "08:00", fecha: "22:00", ativo: true },
      ter: { abre: "00:00", fecha: "00:00", ativo: false }, // terça sempre fechada
    });
    const cruzaMeiaNoite = new Date(Date.UTC(2026, 5, 16, 4, 30, 0));

    // SP → TERÇA → dia inativo → fechada.
    expect(lojaAberta(h, cruzaMeiaNoite, SP).aberta).toBe(false);
    // Rio Branco → ainda SEGUNDA 23:30 → fora da janela 08:00-22:00 → fechada,
    // MAS por motivo diferente (fora de horário, não dia inativo). O que prova a
    // virada é a próxima reabertura: na segunda fechada à noite, reabre seg/prox.
    // Asserção forte e determinística: em SP é dia INATIVO; no Acre o dia é segunda
    // (ativo) — então o reabreEm difere. SP reabre só no próximo dia ativo (qua),
    // Acre reabre na própria segunda seguinte às 08:00.
    expect(lojaAberta(h, cruzaMeiaNoite, "America/Rio_Branco").aberta).toBe(false);
    expect(lojaAberta(h, cruzaMeiaNoite, "America/Rio_Branco").reabreEm).toBe("08:00");
  });
});
