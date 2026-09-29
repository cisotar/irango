// Regra pura da ocultação de grupo de opcionais POR PRODUTO (issue 331).
//
//   visiveis(produto) = grupos(categoria do produto, na ordem da categoria) − ocultos(produto)
//
// Única cópia da regra: o pedido e o revisarCarrinho usam `idsPermitidosDoProduto`
// (autoridade de valor, `seguranca.md` §10); vitrine e painel usam
// `gruposVisiveisDoProduto` (preview). Semântica SUBTRATIVA: uma linha só
// esconde, nunca libera — oculto de grupo fora da categoria atual é inerte (D3).

/** Uma linha de `produto_opcionais_ocultos`: existe ⇒ o grupo está oculto no produto. */
export type OcultoOpcional = {
  produto_id: string;
  categoria_opcional_id: string;
};

/** `produto_id → ids dos grupos ocultos nele` (serializável: vai ao client pelo RSC). */
export type OcultosPorProduto = Readonly<Record<string, readonly string[]>>;

/** Agrupa as linhas do banco por produto; produto sem linha não ganha chave. */
export function agruparOcultosPorProduto(
  linhas: readonly OcultoOpcional[],
): Record<string, string[]> {
  const mapa: Record<string, string[]> = {};
  for (const { produto_id, categoria_opcional_id } of linhas) {
    (mapa[produto_id] ??= []).push(categoria_opcional_id);
  }
  return mapa;
}

/**
 * O grupo está oculto neste produto? Ausência de linha = exibe. Pergunta sobre o
 * MAPA agrupado; o hook do painel responde pela própria máquina otimista
 * (`criarOcultacoesOtimistas().oculto`, sobre `chaveDoPar`), não por aqui.
 */
export function estaOculto(ocultos: OcultosPorProduto, produtoId: string, grupoId: string): boolean {
  return ocultos[produtoId]?.includes(grupoId) ?? false;
}

/** Allowlist de grupos que o pedido aceita para o produto: categoria − ocultos. Não muta a entrada. */
export function idsPermitidosDoProduto(
  idsDaCategoria: Iterable<string>,
  ocultosDoProduto: Iterable<string> | undefined,
): Set<string> {
  const permitidos = new Set(idsDaCategoria);
  if (ocultosDoProduto) for (const id of ocultosDoProduto) permitidos.delete(id);
  return permitidos;
}

/**
 * Grupos que o produto exibe. É um FILTRO: preserva a ordem de entrada (a ordem da
 * categoria, vinda da query) e devolve os mesmos objetos, sem clonar.
 */
export function gruposVisiveisDoProduto<G extends { categoriaOpcionalId: string }>(
  gruposDaCategoriaOrdenados: readonly G[],
  ocultosDoProduto: Iterable<string> | undefined,
): G[] {
  const ocultos = new Set(ocultosDoProduto ?? []);
  return gruposDaCategoriaOrdenados.filter((g) => !ocultos.has(g.categoriaOpcionalId));
}

// ── Escrita em lote (as duas actions: lojista e admin) ──────────────────────

/** Chave única do par produto×grupo — a do lote aqui e a do estado otimista do hook. */
export const chaveDoPar = (produtoId: string, grupoId: string) => `${produtoId}|${grupoId}`;

/** Uma alteração pedida pela UI: ocultar (`true`) ou voltar a exibir (`false`) o grupo no produto. */
export type AlteracaoOcultacao = {
  produtoId: string;
  categoriaOpcionalId: string;
  oculto: boolean;
};

type ParOculto = OcultoOpcional;

/**
 * Separa o lote em pares a ocultar (upsert) e a exibir (delete). Par repetido no
 * lote vale pela ÚLTIMA alteração — o mesmo par nunca cai nos dois lados.
 */
export function planejarOcultacoes(alteracoes: readonly AlteracaoOcultacao[]): {
  ocultar: ParOculto[];
  exibir: ParOculto[];
} {
  const ultima = new Map<string, AlteracaoOcultacao>();
  for (const a of alteracoes) ultima.set(chaveDoPar(a.produtoId, a.categoriaOpcionalId), a);
  const ocultar: ParOculto[] = [];
  const exibir: ParOculto[] = [];
  for (const a of ultima.values()) {
    const par = { produto_id: a.produtoId, categoria_opcional_id: a.categoriaOpcionalId };
    (a.oculto ? ocultar : exibir).push(par);
  }
  return { ocultar, exibir };
}

/**
 * Filtro PostgREST `or(...)` que casa EXATAMENTE os pares — nunca o produto
 * cartesiano de `in(produto) × in(grupo)`. Agrupa pela coluna com menos valores
 * distintos para encurtar a URL (o "Por produto" manda 1 grupo × N produtos).
 * Os ids chegam validados como uuid pelo zod: nada a escapar.
 */
export function filtroDosPares(pares: readonly ParOculto[]): string {
  const porGrupo = new Map<string, string[]>();
  const porProduto = new Map<string, string[]>();
  const anexar = (mapa: Map<string, string[]>, chave: string, id: string) => {
    const ids = mapa.get(chave);
    if (ids) ids.push(id);
    else mapa.set(chave, [id]);
  };
  for (const { produto_id, categoria_opcional_id } of pares) {
    anexar(porGrupo, categoria_opcional_id, produto_id);
    anexar(porProduto, produto_id, categoria_opcional_id);
  }
  const [chave, lista, mapa] =
    porGrupo.size <= porProduto.size
      ? (["categoria_opcional_id", "produto_id", porGrupo] as const)
      : (["produto_id", "categoria_opcional_id", porProduto] as const);
  return [...mapa]
    .map(([id, ids]) => `and(${chave}.eq.${id},${lista}.in.(${ids.join(",")}))`)
    .join(",");
}
