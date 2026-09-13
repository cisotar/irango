// Builders puros de patch (issue 084 — GREEN). Módulo NEUTRO: sem 'use server',
// funções puras síncronas — pode ser importado por painel ↔ admin sem arrastar a
// fronteira de Server Action. Extrai a allowlist e o gate de geocoding antes
// inline em salvarPerfil (loja.ts), eliminando a cópia.
//
// SEGURANÇA (RN-7 / seguranca.md §2): montarPatchPerfil monta o patch COLUNA A
// COLUNA a partir de uma allowlist EXPLÍCITA — NUNCA spread do payload. Colunas
// autoritativas (dono_id, ativo, assinatura_*, hotmart_*, consentimento_*, id,
// latitude, longitude) JAMAIS entram, mesmo que cheguem num payload hostil.

/** Campos que o caller pode tentar gravar no perfil (já validados a montante). */
export type DadosPerfil = {
  nome: string;
  slug: string;
  telefone?: string | null;
  whatsapp?: string | null;
  endereco_cep?: string | null;
  endereco_rua?: string | null;
  endereco_numero?: string | null;
  endereco_bairro?: string | null;
  endereco_cidade?: string | null;
  endereco_estado?: string | null;
  /** Preferência operacional (issue 122): envio automático do pedido no WhatsApp. */
  whatsapp_envio_automatico?: boolean;
};

/**
 * Monta o patch do UPDATE de perfil a partir do dado JÁ validado. Allowlist
 * explícita (RN-7): `nome`/`slug` sempre; os demais só quando `!== undefined`.
 * Qualquer chave fora desta lista é descartada — não há spread do payload.
 */
export function montarPatchPerfil(
  d: DadosPerfil,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    nome: d.nome,
    slug: d.slug,
  };
  if (d.telefone !== undefined) patch.telefone = d.telefone;
  if (d.whatsapp !== undefined) patch.whatsapp = d.whatsapp;
  if (d.endereco_cep !== undefined) patch.endereco_cep = d.endereco_cep;
  if (d.endereco_rua !== undefined) patch.endereco_rua = d.endereco_rua;
  if (d.endereco_numero !== undefined) patch.endereco_numero = d.endereco_numero;
  if (d.endereco_bairro !== undefined) patch.endereco_bairro = d.endereco_bairro;
  if (d.endereco_cidade !== undefined) patch.endereco_cidade = d.endereco_cidade;
  if (d.endereco_estado !== undefined) patch.endereco_estado = d.endereco_estado;
  // Preferência operacional (issue 122): `!== undefined` (nunca truthiness) —
  // `false` PRECISA ser gravado; ausente PRECISA preservar o valor no banco.
  if (d.whatsapp_envio_automatico !== undefined)
    patch.whatsapp_envio_automatico = d.whatsapp_envio_automatico;
  return patch;
}

/**
 * Monta a consulta livre para o Nominatim a partir do endereço JÁ validado.
 *
 * Gate de completude (D3): sem `endereco_cidade` E `endereco_estado` não há
 * âncora geográfica mínima → retorna null (caller grava o par NULL, sem chamar
 * o Nominatim). Com o mínimo, monta string rica (mais específico → menos), com
 * "Brasil" fixo no fim para ancorar o país.
 */
export function montarConsultaGeocoding(dados: {
  endereco_cidade?: string | null;
  endereco_estado?: string | null;
  endereco_cep?: string | null;
  endereco_rua?: string | null;
  endereco_numero?: string | null;
  endereco_bairro?: string | null;
}): string | null {
  const cidade = dados.endereco_cidade?.trim();
  const estado = dados.endereco_estado?.trim();
  if (!cidade || !estado) return null;

  const rua = dados.endereco_rua?.trim();
  const numero = dados.endereco_numero?.trim();
  const bairro = dados.endereco_bairro?.trim();

  // 🛑 O CEP NÃO ENTRA NA CONSULTA (issue 186). A evidência da 185 provou que o
  // CEP cru é token ENVENENADOR na busca livre: o geocoder não indexa CEP
  // brasileiro e a pontuação da busca degrada com o token solto — `q=12914-190`
  // chegou a resolver para uma estrada na República Tcheca. A loja é o CENTRO do
  // raio: um ponto errado aqui desloca TODAS as zonas `raio_km` de uma vez, e as
  // coords ficam gravadas em `lojas.latitude/longitude` (falha silenciosa e
  // persistente). O parâmetro `endereco_cep` segue aceito na assinatura de
  // propósito — os callers passam o objeto de endereço inteiro.
  const ruaNumero = [rua, numero].filter(Boolean).join(", ");
  const partes = [
    ruaNumero || null,
    bairro || null,
    `${cidade} - ${estado}`,
    "Brasil",
  ].filter(Boolean);

  return partes.join(", ");
}
