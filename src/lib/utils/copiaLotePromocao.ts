/**
 * [260] Copy do DIÁLOGO DE LOTE do cardápio sazonal (design §10.2, mecanismo
 * M5). Módulo PURO: sem React, sem DOM, sem I/O — roda em `environment: node`
 * e é afirmável byte a byte sem jsdom. Forma copiada de `alcance-do-grupo.ts`.
 *
 * ─────────────────────────────────────── Por que a copy mora FORA do .tsx
 * Este diálogo é o último ponto em que o lojista percebe que selecionou a
 * categoria errada. As frases que ele lê precisam ser travadas por teste, e
 * dentro do JSX elas não são (não há jsdom nesta máquina — issue 176). O mesmo
 * motivo de `frasesCardapio.ts` (256).
 *
 * ─────────────────────────────────────── Por que NENHUMA função conta nada
 * 🔴 `total`, `menu`, `cardapio` e `ocultos` entram por PARÂMETRO e vêm do
 * SERVIDOR (`preverLoteAction`, RN-09-a). Nada aqui deriva número do `Set` do
 * cliente: a seleção pode estar velha (outro dispositivo mexeu no catálogo) ou
 * conter id de outra loja, e só o servidor resolve nomes sob RLS. Estas funções
 * recebem números; elas não sabem contar produtos e é assim que devem
 * continuar.
 */

/** As duas direções da ação de cardápio — a reversibilidade é a simetria. */
export type AcaoLote = "adicionar" | "remover";

/** As duas declarações de D14 que o lote sabe escrever. */
export type AcaoVisibilidade = "exclusivo" | "menu";

/** O que o diálogo precisa para existir: título, corpo e o rótulo do botão. */
export type CopiaDoLote = {
  titulo: string;
  corpo: string;
  /**
   * 🔴 O número vai DENTRO do rótulo, nunca "Confirmar" (design §10.2, trava
   * 1): é sob o dedo que o lojista lê quantos produtos vai atingir.
   */
  rotuloConfirmar: string;
};

function plural(n: number, singular: string, plural_: string): string {
  return n === 1 ? singular : plural_;
}

/**
 * Título, corpo e rótulo do botão da ação de CARDÁPIO em lote.
 *
 * `total === 0` é o caso em que a seleção inteira sumiu sob a RLS (ids de outra
 * loja, produtos apagados de outro dispositivo): o diálogo diz isso em
 * português e o rótulo deixa de prometer uma escrita. O chamador desabilita o
 * botão — mas mesmo se não desabilitasse, o rótulo não mentiria.
 */
export function perguntaLote(p: {
  acao: AcaoLote;
  nomeCardapio: string;
  /** Nomes resolvidos pelo SERVIDOR, sob RLS. Só apresentação. */
  nomes: readonly string[];
  /** Contagem do SERVIDOR. Nunca `selecionados.size`. */
  total: number;
}): CopiaDoLote {
  const { acao, nomeCardapio, total } = p;
  const adicionar = acao === "adicionar";

  const titulo = adicionar
    ? `Adicionar ao cardápio “${nomeCardapio}”?`
    : `Remover do cardápio “${nomeCardapio}”?`;

  if (total === 0) {
    return {
      titulo,
      corpo: "Nenhum produto desta seleção foi encontrado na sua loja.",
      rotuloConfirmar: adicionar ? "Nada a adicionar" : "Nada a remover",
    };
  }

  const corpo = adicionar
    ? `${total} ${plural(total, "produto vai", "produtos vão")} passar a seguir a janela deste cardápio:`
    : `${total} ${plural(total, "produto deixa", "produtos deixam")} de seguir a janela deste cardápio:`;

  const rotuloConfirmar = `${adicionar ? "Adicionar" : "Remover"} ${total} ${plural(
    total,
    "produto",
    "produtos",
  )}`;

  return { titulo, corpo, rotuloConfirmar };
}

/**
 * [261] A mesma forma para a declaração de D14 em lote. "Devolver ao menu" é
 * sempre permitido, mas não por isso silencioso: toda ação em lote diz quantos
 * e quais ANTES do clique, e o número vai dentro do rótulo do botão.
 */
export function perguntaVisibilidade(p: {
  acao: AcaoVisibilidade;
  nomes: readonly string[];
  total: number;
}): CopiaDoLote {
  const { acao, total } = p;
  const exclusivo = acao === "exclusivo";

  const titulo = exclusivo
    ? "Marcar como exclusivo de cardápio?"
    : "Devolver ao menu?";

  if (total === 0) {
    return {
      titulo,
      corpo: "Nenhum produto desta seleção foi encontrado na sua loja.",
      rotuloConfirmar: "Nada a alterar",
    };
  }

  const corpo = exclusivo
    ? `${total} ${plural(total, "produto passa", "produtos passam")} a aparecer só quando um cardápio dele estiver aberto. Fora da temporada, ${plural(total, "ele some", "eles somem")} da vitrine:`
    : `${total} ${plural(total, "produto volta", "produtos voltam")} a aparecer sempre no seu menu, mesmo quando um cardápio dele fecha ou expira:`;

  const rotuloConfirmar = exclusivo
    ? `Marcar ${total} ${plural(total, "produto", "produtos")} como exclusivo`
    : `Devolver ${total} ${plural(total, "produto", "produtos")} ao menu`;

  return { titulo, corpo, rotuloConfirmar };
}

