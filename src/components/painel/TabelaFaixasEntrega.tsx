"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Info, Loader2, Plus, Trash2 } from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { inputMascaraClassName } from "@/components/painel/estiloInputMascara";
import { paraNumero } from "@/components/painel/payloadZona";
import type { salvarFaixasEntrega as salvarFaixasLojista } from "@/lib/actions/entrega";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import {
  alertaDePreco,
  desligarAPartirDe,
  lerFaixas,
  ligarAte,
  limiteEntregaKm,
  removerAPartirDe,
  rotuloFaixa,
  textoLimiteEntrega,
  zonasJaSaoFaixas,
  type IncrementoFaixa,
} from "@/lib/utils/faixasEntrega";
import {
  MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA,
  TETO_FAIXAS_ENTREGA,
  schemaFaixasEntrega,
  type DadosFaixasEntrega,
} from "@/lib/validacoes/entrega";

export type TabelaFaixasEntregaProps = {
  /** Zonas GRAVADAS da loja: abrem como faixas via `lerFaixas` (D4/C4). */
  zonas: ZonaVitrine[];
  /** `lojas.taxa_entrega_fora_zona` — só para a copy do limite (D7). */
  taxaForaZona: number | null;
  /**
   * Action injetada (issue 160): a do lojista ou a admin escopada por `lojaId`.
   * Sem default — omitir quebra o build em vez de gravar na loja errada.
   */
  salvar: typeof salvarFaixasLojista;
};

/**
 * Faixa como a tela a edita. `taxa`/`gratis` são o valor SEM máscara do
 * `IMaskInput` ("8.5"; vazio = ""); `gratis === null` = sem frete grátis.
 */
export type FaixaEditavel = { taxa: string; gratis: string | null; ativo: boolean };

/** Alvo de toque literal (design-system §5): a base de fonte é 120%. */
const ALVO = "min-h-[44px] min-w-[44px]";

const ROTULO_TIPO: Record<string, string> = {
  bairro: "Por bairro",
  raio_km: "Por raio (km)",
  faixa_cep: "Por faixa de CEP",
};

const ERRO_GENERICO = "Não foi possível salvar as faixas de entrega. Tente de novo.";

/** Número do banco → valor sem máscara do input ("4.5"); `paraNumero` desfaz. */
function paraTexto(valor: number): string {
  return String(valor);
}

/** "0–1 km, 1–2 km e 2–3 km". */
function listarRotulos(rotulos: string[]): string {
  return new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(rotulos);
}

