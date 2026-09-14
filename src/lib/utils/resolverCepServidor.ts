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
// não-ok, JSON inválido, resposta sem localidade/uf) → SEM endereço. NUNCA cai
// em dado declarado pelo cliente e NUNCA propaga exceção (try/catch total) — o
// caller decide o que fazer com o sinal, sem nunca reabrir o vetor de
// subpagamento.
//
// (180-B / achado 1 da auditoria) O retorno deixou de ser `EnderecoCepResolvido
// | null`: aquele `null` ÚNICO colapsava "o ViaCEP caiu" (falha do CANAL) com
// "este CEP não existe" (fato sobre o INPUT DO CLIENTE). A jusante o colapso
// virava `motivo: "transitorio"` → `classificarFrete` → `a_combinar` →
// `taxa_entrega` NULL: bastava digitar um CEP de formato válido e inexistente
// para fechar pedido com frete ZERO. A política fail-closed é IDÊNTICA; o que
// muda é que a CAUSA deixa de se perder.

/** Endereço resolvido no servidor a partir do CEP (fonte: ViaCEP). */
export type EnderecoCepResolvido = {
  /** bairro autoritativo (do CEP). null quando o CEP é geral e não tem bairro. */
  bairro: string | null;
  /** NÃO entra na consulta de geocoding (D1 da 185); exposto para a issue 186. */
  logradouro: string | null;
  /** obrigatório: sem cidade não há âncora geográfica → resolução sem endereço. */
  cidade: string;
  /** obrigatório: idem. */
  uf: string;
};

/**
 * Por que não há endereço (180-B/achado 1). A pergunta que o caller responde é
 * "a culpa é do CANAL ou do DADO que o cliente digitou?":
 *   - `nao_encontrado` — o ViaCEP respondeu 200 e AFIRMOU `{ erro: true }`: o
 *     CEP não existe. Fato sobre o endereço do cliente; NUNCA pode alcançar o
 *     caminho "frete a combinar".
 *   - `transitorio`    — o canal falhou (HTTP não-ok, timeout, exceção de rede,
 *     JSON inválido, 200 sem localidade/uf). Resposta malformada NÃO é o ViaCEP
 *     afirmando que o CEP não existe — ele diria `erro:true` —, então tratá-la
 *     como `nao_encontrado` faria uma degradação do ViaCEP virar cobrança de
 *     fallback num endereço que talvez esteja dentro do raio.
 */
export type MotivoResolucaoCep = "nao_encontrado" | "transitorio";

/** Resultado discriminado: endereço resolvido, ou a CAUSA da ausência. */
export type ResolucaoCep =
  | { endereco: EnderecoCepResolvido }
  | { endereco: null; motivo: MotivoResolucaoCep };

type RespostaViaCep = {
  bairro?: string;
  logradouro?: string;
  localidade?: string;
  uf?: string;
  // O ViaCEP passou a responder `"erro": "true"` (string) em parte das rotas —
  // ambas as formas são truthy e classificam igual.
  erro?: boolean | string;
};

/**
 * Resolve o endereço canônico de um CEP via ViaCEP. Veja o cabeçalho do módulo
 * para a política fail-closed e a justificativa de segurança.
 */
export async function resolverCepServidor(
  cep: string,
): Promise<ResolucaoCep> {
  try {
    const cepDigitos = cep.replace(/\D/g, "");
    const resp = await fetch(`https://viacep.com.br/ws/${cepDigitos}/json/`, {
      signal: AbortSignal.timeout(3000),
    });
    // Canal caído (5xx, 429, …): não é afirmação sobre o CEP.
    if (!resp.ok) return { endereco: null, motivo: "transitorio" };

    const body = (await resp.json()) as RespostaViaCep;
    // ViaCEP responde 200 com { erro: true } para CEP inexistente. É a ÚNICA
    // afirmação de que o dado do cliente está errado (180-B/achado 1).
    if (body.erro) return { endereco: null, motivo: "nao_encontrado" };

    // Sem cidade/UF não há âncora geográfica utilizável: fail-closed (185/D1).
    // Resposta malformada = canal degradado, não CEP inexistente.
    const cidade = body.localidade?.trim();
    const uf = body.uf?.trim();
    if (!cidade || !uf) return { endereco: null, motivo: "transitorio" };

    return {
      endereco: {
        bairro: body.bairro?.trim() || null,
        logradouro: body.logradouro?.trim() || null,
        cidade,
        uf,
      },
    };
  } catch (e) {
    // §14/§21: erro de I/O nunca vaza e o log é genérico — nem o CEP nem o
    // endereço do cliente entram na mensagem.
    console.error("[resolverCepServidor]", e);
    return { endereco: null, motivo: "transitorio" };
  }
}
