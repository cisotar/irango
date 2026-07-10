/**
 * Perfil mínimo para a vitrine ir ao ar (RN-8): nome preenchido + WhatsApp
 * cadastrado. Fonte ÚNICA do predicado — consumido tanto como preview de UX
 * (desabilitar o botão Publicar no cliente) quanto como gate AUTORITATIVO no
 * servidor (`definirPublicacao` do lojista e `publicarLojaAdmin` do admin). O
 * cliente nunca decide se pode publicar; o servidor revalida com esta mesma regra.
 */
export function podePublicarLoja(
  nome: string | null | undefined,
  whatsapp: string | null | undefined,
): boolean {
  return Boolean(nome?.trim() && whatsapp);
}

/** Mensagem única exibida quando o perfil mínimo não está completo. */
export const ERRO_PERFIL_INCOMPLETO =
  "Complete nome e WhatsApp antes de publicar a loja.";
