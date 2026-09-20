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
import Link from "next/link";
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
import { ModalRevisaoPreco } from "./ModalRevisaoPreco";
import { useEnviarPedido } from "./useEnviarPedido";
import { detectarMudancasDePreco } from "./mudancasDePreco";
import { useRevisaoCarrinho } from "@/hooks/useRevisaoCarrinho";
import { textosRevisao } from "@/lib/utils/copiaRevisaoPreco";
import type {
  EstadoCupom,
  ResultadoRevisarCarrinho,
} from "@/lib/actions/revisarCarrinho-contrato";
import {
  ESTADO_INICIAL,
  itemCarrinhoParaPayload,
  lerEstadoWizard,
  podeConfirmar,
  salvarEstadoWizard,
  totalPreviewEstimado,
  type EstadoRevisao,
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
  /**
   * [126] Derivada no SSR: loja com `whatsapp_envio_automatico = true` E número
   * de WhatsApp preenchido. Pré-abre a aba no clique de confirmar (RN-A5).
   */
  preAbrirWhatsapp?: boolean;
  /**
   * [180-B] WhatsApp PÚBLICO da loja (já exposto na vitrine). INDEPENDENTE de
   * `whatsapp_envio_automatico`: aqui a decisão depende só de TER canal para
   * combinar a entrega. `null` ⇒ o modal de frete indisponível oferece retirada.
   */
  whatsappLoja?: string | null;
  /**
   * [197] Endereço curto da loja (`{rua}, {numero} · {bairro}`), derivado no
   * SSR. Exibido só no ramo "retirada" (RN-R3). `null` ⇒ a loja não cadastrou
   * endereço e a tela mostra o fallback (RN-R5) — nunca bloqueia o checkout.
   */
  enderecoLoja?: string | null;
};

/** Alvo de toque do controle de voltar do header, compartilhado entre o
 *  <Link> da etapa 1 e o <button> das etapas 2/3. */
const CLASSES_VOLTAR_HEADER =
  "flex size-11 shrink-0 items-center justify-center rounded-[10px] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70";

