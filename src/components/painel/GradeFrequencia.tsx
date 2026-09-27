"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactElement,
} from "react";
import { AlertTriangle, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PilulasDeDias } from "@/components/painel/PilulasDeDias";
import {
  diasDasPilulas,
  mesmosDias,
  montarPayloadDaGrade,
  pilulasDosDias,
} from "@/components/painel/gradeFrequencia";
import {
  avisoFrequenciaQueNuncaAbre,
  rotuloFrequencia,
} from "@/lib/utils/descreverVigencia";
import { FREQUENCIA_PERMANENTE, frequenciaDe, type Frequencia } from "@/lib/utils/frequencia";
import type { FrequenciasDoPainel } from "@/lib/utils/frequenciaPainel";
import type { Produto } from "@/lib/supabase/queries/produtos";

/** A régua de `design-system.md` §5: valor LITERAL. */
const ALVO = "min-h-[44px] min-w-[44px]";

type ResultadoSalvar = { ok: true } | { ok: false; erro: string };

export type GrupoDaGrade = {
  id: string | null;
  nome: string;
  produtos: readonly Produto[];
};

export type GradeFrequenciaProps = {
  grupos: readonly GrupoDaGrade[];
  frequencias: FrequenciasDoPainel;
  /** `salvarGradeDeDias` (ou a variante admin com `lojaId` fixado). */
  salvar: (payload: unknown) => Promise<ResultadoSalvar>;
  /** Sai do modo. `salvou` ⇒ o pai dá `router.refresh()`. */
  onSair: (salvou: boolean) => void;
};

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/**
 * [323/C8] A grade produto × dia com "Salvar tudo" (mockup §3). É um MODO de
 * tela, como "Reordenar": a listagem dá lugar à grade e a barra do modo
 * aparece no rodapé (mobile) ou no topo (desktop).
 *
 * Só escreve `dias_semana` (D6). Hora e período aparecem como chip de
 * LEITURA. RN-6: a RPC grava tudo ou nada — no erro, o rascunho fica intacto e
 * o toast diz que nenhum produto foi alterado.
 *
 * Aviso RN-1 AO VIVO por linha, sobre os dias do rascunho + hora/período
 * salvos + frequência da categoria. Avisa, não bloqueia.
 */
