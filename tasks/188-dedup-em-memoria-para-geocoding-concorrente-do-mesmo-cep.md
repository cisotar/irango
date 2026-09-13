# 188 — sem request-coalescing para resoluções concorrentes do mesmo CEP

crítica: NÃO (mitigado pela trava global do Upstash; pior caso é "1 ganha, outro vira indisponível",
não estouro do Nominatim)

## Origem

Achado do `testar` durante a revisão de cobertura da issue #185 (fix de geocoding de CEP), 2026-09-09.
Não é falha de teste — é gap real de produção identificado ao escrever o teste de concorrência
(`src/lib/utils/geocodificarCepResolvido.test.ts`, bloco `describe("[185-8] concorrência...")`).

## Problema

`geocodificarCepResolvido` (`src/lib/utils/geocodificarEndereco.ts`) não tem request-coalescing/
single-flight em memória. Duas resoluções simultâneas do MESMO CEP, ambas em cache miss (ex.: dois
clientes diferentes checando o mesmo CEP quase ao mesmo tempo, ou dois tabs do mesmo cliente), disputam
a trava global do Upstash de forma independente — se as duas caírem em janelas adjacentes de 1s (ou a
trava falhar momentaneamente), podem sair 2 requisições ao Nominatim para o mesmo CEP na mesma janela
concorrente, violando o teto de "1 chamada ao Nominatim por resolução" que a issue #185 declarou como
invariante.

Em produção o caso mais provável é menos grave: a trava real do Upstash é atômica **entre processos**
(diferente do teste, que roda tudo no mesmo processo Node), então o pior caso comum é "1 requisição
ganha a trava, a outra recebe `transitorio` e o cliente vê frete indisponível temporariamente" — não um
estouro real do Nominatim que arrisque banimento. Mas a ausência de dedup em memória é real e pode, em
condições de borda (múltiplas instâncias serverless da Vercel resolvendo o mesmo CEP no mesmo
milissegundo), gerar mais de 1 chamada efetiva.

## O que fazer

Avaliar se vale um dedup em memória por processo (ex.: `Map<cep, Promise<ResultadoGeocoding>>`
compartilhado dentro de `geocodificarEndereco.ts`, expirando a entrada ao resolver) — reduziria o caso
comum sem eliminar o caso cross-instância (que só um lock distribuído resolveria, custo desproporcional
ao problema). Decidir se o ganho justifica a complexidade, dado que o pior caso real já é
"indisponível temporário", não "banimento do Nominatim" (a trava global do Upstash continua sendo a
defesa que realmente importa).

## Por que não é urgente agora (custo financeiro irrisório)

Nota contextualizada em 2026-09-13: a issue #190 migrou o geocoding de Nominatim (gratuito) para
Google Geocoding API (pay-as-you-go, ~$0.005/requisição). Isso muda a história de "não vale o
esforço" para "potencialmente vale, mas não hoje":

**Para os próximos 3 meses (fase de crescimento a 10 clientes):**
- Volume esperado: 10 clientes × 50 pedidos/dia = 500 pedidos/dia
- Taxa de reuso de CEP (colisão): 1-2% dos pedidos (conservador; a maioria tem endereço único)
- Colisões/dia: ~5-10
- Requisições extras/dia (sem coalescing): ~5-10
- Custo extra/dia: 5-10 × $0.005 = **$0.025 a $0.05/dia**
- **Custo extra/mês: ~$0.75 a $1.50**
- **Custo extra/trimestre: ~$2.25 a $4.50**

Mesmo em cenário pessimista (10× mais colisões): $45/trimestre é insignificante vs. volume de 45k
pedidos esperado. **A implementação (complexidade de Map + lógica de expiração) não vale o retorno
financeiro nesta fase.** Revisitar quando volume chegar a 50-100 clientes ou custo de Google virar
linha visível na planilha.

## Arquivos prováveis

- `src/lib/utils/geocodificarEndereco.ts` (`geocodificarCepResolvido`)
- `src/lib/utils/geocodificarCepResolvido.test.ts` (já tem o teste que documenta o gap)