/** Zonas gravadas hoje (aviso de legado D4 e confirmação de substituição). */
function ListaZonasAtuais({
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
            {ROTULO_TIPO[z.tipo] ?? z.tipo}
            {z.ativo ? "" : " · desativada"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Campo de moeda da linha (C7): mesma máscara do frete combinado. */
function CampoMoeda({
  id,
  valor,
  aoMudar,
  aoSair,
  rotuloAcessivel,
  descritoPor,
  invalido,
  className = "",
}: {
  id: string;
  valor: string;
  aoMudar: (valor: string) => void;
  aoSair: () => void;
  rotuloAcessivel: string;
  descritoPor?: string;
  invalido: boolean;
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
        aria-label={rotuloAcessivel}
        aria-describedby={descritoPor}
        aria-invalid={invalido || undefined}
        className={`${inputMascaraClassName} min-h-[44px] aria-invalid:border-destructive`}
      />
    </div>
  );
}

type Montagem =
  | { ok: true; payload: DadosFaixasEntrega }
  | { ok: false; erro: string; indice: number | null };

/**
 * Estado da tela → payload de `salvarFaixasEntrega`. `schemaFaixasEntrega` aqui
 * é só gate de UX: a Server Action revalida e a RPC rederiva teto/nome/tipo.
 * Nunca devolve payload pela metade: a primeira faixa com preço (ou frete
 * grátis ligado) vazio ou inválido devolve o erro com o índice dela, para a
 * tela marcar a linha.
 */
export function montarPayload(incremento: IncrementoFaixa, faixas: FaixaEditavel[]): Montagem {
  const itens: DadosFaixasEntrega["faixas"] = [];
  for (const [i, f] of faixas.entries()) {
    const rotulo = rotuloFaixa(i, incremento);
    const taxa = paraNumero(f.taxa);
    if (taxa == null) return { ok: false, erro: `Informe o preço da faixa de ${rotulo}.`, indice: i };
    let gratis: number | null = null;
    if (f.gratis !== null) {
      gratis = paraNumero(f.gratis);
      if (gratis == null) {
        return {
          ok: false,
          erro: `Informe o valor do frete grátis da faixa de ${rotulo} ou desligue a opção.`,
          indice: i,
        };
      }
    }
    itens.push({ taxa, pedido_minimo_gratis: gratis, ativo: f.ativo });
  }

  const parsed = schemaFaixasEntrega.safeParse({ incremento, faixas: itens });
  if (parsed.success) return { ok: true, payload: parsed.data };

  const [, indice, campo] = parsed.error.issues[0]?.path ?? [];
  if (typeof indice === "number") {
    if (campo === "ativo") {
      return { ok: false, erro: MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA, indice };
    }
    const oQue = campo === "pedido_minimo_gratis" ? "o frete grátis" : "o preço";
    return {
      ok: false,
      erro: `Confira ${oQue} da faixa de ${rotuloFaixa(indice, incremento)}: use valor de R$ 0,00 para cima, com até 2 casas decimais.`,
      indice,
    };
  }
  return { ok: false, erro: "Confira as faixas de entrega.", indice: null };
}

/**
 * Dependências do envio (architecture.md §8): a Server Action e o toast
 * INJETADOS por parâmetro — nunca lidos do módulo direto — para a orquestração
 * ser testável em `environment: node`, sem jsdom.
 */
export type DepsEnvioFaixas = {
  salvar: typeof salvarFaixasLojista;
  toast: { error: (msg: string) => void };
};

/**
 * Chama a action. Erro dela (ou exceção de rede) vira `toast.error` com a
 * mensagem genérica; sucesso é silencioso — o indicador "Salvo" do card
 * informa, e a tela NÃO chama `router.refresh`: o estado local é a verdade da
 * tabela e o `revalidatePath` da action já atualiza a vitrine.
 */
export async function enviarFaixas(
  payload: DadosFaixasEntrega,
  { salvar, toast }: DepsEnvioFaixas,
): Promise<{ ok: true } | { ok: false }> {
  try {
    const resultado = await salvar(payload);
    if (!resultado.ok) {
      toast.error(resultado.erro);
      return { ok: false };
    }
    return { ok: true };
  } catch {
    toast.error(ERRO_GENERICO);
    return { ok: false };
  }
}

export type EstadoGravacao = "ocioso" | "salvando" | "salvo" | "erro";

/**
 * Fila de gravação SERIALIZADA (C6): uma gravação por vez. Pedido que chega
 * durante uma gravação só guarda o payload mais recente, gravado quando a atual
 * termina — os intermediários são descartados. `aoMudar` recebe "salvando" ao
 * começar e, quando a fila esvazia, "salvo"/"erro" conforme a ÚLTIMA gravação.
 * `gravar` devolve a promessa do esvaziamento da fila.
 */
export function criarFilaGravacao<P>(
  executar: (payload: P) => Promise<boolean>,
  aoMudar: (estado: EstadoGravacao) => void,
): { gravar: (payload: P) => Promise<void> } {
  let drenando: Promise<void> | null = null;
  let proximo: { payload: P } | null = null;

  async function drenar(primeiro: P): Promise<void> {
    aoMudar("salvando");
    let atual: { payload: P } | null = { payload: primeiro };
    let ok = false;
    while (atual !== null) {
      try {
        ok = await executar(atual.payload);
      } catch {
        ok = false;
      }
      atual = proximo;
      proximo = null;
    }
    drenando = null;
    aoMudar(ok ? "salvo" : "erro");
  }

  return {
    gravar(payload: P) {
      if (drenando !== null) {
        proximo = { payload };
        return drenando;
      }
      drenando = drenar(payload);
      return drenando;
    },
  };
}

/** Ação do switch "Ativa" ou da lixeira, com as faixas afetadas congeladas ao abrir o diálogo. */
type AcaoLinha = { tipo: "desligar" | "ligar" | "remover"; indice: number; rotulos: string[] };

/**
 * Tabela de faixas de entrega por km (issue 326). Client component.
 *
 * Abre as zonas gravadas com `lerFaixas` (nada é gravado ao abrir). Gravação
 * automática (C6), sem botão Salvar: ao sair do campo de preço ou de frete
 * grátis, ao desligar o frete grátis e logo depois de confirmar
 * ligar/desligar/remover faixa. Nunca grava com faixa incompleta: o erro
 * aparece na linha. O preço mostrado aqui é cosmético: o frete do pedido é
 * sempre recalculado no servidor.
 *
 * Switch "Ativa" e lixeira em todas as linhas (C2'/C3'): desligar/remover
 * atinge a faixa e todas as abaixo, ligar religa da primeira desligada até ela
 * — as ativas formam um prefixo, como exigem zod e RPC. O aviso de preço fora
 * de ordem (C1) compara só ativas e não bloqueia.
 */
export function TabelaFaixasEntrega({ zonas, taxaForaZona, salvar }: TabelaFaixasEntregaProps) {
  const idBase = useId();

  const leitura = useMemo(() => lerFaixas(zonas), [zonas]);
  const substituiZonas = useMemo(() => !zonasJaSaoFaixas(zonas), [zonas]);

  const [emLegado, setEmLegado] = useState(leitura.modo === "legado");
  const [incremento, setIncremento] = useState<IncrementoFaixa>(leitura.incremento);
  const [faixas, setFaixas] = useState<FaixaEditavel[]>(() =>
    leitura.faixas.map((f) => ({
      taxa: paraTexto(f.taxa),
      gratis: f.pedido_minimo_gratis == null ? null : paraTexto(f.pedido_minimo_gratis),
      ativo: f.ativo,
    })),
  );

  const [incrementoPendente, setIncrementoPendente] = useState<IncrementoFaixa | null>(null);
  const [acaoPendente, setAcaoPendente] = useState<AcaoLinha | null>(null);
  const [acaoAberta, setAcaoAberta] = useState(false);
  const [payloadPendente, setPayloadPendente] = useState<DadosFaixasEntrega | null>(null);
  const [erroLinha, setErroLinha] = useState<{ indice: number; mensagem: string } | null>(null);
  const [estadoGravacao, setEstadoGravacao] = useState<EstadoGravacao>("ocioso");
  const [jaGravou, setJaGravou] = useState(false);

  // D4: depois de confirmar a substituição uma vez, as gravações seguintes vão
  // direto. `ultimaEnviada` evita regravar o MESMO payload a cada blur.
  const substituicaoConfirmada = useRef(false);
  const ultimaEnviada = useRef<string | null>(
    leitura.modo === "faixas"
      ? JSON.stringify({ incremento: leitura.incremento, faixas: leitura.faixas })
      : null,
  );

  const salvarRef = useRef(salvar);
  useEffect(() => {
    salvarRef.current = salvar;
  }, [salvar]);

  // Criada na 1ª gravação (sempre num handler, nunca no render) e reusada:
  // é ela que serializa as gravações da tela inteira.
  const filaRef = useRef<ReturnType<typeof criarFilaGravacao<DadosFaixasEntrega>> | null>(null);
  function fila() {
    filaRef.current ??= criarFilaGravacao<DadosFaixasEntrega>(async (payload) => {
      const r = await enviarFaixas(payload, {
        salvar: (p) => salvarRef.current(p),
        toast,
      });
      if (r.ok) {
        setJaGravou(true);
      } else if (ultimaEnviada.current === JSON.stringify(payload)) {
        // falhou: a próxima tentativa com o mesmo estado grava de novo
        ultimaEnviada.current = null;
      }
      return r.ok;
    }, setEstadoGravacao);
    return filaRef.current;
  }

  // Foco vai para o campo que o lojista precisa preencher em seguida, depois
  // que a linha/campo novo existe no DOM.
  const focarRef = useRef<string | null>(null);
  useEffect(() => {
    if (focarRef.current == null) return;
    document.getElementById(focarRef.current)?.focus();
    focarRef.current = null;
  });

  const idPreco = (i: number) => `${idBase}-preco-${i}`;
  const idGratis = (i: number) => `${idBase}-gratis-${i}`;
  const idAlerta = (i: number) => `${idBase}-alerta-${i}`;
  const idErro = (i: number) => `${idBase}-erro-${i}`;

  // Linha sem preço digitado conta como 0: nunca vira "a mais cara" nem
  // dispara o aviso (o aviso só aparece na linha que já tem preço).
  const precos = faixas.map((f) => ({ taxa: paraNumero(f.taxa) ?? 0, ativo: f.ativo }));
  const limite = limiteEntregaKm(faixas, incremento);

  /** Tenta gravar o estado dado. Nunca grava faixa incompleta (erro na linha). */
  function tentarGravar(inc: IncrementoFaixa, estado: FaixaEditavel[]) {
    const montagem = montarPayload(inc, estado);
    if (!montagem.ok) {
      setErroLinha(montagem.indice == null ? null : { indice: montagem.indice, mensagem: montagem.erro });
      setEstadoGravacao("erro");
      if (montagem.indice == null) toast.error(montagem.erro);
      return;
    }
    setErroLinha(null);
    const chave = JSON.stringify(montagem.payload);
    if (chave === ultimaEnviada.current) return;
    if (substituiZonas && !substituicaoConfirmada.current) {
      setPayloadPendente(montagem.payload);
      return;
    }
    ultimaEnviada.current = chave;
    void fila().gravar(montagem.payload);
  }

  function confirmarSubstituicao() {
    if (payloadPendente == null) return;
    substituicaoConfirmada.current = true;
    ultimaEnviada.current = JSON.stringify(payloadPendente);
    void fila().gravar(payloadPendente);
    setPayloadPendente(null);
  }

  function trocarIncremento(valor: unknown) {
    const novo: IncrementoFaixa = valor === "2" ? 2 : 1;
    if (novo === incremento) return;
    if (faixas.length > 0) {
      setIncrementoPendente(novo);
      return;
    }
    setIncremento(novo);
  }

  function confirmarTrocaIncremento() {
    if (incrementoPendente == null) return;
    // D5: sem remapear preço — a tabela local recomeça vazia. Nada é gravado
    // até a primeira faixa nova ter preço (C6).
    setIncremento(incrementoPendente);
    setFaixas([]);
    setErroLinha(null);
    setIncrementoPendente(null);
  }

  function atualizar(i: number, parcial: Partial<FaixaEditavel>) {
    setFaixas((atual) => atual.map((f, j) => (j === i ? { ...f, ...parcial } : f)));
  }

  function alternarGratis(i: number, ligado: boolean) {
    const novas = faixas.map((f, j) => (j === i ? { ...f, gratis: ligado ? "" : null } : f));
    setFaixas(novas);
    if (ligado) {
      // grava no blur do valor, não agora (estaria vazio)
      focarRef.current = idGratis(i);
      return;
    }
    tentarGravar(incremento, novas);
  }

  function adicionar() {
    if (faixas.length >= TETO_FAIXAS_ENTREGA) return;
    // A faixa nova herda o estado da última: uma ativa depois de desligada
    // quebraria o prefixo. Grava no blur do preço (C6).
    const ativo = faixas.length === 0 || faixas[faixas.length - 1].ativo;
    setFaixas((atual) => [...atual, { taxa: "", gratis: null, ativo }]);
    focarRef.current = idPreco(faixas.length);
  }

  /** Abre a confirmação do switch/lixeira da faixa `indice` (C2'/C3'). */
  function abrirAcao(tipo: AcaoLinha["tipo"], indice: number) {
    const primeiraDesligada = faixas.findIndex((f) => !f.ativo);
    const rotulos = faixas
      .map((_, j) => rotuloFaixa(j, incremento))
      .filter((_, j) => (tipo === "ligar" ? j >= primeiraDesligada && j <= indice : j >= indice));
    setAcaoPendente({ tipo, indice, rotulos });
    setAcaoAberta(true);
  }

  function aplicarAcaoLinha() {
    if (acaoPendente == null || !acaoAberta) return;
    const { tipo, indice } = acaoPendente;
    const novas =
      tipo === "desligar"
        ? desligarAPartirDe(faixas, indice)
        : tipo === "ligar"
          ? ligarAte(faixas, indice)
          : removerAPartirDe(faixas, indice);
    setFaixas(novas);
    setAcaoAberta(false);
    tentarGravar(incremento, novas);
  }

  function comecarDoZero() {
    setEmLegado(false);
    setIncremento(1);
    setFaixas([]);
  }

  const rotulosAfetados = acaoPendente?.rotulos ?? [];

  return (
    <>
      <div
        role="note"
        className="mb-5 flex items-start gap-3 rounded-lg border bg-muted/50 p-4 text-sm"
      >
        <Info className="mt-0.5 size-5 shrink-0 text-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            Cobre sua área por distância, não por CEP ou bairro
          </p>
          <p className="text-muted-foreground">
            Com faixas de km você define{" "}
            <strong className="font-medium text-foreground">
              só até onde entrega e o preço de cada faixa
            </strong>{" "}
            — o sistema calcula a distância de cada pedido sozinho. Por CEP ou por bairro, cada
            CEP e cada bairro precisa ser cadastrado um por um, e o que ficar de fora vira pedido
            perdido.
          </p>
        </div>
      </div>

      {emLegado ? (
        <Card className="gap-0 py-0">
          <div className="space-y-3 p-4">
            <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Suas zonas de entrega foram cadastradas de um jeito que não vira tabela de faixas.
                Elas continuam valendo na vitrine até a primeira faixa da tabela nova ser gravada.
              </span>
            </p>
            <ListaZonasAtuais zonas={zonas} rotulo="Zonas de entrega atuais" />
            <Button type="button" variant="outline" className={`${ALVO} w-full md:w-auto`} onClick={comecarDoZero}>
              Começar a tabela do zero
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="font-heading text-base font-medium text-foreground">
                Faixas de distância
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Comece pela faixa mais perto da loja e vá somando até onde você entrega. Tudo é
                salvo sozinho ao sair de cada campo.
              </p>
            </div>
            <p
              aria-live="polite"
              className="flex min-h-[44px] shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
            >
              {estadoGravacao === "salvando" && (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Salvando…
                </>
              )}
              {estadoGravacao === "salvo" && (
                <>
                  <Check className="size-4 text-foreground" aria-hidden />
                  Salvo
                </>
              )}
              {estadoGravacao === "erro" && (
                <span className="font-medium text-destructive">Não salvo</span>
              )}
            </p>
          </div>

          <fieldset className="border-b px-4 py-3">
            <legend className="mb-2 text-sm font-medium text-foreground">
              Tamanho de cada faixa
            </legend>
            <RadioGroup
              value={String(incremento)}
              onValueChange={trocarIncremento}
              className="flex gap-2"
            >
              {([1, 2] as const).map((valor) => (
                <Label
                  key={valor}
                  htmlFor={`${idBase}-inc-${valor}`}
                  className={`${ALVO} cursor-pointer gap-3 rounded-lg border px-3`}
                >
                  <RadioGroupItem value={String(valor)} id={`${idBase}-inc-${valor}`} />
                  <span>{valor} em {valor}&nbsp;km</span>
                </Label>
              ))}
            </RadioGroup>
            <p className="mt-2 text-xs text-muted-foreground">
              Faixas menores = preço mais justo. Faixas maiores = menos linhas para manter.
            </p>
          </fieldset>

          {!jaGravou && leitura.modo === "faixas" && leitura.zonasNoAviso.length > 0 && (
            <p className="flex gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Zonas desativadas que saem da loja na próxima gravação:{" "}
                {leitura.zonasNoAviso.map((z) => z.nome).join(", ")}.
              </span>
            </p>
          )}

          {faixas.length > 0 && (
            <div
              aria-hidden
              className="hidden border-b bg-muted px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid md:grid-cols-[6rem_minmax(9rem,1fr)_minmax(0,1.6fr)_7rem] md:items-center md:gap-x-6"
            >
              <span>Faixa</span>
              <span>Preço</span>
              <span>Frete grátis</span>
              <span>Ativa</span>
            </div>
          )}

          {faixas.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma faixa cadastrada ainda.</p>
              {/* D7: o que a vitrine faz sem faixa vem do estado real, no rodapé
                  (`textoLimiteEntrega`), para não repetir nem divergir aqui. */}
              <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                Adicione a primeira faixa para começar a cobrar por distância.
              </p>
            </div>
          ) : (
            <ul>
              {faixas.map((f, i) => {
                const rotulo = rotuloFaixa(i, incremento);
                const alerta = f.taxa.trim() === "" ? null : alertaDePreco(precos, i, incremento);
                const erro = erroLinha?.indice === i ? erroLinha.mensagem : null;
                const descricaoPreco =
                  [erro ? idErro(i) : null, alerta ? idAlerta(i) : null].filter(Boolean).join(" ") ||
                  undefined;
                return (
                  <li
                    key={i}
                    className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 border-b px-4 py-4 md:grid-cols-[6rem_minmax(9rem,1fr)_minmax(0,1.6fr)_7rem] md:items-center md:gap-x-6 md:py-3 ${
                      f.ativo ? "" : "bg-muted/60"
                    }`}
                  >
                    <div className="col-start-1 row-start-1 self-center">
                      <span
                        className={`block text-sm font-medium ${f.ativo ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {rotulo}
                      </span>
                      {!f.ativo && (
                        <span className="block text-xs text-muted-foreground">Desligada</span>
                      )}
                    </div>

                    {/* Controles da linha: Ativa + lixeira, colados à direita (C2'/C3'). */}
                    <div className="col-start-2 row-start-1 flex items-center justify-end gap-3 md:col-start-4 md:justify-start">
                      <Label className={`${ALVO} cursor-pointer gap-2`}>
                        <span className="text-xs text-muted-foreground md:sr-only">Ativa</span>
                        <Switch
                          checked={f.ativo}
                          onCheckedChange={(v) => abrirAcao(v === true ? "ligar" : "desligar", i)}
                          aria-label={`Faixa de ${rotulo} ativa`}
                        />
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        className={ALVO}
                        aria-label={`Remover a faixa de ${rotulo} e as abaixo`}
                        onClick={() => abrirAcao("remover", i)}
                      >
                        <Trash2 className="size-4 text-destructive" aria-hidden />
                      </Button>
                    </div>

                    <div className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1">
                      <Label htmlFor={idPreco(i)} className="mb-1 text-xs md:sr-only">
                        Preço do frete
                      </Label>
                      <CampoMoeda
                        id={idPreco(i)}
                        valor={f.taxa}
                        aoMudar={(v) => atualizar(i, { taxa: v })}
                        aoSair={() => tentarGravar(incremento, faixas)}
                        rotuloAcessivel={`Preço do frete da faixa de ${rotulo}`}
                        descritoPor={descricaoPreco}
                        invalido={erro != null && paraNumero(f.taxa) == null}
                      />
                    </div>

                    <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2 md:col-span-1 md:col-start-3 md:row-start-1">
                      <Label className={`${ALVO} cursor-pointer gap-2`}>
                        <Switch
                          checked={f.gratis !== null}
                          onCheckedChange={(v) => alternarGratis(i, v === true)}
                          aria-label={`Frete grátis na faixa de ${rotulo}`}
                        />
                        <span className="text-sm text-foreground">Frete grátis</span>
                      </Label>
                      {f.gratis !== null && (
                        <div className="flex items-center gap-2">
                          <Label htmlFor={idGratis(i)} className="text-xs text-muted-foreground">
                            a partir de
                          </Label>
                          <CampoMoeda
                            id={idGratis(i)}
                            valor={f.gratis}
                            aoMudar={(v) => atualizar(i, { gratis: v })}
                            aoSair={() => tentarGravar(incremento, faixas)}
                            rotuloAcessivel={`Frete grátis a partir de, na faixa de ${rotulo}`}
                            descritoPor={erro ? idErro(i) : undefined}
                            invalido={erro != null && paraNumero(f.gratis) == null}
                            className="max-w-[10rem]"
                          />
                        </div>
                      )}
                    </div>

                    {erro && (
                      <p
                        id={idErro(i)}
                        className="col-span-2 text-xs font-medium text-destructive md:col-span-4"
                      >
                        {erro}
                      </p>
                    )}

                    {alerta && (
                      <p
                        id={idAlerta(i)}
                        role="status"
                        className="col-span-2 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 md:col-span-4"
                      >
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>{alerta}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t px-4 py-3">
            <Button
              type="button"
              variant="outline"
              className={`${ALVO} w-full md:w-auto`}
              onClick={adicionar}
              disabled={faixas.length >= TETO_FAIXAS_ENTREGA}
            >
              <Plus className="size-4" aria-hidden />
              {faixas.length >= TETO_FAIXAS_ENTREGA
                ? `Limite de ${TETO_FAIXAS_ENTREGA} faixas`
                : `Adicionar faixa ${rotuloFaixa(faixas.length, incremento)}`}
            </Button>
          </div>

          <div className="border-t bg-muted px-4 py-3">
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {textoLimiteEntrega(limite, taxaForaZona)}
            </p>
          </div>
        </Card>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">Configure com margem.</strong> O CEP do
        cliente costuma cair no centro do bairro ou da cidade, não no endereço exato. Para atender
        5&nbsp;km reais, cadastre faixas até 7–8&nbsp;km. O valor cobrado no pedido é sempre o
        recalculado pelo servidor.
      </p>

      <AlertDialog
        open={incrementoPendente !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setIncrementoPendente(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar o tamanho das faixas?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso apaga as faixas desta tela. A vitrine continua com as faixas atuais até você
              preencher o preço da primeira faixa nova.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={ALVO}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className={ALVO}
              onClick={confirmarTrocaIncremento}
            >
              Apagar e trocar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={acaoAberta}
        onOpenChange={(aberto) => {
          if (!aberto) setAcaoAberta(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {acaoPendente?.tipo === "ligar"
                ? "Ligar faixas?"
                : acaoPendente?.tipo === "remover"
                  ? "Remover faixas?"
                  : "Desligar faixas?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {acaoPendente?.tipo === "ligar"
                ? `Para a entrega não pular distância, estas faixas voltam a valer na vitrine: ${listarRotulos(rotulosAfetados)}.`
                : acaoPendente?.tipo === "remover"
                  ? "ATENÇÃO, esta faixa e todas as faixas abaixo serão deletadas."
                  : "ATENÇÃO, esta faixa e todas as faixas abaixo serão desligadas."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {acaoPendente?.tipo !== "ligar" && rotulosAfetados.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {acaoPendente?.tipo === "remover" ? "Saem da tabela" : "Deixam de valer na vitrine"}:{" "}
              {listarRotulos(rotulosAfetados)}.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className={ALVO}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant={acaoPendente?.tipo === "ligar" ? "default" : "destructive"}
              className={ALVO}
              onClick={aplicarAcaoLinha}
            >
              {acaoPendente?.tipo === "ligar"
                ? "Ligar"
                : acaoPendente?.tipo === "remover"
                  ? "Remover"
                  : "Desligar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={payloadPendente !== null}
        onOpenChange={(aberto) => {
          // Cancelar mantém as edições locais sem gravar; a próxima tentativa
          // pergunta de novo (D4).
          if (!aberto) setPayloadPendente(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir as zonas atuais?</AlertDialogTitle>
            <AlertDialogDescription>
              As zonas de entrega cadastradas hoje saem da loja e a vitrine passa a cobrar por
              estas faixas. Esta ação não pode ser desfeita.
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
            <Button
              type="button"
              variant="destructive"
              className={ALVO}
              onClick={confirmarSubstituicao}
            >
              Substituir e salvar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
