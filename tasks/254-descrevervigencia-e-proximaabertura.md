# [254] `descreverVigencia` + `rotuloVoltaQuando` + `proximaAbertura` (e a escolha determinística)

**crítica:** NÃO
**Mundo:** infra
**Depende de:** [246] (`tasks/246-vigenciacardapio-cardapioaberto-e-avaliarvigenciadoproduto.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D4, D14, D16 · RN-07, RN-13, RN-15 · design §9.5, mecanismo M6
**Fatia:** 8

## Objetivo

Um módulo puro, **uma redação**, para tudo que o sistema diz sobre *quando o cardápio aparece*:
a prévia do form no painel, o selo "quando volta" da vitrine e o rótulo de janela do cabeçalho
da seção de destaque. Painel e vitrine descrevendo a mesma vigência com palavras diferentes é o
erro que M6 existe para impedir.

## Escopo

- [ ] `src/lib/utils/descreverVigencia.ts` — puro, `environment: node`, exportando
      `descreverVigencia(c: CardapioVigencia, timezone: string): string` (a frase do painel) e
      `rotuloVoltaQuando(c: CardapioVigencia, timezone: string): string` (o selo da vitrine,
      **no máximo 32 caracteres**, corte aplicado **na função pura**, nunca no CSS);
- [ ] o tipo do parâmetro é **`CardapioVigencia`** — em conflito de nome entre spec e design,
      **vale o spec** (o design chama de `Vigencia`);
- [ ] `proximaAbertura(c, agora, timezone): Date | null` — prazo fixo: `agora < inicio ⇒ inicio`,
      `agora >= fim ⇒ null`; recorrente: varredura adiante **limitada a 400 dias** (cobre
      `dias_mes = [31]` com folga), devolvendo o primeiro dia que casa `diaOk` no `hora_inicio`;
      nada em 400 dias ⇒ `null`;
- [ ] escolha entre N cardápios fechados: o rótulo é o do que **abre mais cedo**, por
      `proximaAbertura` crescente, `null` **por último**, empate por `nome` (`localeCompare` pt-BR)
      e depois `id` — a mesma escada determinística usada na ordem das seções (RN-15);
- [ ] `proximaAbertura` é memoizada **uma vez por cardápio por request**, dentro de
      `projetarCatalogoVitrine`, **nunca por produto**;
- [ ] a tabela de redações do design §9.5, literal, com a conjunção **"e também"** obrigatória
      quando os dois eixos de dia coexistem (é a leitura `OU` de RN-02 dita em português), e a
      nota do dia 31 (*"nos meses de 30 dias, não aparece"*);
- [ ] o rótulo do cabeçalho da seção de destaque (`Até domingo` / `Hoje, até as 15:00` / `Hoje`,
      **≤20 caracteres**) sai deste mesmo módulo;
- [ ] teste ao lado do módulo para cada linha das duas tabelas de redação.

## Fora de escopo

`PreviewVigencia` (issue 259) e o selo nos componentes (issue 262) — aqui só existe o texto.
Regras de calendário além de dia-da-semana e dia-do-mês ("último dia do mês", "toda primeira
segunda", dias úteis, feriados): §Fora do Escopo, e o design já as retirou da tabela.
`Aparece sempre — este cardápio não tem janela`: estado impossível pelo CHECK
`cardapios_recorrente_tem_eixo`, então **não** existe redação para ele.

## Reuso esperado

- `src/lib/utils/fusoLoja.ts` (issue 222) — `partesNoFuso`/`paraMinutos`; sem segunda aritmética.
- `src/lib/utils/vigenciaCardapio.ts` (issue 246) — `cardapioAberto`, para não reimplementar a
  regra ao varrer os 400 dias.
- `reabreEm` de `lojaAberta` — **referência de ideia** (varredura adiante na semana), não código
  a copiar: aqui é a generalização com mais eixos.
- `alcance-do-grupo.ts` — precedente de **copy pura com teste**, a forma que este módulo segue.

## Segurança

- O ordenamento por `proximaAbertura` decide **qual frase verdadeira** aparece, nunca **se** o
  produto é comprável — por isso a fatia não é crítica.
- O texto é produzido **no servidor** e viaja pronto; componente client só renderiza.
- Nenhuma coluna crua de vigência trafega ao cliente na vitrine (regra 6 do contrato do Spec A).

## Critério de aceite

- [ ] **uma** implementação de "quando volta": `grep` prova que `proximaAbertura` tem um único
      produtor e que RN-13 e RN-07 consomem o mesmo número;
- [ ] `rotuloVoltaQuando` nunca devolve mais de 32 caracteres, provado nas linhas mais longas;
- [ ] `descreverVigencia` com semana **e** mês contém a conjunção **"e também"**;
- [ ] prazo fixo expirado ⇒ `proximaAbertura === null`;
- [ ] recorrente `dias_mes = [31]` a partir de 01/02 ⇒ a data devolvida existe (nunca 31/02);
- [ ] o módulo é importado pelos **três** consumidores (painel, projeção da vitrine, cabeçalho
      do destaque) — uma redação (M6);
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
