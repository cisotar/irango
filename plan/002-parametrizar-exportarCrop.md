## Plano Técnico

### Análise do Codebase

O que já existe e será reusado:

- `src/lib/utils/exportarCrop.ts` — único exportador de crop. Hoje:
  - `ASPECT_FOTO = 4/3` (constante exportada, importada por `UploadFotoProduto`).
  - `LARGURA_ALVO_PADRAO = 1280`, `QUALIDADE_WEBP = 0.82`, `TIPO_SAIDA = "image/webp"`.
  - `calcularDimensoesAlvo(larguraAlvo = LARGURA_ALVO_PADRAO)` — pura, deriva altura por `largura / ASPECT_FOTO`. É o alvo principal da parametrização e a única parte coberta por teste node.
  - `exportarCrop({imageSrc, croppedAreaPixels, larguraAlvo})` — browser-only (Image + canvas). Pinta `drawImage(... 0, 0, largura, altura)` no canvas dimensionado por `calcularDimensoesAlvo`.
  - **Será PARAMETRIZADO, não recriado** (mandato "não reinventar a roda" + spec §"Reuso explícito"). A logo 1:1 reusa este mesmo arquivo.
- `src/lib/utils/exportarCrop.test.ts` — suíte node que fixa o contrato 4:3 de `calcularDimensoesAlvo` e a guarda de `croppedAreaPixels` degenerado. Os testes 4:3 existentes têm de continuar passando (são a prova de zero regressão); só serão ADICIONADOS casos para `aspect`.
- `src/components/painel/UploadFotoProduto.tsx` — chama `exportarCrop({ imageSrc, croppedAreaPixels })` SEM passar `aspect` nem `larguraAlvo` (linha ~130) e importa `ASPECT_FOTO` para o `<Cropper aspect={...}>`. **NÃO será tocado** — depende só dos defaults, que são preservados.

O que precisa ser criado:

- Nada de arquivo novo. Apenas estender a assinatura de duas funções já existentes. Justificativa de não-reuso-extra: não há lib madura para "recortar região de canvas e exportar webp em dimensão-alvo"; é util de DOM artesanal já existente — o correto é parametrizá-lo, não substituí-lo.

### Cenários

**Caminho Feliz (foto de produto — inalterado):**
1. `UploadFotoProduto` chama `exportarCrop({ imageSrc, croppedAreaPixels })`.
2. `aspect` cai no default `ASPECT_FOTO` (4/3); `larguraAlvo` no default `1280`.
3. `calcularDimensoesAlvo(1280, 4/3)` → `{ largura: 1280, altura: 960 }`.
4. Blob webp 1280×960 idêntico ao de hoje. Zero regressão.

**Caminho Feliz (logo — novo consumidor, fora desta issue):**
1. O uploader de logo chama `exportarCrop({ imageSrc, croppedAreaPixels, aspect: 1, larguraAlvo: 320 })`.
2. `calcularDimensoesAlvo(320, 1)` → `{ largura: 320, altura: 320 }`.
3. Blob webp quadrado 320×320.

**Casos de Borda:**
- `croppedAreaPixels` degenerado (width/height ≤ 0): guarda existente lança `"Recorte inválido."` ANTES de qualquer DOM — inalterada, independente de `aspect`.
- `aspect` omitido: default `ASPECT_FOTO` (4/3) — garante retrocompatibilidade.
- `aspect = 1`: quadrado, altura = largura.
- `aspect` com arredondamento (ex. `larguraAlvo` ímpar): `Math.round` em ambas as dimensões mantém inteiros, igual ao contrato atual.
- `cropShape` (máscara redonda): **NÃO entra no export** — é só visual no `<Cropper>`; o webp final é sempre retângulo/quadrado. Não vira parâmetro de `exportarCrop` (alinhado ao enunciado da issue).
- `aspect ≤ 0` ou `NaN`: não é entrada de usuário (vem do código chamador, valor literal). Sem gate de segurança — opcional uma guarda defensiva, mas fora do escopo mínimo; o teste pode documentar o comportamento se desejado.

**Tratamento de Erros:** inalterado. `exportarCrop` lança erros já existentes (`"Recorte inválido."`, `"Não foi possível carregar a imagem."`, `"Não foi possível processar a imagem."`); o componente chamador traduz para toast genérico e loga detalhe no `console.error` (`seguranca.md §14`). Esta issue não muda o tratamento.

### Schema de Banco

Não se aplica. Issue puramente de util de browser/UX. Sem tabela, sem RLS, sem migration.

### Validação (zod)

Não se aplica. `exportarCrop` é preview/otimização de UX, sem validação de domínio. A autoridade de tipo/tamanho/magic bytes está na Server Action de upload (fora desta issue) — esta issue **não** introduz nenhuma confiança no cliente.

### Recálculo no Servidor

Não se aplica. Sem valor monetário e sem gate de permissão. Camada cliente ↔ servidor: este util é 100% cliente (preview de imagem); a autoridade do upload (magic bytes, tamanho, `loja_id` do auth, RLS de Storage) permanece na Server Action — esta issue não altera nem enfraquece esse enforcement.

