"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { PilulasDeDias } from "@/components/painel/PilulasDeDias";
import { PreviewVigencia } from "@/components/painel/PreviewVigencia";
import {
  MODOS,
  PRESETS,
  fimDoPresetExibido,
  fraseDoRascunho,
  rascunhoInicial,
  todosOsDias,
  validarRascunho,
  type ModoVigencia,
  type PresetDeDuracao,
  type RascunhoCardapio,
} from "@/components/painel/rascunhoCardapio";
import type { CardapioVigencia } from "@/lib/utils/vigenciaCardapio";

/** A régua de `design-system.md` §5: valor LITERAL, nunca a classe
 *  semântica do Tailwind (com base de fonte 120% ela não dá 44px). */
const ALVO = "min-h-[44px] min-w-[44px]";

const DIAS_DO_MES = Array.from({ length: 31 }, (_, i) => i + 1);

const ID_ERROS = "erros-vigencia";

type ResultadoAcao = { ok: true } | { ok: false; erro: string };

export type FormVigenciaProps = {
  /** `null` = criação. */
  cardapio: CardapioVigencia | null;
  timezone: string;
  /** `America/Sao_Paulo (GMT-3)`, montado no SERVIDOR (`rotuloFusoLoja`). */
  fusoRotulo: string;
  /** `"YYYY-MM-DDTHH:MM"` no fuso da loja, do relógio do SERVIDOR. */
  agoraLocal: string;
  /** A linha "Agora:" da configuração SALVA; `null` na criação (design §9.4). */
  linhaAgora: string | null;
  salvar: (payload: unknown) => Promise<ResultadoAcao>;
  voltarHref: string;
};

/**
 * [257][258][259] O form de vigência do cardápio — os dois modos de D3 numa
 * rota própria (não modal: sete controles e uma prévia dentro de um `Dialog`
 * nascem quebrados em 360px, `design-system.md` §1).
 *
 * Três decisões que não são livres:
 *
 *  1. **um zod, dois consumidores.** A validação sai de `validarRascunho`, que
 *     roda o MESMO `schemaCardapio` da Server Action. Nenhum schema paralelo,
 *     nenhuma regra de vigência reescrita aqui. (Sem `@hookform/resolvers` no
 *     projeto, o resolver do react-hook-form não existiria sem dependência
 *     nova — e o rascunho guarda os DOIS modos, o que a união `.strict()` do
 *     zod recusaria como valores de form.)
 *  2. **trocar de modo não apaga o digitado** (design §9.1). Os dois conjuntos
 *     convivem no rascunho; só o modo selecionado vira payload. A disjunção de
 *     RN-01 é do zod + CHECK, não de apagar campo.
 *  3. **o form não decide nada.** Ele é a primeira barreira com mensagem
 *     legível; a autoridade é a Server Action, que recalcula `prazo_fim` sob
 *     preset (RN-04) e converte hora local → instante com o fuso da LOJA.
 */
