# Lojista recupera a própria senha, sem chamar o suporte
2026-11-01 12:15 · plano detalhado: plan/loop-recuperacao-senha-lojista.md

**O que você pediu:** colocar no ar a recuperação de senha do lojista descrita no documento revisado hoje (versão 0.2.0), pelo caminho mais seguro e barato, separado do trabalho do #281.

**O que vai ser feito:** a tela de login ganha "Esqueci minha senha?". O lojista informa o e-mail, recebe um link, abre no mesmo navegador, escolhe a nova senha e volta para o login com o aviso "Senha redefinida". Primeiro se escrevem os testes que provam as regras de segurança (eles falham de propósito); depois o código que os faz passar; depois uma revisão de segurança independente. As peças que a área do cliente já usa para isso são reaproveitadas, não copiadas.

**Cuidados:**
- Ninguém descobre se um e-mail tem conta: a resposta e o tempo de espera são sempre os mesmos.
- Só quem abriu o link do e-mail troca a senha. Quem só achou o painel aberto não consegue trocar sem saber a senha atual.
- Depois da troca, todos os aparelhos logados naquela conta saem. E recuperar a senha nunca cria loja nem muda o tipo da conta.

**Tempo estimado:** 2h20 a 3h40, mais os seus testes na tela · **Versão mais rápida:** pular a revisão de qualidade do código e a atualização da documentação interna economiza 10 a 15 minutos e um pouco de custo. A segurança fica igual.

**Precisa de você:**
- Aprovar o envio do código e a abertura do pedido de revisão (nada vai para o ar sem o seu ok).
- No painel do Supabase, conferir duas coisas: o e-mail sai por um provedor próprio (sem isso o link não chega a lojistas de verdade) e a lista de endereços de retorno aceitos só tem os endereços do iRango.
- Testar na tela com a loja de teste "Lanches base", nunca na loja real. São 9 passos, listados no pedido de revisão. Isso troca a senha da conta de teste, e um deles usa dois navegadores ao mesmo tempo.
- Decidir o destino dos dois testes de segurança de ontem (o do #281 e o do #330). Eles vão ser guardados à parte, fora deste trabalho. Hoje eles descrevem falhas pequenas que ainda estão abertas, e o código do projeto é público. Por isso não devem ser publicados enquanto essas falhas não forem corrigidas ou retiradas dos testes. Quando você voltar ao #281, eles são devolvidos à pasta.
- Uma falha parecida na área do cliente fica registrada para depois, numa tarefa à parte: lá, trocar a senha ainda não desconecta os outros aparelhos.
