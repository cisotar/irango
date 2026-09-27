"use client";

import { useMemo, useState, useTransition, type ReactElement } from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EditorFrequencia } from "@/components/painel/EditorFrequencia";
import {
  rascunhoDaFrequencia,
  validarRascunhoFrequencia,
  type RascunhoFrequencia,
} from "@/components/painel/rascunhoFrequencia";
import {
  avisoCategoriaQueNuncaAbre,
  avisoFrequenciaQueNuncaAbre,
  avisoPeriodoEncerrado,
} from "@/lib/utils/descreverVigencia";
import type { Frequencia } from "@/lib/utils/frequencia";
import type { DadosFrequencia } from "@/lib/validacoes/frequencia";

/** A régua de `design-system.md` §5: valor LITERAL. */
const ALVO = "min-h-[44px] min-w-[44px]";

type ResultadoSalvar = { ok: true } | { ok: false; erro: string };

/**
 * O que o diálogo edita. UM diálogo para os três casos (mockup §2):
 *  - `produto`: 1 id, com o aviso RN-1 ao vivo contra a categoria dele;
 *  - `selecao`: N ids, sem aviso RN-1 ao vivo (N categorias, N avisos);
 *  - `categoria`: a frequência da categoria.
 */
export type AlvoFrequencia = {
  /** Zera o rascunho quando o alvo muda. */
  chave: string;
  tipo: "produto" | "selecao" | "categoria";
  /** Linha sob o título: nome do produto, "5 produtos selecionados", "Categoria X". */
  descricao: string;
  /** Nome usado nos rótulos acessíveis das pílulas. */
  nome: string;
  inicial: Frequencia;
  /** Nota fixa acima do editor (seleção divergente, categoria). */
  nota: string | null;
  /** Frequência da categoria do produto (tipo `produto`) para o RN-1 ao vivo. */
  categoria: Frequencia | null;
  rotuloSalvar: string;
  mensagemSucesso: string;
  salvar: (frequencia: DadosFrequencia) => Promise<ResultadoSalvar>;
};

export type DialogoFrequenciaProps = {
  alvo: AlvoFrequencia | null;
  onFechar: () => void;
  /** Depois do sucesso (o pai fecha, sai do modo e dá `router.refresh()`). */
  onSalvo: () => void;
  fusoRotulo: string;
  /** Instante da página (ISO) e fuso da LOJA, vindos do servidor. */
  agora: string;
  timezone: string;
};

/**
 * [323/C8] O diálogo de frequência de exibição: `Dialog` (reversível, não
 * `AlertDialog`) com o `EditorFrequencia` e o footer fixo.
 *
 * Aviso AO VIVO sobre o RASCUNHO (desvio consciente do C8, mockup §2.2 item 6):
 * o aviso do servidor descreve o estado SALVO; aqui o lojista precisa ver na
 * hora que "só sáb" não bate com a categoria seg–sex. São as MESMAS funções
 * puras que o servidor usa, sem `agora` do dispositivo. Aviso de UX: não
 * bloqueia salvar e nada depende dele.
 *
 * Erro da action ⇒ toast e o diálogo FICA ABERTO com o rascunho intacto
 * (retry = clicar de novo).
 */
export function DialogoFrequencia({
  alvo,
  onFechar,
  onSalvo,
  fusoRotulo,
  agora,
  timezone,
}: DialogoFrequenciaProps): ReactElement {
  return (
    <Dialog
      open={alvo !== null}
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
      }}
    >
      <DialogContent className="md:max-w-lg">
        {alvo !== null && (
          <CorpoDialogo
            key={alvo.chave}
            alvo={alvo}
            onFechar={onFechar}
            onSalvo={onSalvo}
            fusoRotulo={fusoRotulo}
            agora={agora}
            timezone={timezone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CorpoDialogo({
  alvo,
  onFechar,
  onSalvo,
  fusoRotulo,
  agora,
  timezone,
}: Omit<DialogoFrequenciaProps, "alvo"> & { alvo: AlvoFrequencia }): ReactElement {
  const [rascunho, setRascunho] = useState<RascunhoFrequencia>(() =>
    rascunhoDaFrequencia(alvo.inicial),
  );
  // Erros só aparecem depois da primeira tentativa de salvar: ligar "Só em um
  // horário do dia" não pinta vermelho antes de o lojista digitar.
  const [tentou, setTentou] = useState(false);
  const [salvando, startSalvar] = useTransition();

  const validacao = useMemo(() => validarRascunhoFrequencia(rascunho), [rascunho]);

  const aviso = useMemo(() => {
    if (!validacao.ok) return null;
    const f = validacao.frequencia;
    const encerrado = avisoPeriodoEncerrado(f, new Date(agora), timezone);
    if (encerrado !== null) return encerrado;
    if (alvo.tipo === "produto") return avisoFrequenciaQueNuncaAbre(f, alvo.categoria);
    if (alvo.tipo === "categoria") return avisoCategoriaQueNuncaAbre(f);
    return null;
  }, [validacao, agora, timezone, alvo.tipo, alvo.categoria]);

  function salvar(): void {
    setTentou(true);
    if (!validacao.ok) return;
    const frequencia = validacao.frequencia;
    startSalvar(async () => {
      const resultado = await alvo.salvar(frequencia);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success(alvo.mensagemSucesso);
      onSalvo();
    });
  }

  const erros =
    tentou && !validacao.ok ? validacao.erros : { horario: null, periodo: null };

  return (
    <>
      <DialogHeader className="shrink-0 border-b pr-12">
        <DialogTitle>Frequência de exibição</DialogTitle>
        <DialogDescription>{alvo.descricao}</DialogDescription>
      </DialogHeader>

      {/* Corpo rolável: em 360px o editor é alto, e o footer fica FORA dele,
          sempre visível. `min-h-0` deixa o `flex-1` encolher no flex-col. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {alvo.nota !== null && (
          <p className="flex items-start gap-2 rounded-lg border border-input bg-muted/40 p-3 text-xs text-foreground">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {alvo.nota}
          </p>
        )}

        <EditorFrequencia
          valor={rascunho}
          onChange={setRascunho}
          alvo={alvo.tipo === "categoria" ? "categoria" : "produto"}
          nome={alvo.nome}
          erros={erros}
          desabilitado={salvando}
          fusoRotulo={fusoRotulo}
          idBase={`frequencia-${alvo.chave}`}
        />

        {aviso !== null && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {aviso}
          </p>
        )}
      </div>

      <DialogFooter className="shrink-0 flex-row border-t">
        <Button
          type="button"
          variant="outline"
          className={`${ALVO} flex-1`}
          disabled={salvando}
          onClick={onFechar}
        >
          Cancelar
        </Button>
        <Button type="button" className={`${ALVO} flex-1`} disabled={salvando} onClick={salvar}>
          {salvando && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {salvando ? "Salvando…" : alvo.rotuloSalvar}
        </Button>
      </DialogFooter>
    </>
  );
}
