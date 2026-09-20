"use server";

// Issue 228 — `revisarCarrinhoAction`: o PREVIEW do carrinho deixa de receber
// dinheiro do cliente.
//
// Substitui o preview antigo de cupom (que recebia um subtotal numérico do
// browser) e fecha a porta RPC que existia em `cupom.ts`. Do cliente vêm só
// ids e quantidades; subtotal, base elegível, economia e desconto são
// DERIVADOS do banco pela MESMA cadeia do autoritativo `criarPedido`
// (RN-11 / D5-b):
//
//   verificarRateLimit → zod .strict() → buscarProdutosPorIds → precoEfetivo
//     → buscarOpcionaisPorIds → buscarOpcionaisPorCategoria → derivarBasesCupom
//     → validarUsoCupom → calcularDesconto
//
// Preview que aplica regra MAIS GENEROSA que o autoritativo é oráculo
// (seguranca.md §10-A): por isso os gates de produto (existe/disponível/
// não-oculto/da loja) e de opcional (existe/ativo/da loja/categoria associada)
// são os mesmos de `pedido.ts`, e não um subconjunto.
//
// Os três estados de RN-10-e chegam DECIDIDOS ao componente: ele ramifica, e
// nunca compara `baseElegivel` com `subtotal` no browser.

import { headers } from "next/headers";

import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buscarProdutosPorIds,
  buscarOpcionaisPorIds,
  buscarOpcionaisPorCategoria,
} from "@/lib/supabase/queries/produtos";
import { buscarCupomPorCodigo } from "@/lib/supabase/queries/entregaPagamento";
import { schemaRevisarCarrinho } from "@/lib/validacoes/revisarCarrinho";
import { precoEfetivo } from "@/lib/utils/precoEfetivo";
import {
  derivarBasesCupom,
  type ComponentesLinha,
} from "@/lib/utils/derivarBasesCupom";
import { validarUsoCupom } from "@/lib/utils/validarUsoCupom";
import { calcularDesconto } from "@/lib/utils/calcularDesconto";
import { arredondar } from "@/lib/utils/arredondar";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { OpcionalCalculo } from "@/lib/utils/calcularTotal";
import type {
  EstadoCupom,
  LinhaRevisada,
  ResultadoRevisarCarrinho,
  VereditoCupom,
} from "./revisarCarrinho-contrato";

/** Uma única mensagem para toda recusa de revisão: nada do tenant vizinho
 *  (id, nome, preço) atravessa a fronteira, e o motivo não vira oráculo. */
const ERRO_GENERICO = "Não foi possível revisar o carrinho. Tente novamente.";
/** Cupom inexistente, de outra loja, inativo, expirado ou esgotado: MESMA
 *  string, byte a byte (anti-enumeração, seguranca.md §6). */
const CUPOM_GENERICO = "Cupom inválido ou não encontrado.";

