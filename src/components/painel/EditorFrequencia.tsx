"use client";

import type { ReactElement } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PilulasDeDias } from "@/components/painel/PilulasDeDias";
import {
  frequenciaDoRascunho,
  type ErrosFrequencia,
  type RascunhoFrequencia,
} from "@/components/painel/rascunhoFrequencia";
import { rotuloFrequencia } from "@/lib/utils/descreverVigencia";

/** A régua de `design-system.md` §5: valor LITERAL (base de fonte 120%). */
const ALVO = "min-h-[44px] min-w-[44px]";

export type EditorFrequenciaProps = {
  valor: RascunhoFrequencia;
  onChange: (valor: RascunhoFrequencia) => void;
  /** Muda só a legenda de "Nunca disponível" (item × categoria). */
  alvo: "produto" | "categoria";
  /** Nome do produto/categoria (ou "os produtos selecionados") para os rótulos. */
  nome: string;
  /** Erros do MESMO zod do servidor; `null` = sem erro naquele eixo. */
  erros: ErrosFrequencia;
  desabilitado?: boolean;
  /** Linha de fuso pronta do servidor (`rotuloFusoLoja`). */
  fusoRotulo: string;
  /** Prefixo dos ids de DOM (dois editores nunca colidem). */
  idBase: string;
};

/**
 * [323/C8] O editor de frequência de exibição — CONTROLADO e sem I/O (quem
 * salva é o `DialogoFrequencia`). Um padrão para os três eixos, o `Switch`
 * "Só em…" de `FormVigencia` (mockup §2.2): desligado = sem restrição.
 *
 * Dias, D13 literal: "Todos os dias" ⇒ `null`; "Só em alguns dias" ⇒ as
 * pílulas; nenhuma pílula marcada ⇒ `[]` com a legenda "Nunca disponível", sem
 * erro. O `PilulasDeDias` continua burro ("vazio = sem restrição" vale para os
 * outros consumidores): a tradução mora AQUI.
 */
export function EditorFrequencia({
  valor,
  onChange,
  alvo,
  nome,
  erros,
  desabilitado = false,
  fusoRotulo,
  idBase,
}: EditorFrequenciaProps): ReactElement {
  function alterar(patch: Partial<RascunhoFrequencia>): void {
    onChange({ ...valor, ...patch });
  }

  const resumo = rotuloFrequencia(frequenciaDoRascunho(valor)) ?? "Sempre disponível";
  const nunca = valor.comDias && valor.dias.length === 0;
  const idNunca = `${idBase}-nunca`;
  const idErroHorario = `${idBase}-erro-horario`;
  const idErroPeriodo = `${idBase}-erro-periodo`;

  return (
    <div className="flex flex-col gap-5">
      {/* Resumo AO VIVO: a mesma `rotuloFrequencia` do chip da lista — o
          lojista lê, antes de salvar, exatamente o que a linha vai mostrar. */}
      <p
        aria-live="polite"
        className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm font-medium text-foreground"
      >
        {resumo}
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Dias da semana</legend>
        <Label className={`flex ${ALVO} cursor-pointer items-center gap-3 font-normal`}>
          <Switch
            checked={valor.comDias}
            disabled={desabilitado}
            onCheckedChange={(marcado) => alterar({ comDias: Boolean(marcado) })}
          />
          Só em alguns dias
        </Label>
        {valor.comDias ? (
          <>
            <PilulasDeDias
              valor={valor.dias}
              onChange={(dias) => alterar({ dias })}
              rotulo={`Dias em que ${nome} aparece`}
              desabilitado={desabilitado}
              descritoPor={nunca ? idNunca : undefined}
            />
            {nunca && (
              <p id={idNunca} className="text-xs text-muted-foreground">
                <strong className="font-semibold text-foreground">Nunca disponível.</strong>{" "}
                {alvo === "categoria"
                  ? "Todos os itens da categoria ficam visíveis, sem vender. Marque os dias em que ela aparece."
                  : "O item fica visível na vitrine, sem vender. Marque os dias em que ele aparece."}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Todos os dias</p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Horário</legend>
        <Label className={`flex ${ALVO} cursor-pointer items-center gap-3 font-normal`}>
          <Switch
            checked={valor.comHorario}
            disabled={desabilitado}
            onCheckedChange={(marcado) => alterar({ comHorario: Boolean(marcado) })}
          />
          Só em um horário do dia
        </Label>
        {valor.comHorario ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`${idBase}-hora-inicio`}>Das</Label>
              <Input
                id={`${idBase}-hora-inicio`}
                type="time"
                value={valor.hora_inicio}
                disabled={desabilitado}
                onChange={(e) => alterar({ hora_inicio: e.target.value })}
                aria-invalid={erros.horario !== null ? true : undefined}
                aria-describedby={erros.horario !== null ? idErroHorario : undefined}
                className={`${ALVO} w-auto`}
              />
              <Label htmlFor={`${idBase}-hora-fim`}>às</Label>
              <Input
                id={`${idBase}-hora-fim`}
                type="time"
                value={valor.hora_fim}
                disabled={desabilitado}
                onChange={(e) => alterar({ hora_fim: e.target.value })}
                aria-invalid={erros.horario !== null ? true : undefined}
                aria-describedby={erros.horario !== null ? idErroHorario : undefined}
                className={`${ALVO} w-auto`}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              O horário de fim não entra: das 11:00 às 15:00 vende até 14:59.
            </p>
            {erros.horario !== null && (
              <p id={idErroHorario} className="text-xs text-destructive">
                {erros.horario}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">O dia todo</p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Período</legend>
        <Label className={`flex ${ALVO} cursor-pointer items-center gap-3 font-normal`}>
          <Switch
            checked={valor.comPeriodo}
            disabled={desabilitado}
            onCheckedChange={(marcado) => alterar({ comPeriodo: Boolean(marcado) })}
          />
          Só em um período de datas
        </Label>
        {valor.comPeriodo ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`${idBase}-periodo-inicio`}>De</Label>
              <Input
                id={`${idBase}-periodo-inicio`}
                type="date"
                value={valor.periodo_inicio}
                disabled={desabilitado}
                onChange={(e) => alterar({ periodo_inicio: e.target.value })}
                aria-invalid={erros.periodo !== null ? true : undefined}
                aria-describedby={erros.periodo !== null ? idErroPeriodo : undefined}
                className={`${ALVO} w-auto`}
              />
              <Label htmlFor={`${idBase}-periodo-fim`}>Até</Label>
              <Input
                id={`${idBase}-periodo-fim`}
                type="date"
                value={valor.periodo_fim}
                disabled={desabilitado}
                onChange={(e) => alterar({ periodo_fim: e.target.value })}
                aria-invalid={erros.periodo !== null ? true : undefined}
                aria-describedby={erros.periodo !== null ? idErroPeriodo : undefined}
                className={`${ALVO} w-auto`}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Preencha só uma das datas para valer a partir de um dia, ou até um dia. As duas
              datas entram.
            </p>
            {erros.periodo !== null && (
              <p id={idErroPeriodo} className="text-xs text-destructive">
                {erros.periodo}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Sempre</p>
        )}
      </fieldset>

      <p className="text-xs text-muted-foreground">
        Horários e datas no fuso da loja ({fusoRotulo}).
      </p>
    </div>
  );
}
