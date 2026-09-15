/**
 * Slug-âncora estável de um grupo do catálogo. Fonte ÚNICA: `SecaoCatalogo`
 * emite o `id` da <section> e `NavCategorias` (203) monta o href a partir
 * DESTA função. Duas implementações = links quebrados (spec §Modelos de Dados).
 *
 * Módulo puro de propósito (sem `'use client'`): é chamável de Server
 * Component. Um export de valor vindo de módulo `'use client'` vira referência
 * de cliente e explode no SSR — por isso a função NÃO mora em
 * `SecaoCatalogo.tsx` nem é re-exportada de lá (issue 201, decisão D1).
 */
export function ancoraCategoria(id: string | null, indice: number): string {
  return id ? `cat-${id}` : `grupo-${indice}`;
}
