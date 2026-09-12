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
// Rate limit ~10/min por IP (issue 052, seguranca.md §12): guard no topo, antes
// de qualquer I/O. IP de headers() server-side, nunca do payload.

import { headers } from "next/headers";
import { schemaPayloadPedido } from "@/lib/validacoes/pedido";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaParaPedido } from "@/lib/supabase/queries/lojas";
import { buscarPedidoPorToken } from "@/lib/supabase/queries/pedidos";
import { montarLinkWhatsappPedido } from "@/lib/utils/whatsappPedido";
import {
  buscarProdutosPorIds,
  buscarOpcionaisPorIds,
  buscarOpcionaisPorCategoria,
} from "@/lib/supabase/queries/produtos";
import {
  listarZonasComTaxas,
  listarFormasPagamento,
  buscarCupomPorCodigo,
  type ZonaVitrine,
} from "@/lib/supabase/queries/entregaPagamento";
import { calcularSubtotal, calcularTotal } from "@/lib/utils/calcularTotal";
import { calcularFrete, type EnderecoEntrega } from "@/lib/utils/calcularFrete";
import {
  resolverCepServidor,
  type EnderecoCepResolvido,
} from "@/lib/utils/resolverCepServidor";
import { distanciaDaLojaAoCep } from "@/lib/actions/distanciaFrete";
import { calcularDesconto } from "@/lib/utils/calcularDesconto";
import { validarUsoCupom } from "@/lib/utils/validarUsoCupom";
import { lojaAberta, type Horarios } from "@/lib/utils/lojaAberta";
import {
  assinaturaPermiteAcesso,
  type StatusAssinatura,
} from "@/lib/utils/assinatura";

export type ResultadoCriarPedido =
  | { pedidoId: string; token_acesso: string; whatsappHref: string | null }
  | { erro: string };

const ERRO_GENERICO = "Não foi possível criar o pedido. Tente novamente.";

