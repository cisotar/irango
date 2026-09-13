// Issue 185 (origem) / 190 (troca de provedor) — construção da(s) consulta(s)
// de geocoding do CEP do CLIENTE e guard geográfico. Funções PURAS (sem I/O,
// sem server-only) para serem testáveis isoladamente e reusáveis pelo caminho
// da loja (issue 186).
//
// Decisão 1 do plano técnico da 190 (plan/tecnico-geocoding-google.md):
// `montarConsultaCepCliente` (1 string, só "<cidade> - <uf>, Brasil") vira
// `montarConsultasCepCliente` (cascata de `string[]`, do mais específico ao
// mais genérico):
//   1. "<logradouro>, <bairro>, <cidade> - <uf>, Brasil" (quando há logradouro)
//   2. "<bairro>, <cidade> - <uf>, Brasil" (quando há bairro)
//   3. "<cidade> - <uf>, Brasil" (sempre presente — nunca fica pior que hoje)
//
// Motivo: a consulta anterior (só cidade-UF) é byte-a-byte idêntica para
// quaisquer dois CEPs da mesma cidade, então o provedor devolvia a MESMA
// coordenada para os dois (causa raiz da 190). O Google tem cobertura de
// endereço BR muito melhor que o OSM — incluir logradouro/bairro discrimina
// ruas diferentes sem precisar do `numero` declarado pelo cliente, que NUNCA
// entra em nenhum candidato (mandato 1 do CLAUDE.md — cliente não influencia
// valor cobrado). A cascata só avança em `ZERO_RESULTS` (ver
// geocodificarEndereco.ts) — é defesa em profundidade para bairro/logradouro
// que não exista no índice do provedor.
import type { EnderecoCepResolvido } from "./resolverCepServidor";

// Bounding box do Brasil (bordas inclusivas), defesa em profundidade da D1.
const LATITUDE_MIN = -34;
const LATITUDE_MAX = 6;
const LONGITUDE_MIN = -74;
const LONGITUDE_MAX = -34;

/**
 * Monta a cascata de consultas textuais para o Google Geocoding a partir do
 * endereço resolvido pelo servidor (ViaCEP), do mais específico ao mais
 * genérico. `[]` quando falta cidade ou UF: sem âncora geográfica NÃO se monta
 * consulta de consolo (fail-closed). O `numero` do cliente NUNCA é lido (não
 * existe no tipo `EnderecoCepResolvido` — ver cabeçalho).
 */
export function montarConsultasCepCliente(e: EnderecoCepResolvido): string[] {
  const cidade = e.cidade?.trim() ?? "";
  const uf = e.uf?.trim() ?? "";
  if (!cidade || !uf) return [];

  const logradouro = e.logradouro?.trim();
  const bairro = e.bairro?.trim();
  const sufixo = `${cidade} - ${uf}, Brasil`;

  const candidatos: string[] = [];
  if (logradouro) {
    candidatos.push(bairro ? `${logradouro}, ${bairro}, ${sufixo}` : `${logradouro}, ${sufixo}`);
  }
  if (bairro) candidatos.push(`${bairro}, ${sufixo}`);
  candidatos.push(sufixo); // sempre presente — nunca fica pior que o comportamento atual

  return [...new Set(candidatos)]; // dedupe preservando ordem (mais específico → mais genérico)
}

/**
 * `true` sse o par está dentro do bounding box do Brasil. Par não-finito é
 * sempre `false`. Guard fail-closed: um resultado fora da caixa vira
 * `nao_encontrado` em vez de distância absurda (e não é cacheado).
 */
export function dentroDoBrasil(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return (
    latitude >= LATITUDE_MIN &&
    latitude <= LATITUDE_MAX &&
    longitude >= LONGITUDE_MIN &&
    longitude <= LONGITUDE_MAX
  );
}
