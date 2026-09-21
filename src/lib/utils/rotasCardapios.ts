/**
 * [269] As DUAS bases de rota da área de cardápios, declaradas fora das duas
 * árvores que as consomem.
 *
 * Por que não escrever o literal na página: `rotaCardapiosInjetada.test.tsx`
 * vigia `components/painel/**`, o `ProdutosClient` e — desde a 269 — a pasta
 * `cardapios/` do painel do lojista, proibindo o literal `"/painel/cardapios`
 * ali dentro. A trava existe porque o mesmo bug voltou duas vezes (`8bfe902`,
 * `f26cc6a`): uma rota do painel escrita em código que o hub admin também monta
 * manda o admin — que edita a loja de um TERCEIRO — para o painel da própria
 * loja dele. Com as duas bases aqui, um mundo não pode herdar a rota do outro
 * por descuido, e a base do admin só existe em função de um `lojaId`.
 *
 * Módulo puro: nenhuma leitura, nenhuma decisão. Quem escolhe qual base usar é
 * sempre o Server Component do mundo correspondente.
 */

/** A base do painel do LOJISTA: a loja é derivada de `auth.uid()` no servidor. */
export const ROTA_CARDAPIOS_LOJISTA = "/painel/cardapios";

/** A base do hub ADMIN, sempre escopada pela LOJA-ALVO da URL. */
export function rotaCardapiosAdmin(lojaId: string): string {
  return `/admin/assinantes/${lojaId}/cardapios`;
}
