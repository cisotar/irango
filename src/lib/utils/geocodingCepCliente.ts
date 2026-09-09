// Issue 185 — construção da consulta de geocoding do CEP do CLIENTE e guard
// geográfico. Funções PURAS (sem I/O, sem server-only) para serem testáveis
// isoladamente e reusáveis pelo caminho da loja (issue 186).
//
// D1c do Plano Técnico (revisto): a consulta é SEMPRE "<cidade> - <uf>, Brasil".
// O CEP NUNCA entra na consulta — é o token comprovadamente envenenador
// (q=12914-190 resolveu para uma estrada na República Tcheca). O logradouro
// também fica de fora: é o token com maior chance de não existir no OSM, e sua
// ausência derrubaria a resolução inteira.
//
// O BAIRRO saiu da consulta pelo mesmo motivo: o CEP real que motivou a issue
// (12914-190) resolve no ViaCEP para "Jardim Sevilha", bairro que NÃO existe no
// OSM/Nominatim para Bragança Paulista — a consulta com bairro volta VAZIA
// mesmo com a cidade existindo, e o frete por raio vira "indisponível". Para
// DISTÂNCIA, o centroide da cidade basta. O bairro segue chegando ao lojista
// pelo outro caminho (exibição em FormEndereco/buscarCep e mensagem de
// WhatsApp), intocado por esta função.
import type { EnderecoCepResolvido } from "./resolverCepServidor";

// Bounding box do Brasil (bordas inclusivas), defesa em profundidade da D1.
const LATITUDE_MIN = -34;
const LATITUDE_MAX = 6;
const LONGITUDE_MIN = -74;
const LONGITUDE_MAX = -34;

/**
 * Monta a consulta textual do Nominatim a partir do endereço resolvido pelo
 * servidor. `null` quando falta cidade ou UF: sem âncora geográfica NÃO se monta
 * consulta de consolo (fail-closed). O bairro NÃO é lido — ver cabeçalho.
 */
export function montarConsultaCepCliente(e: EnderecoCepResolvido): string | null {
  const cidade = e.cidade?.trim() ?? "";
  const uf = e.uf?.trim() ?? "";
  if (!cidade || !uf) return null;

  return `${cidade} - ${uf}, Brasil`;
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
