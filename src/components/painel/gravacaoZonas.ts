// Gravação das zonas de entrega pelas telas (issues 325/326/328) — módulo PURO,
// sem React, testável no `environment: node`.
//
//   - enviarZonas            → chama a action injetada e traduz o resultado em toast
//   - criarFilaGravacao      → serializa o salvamento automático (C6 da 326)
//   - criarGravadorComVersao → carrega a versão otimista entre gravações e
//                              ativações e para de chamar o servidor depois de
//                              um conflito (328/325)
//
// A versão é só transporte: quem compara são as RPCs `salvar_zonas_entrega` e
// `definir_forma_frete` no banco. O valor do frete do pedido segue recalculado no servidor.
import {
  MENSAGEM_CONFLITO_ZONAS,
  MENSAGEM_ERRO_ZONAS,
  type DadosDefinirFormaFrete,
  type DadosZonasEntrega,
  type DadosZonasSemVersao,
  type FormaZonasEntrega,
  type ResultadoZonas,
} from "@/lib/validacoes/entrega";

/** O que a tela precisa saber do resultado de uma gravação. */
export type ResultadoGravacao = { ok: true } | { ok: false; erro: string; conflito?: true };

/**
 * Dependências do envio (architecture.md §8): a gravação e o toast INJETADOS
 * por parâmetro — nunca lidos do módulo direto — para a orquestração ser
 * testável sem jsdom.
 */
export type DepsEnvioZonas<P> = {
  salvar: (payload: P) => Promise<ResultadoGravacao>;
  toast: { error: (msg: string) => void };
};

/**
 * Chama a gravação. Erro dela (ou exceção de rede) vira `toast.error` com a
 * mensagem genérica; conflito de versão NÃO dá toast (o aviso de conflito da
 * tela cobre); sucesso é silencioso — o indicador "Salvo" informa, e a tela não
 * chama `router.refresh`: o estado local é a verdade e o `revalidatePath` da
 * action já atualiza a vitrine.
 */
export async function enviarZonas<P>(
  payload: P,
  { salvar, toast }: DepsEnvioZonas<P>,
): Promise<{ ok: true } | { ok: false }> {
  try {
    const resultado = await salvar(payload);
    if (!resultado.ok) {
      if (!resultado.conflito) toast.error(resultado.erro);
      return { ok: false };
    }
    return { ok: true };
  } catch {
    toast.error(MENSAGEM_ERRO_ZONAS);
    return { ok: false };
  }
}

export type EstadoGravacao = "ocioso" | "salvando" | "salvo" | "erro";

/**
 * Fila de gravação SERIALIZADA (C6): uma gravação por vez. Pedido que chega
 * durante uma gravação só guarda o payload mais recente, gravado quando a atual
 * termina — os intermediários são descartados. `aoMudar` recebe "salvando" ao
 * começar e, quando a fila esvazia, "salvo"/"erro" conforme a ÚLTIMA gravação.
 * `gravar` devolve a promessa do esvaziamento da fila.
 */
export function criarFilaGravacao<P>(
  executar: (payload: P) => Promise<boolean>,
  aoMudar: (estado: EstadoGravacao) => void,
): { gravar: (payload: P) => Promise<void> } {
  let drenando: Promise<void> | null = null;
  let proximo: { payload: P } | null = null;

  async function drenar(primeiro: P): Promise<void> {
    aoMudar("salvando");
    let atual: { payload: P } | null = { payload: primeiro };
    let ok = false;
    while (atual !== null) {
      try {
        ok = await executar(atual.payload);
      } catch {
        ok = false;
      }
      atual = proximo;
      proximo = null;
    }
    drenando = null;
    aoMudar(ok ? "salvo" : "erro");
  }

  return {
    gravar(payload: P) {
      if (drenando !== null) {
        proximo = { payload };
        return drenando;
      }
      drenando = drenar(payload);
      return drenando;
    },
  };
}

export type GravadorComVersao = {
  /** Grava `dados` com a versão corrente; a versão vira a devolvida no sucesso. */
  salvar: (dados: DadosZonasSemVersao) => Promise<ResultadoZonas>;
  /** Ativa `forma` (botão "Usar esta forma") com a versão corrente, na mesma fila do salvar. */
  ativar: (forma: FormaZonasEntrega) => Promise<ResultadoZonas>;
  versaoAtual: () => number;
};

/**
 * Embrulha a action de zonas com a versão otimista (328):
 *  - gravações são SERIALIZADAS aqui: os três editores compartilham o gravador
 *    e cada um tem a própria fila, então dois blurs (km e CEP) podem chegar
 *    juntos. A seguinte só sai quando a anterior volta, com a versão devolvida
 *    por ela — sem falso conflito dentro da mesma aba;
 *  - exceção não altera a versão nem trava a fila (propaga só para quem chamou);
 *  - no primeiro conflito chama `aoConflito` UMA vez e, dali em diante, devolve
 *    o conflito SEM chamar a action — o salvamento automático para de bater no
 *    servidor a cada blur até o lojista recarregar a página;
 *  - `ativar(forma)` (325) passa pela MESMA fila e pela MESMA versão: sai com a
 *    versão devolvida pelo salvar anterior, sobe a versão no ok, e conflito em
 *    qualquer um dos dois trava ambos.
 */
export function criarGravadorComVersao({
  acao,
  acaoAtivar,
  versaoInicial,
  aoConflito,
}: {
  acao: (payload: DadosZonasEntrega) => Promise<ResultadoZonas>;
  acaoAtivar: (payload: DadosDefinirFormaFrete) => Promise<ResultadoZonas>;
  versaoInicial: number;
  aoConflito: () => void;
}): GravadorComVersao {
  let versao = versaoInicial;
  let emConflito = false;
  let cauda: Promise<unknown> = Promise.resolve();

  async function executar(chamar: (versao: number) => Promise<ResultadoZonas>): Promise<ResultadoZonas> {
    if (emConflito) return { ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS };
    const r = await chamar(versao);
    if (r.ok) {
      versao = r.versao;
    } else if (r.conflito && !emConflito) {
      emConflito = true;
      aoConflito();
    }
    return r;
  }

  function enfileirar(chamar: (versao: number) => Promise<ResultadoZonas>): Promise<ResultadoZonas> {
    // A versão é lida quando a vez chega, não quando o pedido entra na fila.
    const vez = cauda.then(() => executar(chamar));
    cauda = vez.catch(() => undefined);
    return vez;
  }

  return {
    versaoAtual: () => versao,
    salvar: (dados) => enfileirar((v) => acao({ ...dados, versao: v })),
    ativar: (forma) => enfileirar((v) => acaoAtivar({ forma, versao: v })),
  };
}
