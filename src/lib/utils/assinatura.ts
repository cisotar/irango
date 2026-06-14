// STUB TDD — fase RED (issue 056). NÃO é a implementação.
// A fase GREEN (executar) substitui os corpos por lógica real.
// Existe só para a suite COMPILAR e falhar nas ASSERÇÕES (não no import).

export type StatusAssinatura =
  | "trial"
  | "ativa"
  | "inadimplente"
  | "cancelada"
  | "suspensa";

export type EventoHotmart =
  | "compra_aprovada"
  | "recorrencia_aprovada"
  | "cancelamento"
  | "reembolso"
  | "chargeback"
  | "inadimplencia";

export type ResultadoEvento =
  | { status: StatusAssinatura; renova: boolean }
  | { ignorar: true };

// Mapa evento Hotmart (nome lógico) → estado resultante. Depende SÓ do evento,
// nunca do statusAtual (corte/reativação é decisão do evento, não da transição).
const MAPA_EVENTO: Record<EventoHotmart, { status: StatusAssinatura; renova: boolean }> = {
  compra_aprovada: { status: "ativa", renova: true },
  recorrencia_aprovada: { status: "ativa", renova: true },
  cancelamento: { status: "cancelada", renova: false },
  reembolso: { status: "suspensa", renova: false },
  chargeback: { status: "suspensa", renova: false },
  inadimplencia: { status: "inadimplente", renova: false },
};

export function eventoParaStatus(
  evento: EventoHotmart,
  _statusAtual: StatusAssinatura,
): ResultadoEvento {
  // Input não-confiável: o webhook (057) passa o nome lógico, mas um nome fora
  // do union (evento desconhecido) deve ser IGNORADO — nunca muda estado.
  const resultado = Object.prototype.hasOwnProperty.call(MAPA_EVENTO, evento)
    ? MAPA_EVENTO[evento]
    : undefined;
  if (!resultado) return { ignorar: true };
  return { status: resultado.status, renova: resultado.renova };
}

export function assinaturaPermiteAcesso(
  status: StatusAssinatura,
  fimPeriodo: Date,
  agora: Date,
): boolean {
  // PURA: `agora` é injetado, nunca Date.now()/new Date().
  switch (status) {
    case "ativa":
      return true;
    case "suspensa":
      return false; // corte imediato, sem carência (invariante)
    case "trial":
    case "inadimplente":
    case "cancelada":
      // Carência inclusiva (RN-A4): now() <= fimPeriodo.
      return agora.getTime() <= fimPeriodo.getTime();
  }
}
