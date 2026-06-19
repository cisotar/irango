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
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCarrinho } from "@/hooks/useCarrinho";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";
import type { EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import { IndicadorEtapas } from "./IndicadorEtapas";
import { EtapaItens } from "./EtapaItens";
import { EtapaEntrega } from "./EtapaEntrega";
import { EtapaPagamento } from "./EtapaPagamento";
import { ResumoValores } from "./ResumoValores";
import { useEnviarPedido } from "./useEnviarPedido";
import {
  ESTADO_INICIAL,
  lerEstadoWizard,
  podeConfirmar,
  salvarEstadoWizard,
  type EstadoWizard,
  type FormaPagamentoWizard,
  type ItemPayload,
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
  // Tailwind md = 768px. Escolhe UMA árvore (wizard mobile vs 2 colunas desktop)
  // — mesmo estado compartilhado, sem montar EtapaEntrega/frete duas vezes (006).
  const ehDesktop = useMediaQuery("(min-width: 768px)");

  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [etapa]);
  const [descontoPreview, setDescontoPreview] = useState(0);
  const [fretePreview, setFretePreview] = useState(0);
  // Status do cálculo de frete (ocioso/calculando/ok/indisponivel/erro) — gate
  // podeConfirmar no desktop empilhado (006). No mobile o gate vive em cada etapa.
  const [freteStatusPreview, setFreteStatusPreview] = useState("ocioso");

  // Estado do wizard hidratado do sessionStorage (pós-mount, SSR-safe).
  // Se a loja só aceita retirada, força tipoEntrega='retirada'.
  const [estado, setEstado] = useState<EstadoWizard>(ESTADO_INICIAL);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const salvo = lerEstadoWizard();
    // Restaura nome/telefone/cupom/pagamento da sessão, mas tipo de entrega e
    // endereço sempre começam em branco — cliente escolhe ativamente a cada pedido.
    const base: EstadoWizard = {
      ...ESTADO_INICIAL,
      ...(salvo ?? {}),
      tipoEntrega: null,
      endereco: null,
    };
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

  // Itens no shape do payload (produtoId+quantidade+opcionais) — reusado pela
  // EtapaPagamento e pelo CTA da coluna sticky desktop. NUNCA carrega preço.
  const itensPayload = useMemo<ItemPayload[]>(
    () =>
      itens.map((i) => ({
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
      })),
    [itens],
  );

  // Patch parcial do estado do wizard.
  const patch = useCallback((p: Partial<EstadoWizard>) => {
    setEstado((atual) => ({ ...atual, ...p }));
  }, []);

  // Submit do CTA da coluna sticky desktop — mesma fonte única do mobile (006).
  const { enviar, enviando } = useEnviarPedido({
    lojaId,
    lojaSlug,
    itens: itensPayload,
    estado,
    onEstadoChange: patch,
  });

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

  // Frete preview efetivo: retirada força 0 (servidor também — RN-C2).
  const fretePreviewEfetivo =
    estado.tipoEntrega === "retirada" ? 0 : fretePreview;
  const totalPreview =
    Math.max(0, subtotalPreview - descontoPreview) + fretePreviewEfetivo;

  // Handlers de cupom (compartilhados entre as duas árvores).
  const aplicarCupom = useCallback(
    (codigo: string, desconto: number) => {
      patch({ codigoCupom: codigo });
      setDescontoPreview(desconto);
    },
    [patch],
  );
  const removerCupom = useCallback(() => {
    patch({ codigoCupom: null });
    setDescontoPreview(0);
  }, [patch]);

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

  // Wizard mobile (< md): sequencial, uma etapa por vez. Inalterado.
  const wizardMobile = (
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
          onAplicarCupom={aplicarCupom}
          onRemoverCupom={removerCupom}
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
          onFreteStatusChange={setFreteStatusPreview}
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
          itens={itensPayload}
          estado={estado}
          subtotal={subtotalPreview}
          desconto={descontoPreview}
          frete={fretePreviewEfetivo}
          onEstadoChange={patch}
          onVoltar={() => setEtapa(2)}
        />
      )}
    </div>
  );

  // Layout desktop (≥ md): 3 seções empilhadas à esquerda + resumo sticky à
  // direita. UM estado compartilhado; CTA gated por podeConfirmar (006).
  const confirmarHabilitado =
    lojaAberta &&
    !enviando &&
    estado.nome.trim().length > 0 &&
    itens.length > 0 &&
    podeConfirmar(estado, estado.tipoEntrega, freteStatusPreview);

  const layoutDesktop = (
    <div className="mx-auto w-full max-w-6xl px-4 py-5">
      <div className="grid gap-6 md:grid-cols-[1fr_360px] lg:grid-cols-[1fr_400px] md:items-start">
        {/* Coluna esquerda — 3 seções empilhadas, todas visíveis. */}
        <div className="flex min-w-0 flex-col gap-4">
          <EtapaItens
            variante="desktop"
            lojaId={lojaId}
            itens={itens}
            subtotal={subtotalPreview}
            desconto={descontoPreview}
            codigoCupom={estado.codigoCupom}
            onIncrementar={incrementar}
            onDecrementar={decrementar}
            onRemover={remover}
            onAplicarCupom={aplicarCupom}
            onRemoverCupom={removerCupom}
            onContinuar={() => {}}
          />
          <EtapaEntrega
            variante="desktop"
            lojaId={lojaId}
            subtotal={subtotalPreview}
            desconto={descontoPreview}
            aceitaEntrega={aceitaEntrega}
            tipoEntrega={estado.tipoEntrega}
            endereco={estado.endereco}
            onTipoEntregaChange={handleTipoEntregaChange}
            onEnderecoChange={handleEnderecoChange}
            onFreteChange={setFretePreview}
            onFreteStatusChange={setFreteStatusPreview}
            onVoltar={() => {}}
            onContinuar={() => {}}
          />
          <EtapaPagamento
            variante="desktop"
            lojaId={lojaId}
            lojaSlug={lojaSlug}
            lojaAberta={lojaAberta}
            formasPagamento={formasPagamento}
            itens={itensPayload}
            estado={estado}
            subtotal={subtotalPreview}
            desconto={descontoPreview}
            frete={fretePreviewEfetivo}
            onEstadoChange={patch}
            onVoltar={() => {}}
          />
        </div>

        {/* Coluna direita — resumo sticky + CTA (72px header + ~58px nav). */}
        <aside
          className="md:sticky md:top-[130px]"
          aria-label="Resumo do pedido"
        >
          <div className="overflow-hidden rounded-xl border border-cinza-medio bg-white shadow-[0_4px_12px_rgba(0,0,0,0.10)]">
            <h2 className="border-b border-cinza-medio bg-cinza-claro px-4 py-3.5 text-[0.78rem] font-bold uppercase tracking-[1px] text-texto-muted">
              Resumo do pedido
            </h2>
            <div className="p-4">
              <ResumoValores
                subtotal={subtotalPreview}
                desconto={descontoPreview}
                frete={fretePreviewEfetivo}
                total={totalPreview}
                mostrarFrete={estado.tipoEntrega === "entrega"}
              />
              <Button
                type="button"
                size="lg"
                className="mt-4 h-14 w-full rounded-xl bg-[var(--cor-destaque)] text-base font-black uppercase tracking-wide text-white shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:bg-[var(--cor-destaque)]/90"
                disabled={!confirmarHabilitado}
                onClick={enviar}
              >
                {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
                {lojaAberta ? "Confirmar pedido" : "Loja fechada"}
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );

  return (
    <div
      className={
        ehDesktop
          ? "w-full bg-[var(--cor-fundo)] pb-8"
          : "mx-auto w-full max-w-[480px] bg-[var(--cor-fundo)] pb-8"
      }
    >
      {/* Banda do header — cor da loja, sticky (canônico .header) */}
      <header className="sticky top-0 z-50 bg-[var(--cor-primaria)] text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3.5">
          <button
            type="button"
            onClick={voltarHeader}
            aria-label={
              etapa === 1 ? "Voltar à loja" : "Voltar à etapa anterior"
            }
            className="flex size-11 shrink-0 items-center justify-center rounded-[10px] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <span className="text-base font-black uppercase tracking-wide">
            Finalizar pedido
          </span>
        </div>
      </header>

      {/* Navegação do checkout — âncoras (desktop, atalho p/ seção empilhada)
          ou stepper sequencial (mobile). Mesmo componente, dois modos (007). */}
      <nav
        className={
          ehDesktop
            ? "sticky top-[72px] z-40 border-b border-cinza-medio bg-white"
            : "border-b border-cinza-medio bg-white px-4 py-3"
        }
        aria-label={ehDesktop ? "Seções do checkout" : "Etapas do pedido"}
      >
        <IndicadorEtapas
          modo={ehDesktop ? "ancoras" : "stepper"}
          etapaAtual={etapa}
        />
      </nav>

      {ehDesktop ? layoutDesktop : wizardMobile}
    </div>
  );
}
