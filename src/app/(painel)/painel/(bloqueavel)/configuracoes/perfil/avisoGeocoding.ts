// Mensagem de aviso do painel quando o geocoding do endereço da loja não
// produziu coordenadas (as zonas por raio ficam inativas até produzir).
//
// Função PURA e sem JSX, no mesmo molde de `montarPayloadPerfil`: o repo não
// tem jsdom, então a escolha da mensagem só é testável se sair do componente.
//
// A invariante (re-auditoria de segurança da 180-B, achado MÉDIA A): quando a
// falha é NOSSA — nosso balde de burst, nossa env var ausente, nosso orçamento
// de mapas — a mensagem NÃO pode mandar o lojista conferir um endereço que está
// certo. É o mesmo erro de atribuição de culpa que a 180-B eliminou do lado do
// comprador; deixá-lo de pé do lado do lojista seria meia correção.

import type { MotivoGeocoding } from "@/lib/utils/geocodificarEndereco";

/**
 * Só este texto aponta para o DADO do lojista. Reservado aos motivos em que o
 * dado é, de fato, o problema: `nao_encontrado` (a Google não indexa o
 * endereço), `cep_inexistente` (o ViaCEP afirmou que o CEP não existe) e o caso
 * sem motivo (compatibilidade com o retorno antigo de `salvarPerfil`).
 */
const AVISO_ENDERECO =
  "Não localizamos seu endereço no mapa — confira rua, número e CEP. Zonas por raio ficam inativas até corrigir.";

export function avisoGeocodingPerfil(
  motivo: MotivoGeocoding | undefined,
): string {
  switch (motivo) {
    case "transitorio":
      // Canal externo piscou: re-salvar em instantes costuma resolver.
      return "Não conseguimos localizar seu endereço agora. Tente salvar novamente em instantes para ativar as zonas por raio.";
    case "throttle_interno":
      // NOSSO limitador de rajada negou. Falha nossa, janela de 1 segundo — o
      // endereço está certo e já foi salvo; basta repetir em instantes.
      return "Muitas consultas ao mapa ao mesmo tempo por aqui. Seu endereço foi salvo; tente salvar novamente em instantes para ativar as zonas por raio.";
    case "indisponivel_config":
      // Falta uma variável de ambiente NOSSA. Não volta sozinha em segundos e
      // o lojista não tem o que corrigir — já há console.error no servidor.
      return "Nosso serviço de mapas está com um problema de configuração e nossa equipe já foi avisada. Seu endereço foi salvo; tente novamente mais tarde para ativar as zonas por raio.";
    case "esgotado_global":
    case "esgotado_ip":
      // Teto diário do serviço de mapas. Falha NOSSA de capacidade; só vira na
      // virada do dia, então nada de "tente em instantes".
      return "O serviço de mapas está indisponível no momento. Seu endereço foi salvo; tente salvar novamente mais tarde para ativar as zonas por raio.";
    default:
      return AVISO_ENDERECO;
  }
}
