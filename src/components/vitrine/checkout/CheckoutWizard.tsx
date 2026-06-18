"use client";

// Container do wizard de checkout (issues 076/077/078).
//
// Orquestra as 3 etapas (Itens → Entrega → Pagamento), o estado do wizard
// (sessionStorage, mesmo padrão de useCarrinho) e os valores de PREVIEW.
//
// CRÍTICO (seguranca.md §10): nenhum valor monetário é enviado ao servidor. O
// preview (subtotal/desconto/frete/total) é só UX; criarPedido (071) recalcula
// tudo do banco. Carrinho vazio → redireciona para a loja.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

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
  const patch = useCallback((p: Partial<EstadoWizard>) => {
    setEstado((atual) => ({ ...atual, ...p }));
  }, []);

  // Handlers estáveis: FormEndereco/EtapaEntrega têm essas props no dep array de
  // um useEffect — ref nova a cada render dispararia loop de render infinito.
  const handleTipoEntregaChange = useCallback(
    (tipo: TipoEntrega) => patch({ tipoEntrega: tipo }),
    [patch],
  );
  const handleEnderecoChange = useCallback(
    (endereco: EnderecoEntrega | null) => patch({ endereco }),
    [patch],
  );

  // Voltar do header: etapa 1 → loja; etapas 2/3 → etapa anterior.
  const voltarHeader = useCallback(() => {
    if (etapa === 1) {
      router.push(`/loja/${lojaSlug}`);
    } else {
      setEtapa((e) => (e === 3 ? 2 : 1));
    }
  }, [etapa, lojaSlug, router]);

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
    <div className="mx-auto w-full max-w-[480px] bg-[var(--cor-fundo)] pb-8">
      {/* Banda do header — cor da loja, sticky (canônico .header) */}
      <header className="sticky top-0 z-50 flex items-center gap-3 bg-[var(--cor-primaria)] px-4 py-3.5 text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
        <button
          type="button"
          onClick={voltarHeader}
          aria-label={etapa === 1 ? "Voltar à loja" : "Voltar à etapa anterior"}
          className="flex size-11 shrink-0 items-center justify-center rounded-[10px] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <span className="text-base font-black uppercase tracking-wide">
          Finalizar pedido
        </span>
      </header>

      {/* Stepper — fundo branco (canônico .stepper) */}
      <nav
        className="border-b border-cinza-medio bg-white px-4 py-3"
        aria-label="Etapas do pedido"
      >
        <IndicadorEtapas etapaAtual={etapa} />
      </nav>

      <div className="px-4 py-4">
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
          onTipoEntregaChange={handleTipoEntregaChange}
          onEnderecoChange={handleEnderecoChange}
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
      </div>
    </div>
  );
}