export function FormVigencia({
  cardapio,
  timezone,
  fusoRotulo,
  agoraLocal,
  linhaAgora,
  salvar,
  voltarHref,
}: FormVigenciaProps): ReactElement {
  const router = useRouter();
  const inicial = useMemo(
    () => rascunhoInicial(cardapio, timezone, agoraLocal),
    [cardapio, timezone, agoraLocal],
  );
  const [rascunho, setRascunho] = useState<RascunhoCardapio>(inicial);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [pendente, setPendente] = useState(false);
  const [mesAberto, setMesAberto] = useState(inicial.dias_mes.length > 0);
  const blocoErros = useRef<HTMLDivElement>(null);

  function alterar(mudanca: Partial<RascunhoCardapio>): void {
    setRascunho((atual) => ({ ...atual, ...mudanca }));
  }

  function alternarDia(lista: number[], valor: number): number[] {
    return lista.includes(valor)
      ? lista.filter((d) => d !== valor)
      : [...lista, valor].sort((a, b) => a - b);
  }

  const frase = fraseDoRascunho(rascunho, timezone);
  const fimExibido = fimDoPresetExibido(rascunho, timezone);
  // A linha "Agora:" é do SERVIDOR e vale para o que está SALVO. Editou,
  // sumiu — ela não pode falar sobre um rascunho que o servidor nunca viu.
  const sujo = JSON.stringify(rascunho) !== JSON.stringify(inicial);
  const mensagens = Object.values(erros);

  async function aoSubmeter(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    const validado = validarRascunho(rascunho);
    if (!validado.ok) {
      setErros(validado.erros);
      // Foco no bloco ao falhar o submit (design §9.6).
      requestAnimationFrame(() => blocoErros.current?.focus());
      return;
    }

    setErros({});
    setPendente(true);
    try {
      const resultado = await salvar(validado.payload);
      if (!resultado.ok) {
        setErros({ form: resultado.erro });
        requestAnimationFrame(() => blocoErros.current?.focus());
        return;
      }
      toast.success("Cardápio salvo.");
      router.push(voltarHref);
      router.refresh();
    } finally {
      setPendente(false);
    }
  }

  return (
    <form onSubmit={aoSubmeter} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="nome-cardapio">Nome do cardápio</Label>
        <Input
          id="nome-cardapio"
          value={rascunho.nome}
          onChange={(e) => alterar({ nome: e.target.value })}
          aria-invalid={erros.nome != null}
          aria-describedby={mensagens.length > 0 ? ID_ERROS : undefined}
          className={ALVO}
          maxLength={80}
        />
      </div>

      {/* ── §9.1 Escolha do modo ─────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">
          Quando este cardápio aparece
        </legend>
        <RadioGroup
          value={rascunho.modo}
          onValueChange={(valor) => alterar({ modo: valor as ModoVigencia })}
          aria-label="Quando este cardápio aparece"
        >
          {MODOS.map((modo) => (
            <Label
              key={modo.valor}
              className={`flex ${ALVO} cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary`}
            >
              <RadioGroupItem value={modo.valor} className="mt-1" />
              <span className="flex flex-col gap-1 text-left">
                <span className="font-semibold">{modo.titulo}</span>
                <span className="text-xs font-normal text-texto-muted">
                  {modo.descricao}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <p className="text-xs text-texto-muted">
          Ao salvar, vale só o modo selecionado.
        </p>
      </fieldset>

      {rascunho.modo === "recorrente" ? (
        <ModoRepeteSempre
          rascunho={rascunho}
          erros={erros}
          fusoRotulo={fusoRotulo}
          mesAberto={mesAberto}
          abrirMes={() => setMesAberto(true)}
          alterar={alterar}
          alternarDia={alternarDia}
        />
      ) : (
        <ModoPeriodo
          rascunho={rascunho}
          erros={erros}
          fusoRotulo={fusoRotulo}
          fimExibido={fimExibido}
          alterar={alterar}
        />
      )}

      {/* ── §9.4 A prévia ────────────────────────────────────────────────── */}
      <PreviewVigencia
        frase={frase}
        fusoRotulo={fusoRotulo}
        linhaAgora={sujo ? null : linhaAgora}
      />

      {mensagens.length > 0 ? (
        <div
          id={ID_ERROS}
          ref={blocoErros}
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive outline-none focus-visible:ring-3 focus-visible:ring-destructive/30"
        >
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {mensagens.map((mensagem) => (
              <li key={mensagem}>{mensagem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pendente} className={ALVO}>
          {pendente ? "Salvando…" : "Salvar cardápio"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={ALVO}
          onClick={() => router.push(voltarHref)}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════ §9.2 Modo A ════════════════

type ModoProps = {
  rascunho: RascunhoCardapio;
  erros: Record<string, string>;
  fusoRotulo: string;
  alterar: (mudanca: Partial<RascunhoCardapio>) => void;
};

function ModoRepeteSempre({
  rascunho,
  erros,
  fusoRotulo,
  mesAberto,
  abrirMes,
  alterar,
  alternarDia,
}: ModoProps & {
  mesAberto: boolean;
  abrirMes: () => void;
  alternarDia: (lista: number[], valor: number) => number[];
}): ReactElement {
  const temTrintaEUm = rascunho.dias_mes.includes(31);
  const todosMarcados = rascunho.dias_semana.length === todosOsDias().length;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">Dias da semana</span>
            <span className="text-xs text-texto-muted">opcional</span>
          </div>
          {/* grid-cols-4 no mobile: sete alvos de 44px não cabem nos 328px
              úteis de uma tela de 360px (design §9.2). O desenho das pílulas
              mora em `PilulasDeDias` — duas superfícies, uma implementação.
              `aria-invalid` não é suportado em `role="group"` nem em
              `<button>` (ARIA não o define para eles): o erro de RN-02 fala
              pelo `aria-describedby` + o bloco `role="alert"` que recebe foco
              no submit (design §9.6). */}
          <PilulasDeDias
            valor={rascunho.dias_semana}
            onChange={(dias) => alterar({ dias_semana: dias })}
            rotulo="Dias da semana em que este cardápio aparece"
            descritoPor={erros.dias_semana != null ? ID_ERROS : undefined}
          />
          {/* [275] O atalho fica ABAIXO das pílulas e ACIMA da nota: acima
              delas disputaria a primeira leitura com os dias. Não é CTA — o
              CTA da rota continua sendo "Salvar cardápio". */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={todosMarcados}
              disabled={todosMarcados}
              className={ALVO}
              onClick={() => alterar({ dias_semana: todosOsDias() })}
            >
              Todos os dias
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={rascunho.dias_semana.length === 0}
              className={ALVO}
              onClick={() => alterar({ dias_semana: [] })}
            >
              Limpar
            </Button>
          </div>
          <p className="text-xs text-texto-muted">
            Nenhum dia marcado = todos os dias.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">Dias do mês</span>
            <span className="text-xs text-texto-muted">opcional</span>
          </div>
          {mesAberto ? (
            <>
              <div
                role="group"
                aria-label="Dias do mês em que este cardápio aparece"
                className="grid grid-cols-7 gap-1"
              >
                {DIAS_DO_MES.map((dia) => {
                  const marcado = rascunho.dias_mes.includes(dia);
                  return (
                    <button
                      key={dia}
                      type="button"
                      aria-pressed={marcado}
                      onClick={() =>
                        alterar({ dias_mes: alternarDia(rascunho.dias_mes, dia) })
                      }
                      className={`${ALVO} rounded-lg border text-sm focus-visible:ring-3 focus-visible:ring-ring/50 ${
                        marcado
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      {dia}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-texto-muted">
                Nenhum dia marcado = todos os dias do mês.
              </p>
              {temTrintaEUm ? (
                <p className="text-xs text-texto-muted">
                  O dia 31 não existe em todo mês. Nos meses de 30 dias, este
                  cardápio não aparece.
                </p>
              ) : null}
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              className={`${ALVO} self-start`}
              onClick={abrirMes}
            >
              <Plus aria-hidden />
              Escolher dias do mês
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">Horário do dia</span>
            <span className="text-xs text-texto-muted">opcional</span>
          </div>
          <Label className={`flex ${ALVO} items-center gap-3`}>
            <Switch
              checked={rascunho.comHorario}
              onCheckedChange={(marcado) =>
                alterar({ comHorario: Boolean(marcado) })
              }
            />
            Só em um horário do dia
          </Label>
          {rascunho.comHorario ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="hora-inicio">Das</Label>
                <Input
                  id="hora-inicio"
                  type="time"
                  value={rascunho.hora_inicio}
                  onChange={(e) => alterar({ hora_inicio: e.target.value })}
                  aria-invalid={erros.hora_inicio != null}
                  aria-describedby={
                    erros.hora_inicio != null ? ID_ERROS : undefined
                  }
                  className={`${ALVO} w-auto`}
                />
                <Label htmlFor="hora-fim">às</Label>
                <Input
                  id="hora-fim"
                  type="time"
                  value={rascunho.hora_fim}
                  onChange={(e) => alterar({ hora_fim: e.target.value })}
                  aria-invalid={erros.hora_fim != null}
                  aria-describedby={erros.hora_fim != null ? ID_ERROS : undefined}
                  className={`${ALVO} w-auto`}
                />
              </div>
              <p className="text-xs text-texto-muted">
                Fuso da loja: {fusoRotulo}
              </p>
            </div>
          ) : (
            <p className="text-xs text-texto-muted">
              Sem horário marcado, o cardápio aparece o dia inteiro.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════ §9.3 Modo B ════════════════

function ModoPeriodo({
  rascunho,
  erros,
  fusoRotulo,
  fimExibido,
  alterar,
}: ModoProps & { fimExibido: string | null }): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <span className="text-sm font-semibold">Duração</span>
          <div
            role="group"
            aria-label="Duração do período"
            className="flex flex-wrap gap-2"
          >
            {PRESETS.map((preset) => {
              const marcado = rascunho.prazo_preset === preset.valor;
              return (
                <button
                  key={preset.valor}
                  type="button"
                  aria-pressed={marcado}
                  onClick={() =>
                    alterar({ prazo_preset: preset.valor as PresetDeDuracao })
                  }
                  className={`${ALVO} rounded-lg border px-4 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 ${
                    marcado
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {preset.rotulo}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Começa em</span>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Data de início"
                type="date"
                value={rascunho.inicio_data}
                onChange={(e) => alterar({ inicio_data: e.target.value })}
                aria-invalid={erros.prazo_inicio != null}
                aria-describedby={
                  erros.prazo_inicio != null ? ID_ERROS : undefined
                }
                className={`${ALVO} w-auto`}
              />
              <Input
                aria-label="Hora de início"
                type="time"
                value={rascunho.inicio_hora}
                onChange={(e) => alterar({ inicio_hora: e.target.value })}
                className={`${ALVO} w-auto`}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Termina em</span>
            {/* RN-04: com preset, o servidor RECALCULA o fim e descarta o que
                o cliente mandar. Um campo editável cujo valor o servidor joga
                fora é uma mentira de UI — aqui é LEITURA. */}
            {fimExibido !== null ? (
              <>
                <p className="text-sm font-medium">{fimExibido}</p>
                <p className="text-xs text-texto-muted">
                  Calculado a partir da data de início e da duração escolhida.
                  Para digitar a data de fim, use “Escolher as datas”.
                </p>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Data de fim"
                  type="date"
                  value={rascunho.fim_data}
                  onChange={(e) => alterar({ fim_data: e.target.value })}
                  aria-invalid={erros.prazo_fim != null}
                  aria-describedby={
                    erros.prazo_fim != null ? ID_ERROS : undefined
                  }
                  className={`${ALVO} w-auto`}
                />
                <Input
                  aria-label="Hora de fim"
                  type="time"
                  value={rascunho.fim_hora}
                  onChange={(e) => alterar({ fim_hora: e.target.value })}
                  className={`${ALVO} w-auto`}
                />
              </div>
            )}
          </div>

          <p className="text-xs text-texto-muted">Fuso da loja: {fusoRotulo}</p>
        </CardContent>
      </Card>
    </div>
  );
}
