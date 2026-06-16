/**
 * Helper client de consulta ao ViaCEP (issue 009). API pública, sem key
 * (seguranca.md §9). Extraído de `FormEndereco.tsx` para reuso no painel
 * (`PerfilClient`) — DRY (architecture.md §7), evitando duplicar fetch+parse.
 *
 * Retorna `null` em qualquer falha (CEP inválido, rede, erro do ViaCEP) — o
 * caller decide a mensagem de UX. Erro interno nunca vaza ao cliente
 * (seguranca.md §14): só `console.error` no browser.
 *
 * NÃO confia em valor autoritativo: o servidor revalida o endereço e deriva
 * coords (issue 008). Este helper é puro preview de preenchimento.
 */

/** Campos de endereço que o ViaCEP fornece (UX de autocomplete). */
export type EnderecoViaCep = {
  rua: string;
  bairro: string;
  cidade: string;
  uf: string;
};

/** Resposta relevante do ViaCEP. */
type RespostaViaCep = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

/** Só dígitos do CEP (a máscara é apresentação). Exportado para reuso (DRY). */
export function limparCep(cep: string): string {
  return cep.replace(/\D/g, "");
}

/**
 * Consulta o ViaCEP por CEP. `null` quando o CEP não tem 8 dígitos, a rede
 * falha, ou o ViaCEP retorna `{ erro: true }`.
 */
export async function buscarCep(cep: string): Promise<EnderecoViaCep | null> {
  const limpo = limparCep(cep);
  if (limpo.length !== 8) {
    return null;
  }
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
    if (!resp.ok) {
      return null;
    }
    const dados = (await resp.json()) as RespostaViaCep;
    if (dados.erro) {
      return null;
    }
    return {
      rua: dados.logradouro ?? "",
      bairro: dados.bairro ?? "",
      cidade: dados.localidade ?? "",
      uf: dados.uf ?? "",
    };
  } catch {
    // Erro interno nunca vaza ao cliente (seguranca.md §14): roda no client
    // ('use client'), então re-logar o erro o exporia no browser do usuário.
    console.error("[buscarCep] falha ao consultar ViaCEP");
    return null;
  }
}
