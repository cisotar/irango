# [257] `/painel/cardapios/[cardapioId]` + `FormVigencia`: modo **Repete sempre**

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [255] (`tasks/255-schemacardapio-e-server-actions-de-crud.md`) e [256] (`tasks/256-painel-cardapios-lista-com-estado-ao-vivo.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D3, D3-a · RN-01, RN-02 · design §9.1, §9.2, §9.6
**Fatia:** 10

## Objetivo

A rota de detalhe e a primeira metade do form: o escolhedor de modo e as **três dimensões
opcionais** do modo recorrente — dias da semana, dias do mês e faixa de horário — numa tela que
tem de caber em 360px.

## Escopo

- [ ] rota `/painel/(bloqueavel)/cardapios/[cardapioId]` — **rota própria, não modal**: um
      `Dialog` com sete controles e um preview em 360px nasce quebrado (`design-system.md` §1);
- [ ] `FormVigencia` consumindo o **mesmo `schemaCardapio`** da Server Action (issue 255),
      validação isomórfica, **sem schema paralelo**;
- [ ] escolha de modo em **`RadioGroup`**, cada item um `Card` de duas linhas, alvo ≥44px, com a
      copy do design §9.1: *"Repete sempre / Volta toda semana ou todo mês, até você desligar."*
      × *"Período com data de fim / Aparece uma vez, de uma data até outra, e some sozinho no
      fim."* + a linha *"Ao salvar, vale só o modo selecionado."*. Vocabulário de lojista, nunca
      "recorrente"/"prazo fixo";
- [ ] trocar de modo **não apaga o digitado** enquanto o form está aberto; só o modo selecionado
      é persistido (a disjunção de RN-01 é garantida por zod + CHECK, não por apagar campo);
- [ ] dias da semana como **toggles `<button aria-pressed>` dentro de `role="group"`**, em
      `grid-cols-4 sm:grid-cols-7`, cada célula `min-h-[44px] min-w-[44px]` **literal** — sete
      alvos de 44px não cabem nos 328px úteis de 360px;
- [ ] a nota *"Nenhum dia marcado = todos os dias."*;
- [ ] dias do mês **fechado por padrão** (`[ + Escolher dias do mês ]`), `grid-cols-7`, 44px de
      altura, com a nota do dia 31 aparecendo **só** quando 31 está marcado;
- [ ] faixa de horário atrás de um `Switch` ("Só em um horário do dia"), com o fuso da loja
      nomeado em texto;
- [ ] as mensagens de erro literais do design §9.6, com `aria-invalid` + `aria-describedby` no
      controle, bloco `role="alert"` e **foco no bloco ao falhar o submit**.

## Fora de escopo

O modo prazo fixo (issue 258) e a prévia (issue 259) — as três fatias são **três**, de propósito:
empacotar o form inteiro numa fatia só é como o escopo estoura. O `SeletorProdutosDoCardapio`
(issue 260). Semana **e** mês juntos **não** ganha aviso: é `OU` por regra fechada, e quem
explica é a prévia. Janela que cruza a meia-noite: recusada por CHECK, com erro explícito no form
(§Fora do Escopo). Mais de uma faixa de horário por cardápio.

## Reuso esperado

- `RadioGroup`, `Switch`, `Checkbox`, `Input`, `Button` de `components/ui/` — gerados pelo CLI.
  **`Select`, `Form` e `Tabs` não existem no repositório**: não inventar import, e o desenho já
  resolveu os três casos com `RadioGroup` e toggles.
- `src/lib/validacoes/cardapio.ts` (issue 255) — uma validação, dois consumidores.
- `ModoReordenar` de `ProdutosClient` (issue 175) — precedente de "modo" no painel.
- A régua de alvo de toque de `design-system.md` §5.

## Segurança

- O form **não decide nada**: zod é a primeira barreira, o CHECK do banco é o backstop e a
  Server Action é quem grava. Sem jsdom, aviso de formulário **não é trava** — a trava é o CHECK
  `cardapios_recorrente_tem_eixo`.
- Nenhum valor monetário. `23514` vira mensagem genérica na UI e detalhe no log (§14).

## Critério de aceite

- [ ] os três eixos são opcionais, e a tentativa de salvar com os três vazios é bloqueada pelo
      zod com a frase literal;
- [ ] em 360px, a grade de dias da semana não estoura e cada alvo tem 44px (`min-h-[44px]`
      literal, sem `min-h-11`);
- [ ] a nota do dia 31 aparece **só** quando 31 está marcado;
- [ ] trocar de modo e voltar preserva o que foi digitado;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
