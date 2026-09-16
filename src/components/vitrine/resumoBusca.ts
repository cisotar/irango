// Copy do modo-busca da vitrine (issue 202).
//
// Módulo NEUTRO (sem "use client"/"use server"), mesmo padrão de
// `medicaoBarraVitrine.ts`/`scrollspyCategorias.ts`: zero dependência de DOM,
// de React e de rede — é o que torna o modo-busca cobrível em
// `environment: node` (o repo não tem jsdom).
//
// Vive aqui e não em `lib/utils/` porque é COPY de UI da vitrine, não regra de
// domínio — mesmo critério que separa `statusConfirmacaoUi.ts` (copy) de
// `transicaoStatus.ts` (regra).
//
// O termo entra só como texto visível: nunca vira seletor CSS, `innerHTML`,
// `RegExp` ou parte de URL, e nunca é logado (seguranca.md §14/§15).

/** O mínimo que a contagem precisa de uma categoria. */
type CategoriaContavel = { produtos: unknown[] };

/** Total de produtos no catálogo já filtrado (`filtrarCatalogo`, 199). */
export function contarProdutos(categorias: CategoriaContavel[]): number {
  let total = 0;
  for (const categoria of categorias) total += categoria.produtos.length;
  return total;
}

/** "produto encontrado" no singular exato de 1; plural em 0 e em 2+. */
function flexionar(total: number): string {
  return total === 1 ? "produto encontrado" : "produtos encontrados";
}

/**
 * Texto VISÍVEL do resumo na barra: `3 produtos encontrados para “pao”`.
 * Aspas curvas (U+201C/U+201D) como no mockup aprovado.
 */
export function textoResumoBusca(total: number, termo: string): string {
  return `${total} ${flexionar(total)} para “${termo}”`;
}

/**
 * Texto ANUNCIADO na região viva. Sem aspas curvas de propósito: leitor de tela
 * soletra pontuação decorativa. Zero resultados vira frase inteira porque
 * "0 produtos encontrados" é confuso em áudio.
 */
export function textoAnuncioBusca(total: number, termo: string): string {
  if (total === 0) return `Nenhum produto encontrado para ${termo}`;
  return `${total} ${flexionar(total)}`;
}
