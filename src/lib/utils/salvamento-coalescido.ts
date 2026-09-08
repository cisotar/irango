/**
 * Núcleo de estado do salvamento otimista com coalescência (issue 175).
 *
 * Puro: sem React, sem DOM, sem `window`. Só usa `setTimeout`/`clearTimeout`
 * globais, que o vitest substitui com timers falsos — por isso roda inteiro em
 * `environment: node`, sem jsdom e sem @testing-library.
 *
 * ─────────────────────────────────────────── Por que este módulo existe
 * A lógica de debounce, ordem confirmada e revert vivia como closures dentro de
 * `ReordenarCategorias`, dependentes de `useRef`/`useState`/`setTimeout` e só
 * observáveis depois de um ciclo real de render+commit. `renderToStaticMarkup`
 * (o único renderizador disponível no projeto) não executa efeitos, não dispara
 * handlers e não avança timers — logo os dois bugs abaixo eram INTESTÁVEIS onde
 * moravam. Extraí-los para cá é o mesmo movimento que o plano já fez com
 * `moverPorDeslocamento`: a regra sai da árvore React e vira função.
 *
 * ─────────────────────────────────────────── Bug 1: o último movimento perdido
 * O cleanup de desmontagem só CANCELAVA o timer do debounce; o `salvar` agendado
 * nunca acontecia. Mover uma categoria e tocar "Concluir" (ou ESC) antes dos
 * 500ms descartava o movimento em silêncio, e o `router.refresh()` seguinte
 * trazia a ordem ANTIGA do servidor — violando o contrato de interação (§5:
 * "sem risco de perda — cada movimento já foi persistido").
 *
 * `finalizar()` é a saída: cancela o timer, DISPARA o pendente na hora e só
 * resolve quando a rede termina. Quem sai do modo faz `await finalizar()` ANTES
 * de desmontar e ANTES do `router.refresh()` — a ordem entre os dois é o que
 * importa: um flush disparado "para o ar" na desmontagem correria com o refresh
 * e o refresh venceria, relendo a ordem velha.
 *
 * ─────────────────────────────────────────── Bug 2: revert para estado fantasma
 * Antes, o debounce cancelava o TIMER mas nunca a PROMISE de uma chamada já
 * disparada: em rede lenta (o público é mobile 3G/4G) duas ficavam em voo. Se A
 * gravava com SUCESSO e respondia depois de B começar, o guard de resposta
 * obsoleta descartava esse sucesso sem atualizar a ordem confirmada; se B então
 * falhava, o revert voltava para o snapshot de ANTES de A — um estado que nunca
 * existiu no banco.
 *
 * A correção é SERIALIZAR: nunca duas chamadas em voo. Enquanto uma está em voo,
 * o valor novo espera na fila (profundidade 1 — como todo payload é a sequência
 * COMPLETA e a RPC é idempotente, o valor mais recente substitui o anterior sem
 * perda). Isso não só conserta o alvo do revert: elimina o caso em que a chamada
 * ANTIGA comita por último e o banco fica com uma ordem que a tela não mostra —
 * algo que nenhum guard de resposta obsoleta consegue evitar, porque o cliente
 * não observa a ordem de commit.
 */

/** Mesmo formato de `ResultadoGestaoCategoria` — mantido estrutural de propósito. */
export type ResultadoSalvamento = { ok: true } | { ok: false; erro: string };

/** `""` = ocioso. Espelha o status agregado da barra de modo (mockup §3.4). */
export type StatusSalvamento = "" | "salvando" | "salvo";

export type OpcoesSalvamentoCoalescido<T> = {
  /** Estado já confirmado pelo servidor quando a máquina nasce. */
  confirmada: T;
  /** Janela de coalescência. Toques dentro dela viram UMA escrita. */
  atrasoMs: number;
  /** Dependência injetada: a Server Action. Nunca importada aqui. */
  salvar: (valor: T) => Promise<ResultadoSalvamento>;
  aoStatus?: (status: StatusSalvamento) => void;
  /**
   * Falha: recebe a ÚLTIMA ordem confirmada pelo servidor (o alvo correto do
   * revert) e a mensagem genérica da action.
   */
  aoFalhar?: (confirmada: T, erro: string) => void;
};

