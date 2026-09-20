# [258] `FormVigencia`: modo **Período com data de fim** (presets e customizado)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [257] (`tasks/257-form-de-vigencia-recorrente.md`) e [253] (`tasks/253-calcularfimdopreset.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D3, D3-b · RN-01, RN-04 · design §9.3, §9.6
**Fatia:** 11

## Objetivo

A segunda metade do form: os quatro presets de duração e o prazo customizado, com o **"Termina
em" como LEITURA** sempre que houver preset — porque o servidor recalcula o fim e descarta o que
o cliente mandar.

## Escopo

- [ ] chips de duração `[ 1 dia ] [ 7 dias ] [ 1 mês ] [ Escolher as datas ]`, 44px,
      `aria-pressed` — quatro chips para os quatro presets do banco (`diario`, `semanal`,
      `mensal`, `customizado`), **um para um**, nomeados em português, nunca com o literal do
      schema na tela;
- [ ] `Começa em` com `type="date"` + `type="time"`; o fuso da loja nomeado
      (`America/Sao_Paulo (GMT-3)`);
- [ ] **com preset, `Termina em` é texto de leitura, não campo** — a data exibida vem de
      `calcularFimDoPreset` (isomórfica), inclusive o clamp `31/01 + 1 mês = 28/02`;
- [ ] só `Escolher as datas` abre o campo de fim;
- [ ] início no passado é permitido, e a prévia diz `Está aparecendo desde 18/09`;
- [ ] as mensagens literais do design §9.6 para `fim <= início` e para prazo sem fim, com
      `aria-invalid` + `role="alert"` + foco no bloco;
- [ ] trocar de modo limpa a persistência do outro modo **no salvamento**, não na digitação
      (RN-01 é garantida por zod + CHECK).

## Fora de escopo

A aritmética do preset (issue 253, já entregue) e a gravação do `prazo_fim` (issue 255).
A prévia em português (issue 259). Qualquer tentativa de aceitar o `fim` do cliente em modo
preset: RN-04 é explícita, e o `prazo_preset` é **eco de UI**, não autoridade.

## Reuso esperado

- `src/lib/utils/calcularFimDoPreset.ts` (issue 253) — a **mesma** função do servidor; nunca uma
  segunda fórmula no componente.
- `src/lib/validacoes/cardapio.ts` (issue 255).
- `Button`, `Input` de `components/ui/`; os mesmos toggles `aria-pressed` da issue 257 — não
  criar um segundo padrão de chip.

## Segurança

- **A autoridade é a Server Action**: ela recalcula `prazo_fim` de `prazo_inicio + preset` e
  descarta o `fim` do payload. O que a tela mostra é preview.
- A conversão do horário local da loja para instante é do servidor (RN-04, borda de escrita).
- `23514` de `cardapios_prazo_ordem` vira mensagem genérica na UI, detalhe no log (§14).

## Critério de aceite

- [ ] com preset selecionado, **não existe campo editável de fim** no DOM do form;
- [ ] o fim exibido para `31/01 + 1 mês` é `28/02`, não `03/03`;
- [ ] `Escolher as datas` é o único caminho que abre o campo de fim;
- [ ] os quatro chips mapeiam exatamente os quatro valores de `prazo_preset`;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
