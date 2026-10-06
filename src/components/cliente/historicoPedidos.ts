import type { PedidoDoCliente } from "@/lib/supabase/queries/pedidos";

/** Tamanho de página de `listarPedidosDoCliente` (spec: 20). */
export const POR_PAGINA = 20;
/** Teto de páginas acumuladas por "Carregar mais" (trava de input). */
const MAX_PAGINA = 49;

export type LinhaHistorico = {
  id: string;
  lojaNome: string;
  status: string;
  total: number;
  criadoEm: string;
  /** Confirmação por token já existente; `null` se a loja não pôde ser lida. */
  href: string | null;
};

/** `?pagina=` → inteiro em [0, MAX_PAGINA]; qualquer outra coisa → 0. */
export function paginaDoParam(valor: string | undefined): number {
  if (!valor || !/^\d+$/.test(valor)) return 0;
  return Math.min(Number(valor), MAX_PAGINA);
}

/** Achata as páginas lidas (0..N) em linhas de apresentação. */
export function montarHistorico(paginas: PedidoDoCliente[][]): {
  linhas: LinhaHistorico[];
  temMais: boolean;
} {
  const linhas = paginas.flat().map((p) => ({
    id: p.id,
    lojaNome: p.lojas?.nome ?? "Loja",
    status: p.status,
    total: p.total,
    criadoEm: p.criado_em,
    href: p.lojas?.slug
      ? `/loja/${encodeURIComponent(p.lojas.slug)}/confirmacao?${new URLSearchParams({
          pedido: p.id,
          token: p.token_acesso,
        }).toString()}`
      : null,
  }));
  const ultima = paginas[paginas.length - 1] ?? [];
  return { linhas, temMais: ultima.length >= POR_PAGINA };
}

/**
 * "Carregar mais": próxima página via `?pagina=N` na mesma rota, preservando o
 * `next`; na página única leva a âncora da seção para a URL continuar nela.
 */
export function hrefCarregarMais(
  rota: string,
  pagina: number,
  next: string | undefined,
  ancora?: string,
): string {
  const query = new URLSearchParams({ pagina: String(pagina + 1), ...(next ? { next } : {}) });
  return `${rota}?${query.toString()}${ancora ? `#${ancora}` : ""}`;
}
