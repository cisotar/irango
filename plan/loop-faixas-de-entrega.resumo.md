# Nova tela de entregas: preço por faixa de distância
2026-09-27 19:18 · plano detalhado: plan/loop-faixas-de-entrega.md

**O que você pediu:** implementar a nova tela de entregas do painel exatamente como no desenho aprovado (faixas de 1 ou 2 km, preço e frete grátis por faixa, limite de entrega automático).

**O que vai ser feito:** o lojista monta as faixas numa tabela só (0–1 km, 1–2 km…) e salva tudo de uma vez. O salvamento é "tudo ou nada": se algo falhar no meio, nada muda na vitrine, e o cliente nunca vê preço novo e velho misturados. Quem já tem entrega cadastrada abre a tela com as faixas preenchidas nos mesmos preços de hoje, e nada muda até clicar em Salvar. O hub admin ganha a mesma tela.

**Cuidados:**
- O preço cobrado continua sendo calculado pelo servidor. A tela só envia os preços, e distância e nome de cada faixa são montados no servidor.
- Uma loja não consegue gravar faixas em outra, e o teste disso é escrito antes do código.
- O alerta do desenho ("o sistema aplica o menor preço") descreve a regra antiga. O quadro fica, com texto novo.

**Tempo estimado:** 2h40 a 3h20 · **Versão mais rápida:** tirar a revisão de qualidade e os testes extras, que ficam fora da parte de segurança, economiza uns 30 min (2h15 a 2h50).

**Já respondido por você (2026-09-27):**
- O preço deve subir com a distância. Se uma faixa mais longe tiver preço menor, aparece um alerta, mas o lojista pode salvar assim mesmo.
- O lojista não pode pular faixas, então nenhuma faixa tem botão de ligar/desligar.
- A lixeira aparece só na última faixa.
- Esta tela resolve a anotação 325, que será apagada.

**Precisa de você:**
1. Autorizar a publicação da mudança no banco (é uma função nova, nenhuma tabela é alterada).
2. Testar na tela da loja "Lanches base", no celular e no computador. São 9 cliques, a lista vem no fim.
3. Autorizar o envio e a abertura do pedido de revisão (PR).
