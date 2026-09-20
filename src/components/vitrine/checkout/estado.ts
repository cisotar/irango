// Estado do wizard de checkout (issues 076/077/078).
//
// Mantido em sessionStorage (mesmo padrão de useCarrinho — issue 027) para
// sobreviver a refresh durante o fluxo. NUNCA guarda valor monetário: o
// servidor (criarPedido — 071) recalcula tudo do banco (seguranca.md §10).
// Aqui ficam só intenções do cliente: tipo de entrega, endereço, cupom,
// forma de pagamento, troco e identificação.

import type { EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import type { ItemCarrinho } from "@/types/dominio";
import { canonizarObservacao } from "@/lib/utils/normalizarObservacao";

export const CHAVE_WIZARD = "irango:checkout";

/** null = ainda não escolhido (estado inicial — nenhuma opção pré-selecionada). */
export type TipoEntrega = "retirada" | "entrega" | null;

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
  tipoEntrega: null,
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
 * (238/D11) Estado da reconfirmação de preço. Fora do `EstadoWizard` de
 * propósito: é efêmero (vale para ESTA tentativa de envio) e não deve
 * sobreviver no sessionStorage — um `confirmada: true` restaurado depois de um
 * refresh seria um segundo clique que ninguém deu.
 */
export type EstadoRevisao = {
  /** Diálogo de "o preço subiu" aberto/aguardando o segundo clique. */
  pendente: boolean;
  /** O cliente clicou no CTA que carrega o NOVO total. */
  confirmada: boolean;
};

/** Default de `podeConfirmar`: nenhuma revisão em curso. */
export const SEM_REVISAO: EstadoRevisao = { pendente: false, confirmada: false };

/**
 * Gate único de confirmação do pedido (issue 001/006). Derivado do estado, NÃO
 * da máquina de etapas — no desktop empilhado as 3 seções renderizam juntas e
 * só este predicado decide se o botão "Confirmar pedido" habilita.
 *
 * `true` quando há forma de pagamento E (retirada OU (entrega + endereço
 * preenchido + frete RESOLVIDO)). Em entrega, frete "calculando",
 * "indisponivel", "erro" ou "ocioso" mantém o botão bloqueado.
 *
 * (180-B) "a_combinar" TAMBÉM libera: um pedido a combinar é um pedido válido —
 * o comprador conclui normalmente e o frete é definido no chat com a loja.
 * Manter só "ok" prenderia o cliente exatamente no cenário que a issue existe
 * para destravar. Continua sendo só GATE DE UI: quem decide o valor é
 * `criarPedido`, que reclassifica do zero e não recebe flag do cliente.
 */
export function podeConfirmar(
  estado: EstadoWizard,
  tipoEntrega: TipoEntrega,
  freteStatus: string,
  revisao: EstadoRevisao = SEM_REVISAO,
): boolean {
  // (238/M9 trava 2) A reconfirmação de preço de D11 entra AQUI, uma vez só,
  // cobrindo wizard mobile e desktop — nunca reimplementada no componente
  // (design-system §9). Enquanto há revisão pendente sem o segundo clique,
  // nenhum caminho de UI confirma. A garantia dura é de servidor (RN-12-a):
  // este gate existe para o cliente não ser levado a um pedido mais caro por
  // um clique que ele deu achando outra coisa.
  if (revisao.pendente && !revisao.confirmada) return false;
  if (estado.formaPagamento == null) return false;
  if (tipoEntrega == null) return false;
  if (tipoEntrega === "retirada") return true;
  if (estado.endereco === null) return false;
  return freteStatus === "ok" || freteStatus === "a_combinar";
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

/**
 * Gate do botão "Calcular frete": `true` quando há endereço calculável cujo
 * frete ainda não foi obtido. `chaveCalculada` é a chave do último cálculo
 * CONCLUÍDO COM SUCESSO.
 *
 * Existe porque o cálculo deixou de ser automático: sem este predicado, o
 * cliente poderia calcular o frete de um endereço, trocar o CEP e confirmar
 * vendo a taxa do endereço ANTERIOR. O servidor recalcula do banco e cobraria o
 * valor certo (seguranca.md §10), mas o preview teria mentido — quebra da
 * paridade preview↔cobrança (RN-7). Divergiu ⇒ resultado anterior é descartado
 * e um novo cálculo volta a ser exigido antes de confirmar.
 */
export function precisaCalcularFrete(
  chaveAtual: string | null,
  chaveCalculada: string | null,
): boolean {
  if (chaveAtual === null) return false;
  return chaveAtual !== chaveCalculada;
}

/**
 * Total ESTIMADO do resumo (preview de UX). Uma única fórmula para o resumo, o
 * diálogo de reconfirmação e a faixa de "preço caiu" (238): três lugares
 * exibindo o mesmo total não podem compor três contas diferentes. Continua
 * sendo preview — `criarPedido` recalcula tudo do banco (seguranca.md §10).
 */
export function totalPreviewEstimado(
  subtotal: number,
  desconto: number,
  frete: number,
): number {
  return Math.max(0, subtotal - desconto) + frete;
}

/** Item do carrinho na fronteira do builder — só intenção, NUNCA preço. */
export type ItemPayload = {
  produtoId: string;
  quantidade: number;
  opcionais?: { opcionalId: string; quantidade: number }[];
  /**
   * Observação livre desta LINHA, já canonizada pelo carrinho (issue 168).
   * Texto puro: o servidor normaliza e mede o teto de novo (schemaObservacao) e
   * o recálculo de valor é estruturalmente cego a ela.
   */
  observacao?: string;
  /**
   * (238/RN-12-a) O que a vitrine MOSTROU para esta linha. Booleano de
   * EXIBIÇÃO, não campo monetário: assimétrico, só sabe RECUSAR o pedido
   * (`true` afirmado × `false` apurado ⇒ o servidor recusa o pedido inteiro) e
   * nunca faz o servidor cobrar menos.
   */
  promocaoExibida?: boolean;
};

/**
 * ItemCarrinho → ItemPayload: a fronteira entre o estado do carrinho e o que sai
 * no payload. Copia SÓ intenção (produto, quantidade, opcionais, observação) e
 * NUNCA preço/subtotal (seguranca.md §10).
 *
 * Existe como função pura porque é o ÚNICO mapeamento em produção
 * (`CheckoutWizard.itensPayload`) e um campo esquecido nele deixaria os testes
 * de `montarPayloadPedido` verdes com o checkout real enviando menos do que o
 * cliente pediu (plan/168 §Riscos residuais).
 */
export function itemCarrinhoParaPayload(item: ItemCarrinho): ItemPayload {
  return {
    produtoId: item.produtoId,
    quantidade: item.quantidade,
    ...(item.opcionais && item.opcionais.length > 0
      ? {
          opcionais: item.opcionais.map((o) => ({
            opcionalId: o.opcionalId,
            quantidade: o.quantidade,
          })),
        }
      : {}),
    // Re-canoniza na fronteira: `adicionarItem` já canoniza, mas um carrinho
    // restaurado do sessionStorage de uma versão anterior (ou adulterado no
    // DevTools) traria texto cru e derrubaria o checkout INTEIRO no teto do
    // servidor, com mensagem genérica. Idempotente, custo desprezível.
    ...(item.observacao ? { observacao: canonizarObservacao(item.observacao) } : {}),
    // (238/RN-12-a) A afirmação de EXIBIÇÃO viaja junto com a intenção. Sem
    // ela a trava do servidor é código morto e o cliente que viu um preço
    // promocional expirado pagaria o cheio sem ser avisado — exatamente o que
    // D11 existe para impedir. Ausente/false ⇒ chave omitida (fail-closed).
    ...(item.temDesconto === true ? { promocaoExibida: true } : {}),
  };
}

export type MontarPayloadArgs = {
  lojaId: string;
  itens: ItemPayload[];
  estado: EstadoWizard;
  idempotencyKey: string;
  /**
   * (238/D11) `true` no SEGUNDO clique, depois de o cliente ver o de/para e o
   * novo total: todo item passa a afirmar `promocaoExibida: false`, que é o
   * que faz o pedido passar pela trava de RN-12-a. A tela mostrou o preço
   * novo, então nenhuma linha afirma mais ter visto promoção.
   */
  revisaoConfirmada?: boolean;
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
  revisaoConfirmada = false,
}: MontarPayloadArgs) {
  return {
    loja_id: lojaId,
    tipo_entrega: estado.tipoEntrega as "retirada" | "entrega",
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
      // Observação por item (168): texto puro, sem nada monetário. O servidor
      // normaliza/mede de novo (schemaObservacao) e o recálculo é cego a ela.
      ...(i.observacao ? { observacao: i.observacao } : {}),
      // (238/RN-12-a) Booleano de EXIBIÇÃO — nada monetário. Depois do segundo
      // clique a tela JÁ mostrou o preço novo, então nenhuma linha afirma ter
      // visto promoção: `false` em todas, e é isso que destrava o envio.
      ...(i.promocaoExibida === true
        ? { promocaoExibida: !revisaoConfirmada }
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
