// Decisões PURAS da página da galeria (specs/galeria-imagens-loja.md, páginas
// 1 e 2). Sem I/O e sem React: o ambiente de teste não tem jsdom, então tudo
// que decide texto, lista ou fila mora aqui e é testado ao lado.

import {
  MAXIMO_LOTE_REMOCAO,
  MSG_MUITAS_TENTATIVAS,
  MSG_TETO,
  TETO_IMAGENS_POR_LOJA,
  plural,
  type ImagemGaleria,
  type UsoImagem,
} from "@/lib/actions/galeria-contrato";

// ── Lista da grade ───────────────────────────────────────────────────────────
// Idempotentes por `id`: a resposta da action e o refresh do servidor podem
// chegar em qualquer ordem, e a mesma imagem nunca aparece duas vezes.

/** Imagem recém-enviada vai para o topo (a grade é "mais recentes primeiro"). */
export function incluirNoInicio(
  lista: readonly ImagemGaleria[],
  nova: ImagemGaleria,
): ImagemGaleria[] {
  return [nova, ...lista.filter((i) => i.id !== nova.id)];
}

/** "Carregar mais": anexa a página seguinte, sem repetir o que já está na tela. */
export function anexarPagina(
  lista: readonly ImagemGaleria[],
  pagina: readonly ImagemGaleria[],
): ImagemGaleria[] {
  const vistos = new Set(lista.map((i) => i.id));
  return [...lista, ...pagina.filter((i) => !vistos.has(i.id))];
}

export function tirarIds(
  lista: readonly ImagemGaleria[],
  ids: Iterable<string>,
): ImagemGaleria[] {
  const fora = new Set(ids);
  return lista.filter((i) => !fora.has(i.id));
}

// ── Seleção ──────────────────────────────────────────────────────────────────

/**
 * Marca ou desmarca. A remoção aceita até 50 ids por chamada (P11): marcar a
 * 51ª é recusado aqui, em vez de deixar a action devolver "Seleção inválida.".
 */
export function alternarSelecao(
  selecao: ReadonlySet<string>,
  id: string,
  limite: number = MAXIMO_LOTE_REMOCAO,
): { selecao: Set<string>; recusada: boolean } {
  const nova = new Set(selecao);
  if (nova.has(id)) {
    nova.delete(id);
    return { selecao: nova, recusada: false };
  }
  if (nova.size >= limite) return { selecao: nova, recusada: true };
  nova.add(id);
  return { selecao: nova, recusada: false };
}

export const MSG_LIMITE_SELECAO = `Selecione até ${MAXIMO_LOTE_REMOCAO} imagens por vez.`;

export function rotuloSelecao(n: number): string {
  if (n === 0) return "Nenhuma imagem selecionada";
  return `${n} ${plural(n, "imagem selecionada", "imagens selecionadas")}`;
}

// ── Contador (preview; a contagem autoritativa é a da action) ────────────────

export function rotuloContador(total: number): string {
  return `${total} de ${TETO_IMAGENS_POR_LOJA} imagens`;
}

export function atingiuTeto(total: number): boolean {
  return total >= TETO_IMAGENS_POR_LOJA;
}

// ── Fila de envio ────────────────────────────────────────────────────────────

export function rotuloProgressoEnvio(atual: number, total: number): string {
  return `Enviando ${atual} de ${total}`;
}

/**
 * Erros que valem para os PRÓXIMOS arquivos também: teto atingido e rate
 * limit. Seguir enviando só repetiria a recusa; o resto da fila para com a
 * mesma mensagem. Qualquer outro erro é do arquivo e a fila continua.
 */
export function interrompeFila(erro: string): boolean {
  return erro === MSG_TETO || erro === MSG_MUITAS_TENTATIVAS;
}

export function resumoEnvio(enviadas: number, total: number): string {
  if (enviadas === total) {
    return `${total} ${plural(total, "imagem enviada.", "imagens enviadas.")}`;
  }
  return `${enviadas} de ${total} imagens enviadas.`;
}

// ── Uso (prévia do servidor) ─────────────────────────────────────────────────

