// Classificação da CAUSA do frete indisponível (issue 003, RN-2-C).
//
// Função PURA, sem I/O — fonte única consumida por `calcularFreteAction` (005)
// para decidir a MENSAGEM ao cliente: "a loja tem zona raio_km ativa mas está
// sem coords" (misconfiguração — nenhum endereço resolveria) é diferente de
// "endereço genuinamente fora de área" (trocar de endereço pode resolver).
//
// NÃO decide taxa nem altera `calcularFrete` (o cálculo do valor permanece
// intacto: já degrada para fallback/indisponível corretamente). Aqui só
// classificamos a causa. As coords entram como BOOLEANO derivado no servidor —
// nunca o par (lat,lng) cru (seguranca.md §19).

import type { ZonaComTaxa } from "./calcularFrete";

/**
 * Veredito de preview (005) quando a loja tem zona por raio mas está sem coords.
 * Constante COMPARTILHADA entre a Server Action (`calcularFreteAction`) e a UI
 * (`EtapaEntrega`) para que o literal não divirja silenciosamente entre os dois
 * lados — um typo viraria runtime, não erro de compilação.
 */
export const VEREDITO_LOJA_SEM_COORDS = "indisponivel_loja";

/**
 * `true` quando a loja depende de raio para entregar mas não tem coordenadas:
 * existe ao menos uma zona `tipo === "raio_km"` ATIVA e COM taxa, e a loja está
 * sem coords (`temCoords === false`). Nesse estado, a zona raio nunca casa
 * (`distanciaKm` indefinido) e a mensagem "tente outro endereço" enganaria o
 * cliente — nenhum endereço resolveria a falta de coords da loja.
 *
 * Espelha o predicado de `zonaAtende` (calcularFrete): só conta zona ativa e com
 * taxa, como o cálculo do valor — assim a classificação não diverge do cálculo.
 */
export function lojaTemRaioSemCoords(
  zonas: ZonaComTaxa[],
  temCoords: boolean,
): boolean {
  if (temCoords) return false;
  // (180-B) O predicado das zonas é UM SÓ (`distanciaEraNecessaria`): duplicá-lo
  // aqui permitiria que a mensagem de misconfiguração e a classificação de
  // frete divergissem num futuro ajuste de `zonaAtende`.
  return distanciaEraNecessaria(zonas);
}

// ─────────────────────── Classificação do frete (180-B) ─────────────────────
// A invariante que esta seção existe para garantir:
//   "o valor cobrado só pode derivar de FATO conhecido sobre o endereço;
//    AUSÊNCIA de conhecimento não é um fato sobre o endereço."
//
// O fallback fora-de-zona é uma regra de negócio sobre o ENDEREÇO ("você mora
// fora das minhas zonas"); aplicá-lo a uma falha de INFRAESTRUTURA nossa cobra
// do cliente por um problema que não é dele. Daí a inversão deliberada: o
// veredito a-combinar PRECEDE o fallback fora-de-zona.

import type { CausaDistancia } from "@/lib/actions/distanciaFrete";
import type { ResultadoFrete } from "./calcularFrete";

/** Frete não pôde ser calculado; o canal pode voltar — a UI retenta (10s/20s). */
export const VEREDITO_A_COMBINAR_RETRIAVEL = "a_combinar_retriavel";
/** Orçamento da PLATAFORMA esgotado — retentar AGORA não adianta, sem retry. */
export const VEREDITO_A_COMBINAR_ESGOTADO = "a_combinar_esgotado";
/** O CEP não foi localizado — pede conferir o CEP, sem retry. */
export const VEREDITO_A_COMBINAR_CEP = "a_combinar_cep";
/**
 * (spec modalidades-entrega-loja, D5) A LOJA escolheu combinar o frete no
 * WhatsApp (`lojas.modo_frete = 'a_combinar'`). Não é falha nem input errado:
 * sem modal, sem retry, sem pedir para conferir o CEP. Não sai de
 * `classificarFrete` (que classifica falha de cálculo); quem o emite é o
 * preview quando a configuração da loja manda não calcular.
 */
export const VEREDITO_A_COMBINAR_LOJA = "a_combinar_loja";

