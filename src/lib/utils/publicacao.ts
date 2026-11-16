/**
 * Gate ÚNICO de publicação da loja (issue 368 + 193, D7). Fonte única da REGRA:
 * consumido como preview de UX (desabilitar "Publicar loja" e listar o que
 * falta) e como gate AUTORITATIVO no servidor — `definirPublicacao` (lojista,
 * inclusive republicar) e `publicarLojaAdmin` (admin, sem exceção) releem o
 * estado do banco via `carregarProntidaoPublicacao`
 * (`src/lib/supabase/queries/publicacao.ts`) e decidem com `podePublicarLoja`.
 * O cliente nunca decide se pode publicar.
 *
 * PURO: sem I/O. As contagens (produtos disponíveis, formas de pagamento) chegam
 * prontas em `EstadoProntidao`.
 */
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import { temCoordenadas } from "@/lib/actions/patches-loja";
import { decidirPrimeirosPassos } from "./acessoPainel";

/**
 * Campos de endereço exigidos para publicar (D7) e no `schemaPerfil` (D12).
 * Lista ÚNICA usada por gate, aviso D15, retomada do assistente e action D14.
 * A paridade com as chaves do `schemaPerfil` é travada por teste.
 */
export const CAMPOS_ENDERECO_LOJA = [
  "endereco_cep",
  "endereco_rua",
  "endereco_numero",
  "endereco_bairro",
  "endereco_cidade",
  "endereco_estado",
] as const;

export type CampoEnderecoLoja = (typeof CAMPOS_ENDERECO_LOJA)[number];

export const ROTULOS_CAMPOS_ENDERECO: Record<CampoEnderecoLoja, string> = {
  endereco_cep: "CEP",
  endereco_rua: "rua",
  endereco_numero: "número",
  endereco_bairro: "bairro",
  endereco_cidade: "cidade",
  endereco_estado: "UF",
};

/** Campos de endereço vazios (ausente, nulo ou só espaços), na ordem da lista. */
export function camposEnderecoFaltando(
  loja: Partial<Record<CampoEnderecoLoja, string | null>>,
): CampoEnderecoLoja[] {
  return CAMPOS_ENDERECO_LOJA.filter((campo) => !loja[campo]?.trim());
}

export type EstadoProntidao = Pick<
  LojaCompleta,
  "nome" | "whatsapp" | CampoEnderecoLoja | "latitude" | "longitude"
> & {
  produtosDisponiveis: number;
  formasPagamento: number;
};

export type PendenciaPublicacao =
  | { tipo: "perfil" }
  | { tipo: "endereco"; faltando: CampoEnderecoLoja[] }
  | { tipo: "localizacao" }
  | { tipo: "pagamento" }
  | { tipo: "produto" };

export type ProntidaoPublicacao =
  | { ok: true }
  | { ok: false; pendencia: PendenciaPublicacao };

/**
 * Todas as pendências, na ordem perfil → endereco → localizacao → pagamento →
 * produto. "localizacao" só aparece com o endereço completo: sem endereço não
 * há o que localizar, e a mensagem certa é a de completar o endereço.
 */
export function pendenciasPublicacao(
  estado: EstadoProntidao,
): PendenciaPublicacao[] {
  const pendencias: PendenciaPublicacao[] = [];
  if (!estado.nome?.trim() || !estado.whatsapp) {
    pendencias.push({ tipo: "perfil" });
  }
  const faltando = camposEnderecoFaltando(estado);
  if (faltando.length > 0) {
    pendencias.push({ tipo: "endereco", faltando });
  } else if (!temCoordenadas(estado)) {
    pendencias.push({ tipo: "localizacao" });
  }
  if (estado.formasPagamento < 1) {
    pendencias.push({ tipo: "pagamento" });
  }
  if (estado.produtosDisponiveis < 1) {
    pendencias.push({ tipo: "produto" });
  }
  return pendencias;
}

/** Gate D7: `{ ok: true }` ou a 1ª pendência. */
export function podePublicarLoja(estado: EstadoProntidao): ProntidaoPublicacao {
  const [primeira] = pendenciasPublicacao(estado);
  return primeira ? { ok: false, pendencia: primeira } : { ok: true };
}

export const ROTULO_LOCALIZAR_DE_NOVO = "Localizar meu endereço de novo";

/** (c) Perfil mínimo incompleto. */
export const ERRO_PERFIL_INCOMPLETO =
  "Complete nome e WhatsApp antes de publicar a loja.";

/** (b) Endereço completo sem coordenada: nunca pede para corrigir o endereço. */
export const ERRO_SEM_LOCALIZACAO = `Toque em “${ROTULO_LOCALIZAR_DE_NOVO}” e tente publicar de novo em instantes.`;

/** (e) Nenhuma forma de pagamento. */
export const ERRO_SEM_PAGAMENTO =
  "Cadastre ao menos uma forma de pagamento antes de publicar a loja.";

/** (d) Nenhum produto disponível. */
export const ERRO_SEM_PRODUTO =
  "Cadastre ao menos um produto disponível antes de publicar a loja.";

function juntarComE(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** (a) Endereço incompleto: lista só os campos que faltam. */
export function mensagemEnderecoIncompleto(
  faltando: readonly CampoEnderecoLoja[],
): string {
  const rotulos = faltando.map((campo) => ROTULOS_CAMPOS_ENDERECO[campo]);
  return `Preencha ${juntarComE(rotulos)} do endereço da loja antes de publicar.`;
}

/** Texto D10 de cada pendência. */
export function mensagemPendencia(p: PendenciaPublicacao): string {
  switch (p.tipo) {
    case "perfil":
      return ERRO_PERFIL_INCOMPLETO;
    case "endereco":
      return mensagemEnderecoIncompleto(p.faltando);
    case "localizacao":
      return ERRO_SEM_LOCALIZACAO;
    case "pagamento":
      return ERRO_SEM_PAGAMENTO;
    case "produto":
      return ERRO_SEM_PRODUTO;
  }
}

export type VarianteAvisoEndereco = "completar-endereco" | "localizar-de-novo";

/**
 * Aviso persistente D15: só para loja já publicada alguma vez (D1). Endereço
 * incompleto → completar no perfil; completo sem par → botão D14. A loja segue
 * no ar: o aviso não despublica nada.
 */
export function varianteAvisoEndereco(
  loja: Pick<
    LojaCompleta,
    "primeira_publicacao_em" | CampoEnderecoLoja | "latitude" | "longitude"
  >,
): VarianteAvisoEndereco | null {
  if (decidirPrimeirosPassos(loja) !== "concluido") return null;
  if (camposEnderecoFaltando(loja).length > 0) return "completar-endereco";
  if (!temCoordenadas(loja)) return "localizar-de-novo";
  return null;
}
