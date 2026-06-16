## Plano Técnico

### Análise do Codebase
Inventário de reuso (`src/lib/utils/`):
- `src/lib/utils/calcularFrete.ts` — define `EnderecoEntrega.distanciaKm` e o ramo `tipo: 'raio_km'` que compara `distanciaKm <= raio_max_km`. **É o consumidor a jusante**: hoje `distanciaKm` nunca é preenchido (spec §Visão Geral, "letra morta"). `haversine` será a fonte desse número. NÃO altera esta função — ela já recebe `distanciaKm` pronto.
- `src/lib/utils/calcularDesconto.ts` / `formatarMoeda.ts` — referência de convenção para util puro: JSDoc em português explicitando "PURA, sem I/O", responsabilidade limitada, o que é do caller. Seguir o mesmo tom.
- Padrão de teste: `*.test.ts` co-localizado, `import { describe, it, expect } from "vitest"`, comentário-cabeçalho marcando RED e delimitando responsabilidade da função.

Confirmado por `grep`: **não existe** nenhum `haversine`, `6371` ou cálculo de distância no codebase. Primitivo genuinamente novo — não há o que reusar, há o que será reusado por terceiros (RN-7: nenhuma action reimplementa inline).

Lib madura vs. artesanal: haversine não justifica dependência nova — é ~10 linhas de `Math` nativo, é exatamente o que a issue e o spec pedem (§Visão Geral, "haversine puro, sem dependência nova"). Adicionar pacote aqui seria over-engineering.

### Cenários
Função pura, determinística, sem I/O — não há rede, permissão, loja inativa nem cupom. Cenários relevantes são de cálculo:

**Caminho Feliz:** recebe `(latA, lngA, latB, lngB)` em graus decimais → converte para radianos → aplica fórmula de haversine com R=6371 → retorna distância em km (number, sem arredondamento forçado; arredondamento é decisão do caller, como em `calcularFrete`).

**Casos de Borda:**
- Pontos idênticos → retorna `0` (não `NaN` por erro de ponto flutuante; `Math.asin`/`atan2` precisa estar protegido de domínio `> 1`).
- Simetria: `haversine(A,B) === haversine(B,A)`.
- Coordenadas com sinal (hemisfério sul/oeste, caso do Brasil: lat e lng negativos) — deve funcionar sem tratamento especial.
- Antimeridiano / pontos distantes — fora do uso real (frete local), mas a fórmula deve permanecer correta; não exigir teste, só não quebrar.

**Tratamento de Erros:** função pura não lança nem loga. Entrada inválida (NaN) propaga como NaN — é responsabilidade do caller server-side (issue 003 `geocodificarEndereco`) garantir coords válidas antes de chamar. Não adicionar validação defensiva aqui (mantém ~10 linhas; validação de input mora na borda, não no cálculo).

### Schema de Banco
Não toca dados. Sem tabela, sem migration, sem RLS.

### Validação (zod)
Não se aplica — função pura recebe 4 numbers, não payload de cliente. A validação das coords (faixa lat/lng) é da issue 003 (geocoding server-side), onde entra o schema zod.

### Recálculo no Servidor
Não há valor monetário direto nesta função. Porém é **insumo de valor**: o `distanciaKm` que ela produz alimenta `calcularFrete`, que roda tanto no preview (vitrine, UX) quanto na Server Action autoritativa de criar pedido (`seguranca.md` §10). A invariante "cliente não define a distância" é garantida a jusante: `haversine` só será chamado com coords vindas do banco / geocoding server-side — nunca com `distanciaKm` enviado pelo cliente. Esta issue só garante que o número seja **determinístico e correto** (RN-8); a paridade preview↔autoritativo depende de ambos os callers usarem ESTA função (RN-7), não reimplementarem.

### Assinatura e Fórmula
```ts
/**
 * Distância em quilômetros, em linha reta, entre dois pontos geográficos
 * (fórmula de haversine). PURA, sem I/O — recebe graus decimais, retorna km.
 * R = 6371 (raio médio da Terra). Insumo de `calcularFrete` (raio_km) — RN-8.
 * Determinística: mesma entrada → mesma saída. Pontos iguais → 0.
 */
export function haversine(
  latA: number, lngA: number,
  latB: number, lngB: number,
): number
```
Fórmula: `a = sin²(Δlat/2) + cos(latA)·cos(latB)·sin²(Δlng/2)`; `c = 2·atan2(√a, √(1−a))`; `d = R·c`. Usar `atan2` (estável em a≈1) e converter graus→rad por `g * Math.PI / 180`.

### Arquivos a Criar / Modificar / NÃO tocar
**Criar:**
- `src/lib/utils/haversine.ts` — a função pura + JSDoc (RN-8). Motivo: primitivo novo, sem equivalente.
- `src/lib/utils/haversine.test.ts` — fase RED (issue crítica). Casos: distância 0 (pontos iguais), valor conhecido SP dentro de tolerância, simetria, coords negativas.

**NÃO tocar:**
- `src/lib/utils/calcularFrete.ts` — já consome `distanciaKm`; o spec é explícito ("sem alterar a função pura"). Tocar aqui seria escopo da issue de wiring (003+).

### Casos de Teste (RED)
- `distância 0` — `haversine(-23.55, -46.63, -23.55, -46.63)` ≈ 0 (tolerância p/ float, ex.: `< 1e-9`).
- `valor conhecido SP` — dois pontos reais de São Paulo (ex.: Praça da Sé `-23.5505,-46.6333` ↔ Av. Paulista/MASP `-23.5614,-46.6559`) ≈ 2.5 km, asserção com `toBeCloseTo` / tolerância ~0.2 km. Definir o valor esperado calculando-o uma vez e fixando-o no teste.
- `simetria` — `haversine(A,B) === haversine(B,A)` para coords negativas brasileiras.
- (opcional) `hemisfério` — par com sinais mistos só para garantir que sinal não quebra.

### Dependências Externas
Nenhuma. Apenas `Math` nativo (ES). Sem novo pacote no `package.json`.

### Ordem de Implementação
Issue **crítica** (alimenta frete → dinheiro). Red-first obrigatório:
1. **RED (`/tdd`)** — `haversine.test.ts` com os 3+ casos; rodar `pnpm test` e confirmar falha real (módulo inexistente).
2. **GREEN (`/execute`)** — `haversine.ts` mínimo p/ passar; `pnpm test` verde.
3. Refator/JSDoc final se necessário (já cabe no passo 2 dado o tamanho).
