"use client";

// Etapa 3 do wizard (issue 078): pagamento + dados do cliente + envio.
//
// CRÍTICO (seguranca.md §10): o payload enviado a criarPedido (071) NÃO carrega
// nenhum valor monetário — só intenção (itens com produto_id+quantidade, tipo de
// entrega, endereço se entrega, cupom, forma de pagamento, troco, identificação).
// O servidor recalcula subtotal/desconto/frete/total do banco. O payload é
// validado por schemaPayloadPedido (.strict()) ANTES do envio.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { IMaskInput } from "react-imask";
import { criarPedido } from "@/lib/actions/pedido";
import { schemaPayloadPedido } from "@/lib/validacoes/pedido";
import type { EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import { ResumoValores } from "./ResumoValores";
import type {
  EstadoWizard,
  FormaPagamentoWizard,
  TipoPagamento,
} from "./estado";

const ROTULO_PAGAMENTO: Record<TipoPagamento, string> = {
  pix: "Pix",
  cartao: "Cartão de crédito/débito",
  dinheiro: "Dinheiro",
  link: "Link de pagamento",
};

const SUBTITULO_PAGAMENTO: Record<TipoPagamento, string> = {
  pix: "Recomendado — pague na hora",
  cartao: "Link de pagamento via WhatsApp",
  dinheiro: "Pague na entrega/retirada",
  link: "Link de pagamento via WhatsApp",
};

export type EtapaPagamentoProps = {
  lojaId: string;
  lojaSlug: string;
  lojaAberta: boolean;
  formasPagamento: FormaPagamentoWizard[];
  itens: {
    produtoId: string;
    quantidade: number;
    // Opcionais escolhidos — só id + quantidade (RN-O2). NUNCA preço.
    opcionais?: { opcionalId: string; quantidade: number }[];
  }[];
  estado: EstadoWizard;
  subtotal: number;
  desconto: number;
  frete: number;
  onEstadoChange: (patch: Partial<EstadoWizard>) => void;
  onVoltar: () => void;
};

export function EtapaPagamento({
  lojaId,
  lojaSlug,
  lojaAberta,
  formasPagamento,
  itens,
  estado,
  subtotal,
  desconto,
  frete,
  onEstadoChange,
  onVoltar,
}: EtapaPagamentoProps) {
  const [enviando, startEnvio] = useTransition();
  const formaSelecionada = formasPagamento.find(
    (f) => f.tipo === estado.formaPagamento,
  );
  const totalPreview = Math.max(0, subtotal - desconto) + frete;

  const router = useRouter();

  async function copiarChave(chave: string) {
    try {
      await navigator.clipboard.writeText(chave);
      toast.success("Chave copiada");
    } catch {
      toast.error("Não foi possível copiar a chave.");
    }
  }

  function enviar() {
    if (estado.formaPagamento == null) {
      toast.error("Escolha uma forma de pagamento.");
      return;
    }

    // Monta o payload do CLIENTE — só intenção, NUNCA valores monetários.
    const payload = {
      loja_id: lojaId,
      tipo_entrega: estado.tipoEntrega,
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

    // Gate de validação no cliente ANTES da Server Action (o servidor revalida).
    const parsed = schemaPayloadPedido.safeParse(payload);
    if (!parsed.success) {
      toast.error("Confira os dados do pedido (nome, endereço e itens).");
      return;
    }

    startEnvio(async () => {
      const resultado = await criarPedido(parsed.data);
      if ("erro" in resultado) {
        toast.error(resultado.erro);
        return;
      }
      router.push(
        `/loja/${lojaSlug}/confirmacao?pedido=${resultado.pedidoId}&token=${encodeURIComponent(
          resultado.token_acesso,
        )}`,
      );
    });
  }

  const podeEnviar =
    lojaAberta &&
    !enviando &&
    estado.nome.trim().length > 0 &&
    estado.formaPagamento != null &&
    itens.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-sm font-semibold text-foreground">Seus dados</h2>
          <div className="space-y-1">
            <Label htmlFor="nome-cliente">Nome</Label>
            <Input
              id="nome-cliente"
              value={estado.nome}
              autoComplete="name"
              placeholder="Seu nome"
              onChange={(e) => onEstadoChange({ nome: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="telefone-cliente">WhatsApp / Telefone</Label>
            <IMaskInput
              id="telefone-cliente"
              mask="(00) 00000-0000"
              value={estado.telefone}
              onAccept={(value: string) => onEstadoChange({ telefone: value })}
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 99999-9999"
              className="h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="observacoes">Observações (opcional)</Label>
            <Textarea
              id="observacoes"
              value={estado.observacoes}
              placeholder="Ex.: sem cebola, ponto da carne…"
              maxLength={500}
              onChange={(e) => onEstadoChange({ observacoes: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-sm font-semibold text-foreground">
            Forma de pagamento
          </h2>
          {formasPagamento.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Esta loja ainda não configurou formas de pagamento.
            </p>
          )}
          <RadioGroup
            value={estado.formaPagamento ?? ""}
            onValueChange={(v) =>
              onEstadoChange({ formaPagamento: v as TipoPagamento })
            }
            className="gap-2"
          >
            {formasPagamento.map((f) => (
              <Label
                key={f.id}
                htmlFor={`pagamento-${f.id}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
              >
                <RadioGroupItem value={f.tipo} id={`pagamento-${f.id}`} />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {ROTULO_PAGAMENTO[f.tipo]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {SUBTITULO_PAGAMENTO[f.tipo]}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>

          {/* Instrução específica da forma selecionada */}
          {formaSelecionada?.tipo === "pix" && (
            <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
              {formaSelecionada.pixQrUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={formaSelecionada.pixQrUrl}
                  alt="QR Code do Pix"
                  width={180}
                  height={180}
                  className="mx-auto rounded-lg border bg-white p-1"
                />
              )}
              {formaSelecionada.chavePix && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Chave Pix</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-background px-2 py-1.5 text-sm">
                      {formaSelecionada.chavePix}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copiarChave(formaSelecionada.chavePix!)}
                    >
                      <Copy className="mr-1 size-3.5" aria-hidden />
                      Copiar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {(formaSelecionada?.tipo === "cartao" ||
            formaSelecionada?.tipo === "link") && (
            <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              Você receberá um link de pagamento por WhatsApp após a confirmação
              do pedido.
            </p>
          )}

          {formaSelecionada?.tipo === "dinheiro" && (
            <div className="space-y-1 rounded-lg border bg-muted/40 p-3">
              <Label htmlFor="troco-para" className="text-xs">
                Troco para (opcional)
              </Label>
              <Input
                id="troco-para"
                inputMode="decimal"
                placeholder="Ex.: 50,00"
                value={estado.trocoPara != null ? String(estado.trocoPara) : ""}
                onChange={(e) => {
                  const valor = Number(e.target.value.replace(",", "."));
                  onEstadoChange({
                    trocoPara:
                      Number.isFinite(valor) && valor > 0 ? valor : null,
                  });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Informe se precisa de troco. Valor apenas informativo ao lojista.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <ResumoValores
            subtotal={subtotal}
            desconto={desconto}
            frete={frete}
            total={totalPreview}
            mostrarFrete={estado.tipoEntrega === "entrega"}
          />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="flex-1"
          onClick={onVoltar}
          disabled={enviando}
        >
          Voltar
        </Button>
        <Button
          type="button"
          size="lg"
          className="flex-1"
          disabled={!podeEnviar}
          onClick={enviar}
        >
          {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
          {lojaAberta ? "Confirmar pedido" : "Loja fechada"}
        </Button>
      </div>
    </div>
  );
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