export async function revisarCarrinhoAction(
  entrada: unknown,
): Promise<ResultadoRevisarCarrinho> {
  // (0) Rate limit por IP antes de qualquer I/O — a MESMA chave/janela que o
  //     preview de cupom já usava (~20/min por IP, issue 052).
  const ip = extrairIp(await headers());
  if (!(await verificarRateLimit("validarCupom", ip)).permitido) {
    return { ok: false, mensagem: ERRO_GENERICO };
  }

  // (1) Zod `.strict()` ANTES de qualquer leitura: campo monetário injetado por
  //     DevTools nem chega a custar uma query.
  const parsed = schemaRevisarCarrinho.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, mensagem: ERRO_GENERICO };
  }
  const dados = parsed.data;

  try {
    const svc = createServiceClient();
    // Um único instante por request: a vigência de TODAS as promoções da
    // revisão é avaliada no mesmo `agora` (RN-03).
    const agora = new Date();

    const ids = [...new Set(dados.itens.map((i) => i.produto_id))];
    const opcionalIds = [
      ...new Set(
        dados.itens.flatMap((i) => (i.opcionais ?? []).map((o) => o.opcional_id)),
      ),
    ];

    // Onda única de leituras independentes. O cupom só é buscado quando o
    // cliente enviou um código — sem código não existe consulta de cupom.
    const [produtos, opcionaisBanco, cupom] = await Promise.all([
      buscarProdutosPorIds(svc, ids),
      buscarOpcionaisPorIds(svc, opcionalIds),
      // Busca SEMPRE escopada por (loja_id, codigo) via service_role: cupom de
      // outra loja simplesmente não casa.
      dados.codigo
        ? buscarCupomPorCodigo(svc, dados.loja_id, dados.codigo)
        : Promise.resolve(null),
    ]);

    const porId = new Map(produtos.map((p) => [p.id, p]));
    const opcionalPorId = new Map(opcionaisBanco.map((o) => [o.id, o]));

    // Allowlist de categorias de opcional por categoria de produto (RN-O4) —
    // depende de `produtos`, então é a segunda onda, exatamente como em
    // `pedido.ts`. Sem opcional escolhido não há o que autorizar: nenhuma query.
    const categoriaIds = [
      ...new Set(
        produtos.map((p) => p.categoria_id).filter((c): c is string => c != null),
      ),
    ];
    const allowlistPorCategoria =
      opcionalIds.length > 0
        ? await buscarOpcionaisPorCategoria(svc, categoriaIds)
        : {};

    const componentes: ComponentesLinha[] = [];
    const linhas: LinhaRevisada[] = [];
    let economiaBruta = 0;

    for (const item of dados.itens) {
      const produto = porId.get(item.produto_id);
      // MESMO gate de `criarPedido`: inexistente, indisponível, oculto ou de
      // outra loja derruba a revisão inteira (vetor IDOR/cross-loja).
      if (
        produto == null ||
        !produto.disponivel ||
        produto.oculto === true ||
        produto.loja_id !== dados.loja_id
      ) {
        return { ok: false, mensagem: ERRO_GENERICO };
      }

      const permitidas = new Set(
        (produto.categoria_id
          ? allowlistPorCategoria[produto.categoria_id] ?? []
          : []
        ).map((g) => g.categoriaOpcionalId),
      );

      const opcionaisCalculo: OpcionalCalculo[] = [];
      for (const escolhido of item.opcionais ?? []) {
        const opcional = opcionalPorId.get(escolhido.opcional_id);
        // RN-O5 (inexistente/inativo) · RN-O3 (cross-loja) · RN-O4 (categoria
        // não associada ao produto) — os mesmos três gates do autoritativo.
        if (
          opcional == null ||
          !opcional.ativo ||
          opcional.loja_id !== dados.loja_id ||
          (produto.categoria_id != null &&
            !permitidas.has(opcional.categoria_opcional_id))
        ) {
          return { ok: false, mensagem: ERRO_GENERICO };
        }
        opcionaisCalculo.push({
          preco: opcional.preco,
          quantidade: escolhido.quantidade,
        });
      }

      // O desconto de produto vira PREÇO aqui (D8) — fonte única `precoEfetivo`.
      const preco = precoEfetivo(produto, agora);

      componentes.push({
        precoProduto: preco,
        quantidade: item.quantidade,
        opcionais: opcionaisCalculo,
      });
      linhas.push({
        produto_id: produto.id,
        quantidade: item.quantidade,
        preco: produto.preco,
        precoEfetivo: preco.precoEfetivo,
        temDesconto: preco.temDesconto,
      });
      economiaBruta += (produto.preco - preco.precoEfetivo) * item.quantidade;
    }

    // Um único cálculo para os dois números: `bases.subtotal` é o mesmo
    // subtotal que `criarPedido` grava (derivarBasesCupom não recalcula).
    const bases = derivarBasesCupom(componentes);
    const subtotal = bases.subtotal;
    const economiaProdutos = arredondar(economiaBruta);

    const veredito = dados.codigo
      ? avaliarCupom(dados.codigo, cupom, bases, agora)
      : null;

    return {
      ok: true,
      subtotal,
      economiaProdutos,
      itens: linhas,
      cupom: veredito,
    };
  } catch (e) {
    // §14: detalhe de infraestrutura fica no log do servidor; o cliente recebe
    // a mesma string genérica de qualquer outra recusa.
    console.error("[revisarCarrinhoAction]", e);
    return { ok: false, mensagem: ERRO_GENERICO };
  }
}

/** Veredito + estado do cupom, JÁ decidido no servidor (RN-10-e). Síncrona e
 *  interna de propósito: um módulo `'use server'` só exporta função async. */
function avaliarCupom(
  codigo: string,
  cupom: Awaited<ReturnType<typeof buscarCupomPorCodigo>>,
  bases: ReturnType<typeof derivarBasesCupom>,
  agora: Date,
): VereditoCupom {
  if (cupom == null) {
    return { valido: false, mensagem: CUPOM_GENERICO };
  }

  // D5-a: a régua do pedido mínimo é o SUBTOTAL, nunca a base elegível.
  const uso = validarUsoCupom(cupom, bases.subtotal, agora);
  if (!uso.valido) {
    // Único motivo REVELÁVEL: o cliente precisa saber quanto falta. Os demais
    // (inativo/expirado/esgotado/inexistente) saem idênticos.
    return uso.motivo === "pedido_minimo"
      ? {
          valido: false,
          mensagem: `Pedido mínimo para este cupom é ${formatarMoeda(cupom.pedido_minimo)}.`,
        }
      : { valido: false, mensagem: CUPOM_GENERICO };
  }

  // `cupons.tipo` é `string` no tipo gerado; o CHECK do banco garante o enum.
  const resultado = calcularDesconto(
    { ...cupom, tipo: cupom.tipo as "percentual" | "fixo" },
    bases,
  );
  if (!resultado.aplicado) {
    return { valido: false, mensagem: CUPOM_GENERICO };
  }

  return { valido: true, estadoCupom: estadoDe(codigo, bases, resultado.desconto) };
}

/** Os três estados de RN-10-e discriminados pela BASE, não pelo desconto: é a
 *  base que explica a frase da tela. */
function estadoDe(
  codigo: string,
  bases: ReturnType<typeof derivarBasesCupom>,
  desconto: number,
): EstadoCupom {
  // C — carrinho 100% promocional: sem parcela elegível não existe "Desconto
  // R$ 0,00" para a UI renderizar por engano (RN-10.2).
  if (bases.baseElegivel <= 0) {
    return { estado: "zero", codigo };
  }
  // A — nada em promoção: `baseElegivel === subtotal`, nenhuma frase a explicar
  // e, por isso, nenhuma base devolvida ao browser (D5-b).
  if (bases.baseElegivel >= bases.subtotal) {
    return { estado: "cheio", codigo, desconto };
  }
  // B — parcial: as três parcelas vão prontas para a frase de 237.
  return {
    estado: "parcial",
    codigo,
    desconto,
    baseElegivel: bases.baseElegivel,
    baseProdutos: bases.baseProdutos,
    baseOpcionais: bases.baseOpcionais,
  };
}
