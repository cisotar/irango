# 187 — endurecer schema do CEP no preview de frete + guard de bounding box na leitura do cache

crítica: NÃO (sem caminho de exploração concreto — amplificação limitada, sem influência sobre preço)

## Origem

Dois achados BAIXA do `auditar` durante a revisão da issue #185 (fix de geocoding de CEP),
2026-09-09. Nenhum bloqueou o deploy — registrados aqui por justificativa explícita do fan-out.

## Achado 1 — `cep` do preview aceita string arbitrária sem teto de tamanho [x] RESOLVIDO 2026-09-13

Corrigido: `src/lib/actions/frete.ts:59` já usa
`cep: z.string().trim().regex(/^\d{5}-?\d{3}$/).optional()`, exatamente a
correção sugerida abaixo. Teste que verifica o critério de aceite:
`src/lib/actions/frete.test.ts:660-668` ("ATAQUE: CEP malformado é rejeitado
sem tocar no banco"). Achado 2 (bounding box no cache) segue aberto.

**Arquivo:** `src/lib/actions/frete.ts` (`schemaFretePreview`) — `cep: z.string().trim().optional()`, sem
regex de formato e sem `.max()`. Um cliente pode mandar um `cep` com ~1MB de dígitos (limite default de
body de Server Action do Next); `resolverCepServidor` faz `replace(/\D/g,"")` e monta
`https://viacep.com.br/ws/<1MB>/json/`. O rate limit de ~20/min por IP em `frete.ts` roda antes e limita
o dano, e o geocoder rejeita qualquer coisa ≠ 8 dígitos antes de I/O — mas o iRango serve de amplificador
de saída contra o ViaCEP nesse meio tempo. Pré-existente ao #185 (mesmo comportamento do
`reconciliarBairroCep` removido), mas a superfície cresceu porque agora o CEP sozinho também aciona o
ViaCEP (antes só bairro+cep juntos disparavam).

**Correção sugerida:** alinhar com o schema autoritativo (`schemaEnderecoEntrega`, que já valida
formato):
```ts
cep: z.string().trim().regex(/^\d{5}-?\d{3}$/).optional(),
```

**Verificar após:** `calcularFreteAction({loja_id, cep: "1".repeat(1000)})` retorna
`{ok:false, erro:"Dados de frete inválidos."}` sem nenhum fetch (spy em `global.fetch` com 0 chamadas).

## Achado 2 — guard `dentroDoBrasil` não é reaplicado na leitura do cache [x] RESOLVIDO 2026-09-13

Corrigido em `src/lib/utils/geocodificarEndereco.ts` (`lerCacheCoordenadas`): o
guard `dentroDoBrasil` roda na leitura, logo após a checagem de
`Number.isFinite`. Testes em `src/lib/utils/geocodificarCepResolvido.test.ts`
("[187] valor de cache na versão corrente mas FORA do Brasil → MISS"): par em
Praga (50.1, 14.4) com `v:3` é descartado e a resolução é refeita; par válido no
Brasil segue HIT. Os dois achados desta issue estão fechados.

**Arquivo:** `src/lib/utils/geocodificarEndereco.ts` (`lerCacheCoordenadas`) — valida
`Number.isFinite` e `v === 2`, mas não a bounding box do Brasil. Hoje não é explorável pelo cliente (só
o caminho pós-guard grava `v:2`), mas fica assimétrico: qualquer valor `v:2` fora do Brasil que chegue
ao Redis por outro caminho (escrita manual, backfill futuro, reuso da constante
`VERSAO_CACHE_GEOCODE` por outro módulo) é aceito como distância válida e vira frete errado por raio.

**Correção sugerida:**
```ts
if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
if (!dentroDoBrasil(latitude as number, longitude as number)) return null;
```

**Verificar após:** gravar `{latitude: 50.1, longitude: 14.4, v: 2}` na chave e confirmar que a
resolução trata como MISS e refaz.

## Arquivos prováveis

- `src/lib/actions/frete.ts` (schema)
- `src/lib/utils/geocodificarEndereco.ts` (`lerCacheCoordenadas`)
- Testes correspondentes nos arquivos `.test.ts` já existentes desses módulos
