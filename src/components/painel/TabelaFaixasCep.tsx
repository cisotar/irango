"use client";

import { useId, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { IMaskInput } from "react-imask";

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
import { Switch } from "@/components/ui/switch";
import { inputMascaraClassName } from "@/components/painel/estiloInputMascara";
import {
  ALVO,
  CampoMoeda,
  IndicadorGravacao,
  useFocoPendente,
  useGravacaoDoEditor,
  type PropsEditorZonas,
} from "@/components/painel/pecasEntrega";
import {
  chaveDaMontagem,
  lerFaixasCep,
  montarPayloadCep,
  paraNumero,
  type FaixaCepEditavel,
  type PayloadCep,
} from "@/components/painel/payloadZona";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { TETO_FAIXAS_CEP } from "@/lib/validacoes/entrega";

/**
 * Editor de frete por faixas de CEP (issue 325). Client component.
 *
 * Abre as zonas `faixa_cep` gravadas com `lerFaixasCep` (nada é gravado ao
 * abrir). Gravação automática como no editor de km: ao sair de qualquer campo
 * com a tabela válida, no switch "Ativa" e logo depois de confirmar a remoção.
 * Linha incompleta ou inválida mostra o erro na linha e não grava. O payload é
 * só gate de UX: a action revalida (`schemaZonasEntrega`) e a RPC é a
 * autoridade; o frete do pedido é recalculado no servidor.
 */
export function TabelaFaixasCep({
  zonasIniciais,
  salvar,
  aoGravar,
  bloqueado,
  taxaForaZona,
}: PropsEditorZonas) {
  const idBase = useId();

  const iniciais = useMemo(() => lerFaixasCep(zonasIniciais), [zonasIniciais]);
  const [linhas, setLinhas] = useState<FaixaCepEditavel[]>(iniciais);
  const [remocaoPendente, setRemocaoPendente] = useState<number | null>(null);

  const gravacao = useGravacaoDoEditor<PayloadCep>({
    kmForaDoFormato: false,
    salvar,
    aoGravar,
    bloqueado,
    chaveInicial: () => chaveDaMontagem(montarPayloadCep(iniciais)),
  });
  const { erroLinha } = gravacao;

  const focar = useFocoPendente();

  const idInicio = (i: number) => `${idBase}-ini-${i}`;
  const idFim = (i: number) => `${idBase}-fim-${i}`;
  const idPreco = (i: number) => `${idBase}-preco-${i}`;
  const idGratis = (i: number) => `${idBase}-gratis-${i}`;
  const idErro = (i: number) => `${idBase}-erro-${i}`;

  /** Tenta gravar o estado dado. Nunca grava linha incompleta (erro na linha). */
  function tentarGravar(estado: FaixaCepEditavel[]) {
    gravacao.tentarGravar(montarPayloadCep(estado));
  }

  function atualizar(i: number, parcial: Partial<FaixaCepEditavel>) {
    setLinhas((atual) => atual.map((l, j) => (j === i ? { ...l, ...parcial } : l)));
  }

  function alternarAtiva(i: number, ligado: boolean) {
    const novas = linhas.map((l, j) => (j === i ? { ...l, ativo: ligado } : l));
    setLinhas(novas);
    tentarGravar(novas);
  }

  function alternarGratis(i: number, ligado: boolean) {
    const novas = linhas.map((l, j) => (j === i ? { ...l, gratis: ligado ? "" : null } : l));
    setLinhas(novas);
    if (ligado) {
      // grava no blur do valor, não agora (estaria vazio)
      focar(idGratis(i));
      return;
    }
    tentarGravar(novas);
  }

  function adicionar() {
    if (linhas.length >= TETO_FAIXAS_CEP) return;
    setLinhas((atual) => [...atual, { cepInicio: "", cepFim: "", taxa: "", gratis: null, ativo: true }]);
    focar(idInicio(linhas.length));
  }

  function confirmarRemocao() {
    if (remocaoPendente == null) return;
    const novas = linhas.filter((_, j) => j !== remocaoPendente);
    setLinhas(novas);
    setRemocaoPendente(null);
    tentarGravar(novas);
  }

  const linhaRemovida = remocaoPendente == null ? null : linhas[remocaoPendente];

  return (
    <>
      <Card className="gap-0 py-0">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="font-heading text-base font-medium text-foreground">Faixas de CEP</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cadastre cada intervalo de CEP com o preço da entrega. Tudo é salvo sozinho ao sair de
              cada campo.
            </p>
          </div>
          <IndicadorGravacao estado={gravacao.estadoGravacao} />
        </div>

        {linhas.length > 0 && (
          <div
            aria-hidden
            className="hidden border-b bg-muted px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid md:grid-cols-[8rem_8rem_minmax(8rem,1fr)_minmax(0,1.4fr)_6rem] md:items-center md:gap-x-4"
          >
            <span>CEP inicial</span>
            <span>CEP final</span>
            <span>Preço</span>
            <span>Frete grátis</span>
            <span>Ativa</span>
          </div>
        )}

        {linhas.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma faixa de CEP cadastrada ainda.</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              Adicione a primeira faixa para começar a cobrar por CEP.
            </p>
          </div>
        ) : (
          <ul>
            {linhas.map((l, i) => {
              const n = i + 1;
              const erro = erroLinha?.indice === i ? erroLinha.mensagem : null;
              const descricao = erro ? idErro(i) : undefined;
              return (
                <li
                  key={i}
                  className={`grid grid-cols-2 gap-x-4 gap-y-3 border-b px-4 py-4 md:grid-cols-[8rem_8rem_minmax(8rem,1fr)_minmax(0,1.4fr)_6rem] md:items-center md:py-3 ${
                    l.ativo ? "" : "bg-muted/60"
                  }`}
                >
                  <div>
                    <Label htmlFor={idInicio(i)} className="mb-1 text-xs md:sr-only">
                      CEP inicial
                    </Label>
                    <IMaskInput
                      id={idInicio(i)}
                      mask="00000-000"
                      value={l.cepInicio}
                      onAccept={(v: string) => atualizar(i, { cepInicio: v })}
                      onBlur={() => tentarGravar(linhas)}
                      inputMode="numeric"
                      placeholder="00000-000"
                      disabled={bloqueado}
                      aria-label={`CEP inicial da linha ${n}`}
                      aria-describedby={descricao}
                      aria-invalid={erro != null || undefined}
                      className={`${inputMascaraClassName} min-h-[44px] aria-invalid:border-destructive disabled:opacity-50`}
                    />
                  </div>
                  <div>
                    <Label htmlFor={idFim(i)} className="mb-1 text-xs md:sr-only">
                      CEP final
                    </Label>
                    <IMaskInput
                      id={idFim(i)}
                      mask="00000-000"
                      value={l.cepFim}
                      onAccept={(v: string) => atualizar(i, { cepFim: v })}
                      onBlur={() => tentarGravar(linhas)}
                      inputMode="numeric"
                      placeholder="00000-000"
                      disabled={bloqueado}
                      aria-label={`CEP final da linha ${n}`}
                      aria-describedby={descricao}
                      aria-invalid={erro != null || undefined}
                      className={`${inputMascaraClassName} min-h-[44px] aria-invalid:border-destructive disabled:opacity-50`}
                    />
                  </div>

                  <div className="col-span-2 md:col-span-1">
                    <Label htmlFor={idPreco(i)} className="mb-1 text-xs md:sr-only">
                      Preço do frete
                    </Label>
                    <CampoMoeda
                      id={idPreco(i)}
                      valor={l.taxa}
                      aoMudar={(v) => atualizar(i, { taxa: v })}
                      aoSair={() => tentarGravar(linhas)}
                      rotuloAcessivel={`Preço do frete da linha ${n}`}
                      descritoPor={descricao}
                      invalido={erro != null && paraNumero(l.taxa) == null}
                      desabilitado={bloqueado}
                    />
                  </div>

                  <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2 md:col-span-1">
                    <Label className={`${ALVO} cursor-pointer gap-2`}>
                      <Switch
                        checked={l.gratis !== null}
                        disabled={bloqueado}
                        onCheckedChange={(v) => alternarGratis(i, v === true)}
                        aria-label={`Frete grátis na linha ${n}`}
                      />
                      <span className="text-sm text-foreground">Frete grátis</span>
                    </Label>
                    {l.gratis !== null && (
                      <div className="flex items-center gap-2">
                        <Label htmlFor={idGratis(i)} className="text-xs text-muted-foreground">
                          a partir de
                        </Label>
                        <CampoMoeda
                          id={idGratis(i)}
                          valor={l.gratis}
                          aoMudar={(v) => atualizar(i, { gratis: v })}
                          aoSair={() => tentarGravar(linhas)}
                          rotuloAcessivel={`Frete grátis a partir de, na linha ${n}`}
                          descritoPor={descricao}
                          invalido={erro != null && paraNumero(l.gratis) == null}
                          desabilitado={bloqueado}
                          className="max-w-[10rem]"
                        />
                      </div>
                    )}
                  </div>

                  <div className="col-span-2 flex items-center justify-end gap-3 md:col-span-1 md:justify-start">
                    <Label className={`${ALVO} cursor-pointer gap-2`}>
                      <span className="text-xs text-muted-foreground md:sr-only">Ativa</span>
                      <Switch
                        checked={l.ativo}
                        disabled={bloqueado}
                        onCheckedChange={(v) => alternarAtiva(i, v === true)}
                        aria-label={`Faixa de CEP da linha ${n} ativa`}
                      />
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      className={ALVO}
                      disabled={bloqueado}
                      aria-label={`Remover a faixa de CEP da linha ${n}`}
                      onClick={() => setRemocaoPendente(i)}
                    >
                      <Trash2 className="size-4 text-destructive" aria-hidden />
                    </Button>
                  </div>

                  {erro && (
                    <p id={idErro(i)} className="col-span-2 text-xs font-medium text-destructive md:col-span-5">
                      {erro}
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
            disabled={bloqueado || linhas.length >= TETO_FAIXAS_CEP}
          >
            <Plus className="size-4" aria-hidden />
            {linhas.length >= TETO_FAIXAS_CEP
              ? `Limite de ${TETO_FAIXAS_CEP} faixas de CEP`
              : "Adicionar faixa de CEP"}
          </Button>
        </div>

        <div className="border-t bg-muted px-4 py-3">
          <p className="text-sm text-muted-foreground">
            A faixa é inclusiva: pedidos com CEP entre o inicial e o final pagam o preço da linha.
            CEP fora de todas as faixas{" "}
            {taxaForaZona == null ? "não recebe entrega." : `paga ${formatarMoeda(taxaForaZona)}.`}
          </p>
        </div>
      </Card>

      <AlertDialog
        open={remocaoPendente !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setRemocaoPendente(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover esta faixa de CEP?</AlertDialogTitle>
            <AlertDialogDescription>
              {linhaRemovida && linhaRemovida.cepInicio !== "" && linhaRemovida.cepFim !== ""
                ? `A faixa de ${linhaRemovida.cepInicio} a ${linhaRemovida.cepFim} deixa de valer na vitrine.`
                : "A linha sai da tabela."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={ALVO}>Cancelar</AlertDialogCancel>
            <Button type="button" variant="destructive" className={ALVO} onClick={confirmarRemocao}>
              Remover
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {gravacao.dialogo}
    </>
  );
}
