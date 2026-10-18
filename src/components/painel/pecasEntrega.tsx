"use client";

// Peças comuns dos editores de zona de entrega (issue 325): km
// (`TabelaFaixasEntrega`), CEP (`TabelaFaixasCep`) e bairros
// (`TabelaBairrosEntrega`). Extraídas de `TabelaFaixasEntrega.tsx` para os três
// editores não repetirem campo de moeda, indicador, diálogo de substituição,
// aviso de conflito e o fluxo de gravação (fila + confirmação).
//
// A lógica testável fica nos módulos puros (`gravacaoZonas.ts`,
// `formaFrete.ts`, `payloadZona.ts`); aqui só há React. Nenhum preço desta
// tela é cobrado: o frete do pedido é recalculado no servidor.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Info, Loader2 } from "lucide-react";
import { IMaskInput } from "react-imask";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { inputMascaraClassName } from "@/components/painel/estiloInputMascara";
import {
  criarFilaGravacao,
  enviarZonas,
  type EstadoGravacao,
} from "@/components/painel/gravacaoZonas";
import type { Montagem } from "@/components/painel/payloadZona";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import {
  ROTULO_FORMA_FRASE,
  precisaConfirmarSubstituicao,
  rotuloDoTipo,
  type FormaFrete,
  type FormaGravada,
} from "@/lib/utils/formaFrete";
import {
  MENSAGEM_CONFLITO_ZONAS,
  itensDasZonas,
  type DadosZonasSemVersao,
  type ResultadoZonas,
} from "@/lib/validacoes/entrega";

/** Alvo de toque literal (design-system §5): a base de fonte é 120%. */
export const ALVO = "min-h-[44px] min-w-[44px]";

/** Props que o `EntregasClient` passa aos três editores. */
export type PropsEditorZonas = {
  /** Zonas da carga SE a forma gravada é a deste editor (km: também "mista"); senão []. */
  zonasIniciais: ZonaVitrine[];
  formaGravada: FormaGravada;
  /** Zonas da carga enquanto nada foi gravado na sessão; [] depois (a lista ficou velha). */
  zonasParaConfirmacao: ZonaVitrine[];
  /** `gravador.salvar`: põe a versão otimista e chama a action injetada. */
  salvar: (dados: DadosZonasSemVersao) => Promise<ResultadoZonas>;
  /** Avisa o pai que esta forma passou a valer (itens = 0 ⇒ loja sem zonas). */
  aoGravar: (forma: FormaFrete, itens: number) => void;
  /** Conflito de versão: desliga edição e gravação até recarregar. */
  bloqueado: boolean;
  /** `lojas.taxa_entrega_fora_zona` — só para a copy do rodapé. */
  taxaForaZona: number | null;
};

