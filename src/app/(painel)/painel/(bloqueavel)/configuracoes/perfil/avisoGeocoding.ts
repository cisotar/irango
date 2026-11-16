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
//
// Issue 368 (DD8/DD9): o motivo é obrigatório (sem motivo, o caller cai em
// "transitorio" — nunca culpa o dado do lojista) e há dois conjuntos de texto:
// "salvar" (save do perfil, textos de sempre) e "localizar" (botão "Localizar
// meu endereço de novo", que não salva nada — logo não fala em salvar).

import type { MotivoGeocoding } from "@/lib/utils/geocodificarEndereco";

export type AcaoGeocoding = "salvar" | "localizar";

type ClasseFalha = "instantes" | "rajada" | "config" | "esgotado" | "endereco";

function classeDaFalha(motivo: MotivoGeocoding): ClasseFalha {
  switch (motivo) {
    case "transitorio":
      // Canal externo piscou: repetir em instantes costuma resolver.
      return "instantes";
    case "throttle_interno":
      // NOSSO limitador de rajada negou. Falha nossa, janela de 1 segundo.
      return "rajada";
    case "indisponivel_config":
      // Falta uma variável de ambiente NOSSA. Não volta sozinha em segundos e
      // o lojista não tem o que corrigir — já há console.error no servidor.
      return "config";
    case "esgotado_global":
    case "esgotado_ip":
      // Teto diário do serviço de mapas. Falha NOSSA de capacidade; só vira na
      // virada do dia, então nada de "tente em instantes".
      return "esgotado";
    case "nao_encontrado":
    case "cep_inexistente":
      // Só aqui o DADO do lojista é o problema: a Google não indexa o endereço
      // ou o ViaCEP afirmou que o CEP não existe.
      return "endereco";
  }
}

const TEXTOS: Record<AcaoGeocoding, Record<ClasseFalha, string>> = {
  salvar: {
    instantes:
      "Não conseguimos localizar seu endereço agora. Tente salvar novamente em instantes para ativar as zonas por raio.",
    rajada:
      "Muitas consultas ao mapa ao mesmo tempo por aqui. Seu endereço foi salvo; tente salvar novamente em instantes para ativar as zonas por raio.",
    config:
      "Nosso serviço de mapas está com um problema de configuração e nossa equipe já foi avisada. Seu endereço foi salvo; tente novamente mais tarde para ativar as zonas por raio.",
    esgotado:
      "O serviço de mapas está indisponível no momento. Seu endereço foi salvo; tente salvar novamente mais tarde para ativar as zonas por raio.",
    endereco:
      "Não localizamos seu endereço no mapa — confira rua, número e CEP. Zonas por raio ficam inativas até corrigir.",
  },
  localizar: {
    instantes: "Tente de novo em instantes: o mapa não respondeu agora.",
    rajada:
      "Tente de novo em instantes: muitas consultas ao mapa ao mesmo tempo por aqui.",
    config:
      "Tente de novo mais tarde: nosso serviço de mapas está com um problema de configuração e nossa equipe já foi avisada.",
    esgotado:
      "Tente de novo mais tarde: o serviço de mapas está indisponível no momento.",
    endereco:
      "Confira rua, número e CEP no perfil: o mapa não encontrou esse endereço.",
  },
};

export function avisoGeocodingPerfil(
  motivo: MotivoGeocoding,
  acao: AcaoGeocoding = "salvar",
): string {
  return TEXTOS[acao][classeDaFalha(motivo)];
}
