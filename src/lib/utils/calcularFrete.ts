import type { Tables } from "@/lib/database.types";

// Linhas do banco, reusando tipos gerados (não redefinir o shape do banco à mão).
type Zona = Pick<Tables<"zonas_entrega">, "id" | "tipo" | "ativo">;
type Taxa = Pick<
  Tables<"taxas_entrega">,
  "taxa" | "pedido_minimo_gratis" | "raio_max_km" | "cep_inicio" | "cep_fim"
>;
type Bairro = Pick<Tables<"bairros_zona">, "nome">;

/**
 * Zona já "hidratada" com sua taxa e (se tipo 'bairro') seus bairros.
 * O caller (query em lib/supabase/queries/) faz o join; a função pura recebe pronto.
 */
export interface ZonaComTaxa extends Zona {
  /** taxas_entrega 1:1 com a zona; null = zona mal configurada (ignorada). */
  taxa: Taxa | null;
  /** só relevante p/ tipo 'bairro'; vazio nos outros. */
  bairros: Bairro[];
}

/** Endereço do cliente. Campos opcionais — nem todo tipo de zona precisa de todos. */
export interface EnderecoEntrega {
  bairro?: string | null;
  cep?: string | null;
  /** calculada a montante (geocoding) — fora do escopo desta fn. */
  distanciaKm?: number | null;
}

export interface ResultadoFrete {
  /** false = endereço fora de qualquer zona ativa. Checar ANTES de `taxa`. */
  atendido: boolean;
  /** 0 quando !atendido OU quando gratis; sempre 2 casas. */
  taxa: number;
  /** id da zona que resolveu; null se !atendido. */
  zonaId: string | null;
  /** true se subtotal atingiu pedido_minimo_gratis da zona escolhida. */
  gratis: boolean;
}

/** Sentinela de "fora de área" — estado de negócio esperado, não exceção. */
const FORA_DE_AREA: ResultadoFrete = {
  atendido: false,
  taxa: 0,
  zonaId: null,
  gratis: false,
};

/**
 * Normaliza bairro para comparação insensível a caixa, acentos e espaços extras.
 * Sequência: trim → NFD (separa diacríticos) → remove diacríticos → lowercase
 * → colapsa espaços internos duplos.
 *
 * Determinística e pura — mesma entrada sempre produz mesma saída.
 * Exportada para reuso em Server Actions (criarPedido, calcularFreteAction) — RN-C4.
 */
export function normalizarBairro(valor: string): string {
  return valor
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** numeric(10,2): 2 casas, neutraliza float drift. Retorna number (não string). */
function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Verdadeiro se a zona ativa+com-taxa atende o endereço informado. */
function zonaAtende(zona: ZonaComTaxa, endereco: EnderecoEntrega): boolean {
  const { raio_max_km, cep_inicio, cep_fim } = zona.taxa!;
  switch (zona.tipo) {
    case "bairro": {
      const bairro = endereco.bairro;
      if (!bairro) return false;
      const alvo = normalizarBairro(bairro);
      return zona.bairros.some((b) => normalizarBairro(b.nome) === alvo);
    }
    case "raio_km": {
      const dist = endereco.distanciaKm;
      return dist != null && raio_max_km != null && dist <= raio_max_km;
    }
    case "faixa_cep": {
      // CEP do cliente normalizado para inteiro (só dígitos, descarta hífen).
      // Faixa mal configurada (cep_inicio/cep_fim null) ou sem CEP → não atende.
      if (cep_inicio == null || cep_fim == null) return false;
      const cep = endereco.cep;
      if (!cep) return false;
      const digitos = cep.replace(/\D/g, "");
      if (digitos === "") return false;
      const cepNum = Number(digitos);
      return cepNum >= cep_inicio && cepNum <= cep_fim;
    }
    default:
      return false;
  }
}

/**
 * Calcula a taxa de entrega a partir das zonas da loja e do endereço.
 * Função PURA, sem I/O — fonte única de verdade do frete: preview na vitrine
 * (UX) e valor autoritativo recalculado na Server Action de criar pedido
 * (seguranca.md §10). O caller server-side é quem garante que `zonas` já
 * pertencem à loja correta (escopo por loja_id / RLS).
 *
 * Resolução (RN-C4):
 * 1. Ignora zonas inativas e sem taxa.
 * 2. Entre as que atendem, escolhe a de MENOR taxa (melhor p/ o cliente);
 *    empate → primeira na ordem recebida.
 * 3. Frete grátis avaliado na zona escolhida (subtotal >= pedido_minimo_gratis;
 *    null = nunca grátis).
 * 4. Se nenhuma zona atender → usa `taxaForaZona` (RN-C4 passo 4):
 *    - number   → atendido:true, taxa:taxaForaZona, zonaId:null
 *    - null/undefined → FORA_DE_AREA (entrega indisponível)
 *
 * RN-C8: normalização nunca reduz frete — match falha → fallback (mais caro)
 * ou indisponível, nunca zona mais barata inventada.
 */
export function calcularFrete(
  zonas: ZonaComTaxa[],
  endereco: EnderecoEntrega,
  subtotal: number,
  /** Taxa fixa para endereços fora das zonas configuradas (lojas.taxa_entrega_fora_zona).
   * null | undefined = entrega indisponível fora de zona. */
  taxaForaZona?: number | null,
): ResultadoFrete {
  let escolhida: ZonaComTaxa | null = null;

  for (const zona of zonas) {
    if (!zona.ativo || zona.taxa == null) continue;
    if (!zonaAtende(zona, endereco)) continue;
    // menor taxa vence; empate mantém a primeira (estável).
    if (escolhida == null || zona.taxa.taxa < escolhida.taxa!.taxa) {
      escolhida = zona;
    }
  }

  if (escolhida == null) {
    // Nenhuma zona cobriu o endereço — aplica fallback fora-de-zona (RN-C4 passo 4).
    if (taxaForaZona != null) {
      return {
        atendido: true,
        taxa: Math.max(0, arredondar(taxaForaZona)),
        zonaId: null,
        gratis: false,
      };
    }
    return FORA_DE_AREA;
  }

  const { taxa, pedido_minimo_gratis } = escolhida.taxa!;
  const gratis =
    pedido_minimo_gratis != null && subtotal >= pedido_minimo_gratis;

  return {
    atendido: true,
    // piso 0: taxa negativa no banco não pode reduzir o total que o cliente paga.
    taxa: gratis ? 0 : Math.max(0, arredondar(taxa)),
    zonaId: escolhida.id,
    gratis,
  };
}
