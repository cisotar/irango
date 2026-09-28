# 328 — Gravação de faixas de entrega sobrescreve edição feita em outra aba

crítica: SIM (valor de frete)

## Origem

Achado BAIXA da auditoria da iteração 2 da issue 326 (commit `fba513c`).

## Problema

A RPC `salvar_faixas_entrega` apaga e regrava a tabela inteira da loja, e a tela
`TabelaFaixasEntrega` grava automaticamente ao sair de cada campo. Se o lojista abre a tela em
duas abas, ou se o admin edita pelo hub enquanto o lojista está com a tela aberta, a aba que
gravar por último desfaz a outra sem aviso. A vitrine volta a cobrar preços antigos que o próprio
lojista já tinha trocado.

Sem atacante e sem cruzamento entre lojas: o efeito fica na loja do próprio dono. Já existia com o
botão Salvar da iteração 1; o salvamento automático aumenta a chance.

## Direção sugerida

Controle otimista: a tela lê uma versão junto com as zonas (por exemplo, um contador em `lojas` ou
a maior data de alteração das zonas da loja) e a manda na gravação; a RPC recusa com mensagem
estável se o banco mudou desde a leitura, e a tela pede para recarregar. Exige migration e teste
vermelho antes (valor de frete).