/**
 * (auditoria 180-B / achado 1 + decisão de UX) O ViaCEP AFIRMOU que o CEP não
 * existe E a loja não tem fallback fora-de-zona. Sem bairro canônico nenhuma
 * zona casa, então o resultado é "não atendido" — mas dizer "não atendemos seu
 * bairro" seria MENTIR sobre a causa: o problema é o CEP digitado, e o cliente
 * pode consertá-lo. Consertar a mentira no caminho a-combinar e deixá-la de pé
 * no caminho indisponível seria meia correção.
 */
export const VEREDITO_CEP_NAO_EXISTE = "indisponivel_cep";

export type VereditoACombinar =
  | typeof VEREDITO_A_COMBINAR_RETRIAVEL
  | typeof VEREDITO_A_COMBINAR_ESGOTADO
  | typeof VEREDITO_A_COMBINAR_CEP
  | typeof VEREDITO_A_COMBINAR_LOJA;

export type VereditoFrete =
  | { tipo: "ok" }
  | { tipo: "a_combinar"; veredito: VereditoACombinar }
  | {
      tipo: "indisponivel";
      veredito:
        | "indisponivel"
        | typeof VEREDITO_LOJA_SEM_COORDS
        | typeof VEREDITO_CEP_NAO_EXISTE;
    };

/**
 * `true` quando existe ao menos uma zona `raio_km` ATIVA e COM taxa, isto é,
 * quando a distância ERA necessária para calcular o frete desta loja.
 *
 * Espelha o predicado de `zonaAtende` (calcularFrete) — mesma condição de
 * `lojaTemRaioSemCoords` — para que a classificação não divirja do cálculo.
 * Loja sem nenhuma zona de raio nunca dependeu da distância: ali o fallback
 * fora-de-zona é regra de negócio legítima e CONTINUA valendo.
 */
export function distanciaEraNecessaria(zonas: ZonaComTaxa[]): boolean {
  return zonas.some((z) => z.tipo === "raio_km" && z.ativo && z.taxa != null);
}

/**
 * Causas que podem virar "a combinar" — falha GENUÍNA do serviço EXTERNO de
 * geocoding, e só ela (invariante da auditoria da 180-B). Ficam DE FORA, de
 * propósito: `cep_inexistente` (input do cliente), `throttle_interno` (nosso
 * throttle) e `indisponivel_config` (nossa config quebrada). Nenhuma das três
 * pode zerar o frete — todas caem no ramo `!resultado.atendido`/`ok` abaixo,
 * exatamente como era antes da 180-B.
 *
 * (re-auditoria 180-B / MÉDIA B) `esgotado_ip` é a QUARTA de fora, e pela mesma
 * razão: o teto diário POR IP é throttle NOSSO e, pior, é ACIONÁVEL pelo
 * comprador — bastavam 51 CEPs distintos (cache miss forçado, ~3 minutos sob o
 * rate limit de ~20/min da action) para ele se auto-conceder `taxa_entrega`
 * NULL. Só `esgotado_global` (o orçamento da PLATAFORMA, que um comprador
 * sozinho não alcança) permanece. Consequência deliberada e já documentada:
 * CGNAT móvel / NAT corporativo, que estouram o teto por IP legitimamente,
 * voltam a pagar o fallback fora-de-zona como antes da 180-B — sem que a
 * mensagem ao cliente o culpe por isso.
 */
const CAUSAS_A_COMBINAR = [
  "nao_encontrado",
  "transitorio",
  "esgotado_global",
  "erro",
] as const satisfies readonly CausaDistancia[];

type CausaACombinar = (typeof CAUSAS_A_COMBINAR)[number];

function ehCausaACombinar(causa: CausaDistancia): causa is CausaACombinar {
  return (CAUSAS_A_COMBINAR as readonly CausaDistancia[]).includes(causa);
}

/** Causa da distância → veredito exibível (a pergunta é "retentar adianta?"). */
function vereditoDaCausa(causa: CausaACombinar): VereditoACombinar {
  switch (causa) {
    case "esgotado_global":
      return VEREDITO_A_COMBINAR_ESGOTADO;
    case "nao_encontrado":
      return VEREDITO_A_COMBINAR_CEP;
    // `transitorio` e `erro` (exceção interna, blip de banco/PostgREST) são
    // transitórios do ponto de vista da UI: retentar em segundos pode resolver.
    default:
      return VEREDITO_A_COMBINAR_RETRIAVEL;
  }
}