export function GradeFrequencia({
  grupos,
  frequencias,
  salvar,
  onSair,
}: GradeFrequenciaProps): ReactElement {
  const produtos = useMemo(() => grupos.flatMap((g) => g.produtos), [grupos]);

  // Estado SALVO por produto (valor cru do banco) e pílulas marcadas (rascunho).
  const inicial = useMemo(
    () => Object.fromEntries(produtos.map((p) => [p.id, p.dias_semana])),
    [produtos],
  );
  const [atual, setAtual] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(produtos.map((p) => [p.id, pilulasDosDias(p.dias_semana)])),
  );
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [salvando, startSalvar] = useTransition();

  const payload = useMemo(() => montarPayloadDaGrade(inicial, atual), [inicial, atual]);
  const alteracoes = payload.itens.length;

  const cancelar = useCallback(() => {
    if (salvando) return;
    if (alteracoes === 0) onSair(false);
    else setConfirmandoDescarte(true);
  }, [alteracoes, onSair, salvando]);

  // ESC = Cancelar — mas nunca por cima do "Descartar?", que tem o próprio ESC.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape" && !confirmandoDescarte) cancelar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [cancelar, confirmandoDescarte]);

  function salvarTudo(): void {
    if (alteracoes === 0) return;
    const n = alteracoes;
    startSalvar(async () => {
      const resultado = await salvar(payload);
      if (!resultado.ok) {
        toast.error(resultado.erro, {
          description: "Nenhum produto foi alterado. Tente de novo.",
        });
        return;
      }
      toast.success(`Dias salvos em ${plural(n, "produto", "produtos")}.`);
      onSair(true);
    });
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 min-h-[64px] border-t bg-background p-3 shadow-lg sm:sticky sm:top-0 sm:bottom-auto sm:z-30 sm:mb-4 sm:rounded-xl sm:border sm:shadow-sm">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm font-medium">
            {alteracoes === 0
              ? "Nenhuma alteração"
              : `${plural(alteracoes, "alteração não salva", "alterações não salvas")}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className={ALVO}
              disabled={salvando}
              onClick={cancelar}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className={ALVO}
              disabled={salvando || alteracoes === 0}
              onClick={salvarTudo}
            >
              {salvando && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {salvando ? "Salvando…" : "Salvar tudo"}
            </Button>
          </div>
        </div>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        Marque os dias em que cada produto aparece. Nenhum dia marcado deixa o produto visível e
        sem vender.
      </p>

      {/* Espaço para a barra fixa do rodapé não cobrir a última linha no mobile. */}
      <div className="flex flex-col gap-6 pb-24 sm:pb-0">
        {grupos.map((grupo) => {
          const daCategoria = grupo.id === null ? undefined : frequencias.categorias[grupo.id];
          const frequenciaDaCategoria: Frequencia | null = daCategoria?.frequencia ?? null;
          return (
            <Card key={grupo.id ?? "sem-categoria"} className="gap-0 py-0">
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                <h3 className="font-heading text-lg font-semibold text-foreground">
                  {grupo.nome}
                </h3>
                {daCategoria?.rotulo != null && (
                  <Badge variant="outline" className="font-normal whitespace-normal">
                    {daCategoria.rotulo}
                  </Badge>
                )}
                {daCategoria?.oculta === true && (
                  <Badge variant="outline" className="text-muted-foreground">
                    <EyeOff aria-hidden className="size-3" />
                    Oculta da vitrine
                  </Badge>
                )}
              </div>
              {grupo.produtos.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  Nenhum produto nesta categoria ainda.
                </p>
              )}
              <ul className="divide-y divide-foreground/10">
                {grupo.produtos.map((p) => {
                  const pilulas = atual[p.id] ?? [];
                  const dias = diasDasPilulas(pilulas);
                  const alterado = !mesmosDias(p.dias_semana, dias);
                  const salvo = frequenciaDe(p);
                  const leitura = rotuloFrequencia({
                    ...FREQUENCIA_PERMANENTE,
                    hora_inicio: salvo.hora_inicio,
                    hora_fim: salvo.hora_fim,
                    periodo_inicio: salvo.periodo_inicio,
                    periodo_fim: salvo.periodo_fim,
                  });
                  const aviso = avisoFrequenciaQueNuncaAbre(
                    { ...salvo, dias_semana: dias },
                    frequenciaDaCategoria,
                  );
                  const idLegenda = `grade-legenda-${p.id}`;
                  return (
                    <li
                      key={p.id}
                      className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4 ${
                        alterado ? "border-l-[3px] border-l-amber-500" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="line-clamp-2 font-semibold text-foreground">
                            {p.nome}
                          </span>
                          {alterado && <Badge variant="secondary">Alterado</Badge>}
                        </div>
                        {leitura !== null && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {leitura} (horário e período não mudam aqui)
                          </p>
                        )}
                        <p id={idLegenda} className="mt-1 text-xs text-muted-foreground">
                          {dias === null
                            ? "Todo dia"
                            : dias.length === 0
                              ? "Nunca disponível"
                              : null}
                        </p>
                        {aviso !== null && (
                          <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
                            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                            {aviso}
                          </p>
                        )}
                      </div>
                      <div className="sm:shrink-0">
                        <PilulasDeDias
                          valor={pilulas}
                          onChange={(novas) =>
                            setAtual((anterior) => ({ ...anterior, [p.id]: novas }))
                          }
                          rotulo={`Dias de ${p.nome}`}
                          desabilitado={salvando}
                          descritoPor={idLegenda}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>

      <AlertDialog
        open={confirmandoDescarte}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmandoDescarte(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Descartar {plural(alteracoes, "alteração", "alterações")}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Os dias marcados nesta grade ainda não foram salvos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={ALVO}>Continuar editando</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className={ALVO}
              onClick={() => {
                setConfirmandoDescarte(false);
                onSair(false);
              }}
            >
              Descartar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
