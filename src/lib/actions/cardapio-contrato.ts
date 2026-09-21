/**
 * Contrato NEUTRO do cardápio — fonte ÚNICA das frases, dos reconhecedores de
 * erro, da normalização de prazo pelo fuso e do resumo da prévia que os DOIS
 * mundos de escrita precisam aplicar igual (issue 269, D2).
 *
 * Irmão direto de `produto-contrato.ts` (issue 241), e pelo mesmo motivo: o hub
 * admin escreve com `service_role`, que tem BYPASSRLS. Nenhuma regra que more
 * só na RLS protege aquele caminho — `cardapios_escrita_propria` e
 * `cardapio_produtos_escrita_propria` não o alcançam. O que protege é a
 * PARIDADE com o caminho do lojista, e paridade por cópia vira drift na
 * primeira correção que alguém fizer de um lado só. Uma cópia, dois callers:
 *   - lojista: `src/lib/actions/cardapio.ts`
 *   - admin:   `src/app/admin/assinantes/actions/admin-cardapios.ts`
 *
 * Módulo NEUTRO de propósito (sem `'use server'`): arquivo `'use server'` só
 * pode exportar função async, então não poderia exportar estas constantes, os
 * helpers síncronos nem os tipos. Mesmo padrão de `produto-contrato.ts`,
 * `patches-loja.ts` e `admin-loja.ts`.
 *
 * NADA aqui faz I/O. A leitura de "quem ficaria órfão" e a da prévia moram em
 * `lib/supabase/queries/cardapios.ts`, porque query não se escreve inline
 * (`architecture.md` §8) e as duas servem o client autenticado do lojista E o
 * `svc` do admin sem alteração.
 */

import {
  ehMensagemDeVigencia,
  type DadosCardapio,
} from "@/lib/validacoes/cardapio";
import { instanteNoFuso } from "@/lib/utils/fusoLoja";
import { calcularFimDoPreset } from "@/lib/utils/calcularFimDoPreset";
import { ehErroDeExclusivoSemCardapio } from "@/lib/actions/produto-contrato";

// ════════════════════════════════════════════════════════════════════ Tipos

/** Resultado de uma action de LOTE (RN-09): sucesso mudo ou uma frase. */
export type Resultado = { ok: true } | { ok: false; erro: string };

/** Resultado de uma action de CRUD do cardápio (issue 255). */
export type ResultadoCardapio = { ok: true } | { ok: false; erro: string };

/**
 * A remoção devolve quantos produtos exclusivos travam a operação, porque o
 * diálogo precisa desse número para oferecer "converter os N para o menu"
 * (§Páginas, `/painel/cardapios`). `exclusivos: 0` em qualquer outra falha.
 */
export type ResultadoRemocao =
  | { ok: true }
  | { ok: false; erro: string; exclusivos: number };

/** O mínimo que a prévia lê de cada produto do lote. */
export type LinhaDaPrevia = {
  nome: string;
  visibilidade: string;
  oculto: boolean;
};

/** Os números que o diálogo de confirmação mostra (D14 + 260). */
export type ResumoDaPrevia = {
  total: number;
  nomes: string[];
  menu: number;
  cardapio: number;
  /**
   * [260] Quantos do lote estão `oculto = true`. A RPC de categoria inclui
   * produto oculto (RN-10) e o diálogo NÃO o esconde da contagem — a frase
   * "N deles estão ocultos e continuam ocultos" (design §10.2, trava 5)
   * precisa deste número, e ele sai da MESMA leitura que já acontecia.
   * Contá-lo no cliente seria contar uma seleção que pode estar velha.
   */
  ocultos: number;
};

export type Previa = ({ ok: true } & ResumoDaPrevia) | { ok: false; erro: string };

// ═════════════════════════════════════════════════════════════════ Mensagens

/**
 * A ÚNICA mensagem que quem salvou vê, para QUALQUER falha de lote (RN-09).
 * Mensagens distintas por tipo de falha virariam oráculo de existência de id.
 */
export const MSG_GENERICA_LOTE =
  "Não foi possível aplicar o cardápio aos produtos selecionados.";

/**
 * [261] A OUTRA ponta do trigger de RN-14: tirar o ÚLTIMO cardápio de um
 * produto exclusivo o deixaria órfão. É a única falha do lote que ganha frase
 * própria — ela é regra de negócio do próprio lojista, nomeia a saída
 * ("Devolver ao menu", que a barra de ação oferece ao lado) e não diz nada
 * sobre existência de id alheio (id de outra loja nem chega ao trigger: o
 * `.eq("loja_id")` e a RLS o descartam antes, com a mesma resposta de id
 * inexistente). Todo o resto continua genérico.
 */
export const MSG_ORFAO_NO_LOTE =
  "Um dos produtos selecionados só aparece por causa deste cardápio e sumiria da vitrine. Devolva-o ao menu antes de tirá-lo do cardápio.";

export const MSG_SALVAR = "Não foi possível salvar o cardápio.";
export const MSG_REMOVER = "Não foi possível remover o cardápio.";
export const MSG_CONVERTER =
  "Não foi possível converter os produtos deste cardápio para o menu.";
export const MSG_LOJA = "Loja não encontrada.";
export const MSG_INVALIDO = "Cardápio inválido.";

