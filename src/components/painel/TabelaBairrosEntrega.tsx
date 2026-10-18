"use client";

import { useId, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ALVO,
  CampoMoeda,
  FaixaTrocaDeForma,
  IndicadorGravacao,
  useFocoPendente,
  useGravacaoDoEditor,
  type PropsEditorZonas,
} from "@/components/painel/pecasEntrega";
import {
  chaveDaMontagem,
  grupoComBairro,
  lerGruposBairro,
  montarPayloadBairros,
  paraNumero,
  type GrupoBairroEditavel,
  type PayloadBairros,
} from "@/components/painel/payloadZona";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import {
  TETO_BAIRROS_POR_GRUPO,
  TETO_BAIRROS_TOTAL,
  TETO_GRUPOS_BAIRRO,
} from "@/lib/validacoes/entrega";

/**
 * Editor de frete por bairros (issue 325). Client component.
 *
 * Cada linha é um PREÇO com um grupo de bairros (uma zona `bairro`). Abre com
 * `lerGruposBairro` (nada é gravado ao abrir). Grava depois de adicionar ou
 * remover bairro, no blur de preço/frete grátis, no switch "Ativa" e depois de
 * remover o preço. Bairro repetido é barrado com `normalizarBairro`, a MESMA
 * normalização do casamento na vitrine. O bairro do pedido vem do CEP do
 * cliente (ViaCEP no servidor), não do que ele digita; o frete do pedido é
 * recalculado no servidor.
 */
