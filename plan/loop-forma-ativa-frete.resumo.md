# Trocar a forma de frete sem perder o que já foi configurado
2026-10-18 16:16 · plano detalhado: plan/loop-forma-ativa-frete.md

**O que você pediu:** quando o lojista troca a forma de frete (km, CEP ou bairro), a configuração da forma anterior continua guardada. Ao voltar para ela, está tudo lá. Só muda a forma usada para cobrar o cliente.

**O que vai ser feito:** cada loja passa a ter uma "forma em uso" anotada (loja nova começa em faixas de km). As três configurações ficam guardadas lado a lado. O cliente só é cobrado pela forma em uso: a vitrine, o valor do pedido e o aviso de "entrega disponível" seguem a mesma regra. Sai da tela a pergunta "isso apaga as zonas da forma anterior". Tudo entra no mesmo pedido de revisão que já está aberto, ainda não publicado.

**Cuidados:**
- Um bairro guardado mais barato não pode baratear um pedido de uma loja que cobra por km. Há testes que provam isso, tanto no valor final do pedido quanto na prévia da vitrine.
- Lojas que já existem continuam cobrando o mesmo valor: a forma em uso de cada uma sai do que ela cobra hoje. Antes de publicar, você roda uma consulta só de leitura que mostra se alguma loja real mistura formas. Se o "Pão do Ciso" ou outra loja real misturar, eu paro e te pergunto antes.
- Dois lojistas editando ao mesmo tempo continuam sem sobrescrever um ao outro. A troca de forma passa pela mesma proteção.

**Tempo estimado:** 2h30 a 3h30 · **Versão mais rápida:** sem a revisão de qualidade do código e com a documentação feita sem ajuda extra: 2h15 a 3h15. Os testes e a checagem de segurança ficam.

**Precisa de você:**
1. Responder uma pergunta. Sua loja cobra por km, R$ 6 até 5 km. Você clica em "Bairros" para começar a cadastrar. Nesse minuto, um cliente a 3 km faz um pedido. Quanto ele paga? (A) R$ 6, porque a troca só vale quando você salva os bairros (recomendado). (B) A taxa de fora da área, porque a troca vale no clique. (C) R$ 6 mesmo depois de salvar, até você clicar em "Usar bairros".
2. Rodar a consulta de leitura no painel do Supabase e colar o resultado.
3. Autorizar a mudança no banco de produção. Ela não tem volta e precisa acontecer logo antes da publicação.
4. Autorizar o envio do código e testar na tela da loja "Lanches base": km, depois bairro, depois km de novo, e conferir que as faixas continuam lá.
5. Depois da publicação, rodar mais uma consulta de leitura para conferir que nenhuma loja ficou sem frete.
