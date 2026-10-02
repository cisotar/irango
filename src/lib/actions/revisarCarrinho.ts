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
//   verificarRateLimit → zod .strict() → buscarLojaParaPedido +
//     assinaturaPermiteAcesso → buscarProdutosPorIds → precoEfetivo
//     → buscarOpcionaisPorIds → buscarOpcionaisPorCategoria → derivarBasesCupom
//     → validarUsoCupom → calcularDesconto
//
// Preview que aplica regra MAIS GENEROSA que o autoritativo é oráculo
// (seguranca.md §10-A): por isso os gates de loja (existe/ativa/assinatura), de
// produto (existe/disponível/não-oculto/da loja) e de opcional (existe/ativo/
// da loja/categoria associada) são os mesmos de `pedido.ts`, e não um
// subconjunto. A ÚNICA diferença deliberada é `lojaAberta`, que o preview não
// aplica: horário não é segredo e revisar o carrinho com a loja fechada é UX
// legítima.
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
import { buscarOcultosPorProdutos } from "@/lib/supabase/queries/opcionais";
import {
  agruparOcultosPorProduto,
  idsPermitidosDoProduto,
} from "@/lib/utils/opcionais-do-produto";
import { buscarCupomPorCodigo } from "@/lib/supabase/queries/entregaPagamento";
import { contarUsosCupomDoCliente } from "@/lib/supabase/queries/pedidos";
import { resolverClienteDaSessao } from "@/lib/auth/clienteDaSessao";
import { avaliarCupomPorCliente } from "@/lib/utils/cupomPorCliente";
import { buscarLojaParaPedido } from "@/lib/supabase/queries/lojas";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import { avaliarFrequenciaNaLoja } from "@/lib/utils/frequencia";
import {
  assinaturaPermiteAcesso,
  type StatusAssinatura,
} from "@/lib/utils/assinatura";
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
  // (0) Rate limit por IP antes de qualquer I/O, em BALDE PRÓPRIO: a revisão é
  //     automática e não pode gastar a cota de `validarCupom` (achado do
  //     `auditar` — balde estourado tirava o cupom válido do resumo).
  const ip = extrairIp(await headers());
  if (!(await verificarRateLimit("revisarCarrinho", ip)).permitido) {
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
    const [loja, produtos, opcionaisBanco, cupom, categorias, ocultos] = await Promise.all([
      // Gates de LOJA (paridade com `pedido.ts:92-107`): sem eles, quem guardou
      // um `produto_id` de loja suspensa obtinha preço e status de promoção
      // dela pelo preview. `lojaAberta` de propósito NÃO entra: horário não é
      // segredo, e revisar o carrinho antes de a loja abrir é UX legítima.
      buscarLojaParaPedido(svc, dados.loja_id),
      buscarProdutosPorIds(svc, ids),
      buscarOpcionaisPorIds(svc, opcionalIds),
      // Busca SEMPRE escopada por (loja_id, codigo) via service_role: cupom de
      // outra loja simplesmente não casa.
      dados.codigo
        ? buscarCupomPorCodigo(svc, dados.loja_id, dados.codigo)
        : Promise.resolve(null),
      // (321) EXATAMENTE a mesma query de `criarPedido` — nunca uma segunda
      // leitura com outro filtro. É essa identidade estrutural, e não o
      // cuidado de quem escreveu, que garante a paridade preview ↔
      // autoritativo (§10-A).
      buscarCategorias(svc, dados.loja_id),
      // (331) MESMA leitura e MESMA condição de `criarPedido`: grupos ocultos
      // por produto só importam quando há adicional escolhido. Falha → catch
      // externo → revisão recusada (fail-closed), nunca "sem ocultos".
      opcionalIds.length > 0 ? buscarOcultosPorProdutos(svc, ids) : Promise.resolve([]),
    ]);
    const categoriasPorId = new Map(categorias.map((c) => [c.id, c]));
    const ocultosPorProduto = agruparOcultosPorProduto(ocultos);

    if (
      loja == null ||
      !loja.ativo ||
      !assinaturaPermiteAcesso(
        loja.assinatura_status as StatusAssinatura,
        new Date(loja.assinatura_fim_periodo ?? 0),
        agora,
      )
    ) {
      return { ok: false, mensagem: ERRO_GENERICO };
    }

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
      // (252) O item que a revisão NÃO ENCONTRA no banco vira linha BLOQUEADA,
      // nunca omitida: sumir da conta seria alterar o carrinho do cliente por
      // omissão. Sem row não há preço do banco, e inventar número é o oposto do
      // mandato 1 — a linha nasce com preço ZERO e fica FORA do subtotal e da
      // economia, então esse zero nunca chega a um total.
      if (produto == null) {
        linhas.push({
          produto_id: item.produto_id,
          quantidade: item.quantidade,
          preco: 0,
          precoEfetivo: 0,
          temDesconto: false,
          compravel: false,
          // `esgotado` e não `fora_da_janela`: o produto não existe mais, e
          // `fora_da_janela` prometeria uma volta que ninguém pode cumprir.
          motivoNaoCompravel: "esgotado",
        });
        continue;
      }
      // MESMO gate de `criarPedido` para indisponível, oculto ou de outra loja:
      // derruba a revisão inteira (vetor IDOR/cross-loja). Deliberadamente NÃO
      // fundido com o ramo acima: rebaixar o id do tenant vizinho a linha
      // bloqueada confirmaria ao atacante que ele EXISTE em outra loja (§6).
      if (
        !produto.disponivel ||
        produto.oculto === true ||
        produto.loja_id !== dados.loja_id
      ) {
        return { ok: false, mensagem: ERRO_GENERICO };
      }

      // (321) A MESMA função pura do SSR da vitrine e de `criarPedido`, com o
      // MESMO `agora` e o `timezone` da LOJA — o cliente não manda horário,
      // frequência, categoria nem `oculta`.
      const frequencia = avaliarFrequenciaNaLoja(produto, categoriasPorId, agora, loja.timezone);
      // (P6) Categoria OCULTA (ou ausente do mapa, fail-closed) é o gate de
      // `oculto`: recusa genérica ANTES de montar a linha, como `criarPedido`
      // (ERRO_GENERICO). Como linha bloqueada ela devolvia o preço de um item
      // que o lojista escondeu.
      if (!frequencia.disponivel && frequencia.motivo === "categoria_oculta") {
        return { ok: false, mensagem: ERRO_GENERICO };
      }

      const daCategoria = new Set(
        (produto.categoria_id
          ? allowlistPorCategoria[produto.categoria_id] ?? []
          : []
        ).map((g) => g.categoriaOpcionalId),
      );
      // (331) Os grupos da categoria menos os OCULTOS neste produto — a MESMA
      // regra pura de `criarPedido` e da vitrine.
      const permitidas = idsPermitidosDoProduto(daCategoria, ocultosPorProduto[produto.id]);
      let temOpcionalOculto = false;

      const opcionaisCalculo: OpcionalCalculo[] = [];
      for (const escolhido of item.opcionais ?? []) {
        const opcional = opcionalPorId.get(escolhido.opcional_id);
        // RN-O5 (inexistente/inativo) · RN-O3 (cross-loja) · RN-O4 (categoria
        // não associada ao produto) — os mesmos três gates do autoritativo.
        // `permitidas` é vazio quando o produto NÃO tem categoria — e um
        // produto sem categoria não autoriza opcional nenhum. A condicional
        // `produto.categoria_id != null` que existia aqui tornava o preview
        // MAIS GENEROSO que `pedido.ts:219`: ele confirmava preço e existência
        // de um adicional que o autoritativo recusa, e o cliente via um
        // subtotal que o pedido rejeitava com erro genérico. Byte a byte com
        // o autoritativo, portanto (§10-A).
        if (
          opcional == null ||
          !opcional.ativo ||
          opcional.loja_id !== dados.loja_id ||
          !daCategoria.has(opcional.categoria_opcional_id)
        ) {
          return { ok: false, mensagem: ERRO_GENERICO };
        }
        // (331/D1) Grupo da categoria, mas OCULTO neste produto: o carrinho
        // antigo não é recusado inteiro — a LINHA fica bloqueada (o cliente a
        // remove), como `criarPedido` recusa o mesmo carrinho.
        if (!permitidas.has(opcional.categoria_opcional_id)) {
          temOpcionalOculto = true;
          continue;
        }
        opcionaisCalculo.push({
          preco: opcional.preco,
          quantidade: escolhido.quantidade,
        });
      }

      // O desconto de produto vira PREÇO aqui (D8) — fonte única `precoEfetivo`.
      const preco = precoEfetivo(produto, agora);

      // (321) Período encerrado e fora da frequência viram `fora_da_janela`: a
      // linha fica bloqueada e o cliente a remove.
      // `disponivel` aqui é sempre true (o gate acima já derrubou o contrário):
      // a composição fica explícita para espelhar `projetarProdutoVitrine`.
      // (331) Adicional de grupo oculto no produto também bloqueia a linha;
      // a janela tem precedência no motivo (é o produto que não está à venda).
      const compravel = produto.disponivel && frequencia.disponivel && !temOpcionalOculto;

      linhas.push({
        produto_id: produto.id,
        quantidade: item.quantidade,
        preco: produto.preco,
        precoEfetivo: preco.precoEfetivo,
        temDesconto: preco.temDesconto,
        compravel,
        motivoNaoCompravel: compravel
          ? null
          : !frequencia.disponivel
            ? "fora_da_janela"
            : "opcional_indisponivel",
      });

      // Linha bloqueada não entra no subtotal, na base do cupom nem na
      // economia: o que o cliente não pode comprar, ele não paga — e é isso
      // que mantém o preview idêntico ao autoritativo, que recusa o pedido.
      if (!compravel) continue;

      componentes.push({
        precoProduto: preco,
        quantidade: item.quantidade,
        opcionais: opcionaisCalculo,
      });
      economiaBruta += (produto.preco - preco.precoEfetivo) * item.quantidade;
    }

    // Um único cálculo para os dois números: `bases.subtotal` é o mesmo
    // subtotal que `criarPedido` grava (derivarBasesCupom não recalcula).
    const bases = derivarBasesCupom(componentes);
    const subtotal = bases.subtotal;
    const economiaProdutos = arredondar(economiaBruta);

    let veredito = dados.codigo
      ? avaliarCupom(dados.codigo, cupom, bases, agora)
      : null;

    // (342) Cupom com limite por cliente: MESMA regra de `criarPedido`, no slot
    // já existente `valido: false`. Só depois de o cupom passar nas regras
    // globais (não revela nada de cupom inválido), e a sessão só é lida aqui.
    if (veredito?.valido && cupom != null && cupom.limite_por_cliente != null) {
      const clienteId = await resolverClienteDaSessao();
      const usosDoCliente =
        clienteId != null
          ? await contarUsosCupomDoCliente(svc, {
              lojaId: dados.loja_id,
              clienteId,
              codigo: cupom.codigo,
            })
          : 0;
      const v = avaliarCupomPorCliente({
        limitePorCliente: cupom.limite_por_cliente,
        clienteId,
        usosDoCliente,
      });
      if (!v.permitido) veredito = { valido: false, mensagem: v.mensagem };
    }

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
