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
import { calcularTotal } from "@/lib/utils/calcularTotal";
import { calcularFrete, type EnderecoEntrega } from "@/lib/utils/calcularFrete";
import {
  resolverCepServidor,
  type ResolucaoCep,
} from "@/lib/utils/resolverCepServidor";
import { distanciaDaLojaAoCep } from "@/lib/actions/distanciaFrete";
import { classificarFrete } from "@/lib/utils/freteDegradado";
import { calcularDesconto } from "@/lib/utils/calcularDesconto";
import { precoEfetivo } from "@/lib/utils/precoEfetivo";
import {
  derivarBasesCupom,
  type ComponentesLinha,
} from "@/lib/utils/derivarBasesCupom";
import { validarUsoCupom } from "@/lib/utils/validarUsoCupom";
import { lojaAberta, type Horarios } from "@/lib/utils/lojaAberta";
import { buscarCardapiosComProdutos } from "@/lib/supabase/queries/cardapios";
import {
  avaliarVigenciaDoProduto,
  visibilidadeDe,
} from "@/lib/utils/vigenciaCardapio";
import {
  assinaturaPermiteAcesso,
  type StatusAssinatura,
} from "@/lib/utils/assinatura";

export type ResultadoCriarPedido =
  | { pedidoId: string; token_acesso: string; whatsappHref: string | null }
  // `codigo` DISTINGUE a recusa de RN-12-a do erro genérico: o checkout precisa
  // saber que deve revisar o carrinho e mostrar o de/para (238), e não repetir
  // o mesmo envio. Ausente em toda outra recusa.
  | { erro: string; codigo?: "revisao_necessaria" };

