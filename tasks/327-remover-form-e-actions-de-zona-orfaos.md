# 327 — Código de zona órfão depois da tabela de faixas, e aviso de loja sem coordenadas

## Origem

Decisão D8 da issue 326 (tela de faixas de entrega), commits `fe35e33` e `fba513c`.

## Problema

A tela `/painel/configuracoes/entregas` passou a gravar só pela RPC `salvar_faixas_entrega`
(`TabelaFaixasEntrega.tsx`). Ficaram sem chamador na UI:

- `src/components/painel/FormZona.tsx`;
- `montarPayloadZona` e os helpers de CEP em `src/components/painel/payloadZona.ts`;
- as Server Actions de zona `criarZona`, `atualizarZona`, `alternarZonaAtiva`, `removerZona`,
  `salvarZona` em `src/lib/actions/entrega.ts` e os pares em
  `src/app/admin/assinantes/actions/admin-entrega.ts`.

As actions antigas ainda permitem gravar zona fora do formato da tabela (por exemplo, uma faixa
desligada no meio), o que a tela trata como legado.

## Antes de apagar

**Depende da issue 325.** O usuário decidiu que frete por CEP e por bairro volta para a tela
(faixas de km continua sendo a forma sugerida). `FormZona.tsx` e as actions de zona podem ser a
base dessa volta. Resolva a 325 antes, ou decida junto com ela o que é reaproveitado e o que sai.

`TabelaFaixasEntrega.tsx` importa `paraNumero` de `payloadZona.ts`. Se o arquivo sair, mova
`paraNumero` para `src/lib/utils/` antes.

## Também

O painel não avisa quando a loja não tem coordenadas. Sem elas o frete por faixa não calcula a
distância e a vitrine degrada; hoje só a vitrine sabe disso (`src/lib/utils/freteDegradado.ts:33`).
Mostrar esse aviso na tela de entregas.
