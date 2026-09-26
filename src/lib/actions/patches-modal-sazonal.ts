// Builder puro do patch do modal sazonal (issue 301). Módulo NEUTRO: sem
// 'use server', função pura síncrona — pode ser importado por painel ↔ admin sem
// arrastar a fronteira de Server Action. Molde: `montarPatchPerfil`
// (patches-loja.ts).
//
// SEGURANÇA (RN-11 / seguranca.md §2): monta o patch COLUNA A COLUNA a partir de
// uma allowlist EXPLÍCITA — NUNCA spread do payload. As colunas autoritativas
// (`id`, `loja_id`, `ativo`, `criado_em`, `atualizado_em`) JAMAIS entram, mesmo
// que cheguem num payload hostil: `ativo` é decidido pelas actions de
// ativar/desativar (transição de estado, RN-05), e `loja_id` é sempre derivado
// de `buscarLojaDoDono`.

import type { DadosModalSazonal } from "@/lib/validacoes/modalSazonal";

/**
 * Contrato de retorno das Server Actions do modal sazonal. Vive aqui (módulo
 * NEUTRO) porque um módulo `'use server'` só pode exportar funções async — não
 * `type` (quebra no `next build`; ver MEMORY use-server-export-constraint).
 */
export type ResultadoModalSazonal = { ok: true } | { ok: false; erro: string };

/** As colunas escalares da linha `modais_sazonais` que criar/editar escrevem. */
export type PatchModalSazonal = {
  titulo: string;
  exibicao_inicio: string;
  exibicao_fim: string;
  mostrar_promocoes_junto?: boolean;
};

/**
 * Monta o patch da linha `modais_sazonais` a partir do dado JÁ validado.
 * Allowlist explícita: `titulo`/`exibicao_inicio`/`exibicao_fim` sempre;
 * `mostrar_promocoes_junto` só quando `!== undefined` (nunca truthiness — `false`
 * PRECISA ser gravado; ausente PRECISA preservar o valor no banco).
 *
 * A SELEÇÃO (`categorias`/`cardapios`) NÃO entra no patch escalar: ela vive em
 * tabelas de junção e é gravada à parte, atomicamente com a linha (RN-06).
 */
export function montarPatchModalSazonal(d: DadosModalSazonal): PatchModalSazonal {
  const patch: PatchModalSazonal = {
    titulo: d.titulo,
    exibicao_inicio: d.exibicao_inicio,
    exibicao_fim: d.exibicao_fim,
  };
  if (d.mostrar_promocoes_junto !== undefined) {
    patch.mostrar_promocoes_junto = d.mostrar_promocoes_junto;
  }
  return patch;
}
