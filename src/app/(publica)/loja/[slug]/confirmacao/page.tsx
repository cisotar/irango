import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buscarPedidoPorToken,
  type PedidoComItens,
} from "@/lib/supabase/queries/pedidos";
import { buscarLojaParaPedido } from "@/lib/supabase/queries/lojas";
import { listarFormasPagamento } from "@/lib/supabase/queries/entregaPagamento";
import { resolverAcaoConfirmacao } from "@/lib/utils/confirmacao";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { montarLinkWhatsappPedido } from "@/lib/utils/whatsappPedido";
import { ListaOpcionaisItem } from "@/components/vitrine/ListaOpcionaisItem";
import { ConfirmacaoClient } from "./ConfirmacaoClient";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ pedido?: string; token?: string }>;
};

export const metadata = { title: "Pedido confirmado — iRango" };

/** Número curto exibido ao cliente — primeiros 8 chars do id, maiúsculo. */
function numeroCurto(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/** Rótulo amigável da forma de pagamento. */
function rotuloForma(tipo: string | null): string {
  switch (tipo) {
    case "pix":
      return "Pix";
    case "dinheiro":
      return "Dinheiro";
    case "cartao":
      return "Cartão na entrega";
    default:
      return tipo ?? "—";
  }
}

/** Rótulo do tipo de entrega. */
function rotuloTipoEntrega(tipo: string | null): string {
  if (tipo === "retirada") return "Retirada no local";
  if (tipo === "entrega") return "Entrega";
  return tipo ?? "—";
}

/**
 * Formata endereço de entrega a partir do JSONB `endereco_entrega`.
 * O objeto pode conter campos livres; só lemos os conhecidos (rua, numero, bairro, cidade, estado, cep).
 */
function formatarEndereco(endereco: unknown): string {
  if (endereco == null || typeof endereco !== "object") return "—";
  const e = endereco as Record<string, unknown>;
  const str = (v: unknown): string =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : "";

  const linha1 = [str(e.rua), str(e.numero)].filter(Boolean).join(", ");
  const linha2 = [str(e.bairro), str(e.cidade), str(e.estado)]
    .filter(Boolean)
    .join(" — ");
  const cep = str(e.cep) ? `CEP ${str(e.cep)}` : "";
  return [linha1, linha2, cep].filter(Boolean).join(" · ") || "—";
}

/**
 * Instrução de pagamento a partir do `config` (JSONB) da forma da loja.
 * Lê apenas campos previsíveis e os trata como texto — nada é interpretado.
 * Sem config relevante → null (não renderiza o bloco).
 */
function instrucaoPagamento(config: unknown): string | null {
  if (config == null || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  if (typeof c.chave_pix === "string" && c.chave_pix.trim() !== "") {
    return `Chave Pix: ${c.chave_pix}`;
  }
  if (typeof c.instrucoes === "string" && c.instrucoes.trim() !== "") {
    return c.instrucoes;
  }
  return null;
}

/**
 * Instrução fixa por forma de pagamento quando não há config da loja.
 * Dinheiro com troco → inclui valor do troco.
 */
function instrucaoPadrao(
  forma: string | null,
  troco: number | null,
): string | null {
  if (forma === "dinheiro") {
    if (troco && troco > 0) {
      return `Pague em dinheiro na entrega. Troco para ${formatarMoeda(troco)}.`;
    }
    return "Pague em dinheiro na entrega.";
  }
  if (forma === "cartao") {
    return "Pague com cartão no momento da entrega.";
  }
  return null;
}

export default async function ConfirmacaoPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const { pedido: pedidoId, token } = await searchParams;

  // Sem par (id, token) não há o que buscar — comporta como "não encontrado".
  let pedido: PedidoComItens | null = null;
  if (pedidoId && token) {
    // service_role: NÃO há SELECT anon em `pedidos`. O token é a senha do pedido;
    // `buscarPedidoPorToken` só retorna se (id, token_acesso) conferem (026).
    const svc = createServiceClient();
    pedido = await buscarPedidoPorToken(svc, pedidoId, token);
  }

  const acao = resolverAcaoConfirmacao(pedido, slug);
  // Token errado/ausente → redireciona SEM vazar dado do pedido (invariante 037).
  if (acao.acao === "redirecionar") redirect(acao.destino);

  const ped = acao.pedido;

  // Instrução de pagamento: derivada da forma configurada pela loja (config JSONB).
  const svc = createServiceClient();
  const formas = await listarFormasPagamento(svc, ped.loja_id);
  const forma = formas.find((f) => f.tipo === ped.forma_pagamento);
  const instrucao = forma ? instrucaoPagamento(forma.config) : null;

  const loja = await buscarLojaParaPedido(svc, ped.loja_id);
  const linkWhatsapp = loja ? montarLinkWhatsappPedido(ped, loja) : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-4 py-10 md:max-w-2xl">
      <ConfirmacaoClient />

      <Card>
        <CardHeader className="items-center text-center">
          <CheckCircle
            className="mx-auto size-12 text-destaque"
            aria-hidden="true"
          />
          <CardTitle className="mt-2 text-xl">Pedido confirmado!</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pedido nº{" "}
            <span className="font-mono font-semibold">
              {numeroCurto(ped.id)}
            </span>
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <section aria-label="Itens do pedido" className="flex flex-col gap-2">
            {ped.itens_pedido.map((item) => {
              // SNAPSHOT autoritativo (RN-O6): nome/preço do momento do pedido,
              // lidos por token (server-side) — NUNCA recalculados dos opcionais
              // atuais. O total do pedido (ped.total) é o final do servidor.
              const opcionais = item.itens_pedido_opcionais ?? [];
              const acrescimo = opcionais.reduce(
                (s, o) => s + o.preco_snapshot * o.quantidade,
                0,
              );
              const totalItem = (item.preco + acrescimo) * item.quantidade;
              return (
                <div key={item.id} className="flex flex-col gap-0.5">
                  <div className="flex justify-between text-sm">
                    <span>
                      {item.quantidade}× {item.nome}
                    </span>
                    <span>{formatarMoeda(totalItem)}</span>
                  </div>
                  <ListaOpcionaisItem
                    opcionais={opcionais.map((o) => ({
                      id: o.id,
                      nome: o.nome_snapshot,
                      preco: o.preco_snapshot,
                      quantidade: o.quantidade,
                    }))}
                  />
                </div>
              );
            })}
          </section>

          <Separator />

          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatarMoeda(ped.subtotal)}</dd>
            </div>
            {ped.desconto > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Desconto</dt>
                <dd>-{formatarMoeda(ped.desconto)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {ped.tipo_entrega === "retirada" ? "Taxa de entrega" : "Entrega"}
              </dt>
              <dd>
                {ped.tipo_entrega === "retirada" && ped.taxa_entrega === 0
                  ? "Grátis"
                  : formatarMoeda(ped.taxa_entrega)}
              </dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd>{formatarMoeda(ped.total)}</dd>
            </div>
          </dl>

          <Separator />

          {/* Tipo de entrega */}
          <div className="text-sm">
            <p className="text-muted-foreground">Tipo</p>
            <p className="font-medium">{rotuloTipoEntrega(ped.tipo_entrega)}</p>
          </div>

          {/* Endereço — só exibe em entregas domiciliares */}
          {ped.tipo_entrega === "entrega" && (
            <div className="text-sm">
              <p className="text-muted-foreground">Endereço de entrega</p>
              <p className="font-medium">{formatarEndereco(ped.endereco_entrega)}</p>
            </div>
          )}

          <Separator />

          <div className="text-sm">
            <p className="text-muted-foreground">Forma de pagamento</p>
            <p className="font-medium">{rotuloForma(ped.forma_pagamento)}</p>
            {/* Troco — só exibe em dinheiro com troco_para preenchido */}
            {ped.forma_pagamento === "dinheiro" && ped.troco_para && ped.troco_para > 0 && (
              <p className="mt-1 text-sm font-medium">
                Troco para {formatarMoeda(ped.troco_para)}
              </p>
            )}
            {instrucao ? (
              <p className="mt-1 rounded-md bg-muted p-3 text-sm">{instrucao}</p>
            ) : (
              instrucaoPadrao(ped.forma_pagamento, ped.troco_para) && (
                <p className="mt-1 rounded-md bg-muted p-3 text-sm">
                  {instrucaoPadrao(ped.forma_pagamento, ped.troco_para)}
                </p>
              )
            )}
          </div>
        </CardContent>
      </Card>

      {linkWhatsapp ? (
        <Button
          className="w-full"
          nativeButton={false}
          render={
            <a
              href={linkWhatsapp.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle aria-hidden className="size-4" />
              Avisar a loja no WhatsApp
            </a>
          }
        />
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          Seu pedido já foi registrado. A loja acompanhará pelo painel.
        </p>
      )}

      <Button
        className="w-full"
        nativeButton={false}
        render={<Link href={`/loja/${slug}`}>Voltar à loja</Link>}
      />
    </main>
  );
}
