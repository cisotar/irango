## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado:**
- `src/lib/utils/validarImagem.ts` — exporta `TAMANHO_MAXIMO_BYTES` (2 MB) e `TIPOS_IMAGEM_PERMITIDOS`. **Reuso:** importar `TAMANHO_MAXIMO_BYTES` só para um aviso defensivo opcional no JSDoc/comentário (o webp 1280×960 fica sempre <500KB, então não há gate aqui). **Não** reimplementar validação — magic bytes/tipo/tamanho são autoridade da Server Action (issue 075); este util é puro de export, sem responsabilidade de segurança.
- `src/lib/utils/calcularFrete.ts` e demais utils puros — **convenção** de `lib/utils/`: módulo sem `'use client'`, função exportada nomeada, teste irmão `*.test.ts`. `exportarCrop.ts` segue o mesmo padrão de arquivo (mas é browser-only por usar `canvas`/`Image`).
- `react-easy-crop@6.0.2` (a adicionar) — fornece o tipo `Area = { x: number; y: number; width: number; height: number }` (coordenadas em **pixels da imagem-fonte**, não da tela). O componente 076 passa o `croppedAreaPixels` do callback `onCropComplete` direto para este util. A lib **não** traz helper de export por canvas — escrever o `getCroppedImg` é responsabilidade do consumidor (este util). Por isso `exportarCrop.ts` é necessário e não duplica nada.

**O que precisa ser criado:**
- `src/lib/utils/exportarCrop.ts` — não existe equivalente. Há lib madura para o *cropper* (`react-easy-crop`), mas o passo "desenhar a região cropada num canvas no tamanho-alvo e exportar webp" é colagem específica do projeto (dimensão-alvo 4:3, qualidade, tratamento de `toBlob` null). Não há pacote consolidado que faça exatamente isso sem trazer peso desnecessário.

### Decisão de testabilidade (issue NÃO crítica — sem TDD red-first)

O harness roda `environment: "node"` (`vitest.config.ts` linha 20) — **não há DOM nem canvas**, nem jsdom. Logo:
- **Testável agora (puro, sem I/O):** o cálculo de dimensões-alvo a partir do aspect e da `larguraAlvo`. Extrair para função pura `calcularDimensoesAlvo(larguraAlvo)` → `{ largura, altura }` (altura = round(largura * 3/4)). É o que o `testar` cobre depois sem mock.
- **NÃO testável no harness atual (precisa de canvas real ou mock pesado):** `carregarImagem`, `ctx.drawImage`, `canvas.toBlob`. Mockar canvas em node dá pouco retorno e testa o mock, não o código. Deixar coberto por verificação manual no navegador (`/verificar`) via o componente 076. Documentar isso no JSDoc do arquivo. Não introduzir jsdom/happy-dom só por isso.

### Cenários

**Caminho Feliz:**
1. Componente 076 obtém `imageSrc` (objectURL do `File` selecionado) e `croppedAreaPixels` (do `onCropComplete` do `react-easy-crop`).
2. Chama `exportarCrop({ imageSrc, croppedAreaPixels })`.
3. Util carrega a imagem (`carregarImagem` → `new Image()` + `onload`/`onerror`, `crossOrigin` quando aplicável).
4. Calcula `{ largura: 1280, altura: 960 }` via `calcularDimensoesAlvo(1280)`.
5. Cria `<canvas>` 1280×960, `drawImage(img, sx, sy, sWidth, sHeight, 0, 0, 1280, 960)` usando `croppedAreaPixels` como região-fonte (`sx=x, sy=y, sWidth=width, sHeight=height`).
6. `canvas.toBlob(cb, 'image/webp', QUALIDADE_WEBP)` → resolve a Promise com o `Blob`.
7. Componente 076 recebe o `Blob` e o envia à Server Action (issue 075).

**Casos de Borda:**
- `toBlob` retorna `null` (navegador sem suporte a webp / falha de encode): rejeitar a Promise com `Error("Não foi possível processar a imagem.")`.
- Falha ao carregar a imagem (`img.onerror`, src inválido/CORS): rejeitar com `Error("Não foi possível carregar a imagem.")`.
- `croppedAreaPixels` com `width`/`height` ≤ 0 (crop degenerado): rejeitar cedo com erro claro, antes de tocar canvas.
- `larguraAlvo` custom (override do componente): respeitada; altura derivada mantendo 4:3.
- objectURL criado **fora** do util (pelo componente): o util **não** revoga o que não criou. Se o util criar um objectURL internamente (caso receba `Blob`/`File` em vez de string — não previsto na assinatura atual), revoga no `finally`. Assinatura atual recebe `imageSrc: string`, então a revogação do objectURL é do chamador (076). Documentar no JSDoc.

