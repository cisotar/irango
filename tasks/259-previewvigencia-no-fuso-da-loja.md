# [259] `PreviewVigencia` — a frase no fuso da loja, que é a interface do form

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [258] (`tasks/258-form-de-vigencia-prazo-fixo.md`) e [254] (`tasks/254-descrevervigencia-e-proximaabertura.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D3, D3-a, D3-b · RN-02, RN-07 · design §9.4, mecanismo M6
**Fatia:** 12

## Objetivo

O lojista não lê configuração, lê **frase**. Esta issue entrega a apresentação pura que traduz os
sete controles do form em uma sentença em português, no fuso da loja — consumindo **a mesma**
função pura que monta o selo da vitrine.

## Escopo

- [ ] `PreviewVigencia` — componente de **apresentação pura**, consome `descreverVigencia`
      (issue 254) e **não tem uma linha de aritmética de data**;
- [ ] a frase em 16px, peso alto; abaixo, em 12px `--texto-muted`, o fuso da loja **nomeado**
      (`Fuso da loja: America/Sao_Paulo`);
- [ ] `aria-live="polite"` com debounce de ~400ms — a frase muda a cada toque nos toggles;
- [ ] a linha `Agora (sáb, 19/09, 13:04): APARECENDO` **só para a configuração SALVA**, derivada
      do servidor — nunca para o rascunho em edição;
- [ ] a conjunção **"e também"** quando os dois eixos de dia coexistem, vinda pronta do módulo
      (é a leitura `OU` de RN-02 dita em português);
- [ ] nada de mini-calendário e nada de lista de próximas ocorrências: a frase **é** a prévia.

## Fora de escopo

Escrever qualquer redação no componente — toda frase vem de `descreverVigencia` (M6). Avaliar
janela no cliente: `agora` e `timezone` são **injetados**, como em `calcularFrete`. O selo da
vitrine (issue 262). O rótulo do cabeçalho da seção de destaque (issue 263).

## Reuso esperado

- `src/lib/utils/descreverVigencia.ts` (issue 254) — **uma frase, uma implementação**, três
  consumidores. É esta issue que fecha o terceiro lado de M6.
- `src/lib/utils/fusoLoja.ts` — indiretamente, pelo módulo de redação; **nunca** importado para
  fazer conta no componente.
- O padrão isomórfico de `calcularFrete` (mesma função no preview e no servidor).

## Segurança

- **Preview de UX, e nada depende dele.** A autoridade da janela é a função pura no servidor
  (RN-06); o browser nunca decide se um cardápio está aberto.
- A linha "Agora:" é do servidor de propósito: derivá-la do relógio do browser diria ao lojista
  algo que o cliente não vê.

## Critério de aceite

- [ ] o componente não importa `Intl` nem `Date` para calcular nada — só renderiza string;
- [ ] a frase da configuração salva é **byte a byte** a mesma que o teste de
      `descreverVigencia` afirma;
- [ ] `aria-live="polite"` presente e com debounce;
- [ ] a linha "Agora:" não aparece para rascunho não salvo;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
