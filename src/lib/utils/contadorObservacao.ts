import { LIMITE_OBSERVACAO } from "@/lib/constants/pedido";

// Derivações do contador de caracteres do textarea de observação (issue 169).
//
// Pura e sem dependência de React/DOM de propósito: os dois consumidores são
// componentes `'use client'` (ProdutoModal na vitrine e EtapaPagamento no
// checkout) e o `environment` da suíte é `node` — sem jsdom não dá para testar
// o JSX, mas dá para travar aqui a regra dos limiares.
//
// ⚠️ Tudo deriva de LIMITE_OBSERVACAO (src/lib/constants/pedido.ts). Nenhum
// literal do teto (200) pode aparecer em componente ou aqui: mudar a constante
// tem que mudar contador, aviso e `maxLength` de uma vez só.
//
// O contador é UX: a autoridade do teto é o zod do servidor (issue 167) e o
// CHECK da RPC (166). Este módulo nunca corta nem valida texto.

/** Fração do teto a partir da qual o campo entra em estado de alerta (10%). */
const FRACAO_ALERTA = 0.1;

export type ContadorObservacao = {
  /** Caracteres já digitados (unidades UTF-16, igual ao `.length` do textarea). */
  usados: number;
  /** Quanto ainda cabe. Pode ser negativo com rascunho antigo acima do teto. */
  restantes: number;
  /** Margem que dispara o alerta — usada no texto do aviso. */
  margemAlerta: number;
  /** true a partir dos últimos 10% do teto (inclui o limite atingido). */
  proximoDoLimite: boolean;
  /** true quando não cabe mais nada (ou já passou, em rascunho legado). */
  noLimite: boolean;
  /**
   * Texto da live region. Muda SÓ nos dois limiares — nunca a cada tecla, senão
   * o leitor de tela vira metralhadora. "" = nada a anunciar.
   */
  aviso: string;
};

/**
 * Deriva o estado do contador a partir do texto cru do campo.
 *
 * `limite` só é parâmetro para o teste poder variar o teto e provar que nada
 * está preso ao 200 — em produção sempre usa o default.
 */
export function derivarContadorObservacao(
  texto: string,
  limite: number = LIMITE_OBSERVACAO,
): ContadorObservacao {
  const usados = texto.length;
  const restantes = limite - usados;
  const margemAlerta = Math.round(limite * FRACAO_ALERTA);
  const proximoDoLimite = restantes <= margemAlerta;
  const noLimite = restantes <= 0;

  // Ordem importa: no limite também é "próximo do limite", e a mensagem de
  // limite atingido é a mais específica.
  const aviso = noLimite
    ? `Limite de ${limite} caracteres atingido.`
    : proximoDoLimite
      ? `Menos de ${margemAlerta} caracteres restantes.`
      : "";

  return { usados, restantes, margemAlerta, proximoDoLimite, noLimite, aviso };
}

/** Texto de ajuda estático abaixo do campo. */
export function ajudaObservacao(limite: number = LIMITE_OBSERVACAO): string {
  return `Opcional. Até ${limite} caracteres.`;
}
