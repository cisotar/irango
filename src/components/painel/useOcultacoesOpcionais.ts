"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  chaveDoPar,
  type AlteracaoOcultacao,
  type OcultoOpcional,
} from "@/lib/utils/opcionais-do-produto";

// O tipo do lote é o MESMO que as actions validam (`planejarOcultacoes`): uma
// cópia aqui divergiria em silêncio do payload que o servidor aceita.
export type { AlteracaoOcultacao } from "@/lib/utils/opcionais-do-produto";

export type ResultadoOcultacoes = { ok: true } | { ok: false; erro: string };

/** A action injetada: lojista (`salvarOcultacoesOpcionais`) ou o wrapper admin com `lojaId`. */
export type SalvarOcultacoes = (
  alteracoes: AlteracaoOcultacao[],
) => Promise<ResultadoOcultacoes>;

export type OcultacoesOpcionais = {
  /** O grupo está oculto neste produto AGORA (servidor + escritas em voo). */
  oculto: (produtoId: string, grupoId: string) => boolean;
  /** Inverte um par. `true` = gravou; `false` = falhou, já revertido e anunciado. */
  alternar: (produtoId: string, grupoId: string) => Promise<boolean>;
  /** Aplica um lote numa chamada. `[]` → `true` sem I/O (o zod recusaria vazio). */
  aplicarLote: (alteracoes: readonly AlteracaoOcultacao[]) => Promise<boolean>;
};

export type DepsOcultacoes = {
  iniciais: readonly OcultoOpcional[];
  salvar: SalvarOcultacoes;
  /** Re-render (o estado mudou). */
  aoMudar: () => void;
  /** Anúncio de falha — a frase já é genérica (da action ou a de rede abaixo). */
  aoFalhar: (mensagem: string) => void;
  /** Sucesso: `router.refresh()` traz a verdade do servidor. */
  aoSalvar: () => void;
};

/** Máquina + os dois ajustes que só o hook usa. */
export type MaquinaOcultacoes = OcultacoesOpcionais & {
  /** Linhas novas do servidor (após o `router.refresh()`). */
  ressemear: (linhas: readonly OcultoOpcional[]) => void;
  /** A action do render mais recente (a do admin é uma closure nova a cada render). */
  trocarSalvar: (salvar: SalvarOcultacoes) => void;
};

/** Quando a action LANÇA (rede, servidor fora): nenhum detalhe interno chega à tela. */
const ERRO_GENERICO = "Não foi possível salvar. Tente de novo.";

/** Constante de módulo: um `[]` literal por render re-semearia o hook a cada vez. */
export const SEM_OCULTOS: readonly OcultoOpcional[] = [];

function paresDoServidor(linhas: readonly OcultoOpcional[]): Set<string> {
  return new Set(linhas.map((l) => chaveDoPar(l.produto_id, l.categoria_opcional_id)));
}

/**
 * [331] Estado de UI da ocultação de grupo por produto, PURO (sem React): o
 * `useOcultacoesOpcionais` abaixo é só a casca. Fica exportado para o teste em
 * `environment: node`, onde um clique não re-renderiza nada (mesmo padrão de
 * `alternarAssociacaoOpcional`).
 *
 * Duas camadas:
 *  - `base`: pares ocultos segundo o SERVIDOR (semente) mais os que já
 *    gravaram com sucesso — assim a tela não pisca de volta enquanto o
 *    `router.refresh()` ainda está a caminho;
 *  - `emVoo`: a intenção otimista de cada par ainda sem resposta, com um token
 *    por escrita. Falhou → sai SÓ o par (ou os pares do lote) daquela escrita e
 *    o valor volta a ser o da `base`. Duas escritas no mesmo par não se
 *    atropelam: só a mais recente manda na tela.
 *
 * Nada aqui é barreira: o servidor revalida tudo (zod, posse, FK composta).
 */
