/**
 * [253] `calcularFimDoPreset` — a ÚNICA fórmula de "início + duração" do prazo
 * fixo de cardápio (Spec B, RN-04 · design §9.3).
 *
 * Existe por uma armadilha concreta: `Date.prototype.setMonth` **transborda** —
 * 31/01 + 1 mês vira 03/03, não 28/02. O Postgres (`interval '1 month'`) faz o
 * CLAMP para o último dia do mês de destino, e a UI precisa dizer o mesmo
 * número que a Server Action grava. Uma fórmula, dois lados.
 *
 * Função PURA e isomórfica: `inicio` é parâmetro (nenhum relógio é lido aqui) e
 * o preview do form pode chamá-la — mas a AUTORIDADE é a Server Action, que
 * recalcula o `prazo_fim` e descarta o que veio do cliente (RN-04). O
 * `prazo_preset` é eco de UI; a verdade são `prazo_inicio`/`prazo_fim`.
 *
 * `customizado` NÃO passa por aqui: é o único preset em que o `fim` digitado
 * pelo lojista é aceito, e por isso não está no tipo `PresetPrazo`.
 *
 * Toda conversão de fuso vem de `./fusoLoja` (mandato 2): nenhum `Intl` e
 * nenhuma tabela de offset escritos aqui.
 */

import { horaLocalNoFuso, instanteNoFuso } from "./fusoLoja";

/** Os três presets do banco que o servidor RECALCULA (`customizado` fica fora). */
export type PresetPrazo = "diario" | "semanal" | "mensal";

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * O instante de FIM (exclusivo) do prazo que começa em `inicio`.
 *
 * - `diario` → `inicio + 1 dia`, `semanal` → `inicio + 7 dias`: dias de 24h
 *   exatas, aritmética de INSTANTE, o fuso não participa (mesma convenção do
 *   prazo de desconto);
 * - `mensal` → `inicio + 1 mês` no CALENDÁRIO LOCAL da loja, com clamp para o
 *   último dia do mês de destino. Aqui o fuso participa, porque "o mesmo dia do
 *   mês seguinte" é uma noção civil: o mês vira à meia-noite da LOJA.
 */
export function calcularFimDoPreset(
  inicio: Date,
  preset: PresetPrazo,
  timezone: string,
): Date {
  if (!Number.isFinite(inicio.getTime())) {
    throw new Error("Início inválido para o preset de prazo");
  }

  if (preset === "diario") return new Date(inicio.getTime() + DIA_MS);
  if (preset === "semanal") return new Date(inicio.getTime() + 7 * DIA_MS);

  // mensal — a única aritmética de calendário do Spec B.
  const [data, hora] = horaLocalNoFuso(inicio.toISOString(), timezone).split("T");
  const [ano, mes, dia] = data.split("-").map(Number);

  const anoDestino = mes === 12 ? ano + 1 : ano;
  const mesDestino = mes === 12 ? 1 : mes + 1;
  // O CLAMP: 31/01 → 28/02 (ou 29/02 em ano bissexto), 31/03 → 30/04.
  const diaDestino = Math.min(dia, diasNoMes(anoDestino, mesDestino));

  const local = `${dois(anoDestino, 4)}-${dois(mesDestino)}-${dois(diaDestino)}T${hora}`;
  return new Date(instanteNoFuso(local, timezone));
}

/**
 * Último dia do mês `mes` (1..12) de `ano`. `Date.UTC(ano, mes, 0)` é o dia 0
 * do mês SEGUINTE, isto é, o último do mês pedido — e o ano bissexto sai do
 * próprio calendário, sem regra de 4/100/400 escrita à mão.
 */
function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function dois(n: number, largura = 2): string {
  return String(n).padStart(largura, "0");
}
