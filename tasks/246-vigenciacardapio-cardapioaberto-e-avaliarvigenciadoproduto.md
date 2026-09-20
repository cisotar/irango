# [246] `vigenciaCardapio.ts` — `cardapioAberto` + `avaliarVigenciaDoProduto` (e o `diaDoMes` em `fusoLoja`)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [222] (`tasks/222-extrair-fusoloja-de-lojaaberta.md`) e [244] (`tasks/244-migration-coluna-produtos-visibilidade.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D2, D3, D3-a, D3-b, D14 · RN-02, RN-03, RN-04, RN-05, RN-13
**Fatia crítica:** 2 (`cardapioAberto` + `avaliarVigenciaDoProduto`)

## Objetivo

Criar **o único lugar do projeto onde vigência de cardápio vira decisão**: se o produto é
comprável agora e — com D14 — se ele sequer existe para o cliente. Função pura, `agora` e
`timezone` injetados, consumida pelo SSR da vitrine, pela revisão do carrinho e pelo recálculo
autoritativo do pedido. Uma implementação, três consumidores.

## Escopo

- [ ] `src/lib/utils/fusoLoja.ts` (da issue 222) ganha **`diaDoMes`** no retorno de `partesNoFuso`
      — acréscimo de `day` ao `Intl.DateTimeFormat` que já existe, **aditivo**: `lojaAberta`
      continua lendo só `diaIndex` e `minutos`, e a suíte atual dele passa **sem edição**;
- [ ] `src/lib/utils/vigenciaCardapio.ts` com o tipo `CardapioVigencia` e
      `cardapioAberto(c: CardapioVigencia, agora: Date, timezone: string): boolean`;
- [ ] RN-02 (recorrente), literal:
      `diaOk = (dias_semana vazio E dias_mes vazio) ? true : contém(diaIndex) OU contém(diaDoMes)`
      — **OU, regra fechada** — e `horaOk = hora_inicio === null ? true : minutos >= inicio E
      minutos < fim`; `aberto = diaOk E horaOk`;
- [ ] RN-04 (prazo fixo): `prazo_inicio <= agora < prazo_fim`, comparação de **instante com
      instante**, sem nenhuma aritmética de fuso;
- [ ] **início inclusivo, fim exclusivo** nos dois modos — a mesma convenção de `lojaAberta`,
      de `validarUsoCupom` e do prazo de desconto do Spec A. Não divergir;
- [ ] RN-03: `ativo = false` **não participa de nada** — não abre, não fecha, não restringe;
- [ ] `avaliarVigenciaDoProduto(produto, cardapios, agora, timezone)` devolvendo o par que
      RN-05 e RN-13 exigem: `dentroDaJanela = visibilidade === 'menu' ||
      cardapiosAtivosDoProduto.some(cardapioAberto)` e `visivelNaVitrine = visibilidade === 'menu'
      || dentroDaJanela || proximaAberturaProduto !== null`;
- [ ] teste ao lado do módulo (`vigenciaCardapio.test.ts`) com os cenários **literais** 1, 2, 3, 4
      e 6 do spec, com data e hora reais no fuso `America/Sao_Paulo`.

## Fora de escopo

`proximaAbertura` e `descreverVigencia` (issue 254) — esta issue consome a assinatura de
`proximaAbertura` para compor `visivelNaVitrine`, mas quem a implementa, com a varredura de 400
dias e a escolha determinística da frase, é a fatia 8. Se a ordem de execução exigir, entregue
aqui apenas o predicado "existe próxima abertura" pela via mínima e deixe o texto para a 254 —
**nunca duas implementações de "quando volta"** (RN-07). A projeção do catálogo (issue 247).
Qualquer leitura de banco: esta issue é pura e não importa client nenhum.

## Reuso esperado

- `src/lib/utils/fusoLoja.ts` (issue 222) — `partesNoFuso` e `paraMinutos`. **Nenhuma segunda
  cópia de aritmética de fuso** (mandato 2). `paraMinutos` já ignora o terceiro campo, então
  aceita tanto `"11:00"` quanto o `"11:00:00"` que o Postgres serializa de uma coluna `time`.
- `src/lib/utils/lojaAberta.ts` — **referência de convenção** (`minutos >= abre && minutos < fecha`,
  linha 78), não código a copiar.
- `Intl` para fuso, como já é hoje; nenhuma lib de data nova.

## Segurança

- Não há valor monetário aqui. O que se decide é **se o item pode ser comprado** — invariante de
  integridade do pedido —, e é decidido no servidor, a partir do banco e do relógio do servidor
  no fuso da loja.
- **A regra "inativo não participa" mora aqui, não na RLS**: o caminho autoritativo do pedido roda
  sob `service_role` (`BYPASSRLS`), e uma regra que só existisse na policy não existiria ali.
- O browser **nunca** decide se um cardápio está aberto. `agora` e `timezone` são parâmetros,
  nunca `new Date()` lá dentro.

## Critério de aceite

- [ ] teste **vermelho** com `FAIL` capturado antes de qualquer código de produção (fatia 2);
- [ ] **quarta-feira, dia 15**, com `dias_semana = {sáb,dom}` + `dias_mes = {1,15}` ⇒ **ABERTO**
      (o caso que separa `OU` de `E`);
- [ ] eixo vazio ⇒ **sem restrição por esse eixo**, nunca "nenhum dia";
- [ ] sáb 11:00 comprável e sáb 15:00 não (início inclusivo, fim exclusivo); idem
      `prazo_fim` exclusivo em 17/10 00:00;
- [ ] cardápio inativo ignorado;
- [ ] `visibilidade = 'menu'` ⇒ `dentroDaJanela === true` **sem nem ler a lista de cardápios**;
- [ ] união do cenário 4: fechado + aberto ⇒ comprável;
- [ ] os quatro desfechos de RN-13, incluindo `'cardapio'` + único cardápio desligado ⇒ **some**;
- [ ] `grep` prova que não há segunda cópia de `partesNoFuso`/`paraMinutos` no repo;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
