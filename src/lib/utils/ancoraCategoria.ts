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

/**
 * [263/RN-16] O que uma seção precisa ter para ser ancorável. ESTRUTURAL de
 * propósito: `SecaoVitrine` (248) e `CategoriaNavegavel` (203) satisfazem sem
 * que este módulo — puro, sem `'use client'` — precise importar nenhum dos dois.
 */
export type SecaoAncoravel = {
  id: string | null;
  tipo: "cardapio" | "categoria";
};

/**
 * [263/RN-16] Âncora da seção de DESTAQUE de um cardápio aberto.
 *
 * O prefixo `cardapio-` não intersecta `cat-` nem `grupo-`: a colisão entre uma
 * seção de cardápio e uma de categoria é impossível POR CONSTRUÇÃO, e não por
 * confiar que um uuid de `cardapios` nunca bata com um de `categorias`.
 * Depender de unicidade acidental entre duas tabelas é premissa que sobrevive
 * só até alguém trocar a chave.
 */
export function ancoraCardapio(id: string): string {
  return `cardapio-${id}`;
}

/**
 * [263/RN-16] O despachante: UMA função para os dois tipos de seção.
 *
 * `SecaoCatalogo` (o `id` da `<section>`) e `NavCategorias` (o `href` do chip)
 * chamam ESTA função — é o que mantém, agora que há dois tipos de seção, o
 * desenho que a issue 201 fixou: duas implementações = links quebrados.
 *
 * Seção de cardápio sem `id` não existe (a chave vem de `cardapios.id`); se
 * aparecer, cai no caminho de categoria em vez de emitir `cardapio-null`.
 */
export function ancoraSecao(secao: SecaoAncoravel, indice: number): string {
  return secao.tipo === "cardapio" && secao.id !== null
    ? ancoraCardapio(secao.id)
    : ancoraCategoria(secao.id, indice);
}

/**
 * [263/RN-16] Único produtor de identidade de DOM para um produto RENDERIZADO
 * NUMA SEÇÃO.
 *
 * Com D16-a o mesmo produto aparece em mais de uma seção da mesma página. Um
 * `produto.id` cru num atributo `id`, `aria-labelledby` ou `aria-describedby`
 * produziria id repetido — e, sem jsdom, id duplicado no DOM NÃO é detectável
 * por teste de render neste repo. Por isso `CardProduto.idNaSecao` é
 * obrigatório: passar o id cru não compila.
 *
 * A `key` do React NÃO usa isto: chave só precisa ser única entre irmãos, cada
 * seção tem seu próprio laço, e trocá-la remontaria o card à toa.
 */
export function idNaSecao(ancoraDaSecao: string, produtoId: string): string {
  return `${ancoraDaSecao}:${produtoId}`;
}