export type SalvamentoCoalescido<T> = {
  /** Agenda o salvamento do valor, reiniciando a janela de coalescência. */
  agendar: (valor: T) => void;
  /**
   * Cancela o debounce, dispara o pendente IMEDIATAMENTE e resolve só quando
   * não houver mais nada em voo nem na fila. É o que a saída do modo aguarda.
   */
  finalizar: () => Promise<void>;
  /** Último valor que o servidor confirmou ter gravado. */
  confirmada: () => T;
  /** Há algo aguardando debounce, em voo, ou na fila? */
  temPendencia: () => boolean;
};

/** Mensagem única — a mesma da action (`seguranca.md` §14: nada de oráculo). */
const ERRO_GENERICO = "Não foi possível salvar a ordem.";

export function criarSalvamentoCoalescido<T>(
  opcoes: OpcoesSalvamentoCoalescido<T>,
): SalvamentoCoalescido<T> {
  const { atrasoMs, salvar, aoStatus, aoFalhar } = opcoes;

  let confirmada = opcoes.confirmada;
  // Envelopado num objeto para distinguir "sem pendência" de "pendência com
  // valor `null`/`undefined`" — a máquina é genérica.
  let pendente: { valor: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Não-nulo enquanto UMA chamada está em voo. É esta variável que garante a
  // serialização: nada dispara enquanto ela existe.
  let emVoo: Promise<void> | null = null;

  function executar(): void {
    const alvo = pendente;
    if (alvo === null) return;
    pendente = null;

    const chamada = (async () => {
      let resultado: ResultadoSalvamento;
      try {
        resultado = await salvar(alvo.valor);
      } catch {
        // Exceção de rede/transporte tem o mesmo tratamento de `{ ok: false }`:
        // mensagem genérica para o usuário, detalhe fica no log do servidor.
        resultado = { ok: false, erro: ERRO_GENERICO };
      }

      if (resultado.ok) {
        // O banco agora tem EXATAMENTE `alvo.valor`. Como só existe uma chamada
        // em voo por vez, este sucesso é sempre o mais recente que comitou.
        confirmada = alvo.valor;
        if (pendente === null) aoStatus?.("salvo");
        return;
      }

      // Falha: a fila é descartada. Reenviar um valor derivado de um estado que
      // o revert acabou de desfazer só reintroduziria a divergência.
      pendente = null;
      aoStatus?.("");
      aoFalhar?.(confirmada, resultado.erro);
    })();

    emVoo = chamada.then(() => {
      emVoo = null;
      // Coalescência chegou enquanto esta chamada estava em voo E o debounce já
      // venceu (`timer === null`): a fila só anda aqui, nunca em paralelo.
      if (pendente !== null && timer === null) executar();
    });
  }

  return {
    agendar(valor: T): void {
      if (timer !== null) clearTimeout(timer);
      pendente = { valor };
      aoStatus?.("salvando");
      timer = setTimeout(() => {
        timer = null;
        // Uma chamada em voo dispara a próxima ao terminar (ver `emVoo.then`).
        if (emVoo !== null) return;
        executar();
      }, atrasoMs);
    },

    async finalizar(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // Drena: espera o que está em voo e dispara o que ficou na fila, até
      // sobrar nada. Uma falha limpa a fila, então o laço sempre termina.
      while (emVoo !== null || pendente !== null) {
        if (emVoo !== null) {
          await emVoo;
          continue;
        }
        executar();
      }
    },

    confirmada: () => confirmada,
    temPendencia: () => timer !== null || emVoo !== null || pendente !== null,
  };
}