/** Zonas gravadas hoje (aviso de legado e confirmação de substituição). */
export function ListaZonasAtuais({
  zonas,
  rotulo,
  className = "",
}: {
  zonas: ZonaVitrine[];
  rotulo: string;
  className?: string;
}) {
  return (
    <ul
      aria-label={rotulo}
      className={`divide-y divide-foreground/10 rounded-lg border ${className}`}
    >
      {zonas.map((z) => (
        <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="font-medium text-foreground">{z.nome}</span>
          <span className="text-xs text-muted-foreground">
            {rotuloDoTipo(z.tipo)}
            {z.ativo ? "" : " · desativada"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Campo de moeda da linha (C7 da 326): mesma máscara do frete combinado. */
export function CampoMoeda({
  id,
  valor,
  aoMudar,
  aoSair,
  rotuloAcessivel,
  descritoPor,
  invalido,
  desabilitado = false,
  className = "",
}: {
  id: string;
  valor: string;
  aoMudar: (valor: string) => void;
  aoSair: () => void;
  rotuloAcessivel: string;
  descritoPor?: string;
  invalido: boolean;
  desabilitado?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm text-muted-foreground">R$</span>
      <IMaskInput
        id={id}
        mask={Number}
        scale={2}
        padFractionalZeros
        normalizeZeros
        radix=","
        mapToRadix={["."]}
        thousandsSeparator="."
        min={0}
        unmask
        value={valor}
        onAccept={(v: string) => aoMudar(v)}
        onBlur={aoSair}
        inputMode="decimal"
        placeholder="0,00"
        disabled={desabilitado}
        aria-label={rotuloAcessivel}
        aria-describedby={descritoPor}
        aria-invalid={invalido || undefined}
        className={`${inputMascaraClassName} min-h-[44px] aria-invalid:border-destructive disabled:opacity-50`}
      />
    </div>
  );
}

/** "Salvando… / Salvo / Não salvo" do cabeçalho do Card. */
export function IndicadorGravacao({ estado }: { estado: EstadoGravacao }) {
  return (
    <p
      aria-live="polite"
      className="flex min-h-[44px] shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      {estado === "salvando" && (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Salvando…
        </>
      )}
      {estado === "salvo" && (
        <>
          <Check className="size-4 text-foreground" aria-hidden />
          Salvo
        </>
      )}
      {estado === "erro" && <span className="font-medium text-destructive">Não salvo</span>}
    </p>
  );
}

/**
 * Conflito de versão (328): outra aba ou outra pessoa gravou as zonas depois da
 * carga. Recarregar descarta o estado local, que é o que se quer —
 * `router.refresh()` preservaria o `useState` dos editores.
 */
export function AvisoConflitoZonas() {
  return (
    <div
      role="alert"
      className="mb-5 flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm md:flex-row md:items-center md:justify-between"
    >
      <p className="flex gap-2 text-foreground">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <span>{MENSAGEM_CONFLITO_ZONAS}</span>
      </p>
      <Button
        type="button"
        variant="outline"
        className={`${ALVO} w-full shrink-0 md:w-auto`}
        onClick={() => window.location.reload()}
      >
        Recarregar a página
      </Button>
    </div>
  );
}

/**
 * Faixa no topo do editor quando a vitrine cobra hoje por OUTRA forma: nada
 * muda até a primeira gravação aqui.
 */
export function FaixaTrocaDeForma({ forma, formaGravada }: { forma: FormaFrete; formaGravada: FormaGravada }) {
  if (formaGravada === "nenhuma" || formaGravada === forma) return null;
  const hoje = formaGravada === "mista" ? "zonas de tipos diferentes" : ROTULO_FORMA_FRASE[formaGravada];
  return (
    <div role="note" className="mb-4 flex items-start gap-3 rounded-lg border bg-muted/50 p-4 text-sm">
      <Info className="mt-0.5 size-5 shrink-0 text-foreground" aria-hidden />
      <p className="text-muted-foreground">
        Preencha esta tela para trocar a forma de cobrança. Hoje a vitrine cobra por{" "}
        <strong className="font-medium text-foreground">{hoje}</strong>, e isso só muda quando você
        salvar aqui.
      </p>
    </div>
  );
}

/** Confirmação da 1ª gravação numa forma diferente da que vale hoje. */
function DialogoSubstituirZonas({
  aberto,
  forma,
  formaGravada,
  zonas,
  aoCancelar,
  aoConfirmar,
}: {
  aberto: boolean;
  forma: FormaFrete;
  formaGravada: FormaGravada;
  zonas: ZonaVitrine[];
  aoCancelar: () => void;
  aoConfirmar: () => void;
}) {
  const deHoje =
    formaGravada === "nenhuma" || formaGravada === "mista"
      ? "entrega cadastradas hoje"
      : ROTULO_FORMA_FRASE[formaGravada];
  return (
    <AlertDialog
      open={aberto}
      onOpenChange={(abrir) => {
        // Cancelar mantém as edições locais sem gravar; a próxima tentativa
        // pergunta de novo (D4 da 326).
        if (!abrir) aoCancelar();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Substituir as zonas atuais?</AlertDialogTitle>
          <AlertDialogDescription>
            As zonas de {deHoje} saem da loja e a vitrine passa a cobrar por{" "}
            {ROTULO_FORMA_FRASE[forma]}. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {zonas.length > 0 && (
          <ListaZonasAtuais
            zonas={zonas}
            rotulo="Zonas que serão substituídas"
            className="max-h-48 overflow-y-auto text-sm"
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className={ALVO}>Cancelar</AlertDialogCancel>
          <Button type="button" variant="destructive" className={ALVO} onClick={aoConfirmar}>
            Substituir e salvar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Foco no campo que o lojista precisa preencher em seguida, DEPOIS que a linha
 * ou o campo novo existe no DOM. `focar(id)` só é chamado em handler; o efeito
 * (sem deps: roda a cada commit) consome o pedido.
 */
export function useFocoPendente(): (id: string) => void {
  const alvo = useRef<string | null>(null);
  useEffect(() => {
    if (alvo.current == null) return;
    document.getElementById(alvo.current)?.focus();
    alvo.current = null;
  });
  return (id: string) => {
    alvo.current = id;
  };
}

/** Erro mostrado numa linha do editor (`indice` = linha/grupo). */
export type ErroLinha = { indice: number; mensagem: string };

/**
 * Fluxo de gravação de um editor: fila serializada, "não regravar o mesmo
 * payload", confirmação de substituição e bloqueio por conflito. A confirmação
 * vale só para a `formaGravada` que ela substituiu (`confirmadoPara`): gravar em
 * CEP, voltar ao km e editar pergunta de novo.
 *
 * `chaveInicial` (lazy, lida só na montagem) é o payload equivalente ao que foi
 * carregado (ou null), para o primeiro blur sem mudança não gravar nada.
 * `tentarGravar(montagem)` é a porta dos editores: montagem com erro marca a
 * linha (`erroLinha`) e "Não salvo"; montagem ok limpa o erro e grava.
 */
export function useGravacaoDoEditor<P extends DadosZonasSemVersao>({
  forma,
  formaGravada,
  kmForaDoFormato,
  zonasParaConfirmacao,
  salvar,
  aoGravar,
  bloqueado,
  chaveInicial,
}: {
  forma: FormaFrete;
  formaGravada: FormaGravada;
  kmForaDoFormato: boolean;
  zonasParaConfirmacao: ZonaVitrine[];
  salvar: PropsEditorZonas["salvar"];
  aoGravar: PropsEditorZonas["aoGravar"];
  bloqueado: boolean;
  chaveInicial: () => string | null;
}) {
  const [estadoGravacao, setEstadoGravacao] = useState<EstadoGravacao>("ocioso");
  const [jaGravou, setJaGravou] = useState(false);
  const [payloadPendente, setPayloadPendente] = useState<P | null>(null);
  const [erroLinha, setErroLinha] = useState<ErroLinha | null>(null);
  const [chaveDaCarga] = useState(chaveInicial);

  const confirmadoPara = useRef<FormaGravada | null>(null);
  const ultimaEnviada = useRef<string | null>(chaveDaCarga);

  const salvarRef = useRef(salvar);
  const aoGravarRef = useRef(aoGravar);
  useEffect(() => {
    salvarRef.current = salvar;
    aoGravarRef.current = aoGravar;
  }, [salvar, aoGravar]);

  // Criada na 1ª gravação (sempre num handler, nunca no render) e reusada: é
  // ela que serializa as gravações do editor.
  const filaRef = useRef<ReturnType<typeof criarFilaGravacao<P>> | null>(null);
  function fila() {
    filaRef.current ??= criarFilaGravacao<P>(async (payload) => {
      const r = await enviarZonas(payload, { salvar: (p) => salvarRef.current(p), toast });
      if (r.ok) {
        setJaGravou(true);
        aoGravarRef.current(forma, itensDasZonas(payload));
      } else if (ultimaEnviada.current === JSON.stringify(payload)) {
        // falhou: a próxima tentativa com o mesmo estado grava de novo
        ultimaEnviada.current = null;
      }
      return r.ok;
    }, setEstadoGravacao);
    return filaRef.current;
  }

  function enfileirar(payload: P) {
    ultimaEnviada.current = JSON.stringify(payload);
    void fila().gravar(payload);
  }

  /** Grava o payload já montado e válido (ou pede confirmação antes). */
  function gravar(payload: P) {
    if (bloqueado) {
      setEstadoGravacao("erro");
      return;
    }
    if (JSON.stringify(payload) === ultimaEnviada.current) return;
    if (
      precisaConfirmarSubstituicao(forma, formaGravada, kmForaDoFormato && !jaGravou) &&
      confirmadoPara.current !== formaGravada
    ) {
      setPayloadPendente(payload);
      return;
    }
    enfileirar(payload);
  }

  /** Montagem com erro marca a linha (ou dá toast se não há linha) e não grava. */
  function tentarGravar(montagem: Montagem<P>) {
    if (bloqueado) return;
    if (!montagem.ok) {
      setErroLinha(montagem.indice == null ? null : { indice: montagem.indice, mensagem: montagem.erro });
      setEstadoGravacao("erro");
      if (montagem.indice == null) toast.error(montagem.erro);
      return;
    }
    setErroLinha(null);
    gravar(montagem.payload);
  }

  function confirmar() {
    if (payloadPendente == null) return;
    confirmadoPara.current = formaGravada;
    enfileirar(payloadPendente);
    setPayloadPendente(null);
  }

  const dialogo = (
    <DialogoSubstituirZonas
      aberto={payloadPendente !== null}
      forma={forma}
      formaGravada={formaGravada}
      zonas={zonasParaConfirmacao}
      aoCancelar={() => setPayloadPendente(null)}
      aoConfirmar={confirmar}
    />
  );

  return { estadoGravacao, jaGravou, tentarGravar, erroLinha, setErroLinha, dialogo };
}