export function criarOcultacoesOtimistas(deps: DepsOcultacoes): MaquinaOcultacoes {
  let base = paresDoServidor(deps.iniciais);
  let salvar = deps.salvar;
  const emVoo = new Map<string, { oculto: boolean; token: number }>();
  let proximoToken = 0;

  function oculto(produtoId: string, grupoId: string): boolean {
    const chave = chaveDoPar(produtoId, grupoId);
    return emVoo.get(chave)?.oculto ?? base.has(chave);
  }

  async function gravar(alteracoes: readonly AlteracaoOcultacao[]): Promise<boolean> {
    if (alteracoes.length === 0) return true;
    const token = ++proximoToken;
    for (const a of alteracoes) {
      emVoo.set(chaveDoPar(a.produtoId, a.categoriaOpcionalId), { oculto: a.oculto, token });
    }
    deps.aoMudar();

    let erro: string | null;
    try {
      const resultado = await salvar([...alteracoes]);
      erro = resultado.ok ? null : resultado.erro;
    } catch {
      erro = ERRO_GENERICO;
    }

    for (const a of alteracoes) {
      const chave = chaveDoPar(a.produtoId, a.categoriaOpcionalId);
      if (erro == null) {
        if (a.oculto) base.add(chave);
        else base.delete(chave);
      }
      // Uma escrita mais nova no mesmo par segue em voo: ela é quem manda.
      if (emVoo.get(chave)?.token === token) emVoo.delete(chave);
    }
    deps.aoMudar();

    if (erro != null) {
      deps.aoFalhar(erro || ERRO_GENERICO);
      return false;
    }
    deps.aoSalvar();
    return true;
  }

  return {
    oculto,
    alternar: (produtoId, grupoId) =>
      gravar([
        { produtoId, categoriaOpcionalId: grupoId, oculto: !oculto(produtoId, grupoId) },
      ]),
    aplicarLote: gravar,
    ressemear(linhas) {
      base = paresDoServidor(linhas);
      deps.aoMudar();
    },
    trocarSalvar(novo) {
      salvar = novo;
    },
  };
}

/**
 * [331] UMA instância por tela: `ProdutosClient` (card + `FormProduto`) e
 * `OpcionaisClient` ("Por produto"). O admin passa pelas mesmas telas com a
 * action admin injetada. Re-semeia quando chegam linhas NOVAS do servidor
 * (identidade da prop, que só muda num `router.refresh()`).
 */
export function useOcultacoesOpcionais(
  ocultosDoServidor: readonly OcultoOpcional[],
  salvar: SalvarOcultacoes,
): OcultacoesOpcionais {
  const router = useRouter();
  const [versao, setVersao] = useState(0);

  const [maquina] = useState(() =>
    criarOcultacoesOtimistas({
      iniciais: ocultosDoServidor,
      salvar,
      aoMudar: () => setVersao((v) => v + 1),
      aoFalhar: (mensagem) => toast.error(mensagem),
      aoSalvar: () => router.refresh(),
    }),
  );

  // A action do admin é uma closure nova a cada render: a máquina usa sempre a
  // mais recente. Em efeito, nunca no render (`react-hooks/refs`).
  useEffect(() => {
    maquina.trocarSalvar(salvar);
  }, [maquina, salvar]);

  const semeadoCom = useRef(ocultosDoServidor);
  useEffect(() => {
    if (semeadoCom.current === ocultosDoServidor) return;
    semeadoCom.current = ocultosDoServidor;
    maquina.ressemear(ocultosDoServidor);
  }, [maquina, ocultosDoServidor]);

  // Objeto novo a cada mudança do mapa (`versao` vai junto só por isso): quem
  // recebe `ocultacoes` por prop enxerga a troca.
  return useMemo(
    () => ({
      oculto: maquina.oculto,
      alternar: maquina.alternar,
      aplicarLote: maquina.aplicarLote,
      versao,
    }),
    [maquina, versao],
  );
}
