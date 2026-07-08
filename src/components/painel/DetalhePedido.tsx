import type { ReactElement } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { formatarNumeroPedido } from "@/lib/utils/formatarNumeroPedido";
import {
  ROTULO_FORMA_PAGAMENTO,
  mapearOpcionaisExibicao,
} from "@/lib/utils/rotulosPedido";
import { ListaOpcionaisItem } from "@/components/vitrine/ListaOpcionaisItem";
import { SeletorImprimirPedido } from "@/components/painel/SeletorImprimirPedido";
import { ComandaCozinha } from "@/components/painel/ComandaCozinha";
import { ReciboCliente } from "@/components/painel/ReciboCliente";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";
import type { VarianteImpressao } from "@/lib/utils/variantesHabilitadas";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";
import {
  AcoesStatus,
  type AcaoStatus,
} from "@/app/(painel)/painel/(bloqueavel)/pedidos/[id]/AcoesStatus";

/**
 * Detalhe do pedido — componente compartilhado (issue 125). Server Component
 * puro de apresentação: SEM `'use client'` e SEM I/O. Consumido pelo painel do
 * lojista e (depois) pela page admin (140), sem cópia de markup.
 *
 * Exibe o SNAPSHOT gravado (nome/preço dos itens, subtotal/desconto/taxa/total)
 * — nunca recalcula nem busca o produto atual. O escopo por tenant e o I/O ficam
 * 100% no caller (page/loader), que já lê o pedido de forma escopada (RLS no
 * painel; loader `service_role` no admin). `basePedidos` só dirige a navegação
 * do link "Voltar" — não é barreira de segurança. `acaoStatus` é repassado a
 * `AcoesStatus` como `acao`; ambas as variantes revalidam `transicaoPermitida`
 * no servidor (RN-08).
 */
const APARENCIA_STATUS: Record<
  StatusPedido,
  { rotulo: string; classes: string }
> = {
  pendente: { rotulo: "Pendente", classes: "bg-amber-100 text-amber-800" },
  confirmado: { rotulo: "Confirmado", classes: "bg-blue-100 text-blue-800" },
  em_preparo: {
    rotulo: "Em preparo",
    classes: "bg-orange-100 text-orange-800",
  },
  saiu_entrega: {
    rotulo: "Saiu pra entrega",
    classes: "bg-cyan-100 text-cyan-800",
  },
  entregue: { rotulo: "Entregue", classes: "bg-green-100 text-green-800" },
  cancelado: { rotulo: "Cancelado", classes: "bg-red-100 text-red-800" },
};

type EnderecoEntrega = {
  cep?: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  complemento?: string;
};

