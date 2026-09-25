// Builders puros de patch (issue 084 — GREEN). Módulo NEUTRO: sem 'use server',
// funções puras síncronas — pode ser importado por painel ↔ admin sem arrastar a
// fronteira de Server Action. Extrai a allowlist e o gate de geocoding antes
// inline em salvarPerfil (loja.ts), eliminando a cópia.
//
// SEGURANÇA (RN-7 / seguranca.md §2): montarPatchPerfil monta o patch COLUNA A
// COLUNA a partir de uma allowlist EXPLÍCITA — NUNCA spread do payload. Colunas
// autoritativas (dono_id, ativo, assinatura_*, hotmart_*, consentimento_*, id,
// latitude, longitude) JAMAIS entram, mesmo que cheguem num payload hostil.

import type { DadosModalidadesEntrega } from "@/lib/validacoes/entrega";

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
  /** Preferência operacional (issue 231): exibir o modal de promoções na vitrine. */
  modal_promocoes?: boolean;
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
  // Preferência operacional (issue 231): MESMA regra — `!== undefined`, nunca
  // truthiness. `false` é justamente o valor que o lojista grava ao DESLIGAR o
  // modal de promoções; um `if (d.modal_promocoes)` o engoliria em silêncio.
  if (d.modal_promocoes !== undefined) patch.modal_promocoes = d.modal_promocoes;
  return patch;
}

/**
 * Patch das modalidades de entrega (spec modalidades-entrega-loja), mesma regra
 * de `montarPatchPerfil`: allowlist COLUNA A COLUNA, nunca spread. Sai daqui
 * EXATAMENTE `aceita_retirada`, `aceita_entrega` e `modo_frete`, mesmo que o
 * objeto recebido carregue `dono_id`, `ativo`, `id` ou billing. Usado pelo
 * painel (`salvarModalidadesEntrega`) e pelo hub admin
 * (`salvarModalidadesEntregaAdmin`), que por isso não podem divergir.
 */
export function montarPatchModalidades(d: DadosModalidadesEntrega): DadosModalidadesEntrega {
  return {
    aceita_retirada: d.aceita_retirada,
    aceita_entrega: d.aceita_entrega,
    modo_frete: d.modo_frete,
  };
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

/** Endereço já gravado na loja + o par de coords derivado (issue 180-A). */
type LojaComCoords = Parameters<typeof montarConsultaGeocoding>[0] & {
  latitude?: number | null;
  longitude?: number | null;
};

/**
 * A loja tem o par de coordenadas gravado? Par tudo-ou-nada (RN-2): só conta
 * quando AS DUAS existem. Tolera `undefined` além de `null` para que uma row
 * parcial (projeção sem as colunas) nunca seja lida como "tem coords".
 */
export function temCoordenadas(loja: {
  latitude?: number | null;
  longitude?: number | null;
}): boolean {
  return (
    loja.latitude !== null &&
    loja.latitude !== undefined &&
    loja.longitude !== null &&
    loja.longitude !== undefined
  );
}

/**
 * Decide se o 2º UPDATE (geocoding + par de coords) deve rodar (issue 180-A).
 *
 * BUG QUE ISTO CORRIGE: o 2º UPDATE era INCONDICIONAL. Salvar só o nome da loja
 * num momento em que o geocoder estivesse fora do ar apagava uma localização
 * válida (par NULL), tirando a loja da busca por proximidade e desativando as
 * zonas por raio até o próximo save bem-sucedido.
 *
 * D-180A-1 — a comparação é feita sobre a CONSULTA, não campo a campo: os dois
 * lados saem da MESMA `montarConsultaGeocoding`. Consequências desejadas:
 *  - uma lista de campos só, por construção (campo novo entra na consulta e a
 *    comparação passa a considerá-lo no mesmo commit);
 *  - `trim()` de graça — só espaço em branco não regeocodifica;
 *  - o CEP, deliberadamente fora da consulta (issue 186), não dispara chamada:
 *    ele não influencia o ponto devolvido, então regeocodificar só exporia uma
 *    coord válida a uma falha transitória.
 *
 * D-180A-2 — RECUPERAÇÃO. Pular o 2º UPDATE quando a consulta não mudou tem um
 * efeito colateral que a regra original não previa: uma loja SEM coords cujo
 * endereço está preenchido e correto nunca mais regeocodificaria. Antes desta
 * issue todo save tentava de novo, então uma falha transitória se curava no save
 * seguinte; com o gate ingênuo, a loja ficaria presa até o lojista ALTERAR o
 * endereço — e a issue 193 (que passa a exigir coordenada para publicar) a
 * deixaria sem saída. Logo: consulta válida e inalterada, mas par ausente, ainda
 * regeocodifica. O custo é 1 chamada por save APENAS para lojas sem coord, que
 * são exatamente as que precisam tentar.
 *
 * Regra, nesta ordem:
 *  1. consultas diferentes → true (endereço mudou de fato; segue o caminho
 *     atual, inclusive gravar o par NULL se o geocoding falhar — D3);
 *  2. consultas iguais, ambas `null` (endereço incompleto) E a loja COM coords
 *     gravadas → true, para LIMPAR a coord órfã. D3 continua valendo: coord sem
 *     endereço que a ancore é coord errada;
 *  3. consultas iguais e NÃO-nulas, mas a loja SEM o par gravado → true, para
 *     TENTAR DE NOVO (D-180A-2). Cobre tanto a falha transitória quanto o
 *     endereço que o geocoder não localizou;
 *  4. caso contrário → false: pula o 2º UPDATE inteiro e preserva o par.
 *
 * Função pura e síncrona: nunca lança nem faz I/O.
 */
export function deveRegeocodificar(
  novo: Parameters<typeof montarConsultaGeocoding>[0],
  atual: LojaComCoords,
): boolean {
  const consultaNova = montarConsultaGeocoding(novo);
  const consultaAtual = montarConsultaGeocoding(atual);

  if (consultaNova !== consultaAtual) return true;
  // Consulta nula dos dois lados: só age para LIMPAR coord órfã (regra 2).
  if (consultaNova === null) return temCoordenadas(atual);
  // Consulta válida e inalterada: age só se o par está FALTANDO (regra 3,
  // D-180A-2) — é a única saída da loja que perdeu a coord sem mudar de endereço.
  return !temCoordenadas(atual);
}
