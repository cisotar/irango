// Issues 064 + 185 — resolução CANÔNICA de um CEP no servidor (fonte única).
//
// Uma ÚNICA ida ao ViaCEP serve dois consumidores do cálculo de frete:
//   1. (064) o bairro CANÔNICO que seleciona a zona tipo='bairro' — o bairro
//      declarado pelo cliente é vetor de subpagamento e nunca vence
//      (seguranca.md §10/§10-A/§14);
//   2. (185) a consulta textual enviada ao Nominatim para derivar a distância
//      loja→cliente (zonas tipo='raio_km'). O CEP CRU nunca é geocodificado: o
//      OSM não indexa CEP brasileiro e resolvia para qualquer token parecido no
//      mundo (a evidência da issue 185 caiu numa estrada na República Tcheca).
//
// É I/O isolada (sem estado), não pura — por isso vive fora de calcularFrete
// (que precisa permanecer pura/sem I/O).
//
// FAIL-CLOSED: qualquer falha (rede, timeout/abort, CEP inexistente, HTTP
// não-ok, JSON inválido, resposta sem localidade/uf) → `null`. NUNCA cai em dado
// declarado pelo cliente e NUNCA propaga exceção (try/catch total) — o caller
// decide o que fazer com o sinal, sem nunca reabrir o vetor de subpagamento.

/** Endereço resolvido no servidor a partir do CEP (fonte: ViaCEP). */
export type EnderecoCepResolvido = {
  /** bairro autoritativo (do CEP). null quando o CEP é geral e não tem bairro. */
  bairro: string | null;
  /** NÃO entra na consulta de geocoding (D1 da 185); exposto para a issue 186. */
  logradouro: string | null;
  /** obrigatório: sem cidade não há âncora geográfica → retorno é null. */
  cidade: string;
  /** obrigatório: idem. */
  uf: string;
};

type RespostaViaCep = {
  bairro?: string;
  logradouro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

/**
 * Resolve o endereço canônico de um CEP via ViaCEP. Veja o cabeçalho do módulo
 * para a política fail-closed e a justificativa de segurança.
 */
export async function resolverCepServidor(
  cep: string,
): Promise<EnderecoCepResolvido | null> {
  try {
    const cepDigitos = cep.replace(/\D/g, "");
    const resp = await fetch(`https://viacep.com.br/ws/${cepDigitos}/json/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;

    const body = (await resp.json()) as RespostaViaCep;
    // ViaCEP responde 200 com { erro: true } para CEP inexistente.
    if (body.erro) return null;

    // Sem cidade/UF não há âncora geográfica utilizável: fail-closed (185/D1).
    const cidade = body.localidade?.trim();
    const uf = body.uf?.trim();
    if (!cidade || !uf) return null;

    return {
      bairro: body.bairro?.trim() || null,
      logradouro: body.logradouro?.trim() || null,
      cidade,
      uf,
    };
  } catch (e) {
    // §14/§21: erro de I/O nunca vaza e o log é genérico — nem o CEP nem o
    // endereço do cliente entram na mensagem.
    console.error("[resolverCepServidor]", e);
    return null;
  }
}
