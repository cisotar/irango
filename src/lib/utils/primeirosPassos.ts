// Etapas e retomada do assistente de primeiros passos (issue 368, D6). PURO.
// A retomada parte só das pendências do gate (`pendenciasPublicacao`), então
// zod, gate, aviso D15 e retomada leem a mesma regra. Horários, entregas e
// opcionais nunca têm pendência: horários tem default, entrega não entra no
// gate e opcionais pode ser pulado.
import type { PendenciaPublicacao } from "./publicacao";

export const ROTA_PRIMEIROS_PASSOS = "/painel/primeiros-passos";

export const ETAPAS_ASSISTENTE = [
  { etapa: "perfil", rotulo: "Perfil" },
  { etapa: "horarios", rotulo: "Horários" },
  { etapa: "entregas", rotulo: "Entregas" },
  { etapa: "pagamentos", rotulo: "Pagamentos" },
  { etapa: "produtos", rotulo: "Produtos" },
  { etapa: "opcionais", rotulo: "Opcionais", podePular: true },
  { etapa: "revisar", rotulo: "Revisar e publicar" },
] as const;

export type EtapaAssistente = (typeof ETAPAS_ASSISTENTE)[number]["etapa"];

export function rotaDaEtapa(e: EtapaAssistente): string {
  return `${ROTA_PRIMEIROS_PASSOS}/${e}`;
}

/** Etapa onde a pendência se resolve. "localizacao" → revisar (botão D14). */
export function etapaDaPendencia(p: PendenciaPublicacao): EtapaAssistente {
  switch (p.tipo) {
    case "perfil":
    case "endereco":
      return "perfil";
    case "localizacao":
      return "revisar";
    case "pagamento":
      return "pagamentos";
    case "produto":
      return "produtos";
  }
}

const INDICE_ETAPA = new Map<EtapaAssistente, number>(
  ETAPAS_ASSISTENTE.map((e, i) => [e.etapa, i]),
);

export function etapasComPendencia(
  pendencias: readonly PendenciaPublicacao[],
): ReadonlySet<EtapaAssistente> {
  return new Set(pendencias.map(etapaDaPendencia));
}

/** Etapa de menor índice com pendência; sem pendência → "revisar". */
export function etapaDeRetomada(
  pendencias: readonly PendenciaPublicacao[],
): EtapaAssistente {
  let melhor: EtapaAssistente = "revisar";
  for (const etapa of etapasComPendencia(pendencias)) {
    if ((INDICE_ETAPA.get(etapa) ?? 0) < (INDICE_ETAPA.get(melhor) ?? 0)) {
      melhor = etapa;
    }
  }
  return melhor;
}