/** Narrowing seguro do `Json | null` do endereço para exibição. */
function lerEndereco(valor: unknown): EnderecoEntrega | null {
  if (valor == null || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  return valor as EnderecoEntrega;
}

export function DetalhePedido({
  pedido,
  basePedidos = "/painel/pedidos",
  acaoStatus,
  // RN-M1 (server-autoritativo): a decisão de entitlement chega PRONTA em
  // `modulosImpressao` (calculada por `variantesHabilitadas` no caller). O
  // componente só monta o que o servidor autorizou — nunca recebe as flags
  // cruas nem decide sozinho. Default `[]` = FAIL-CLOSED: sem lista, nada de
  // impressão é montado (seletor/comanda/recibo fora do DOM). Serve também de
  // ponte de compilação: os callers atuais (painel/admin) ainda não passam a
  // prop e compilam com `[]`; as pages 136/137 passarão a lista real depois.
  modulosImpressao = [],
  nomeLoja,
}: {
  pedido: PedidoComItens;
  basePedidos?: string;
  acaoStatus?: AcaoStatus;
  modulosImpressao?: VarianteImpressao[];
  nomeLoja?: string;
}): ReactElement {
  const status = pedido.status as StatusPedido;
  const aparencia = APARENCIA_STATUS[status];
  const endereco = lerEndereco(pedido.endereco_entrega);

  return (
    <>
      {/* Conteúdo da tela + variante 1 (A4): marcado `print-a4`; as regras
          `@media print` (issue 138) usam essa classe. Os blocos térmicos
          (cozinha/recibo) são siblings FORA deste wrapper — cada variante tem
          seu próprio marcador e a 138 mostra só o da variante ativa. */}
      <div className="print-a4 mx-auto w-full max-w-2xl space-y-6">
        <div>
          <Link
            href={basePedidos}
            className="no-print mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Voltar aos pedidos
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="font-heading text-xl font-semibold text-foreground">
              Pedido #{formatarNumeroPedido(pedido.id)}
            </h1>
            <div className="flex items-center gap-2">
              {aparencia && (
                <Badge className={`border-transparent ${aparencia.classes}`}>
                  {aparencia.rotulo}
                </Badge>
              )}
              {/* RN-M1: seletor SÓ com variantes habilitadas; lista vazia ⇒
                  fora do DOM (não escondido por CSS). Recebe exatamente a lista
                  autorizada. Wrapper `no-print` além do `no-print` interno do
                  próprio seletor (RN-P2). */}
              {modulosImpressao.length > 0 && (
                <div className="no-print">
                  <SeletorImprimirPedido variantes={modulosImpressao} />
                </div>
              )}
            </div>
          </div>
        </div>

        <Card className="no-print">
          <CardHeader>
            <CardTitle className="text-base">Ações</CardTitle>
          </CardHeader>
          <CardContent>
            <AcoesStatus
              pedidoId={pedido.id}
              statusAtual={status}
              acao={acaoStatus}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium text-foreground">{pedido.nome_cliente}</p>
            {pedido.telefone_cliente && (
              <p className="text-muted-foreground">{pedido.telefone_cliente}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entrega</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            {endereco ? (
              <>
                <p>
                  {endereco.rua}
                  {endereco.numero ? `, ${endereco.numero}` : ""}
                </p>
                {endereco.complemento && <p>{endereco.complemento}</p>}
                <p>
                  {endereco.bairro}
                  {endereco.cidade ? ` — ${endereco.cidade}` : ""}
                </p>
                {endereco.cep && <p>CEP {endereco.cep}</p>}
              </>
            ) : (
              <p>Sem endereço de entrega.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Itens</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-foreground/10">
              {pedido.itens_pedido.map((item) => {
                // SNAPSHOT autoritativo (RN-O6): mesmo cálculo da confirmação —
                // acréscimo dos opcionais entra no total da linha, nunca recalculado
                // dos opcionais atuais do produto.
                const opcionais = mapearOpcionaisExibicao(
                  item.itens_pedido_opcionais ?? [],
                );
                const acrescimo = opcionais.reduce(
                  (s, o) => s + o.preco * o.quantidade,
                  0,
                );
                return (
                  <li key={item.id} className="px-6 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-foreground">
                        <span className="text-muted-foreground">
                          {item.quantidade}×{" "}
                        </span>
                        {item.nome}
                      </span>
                      <span className="text-foreground">
                        {formatarMoeda(
                          (item.preco + acrescimo) * item.quantidade,
                        )}
                      </span>
                    </div>
                    <ListaOpcionaisItem opcionais={opcionais} />
                  </li>
                );
              })}
            </ul>

            <Separator />

            <div className="space-y-1 px-6 py-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatarMoeda(pedido.subtotal)}</span>
              </div>
              {pedido.desconto > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    Desconto
                    {pedido.cupom_codigo ? ` (${pedido.cupom_codigo})` : ""}
                  </span>
                  <span>- {formatarMoeda(pedido.desconto)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Taxa de entrega</span>
                <span>{formatarMoeda(pedido.taxa_entrega)}</span>
              </div>
              <div className="flex justify-between pt-1 text-base font-semibold text-foreground">
                <span>Total</span>
                <span>{formatarMoeda(pedido.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pagamento e observações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>
              Forma de pagamento:{" "}
              <span className="text-foreground">
                {pedido.forma_pagamento
                  ? (ROTULO_FORMA_PAGAMENTO[pedido.forma_pagamento] ??
                    pedido.forma_pagamento)
                  : "—"}
              </span>
            </p>
            {pedido.observacoes && (
              <p>
                Observações:{" "}
                <span className="text-foreground">{pedido.observacoes}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RN-M1: blocos térmicos montados SÓ quando a variante está habilitada —
          ausentes do DOM (não escondidos por CSS) quando não. São print-only
          (invisíveis na tela até a 138). `nomeLoja ?? ""` porque o recibo exige
          string; sem nome, cabeçalho fica vazio (não quebra). */}
      {modulosImpressao.includes("cozinha") && (
        <ComandaCozinha pedido={pedido} />
      )}
      {modulosImpressao.includes("recibo") && (
        <ReciboCliente pedido={pedido} nomeLoja={nomeLoja ?? ""} />
      )}
    </>
  );
}
