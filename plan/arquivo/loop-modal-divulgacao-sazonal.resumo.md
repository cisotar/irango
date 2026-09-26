# Um aviso de temporada na página da loja
2026-09-25 00:00 · plano detalhado: plan/loop-modal-divulgacao-sazonal.md

**O que você pediu:** um cartaz que aparece sozinho na página da loja para divulgar produtos de uma data comemorativa ou promoção, que o dono monta no painel.

**O que vai ser feito:** no painel, o dono cria um aviso com título e as datas em que ele deve aparecer, e escolhe os produtos a mostrar — por grupo de produtos ou por um cardápio de época que ele já tenha. Na página da loja, esse aviso aparece uma vez por dia para cada visitante, do mesmo jeito que o aviso de promoções de hoje já funciona hoje. O dono também decide, num botão, se o aviso de promoções continua aparecendo junto ou fica escondido enquanto o aviso de temporada estiver no ar. A loja só pode ter um aviso desses ligado por vez.

**Cuidados:**
- Nenhum dono pode ver, editar ou ligar o aviso de outra loja — isso é testado antes de o código entrar, porque é o ponto onde um erro vazaria uma loja para a outra.
- O sistema garante que só exista um aviso ligado por loja: tentar ligar um segundo desliga o primeiro (ou é recusado), sem sobrar dois no ar.
- O título que o dono escreve é tratado como texto simples, nunca como comando, para não abrir brecha na página pública.

**Tempo estimado:** cerca de 3 a 4 horas e meia · **Versão mais rápida:** dá para tirar a revisão de qualidade e a atualização da documentação interna e juntar duas etapas de programação, caindo para cerca de 2 horas e meia a 3 horas e meia — mas aí a documentação do banco fica devendo e não há uma segunda leitura de qualidade. Os testes de segurança NÃO saem em nenhuma versão.

**Precisa de você:** aprovar a gravação no banco de dados de verdade e a publicação do trabalho (são três confirmações rápidas no meio do caminho); e, no fim, fazer um teste de tela: criar um aviso no painel, abrir a loja numa aba anônima e conferir que ele aparece uma vez no dia, que não volta ao recarregar, e que o botão de esconder as promoções funciona.