export async function criarPedido(payload: unknown): Promise<ResultadoCriarPedido> {
  // (0) Rate limit por IP antes de qualquer I/O (incl. safeParse): payload
  //     malformado em loop também conta na trava. Excedeu → erro genérico (§14).
  const ip = extrairIp(await headers());
  if (!(await verificarRateLimit("criarPedido", ip)).permitido) {
    return { erro: "Muitas tentativas. Tente novamente em alguns instantes." };
  }

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

    // (3/4/4b/5-zonas) [159] ONDA ÚNICA de leituras independentes — antes eram
    //     round trips em série. Nenhuma depende do resultado da outra: as chaves de
    //     busca (`ids`, `opcionalIds`) saem do payload JÁ validado pelo zod, sem I/O.
    //     `listarZonasComTaxas` entra na onda sob a MESMA condição do ramo de frete
    //     (§5, abaixo): em `retirada` ela continua NÃO sendo chamada — nem aqui,
    //     nem lá. Içá-la incondicionalmente daria um round trip a todo pedido de
    //     retirada, o oposto do objetivo da issue.
    //     `buscarOpcionaisPorCategoria` fica FORA da onda: depende de `produtos`.
    //     Trade-off aceito (decisão em performance/2026-09-07-159-*.md): o `return`
    //     de forma de pagamento inválida (logo abaixo) deixa de economizar as demais
    //     leituras. Esse ramo é raro por construção — a UI só oferece as formas
    //     configuradas pela loja, e o teto de custo por requisição não muda: quem
    //     forja payload já foi barrado pelo rate limit (:55) e pelo zod `.strict()`
    //     (:61), ambos antes de qualquer I/O.
    //     Rejeição de qualquer leitura da onda rejeita o `Promise.all` → catch
    //     externo → MESMA mensagem genérica ao cliente (§14), sem vazar detalhe.
    const ids = [...new Set(dados.itens.map((i) => i.produto_id))];
    const opcionalIds = [
      ...new Set(
        dados.itens.flatMap((i) => (i.opcionais ?? []).map((o) => o.opcional_id)),
      ),
    ];
    const [formas, produtos, opcionaisBanco, zonasPreCarregadas] = await Promise.all([
      listarFormasPagamento(svc, dados.loja_id),
      buscarProdutosPorIds(svc, ids),
      buscarOpcionaisPorIds(svc, opcionalIds),
      dados.tipo_entrega === "retirada"
        ? Promise.resolve<ZonaVitrine[]>([])
        : listarZonasComTaxas(svc, dados.loja_id),
    ]);

    // (3) Forma de pagamento ∈ formas configuradas pela loja.
    if (!formas.some((f) => f.tipo === dados.forma_pagamento)) {
      return { erro: ERRO_GENERICO };
    }

    // (4) Produtos: existem? disponíveis? não-ocultos? da loja correta? (subtotal do PREÇO REAL)
    const porId = new Map(produtos.map((p) => [p.id, p]));

    // (4b) Opcionais (085): preço/loja/categoria/ativo vêm SEMPRE do banco
    //      (RN-O1/O2). A onda acima leu todos os opcional_id escolhidos; a allowlist
    //      por categoria de produto (RN-O4) depende de `produtos` e por isso fica na
    //      onda seguinte. `[]`/`{}` quando não há opcionais.
    const opcionalPorId = new Map(opcionaisBanco.map((o) => [o.id, o]));

    const categoriaIds = [
      ...new Set(
        produtos
          .map((p) => p.categoria_id)
          .filter((c): c is string => c != null),
      ),
    ];
    const allowlistPorCategoria = await buscarOpcionaisPorCategoria(svc, categoriaIds);

    type OpcionalSnapshot = {
      opcional_id: string;
      nome_snapshot: string;
      preco_snapshot: number;
      quantidade: number;
    };
    const itensSnapshot: {
      produto_id: string;
      nome: string;
      preco: number;
      quantidade: number;
      // [167] texto livre por item — PERSISTÊNCIA APENAS. Não existe em
      // itensCalculo (abaixo): o recálculo de valor é estruturalmente cego a
      // ela (seguranca.md §10).
      observacao?: string;
      opcionais?: OpcionalSnapshot[];
    }[] = [];
    const itensCalculo: {
      preco: number;
      quantidade: number;
      opcionais?: { preco: number; quantidade: number }[];
    }[] = [];

    for (const item of dados.itens) {
      const produto = porId.get(item.produto_id);
      if (
        produto == null ||
        !produto.disponivel ||
        produto.oculto === true ||
        produto.loja_id !== dados.loja_id
      ) {
        return { erro: ERRO_GENERICO };
      }

      // Conjunto de categorias de opcional permitidas para a categoria do produto.
      const permitidas = new Set(
        (produto.categoria_id
          ? allowlistPorCategoria[produto.categoria_id] ?? []
          : []
        ).map((g) => g.categoriaOpcionalId),
      );

      const opcionaisSnapshot: OpcionalSnapshot[] = [];
      const opcionaisCalculo: { preco: number; quantidade: number }[] = [];
      for (const escolhido of item.opcionais ?? []) {
        const opcional = opcionalPorId.get(escolhido.opcional_id);
        // RN-O5: inexistente/inativo · RN-O3: cross-loja · RN-O4: categoria
        // não associada → recusa o PEDIDO INTEIRO antes de chamar a RPC.
        if (
          opcional == null ||
          !opcional.ativo ||
          opcional.loja_id !== dados.loja_id ||
          !permitidas.has(opcional.categoria_opcional_id)
        ) {
          return { erro: ERRO_GENERICO };
        }
        opcionaisSnapshot.push({
          opcional_id: opcional.id,
          nome_snapshot: opcional.nome,
          preco_snapshot: opcional.preco,
          quantidade: escolhido.quantidade,
        });
        opcionaisCalculo.push({ preco: opcional.preco, quantidade: escolhido.quantidade });
      }

      itensSnapshot.push({
        produto_id: produto.id,
        nome: produto.nome,
        preco: produto.preco,
        quantidade: item.quantidade,
        // [167] já normalizada pelo zod (ponto único de verdade); vazia ->
        // chave omitida, para a RPC gravar NULL.
        ...(item.observacao ? { observacao: item.observacao } : {}),
        ...(opcionaisSnapshot.length > 0 ? { opcionais: opcionaisSnapshot } : {}),
      });
      itensCalculo.push({
        preco: produto.preco,
        quantidade: item.quantidade,
        ...(opcionaisCalculo.length > 0 ? { opcionais: opcionaisCalculo } : {}),
      });
    }

    const subtotal = calcularSubtotal(itensCalculo);

    // (5) Frete autoritativo (RN-C2): retirada → frete 0, servidor ignora endereço.
    //     Entrega → calcularFrete com zonas do banco. Fora de área → recusa.
    let frete: { atendido: boolean; taxa: number; zonaId: string | null; gratis: boolean };
    // (006) Distância loja→CEP (linha reta) para zonas tipo='raio_km'. Derivada
    // server-side; só é number no ramo entrega quando há coords+geocoding. Usada
    // tanto em calcularFrete quanto na persistência do snapshot (RN-9). Em retirada
    // permanece undefined → p_endereco_entrega=null não a lê.
    let distanciaKm: number | undefined;
    if (dados.tipo_entrega === "retirada") {
      // RN-C2: servidor força frete zero e ignora qualquer endereço enviado.
      frete = { atendido: true, taxa: 0, zonaId: null, gratis: false };
    } else {
      // [159] já lido na onda de leituras acima, sob esta MESMA condição (só o ramo
      // `entrega` dispara a query).
      const zonas = zonasPreCarregadas;
      // endereco_entrega é garantido pelo refine do schema quando tipo_entrega='entrega'.
      const endereco: EnderecoEntrega = dados.endereco_entrega ?? {};

      // (064) Reconciliação CEP↔bairro: o bairro declarado pelo cliente seleciona
      // a zona de frete (tipo='bairro'), logo é vetor de subpagamento. Quando há
      // CEP e bairro, consultamos o ViaCEP NO SERVIDOR e usamos o bairro CANÔNICO
      // (do CEP) na busca de zona — nunca o declarado.
      //
      // FAIL-CLOSED (064 RN/D4, seguranca.md §14): ViaCEP indisponível / CEP
      // inexistente → reconciliado:false → DESCARTAMOS o bairro declarado. Manter
      // o declarado reabriria o vetor (cliente força timeout do ViaCEP e casa a
      // zona barata). Sem bairro reconciliado, calcularFrete não casa nenhuma zona
      // tipo='bairro' e cai no fallback fora-de-zona (mais caro) ou indisponível.
      // O CEP numérico permanece intacto para zonas tipo='faixa_cep'. ATENÇÃO: essa
      // reconciliação cobre só tipo='bairro'. Para 'faixa_cep' a seleção de zona
      // depende do CEP DECLARADO pelo cliente — não há fonte mais canônica pra
      // reconciliar server-side (ao contrário do bairro, que é validado contra o
      // CEP via ViaCEP). Risco residual inerente, mitigável só operacionalmente
      // (seguranca.md §10-A).
      //
      // (185) A resolução do CEP é MEMOIZADA e serve dois consumidores: o bairro
      // canônico aqui e a consulta de geocoding logo abaixo. É um thunk, não uma
      // chamada eager — o helper de distância só o invoca no miss de cache.
      const cepCliente = endereco.cep;
      let promessaCep: Promise<EnderecoCepResolvido | null> | undefined;
      const resolverCep = (): Promise<EnderecoCepResolvido | null> =>
        cepCliente
          ? (promessaCep ??= resolverCepServidor(cepCliente))
          : Promise.resolve(null);

      let enderecoAutoritativo = endereco;
      if (endereco.bairro) {
        const resolvido = await resolverCep();
        // Não resolvível (sem CEP, ViaCEP down ou CEP inexistente): bairro
        // declarado não é confiável para seleção de zona → descarta.
        enderecoAutoritativo = { ...endereco, bairro: resolvido?.bairro ?? null };
      }

      // (006/RN-7) Distância loja→CEP para zonas tipo='raio_km'. MESMA sequência do
      // preview (calcularFreteAction, 007) via helper neutro distanciaDaLojaAoCep.
      // Fail-closed (RN-5): qualquer falha → undefined → zonaAtende('raio_km') não
      // casa → fallback. Só injetamos quando há número; nunca confiamos em
      // distanciaKm vindo do cliente (RN-4). endereco.cep = CEP cru do cliente
      // (a reconciliação só mexe em bairro). Roda sempre que há CEP, independente
      // de existir zona raio_km (paridade com o preview; custo protegido §12-A).
      distanciaKm = await distanciaDaLojaAoCep(
        svc,
        dados.loja_id,
        endereco.cep,
        resolverCep,
        ip,
      );
      if (typeof distanciaKm === "number") {
        enderecoAutoritativo = { ...enderecoAutoritativo, distanciaKm };
      }

      // 4º arg (RN-C4 passo 4): taxa_entrega_fora_zona habilita fallback fora-de-zona —
      // null/undefined ⇒ entrega indisponível para o bairro (frete.atendido=false).
      frete = calcularFrete(
        zonas,
        enderecoAutoritativo,
        subtotal,
        loja.taxa_entrega_fora_zona,
      );
      if (!frete.atendido) {
        return { erro: "Entrega não disponível para o seu bairro." };
      }
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

    // (7) Total autoritativo. troco_para é INFORMATIVO (RN-C3): só persiste
    //     quando o pagamento é dinheiro; caso contrário null. Nunca entra no total.
    const { total } = calcularTotal({ subtotal, desconto, taxaEntrega: frete.taxa });
    const trocoPara =
      dados.forma_pagamento === "dinheiro" ? dados.troco_para ?? null : null;

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
      // Minimização de PII (LGPD §20): retirada não tem entrega → não persistir
      // endereço, mesmo que o cliente o tenha enviado no payload.
      // (006) Snapshot = endereço DECLARADO pelo cliente (LGPD: endereço real de
      // entrega) + distanciaKm DERIVADO server-side, persistido só quando number
      // (campo aditivo no JSONB, ausente caso contrário — RN-9, auditoria de
      // cobrança). Não persistimos coords (cliente nem loja).
      p_endereco_entrega:
        dados.tipo_entrega === "retirada"
          ? null
          : {
              ...dados.endereco_entrega,
              ...(typeof distanciaKm === "number" ? { distanciaKm } : {}),
            },
      p_forma_pagamento: dados.forma_pagamento,
      // [167] `||` e não `??`: o zod normaliza " " para "" — vazio vira NULL.
      p_observacoes: dados.observacoes || null,
      p_subtotal: subtotal,
      p_taxa_entrega: frete.taxa,
      p_desconto: desconto,
      p_total: total,
      p_cupom_id: cupomId,
      p_cupom_codigo: cupomCodigo,
      p_itens: itensSnapshot,
      p_tipo_entrega: dados.tipo_entrega,
      p_troco_para: trocoPara,
      // (063) idempotência: a chave do client só desduplica (escopada por loja
      // pelo índice/SELECT da RPC); não influencia valor/autorização.
      p_idempotency_key: dados.idempotency_key ?? null,
    });

    if (error != null || data == null || data.length === 0) {
      // §14: erro de banco nunca vaza — log no servidor, genérico ao cliente.
      console.error("[criarPedido]", error);
      return { erro: ERRO_GENERICO };
    }

    const pedidoId = data[0].pedido_id;
    const tokenAcesso = data[0].token_acesso;

    // (9) whatsappHref (125, RN-A2/A4/A6). A DECISÃO de emitir é do servidor:
    //     flag da loja + WhatsApp cadastrado, avaliados ANTES de qualquer I/O
    //     extra (`=== true` estrito = fail-closed). O CONTEÚDO vem da linha
    //     GRAVADA, relida por buscarPedidoPorToken — nunca de itensSnapshot/
    //     total em memória: a RPC pode divergir do que recebeu (trava de cupom
    //     perdida na corrida zera o desconto e recompõe o total; replay
    //     idempotente devolve outro pedido). Best-effort (RN-A4): try/catch
    //     próprio, pois o pedido JÁ está gravado — falha aqui vira href null,
    //     nunca erro ao cliente.
    let whatsappHref: string | null = null;
    if (loja.whatsapp_envio_automatico === true && loja.whatsapp) {
      try {
        const gravado = await buscarPedidoPorToken(svc, pedidoId, tokenAcesso);
        whatsappHref = gravado
          ? montarLinkWhatsappPedido(gravado, loja)?.href ?? null
          : null;
      } catch (e) {
        // §14: log server-side com prefixo próprio, nada vaza ao cliente.
        console.error("[criarPedido:whatsapp]", e);
      }
    }

    return { pedidoId, token_acesso: tokenAcesso, whatsappHref };
  } catch (e) {
    // §14: exceção inesperada nunca vaza `e.message` ao cliente.
    console.error("[criarPedido]", e);
    return { erro: ERRO_GENERICO };
  }
}
