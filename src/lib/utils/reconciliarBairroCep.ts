// Issue 064 — reconciliação CEP↔bairro (fonte de confiança no servidor).
//
// O cliente declara um bairro no checkout, mas ESSE valor seleciona a zona de
// frete — logo é um vetor de subpagamento ("declaro o bairro barato"). Esta fn
// consulta o ViaCEP NO SERVIDOR e devolve o bairro CANÔNICO (o do CEP), nunca o
// declarado (seguranca.md §10/§14). É I/O isolada (sem estado), não pura — por
// isso vive fora de calcularFrete (que precisa permanecer pura/sem I/O).
//
// FAIL-CLOSED: qualquer falha (rede, timeout/abort, CEP inexistente, HTTP não-ok)
// → reconciliado:false e bairroCanonico:null. NUNCA cai no bairro declarado e
// NUNCA propaga exceção (try/catch total) — o caller decide o que fazer com o
// sinal, sem nunca reabrir o vetor de subpagamento.

export type ResultadoReconciliacao = {
  /** bairro autoritativo (do CEP). null = não foi possível reconciliar. */
  bairroCanonico: string | null;
  /** true quando o CEP foi resolvido (haja ou não divergência com o declarado). */
  reconciliado: boolean;
};

const FALHA: ResultadoReconciliacao = { bairroCanonico: null, reconciliado: false };

type RespostaViaCep = {
  bairro?: string;
  erro?: boolean;
};

/**
 * Resolve o bairro canônico de um CEP via ViaCEP. Veja o cabeçalho do módulo
 * para a política fail-closed e a justificativa de segurança.
 */
export async function reconciliarBairroCep(
  cep: string,
  bairroDeclarado: string,
): Promise<ResultadoReconciliacao> {
  try {
    const cepDigitos = cep.replace(/\D/g, "");
    const resp = await fetch(
      `https://viacep.com.br/ws/${cepDigitos}/json/`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!resp.ok) return FALHA;

    const body = (await resp.json()) as RespostaViaCep;
    // ViaCEP responde 200 com { erro: true } para CEP inexistente.
    if (body.erro || !body.bairro) return FALHA;

    // CEP resolvido → reconciliado:true, com o bairro CANÔNICO do CEP (nunca o
    // declarado). bairroDeclarado fica disponível para diagnóstico/log, mas não
    // altera a saída: o canônico vence sempre.
    void bairroDeclarado;
    return { bairroCanonico: body.bairro, reconciliado: true };
  } catch (e) {
    // §14: erro de I/O nunca vaza — vira sinal de retorno (fail-closed).
    console.error("[reconciliarBairroCep]", e);
    return FALHA;
  }
}
