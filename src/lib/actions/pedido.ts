"use server";

// Issue 014 — Server Action `criarPedido`: o ORQUESTRADOR AUTORITATIVO do
// valor pago (seguranca.md §10). O cliente envia SÓ intenção (produto_id +
// quantidade, endereço, forma de pagamento, identificação, código de cupom).
// TODO valor monetário (preco/subtotal/desconto/taxa_entrega/total) é
// RECALCULADO a partir do banco — nunca confiamos em número do cliente.
//
// A atomicidade (INSERT pedido + itens + trava de cupom) é da RPC transacional
// `public.criar_pedido` (migration 20260614003000); aqui só recalculamos e
// delegamos. Ver tasks/014 §Decisões de Design (D1/D2/D3/D5).
//
// TODO(052): rate limit ~10/min por IP (seguranca.md §12) — depende de
// @upstash/ratelimit (issue 052), fora do escopo desta issue.

import { schemaPayloadPedido } from "@/lib/validacoes/pedido";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaParaPedido } from "@/lib/supabase/queries/lojas";
import { buscarProdutosPorIds } from "@/lib/supabase/queries/produtos";
import {
  listarZonasComTaxas,
  listarFormasPagamento,
  buscarCupomPorCodigo,
} from "@/lib/supabase/queries/entregaPagamento";
import { calcularSubtotal, calcularTotal } from "@/lib/utils/calcularTotal";
import { calcularFrete } from "@/lib/utils/calcularFrete";
import { calcularDesconto } from "@/lib/utils/calcularDesconto";
import { validarUsoCupom } from "@/lib/utils/validarUsoCupom";
import { lojaAberta, type Horarios } from "@/lib/utils/lojaAberta";
import {
  assinaturaPermiteAcesso,
  type StatusAssinatura,
} from "@/lib/utils/assinatura";

export type ResultadoCriarPedido =
  | { pedidoId: string; token_acesso: string }
  | { erro: string };

const ERRO_GENERICO = "Não foi possível criar o pedido. Tente novamente.";

export async function criarPedido(payload: unknown): Promise<ResultadoCriarPedido> {
  // (1) Validação Zod ANTES de qualquer I/O. `.strict()` rejeita qualquer campo
  //     monetário do cliente (total/subtotal/preco mentidos nem chegam ao banco).
  const parsed = schemaPayloadPedido.safeParse(payload);
  if (!parsed.success) {
    return { erro: ERRO_GENERICO };
  }
  const dados = parsed.data;

  try {
    const svc = createServiceClient();

    // (2) Loja: existe? ativa? assinatura permite? aberta no horário? (autoritativo)
    const loja = await buscarLojaParaPedido(svc, dados.loja_id);
    if (loja == null || !loja.ativo) {
      return { erro: ERRO_GENERICO };
    }
    if (
      !assinaturaPermiteAcesso(
        loja.assinatura_status as StatusAssinatura,
        new Date(loja.assinatura_fim_periodo ?? 0),
        new Date(),
      )
    ) {
      return { erro: ERRO_GENERICO };
    }
    if (!lojaAberta(loja.horarios as unknown as Horarios, new Date(), loja.timezone).aberta) {
      return { erro: "Loja fechada no momento." };
    }

    // (3) Forma de pagamento ∈ formas configuradas pela loja.
    const formas = await listarFormasPagamento(svc, dados.loja_id);
    if (!formas.some((f) => f.tipo === dados.forma_pagamento)) {
      return { erro: ERRO_GENERICO };
    }

    // (4) Produtos: existem? disponíveis? da loja correta? (subtotal do PREÇO REAL)
    const ids = dados.itens.map((i) => i.produto_id);
    const produtos = await buscarProdutosPorIds(svc, ids);
    const porId = new Map(produtos.map((p) => [p.id, p]));

    const itensSnapshot: {
      produto_id: string;
      nome: string;
      preco: number;
      quantidade: number;
    }[] = [];
    for (const item of dados.itens) {
      const produto = porId.get(item.produto_id);
      if (
        produto == null ||
        !produto.disponivel ||
        produto.loja_id !== dados.loja_id
      ) {
        return { erro: ERRO_GENERICO };
      }
      itensSnapshot.push({
        produto_id: produto.id,
        nome: produto.nome,
        preco: produto.preco,
        quantidade: item.quantidade,
      });
    }

    const subtotal = calcularSubtotal(
      itensSnapshot.map(({ preco, quantidade }) => ({ preco, quantidade })),
    );

    // (5) Frete autoritativo a partir das zonas do banco. Fora de área → recusa.
    const zonas = await listarZonasComTaxas(svc, dados.loja_id);
    const frete = calcularFrete(zonas, dados.endereco_entrega, subtotal);
    if (!frete.atendido) {
      return { erro: "Endereço fora da área de entrega." };
    }

    // (6) Cupom: revalidado no servidor sobre o subtotal REAL. Cupom inválido/
    //     esgotado na leitura → segue SEM desconto (D5), não rejeita o pedido.
    let desconto = 0;
    let cupomId: string | null = null;
    let cupomCodigo: string | null = null;
    if (dados.codigo_cupom) {
      const cupom = await buscarCupomPorCodigo(svc, dados.loja_id, dados.codigo_cupom);
      if (cupom != null && validarUsoCupom(cupom, subtotal, new Date()).valido) {
        const r = calcularDesconto(
          { ...cupom, tipo: cupom.tipo as "percentual" | "fixo" },
          subtotal,
        );
        if (r.aplicado) {
          desconto = r.desconto;
          cupomId = cupom.id;
          cupomCodigo = cupom.codigo;
        }
      }
    }

    // (7) Total autoritativo.
    const { total } = calcularTotal({ subtotal, desconto, taxaEntrega: frete.taxa });

    // (8) RPC transacional: insere pedido + itens + trava de cupom atomicamente.
    //     O retorno da RPC (criar_pedido) ainda não está nos tipos gerados — será
    //     adicionado em Database['public']['Functions'] no regen de tipos pós-deploy
    //     da migration. Até lá, tipamos a chamada localmente.
    const { data, error } = await (
      svc.rpc as unknown as (
        fn: "criar_pedido",
        args: Record<string, unknown>,
      ) => Promise<{
        data: { pedido_id: string; token_acesso: string }[] | null;
        error: { message: string } | null;
      }>
    )("criar_pedido", {
      p_loja_id: dados.loja_id,
      p_nome_cliente: dados.nome_cliente,
      p_telefone_cliente: dados.telefone_cliente ?? null,
      p_endereco_entrega: dados.endereco_entrega,
      p_forma_pagamento: dados.forma_pagamento,
      p_observacoes: dados.observacoes ?? null,
      p_subtotal: subtotal,
      p_taxa_entrega: frete.taxa,
      p_desconto: desconto,
      p_total: total,
      p_cupom_id: cupomId,
      p_cupom_codigo: cupomCodigo,
      p_itens: itensSnapshot,
    });

    if (error != null || data == null || data.length === 0) {
      // §14: erro de banco nunca vaza — log no servidor, genérico ao cliente.
      console.error("[criarPedido]", error);
      return { erro: ERRO_GENERICO };
    }

    return { pedidoId: data[0].pedido_id, token_acesso: data[0].token_acesso };
  } catch (e) {
    // §14: exceção inesperada nunca vaza `e.message` ao cliente.
    console.error("[criarPedido]", e);
    return { erro: ERRO_GENERICO };
  }
}
