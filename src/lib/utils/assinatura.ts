// STUB TDD — fase RED (issue 056). NÃO é a implementação.
// A fase GREEN (executar) substitui os corpos por lógica real.
// Existe só para a suite COMPILAR e falhar nas ASSERÇÕES (não no import).

export type StatusAssinatura =
  | "trial"
  | "ativa"
  | "inadimplente"
  | "cancelada"
  | "suspensa"
  | "cortesia";

// Evento lógico de billing — PROVIDER-AGNÓSTICO (issue 075). NÃO é o nome cru do
// payload do provider (isso é traduzido no adapter, issue 076); aqui já chega
// normalizado, igual EventoHotmart.
export type EventoBilling =
  | "cobranca_aprovada"
  | "recorrencia_aprovada"
  | "pagamento_falhou"
  | "assinatura_cancelada"
  | "reembolso"
  | "chargeback";

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

// Mapa evento lógico de billing → estado resultante (issue 075). Espelha
// MAPA_EVENTO/eventoParaStatus, mas provider-agnóstico: depende só de `tipo`.
const MAPA_EVENTO_BILLING: Record<
  EventoBilling,
  { status: StatusAssinatura; renova: boolean }
> = {
  cobranca_aprovada: { status: "ativa", renova: true },
  recorrencia_aprovada: { status: "ativa", renova: true },
  pagamento_falhou: { status: "inadimplente", renova: false },
  assinatura_cancelada: { status: "cancelada", renova: false },
  reembolso: { status: "suspensa", renova: false },
  chargeback: { status: "suspensa", renova: false },
};

export function eventoBillingParaStatus(
  _provider: string,
  tipo: string,
): ResultadoEvento {
  // Input não-confiável: `tipo` fora do union (evento desconhecido) deve ser
  // IGNORADO — nunca muda estado (evita retry infinito). `_provider` é aceito por
  // contrato (077) mas não ramifica nesta v1 — semântica única provider-agnóstica.
  const resultado = Object.prototype.hasOwnProperty.call(
    MAPA_EVENTO_BILLING,
    tipo,
  )
    ? MAPA_EVENTO_BILLING[tipo as EventoBilling]
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
    case "cortesia":
      // cortesia: acesso pleno, ignora fimPeriodo (igual ativa, RN-4). INVARIANTE
      // de segurança: este status SÓ é gravável por admin via service_role (RN-12)
      // — o lojista nunca o seta (trigger lojas_protege_billing + allowlist da
      // Server Action de loja). Logo `true` aqui não é escalável pelo tenant.
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
