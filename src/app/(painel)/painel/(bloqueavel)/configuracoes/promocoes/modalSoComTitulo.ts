/**
 * Aviso "só título" do form do modal sazonal (spec
 * modal-sazonal-mensagem-formatada, §Painel, RN-M02). Helper PURO, só UX: nunca
 * bloqueia o submit. Verdadeiro quando o modal não tem mensagem com texto
 * visível nem categoria nem cardápio, para que salvar assim seja decisão
 * consciente do lojista.
 *
 * Recebe a mensagem BRUTA do editor (ou `null`): uma mensagem acima do limite
 * ainda conta como "tem mensagem" (o erro dela é outro aviso).
 */

type MensagemComTexto = {
  paragrafos: readonly { trechos: readonly { texto: string }[] }[];
};

export const AVISO_MODAL_SO_COM_TITULO =
  "Este modal vai aparecer só com o título. Escreva uma mensagem ou escolha pratos para divulgar, se quiser.";

export function modalSoComTitulo({
  mensagem,
  categorias,
  cardapios,
}: {
  mensagem: MensagemComTexto | null;
  categorias: readonly string[];
  cardapios: readonly string[];
}): boolean {
  if (categorias.length > 0 || cardapios.length > 0) return false;
  if (mensagem === null) return true;
  return !mensagem.paragrafos.some((p) => p.trechos.some((t) => /\S/.test(t.texto)));
}
