"use client";

// Etapa 2 do wizard (issue 077): tipo de entrega + endereço + frete preview.
//
// Retirada → oculta endereço, frete preview = 0, avança direto.
// Entrega → FormEndereco (CEP + ViaCEP) e, ao ter bairro, calcularFreteAction
// (072) para estimar o frete. Fora de área → bloqueia o avanço.
//
// CRÍTICO (seguranca.md §10): o frete exibido é PREVIEW. O servidor (071)
// recalcula do banco e, em retirada, FORÇA frete 0 ignorando endereço (RN-C2).

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormEndereco, type EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import { calcularFreteAction } from "@/lib/actions/frete";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { ResumoValores } from "./ResumoValores";
import { VEREDITO_LOJA_SEM_COORDS } from "@/lib/utils/freteDegradado";
import { chaveFrete, type TipoEntrega } from "./estado";

const SECAO =
  "overflow-hidden rounded-xl border border-cinza-medio bg-white shadow-[0_4px_12px_rgba(0,0,0,0.10)]";
const SECAO_TITULO =
  "border-b border-cinza-medio bg-cinza-claro px-4 py-3.5 text-[0.78rem] font-bold uppercase tracking-[1px] text-texto-muted";

export type EtapaEntregaProps = {
  lojaId: string;
  subtotal: number;
  desconto: number;
  /** false se a loja não aceita entrega (sem zonas e sem fallback fora-de-zona). */
  aceitaEntrega: boolean;
  tipoEntrega: TipoEntrega;
  endereco: EnderecoEntrega | null;
  onTipoEntregaChange: (tipo: TipoEntrega) => void;
  onEnderecoChange: (endereco: EnderecoEntrega | null) => void;
  /** comunica o frete preview ao pai (para o resumo da Etapa 3). */
  onFreteChange: (frete: number) => void;
  /** comunica o status do cálculo de frete ao pai (gate podeConfirmar — 006). */
  onFreteStatusChange?: (status: string) => void;
  onVoltar: () => void;
  onContinuar: () => void;
  /**
   * "wizard" (mobile, padrão): mostra resumo + botões "Continuar/Voltar".
   * "desktop": 3 seções empilhadas — resumo e CTA vivem na coluna sticky (006).
   */
  variante?: "wizard" | "desktop";
};

type EstadoFrete =
  | { status: "ocioso" }
  | { status: "calculando" }
  | { status: "ok"; taxa: number; zonaNome: string }
  | { status: "indisponivel" }
  // (005) Loja mal configurada: tem zona por raio mas está sem coords no banco.
  // Nenhum endereço do cliente resolveria → mensagem distinta, sem "tente outro".
  | { status: "indisponivel_loja" }
  | { status: "erro"; mensagem: string };