export type ProdutoEmUso = { id: string; nome: string; oculto: boolean };

/** `produtos` chega como Json (jsonb da RPC): lido de forma defensiva. */
export function produtosDoUso(produtos: unknown): ProdutoEmUso[] {
  if (!Array.isArray(produtos)) return [];
  const out: ProdutoEmUso[] = [];
  for (const p of produtos) {
    if (p == null || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.nome !== "string") continue;
    out.push({ id: r.id, nome: r.nome, oculto: r.oculto === true });
  }
  return out;
}

function emUso(u: UsoImagem): boolean {
  return u.produtos_total > 0 || u.na_logo;
}

/** Ids com selo "Em uso" (em algum produto ou na logo). */
export function idsEmUso(usos: readonly UsoImagem[]): Set<string> {
  return new Set(usos.filter(emUso).map((u) => u.imagem_id));
}

/** O "em 2 produtos e na logo" de "usada em 2 produtos e na logo" (D1). */
export function fraseOndeEstaEmUso(produtos: number, naLogo: boolean): string {
  const partes: string[] = [];
  if (produtos > 0) partes.push(`em ${produtos} ${plural(produtos, "produto", "produtos")}`);
  if (naLogo) partes.push("na logo");
  return partes.join(" e ");
}

export type DescricaoRemocao = {
  titulo: string;
  /** Parágrafos do `AlertDialog`, na ordem. */
  paragrafos: string[];
  /** Nomes dos produtos afetados, com "(oculto)" ao lado quando for o caso. */
  produtos: string[];
  /** Produtos afetados além dos listados (a RPC lista até 5 por imagem). */
  produtosAlemDaLista: number;
};

/**
 * Texto do `AlertDialog` de remoção, montado SÓ com a prévia do servidor
 * (`uso_imagens_loja`). A contagem é a das linhas devolvidas, não a da
 * seleção local: id já removido em outra aba não vira "imagem" aqui.
 *
 * Um produto tem uma foto só, então os produtos de imagens diferentes nunca se
 * repetem e a soma de `produtos_total` é o total de produtos afetados.
 */
export function descreverRemocao(usos: readonly UsoImagem[]): DescricaoRemocao {
  const n = usos.length;
  const usadas = usos.filter(emUso);
  const totalProdutos = usos.reduce((s, u) => s + u.produtos_total, 0);
  const naLogo = usos.some((u) => u.na_logo);
  const produtos = usos.flatMap((u) =>
    produtosDoUso(u.produtos).map((p) => (p.oculto ? `${p.nome} (oculto)` : p.nome)),
  );

  const titulo = n === 1 ? "Remover esta imagem?" : `Remover ${n} imagens?`;
  const paragrafos: string[] = [];

  if (usadas.length === 0) {
    paragrafos.push(
      n === 1
        ? "Ela não está em nenhum produto nem na logo."
        : "Nenhuma delas está em produto ou na logo.",
    );
  } else {
    const onde = fraseOndeEstaEmUso(totalProdutos, naLogo);
    if (n === 1) {
      paragrafos.push(`Esta imagem é usada ${onde}.`);
    } else if (usadas.length === n) {
      paragrafos.push(`As ${n} são usadas ${onde}.`);
    } else {
      paragrafos.push(
        `${usadas.length} ${plural(usadas.length, "é usada", "são usadas")} ${onde}.`,
      );
    }
    const efeitos: string[] = [];
    if (totalProdutos > 0) {
      efeitos.push(plural(totalProdutos, "esse produto fica sem foto", "esses produtos ficam sem foto"));
    }
    if (naLogo) efeitos.push("a loja fica sem logo");
    const frase = efeitos.join(" e ");
    paragrafos.push(`Ao remover, ${frase}.`);
  }

  paragrafos.push(
    n === 1
      ? "A remoção é definitiva, mas a imagem pode levar um tempo para sumir de todo lugar."
      : "A remoção é definitiva, mas as imagens podem levar um tempo para sumir de todo lugar.",
  );

  return {
    titulo,
    paragrafos,
    produtos,
    produtosAlemDaLista: Math.max(0, totalProdutos - produtos.length),
  };
}
