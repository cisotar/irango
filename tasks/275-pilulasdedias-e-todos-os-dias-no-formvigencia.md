# [275] Extrair `PilulasDeDias` do `FormVigencia` e dar a ele o atalho "Todos os dias"

**crítica:** NÃO — UI sem decisão de valor nem de permissão; a autoridade já está travada em [273]/[274]
**Mundo:** painel
**Depende de:** [273] (RN-07 "Todos os dias" na prévia é função pura e vem de lá)
**Spec:** specs/vigencia-por-item-do-cardapio.md — §Detalhe do cardápio, RN-07

## Origem

Spec §Componentes: o bloco de 7 pílulas já existe inline em `FormVigencia.tsx:286` e vai ter **duas
superfícies** (vigência do cardápio e agenda do vínculo). Duas superfícies, uma implementação.

## Objetivo

Extrair o seletor de dias para um componente controlado reusável e acrescentar ao `FormVigencia` o
botão "Todos os dias", que marca os 7 de uma vez — sem `modo` novo no banco.

## Escopo

- [ ] `src/components/painel/PilulasDeDias.tsx` — componente **controlado**, sem estado próprio,
      consumindo `DIAS_DA_SEMANA` de `rascunhoCardapio.ts:81`
- [ ] Alvo de toque `min-h-[44px] min-w-[44px]` **literal** (base de fonte 120%: `min-h-11` não bate 44px)
      e rótulo acessível por pílula (`design-system.md` §5)
- [ ] Em 360px a linha **comprime, não estoura**
- [ ] `FormVigencia.tsx` passa a usar `PilulasDeDias` no lugar do bloco inline (zero mudança de comportamento)
- [ ] Botão "Todos os dias" no `FormVigencia` marcando os 7 dias; o CHECK `cardapios_recorrente_tem_eixo`
      segue satisfeito porque 7 dias marcados **é** eixo preenchido
- [ ] A prévia com os 7 marcados lê "Aparece todos os dias" (rótulo vindo de [273], não redigido aqui)

## Fora de escopo

- Pílulas na linha do produto vinculado — [276]
- Qualquer escrita nova no banco; o `FormVigencia` continua salvando o cardápio como hoje
- Reescrever `DIAS_DA_SEMANA` ou editar `components/ui/` à mão (gerado pelo shadcn CLI)

## Reuso esperado

- `DIAS_DA_SEMANA` (`src/components/painel/rascunhoCardapio.ts:81`)
- `Button`, `Toggle`/`Checkbox` de `components/ui/`
- `descreverVigencia` para a prévia — **uma** função pura nos dois lados
- Layout e estados visuais definidos pelo agente `desenhar` (roda uma vez para as quatro superfícies de D)

## Segurança

- Nenhum dado sensível, nenhum valor monetário, nenhuma tabela tocada
- O que é gravado continua validado por zod + CHECK no servidor

## Critério de aceite

- [ ] `PilulasDeDias` existe e é o único lugar que desenha as 7 pílulas:
      `grep -rn "DIAS_DA_SEMANA" src/components/` só aparece em `rascunhoCardapio.ts` e `PilulasDeDias.tsx`
- [ ] Teste unitário de `FormVigencia`/rascunho cobrindo "Todos os dias" ⇒ `dias_semana` com os 7 valores
- [ ] `npx vitest run src/components/painel/` verde · `npx tsc --noEmit` = 0 · `npm run lint` = 0
