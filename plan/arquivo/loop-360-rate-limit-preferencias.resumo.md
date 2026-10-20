# Limite de salvamentos nas telas de configuração do painel
2026-10-20 09:18 · plano detalhado: plan/loop-360-rate-limit-preferencias.md

**O que você pediu:** um plano seguro e barato para limitar quantas vezes por minuto o lojista pode salvar as telas de Horários, Tema, Entregas e o ciclo do relatório de Vendas.

**O que vai ser feito:** cada lojista ganha uma cota de 30 salvamentos por minuto, dividida entre essas quatro telas. É muito acima do que uma pessoa faz clicando em "Salvar". Robôs e scripts param na cota. Para quem usa normalmente, nada muda. Quem passar da cota vê a mesma mensagem de "não foi possível salvar, tente de novo" que já existe, sem detalhe técnico. As telas do painel de administração do iRango não entram nessa cota.

**Cuidados:**
- A cota é de cada lojista: ninguém consegue gastar a cota de outra loja para travar o painel dela. Um teste automático prova isso.
- Quando a cota estoura, nada é gravado. Outro teste prova.
- Se o serviço que conta os salvamentos cair, o painel continua salvando normalmente. Esse comportamento já existe e não é alterado.

**Tempo estimado:** cerca de 1h a 1h15, com um só revisor automático (dos baratos) no meio. **Versão mais rápida:** sem esse revisor, cerca de 50 a 60 minutos. As provas automáticas continuam, mas ninguém além de quem escreveu olha o código antes do PR. O ciclo completo de sempre levaria de 2h a 2h30 e repetiria o diagnóstico que já foi feito.

**Precisa de você:**
- Aprovar o envio do código e a abertura do PR.
- Depois do PR, na loja "Lanches base": salvar uma vez cada uma das quatro telas e ver a mensagem de sucesso.
- Se preferir outro teto que não 30 por minuto, é só dizer antes de começar.
