# [010] Tooltip de margem no campo de raio (`/painel/configuracoes/entregas`)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** —
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Adicionar um tooltip/aviso de copy ao campo `raio_max_km` no painel de entregas, orientando o lojista a calibrar com margem por causa da granularidade irregular de CEP do Nominatim no Brasil.

## Escopo
- [ ] Tooltip/help text no campo de raio: explicar que CEPs brasileiros podem resolver no centroide do bairro/município; sugerir margem (ex.: "para atender 5 km reais, configure 7-8 km").
- [ ] Sem mudança de lógica de zona/taxa — só copy/UI.

## Fora de escopo
- Cálculo de frete por raio (issues 006/007).
- Cache/fallback de geocoding por bairro (v2, fora do escopo).
- Qualquer mudança de schema ou validação de `raio_max_km`.

## Reuso esperado
- Componente de tooltip do shadcn/ui já usado no projeto (se existir); caso contrário, help text simples.
- Copy diretamente do spec §"Risco de negócio: granularidade de CEP".

## Segurança
- Puramente estético/copy — sem valor monetário nem autorização. `crítica: NÃO`.

## Critério de aceite
- [ ] Tooltip/help text visível no campo de raio do formulário de zona `raio_km`.
- [ ] `next build` sem erro.

## Plano Técnico

### Análise do Codebase

O que já existe e será reusado:
- `src/components/painel/FormZona.tsx` — único arquivo a tocar. Já é `'use client'`, já renderiza o campo `raio_max_km` dentro do bloco condicional `{tipo === "raio_km" && (...)}` (linhas 185-196), com `<Label htmlFor="zona-raio">` + `<Input id="zona-raio">`. Cada bloco de campo usa o wrapper `<div className="space-y-1">`.
- Padrão de help text/texto auxiliar do projeto: `<p className="text-xs text-muted-foreground">` — já usado em `UploadFotoProduto.tsx:238`, `UploadLogoLoja.tsx:242`, e em vários componentes do painel. É o padrão estabelecido para texto secundário/instrução.
- Spec `specs/zonas-entrega-raio-km.md` §"Risco de negócio: granularidade de CEP no Nominatim" (linhas 177-181) — fonte da copy.

O que NÃO existe (decisão de componente):
- Não há componente `Tooltip` em `src/components/ui/` (nenhum arquivo `tooltip*`).
- Não há dependência `@radix-ui/react-tooltip` em `package.json`.
- `grep -ril "tooltip"` em `src/` não retorna nenhum uso no projeto.
- **Decisão:** usar **help text simples** (`<p>` muted), não tooltip. A própria issue/spec ("Reuso esperado") prevê esse fallback. Adicionar a dependência shadcn Tooltip + Radix para uma issue puramente de copy seria inflar escopo. Help text inline é melhor para a11y e mobile (sem hover) do que tooltip.

### Cenários

**Caminho Feliz:**
1. Lojista abre `/painel/configuracoes/entregas` e o `FormZona`.
2. Seleciona Tipo = "Por raio (km)".
3. O campo "Raio máximo (km)" aparece, agora com a frase de ajuda logo abaixo do `Input`.
4. Lojista lê a orientação de margem e configura o raio com folga.

**Casos de Borda:** Nenhum relevante — texto estático.
- Tipo ≠ `raio_km`: o help text fica dentro do bloco condicional, então não aparece (correto).
- Mobile: `<p>` inline é sempre visível, sem depender de hover.

**Tratamento de Erros:** N/A — sem lógica, sem fetch, sem Server Action.

### Schema de Banco
Não toca dados. Nenhuma migration, coluna ou RLS. Fora de escopo na issue.

### Validação (zod)
Inalterada. `schemaZonaCompleta` em `src/lib/validacoes/entrega.ts` continua igual.

### Recálculo no Servidor
N/A — sem valor monetário nesta issue (cálculo de frete por raio é das issues 006/007).

### Regra cliente ↔ servidor
Nenhuma invariante de valor/permissão introduzida. Mudança 100% apresentacional no cliente; copy estática não é superfície de ataque.

### Copy final (exata)

Derivada do spec §"Risco de negócio: granularidade de CEP":

> Configure com margem: CEPs brasileiros podem cair no centro do bairro ou da cidade, não no endereço exato. Para atender 5 km reais, configure 7-8 km.

### Onde inserir

Dentro do bloco `{tipo === "raio_km" && (...)}` (linhas 185-196), **após** o `<Input id="zona-raio" ... />` e **antes** do fechamento do `</div>` do wrapper `space-y-1`. Vincular ao input com `id="zona-raio-ajuda"` no `<p>` e `aria-describedby="zona-raio-ajuda"` no `<Input>`.

```tsx
<Input
  id="zona-raio"
  aria-describedby="zona-raio-ajuda"
  ...
/>
<p id="zona-raio-ajuda" className="text-xs text-muted-foreground">
  Configure com margem: CEPs brasileiros podem cair no centro do bairro ou
  da cidade, não no endereço exato. Para atender 5 km reais, configure 7-8 km.
</p>
```

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/components/painel/FormZona.tsx` — adicionar `<p>` de ajuda + `aria-describedby` no input de raio (bloco linhas 185-196). Única mudança.

**NÃO criar:** nenhum componente novo. Não criar `src/components/ui/tooltip.tsx` nem adicionar Radix.

**NÃO tocar:** `src/lib/validacoes/entrega.ts`, `src/lib/actions/entrega.ts`, schema, migrations, `src/components/ui/`.

### Dependências Externas
Nenhuma.

### Ordem de Implementação
Issue NÃO crítica (só copy/UI), sem TDD red-first.
1. Editar `FormZona.tsx`: inserir `<p>` de ajuda + `aria-describedby`.
2. `next build` (critério de aceite).
