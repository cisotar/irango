# Trocar a forma de cobrar a entrega só com um botão
2026-10-18 18:09 · plano detalhado: plan/loop-ativar-forma-frete.md

**O que você pediu:** salvar zonas de outra forma de cobrança não muda mais o frete; só o botão "Usar esta forma" muda.

**O que vai ser feito:** o lojista pode preencher bairros ou CEPs à vontade enquanto a loja segue cobrando por distância. Quando quiser trocar, clica "Usar esta forma" na tela da forma escolhida; para voltar, abre a forma antiga e clica o botão de novo, sem redigitar nada. O mesmo vale no painel do administrador.

**Cuidados:**
- O botão fica travado se a forma não tem nenhuma zona ligada com preço, e o sistema também recusa a troca nesse caso: a loja não fica sem entrega por engano.
- Se outra aba ou outra pessoa mexeu nas zonas antes, a troca é recusada e a tela pede para recarregar.
- O teste no ambiente real é feito só na loja "Lanches base"; a loja "Pão do Ciso" não é tocada.

**Tempo estimado:** 1h30 a 2h15 · **Versão mais rápida:** pular a revisão de estilo e a atualização dos documentos internos economiza ~20 min; a parte de segurança não tem atalho.

**Precisa de você:** testar na tela (o ambiente não tem navegador): ver o botão aparecer só na forma que não está valendo, travado sem zona, e o selo "Valendo na vitrine" mudar só depois do clique.
