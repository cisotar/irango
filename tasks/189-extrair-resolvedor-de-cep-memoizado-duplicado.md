# 189 — extrair o resolvedor de CEP memoizado duplicado entre frete.ts e pedido.ts

crítica: NÃO (duplicação de código, não bug — mas risco de drift silencioso em código de valor)

## Origem

Achado do `revisar` durante a revisão da issue #185 (fix de geocoding de CEP), 2026-09-09.

## Problema

O closure de memoização do resolvedor de CEP está duplicado byte a byte em
`src/lib/actions/frete.ts:126-128` e `src/lib/actions/pedido.ts:270-274`:

```ts
let promessaCep;
const resolverCep = () => cep ? (promessaCep ??= resolverCepServidor(cep)) : Promise.resolve(null);
```

O plano técnico da #185 justificou isso como "paridade RN-7" (preview e autoritativo precisam se
comportar igual), mas o padrão real do projeto para esse tipo de paridade é o oposto: extrair uma
função compartilhada e os dois lados **chamarem a mesma função** — é assim que `distanciaDaLojaAoCep` e
`calcularFrete` já garantem paridade preview↔autoritativo hoje. RN-7 pede equivalência de
comportamento, não duplicação textual.

Risco concreto: se alguém editar a guarda (`cep ? ... : Promise.resolve(null)`) em um arquivo e
esquecer o outro, os dois pontos divergem silenciosamente — não há teste que force a comparação textual
dos dois trechos, só testes que verificam cada lado isoladamente.

## O que fazer

Extrair para um helper exportado em `src/lib/utils/resolverCepServidor.ts` (ou módulo correlato):

```ts
export function criarResolvedorCepMemoizado(
  cep: string | null | undefined,
): () => Promise<EnderecoCepResolvido | null> {
  let promessa: Promise<EnderecoCepResolvido | null> | undefined;
  return () => cep ? (promessa ??= resolverCepServidor(cep)) : Promise.resolve(null);
}
```

E trocar as duas ocorrências em `frete.ts`/`pedido.ts` por uma chamada a esse helper.

## Achado secundário (ESTILO, mesmo agente)

`src/lib/utils/geocodificarEndereco.ts:196-199` — a docstring de `geocodificarCepResolvido` lista a
"ordem OBRIGATÓRIA dos portões" mas omite o portão de validação de formato do CEP (`/^\d{8}$/` após
`limparCep`), que roda entre "credenciais" e "GET cache". Corrigir o comentário para incluir esse
portão, mantendo-o como fonte de verdade da ordem real.

## Arquivos prováveis

- `src/lib/utils/resolverCepServidor.ts` (novo helper)
- `src/lib/actions/frete.ts`, `src/lib/actions/pedido.ts` (trocar closure duplicado pela chamada)
- `src/lib/utils/geocodificarEndereco.ts` (docstring)