export function CheckoutWizard({
  lojaId,
  lojaSlug,
  lojaNome,
  lojaAberta,
  aceitaEntrega,
  formasPagamento,
  preAbrirWhatsapp = false,
  whatsappLoja = null,
  enderecoLoja = null,
}: CheckoutWizardProps) {
  const { itens, incrementar, decrementar, remover } = useCarrinho();
  // Tailwind md = 768px. Escolhe UMA árvore (wizard mobile vs 2 colunas desktop)
  // — mesmo estado compartilhado, sem montar EtapaEntrega/frete duas vezes (006).
  const ehDesktop = useMediaQuery("(min-width: 768px)");

  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [etapa]);
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

  // Itens no shape do payload (produtoId+quantidade+opcionais+observacao) —
  // reusado pela EtapaPagamento e pelo CTA da coluna sticky desktop. NUNCA
  // carrega preço. O mapeamento vive em `itemCarrinhoParaPayload` (estado.ts,
  // issue 168) para ser testável: aqui só se aplica a função.
  const itensPayload = useMemo<ItemPayload[]>(
    () => itens.map(itemCarrinhoParaPayload),
    [itens],
  );

  // Patch parcial do estado do wizard.
  const patch = useCallback((p: Partial<EstadoWizard>) => {
    setEstado((atual) => ({ ...atual, ...p }));
  }, []);

  // ─────────────── [237/238] Revisão do carrinho, no servidor ────────────────
  // Fonte ÚNICA dos números derivados do banco (RN-11 / D5-b): subtotal,
  // economia de produto, estado A/B/C do cupom e os preços por linha que
  // detectam o que mudou entre o carrinho e o envio (RN-12, camada 1).
  // Nenhum deles é calculado aqui.
  const { revisao, revisar } = useRevisaoCarrinho({
    lojaId,
    itens,
    codigoCupom: estado.codigoCupom,
    ativo: montado && itens.length > 0,
  });

  // O estado do cupom chega DECIDIDO: o wizard só lê (M4).
  const estadoCupom: EstadoCupom | null =
    revisao?.cupom != null && revisao.cupom.valido
      ? revisao.cupom.estadoCupom
      : null;
  // Um único número de desconto, lido do estado do servidor — não há cópia
  // local a divergir.
  const descontoPreview =
    estadoCupom == null || estadoCupom.estado === "zero"
      ? 0
      : estadoCupom.desconto;
  const economiaProdutos = revisao?.economiaProdutos ?? null;

  // Comparação de EXIBIÇÃO (238): os dois lados são números do servidor — o
  // preço efetivo que a vitrine gravou no carrinho e o do banco agora.
  const mudancas = useMemo(
    () =>
      revisao
        ? detectarMudancasDePreco(
            itens.map((i) => ({ nome: i.nome, precoExibido: i.preco })),
            revisao.itens,
          )
        : { subiram: [], cairam: [] },
    [itens, revisao],
  );

  const [revisaoPendente, setRevisaoPendente] = useState(false);
  const [revisaoConfirmada, setRevisaoConfirmada] = useState(false);
  // Efêmero de propósito: nunca vai para o sessionStorage (um segundo clique
  // restaurado depois de um refresh seria um clique que ninguém deu).
  const revisaoDoGate: EstadoRevisao = {
    pendente: revisaoPendente,
    confirmada: revisaoConfirmada,
  };

  // [238/D11] O servidor recusou com `revisao_necessaria`: busca os preços do
  // banco AGORA e abre o diálogo com o de/para. Nunca repete o envio.
  const aoRevisaoNecessaria = useCallback(() => {
    setRevisaoConfirmada(false);
    void revisar(estado.codigoCupom).finally(() => setRevisaoPendente(true));
  }, [revisar, estado.codigoCupom]);

  // Submit do CTA da coluna sticky desktop — mesma fonte única do mobile (006).
  const { enviar, enviando } = useEnviarPedido({
    lojaId,
    lojaSlug,
    itens: itensPayload,
    estado,
    onEstadoChange: patch,
    preAbrirWhatsapp,
    onRevisaoNecessaria: aoRevisaoNecessaria,
  });

  // Segundo clique EXPLÍCITO, sobre o número novo: o payload passa a afirmar
  // `promocaoExibida: false` em toda linha, que é o que destrava a trava de
  // RN-12-a no servidor.
  const confirmarRevisao = useCallback(() => {
    setRevisaoPendente(false);
    setRevisaoConfirmada(true);
    enviar({ revisaoConfirmada: true });
  }, [enviar]);

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

  // Voltar do header: etapa 1 vira <Link> (prefetch da vitrine — achado
  // acelerar 2026-09-16, F1); etapas 2/3 só recuam de etapa, sem navegar.
  const voltarEtapa = useCallback(() => {
    setEtapa((e) => (e === 3 ? 2 : 1));
  }, []);

  // Frete preview efetivo: retirada força 0 (servidor também — RN-C2).
  // [180-B] Quando o frete não pôde ser calculado, o resumo exibe RÓTULO em vez
  // de número — R$ 0,00 seria lido como frete grátis.
  const fretePreviewEfetivo =
    estado.tipoEntrega === "retirada" ? 0 : fretePreview;
  const freteResumo: number | "a_combinar" =
    estado.tipoEntrega !== "retirada" && freteStatusPreview === "a_combinar"
      ? "a_combinar"
      : fretePreviewEfetivo;
  const totalPreview = totalPreviewEstimado(
    subtotalPreview,
    descontoPreview,
    fretePreviewEfetivo,
  );
  // [238] O total com os preços do BANCO (revisão) — é o número do diálogo e
  // da faixa. Mesma fórmula de preview, nenhuma aritmética nova.
  const novoTotalEstimado = totalPreviewEstimado(
    revisao?.subtotal ?? subtotalPreview,
    descontoPreview,
    fretePreviewEfetivo,
  );
  // [238/D11 "preço caiu"] Faixa persistente, sem botão e sem bloqueio.
  const avisoPrecoCaiu =
    mudancas.cairam.length > 0
      ? textosRevisao({
          direcao: "caiu",
          itens: mudancas.cairam,
          novoTotal: novoTotalEstimado,
        })
      : null;

  // Revisa o carrinho com o código digitado — a chamada da Server Action mora
  // AQUI, uma vez, para as duas árvores.
  const validarCupom = useCallback(
    (codigo: string): Promise<ResultadoRevisarCarrinho> => revisar(codigo),
    [revisar],
  );

  // Handlers de cupom (compartilhados entre as duas árvores). O DESCONTO não
  // é guardado: ele é lido do `estadoCupom` que o servidor devolveu — um único
  // número, uma única fonte (D5-b).
  const aplicarCupom = useCallback(
    (estadoDoCupom: EstadoCupom) => {
      patch({ codigoCupom: estadoDoCupom.codigo });
    },
    [patch],
  );
  const removerCupom = useCallback(() => {
    patch({ codigoCupom: null });
  }, [patch]);

  // Carrinho vazio → manda de volta para a loja (UX).
  if (montado && itens.length === 0) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-foreground">{lojaNome}</h1>
        <p className="mt-4 text-muted-foreground">Seu carrinho está vazio.</p>
        <Button
          className="mt-6"
          nativeButton={false}
          render={
            <Link href={`/loja/${lojaSlug}`} prefetch>
              Voltar ao cardápio
            </Link>
          }
        />
      </main>
    );
  }

  // Wizard mobile (< md): sequencial, uma etapa por vez. Inalterado.
  const wizardMobile = (
    <div className="px-4 py-4">
      {etapa === 1 && (
        <EtapaItens
          itens={itens}
          subtotal={subtotalPreview}
          desconto={descontoPreview}
          codigoCupom={estado.codigoCupom}
          cupom={estadoCupom}
          economiaProdutos={economiaProdutos}
          onIncrementar={incrementar}
          onDecrementar={decrementar}
          onRemover={remover}
          onValidarCupom={validarCupom}
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
          cupom={estadoCupom}
          economiaProdutos={economiaProdutos}
          aceitaEntrega={aceitaEntrega}
          tipoEntrega={estado.tipoEntrega}
          endereco={estado.endereco}
          onTipoEntregaChange={handleTipoEntregaChange}
          onEnderecoChange={handleEnderecoChange}
          onFreteChange={setFretePreview}
          onFreteStatusChange={setFreteStatusPreview}
          whatsappLoja={whatsappLoja}
          enderecoLoja={enderecoLoja}
          lojaNome={lojaNome}
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
          cupom={estadoCupom}
          economiaProdutos={economiaProdutos}
          freteStatus={freteStatusPreview}
          revisao={revisaoDoGate}
          onRevisaoNecessaria={aoRevisaoNecessaria}
          frete={fretePreviewEfetivo}
          onEstadoChange={patch}
          onVoltar={() => setEtapa(2)}
          preAbrirWhatsapp={preAbrirWhatsapp}
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
    podeConfirmar(
      estado,
      estado.tipoEntrega,
      freteStatusPreview,
      revisaoDoGate,
    );

  const layoutDesktop = (
    <div className="mx-auto w-full max-w-6xl px-4 py-5">
      <div className="grid gap-6 md:grid-cols-[1fr_360px] lg:grid-cols-[1fr_400px] md:items-start">
        {/* Coluna esquerda — 3 seções empilhadas, todas visíveis. */}
        <div className="flex min-w-0 flex-col gap-4">
          <EtapaItens
            variante="desktop"
            itens={itens}
            subtotal={subtotalPreview}
            desconto={descontoPreview}
            codigoCupom={estado.codigoCupom}
            cupom={estadoCupom}
            economiaProdutos={economiaProdutos}
            onIncrementar={incrementar}
            onDecrementar={decrementar}
            onRemover={remover}
            onValidarCupom={validarCupom}
            onAplicarCupom={aplicarCupom}
            onRemoverCupom={removerCupom}
            onContinuar={() => {}}
          />
          <EtapaEntrega
            variante="desktop"
            lojaId={lojaId}
            subtotal={subtotalPreview}
            desconto={descontoPreview}
            cupom={estadoCupom}
            economiaProdutos={economiaProdutos}
            aceitaEntrega={aceitaEntrega}
            tipoEntrega={estado.tipoEntrega}
            endereco={estado.endereco}
            onTipoEntregaChange={handleTipoEntregaChange}
            onEnderecoChange={handleEnderecoChange}
            onFreteChange={setFretePreview}
            onFreteStatusChange={setFreteStatusPreview}
            whatsappLoja={whatsappLoja}
            enderecoLoja={enderecoLoja}
            lojaNome={lojaNome}
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
            cupom={estadoCupom}
            economiaProdutos={economiaProdutos}
            freteStatus={freteStatusPreview}
            revisao={revisaoDoGate}
            onRevisaoNecessaria={aoRevisaoNecessaria}
            frete={fretePreviewEfetivo}
            onEstadoChange={patch}
            onVoltar={() => {}}
            preAbrirWhatsapp={preAbrirWhatsapp}
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
                cupom={estadoCupom}
                economiaProdutos={economiaProdutos}
                avisoPrecoCaiu={avisoPrecoCaiu}
                frete={freteResumo}
                total={totalPreview}
                mostrarFrete={estado.tipoEntrega === "entrega"}
              />
              {/* [238/M9 trava 1] Reconfirmação aberta ⇒ o CTA SAI DO DOM. */}
              {!revisaoPendente && (
                <Button
                  type="button"
                  size="lg"
                  className="mt-4 h-14 w-full rounded-xl bg-[var(--cor-destaque)] text-base font-black uppercase tracking-wide text-white shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:bg-[var(--cor-destaque)]/90"
                  disabled={!confirmarHabilitado}
                  onClick={() => enviar()}
                >
                  {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {lojaAberta ? "Confirmar pedido" : "Loja fechada"}
                </Button>
              )}
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
          {etapa === 1 ? (
            <Link
              href={`/loja/${lojaSlug}`}
              prefetch
              aria-label="Voltar à loja"
              className={CLASSES_VOLTAR_HEADER}
            >
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
          ) : (
            <button
              type="button"
              onClick={voltarEtapa}
              aria-label="Voltar à etapa anterior"
              className={CLASSES_VOLTAR_HEADER}
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
          )}
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

      {/* [238/D11] Uma única instância para as DUAS árvores: o segundo clique
          é o mesmo em mobile e desktop. */}
      <ModalRevisaoPreco
        aberto={revisaoPendente}
        itens={mudancas.subiram}
        novoTotal={novoTotalEstimado}
        enviando={enviando}
        onConfirmar={confirmarRevisao}
        onVoltar={() => setRevisaoPendente(false)}
      />
    </div>
  );
}