### Assinaturas Novas

`calcularDimensoesAlvo`:
```ts
export function calcularDimensoesAlvo(
  larguraAlvo = LARGURA_ALVO_PADRAO,
  aspect = ASPECT_FOTO,
): { largura: number; altura: number } {
  const largura = Math.round(larguraAlvo);
  const altura = Math.round(largura / aspect);
  return { largura, altura };
}
```
- `aspect` é o 2º parâmetro com default `ASPECT_FOTO` → chamadas posicionais existentes (`calcularDimensoesAlvo()`, `calcularDimensoesAlvo(640)`) inalteradas.

`exportarCrop`:
```ts
export type ExportarCropParams = {
  imageSrc: string;
  croppedAreaPixels: Area;
  larguraAlvo?: number; // default LARGURA_ALVO_PADRAO (1280)
  aspect?: number;      // default ASPECT_FOTO (4/3); 1 = quadrado (logo)
};

export async function exportarCrop({
  imageSrc,
  croppedAreaPixels,
  larguraAlvo = LARGURA_ALVO_PADRAO,
  aspect = ASPECT_FOTO,
}: ExportarCropParams): Promise<Blob> {
  // ...guarda inalterada...
  const { largura, altura } = calcularDimensoesAlvo(larguraAlvo, aspect);
  // ...resto inalterado...
}
```
- `aspect` opcional com default → o objeto-argumento atual de `UploadFotoProduto` (`{ imageSrc, croppedAreaPixels }`) continua válido.
- Atualizar o JSDoc/comentários do arquivo que hoje afirmam "4:3 fixo" para refletir a parametrização (sem reescrever a doc inteira).

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/lib/utils/exportarCrop.ts` — adicionar `aspect` (default `ASPECT_FOTO`) em `calcularDimensoesAlvo` e em `ExportarCropParams`/`exportarCrop`; usar `aspect` no cálculo de altura; atualizar comentários "4:3 fixo". `ASPECT_FOTO` permanece exportado (ainda é o default e é importado pelo componente).
- `src/lib/utils/exportarCrop.test.ts` — ADICIONAR casos para o parâmetro `aspect` (ver abaixo). NÃO remover os casos 4:3 existentes (são a rede de regressão).

**NÃO tocar:**
- `src/components/painel/UploadFotoProduto.tsx` — usa só os defaults; mudá-lo seria fora de escopo e sem motivo. (O uploader de logo é issue separada da spec.)
- Qualquer Server Action / migration / RLS — não há schema nesta issue.

### Dependências Externas

Nenhuma nova. `react-easy-crop` (tipo `Area`) já está no `package.json` e em uso. `Image`/`canvas` são APIs nativas do browser.

### Ordem de Implementação

Issue marcada **crítica: NÃO**. Mesmo assim, como o contrato é coberto por teste puro e o objetivo central é "zero regressão", convém escrever os testes do parâmetro `aspect` em paralelo:

1. Estender `calcularDimensoesAlvo` com `aspect` (default `ASPECT_FOTO`).
2. Estender `ExportarCropParams` + `exportarCrop` com `aspect` (default `ASPECT_FOTO`), repassando para `calcularDimensoesAlvo`.
3. Adicionar casos de teste de `aspect` e rodar a suíte completa — confirmar que TODOS os casos 4:3 antigos continuam verdes (prova de zero regressão).
4. `npx tsc --noEmit` / `next build` para garantir que `UploadFotoProduto` segue compilando com a assinatura nova.

### Testes Unitários de `calcularDimensoesAlvo` a Cobrir (parâmetro `aspect`)

Manter TODOS os casos 4:3 atuais (default e explícitos). Adicionar:
- `calcularDimensoesAlvo(320, 1)` → `{ largura: 320, altura: 320 }` (logo quadrada — caso-alvo da spec).
- `calcularDimensoesAlvo(256, 1)` → `{ largura: 256, altura: 256 }` (extremo inferior da faixa de logo da spec).
- `aspect` omitido em chamada posicional só com largura (`calcularDimensoesAlvo(640)`) → continua 4:3 (`{640, 480}`) — prova de que o default não regrediu.
- `calcularDimensoesAlvo(LARGURA_ALVO_PADRAO, ASPECT_FOTO)` === `calcularDimensoesAlvo()` — equivalência do default explícito.
- `aspect = 16/9` (ex. `calcularDimensoesAlvo(1600, 16/9)` → `{1600, 900}`) — confirma que a fórmula generaliza além de 1 e 4/3.
- Arredondamento com `aspect = 1` e largura decimal/ímpar (ex. `calcularDimensoesAlvo(101.6, 1)` → `{102, 102}`) — `Math.round` em ambas as dimensões.
- Inteiros sempre: laço sobre várias larguras com `aspect = 1` garantindo `Number.isInteger` em `largura` e `altura`.
