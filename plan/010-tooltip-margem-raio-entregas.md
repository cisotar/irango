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
- **Decisão:** usar **help text simples** (`<p>` muted), não tooltip. A própria issue/spec ("Reuso esperado") prevê esse fallback. Adicionar a dependência shadcn Tooltip + Radix para uma issue puramente de copy seria reinventar/inflar escopo — viola "lib madura > artesanal" no sentido inverso (não adicionar peso desnecessário). Help text inline é ainda melhor para a11y e mobile (sem hover) do que tooltip.

### Cenários

**Caminho Feliz:**
1. Lojista abre `/painel/configuracoes/entregas` e o `FormZona`.
2. Seleciona Tipo = "Por raio (km)".
3. O campo "Raio máximo (km)" aparece, agora com a frase de ajuda logo abaixo do `Input`.
4. Lojista lê a orientação de margem e configura o raio com folga.

**Casos de Borda:** Nenhum relevante — é texto estático.
- Tipo ≠ `raio_km`: o help text fica dentro do bloco condicional, então não aparece (correto).
- Mobile: `<p>` inline é sempre visível, sem depender de hover (vantagem sobre tooltip).
- A copy não interage com estado, validação, rede ou valor — nenhuma borda de erro.

**Tratamento de Erros:** N/A — sem lógica, sem fetch, sem Server Action.

### Schema de Banco
Não toca dados. Nenhuma migration, nenhuma coluna, nenhuma RLS. Explicitamente fora de escopo na issue.

### Validação (zod)
Inalterada. `schemaZonaCompleta` em `src/lib/validacoes/entrega.ts` continua igual. `raio_max_km` mantém regra atual.

### Recálculo no Servidor
N/A — não há valor monetário envolvido nesta issue (a copy apenas orienta sobre calibragem; o cálculo de frete por raio é das issues 006/007).

### Regra cliente ↔ servidor
Nenhuma invariante de valor/permissão é introduzida. Mudança é 100% apresentacional no cliente, sem enforcement server-side necessário. Conforme `seguranca.md`: copy estática não é superfície de ataque.

### Copy final (exata)

Texto a inserir no help text (uma string, derivada do spec §"Risco de negócio: granularidade de CEP"):

> Configure com margem: CEPs brasileiros podem cair no centro do bairro ou da cidade, não no endereço exato. Para atender 5 km reais, configure 7-8 km.

### Onde inserir

Dentro do bloco `{tipo === "raio_km" && (...)}` (linhas 185-196), **após** o `<Input id="zona-raio" ... />` e **antes** do fechamento do `</div>` do wrapper `space-y-1`. Vincular ao input por acessibilidade com `id="zona-raio-ajuda"` no `<p>` e `aria-describedby="zona-raio-ajuda"` no `<Input>`.

Forma:
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

**NÃO criar:**
- Nenhum componente novo. Não criar `src/components/ui/tooltip.tsx` nem adicionar Radix.

**NÃO tocar:**
- `src/lib/validacoes/entrega.ts`, `src/lib/actions/entrega.ts`, schema, migrations — fora de escopo.
- `src/components/ui/` — não se edita shadcn à mão.

### Dependências Externas
Nenhuma. Sem novo pacote.

### Ordem de Implementação
Issue NÃO crítica (só copy/UI), sem TDD red-first.
1. Editar `FormZona.tsx`: inserir o `<p>` de ajuda + `aria-describedby`.
2. `next build` (critério de aceite) — garante que o JSX compila.
