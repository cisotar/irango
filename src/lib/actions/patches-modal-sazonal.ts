// Builder puro dos argumentos da RPC `salvar_modal_sazonal` (issue 301 → 314).
// Módulo NEUTRO: sem 'use server', função pura síncrona — pode ser importado por
// painel ↔ admin sem arrastar a fronteira de Server Action. Molde:
// `montarPatchPerfil` (patches-loja.ts).
//
// SEGURANÇA (RN-11 / seguranca.md §2): monta os argumentos COLUNA A COLUNA a
// partir de uma allowlist EXPLÍCITA — NUNCA spread do payload. As colunas
// autoritativas (`id`, `loja_id`, `ativo`, `criado_em`, `atualizado_em`) JAMAIS
// entram, mesmo que cheguem num payload hostil: `ativo` é decidido pelas actions
// de ativar/desativar (transição de estado, RN-05). `p_loja_id` (derivado de
// `buscarLojaDoDono`) e `p_modal_id` (id de rota validado) são acrescentados
// pela Server Action, nunca por aqui.

import { z } from "zod";

import type { DadosModalSazonal } from "@/lib/validacoes/modalSazonal";
import type { MensagemModalValidada } from "@/lib/validacoes/mensagemModal";

/**
 * Mensagens de erro e o guard de `id` COMPARTILHADOS pelas duas vias do modal
 * sazonal — a do lojista (`@/lib/actions/modalSazonal`) e a do admin
 * (`admin/assinantes/actions/admin-modal-sazonal`). Vivem aqui pelo mesmo
 * motivo de `ResultadoModalSazonal`: módulo `'use server'` só exporta funções
 * async, então constante e helper síncrono moram no módulo NEUTRO (precedente:
 * `galeria-contrato.ts`). Duplicá-los deixaria as duas telas divergirem na
 * copy sem nada quebrar.
 */
export const ERRO_VALIDACAO = "Dados inválidos. Confira os campos e tente novamente.";
export const ERRO_GENERICO = "Não foi possível salvar. Tente novamente.";

/** RN-M10: `id` de rota é uuid ANTES de rate-limit, client e query. */
export function idModalValido(id: unknown): id is string {
  return z.guid().safeParse(id).success;
}

/**
 * Contrato de retorno das Server Actions do modal sazonal. Vive aqui (módulo
 * NEUTRO) porque um módulo `'use server'` só pode exportar funções async — não
 * `type` (quebra no `next build`; ver MEMORY use-server-export-constraint).
 */
export type ResultadoModalSazonal = { ok: true } | { ok: false; erro: string };

/** Argumentos nomeados da RPC que vêm do payload validado (sem loja/modal). */
export type ArgsSalvarModalSazonal = {
  p_titulo: string;
  p_exibicao_inicio: string;
  p_exibicao_fim: string;
  p_mensagem: MensagemModalValidada | null;
  /** `null` = preservar o valor gravado (edição) / default da coluna (criação). */
  p_mostrar_promocoes_junto: boolean | null;
  p_categorias: string[];
  p_cardapios: string[];
};

/**
 * Monta os argumentos da RPC atômica (RN-M15) a partir do dado JÁ validado.
 * `p_mostrar_promocoes_junto`: ausente → `null` (preservar); `false` é
 * repassado como `false` (nunca truthiness).
 */
export function montarPatchModalSazonal(d: DadosModalSazonal): ArgsSalvarModalSazonal {
  return {
    p_titulo: d.titulo,
    p_exibicao_inicio: d.exibicao_inicio,
    p_exibicao_fim: d.exibicao_fim,
    p_mensagem: d.mensagem,
    p_mostrar_promocoes_junto:
      d.mostrar_promocoes_junto === undefined ? null : d.mostrar_promocoes_junto,
    p_categorias: d.categorias,
    p_cardapios: d.cardapios,
  };
}
