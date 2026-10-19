"use client";

import { useId, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  lerBairrosIndividuais,
  montarPayloadPorBairro,
  paraNumero,
  type BairroEditavel,
  type PayloadBairros,
} from "@/components/painel/payloadZona";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { TETO_BAIRROS_TOTAL } from "@/lib/validacoes/entrega";

/**
 * Editor de frete por bairro, uma linha por bairro (issue 325). Client component.
 *
 * É a outra vista da `TabelaBairrosEntrega`: o lojista diz "o frete para o
 * bairro X é Y" e `montarPayloadPorBairro` junta os bairros de preço igual no
 * MESMO payload de grupos, gravado pela mesma action. Grava no blur do nome
 * (se a linha já tem frete), do frete e do frete grátis, no switch "Ativo" e
 * ao remover a linha. O frete do pedido é recalculado no servidor.
 */
export function TabelaFretePorBairro({
  zonasIniciais,
  salvar,
  aoGravar,
  bloqueado,
  taxaForaZona,
}: PropsEditorZonas) {
  const idBase = useId();

  const iniciais = useMemo(() => lerBairrosIndividuais(zonasIniciais), [zonasIniciais]);
  const [linhas, setLinhas] = useState<BairroEditavel[]>(iniciais);

  const gravacao = useGravacaoDoEditor<PayloadBairros>({
    kmForaDoFormato: false,
    salvar,
    aoGravar,
    bloqueado,
    chaveInicial: () => chaveDaMontagem(montarPayloadPorBairro(iniciais)),
  });
  const { erroLinha, setErroLinha } = gravacao;

  const focar = useFocoPendente();

  const idNome = (i: number) => `${idBase}-nome-${i}`;
  const idPreco = (i: number) => `${idBase}-preco-${i}`;
  const idGratis = (i: number) => `${idBase}-gratis-${i}`;
  const idErro = (i: number) => `${idBase}-erro-${i}`;

  function tentarGravar(estado: BairroEditavel[]) {
    gravacao.tentarGravar(montarPayloadPorBairro(estado));
  }

  function atualizar(i: number, parcial: Partial<BairroEditavel>) {
    setLinhas((atual) => atual.map((l, j) => (j === i ? { ...l, ...parcial } : l)));
  }

  /** Nome sem frete ainda: espera o blur do frete em vez de marcar erro. */
  function sairDoNome(i: number) {
    if (paraNumero(linhas[i].taxa) == null) {
      setErroLinha(null);
      return;
    }
    tentarGravar(linhas);
  }

  function alternarAtivo(i: number, ligado: boolean) {
    const novas = linhas.map((l, j) => (j === i ? { ...l, ativo: ligado } : l));
    setLinhas(novas);
    tentarGravar(novas);
  }

  function alternarGratis(i: number, ligado: boolean) {
    const novas = linhas.map((l, j) => (j === i ? { ...l, gratis: ligado ? "" : null } : l));
    setLinhas(novas);
    if (ligado) {
      focar(idGratis(i));
      return;
    }
    tentarGravar(novas);
  }

  function adicionarLinha() {
    if (linhas.length >= TETO_BAIRROS_TOTAL) return;
    setLinhas((atual) => [...atual, { nome: "", taxa: "", gratis: null, ativo: true }]);
    focar(idNome(linhas.length));
  }

  function removerLinha(i: number) {
    const novas = linhas.filter((_, j) => j !== i);
    setLinhas(novas);
    tentarGravar(novas);
  }

  return (
    <>
      <Card className="gap-0 py-0">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="font-heading text-base font-medium text-foreground">Frete por bairro</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cadastre cada bairro com o frete dele. Tudo é salvo sozinho ao sair de cada campo.
            </p>
          </div>
          <IndicadorGravacao estado={gravacao.estadoGravacao} />
        </div>

        {linhas.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">Nenhum bairro cadastrado ainda.</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              Adicione o primeiro bairro e o frete dele.
            </p>
          </div>
        ) : (
          <ul>
            {linhas.map((l, i) => {
              const n = i + 1;
              const erro = erroLinha?.indice === i ? erroLinha.mensagem : null;
              const descricao = erro ? idErro(i) : undefined;
              const rotulo = l.nome.trim() === "" ? `linha ${n}` : l.nome.trim();
              return (
                <li key={i} className={`space-y-3 border-b px-4 py-4 ${l.ativo ? "" : "bg-muted/60"}`}>
                  <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                    <div className="min-w-[12rem] flex-1">
                      <Label htmlFor={idNome(i)} className="mb-1 text-xs">
                        Bairro
                      </Label>
                      <Input
                        id={idNome(i)}
                        value={l.nome}
                        disabled={bloqueado}
                        onChange={(e) => atualizar(i, { nome: e.target.value })}
                        onBlur={() => sairDoNome(i)}
                        placeholder="Nome do bairro"
                        aria-describedby={descricao}
                        aria-invalid={erro != null && l.nome.trim() === "" ? true : undefined}
                        className="min-h-[44px]"
                      />
                    </div>
                    <div>
                      <Label htmlFor={idPreco(i)} className="mb-1 text-xs">
                        Frete
                      </Label>
                      <CampoMoeda
                        id={idPreco(i)}
                        valor={l.taxa}
                        aoMudar={(v) => atualizar(i, { taxa: v })}
                        aoSair={() => tentarGravar(linhas)}
                        rotuloAcessivel={`Frete de ${rotulo}`}
                        descritoPor={descricao}
                        invalido={erro != null && paraNumero(l.taxa) == null}
                        desabilitado={bloqueado}
                        className="max-w-[12rem]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <Label className={`${ALVO} cursor-pointer gap-2`}>
                        <Switch
                          checked={l.gratis !== null}
                          disabled={bloqueado}
                          onCheckedChange={(v) => alternarGratis(i, v === true)}
                          aria-label={`Frete grátis em ${rotulo}`}
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
                            rotuloAcessivel={`Frete grátis a partir de, em ${rotulo}`}
                            descritoPor={descricao}
                            invalido={erro != null && paraNumero(l.gratis) == null}
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
                          checked={l.ativo}
                          disabled={bloqueado}
                          onCheckedChange={(v) => alternarAtivo(i, v === true)}
                          aria-label={`${rotulo} ativo`}
                        />
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        className={ALVO}
                        disabled={bloqueado}
                        aria-label={`Remover ${rotulo}`}
                        onClick={() => removerLinha(i)}
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
            onClick={adicionarLinha}
            disabled={bloqueado || linhas.length >= TETO_BAIRROS_TOTAL}
          >
            <Plus className="size-4" aria-hidden />
            {linhas.length >= TETO_BAIRROS_TOTAL ? `Limite de ${TETO_BAIRROS_TOTAL} bairros` : "Adicionar bairro"}
          </Button>
        </div>

        <div className="space-y-1 border-t bg-muted px-4 py-3 text-sm text-muted-foreground">
          <p>
            Escreva o bairro como ele aparece no CEP dos Correios. Maiúsculas e acentos não fazem
            diferença. O bairro do pedido vem do CEP do cliente, não do que ele digita.
          </p>
          <p>
            Bairro fora da lista{" "}
            {taxaForaZona == null ? "não recebe entrega." : `paga ${formatarMoeda(taxaForaZona)}.`}
          </p>
        </div>
      </Card>

      {gravacao.dialogo}
    </>
  );
}