/**
 * [277/decisão B] A frase de apoio no corpo do diálogo de "Definir dias".
 *
 * A prévia conta PRODUTOS; a escrita alcança VÍNCULOS. O botão só habilita com
 * a seleção inteira já vinculada (`podeDefinirDias`), e esta linha diz por quê
 * — sem ela, o lojista não entende por que o botão está apagado.
 */
export const FRASE_SO_QUEM_ESTA_NO_CARDAPIO =
  "Só vale para quem já está neste cardápio.";

/**
 * [277/desenho §8-G] Título, corpo e rótulo do botão da ação "Definir dias".
 *
 * NÃO é uma segunda redação de confirmação (que a spec proíbe): é a redação da
 * AÇÃO NOVA, no mesmo módulo puro, no mesmo formato e varrida pela mesma trava
 * de fonte (`lote-contagem-do-servidor.test.ts`). `total` é do SERVIDOR.
 *
 * Nenhuma pílula marcada é um gesto legítimo e tem rótulo PRÓPRIO — "Definir os
 * dias" prometendo uma restrição que não vai existir seria mentira de UI.
 */
export function perguntaDias(p: {
  nomeCardapio: string;
  /** Nomes resolvidos pelo SERVIDOR, sob RLS. Só apresentação. */
  nomes: readonly string[];
  /** Contagem do SERVIDOR. Nunca `selecionados.size`. */
  total: number;
  /** Os dias escolhidos no diálogo; vazio = "voltar para todos os dias". */
  dias: readonly number[];
}): CopiaDoLote {
  const { nomeCardapio, total, dias } = p;
  const restringe = dias.length > 0;

  const titulo = restringe
    ? `Definir os dias no cardápio “${nomeCardapio}”?`
    : `Voltar para todos os dias em “${nomeCardapio}”?`;

  if (total === 0) {
    return {
      titulo,
      corpo: "Nenhum produto desta seleção foi encontrado na sua loja.",
      rotuloConfirmar: "Nada a alterar",
    };
  }

  const corpo = restringe
    ? `${total} ${plural(total, "produto passa", "produtos passam")} a aparecer só nos dias escolhidos, dentro da janela deste cardápio:`
    : `${total} ${plural(total, "produto volta", "produtos voltam")} a aparecer em todos os dias em que este cardápio abre:`;

  const rotuloConfirmar = restringe
    ? `Definir os dias em ${total} ${plural(total, "produto", "produtos")}`
    : `Voltar ${total} ${plural(total, "produto", "produtos")} para todos os dias`;

  return { titulo, corpo, rotuloConfirmar };
}

/**
 * As frases de D14 do diálogo de cardápio (design §10.2, trava 4). Os dois
 * números vêm da MESMA prévia do servidor. Quando só existe um dos casos, só
 * uma frase aparece — o aviso que dispara sempre vira papel de parede.
 */
export function frasesDeVisibilidade(p: {
  menu: number;
  cardapio: number;
}): string[] {
  const frases: string[] = [];
  if (p.menu > 0) {
    frases.push(
      `${p.menu} ${plural(p.menu, "produto do menu continua", "produtos do menu continuam")} aparecendo e vendendo fora da janela.`,
    );
  }
  if (p.cardapio > 0) {
    frases.push(
      `${p.cardapio} ${plural(p.cardapio, "produto de cardápio só aparece", "produtos de cardápio só aparecem")} quando este cardápio estiver aberto.`,
    );
  }
  return frases;
}

/**
 * Trava 5 do design §10.2 — "categoria inteira" é FOTO, não vínculo. A RPC
 * expande a categoria DENTRO da transação (RN-10) e grava vínculos
 * produto↔cardápio, um por produto existente naquele instante: não existe
 * vínculo cardápio↔categoria no modelo, então produto criado depois não entra
 * sozinho, e a frase é descrição do que o botão faz.
 */
export function fraseCategoriaEhFoto(
  total: number,
  nomeCategoria: string,
): string {
  const contagem =
    total === 1
      ? `É o único produto de ${nomeCategoria} de hoje.`
      : `São os ${total} produtos de ${nomeCategoria} de hoje.`;
  return `${contagem} Produtos criados depois não entram sozinhos.`;
}

/**
 * A RPC inclui produto `oculto` (RN-10) e o diálogo NÃO o esconde da contagem —
 * senão o lojista reabre um produto meses depois e descobre que ele herdou uma
 * janela que ninguém lembra de ter aplicado. `null` quando não há oculto:
 * nenhum texto, em lugar nenhum.
 */
export function fraseOcultos(quantidade: number): string | null {
  if (quantidade <= 0) return null;
  return quantidade === 1
    ? "1 deles está oculto e continua oculto."
    : `${quantidade} deles estão ocultos e continuam ocultos.`;
}

/**
 * O "e mais N" que fecha a lista de nomes. `mostrados` é quantos o layout
 * exibe (3 no mobile, 6 no desktop — design §10.3); `total` é do servidor.
 * `null` quando a lista já nomeia tudo.
 */
export function fraseEMais(total: number, mostrados: number): string | null {
  const resto = total - mostrados;
  return resto > 0 ? `e mais ${resto}` : null;
}
