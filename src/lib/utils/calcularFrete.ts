import type { Tables } from "@/lib/database.types";

// Linhas do banco, reusando tipos gerados (não redefinir o shape do banco à mão).
type Zona = Pick<Tables<"zonas_entrega">, "id" | "tipo" | "ativo">;
type Taxa = Pick<
  Tables<"taxas_entrega">,
  "taxa" | "pedido_minimo_gratis" | "raio_max_km"
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

/** Normaliza bairro: trim + lowercase + colapsa espaços internos. */
function normalizarBairro(valor: string): string {
  return valor.trim().toLowerCase().replace(/\s+/g, " ");
}

/** numeric(10,2): 2 casas, neutraliza float drift. Retorna number (não string). */
function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Verdadeiro se a zona ativa+com-taxa atende o endereço informado. */
function zonaAtende(zona: ZonaComTaxa, endereco: EnderecoEntrega): boolean {
  const { raio_max_km } = zona.taxa!;
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
    case "faixa_cep":
      // TODO: schema de faixa (cep_inicio/cep_fim) pendente — habilitar exige migration.
      return false;
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
 * Resolução: ignora zonas inativas e sem taxa. Entre as que atendem, escolhe a
 * de MENOR taxa (melhor p/ o cliente); empate → primeira na ordem recebida.
 * Frete grátis avaliado na zona escolhida (subtotal >= pedido_minimo_gratis;
 * null = nunca grátis). Fora de área → sentinela { atendido: false, ... }.
 */
export function calcularFrete(
  zonas: ZonaComTaxa[],
  endereco: EnderecoEntrega,
  subtotal: number,
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

  if (escolhida == null) return FORA_DE_AREA;

  const { taxa, pedido_minimo_gratis } = escolhida.taxa!;
  const gratis =
    pedido_minimo_gratis != null && subtotal >= pedido_minimo_gratis;

  return {
    atendido: true,
    taxa: gratis ? 0 : arredondar(taxa),
    zonaId: escolhida.id,
    gratis,
  };
}