/**
 * A MESMA recusa de RN-14, SEM número — a frase do backstop do trigger.
 *
 * Por que sem número: o backstop só dispara numa CORRIDA no COMMIT, depois de
 * a leitura de `buscarProdutosQueFicariamOrfaos` ter devolvido zero órfãos.
 * Nesse instante o servidor não tem contagem confiável nenhuma: um literal `1`
 * seria ficção, e reler seria uma segunda leitura igualmente racy — e
 * indisponível no ramo `catch`, onde o client pode nem ter sido construído.
 * Sem número a frase continua acionável e não mente. Quem salvou repete a
 * remoção e o caminho normal, que lê ANTES da transação, devolve o número
 * exato e o botão de conversão.
 */
export const MSG_EXCLUSIVOS_SEM_NUMERO =
  "Alguns produtos só aparecem por causa deste cardápio e sumiriam da vitrine. Converta esses produtos para o menu antes de remover o cardápio.";

/** A recusa de RN-14 COM o número que o diálogo repete no botão. */
export function mensagemExclusivos(n: number): string {
  return n === 1
    ? "1 produto só aparece por causa deste cardápio e sumiria da vitrine. Converta esse produto para o menu antes de remover o cardápio."
    : `${n} produtos só aparecem por causa deste cardápio e sumiriam da vitrine. Converta esses produtos para o menu antes de remover o cardápio.`;
}

// ══════════════════════════════════════════════ Reconhecedores de erro do banco

/**
 * O fragmento LITERAL que o constraint trigger de RN-14 (20260920131000)
 * levanta no COMMIT, com errcode 23000. É o backstop: a recusa legível é a
 * primeira barreira, mas ela lê ANTES da transação e o cascade pode orfanar um
 * produto vinculado no meio do caminho. Quando isso acontece, quem salvou
 * recebe a MESMA frase acionável, não um erro genérico nem o texto cru do
 * Postgres.
 */
const FRAGMENTO_TRIGGER = "produto exclusivo sem cardapio";

/** `integrity_constraint_violation` — o errcode que o trigger usa (D8). */
const ERRCODE_TRIGGER = "23000";

/**
 * Erro do banco que é, na verdade, a recusa de RN-14 vinda do trigger — a
 * ponta "apagar o último vínculo de um exclusivo".
 *
 * O reconhecimento exige o PAR, não só o fragmento: erro de outra origem cuja
 * mensagem contenha o texto (um nome de produto, por exemplo) não vira a
 * recusa de RN-14.
 */
export function ehErroDeExclusivoOrfao(erro: unknown): boolean {
  if (erro == null || typeof erro !== "object") return false;
  const e = erro as { code?: unknown; message?: unknown };
  return (
    e.code === ERRCODE_TRIGGER &&
    typeof e.message === "string" &&
    e.message.includes(FRAGMENTO_TRIGGER)
  );
}

/**
 * Erro de uma action de LOTE → mensagem. A recusa de RN-14 (a ponta que
 * `produto-contrato.ts` reconhece, levantada ao tirar o produto do cardápio)
 * vira a frase acionável; todo o resto continua genérico.
 */
export function erroDoLote(erro: unknown): string {
  return ehErroDeExclusivoSemCardapio(erro) ? MSG_ORFAO_NO_LOTE : MSG_GENERICA_LOTE;
}

/** Parse → mensagem: só as frases de vigência de §9.6 são promovidas literais. */
export function erroDeParseCardapio(
  issues: readonly { message: string }[],
): string {
  return issues.find((i) => ehMensagemDeVigencia(i.message))?.message ?? MSG_INVALIDO;
}

// ════════════════════════════════════════════ Regras puras da linha e da prévia

/**
 * RN-04 — a linha que vai ao banco, com os dois campos de instante já no fuso
 * da LOJA. Recebe `timezone` por parâmetro: nenhuma leitura de relógio e
 * nenhum fuso do cliente entram aqui. No hub admin o `timezone` é o da
 * LOJA-ALVO lido do banco, nunca o do admin nem o do payload.
 */
export function linhaDoCardapio(
  dados: DadosCardapio,
  timezone: string,
): DadosCardapio {
  if (dados.modo !== "prazo_fixo" || dados.prazo_inicio == null) return dados;

  const inicio = instanteNoFuso(dados.prazo_inicio, timezone);
  const fim =
    dados.prazo_preset === "customizado"
      ? // Único preset em que o fim digitado é aceito — e o zod já garantiu
        // que ele existe e é posterior ao início.
        instanteNoFuso(dados.prazo_fim as string, timezone)
      : calcularFimDoPreset(
          new Date(inicio),
          // `customizado` já saiu acima; o cast é o estreitamento que o tipo
          // do preset não expressa sozinho.
          dados.prazo_preset as "diario" | "semanal" | "mensal",
          timezone,
        ).toISOString();

  return { ...dados, prazo_inicio: inicio, prazo_fim: fim };
}

/** O diálogo mostra 6 nomes no desktop e 3 no mobile (design §10.3). */
const NOMES_NA_PREVIA = 6;

/**
 * As cinco contagens da prévia, a partir das linhas lidas no SERVIDOR (D14).
 *
 * Mora aqui para que as duas prévias sejam idênticas POR CONSTRUÇÃO: calculá-las
 * inline nos dois lugares seria a divergência mais fácil de não notar — uma
 * contagem a menos no admin não quebra teste nenhum, só mente para quem está
 * prestes a confirmar uma escrita em lote na loja de outra pessoa.
 */
export function resumirPrevia(linhas: readonly LinhaDaPrevia[]): ResumoDaPrevia {
  return {
    total: linhas.length,
    nomes: linhas.slice(0, NOMES_NA_PREVIA).map((p) => p.nome),
    menu: linhas.filter((p) => p.visibilidade === "menu").length,
    cardapio: linhas.filter((p) => p.visibilidade === "cardapio").length,
    ocultos: linhas.filter((p) => p.oculto).length,
  };
}