export function EtapaEntrega({
  lojaId,
  subtotal,
  desconto,
  aceitaEntrega,
  tipoEntrega,
  endereco,
  onTipoEntregaChange,
  onEnderecoChange,
  onFreteChange,
  onFreteStatusChange,
  onVoltar,
  onContinuar,
  variante = "wizard",
}: EtapaEntregaProps) {
  const [frete, setFrete] = useState<EstadoFrete>({ status: "ocioso" });
  const [calculando, startCalculo] = useTransition();
  // (067) Dedupe por chave composta `cep|bairro`: o CEP reconcilia o bairro
  // canônico e casa zonas tipo='faixa_cep', então recalcular quando SÓ o CEP
  // muda (mesmo bairro autocompletado) é necessário p/ paridade com a cobrança.
  const ultimaChave = useRef<string | null>(null);

  const ehEntrega = tipoEntrega === "entrega";
  const tipoSelecionado = tipoEntrega !== null;

  // Calcula frete preview quando o bairro está disponível (entrega).
  // sessionStorage/Server Action só rodam no client — disparado por mudança de
  // endereço/tipo, não por render espúrio.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // (002) Gate único: só calcula quando o endereço que o cliente VÊ está
    // completo (chaveFrete != null). Retirada, sem endereço, ou endereço sem
    // bairro ⇒ ocioso, zero, e NENHUMA chamada/mensagem — sem bairro fantasma.
    const chave = chaveFrete(ehEntrega, endereco);
    if (chave === null) {
      ultimaChave.current = null;
      setFrete({ status: "ocioso" });
      onFreteChange(0);
      onFreteStatusChange?.("ocioso");
      return;
    }
    if (chave === ultimaChave.current) return;
    ultimaChave.current = chave;
    // chave != null garante bairro presente; o CEP é opcional (zonas faixa_cep).
    const bairro = endereco?.bairro?.trim() ?? "";
    const cep = endereco?.cep?.trim();

    startCalculo(async () => {
      setFrete({ status: "calculando" });
      onFreteStatusChange?.("calculando");
      // Passa o CEP p/ reconciliação CEP↔bairro (paridade 064/067). Server
      // recalcula do banco — nenhum valor monetário vem do cliente.
      const r = await calcularFreteAction({
        loja_id: lojaId,
        bairro,
        ...(cep ? { cep } : {}),
      });
      if (!r.ok) {
        setFrete({ status: "erro", mensagem: r.erro });
        onFreteChange(0);
        onFreteStatusChange?.("erro");
        return;
      }
      if (
        r.zona_nome === "indisponivel" ||
        r.zona_nome === VEREDITO_LOJA_SEM_COORDS
      ) {
        const status =
          r.zona_nome === VEREDITO_LOJA_SEM_COORDS
            ? "indisponivel_loja"
            : "indisponivel";
        setFrete({ status });
        onFreteChange(0);
        onFreteStatusChange?.(status);
        return;
      }
      const rotulo =
        r.zona_nome === "fora_zona" ? "fora da área de zonas" : r.zona_nome;
      setFrete({ status: "ok", taxa: r.taxa_preview, zonaNome: rotulo });
      onFreteChange(r.taxa_preview);
      onFreteStatusChange?.("ok");
    });
    // `endereco` inteiro nas deps: chaveFrete deriva tudo dele. Re-render com
    // mesmo cep|bairro é absorvido pelo dedupe (ultimaChave) antes de qualquer
    // setState — sem recálculo nem loop.
  }, [ehEntrega, endereco, lojaId, onFreteChange, onFreteStatusChange]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const fretePreview = frete.status === "ok" ? frete.taxa : 0;
  const totalPreview = Math.max(0, subtotal - desconto) + fretePreview;

  // Pode avançar: deve ter selecionado um tipo; retirada = ok; entrega exige endereço + frete.
  const podeAvancar = tipoSelecionado
    ? ehEntrega
      ? endereco !== null && frete.status === "ok" && !calculando
      : true
    : false;

  const desktop = variante === "desktop";

  return (
    <section
      id="secao-entrega"
      className="scroll-mt-[130px] space-y-3"
      aria-label="Entrega"
    >
      {/* Seção: Tipo de entrega */}
      <div className={SECAO}>
        <h2 className={SECAO_TITULO}>Tipo de entrega</h2>
        <div className="space-y-3 p-4">
          {!aceitaEntrega && (
            <p className="rounded-lg bg-cinza-claro px-3 py-2 text-xs text-texto-muted">
              Esta loja oferece apenas <strong>retirada no local</strong>.
            </p>
          )}

          <RadioGroup
            value={tipoEntrega ?? ""}
            onValueChange={(v) => onTipoEntregaChange(v as TipoEntrega)}
            className="gap-2"
          >
            {aceitaEntrega && (
              <Label
                htmlFor="tipo-entrega"
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-cinza-medio p-3 has-[[data-checked]]:border-[var(--cor-destaque)] has-[[data-checked]]:bg-[var(--cor-destaque)]/5"
              >
                <RadioGroupItem value="entrega" id="tipo-entrega" />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-texto">
                    Entrega
                  </span>
                  <span className="block text-xs text-texto-muted">
                    Receba no seu endereço
                  </span>
                </span>
              </Label>
            )}
            <Label
              htmlFor="tipo-retirada"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-cinza-medio p-3 has-[[data-checked]]:border-[var(--cor-destaque)] has-[[data-checked]]:bg-[var(--cor-destaque)]/5"
            >
              <RadioGroupItem value="retirada" id="tipo-retirada" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-texto">
                  Retirada no local
                </span>
                <span className="block text-xs text-texto-muted">
                  Sem custo de entrega
                </span>
              </span>
            </Label>
          </RadioGroup>
        </div>
      </div>

      {/* Seção: Endereço (só quando entrega) */}
      {ehEntrega && (
        <div className={SECAO}>
          <h2 className={SECAO_TITULO}>Endereço de entrega</h2>
          <div className="space-y-3 p-4">
            <FormEndereco
              enderecoInicial={endereco}
              onEnderecoChange={onEnderecoChange}
            />

            {frete.status === "calculando" && (
              <p className="flex items-center gap-2 text-xs text-texto-muted">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Calculando frete…
              </p>
            )}
            {frete.status === "ok" && (
              <p className="text-xs text-texto-muted">
                Frete estimado para <strong>{frete.zonaNome}</strong>:{" "}
                {formatarMoeda(frete.taxa)}
              </p>
            )}
            {frete.status === "indisponivel" && (
              <p className="text-xs text-destructive">
                Entrega indisponível para o seu bairro. Tente outro endereço ou
                escolha retirada.
              </p>
            )}
            {frete.status === "indisponivel_loja" && (
              <p className="text-xs text-destructive">
                Não foi possível calcular a entrega para esta loja no momento.
                Escolha retirada ou tente mais tarde.
              </p>
            )}
            {frete.status === "erro" && (
              <p className="text-xs text-destructive">{frete.mensagem}</p>
            )}
          </div>
        </div>
      )}

      {/* Resumo + CTA só no wizard mobile — no desktop vivem na coluna sticky. */}
      {!desktop && (
        <>
          {/* Seção: Resumo */}
          <div className={SECAO}>
            <h2 className={SECAO_TITULO}>Resumo</h2>
            <div className="p-4">
              <ResumoValores
                subtotal={subtotal}
                desconto={desconto}
                frete={fretePreview}
                total={totalPreview}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <Button
              type="button"
              size="lg"
              className="h-14 w-full rounded-xl bg-[var(--cor-destaque)] text-base font-black uppercase tracking-wide text-white shadow-[0_4px_16px_rgba(0,0,0,0.2)] hover:bg-[var(--cor-destaque)]/90"
              disabled={!podeAvancar}
              onClick={onContinuar}
            >
              Continuar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 w-full rounded-xl border-cinza-medio font-bold text-texto-muted hover:border-[var(--cor-destaque)] hover:text-[var(--cor-destaque)]"
              onClick={onVoltar}
            >
              Voltar para itens
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
