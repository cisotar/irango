# [130] Util puro `variantesHabilitadas(loja)` + tipo `VarianteImpressao`

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [127]
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Fonte ÚNICA do mapa módulo→variantes (RN-M2). Função pura, sem I/O, que recebe a loja
(flags de módulo) e devolve a lista de variantes de impressão liberadas. Reusada por
painel (136) **e** admin (137) — um único caminho de entitlement.

## Escopo
- [ ] Novo `src/lib/utils/variantesHabilitadas.ts`:
  - Tipo `export type VarianteImpressao = "a4" | "cozinha" | "recibo";`
  - `export function variantesHabilitadas(loja: Pick<LojaCompleta, "modulo_impressao_a4" |
    "modulo_impressao_termica"> | null): VarianteImpressao[]`.
  - Mapa (RN-M2): Módulo A (`modulo_impressao_a4 === true`) → `["a4"]`; Módulo B
    (`modulo_impressao_termica === true`) → `["cozinha", "recibo"]`. Ordem estável.
  - **Fail-closed:** `loja === null`, flag `undefined`/não-`true` → variante não entra
    (só o booleano literal `true` habilita; espelha a postura de `decidirAcessoPainel`).
- [ ] Teste unitário `variantesHabilitadas.test.ts` (sem I/O).

## Fora de escopo
- Leitura da loja / I/O (fica nas pages 136/137).
- Rótulos de UI das variantes (ficam no seletor 132 e nos componentes 133/134).
- CTA de upgrade / venda de módulo (fora de escopo v1 do spec).

## Reuso esperado
- `LojaCompleta` (`src/lib/supabase/queries/lojas.ts`) para o tipo do parâmetro.
- Padrão de util puro fail-closed de `acessoPainel.ts` — mesma disciplina.

## Segurança
- **RN-M1/RN-M2 (server-autoritativo, fail-closed):** esta é a fonte única que decide o
  que a loja pode imprimir. Qualquer dúvida sobre a flag → não habilita. Um bug que
  liberasse uma variante não contratada = burla de entitlement. Motivo da criticidade.
- Função pura: não confia em nada do cliente; recebe a loja já lida sob RLS/loader.

## Critério de aceite
- [ ] (RED-first) `variantesHabilitadas` com só A4 → `["a4"]`; só térmica →
  `["cozinha","recibo"]`; ambos → `["a4","cozinha","recibo"]`; nenhum → `[]`.
- [ ] (RED-first) `loja === null` → `[]`; flag `undefined`/`null`/valor não-booleano → não habilita.
- [ ] Vermelho escrito e confirmado ANTES do código; depois verde.
- [ ] Nenhum import de client Supabase (util puro, testável sem mock de I/O).
