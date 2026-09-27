/**
 * [303/RN-02] A janela de EXIBIÇÃO do modal sazonal — coisa PRÓPRIA, separada
 * da vigência do cardápio (RN-04/RN-08).
 *
 * Função pura, avaliada SEMPRE no servidor (SSR): o cliente nunca decide se o
 * modal está na janela. `agora` entra por parâmetro (determinismo no teste;
 * nenhum `new Date()` aqui dentro).
 *
 * Comparação de INSTANTE com INSTANTE — `exibicao_inicio`/`exibicao_fim` são
 * `timestamptz`, então o fuso da loja NÃO muda o veredito (mesma aritmética de
 * `dentroDoPrazo` em `vigenciaCardapio.ts`). Início INCLUSIVO, fim EXCLUSIVO —
 * a convenção do prazo de cardápio e de desconto.
 */
export function dentroDaJanelaExibicao(
  modal: { exibicao_inicio: string; exibicao_fim: string },
  agora: Date,
): boolean {
  const instante = agora.getTime();
  if (instante < Date.parse(modal.exibicao_inicio)) return false;
  if (instante >= Date.parse(modal.exibicao_fim)) return false;
  return true;
}