/**
 * Fonte ÚNICA da decisão "ok × a combinar × indisponível", consumida pelo
 * preview (`calcularFreteAction`) e pelo autoritativo (`criarPedido`) — os dois
 * PRECISAM concordar (RN-7), e duplicar esta decisão seria exatamente o bug que
 * a issue 180-B corrige.
 *
 *   a_combinar ⟺ causa ∈ {nao_encontrado, transitorio, esgotado_global, erro}
 *              ∧ resultado.zonaId == null          // nenhuma zona específica casou
 *              ∧ distanciaEraNecessaria(zonas)     // a distância importava
 *
 * As três conjunções importam: zona específica que casou é FATO conhecido (a
 * falha de geocoding é irrelevante); loja sem zona de raio nunca dependeu da
 * distância.
 *
 * `loja_sem_coords` NÃO vira a combinar (decisão registrada na issue 180-B,
 * "Ambiguidades RESOLVIDAS"): é misconfiguração da LOJA, tratada pela 193, e
 * tolerá-la no checkout removeria o incentivo de corrigi-la.
 *
 * `temCoordsLoja` só é consultado no ramo `sem_cep` (onde o caminho de raio nem
 * se aplica e o veredito 005 ainda vale); `null` = não consultado.
 *
 * Função PURA, sem I/O. O par (lat,lng) nunca entra nem sai: só enum e booleano
 * derivados no servidor (seguranca.md §19).
 */
export function classificarFrete(args: {
  resultado: ResultadoFrete;
  zonas: ZonaComTaxa[];
  causaDistancia: CausaDistancia;
  temCoordsLoja: boolean | null;
}): VereditoFrete {
  const { resultado, zonas, causaDistancia, temCoordsLoja } = args;

  // O CORAÇÃO: a distância era necessária (existe zona de raio ativa e com
  // taxa) e NENHUMA zona específica casou — ou seja, o frete só poderia sair do
  // raio, e o raio não pôde ser avaliado. PRECEDE tanto o fallback fora-de-zona
  // quanto o "não atendemos seu bairro".
  //
  // Se uma zona específica casou (bairro/faixa_cep), o frete é FATO conhecido e
  // nada aqui se aplica — mesmo com o geocoder no chão.
  if (resultado.zonaId == null && distanciaEraNecessaria(zonas)) {
    // Misconfiguração da LOJA (não do canal): mensagem própria (005), sem
    // retry e sem WhatsApp — a 193 exige coordenada para publicar, então esse
    // estado é para ser CORRIGIDO, não tolerado como "a combinar".
    if (causaDistancia === "loja_sem_coords") {
      return { tipo: "indisponivel", veredito: VEREDITO_LOJA_SEM_COORDS };
    }
    // (auditoria 180-B) A LISTA é branca, não preta: uma causa NOVA que ninguém
    // adicionar a `CAUSAS_A_COMBINAR` nunca zera frete por esquecimento.
    if (ehCausaACombinar(causaDistancia)) {
      return { tipo: "a_combinar", veredito: vereditoDaCausa(causaDistancia) };
    }
  }

  if (!resultado.atendido) {
    // (auditoria 180-B / decisão de UX) O CEP não existe: a causa da recusa é o
    // CEP, não o bairro. `cep_inexistente` chega aqui em qualquer configuração
    // de zonas (o bairro canônico foi descartado pelo fail-closed da 064, logo
    // nenhuma zona 'bairro' poderia casar) — então a checagem NÃO depende de
    // haver zona de raio.
    if (causaDistancia === "cep_inexistente") {
      return { tipo: "indisponivel", veredito: VEREDITO_CEP_NAO_EXISTE };
    }
    return {
      tipo: "indisponivel",
      veredito: lojaTemRaioSemCoords(zonas, temCoordsLoja !== false)
        ? VEREDITO_LOJA_SEM_COORDS
        : "indisponivel",
    };
  }

  return { tipo: "ok" };
}
