// Mecânica temporal do retry do preview de frete (issue 180-B, §D8).
//
// Módulo NEUTRO (sem "use client"/"use server", igual a `estado.ts` e
// `aberturaWhatsapp.ts`): só a MECÂNICA, com o relógio INJETADO por parâmetro —
// o repo não tem jsdom, então nada de `setTimeout` global aqui.
//
// O relógio é 100% CLIENTE e NÃO é autoridade sobre nada (mandato 1): o
// servidor não conta tentativa, não guarda estado de retry e recalcula o valor
// do zero em `criarPedido`. O único efeito deste módulo é QUANDO o cliente
// pede de novo — nunca QUANTO ele paga. A proteção contra abuso é a que já
// existe (rate limit `fretePreview` + tetos diários do geocoder).

import type { ResultadoFretePreview } from "@/lib/actions/frete";
import {
  VEREDITO_A_COMBINAR_RETRIAVEL,
  type VereditoACombinar,
} from "@/lib/utils/freteDegradado";

/**
 * t=10s e t=20s a partir da chamada que ABRIU o modal (decisão do usuário: essa
 * chamada já é a tentativa 1; o cliente faz mais 2 — total 3).
 */
export const ATRASOS_RETRY_MS = [10_000, 10_000] as const;

/**
 * Resultado de uma tentativa: o PRÓPRIO retorno de `calcularFreteAction` (o
 * union ganhou a variante `a_combinar` na 180-B). Alias mantido porque é o
 * nome que descreve o papel aqui; o tipo é importado, não redeclarado, para
 * que preview e retry não possam divergir. Import só de TIPO — nada do módulo
 * "use server" entra no bundle do cliente.
 */
export type ResultadoTentativaFrete = ResultadoFretePreview;

export type FaseRetry = "aguardando" | "tentando" | "sucesso" | "esgotado";

export type EstadoRetry = { tentativa: 1 | 2 | 3; fase: FaseRetry };

export interface DepsRetryFrete {
  /** Re-chama `calcularFreteAction` — uma chamada nova e independente. */
  tentar: () => Promise<ResultadoTentativaFrete>;
  /** `setTimeout` injetado. */
  agendar: (fn: () => void, ms: number) => number;
  /** `clearTimeout` injetado. */
  cancelar: (id: number) => void;
  /** Notifica a UI (spinner, "tentativa 2 de 3", passo 3). */
  aoEstado: (e: EstadoRetry) => void;
}

export interface ControladorRetryFrete {
  /**
   * Arranca o relógio a partir do veredito que ABRIU o modal.
   * Só `a_combinar_retriavel` agenda: `a_combinar_esgotado` e
   * `a_combinar_cep` vão direto ao passo 3, sem spinner e sem consumir
   * tentativa.
   */
  iniciar: (vereditoInicial: VereditoACombinar) => void;
  /** Unmount / troca de etapa: limpa o timer pendente. Idempotente. */
  parar: () => void;
}

export function criarRetryFrete(deps: DepsRetryFrete): ControladorRetryFrete {
  // Índice do PRÓXIMO atraso em ATRASOS_RETRY_MS. A chamada que abriu o modal
  // já foi a tentativa 1, então o índice 0 corresponde à tentativa 2.
  let proximo = 0;
  let timer: number | null = null;
  let parado = false;

  function cancelarPendente(): void {
    if (timer == null) return;
    deps.cancelar(timer);
    timer = null;
  }

  /** `1 | 2 | 3` — a tentativa que o índice `i` de atraso produz. */
  function numeroTentativa(i: number): 1 | 2 | 3 {
    return (i + 2) as 1 | 2 | 3;
  }

  function agendarProxima(): void {
    if (parado) return;
    const atraso = ATRASOS_RETRY_MS[proximo];
    // Tentativas esgotadas: NADA mais é agendado (no máximo 2 chamadas extras).
    if (atraso == null) return;

    const indice = proximo;
    proximo += 1;
    deps.aoEstado({ tentativa: numeroTentativa(indice), fase: "aguardando" });
    timer = deps.agendar(() => {
      timer = null;
      void tentativa(indice);
    }, atraso);
  }

  async function tentativa(indice: number): Promise<void> {
    if (parado) return;
    const numero = numeroTentativa(indice);
    deps.aoEstado({ tentativa: numero, fase: "tentando" });

    const r = await deps.tentar();
    if (parado) return;

    // Sucesso (ou erro que não é a-combinar): o relógio morre aqui — quem
    // decide o que mostrar é a UI, com o resultado que ela mesma recebeu.
    if (!("a_combinar" in r)) {
      cancelarPendente();
      deps.aoEstado({ tentativa: numero, fase: "sucesso" });
      return;
    }

    // Continua a combinar: só o motivo RETRIÁVEL justifica gastar outra
    // chamada — `esgotado` e `cep` vão direto ao passo do WhatsApp.
    if (r.veredito !== VEREDITO_A_COMBINAR_RETRIAVEL) {
      cancelarPendente();
      deps.aoEstado({ tentativa: numero, fase: "esgotado" });
      return;
    }

    if (proximo >= ATRASOS_RETRY_MS.length) {
      deps.aoEstado({ tentativa: numero, fase: "esgotado" });
      return;
    }
    agendarProxima();
  }

  return {
    iniciar(vereditoInicial: VereditoACombinar): void {
      // Sem spinner e sem consumir tentativa quando retentar não adianta.
      if (vereditoInicial !== VEREDITO_A_COMBINAR_RETRIAVEL) {
        deps.aoEstado({ tentativa: 1, fase: "esgotado" });
        return;
      }
      agendarProxima();
    },
    parar(): void {
      parado = true;
      cancelarPendente();
    },
  };
}
