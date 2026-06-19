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

/**
 * Gate único de confirmação do pedido (issue 001/006). Derivado do estado, NÃO
 * da máquina de etapas — no desktop empilhado as 3 seções renderizam juntas e
 * só este predicado decide se o botão "Confirmar pedido" habilita.
 *
 * `true` quando há forma de pagamento E (retirada OU (entrega + endereço
 * preenchido + frete resolvido "ok")). Em entrega, frete "calculando",
 * "indisponivel", "erro" ou "ocioso" mantém o botão bloqueado.
 */
export function podeConfirmar(
  estado: EstadoWizard,
  tipoEntrega: TipoEntrega,
  freteStatus: string,
): boolean {
  if (estado.formaPagamento == null) return false;
  if (tipoEntrega === "retirada") return true;
  return estado.endereco !== null && freteStatus === "ok";
}

/**
 * Gate do efeito de frete (issue 002). Retorna a chave de dedupe `cep|bairro`
 * quando há o que calcular, ou `null` quando NÃO se deve chamar
 * `calcularFreteAction` — retirada, sem endereço, ou endereço sem bairro.
 *
 * É o gate único que mantém o cálculo atrelado ao endereço que o cliente VÊ
 * (RN-1-B): com `null`, o efeito zera o frete e não exibe mensagem de
 * indisponível. A chave inclui o CEP (não só o bairro) porque o CEP reconcilia o
 * bairro canônico e casa zonas `faixa_cep` — recalcular quando só o CEP muda é
 * necessário para paridade com a cobrança (067).
 */
export function chaveFrete(
  ehEntrega: boolean,
  endereco: EnderecoEntrega | null,
): string | null {
  if (!ehEntrega) return null;
  const bairro = endereco?.bairro?.trim();
  if (!bairro) return null;
  const cep = endereco?.cep?.trim();
  return `${cep ?? ""}|${bairro}`;
}

/** Item do carrinho na fronteira do builder — só intenção, NUNCA preço. */
export type ItemPayload = {
  produtoId: string;
  quantidade: number;
  opcionais?: { opcionalId: string; quantidade: number }[];
};

export type MontarPayloadArgs = {
  lojaId: string;
  itens: ItemPayload[];
  estado: EstadoWizard;
  idempotencyKey: string;
};

/**
 * Monta o payload enviado a criarPedido (071) — CRÍTICO (seguranca.md §10):
 * SÓ intenção do cliente, NUNCA valor monetário (preco/subtotal/desconto/
 * taxa_entrega/total/valor). O servidor recalcula tudo do banco. Extraído do
 * inline de EtapaPagamento p/ ser testável como função pura (issue 006).
 * O retorno passa por schemaPayloadPedido.safeParse (.strict()) antes do envio.
 */
export function montarPayloadPedido({
  lojaId,
  itens,
  estado,
  idempotencyKey,
}: MontarPayloadArgs) {
  return {
    loja_id: lojaId,
    tipo_entrega: estado.tipoEntrega,
    idempotency_key: idempotencyKey,
    itens: itens.map((i) => ({
      produto_id: i.produtoId,
      quantidade: i.quantidade,
      // Opcionais: só opcional_id + quantidade (RN-O2). O servidor valida loja,
      // ativo e categoria e recalcula o preço do banco (085, seguranca.md §10).
      ...(i.opcionais && i.opcionais.length > 0
        ? {
            opcionais: i.opcionais.map((o) => ({
              opcional_id: o.opcionalId,
              quantidade: o.quantidade,
            })),
          }
        : {}),
    })),
    forma_pagamento: estado.formaPagamento,
    nome_cliente: estado.nome.trim(),
    ...(estado.telefone.trim()
      ? { telefone_cliente: estado.telefone.trim() }
      : {}),
    ...(estado.observacoes.trim()
      ? { observacoes: estado.observacoes.trim() }
      : {}),
    ...(estado.codigoCupom ? { codigo_cupom: estado.codigoCupom } : {}),
    ...(estado.tipoEntrega === "entrega" && estado.endereco
      ? { endereco_entrega: montarEndereco(estado.endereco) }
      : {}),
    ...(estado.formaPagamento === "dinheiro" && estado.trocoPara != null
      ? { troco_para: estado.trocoPara }
      : {}),
  };
}

/** Endereço do FormEndereco → shape do payload (campos do schema do servidor). */
function montarEndereco(endereco: EnderecoEntrega) {
  return {
    cep: endereco.cep.replace(/\D/g, ""),
    rua: endereco.rua,
    numero: endereco.numero,
    bairro: endereco.bairro,
    cidade: endereco.cidade,
    uf: endereco.uf,
    ...(endereco.complemento ? { complemento: endereco.complemento } : {}),
  };
}

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