**Tratamento de Erros:** util de browser/UX — mensagens curtas e amigáveis nas rejeições (o componente 076 mostra via `toast`). Sem `console.error` de stack aqui (não é servidor); o detalhe do erro nativo pode ir como `cause` no `Error` para o DevTools. `seguranca.md` §14 (não vazar interno) aplica-se à Server Action 075, não a este util client.

### Schema de Banco
Não se aplica — util puro de browser, não toca Supabase, RLS ou migrations.

### Validação (zod)
Não se aplica — sem input de formulário. A validação de tipo/tamanho/magic bytes é feita pelo componente 076 (UX) e pela Server Action 075 (autoridade), reusando `validarImagem.ts`. Este util não valida nada de segurança.

### Recálculo no Servidor
Não há valor monetário. A "autoridade" sobre o arquivo (tamanho real, magic bytes) é da Server Action `enviarFotoProduto` (issue 075), que revalida o `Blob` recebido. Este util é puro UX/otimização client-side — explicitamente **não** é autoridade (ver Segurança da issue).

### Assinatura e Constantes (contrato para a issue 076 consumir)

```ts
// src/lib/utils/exportarCrop.ts  (browser-only — usa Image/canvas; sem 'use client', é util importável)

import type { Area } from "react-easy-crop";

export const LARGURA_ALVO_PADRAO = 1280;
export const ASPECT_FOTO = 4 / 3;            // = aspect do card da vitrine (object-cover 4:3)
export const QUALIDADE_WEBP = 0.82;          // equilíbrio peso/qualidade; ~150-300KB p/ 1280×960
export const TIPO_SAIDA = "image/webp" as const;

export type ExportarCropParams = {
  imageSrc: string;                 // objectURL ou URL da imagem-fonte (criado/gerido pelo chamador)
  croppedAreaPixels: Area;          // { x, y, width, height } em pixels da imagem-fonte (react-easy-crop)
  larguraAlvo?: number;             // default LARGURA_ALVO_PADRAO (1280); altura derivada por ASPECT_FOTO
};

/** Pura e testável: deriva as dimensões-alvo 4:3 a partir da largura. */
export function calcularDimensoesAlvo(
  larguraAlvo = LARGURA_ALVO_PADRAO,
): { largura: number; altura: number } { /* altura = Math.round(largura / ASPECT_FOTO) */ }

/** Exporta a região cropada como Blob webp ~1280×960. Browser-only. */
export function exportarCrop(params: ExportarCropParams): Promise<Blob> { /* ... */ }
```

- `Area` vem do `react-easy-crop` (não redefinir o tipo — importar para evitar drift com a lib).
- Helper interno **não exportado** `carregarImagem(src: string): Promise<HTMLImageElement>` isola o I/O de DOM (mantém `exportarCrop` legível e a parte pura separada).

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/utils/exportarCrop.ts` — o util (assinatura acima). Motivo: peça central da issue.
- (o teste `src/lib/utils/exportarCrop.test.ts` fica para o `testar` — só `calcularDimensoesAlvo`; não criar agora, issue não-crítica.)

**Modificar:**
- `package.json` — adicionar `react-easy-crop` em `dependencies`. **Instalar via `corepack pnpm add react-easy-crop`** (memória: nunca `pnpm` cru nem `npm install`; usar corepack). Apesar do checklist da issue dizer `npm install`, seguir a convenção real do repo (corepack pnpm).

**NÃO tocar:**
- `src/lib/utils/validarImagem.ts` — só importar `TAMANHO_MAXIMO_BYTES` se for usar no comentário; não alterar.
- `src/components/painel/UploadQrPix.tsx` — referência de UI da issue 076, não deste util.
- `components/ui/*` (shadcn) — não se edita à mão; nem é tocado aqui.
- `vitest.config.ts` — **não** adicionar jsdom/happy-dom só para este util (baixo retorno; canvas exige polyfill pesado). Manter `environment: "node"`.

### Dependências Externas
- `react-easy-crop@6.0.2` — peer `react >=16.4.0` / `react-dom >=16.4.0` (satisfeito por React 19.2.4 do repo). Doc: https://github.com/ValentinH/react-easy-crop (a lib **não** inclui helper de export por canvas — o exemplo oficial `getCroppedImg` é a referência para este util). Tipo `Area` exportado pelo pacote.

### Ordem de Implementação
Issue **não crítica** → sem fase RED obrigatória. Ordem por dependência:
1. `corepack pnpm add react-easy-crop` (precisa existir para importar o tipo `Area`).
2. `exportarCrop.ts`: primeiro `ASPECT_FOTO`, constantes e `calcularDimensoesAlvo` (pura); depois `carregarImagem` (I/O) e `exportarCrop` (canvas + `toBlob` + rejeições de borda).
3. `npm run lint` + typecheck (`tsc --noEmit`) — critério de aceite.
4. (Depois, fora desta issue) o `testar` cobre `calcularDimensoesAlvo`; a parte canvas é validada no `/verificar` via componente 076.
