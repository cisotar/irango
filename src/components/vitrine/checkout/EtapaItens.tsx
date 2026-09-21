"use client";

// Etapa 1 do wizard (issue 076): revisão dos itens + cupom.
//
// Itens vêm do useCarrinho (sessionStorage). Alterar quantidade reflete no
// preview imediatamente. O cupom é revisado por `revisarCarrinhoAction` (228),
// que recebe só ids + quantidades e devolve o desconto JÁ decidido do banco —
// o cliente não manda subtotal nenhum e não decide o desconto. Preview é UX; o
// servidor recalcula tudo de novo em `criarPedido` (071).

import { useState, useTransition } from "react";
import Image from "next/image";
import { Check, Loader2, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";
import { fraseCupom } from "@/lib/utils/copiaCupom";
import type {
  EstadoCupom,
  ResultadoRevisarCarrinho,
} from "@/lib/actions/revisarCarrinho-contrato";
import type { ItemCarrinho } from "@/types/dominio";
import { linhaCarrinhoId } from "@/hooks/useCarrinho";
import { rotuloNaoCompravel } from "@/components/vitrine/rotuloEsgotado";
import { ListaOpcionaisItem } from "@/components/vitrine/ListaOpcionaisItem";
import { ObservacaoItem } from "@/components/vitrine/ObservacaoItem";
import { ResumoValores } from "./ResumoValores";
import {
  anuncioItensBloqueados,
  SEM_BLOQUEIOS,
  type ItemBloqueado,
} from "./itensBloqueados";

const MENSAGEM_ERRO_CUPOM = "Não foi possível validar o cupom. Tente novamente.";

const SECAO =
  "overflow-hidden rounded-xl border border-cinza-medio bg-white shadow-[0_4px_12px_rgba(0,0,0,0.10)]";
const SECAO_TITULO =
  "border-b border-cinza-medio bg-cinza-claro px-4 py-3.5 text-[0.78rem] font-bold uppercase tracking-[1px] text-texto-muted";

export type EtapaItensProps = {
  itens: ItemCarrinho[];
  subtotal: number;
  desconto: number;
  codigoCupom: string | null;
  /** [237] Estado A/B/C do cupom, JÁ decidido no servidor. */
  cupom: EstadoCupom | null;
  /** [237] Economia de PRODUTO, pronta do servidor. `null` ⇒ linha some. */
  economiaProdutos: number | null;
  /**
   * [262] Linhas que a revisão do servidor devolveu NÃO compráveis (252), por
   * índice do carrinho. Vazio ⇒ a etapa renderiza exatamente como antes.
   * Nenhuma janela é avaliada aqui: o veredito e o motivo chegam prontos.
   */
  bloqueados?: readonly ItemBloqueado[];
  /** id = linhaCarrinhoId(produtoId, opcionais, observacao) — distingue linhas com opcionais OU observações diferentes (168). */
  onIncrementar: (linhaId: string) => void;
  onDecrementar: (linhaId: string) => void;
  /**
   * [262/design §13.7 item 3] A saída da linha BLOQUEADA, e a única: não há
   * "tentar de novo", porque não existe tentativa que mude o resultado. Na
   * linha comprável a remoção continua sendo decrementar até zero.
   */
  onRemover: (linhaId: string) => void;
  /**
   * [237] Revisa o carrinho com o código digitado. A chamada mora no
   * CheckoutWizard (fonte única da revisão) — aqui só se lê o veredito.
   */
  onValidarCupom: (codigo: string) => Promise<ResultadoRevisarCarrinho>;
  /** Aplica o cupom: o estado inteiro, como o servidor o devolveu. */
  onAplicarCupom: (estado: EstadoCupom) => void;
  onRemoverCupom: () => void;
  onContinuar: () => void;
  /**
   * "wizard" (mobile, padrão): mostra resumo + botão "Continuar".
   * "desktop": 3 seções empilhadas — resumo e CTA vivem na coluna sticky (006).
   */
  variante?: "wizard" | "desktop";
};

export function EtapaItens({
  itens,
  subtotal,
  desconto,
  codigoCupom,
  cupom,
  economiaProdutos,
  bloqueados = SEM_BLOQUEIOS,
  onIncrementar,
  onDecrementar,
  onRemover,
  onValidarCupom,
  onAplicarCupom,
  onRemoverCupom,
  onContinuar,
  variante = "wizard",
}: EtapaItensProps) {
  const [codigo, setCodigo] = useState(codigoCupom ?? "");
  const [mensagemCupom, setMensagemCupom] = useState<string | null>(null);
  const [cupomValido, setCupomValido] = useState(codigoCupom != null);
  const [validando, startValidacao] = useTransition();

  const totalPreview = Math.max(0, subtotal - desconto);
  // Mapa índice → bloqueio. O pareamento por índice é de `detectarItensBloqueados`
  // (módulo puro): aqui só se lê.
  const bloqueioPorIndice = new Map(bloqueados.map((b) => [b.indice, b]));

  function aplicarCupom() {
    const cod = codigo.trim();
    if (cod.length === 0) {
      setMensagemCupom("Digite um código de cupom.");
      setCupomValido(false);
      return;
    }
    startValidacao(async () => {
      // Só ids e quantidades atravessam a fronteira (seguranca.md §10): o preço
      // de cada linha vem do banco, dentro da action.
      const r = await onValidarCupom(cod);

      if (!r.ok || r.cupom == null) {
        setMensagemCupom(r.ok ? MENSAGEM_ERRO_CUPOM : r.mensagem);
        setCupomValido(false);
        onRemoverCupom();
        return;
      }
      if (!r.cupom.valido) {
        setMensagemCupom(r.cupom.mensagem);
        setCupomValido(false);
        onRemoverCupom();
        return;
      }

      // Os três estados chegam DECIDIDOS do servidor: aqui só se ramifica.
      const estado = r.cupom.estadoCupom;
      setMensagemCupom(
        estado.estado === "zero"
          ? // Estado C: a redação literal de RN-10-e, do módulo puro. Nunca
            // "Desconto de R$ 0,00" — o número sequer existe na união.
            (fraseCupom(estado) ?? "")
          : `Cupom aplicado! Desconto de ${formatarMoeda(estado.desconto)} no subtotal.`,
      );
      setCupomValido(true);
      onAplicarCupom(estado);
    });
  }

  function removerCupom() {
    setCodigo("");
    setMensagemCupom(null);
    setCupomValido(false);
    onRemoverCupom();
  }

  const desktop = variante === "desktop";

  return (
    <section
      id="secao-itens"
      className="scroll-mt-[130px] space-y-3"
      aria-label="Itens do pedido"
    >
      {/* Seção: Itens */}
      <div className={SECAO}>
        <h2 className={SECAO_TITULO}>Itens do pedido</h2>
        {/* [262/design §13.7 item 5] Anúncio UMA VEZ, no topo da etapa — em vez
            de cada linha gritar sozinha. `role="status"`, nunca `alert`: o
            produto saiu de temporada ou acabou, não é falha do cliente. */}
        {bloqueados.length > 0 && (
          <p
            role="status"
            aria-live="polite"
            className="border-b border-cinza-medio bg-cinza-claro px-4 py-3 text-xs text-texto-muted"
          >
            {anuncioItensBloqueados(bloqueados.length)}
          </p>
        )}
        <div className="divide-y divide-cinza-medio">
          {itens.map((item, indice) => {
            const bloqueio = bloqueioPorIndice.get(indice);
            const linhaId = linhaCarrinhoId(
              item.produtoId,
              item.opcionais,
              item.observacao,
            );
            // 2ª barreira anti-XSS (defesa em profundidade, seguranca.md §15):
            // só `https://` vira <Image src>; qualquer outra coisa → placeholder.
            const fotoItem = fotoSegura(item.fotoUrl);
            const opcionais =
              item.opcionais?.filter((o) => o.quantidade > 0) ?? [];
            // PREVIEW (seguranca.md §10): subtotal da linha COM opcionais via
            // calcularSubtotal (082). O servidor recalcula tudo do banco.
            const subtotalItem = calcularSubtotal([
              {
                preco: item.preco,
                quantidade: item.quantidade,
                opcionais: opcionais.map((o) => ({
                  preco: o.preco,
                  quantidade: o.quantidade,
                })),
              },
            ]);
            return (
              <div key={linhaId} className="px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="size-[52px] shrink-0 overflow-hidden rounded-[10px] bg-gradient-to-br from-[#e8dcc4] to-[#d8c4a0]">
                    {fotoItem ? (
                      <Image
                        src={fotoItem}
                        alt=""
                        width={52}
                        height={52}
                        className="size-full object-cover"
                      />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.88rem] font-bold text-texto">
                      {item.nome}
                    </p>
                    {bloqueio ? (
                      // Texto, não badge de erro: sem vermelho, sem ícone, sem
                      // `role="alert"` (design §13.7 item 2). O rótulo sai do
                      // MESMO módulo das quatro superfícies da vitrine — aqui
                      // sem "quando volta", porque o item de temporada
                      // encerrada não tem data a prometer (§13.7).
                      <p className="text-[0.75rem] text-texto-muted">
                        {rotuloNaoCompravel(bloqueio.motivo)}
                      </p>
                    ) : (
                      <p className="text-[0.75rem] text-texto-muted">
                        {formatarMoeda(item.preco)} / unidade
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {/* Linha bloqueada: o preço fica RISCADO e fora do subtotal
                        — que já vem do servidor sem ela (252). Nada é somado
                        nem subtraído deste lado. */}
                    {bloqueio ? (
                      <s
                        className="text-[0.92rem] font-black text-texto-muted"
                        aria-label={`Item indisponível, ${formatarMoeda(subtotalItem)} fora do total`}
                      >
                        {formatarMoeda(subtotalItem)}
                      </s>
                    ) : (
                      <span
                        className="text-[0.92rem] font-black text-[var(--cor-destaque)]"
                        aria-label={`Preço total deste item: ${formatarMoeda(subtotalItem)}`}
                      >
                        {formatarMoeda(subtotalItem)}
                      </span>
                    )}
                    {bloqueio ? (
                      <Button
                        type="button"
                        variant="outline"
                        // 44px LITERAL (design-system §5): a base de fonte do
                        // projeto é 120%, então `min-h-11` viraria 52,8px.
                        className="min-h-[44px] min-w-[44px] border-borda-nav bg-cinza-claro px-3 text-xs font-bold"
                        aria-label={`Remover ${item.nome} do carrinho`}
                        onClick={() => onRemover(linhaId)}
                      >
                        Remover
                      </Button>
                    ) : (
                      <div
                        className="flex items-center"
                        role="group"
                        aria-label={`Quantidade de ${item.nome}`}
                      >
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8 rounded-r-none border-borda-nav bg-cinza-claro text-destructive hover:border-[var(--cor-destaque)] hover:bg-cinza-medio"
                          aria-label={`Diminuir ${item.nome}`}
                          onClick={() => onDecrementar(linhaId)}
                        >
                          <Minus className="size-3.5" aria-hidden />
                        </Button>
                        <div
                          className="flex size-8 items-center justify-center border-y border-borda-nav bg-white text-sm font-bold tabular-nums"
                          aria-live="polite"
                          aria-atomic="true"
                        >
                          {item.quantidade}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8 rounded-l-none border-borda-nav bg-cinza-claro hover:border-[var(--cor-destaque)] hover:bg-cinza-medio"
                          aria-label={`Aumentar ${item.nome}`}
                          onClick={() => onIncrementar(linhaId)}
                        >
                          <Plus className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {opcionais.length > 0 && (
                  <div className="mt-2.5 rounded-lg bg-cinza-claro px-3 py-2">
                    <ListaOpcionaisItem
                      opcionais={opcionais.map((o) => ({
                        id: o.opcionalId,
                        nome: o.nome,
                        preco: o.preco,
                        quantidade: o.quantidade,
                      }))}
                    />
                  </div>
                )}

                {/* [197] Observação do comprador: fora do bloco de opcionais,
                    porque item sem opcional também pode ter observação. */}
                <ObservacaoItem
                  observacao={item.observacao}
                  className="mt-2.5"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Seção: Cupom */}
      <div className={SECAO}>
        <h2 className={SECAO_TITULO}>Cupom de desconto</h2>
        <div className="space-y-2 p-4">
          <div className="flex gap-2">
            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ex.: PROMO10"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Código do cupom"
              disabled={validando || cupomValido}
            />
            {cupomValido ? (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={removerCupom}
              >
                Remover
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={aplicarCupom}
                disabled={validando}
              >
                {validando && <Loader2 className="mr-1 size-4 animate-spin" />}
                Aplicar
              </Button>
            )}
          </div>
          {mensagemCupom != null &&
            (cupomValido ? (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 rounded-lg border border-green-300 bg-[#dcfce7] px-3 py-2.5 text-xs font-semibold text-[#166534]"
              >
                <Check className="size-4 shrink-0" aria-hidden />
                <span>{mensagemCupom}</span>
              </div>
            ) : (
              <p className="text-xs text-destructive" role="alert">
                {mensagemCupom}
              </p>
            ))}
        </div>
      </div>

      {/* Resumo + CTA só no wizard mobile — no desktop vivem na coluna sticky. */}
      {!desktop && (
        <>
          {/* Seção: Resumo */}
          <div className={SECAO}>
            <h2 className={SECAO_TITULO}>Resumo</h2>
            <div className="p-4">
              <ResumoValores
                subtotal={subtotal}
                cupom={cupom}
                economiaProdutos={economiaProdutos}
                frete={0}
                total={totalPreview}
                mostrarFrete={false}
              />
            </div>
          </div>

          <Button
            type="button"
            size="lg"
            className="h-14 w-full rounded-xl bg-[var(--cor-destaque)] text-base font-black uppercase tracking-wide text-white shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:bg-[var(--cor-destaque)]/90"
            // [262] Item bloqueado trava o AVANÇO, não só o submit final: o
            // cliente não monta endereço e pagamento para ser recusado no fim.
            disabled={itens.length === 0 || bloqueados.length > 0}
            onClick={onContinuar}
          >
            Continuar
          </Button>
        </>
      )}
    </section>
  );
}