const ERRO_GENERICO = "Não foi possível criar o pedido. Tente novamente.";
// RN-12-a: o cliente afirmou ter visto promoção num item que NÃO está mais em
// promoção — pagaria MAIS do que viu. D11 exige reconfirmação explícita, e a
// garantia é de SERVIDOR: nenhum componente precisa ser confiável para isso.
const ERRO_REVISAO = "Os preços do seu carrinho mudaram. Revise o pedido antes de confirmar.";
// (249/RN-08) Item que saiu da janela do cardápio entre montar o carrinho e
// confirmar. Específica como "Loja fechada no momento." e deliberadamente SEM
// nomear o item: quem nomeia é `revisarCarrinhoAction` (252), para quem o
// cliente já provou conhecer os ids. Não é oráculo — a mesma informação está
// pública no selo da vitrine.
const ERRO_FORA_DA_JANELA =
  "Um item do seu pedido saiu do cardápio deste horário. Revise o carrinho.";

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
    // (229) UM instante por request: a vigência de toda promoção do pedido e a
    // do cupom são avaliadas no MESMO `agora`. Duas leituras de relógio abrem
    // a janela para um item entrar em promoção no meio do próprio recálculo.
    const agora = new Date();

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
    const [formas, produtos, opcionaisBanco, zonasPreCarregadas, cardapios] =
      await Promise.all([
        listarFormasPagamento(svc, dados.loja_id),
        buscarProdutosPorIds(svc, ids),
        buscarOpcionaisPorIds(svc, opcionalIds),
        dados.tipo_entrega === "retirada"
          ? Promise.resolve<ZonaVitrine[]>([])
          : listarZonasComTaxas(svc, dados.loja_id),
        // (249) A MESMA query que o SSR da vitrine usa (247), aqui sob
        // `service_role`. Sem `.eq("ativo", true)`: RN-03 mora na função pura,
        // e o recálculo precisa ENXERGAR o cardápio para poder recusar.
        // Deliberadamente SEM try/catch local — rejeição sobe ao `Promise.all`
        // e ao catch externo, e o pedido é recusado (fail-closed, §14).
        buscarCardapiosComProdutos(svc, dados.loja_id),
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
      /** preço EFETIVO pago (já com o desconto de produto aplicado — D7). */
      preco: number;
      /** preço de TABELA; chave AUSENTE quando não houve desconto (RN-13). */
      preco_original?: number;
      quantidade: number;
      // [167] texto livre por item — PERSISTÊNCIA APENAS. Não existe em
      // `componentes` (abaixo): o recálculo de valor é estruturalmente cego a
      // ela (seguranca.md §10).
      observacao?: string;
      opcionais?: OpcionalSnapshot[];
    }[] = [];
    // As LINHAS do carrinho decompostas em componentes: a MESMA estrutura
    // alimenta o subtotal e a base elegível do cupom (via derivarBasesCupom),
    // então as duas não podem divergir. `precoProduto` recebe o resultado
    // INTEIRO de `precoEfetivo` (229) — preço e flag juntos, pelo tipo, sem
    // chance de aplicar um e esquecer o outro.
    const componentes: ComponentesLinha[] = [];

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

      // (249/RN-08) A janela do cardápio, pela MESMA função pura da vitrine e
      // da revisão (246) — nenhuma aritmética de fuso/prazo nova aqui. Fora da
      // janela recusa o PEDIDO INTEIRO, antes da RPC: nada gravado, nenhum item
      // descartado em silêncio. Sem `codigo` — não é a recusa de RN-12-a.
      const vigencia = avaliarVigenciaDoProduto(
        { visibilidade: visibilidadeDe(produto) },
        cardapios.cardapiosPorProduto.get(produto.id) ?? [],
        agora,
        loja.timezone,
      );
      if (!vigencia.dentroDaJanela) {
        return { erro: ERRO_FORA_DA_JANELA };
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

      // (229/D8) O desconto de produto VIRA PREÇO aqui, pela fonte única
      // `precoEfetivo` — a mesma que a vitrine e `revisarCarrinhoAction` usam.
      const preco = precoEfetivo(produto, agora);

      // (229/RN-12-a) A matriz do "segundo clique", ASSIMÉTRICA de propósito:
      //   true × true   → segue        false × false → segue
      //   false × true  → segue (o cliente paga MENOS do que viu; D11: preço
      //                   que cai só avisa)
      //   true × false  → RECUSA o PEDIDO INTEIRO, antes da RPC.
      // Ausente ⇒ false (`!== true`): cliente antigo na janela de deploy nunca
      // cai na recusa e segue pelo preço do banco, que é a regra de sempre.
      // Por isso o campo não é superfície de ataque de valor: não existe valor
      // que o cliente possa enviar aqui para pagar menos.
      if (item.promocaoExibida === true && !preco.temDesconto) {
        return { erro: ERRO_REVISAO, codigo: "revisao_necessaria" };
      }

      itensSnapshot.push({
        produto_id: produto.id,
        nome: produto.nome,
        // (229/D7) `preco` = o que o cliente PAGA (efetivo).
        preco: preco.precoEfetivo,
        quantidade: item.quantidade,
        // (229/RN-13) `preco_original` = o preço de TABELA do banco, e só
        // quando houve desconto: sem promoção a chave é OMITIDA e a RPC grava
        // NULL (um par "de R$ 100,00 por R$ 100,00" não é um de/para). Sai de
        // `produtos.preco`, NUNCA de aritmética inversa sobre o efetivo.
        ...(preco.temDesconto ? { preco_original: produto.preco } : {}),
        // [167] já normalizada pelo zod (ponto único de verdade); vazia ->
        // chave omitida, para a RPC gravar NULL.
        ...(item.observacao ? { observacao: item.observacao } : {}),
        ...(opcionaisSnapshot.length > 0 ? { opcionais: opcionaisSnapshot } : {}),
      });
      componentes.push({
        // (229) O resultado INTEIRO de `precoEfetivo`: preço e flag são UM
        // valor. É o que impede cobrar o preço com desconto e ainda deixar o
        // produto promocional dentro da base elegível do cupom (D5).
        precoProduto: preco,
        quantidade: item.quantidade,
        opcionais: opcionaisCalculo,
      });
    }

    // Um único cálculo para os dois números: `bases.subtotal` É
    // `calcularSubtotal` das mesmas linhas (derivarBasesCupom não recalcula).
    const bases = derivarBasesCupom(componentes);
    const subtotal = bases.subtotal;

    // (5) Frete autoritativo (RN-C2): retirada → frete 0, servidor ignora endereço.
    //     Entrega → calcularFrete com zonas do banco. Fora de área → recusa.
    let frete: { atendido: boolean; taxa: number; zonaId: string | null; gratis: boolean };
    // (180-B) `true` quando a distância ERA necessária e ficou DESCONHECIDA: o
    // frete não pode ser inventado nem herdado do fallback fora-de-zona, então
    // o pedido nasce SEM taxa e a loja combina a entrega no chat. NUNCA vem do
    // cliente — é derivado aqui, do zero, a cada submit (mandato 1 / D10).
    let freteACombinar = false;
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
      //
      // (180-B/achado 1) O thunk repassa a `ResolucaoCep` INTEIRA — é por dentro
      // dela que o motivo "este CEP não existe" chega ao geocoder distinto de
      // "o ViaCEP caiu". Sem CEP o thunk nem vai ao ViaCEP; o motivo desse ramo
      // é irrelevante (`distanciaDaLojaAoCep` curto-circuita em `sem_cep`) e a
      // reconciliação abaixo só lê `endereco`.
      const cepCliente = endereco.cep;
      let promessaCep: Promise<ResolucaoCep> | undefined;
      const resolverCep = (): Promise<ResolucaoCep> =>
        cepCliente
          ? (promessaCep ??= resolverCepServidor(cepCliente))
          : Promise.resolve({ endereco: null, motivo: "transitorio" });

      let enderecoAutoritativo = endereco;
      if (endereco.bairro) {
        const resolucao = await resolverCep();
        // Não resolvível (sem CEP, ViaCEP down ou CEP inexistente): bairro
        // declarado não é confiável para seleção de zona → descarta. O
        // fail-closed da 064 NÃO muda com o contrato novo.
        enderecoAutoritativo = {
          ...endereco,
          bairro: resolucao.endereco?.bairro ?? null,
        };
      }

      // (006/RN-7) Distância loja→CEP para zonas tipo='raio_km'. MESMA sequência do
      // preview (calcularFreteAction, 007) via helper neutro distanciaDaLojaAoCep.
      // Fail-closed (RN-5): qualquer falha → undefined → zonaAtende('raio_km') não
      // casa → fallback. Só injetamos quando há número; nunca confiamos em
      // distanciaKm vindo do cliente (RN-4). endereco.cep = CEP cru do cliente
      // (a reconciliação só mexe em bairro). Roda sempre que há CEP, independente
      // de existir zona raio_km (paridade com o preview; custo protegido §12-A).
      // (180-B) O retorno é discriminado: a CAUSA da ausência é o que separa
      // "a distância não se aplica" de "a distância não pôde ser calculada".
      const distancia = await distanciaDaLojaAoCep(
        svc,
        dados.loja_id,
        endereco.cep,
        resolverCep,
        ip,
      );
      if (distancia.causa === "ok") {
        distanciaKm = distancia.km;
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
      // (180-B) MESMA classificação do preview (`calcularFreteAction`) — fonte
      // única, para que o que o cliente viu e o que é gravado não divirjam
      // (RN-7). O veredito a-combinar PRECEDE o fallback fora-de-zona: aplicar
      // uma regra de negócio sobre o ENDEREÇO a uma falha de INFRAESTRUTURA
      // nossa é cobrar o cliente pelo nosso problema.
      //
      // `temCoordsLoja` só é consultado no ramo `sem_cep`; aqui o schema exige
      // CEP em toda entrega, então nunca é necessário (null = não consultado).
      const veredito = classificarFrete({
        resultado: frete,
        zonas,
        causaDistancia: distancia.causa,
        temCoordsLoja: null,
      });

      if (veredito.tipo === "a_combinar") {
        // O pedido É criado: mandar o cliente embora por uma falha nossa é o
        // dano que a issue corrige. A taxa fica NULL e o total sai sem frete.
        freteACombinar = true;
      } else if (!frete.atendido) {
        // Só aqui o endereço está genuinamente fora de área (geocoding OK).
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
      if (cupom != null && validarUsoCupom(cupom, subtotal, agora).valido) {
        const r = calcularDesconto(
          { ...cupom, tipo: cupom.tipo as "percentual" | "fixo" },
          bases,
        );
        if (r.aplicado) {
          desconto = r.desconto;
          // (229/RN-10.3) O cupom só é CONSUMIDO quando descontou dinheiro de
          // verdade. Carrinho 100% promocional dá base elegível zero: com
          // `p_cupom_id` preenchido a RPC incrementaria `usos_contagem` e o
          // cliente perderia um uso que não recebeu.
          if (r.desconto > 0) {
            cupomId = cupom.id;
            cupomCodigo = cupom.codigo;
          }
        }
      }
    }

    // (7) Total autoritativo. troco_para é INFORMATIVO (RN-C3): só persiste
    //     quando o pagamento é dinheiro; caso contrário null. Nunca entra no total.
    // (180-B) A combinar ⇒ o frete ainda não existe: `total = subtotal −
    // desconto`, sem frete. Zero NÃO é "frete grátis" aqui — a etiqueta vem de
    // `frete_a_combinar`, nunca de `taxa_entrega == 0`.
    const taxaEntregaGravada = freteACombinar ? null : frete.taxa;
    const { total } = calcularTotal({
      subtotal,
      desconto,
      taxaEntrega: taxaEntregaGravada ?? 0,
    });
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
      p_taxa_entrega: taxaEntregaGravada,
      // (180-B) Derivado 100% no servidor. O CHECK do banco amarra o par
      // (frete_a_combinar ⟺ taxa_entrega IS NULL) como última linha.
      p_frete_a_combinar: freteACombinar,
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
