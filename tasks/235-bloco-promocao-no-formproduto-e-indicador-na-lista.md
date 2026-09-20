# [235] Bloco "Promoção" no `FormProduto` + a superfície do erro de D10 + indicador na lista

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [230] (`tasks/230-schemaproduto-estendido-e-server-action-do-desconto.md`) e [223] (`tasks/223-preco-efetivo-e-vigencia.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D1, D10 · RN-04, RN-05, RN-06, RN-07 · design §8

## Objetivo

Dar ao lojista a tela para ligar, configurar e desligar a promoção de um produto, com prévia
"de/por" enquanto ele digita, a mensagem de D10 num lugar re-legível (não num toast) e o
indicador de promoção vigente na lista de produtos.

## Escopo

- [ ] bloco "Promoção" em `src/components/painel/FormProduto.tsx`, **depois de "Preço" e antes de
      "Categoria"** (o erro de D10 fala dos dois ao mesmo tempo): `Switch` "Produto em promoção",
      `RadioGroup` percentual × valor em reais, `Input` de valor (`inputMode="decimal"`),
      `Checkbox` "Definir um prazo (opcional)" com `type="date"` + `type="time"` separados e a
      linha de fuso da loja adjacente e obrigatória;
- [ ] 🔴 **desligar NÃO esconde os campos** (RN-07): eles ficam visíveis, `disabled`, `opacity-60`,
      com *"Promoção desligada. Os valores ficam salvos para quando você ligar de novo."*;
- [ ] prévia `Na vitrine: de R$ 100,00 por R$ 90,00` em `aria-live="polite"`, calculada por
      `precoEfetivo()` — **a mesma função pura do servidor**, isomórfica como `calcularFrete`;
- [ ] superfície do erro de D10 (design §8.3): estado `erros: Record<string, string>` alimentado
      por `parsed.error.issues`; bloco `role="alert"` `tabIndex={-1}` **entre o campo Preço e o
      bloco Promoção**, com foco no submit falho; `aria-invalid` + `aria-describedby` nos **dois**
      inputs (é erro de par, não de campo). O toast genérico fica **só** para falha de rede/servidor;
- [ ] as duas saídas da mensagem viram botões que **preenchem/desligam, mas não salvam** — o
      lojista ainda clica em "Salvar alterações" (D10: o sistema não ajusta dinheiro sozinho);
- [ ] indicador na lista (`ProdutosClient`): chip com o **mesmo `Badge` do painel**
      (`variant="secondary"` + `text-promo-texto`), rótulo `-20% até 30/09` quando há prazo e
      `-20%` quando não há;
- [ ] 🔴 `promocaoVigente` e o rótulo são **projetados no Server Component da página**
      `/painel/produtos`, nunca derivados no `ProdutosClient` — derivar no browser duplicaria RN-03
      e usaria o relógio do dispositivo.

## Fora de escopo

O `schemaProduto` e a Server Action (issue 230) — aqui só se **consome** o schema; nenhuma
validação paralela no componente. Migrar o `FormProduto` para react-hook-form (refactor fora do
escopo, divergência registrada no design §Gate). Nenhum campo novo de banco para
`promocaoVigente`. Nenhuma mensagem de D10 escrita no `.tsx`: ela vem de
`mensagemDescontoMaiorQuePreco`.

## Reuso esperado

- `src/components/ui/{switch,radio-group,checkbox,input,label}.tsx` — shadcn, gerado pelo CLI,
  não editar à mão. **Nada de `Select`**: ele nem existe em `components/ui/`.
- `schemaProduto` + `mensagemDescontoMaiorQuePreco` (issue 230) — form e action com o mesmo texto.
- `precoEfetivo()` (issue 223) — a prévia nunca é uma segunda fórmula.
- `ProdutosClient.tsx` `badgeStatus(p)` — o padrão de badge do painel já existente.
- `formatarMoeda` — único formatador.

## Segurança

- A UI **não é a proteção**: quem recusa a gravação é o `superRefine` + a Server Action + o CHECK
  (issues 230 e 219). Esta issue só torna o erro legível.
- Nenhum cálculo monetário próprio: a prévia usa a função do servidor, e "vigente agora" é
  projetado no Server Component.

## Critério de aceite

- [ ] ligar percentual, ligar valor fixo, definir prazo e desligar preservando a configuração
      funcionam de ponta a ponta contra o banco;
- [ ] com preço R$ 8,00 e desconto fixo R$ 10,00 o salvar é recusado e a **mensagem de D10 aparece
      no bloco fixo**, re-legível, com os dois inputs em `aria-invalid` — nunca só num toast;
- [ ] `grep -rn "Não dá para salvar" src/components/painel/FormProduto.tsx` **não devolve nada**
      (o texto mora no módulo puro);
- [ ] `grep -rn "precoEfetivo\|desconto_" src/app/\(painel\)/painel/\(bloqueavel\)/produtos/ProdutosClient.tsx`
      não mostra derivação de vigência no cliente;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
