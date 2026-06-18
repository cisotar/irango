"use client";

// Etapa 3 do wizard (issue 078): pagamento + dados do cliente + envio.
//
// CRÍTICO (seguranca.md §10): o payload enviado a criarPedido (071) NÃO carrega
// nenhum valor monetário — só intenção (itens com produto_id+quantidade, tipo de
// entrega, endereço se entrega, cupom, forma de pagamento, troco, identificação).
// O servidor recalcula subtotal/desconto/frete/total do banco. O payload é
// validado por schemaPayloadPedido (.strict()) ANTES do envio.

import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { IMaskInput } from "react-imask";
import { ResumoValores } from "./ResumoValores";
import { useEnviarPedido } from "./useEnviarPedido";
import {
  type EstadoWizard,
  type FormaPagamentoWizard,
  type TipoPagamento,
} from "./estado";

const SECAO =
  "overflow-hidden rounded-xl border border-cinza-medio bg-white shadow-[0_4px_12px_rgba(0,0,0,0.10)]";
const SECAO_TITULO =
  "border-b border-cinza-medio bg-cinza-claro px-4 py-3.5 text-[0.78rem] font-bold uppercase tracking-[1px] text-texto-muted";

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
  /**
   * "wizard" (mobile, padrão): mostra resumo + botões "Confirmar/Voltar".
   * "desktop": 3 seções empilhadas — resumo e CTA vivem na coluna sticky (006).
   */
  variante?: "wizard" | "desktop";
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
  variante = "wizard",
}: EtapaPagamentoProps) {
  const desktop = variante === "desktop";
  const formaSelecionada = formasPagamento.find(
    (f) => f.tipo === estado.formaPagamento,
  );
  const totalPreview = Math.max(0, subtotal - desconto) + frete;

  // Submit compartilhado (mobile + desktop) — fonte única do payload (006).
  const { enviar, enviando } = useEnviarPedido({
    lojaId,
    lojaSlug,
    itens,
    estado,
    onEstadoChange,
  });

  async function copiarChave(chave: string) {
    try {
      await navigator.clipboard.writeText(chave);
      toast.success("Chave copiada");
    } catch {
      toast.error("Não foi possível copiar a chave.");
    }
  }

  const podeEnviar =
    lojaAberta &&
    !enviando &&
    estado.nome.trim().length > 0 &&
    estado.formaPagamento != null &&
    itens.length > 0;

  return (
    <section
      id="secao-pagamento"
      className="scroll-mt-[130px] space-y-3"
      aria-label="Pagamento"
    >
      {/* Seção: Dados do cliente */}
      <div className={SECAO}>
        <h2 className={SECAO_TITULO}>Seus dados</h2>
        <div className="space-y-3 p-4">
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
        </div>
      </div>

      {/* Seção: Forma de pagamento */}
      <div className={SECAO}>
        <h2 className={SECAO_TITULO}>Forma de pagamento</h2>
        <div className="space-y-3 p-4">
          {formasPagamento.length === 0 && (
            <p className="text-sm text-texto-muted">
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
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-cinza-medio p-3 has-[[data-checked]]:border-[var(--cor-destaque)] has-[[data-checked]]:bg-[var(--cor-destaque)]/5"
              >
                <RadioGroupItem value={f.tipo} id={`pagamento-${f.id}`} />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-texto">
                    {ROTULO_PAGAMENTO[f.tipo]}
                  </span>
                  <span className="block text-xs text-texto-muted">
                    {SUBTITULO_PAGAMENTO[f.tipo]}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>

          {/* Instrução específica da forma selecionada */}
          {formaSelecionada?.tipo === "pix" && (
            <div className="space-y-3 rounded-lg border border-cinza-medio bg-cinza-claro p-3">
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
                  <p className="text-xs text-texto-muted">Chave Pix</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-white px-2 py-1.5 text-sm">
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
            <p className="rounded-lg border border-cinza-medio bg-cinza-claro p-3 text-xs text-texto-muted">
              Você receberá um link de pagamento por WhatsApp após a confirmação
              do pedido.
            </p>
          )}

          {formaSelecionada?.tipo === "dinheiro" && (
            <div className="space-y-1 rounded-lg border border-cinza-medio bg-cinza-claro p-3">
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
              <p className="text-xs text-texto-muted">
                Informe se precisa de troco. Valor apenas informativo ao lojista.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Resumo + CTA só no wizard mobile — no desktop vivem na coluna sticky. */}
      {!desktop && (
        <>
          {/* Seção: Resumo do pedido */}
          <div className={SECAO}>
            <h2 className={SECAO_TITULO}>Resumo do pedido</h2>
            <div className="p-4">
              <ResumoValores
                subtotal={subtotal}
                desconto={desconto}
                frete={frete}
                total={totalPreview}
                mostrarFrete={estado.tipoEntrega === "entrega"}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <Button
              type="button"
              size="lg"
              className="h-14 w-full rounded-xl bg-[var(--cor-destaque)] text-base font-black uppercase tracking-wide text-white shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:bg-[var(--cor-destaque)]/90"
              disabled={!podeEnviar}
              onClick={enviar}
            >
              {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
              {lojaAberta ? "Confirmar pedido" : "Loja fechada"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 w-full rounded-xl border-cinza-medio font-bold text-texto-muted hover:border-[var(--cor-destaque)] hover:text-[var(--cor-destaque)]"
              onClick={onVoltar}
              disabled={enviando}
            >
              Voltar para entrega
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