export function TabelaBairrosEntrega({
  zonasIniciais,
  formaGravada,
  zonasParaConfirmacao,
  salvar,
  aoGravar,
  bloqueado,
  taxaForaZona,
}: PropsEditorZonas) {
  const idBase = useId();

  const iniciais = useMemo(() => lerGruposBairro(zonasIniciais), [zonasIniciais]);
  const [grupos, setGrupos] = useState<GrupoBairroEditavel[]>(iniciais);
  const [remocaoPendente, setRemocaoPendente] = useState<number | null>(null);

  const gravacao = useGravacaoDoEditor<PayloadBairros>({
    forma: "bairro",
    formaGravada,
    kmForaDoFormato: false,
    zonasParaConfirmacao,
    salvar,
    aoGravar,
    bloqueado,
    chaveInicial: () => chaveDaMontagem(montarPayloadBairros(iniciais)),
  });
  const { erroLinha, setErroLinha } = gravacao;

  const focar = useFocoPendente();

  const idNovo = (i: number) => `${idBase}-novo-${i}`;
  const idPreco = (i: number) => `${idBase}-preco-${i}`;
  const idGratis = (i: number) => `${idBase}-gratis-${i}`;
  const idErro = (i: number) => `${idBase}-erro-${i}`;

  const totalBairros = grupos.reduce((n, g) => n + g.bairros.length, 0);

  /** Tenta gravar o estado dado. Nunca grava grupo incompleto (erro na linha). */
  function tentarGravar(estado: GrupoBairroEditavel[]) {
    gravacao.tentarGravar(montarPayloadBairros(estado));
  }

  function atualizar(i: number, parcial: Partial<GrupoBairroEditavel>) {
    setGrupos((atual) => atual.map((g, j) => (j === i ? { ...g, ...parcial } : g)));
  }

  function adicionarBairro(i: number) {
    const nome = grupos[i].novoBairro.trim().replace(/\s+/g, " ");
    if (nome === "") return;
    const repetido = grupoComBairro(grupos, nome);
    if (repetido != null) {
      const taxa = paraNumero(grupos[repetido].taxa);
      setErroLinha({
        indice: i,
        mensagem:
          taxa == null
            ? `${nome} já está em outro preço.`
            : `${nome} já está no preço de ${formatarMoeda(taxa)}.`,
      });
      return;
    }
    if (grupos[i].bairros.length >= TETO_BAIRROS_POR_GRUPO) {
      setErroLinha({ indice: i, mensagem: `Cadastre até ${TETO_BAIRROS_POR_GRUPO} bairros por preço.` });
      return;
    }
    if (totalBairros >= TETO_BAIRROS_TOTAL) {
      setErroLinha({ indice: i, mensagem: `Cadastre no máximo ${TETO_BAIRROS_TOTAL} bairros.` });
      return;
    }
    const novos = grupos.map((g, j) => (j === i ? { ...g, bairros: [...g.bairros, nome], novoBairro: "" } : g));
    setGrupos(novos);
    // Grava só se o grupo já tem preço; sem preço, espera o blur do preço.
    if (paraNumero(novos[i].taxa) == null) {
      setErroLinha(null);
      return;
    }
    tentarGravar(novos);
  }

  function removerBairro(i: number, nome: string) {
    const novos = grupos.map((g, j) => (j === i ? { ...g, bairros: g.bairros.filter((b) => b !== nome) } : g));
    setGrupos(novos);
    tentarGravar(novos);
  }

  function alternarAtivo(i: number, ligado: boolean) {
    const novos = grupos.map((g, j) => (j === i ? { ...g, ativo: ligado } : g));
    setGrupos(novos);
    tentarGravar(novos);
  }

  function alternarGratis(i: number, ligado: boolean) {
    const novos = grupos.map((g, j) => (j === i ? { ...g, gratis: ligado ? "" : null } : g));
    setGrupos(novos);
    if (ligado) {
      focar(idGratis(i));
      return;
    }
    tentarGravar(novos);
  }

  function adicionarGrupo() {
    if (grupos.length >= TETO_GRUPOS_BAIRRO) return;
    setGrupos((atual) => [...atual, { bairros: [], novoBairro: "", taxa: "", gratis: null, ativo: true }]);
    focar(idNovo(grupos.length));
  }

  function confirmarRemocao() {
    if (remocaoPendente == null) return;
    const novos = grupos.filter((_, j) => j !== remocaoPendente);
    setGrupos(novos);
    setRemocaoPendente(null);
    tentarGravar(novos);
  }

  const grupoRemovido = remocaoPendente == null ? null : grupos[remocaoPendente];

  return (
    <>
      <FaixaTrocaDeForma forma="bairro" formaGravada={formaGravada} />

      <Card className="gap-0 py-0">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="font-heading text-base font-medium text-foreground">Preços por bairro</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Junte no mesmo preço os bairros que pagam o mesmo frete. Tudo é salvo sozinho ao sair de
              cada campo.
            </p>
          </div>
          <IndicadorGravacao estado={gravacao.estadoGravacao} />
        </div>

        {grupos.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">Nenhum preço por bairro cadastrado ainda.</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              Adicione o primeiro preço e os bairros que ele atende.
            </p>
          </div>
        ) : (
          <ul>
            {grupos.map((g, i) => {
              const n = i + 1;
              const erro = erroLinha?.indice === i ? erroLinha.mensagem : null;
              const descricao = erro ? idErro(i) : undefined;
              return (
                <li key={i} className={`space-y-3 border-b px-4 py-4 ${g.ativo ? "" : "bg-muted/60"}`}>
                  <div className="space-y-2">
                    <Label htmlFor={idNovo(i)} className="text-xs">
                      Bairros deste preço
                    </Label>
                    {g.bairros.length > 0 && (
                      <ul aria-label={`Bairros do preço ${n}`} className="flex flex-wrap gap-2">
                        {g.bairros.map((b) => (
                          <li key={b}>
                            <Badge variant="secondary" className="h-auto gap-1 py-0.5 pr-0.5 text-sm">
                              {b}
                              <button
                                type="button"
                                aria-label={`Remover ${b}`}
                                disabled={bloqueado}
                                onClick={() => removerBairro(i, b)}
                                className={`${ALVO} -my-3 inline-flex items-center justify-center rounded-full hover:text-destructive disabled:opacity-50`}
                              >
                                <X className="size-3.5" aria-hidden />
                              </button>
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <Input
                        id={idNovo(i)}
                        value={g.novoBairro}
                        disabled={bloqueado}
                        onChange={(e) => atualizar(i, { novoBairro: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            adicionarBairro(i);
                          }
                        }}
                        placeholder="Nome do bairro"
                        aria-describedby={descricao}
                        className="min-h-[44px]"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className={ALVO}
                        disabled={bloqueado}
                        aria-label={`Adicionar bairro ao preço ${n}`}
                        onClick={() => adicionarBairro(i)}
                      >
                        <Plus className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                    <div>
                      <Label htmlFor={idPreco(i)} className="mb-1 text-xs">
                        Preço do frete
                      </Label>
                      <CampoMoeda
                        id={idPreco(i)}
                        valor={g.taxa}
                        aoMudar={(v) => atualizar(i, { taxa: v })}
                        aoSair={() => tentarGravar(grupos)}
                        rotuloAcessivel={`Preço do frete do preço ${n}`}
                        descritoPor={descricao}
                        invalido={erro != null && paraNumero(g.taxa) == null}
                        desabilitado={bloqueado}
                        className="max-w-[12rem]"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <Label className={`${ALVO} cursor-pointer gap-2`}>
                        <Switch
                          checked={g.gratis !== null}
                          disabled={bloqueado}
                          onCheckedChange={(v) => alternarGratis(i, v === true)}
                          aria-label={`Frete grátis no preço ${n}`}
                        />
                        <span className="text-sm text-foreground">Frete grátis</span>
                      </Label>
                      {g.gratis !== null && (
                        <div className="flex items-center gap-2">
                          <Label htmlFor={idGratis(i)} className="text-xs text-muted-foreground">
                            a partir de
                          </Label>
                          <CampoMoeda
                            id={idGratis(i)}
                            valor={g.gratis}
                            aoMudar={(v) => atualizar(i, { gratis: v })}
                            aoSair={() => tentarGravar(grupos)}
                            rotuloAcessivel={`Frete grátis a partir de, no preço ${n}`}
                            descritoPor={descricao}
                            invalido={erro != null && paraNumero(g.gratis) == null}
                            desabilitado={bloqueado}
                            className="max-w-[10rem]"
                          />
                        </div>
                      )}
                    </div>

                    <div className="ml-auto flex items-center gap-3">
                      <Label className={`${ALVO} cursor-pointer gap-2`}>
                        <span className="text-xs text-muted-foreground">Ativo</span>
                        <Switch
                          checked={g.ativo}
                          disabled={bloqueado}
                          onCheckedChange={(v) => alternarAtivo(i, v === true)}
                          aria-label={`Preço ${n} ativo`}
                        />
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        className={ALVO}
                        disabled={bloqueado}
                        aria-label={`Remover o preço ${n} e os bairros dele`}
                        onClick={() => setRemocaoPendente(i)}
                      >
                        <Trash2 className="size-4 text-destructive" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  {erro && (
                    <p id={idErro(i)} className="text-xs font-medium text-destructive">
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
            onClick={adicionarGrupo}
            disabled={bloqueado || grupos.length >= TETO_GRUPOS_BAIRRO}
          >
            <Plus className="size-4" aria-hidden />
            {grupos.length >= TETO_GRUPOS_BAIRRO
              ? `Limite de ${TETO_GRUPOS_BAIRRO} preços por bairro`
              : "Adicionar preço por bairro"}
          </Button>
        </div>

        <div className="space-y-1 border-t bg-muted px-4 py-3 text-sm text-muted-foreground">
          <p>
            Escreva o bairro como ele aparece no CEP dos Correios. Maiúsculas e acentos não fazem
            diferença. O bairro do pedido vem do CEP do cliente, não do que ele digita.
          </p>
          <p>
            Bairro fora de todos os preços{" "}
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
            <AlertDialogTitle>Remover este preço?</AlertDialogTitle>
            <AlertDialogDescription>
              {grupoRemovido && grupoRemovido.bairros.length > 0
                ? `Estes bairros deixam de valer na vitrine: ${grupoRemovido.bairros.join(", ")}.`
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
