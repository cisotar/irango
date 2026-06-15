// Estado do wizard de checkout (issues 076/077/078).
//
// Mantido em sessionStorage (mesmo padrão de useCarrinho — issue 027) para
// sobreviver a refresh durante o fluxo. NUNCA guarda valor monetário: o
// servidor (criarPedido — 071) recalcula tudo do banco (seguranca.md §10).
// Aqui ficam só intenções do cliente: tipo de entrega, endereço, cupom,
// forma de pagamento, troco e identificação.

import type { EnderecoEntrega } from "@/components/vitrine/FormEndereco";

export const CHAVE_WIZARD = "irango:checkout";

export type TipoEntrega = "retirada" | "entrega";

/** Tipos de forma de pagamento suportados (enum do schema do servidor). */
export type TipoPagamento = "pix" | "dinheiro" | "link" | "cartao";

/** Forma de pagamento ativa da loja, hidratada para a UX do wizard. */
export type FormaPagamentoWizard = {
  id: string;
  tipo: TipoPagamento;
  /** chave Pix exibida ao cliente (lida do banco no servidor) — só p/ tipo pix. */
  chavePix?: string | null;
  /** URL pública do QR no Storage do iRango — só p/ tipo pix. */
  pixQrUrl?: string | null;
};

/** Estado persistido do wizard — SEM valores monetários (seguranca.md §10). */
export type EstadoWizard = {
  tipoEntrega: TipoEntrega;
  endereco: EnderecoEntrega | null;
  codigoCupom: string | null;
  formaPagamento: TipoPagamento | null;
  trocoPara: number | null;
  nome: string;
  telefone: string;
  observacoes: string;
  // [063] Chave de idempotência (anti duplo-submit). Gerada via CSPRNG por
  // tentativa de checkout; persiste no sessionStorage p/ que um retry/duplo-clique
  // reuse a MESMA chave → a RPC criar_pedido deduplica server-side (1 pedido,
  // 1 consumo de cupom). Limpa no sucesso p/ um novo carrinho ganhar chave nova.
  idempotencyKey: string | null;
};

export const ESTADO_INICIAL: EstadoWizard = {
  tipoEntrega: "entrega",
  endereco: null,
  codigoCupom: null,
  formaPagamento: null,
  trocoPara: null,
  nome: "",
  telefone: "",
  observacoes: "",
  idempotencyKey: null,
};

/** Lê o estado do wizard do sessionStorage de forma defensiva (SSR-safe). */
export function lerEstadoWizard(): Partial<EstadoWizard> | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_WIZARD);
    return bruto ? (JSON.parse(bruto) as Partial<EstadoWizard>) : null;
  } catch {
    return null;
  }
}

/** Persiste o estado do wizard no sessionStorage (degrada silenciosamente). */
export function salvarEstadoWizard(estado: EstadoWizard): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CHAVE_WIZARD, JSON.stringify(estado));
  } catch {
    // Storage indisponível (modo privado/cota) — segue em memória.
  }
}
