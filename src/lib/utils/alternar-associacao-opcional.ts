/**
 * Orquestração do toggle de associação de opcionais (issue 213).
 *
 * Vive fora do componente por um motivo só: **a ORDEM das chamadas é a trava de
 * uma corrida**, e dentro do `OpcionaisClient` ela era inalcançável por teste.
 * `alternar()` é fechada sobre refs e state, e só roda a partir de um
 * `onCheckedChange` — `renderToStaticMarkup` não dispara handler nenhum e este
 * projeto não tem jsdom. Inverter a ordem aqui não quebraria teste algum.
 * Mesmo motivo que já tirou `criarSalvamentoCoalescido` de dentro da UI.
 *
 * A corrida: o modo reordenar salva com debounce de 500ms. Um toggle disparado
 * com movimento ainda na fila mandaria à RPC `reordenar_opcionais_da_categoria`
 * uma sequência de ids que não bate com as linhas persistidas — a RPC exige
 * permutação COMPLETA do par (loja, categoria) e confere `row_count`, então a
 * transação inteira cai e o lojista vê erro genérico sem causa visível.
 *
 * Por isso: **flush do reorder pendente → novo conjunto → gravação → sucesso**.
 * Trocar o conjunto ANTES do flush também quebraria, por outro caminho: a `key`
 * da lista deriva dos marcados, então o React remontaria o componente e o
 * `finalizar()` cairia no handle da instância nova, que não tem o movimento
 * pendente.
 *
 * Reentrância é barrada por quem chama (um ref no componente): dois toggles
 * simultâneos disputariam o mesmo flush.
 */

export type ResultadoAssociacao = { ok: true } | { ok: false; erro: string };

export type DepsAlternarAssociacao = {
  /** Flush do salvamento coalescido pendente. Ausente = não há lista montada. */
  finalizarReordenacao: () => Promise<void> | undefined;
  /** Grava o conjunto COMPLETO (a action monta o delta). */
  salvar: (ids: string[]) => Promise<ResultadoAssociacao>;
  /** Aplica a seleção na tela (preview otimista, e o revert em caso de falha). */
  aplicarSelecao: (selecao: Set<string>) => void;
  definirStatus: (status: "" | "salvando" | "salvo") => void;
  /** Mensagem genérica na UI. O detalhe fica no log do servidor. */
  avisarErro: (mensagem: string) => void;
  /** Anúncio para leitor de tela, já formatado por quem conhece o domínio. */
  anunciar: (frase: string) => void;
  /** `router.refresh()` — só depois de o servidor confirmar. */
  aoSucesso: () => void;
  /** Registra a exceção real. Injetado para o teste não sujar a saída. */
  registrarErro?: (erro: unknown) => void;
};

export const ERRO_GENERICO_ASSOCIACAO =
  "Não foi possível salvar. Tente novamente.";

/**
 * Devolve o conjunto que resulta de marcar/desmarcar um id. Puro: não toca no
 * conjunto recebido, porque o anterior é o estado de revert em caso de falha.
 */
export function proximaSelecao(
  atuais: ReadonlySet<string>,
  catOpcId: string,
  marcado: boolean,
): Set<string> {
  const proximo = new Set(atuais);
  if (marcado) {
    proximo.add(catOpcId);
  } else {
    proximo.delete(catOpcId);
  }
  return proximo;
}

/**
 * Executa a alternância inteira. Devolve `true` quando o servidor confirmou.
 *
 * @param frase anúncio de sucesso, montado por quem conhece os nomes.
 */
export async function alternarAssociacaoOpcional(
  atuais: ReadonlySet<string>,
  catOpcId: string,
  marcado: boolean,
  frase: string,
  deps: DepsAlternarAssociacao,
): Promise<boolean> {
  const proximo = proximaSelecao(atuais, catOpcId, marcado);
  deps.definirStatus("salvando");

  try {
    // 1º: flush do que estiver pendente. NUNCA depois de aplicar a seleção.
    await deps.finalizarReordenacao();

    // 2º: só agora a tela muda (a `key` da lista depende disto).
    deps.aplicarSelecao(proximo);

    // 3º: gravação.
    const r = await deps.salvar(Array.from(proximo));
    if (!r.ok) {
      deps.aplicarSelecao(new Set(atuais));
      deps.definirStatus("");
      deps.avisarErro(r.erro);
      return false;
    }

    deps.definirStatus("salvo");
    deps.anunciar(frase);
    deps.aoSucesso();
    return true;
  } catch (erro) {
    // `{ ok: false }` já foi tratado acima; aqui é exceção de verdade (rede
    // caiu, action indisponível). Sem este catch o status ficaria preso em
    // "salvando" para sempre e o lojista não receberia aviso nenhum.
    deps.registrarErro?.(erro);
    deps.aplicarSelecao(new Set(atuais));
    deps.definirStatus("");
    deps.avisarErro(ERRO_GENERICO_ASSOCIACAO);
    return false;
  }
}
