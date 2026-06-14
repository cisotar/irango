"use client";

// Container do wizard de checkout (issues 076/077/078).
//
// Orquestra as 3 etapas (Itens → Entrega → Pagamento), o estado do wizard
// (sessionStorage, mesmo padrão de useCarrinho) e os valores de PREVIEW.
//
// CRÍTICO (seguranca.md §10): nenhum valor monetário é enviado ao servidor. O
// preview (subtotal/desconto/frete/total) é só UX; criarPedido (071) recalcula
// tudo do banco. Carrinho vazio → redireciona para a loja.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useCarrinho } from "@/hooks/useCarrinho";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";
import type { EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import { IndicadorEtapas } from "./IndicadorEtapas";
import { EtapaItens } from "./EtapaItens";
import { EtapaEntrega } from "./EtapaEntrega";
import { EtapaPagamento } from "./EtapaPagamento";
import {
  ESTADO_INICIAL,
  lerEstadoWizard,
  salvarEstadoWizard,
  type EstadoWizard,
  type FormaPagamentoWizard,
  type TipoEntrega,
} from "./estado";

export type CheckoutWizardProps = {
  lojaId: string;
  lojaSlug: string;
  lojaNome: string;
  lojaAberta: boolean;
  /** false se a loja não aceita entrega (sem zonas e sem fallback fora-de-zona). */
  aceitaEntrega: boolean;
  formasPagamento: FormaPagamentoWizard[];
};

export function CheckoutWizard({
  lojaId,
  lojaSlug,
  lojaNome,
  lojaAberta,
  aceitaEntrega,
  formasPagamento,
}: CheckoutWizardProps) {
  const router = useRouter();
  const { itens, incrementar, decrementar, remover } = useCarrinho();

  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [montado, setMontado] = useState(false);
  const [descontoPreview, setDescontoPreview] = useState(0);
  const [fretePreview, setFretePreview] = useState(0);

  // Estado do wizard hidratado do sessionStorage (pós-mount, SSR-safe).
  // Se a loja só aceita retirada, força tipoEntrega='retirada'.
  const [estado, setEstado] = useState<EstadoWizard>(ESTADO_INICIAL);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const salvo = lerEstadoWizard();
    const base: EstadoWizard = { ...ESTADO_INICIAL, ...(salvo ?? {}) };
    if (!aceitaEntrega) base.tipoEntrega = "retirada";
    setEstado(base);
    setMontado(true);
  }, [aceitaEntrega]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persiste o estado a cada mudança (após hidratar).
  useEffect(() => {
    if (montado) salvarEstadoWizard(estado);
  }, [estado, montado]);

  // Subtotal preview a partir dos itens do carrinho, incluindo opcionais (087).
  // Reusa calcularSubtotal (082). UX — servidor recalcula tudo do banco (§10).
  const subtotalPreview = useMemo(
    () =>
      calcularSubtotal(
        itens.map((i) => ({
          preco: i.preco,
          quantidade: i.quantidade,
          opcionais: i.opcionais?.map((o) => ({
            preco: o.preco,
            quantidade: o.quantidade,
          })),
        })),
      ),
    [itens],
  );

  // Patch parcial do estado do wizard.
  function patch(p: Partial<EstadoWizard>) {
    setEstado((atual) => ({ ...atual, ...p }));
  }

  // Carrinho vazio → manda de volta para a loja (UX).
  if (montado && itens.length === 0) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-foreground">{lojaNome}</h1>
        <p className="mt-4 text-muted-foreground">Seu carrinho está vazio.</p>
        <Button className="mt-6" onClick={() => router.push(`/loja/${lojaSlug}`)}>
          Voltar ao cardápio
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="mb-5">
        <h1 className="mb-4 text-center text-lg font-semibold text-foreground">
          Finalizar pedido
        </h1>
        <IndicadorEtapas etapaAtual={etapa} />
      </div>

      {etapa === 1 && (
        <EtapaItens
          lojaId={lojaId}
          itens={itens}
          subtotal={subtotalPreview}
          desconto={descontoPreview}
          codigoCupom={estado.codigoCupom}
          onIncrementar={incrementar}
          onDecrementar={decrementar}
          onRemover={remover}
          onAplicarCupom={(codigo, desconto) => {
            patch({ codigoCupom: codigo });
            setDescontoPreview(desconto);
          }}
          onRemoverCupom={() => {
            patch({ codigoCupom: null });
            setDescontoPreview(0);
          }}
          onContinuar={() => setEtapa(2)}
        />
      )}

      {etapa === 2 && (
        <EtapaEntrega
          lojaId={lojaId}
          subtotal={subtotalPreview}
          desconto={descontoPreview}
          aceitaEntrega={aceitaEntrega}
          tipoEntrega={estado.tipoEntrega}
          endereco={estado.endereco}
          onTipoEntregaChange={(tipo: TipoEntrega) => patch({ tipoEntrega: tipo })}
          onEnderecoChange={(endereco: EnderecoEntrega | null) =>
            patch({ endereco })
          }
          onFreteChange={setFretePreview}
          onVoltar={() => setEtapa(1)}
          onContinuar={() => setEtapa(3)}
        />
      )}

      {etapa === 3 && (
        <EtapaPagamento
          lojaId={lojaId}
          lojaSlug={lojaSlug}
          lojaAberta={lojaAberta}
          formasPagamento={formasPagamento}
          itens={itens.map((i) => ({
            produtoId: i.produtoId,
            quantidade: i.quantidade,
            ...(i.opcionais && i.opcionais.length > 0
              ? {
                  opcionais: i.opcionais.map((o) => ({
                    opcionalId: o.opcionalId,
                    quantidade: o.quantidade,
                  })),
                }
              : {}),
          }))}
          estado={estado}
          subtotal={subtotalPreview}
          desconto={descontoPreview}
          frete={estado.tipoEntrega === "retirada" ? 0 : fretePreview}
          onEstadoChange={patch}
          onVoltar={() => setEtapa(2)}
        />
      )}
    </main>
  );
}
