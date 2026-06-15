## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (NÃO recriar):**

- `src/components/painel/UploadQrPix.tsx` — molde de UI/estrutura. Reusar: ramo `preview ? (...) : (...)`, botão "X" de remover absoluto, área dashed de seleção, `<input type="file" className="sr-only">` acionado via `inputRef.current?.click()`, reset `e.target.value = ""` para permitir re-seleção do mesmo arquivo, `next/image` com `unoptimized`, estados de loading com `Loader2`. **NÃO copiar o transporte client-direct** (`createClient` + `supabase.storage.upload` + `getPublicUrl`) — aqui o transporte é a Server Action; o componente novo não importa `@/lib/supabase/client` nem monta URL.
- `src/lib/utils/validarImagem.ts` — `validarImagem({tipo,tamanho})`, `validarMagicBytes(Uint8Array)`, `TIPOS_IMAGEM_PERMITIDOS`, `TAMANHO_MAXIMO_BYTES`. Gate de UX antes de abrir o cropper (idêntico ao trecho 1-2 de `UploadQrPix.processar`). Reusar como está.
- `src/lib/utils/exportarCrop.ts` — `exportarCrop({ imageSrc, croppedAreaPixels }): Promise<Blob>` (webp ~1280×960). `imageSrc` é o objectURL **criado e revogado pelo componente** (o util não revoga o que não criou — comentário no topo do arquivo). Reusar como está.
- `src/lib/actions/upload.ts` — `enviarFotoProduto(formData): Promise<ResultadoUpload>` e a constante `CAMPO_ARQUIVO` (`= "file"`). `ResultadoUpload = { ok: true; foto_url: string } | { ok: false; erro: string }`. Reusar: `fd.append(CAMPO_ARQUIVO, blob)` — nunca string mágica `"file"` literal.
- `react-easy-crop@^6.0.2` (já em `package.json`, issue 074) — `import Cropper, { type Area } from "react-easy-crop"` (default export = `Cropper`; `Area` é named export, mesmo tipo usado por `exportarCrop`). `onCropComplete?: (croppedArea: Area, croppedAreaPixels: Area) => void`.
- shadcn/ui `Button`, `Label` (`@/components/ui/...`) — NÃO editar à mão.
- `sonner` (`toast`), `lucide-react` (`Loader2`, `ImageIcon`, `X`, opcional `Check`/`Crop`).

**O que precisa ser criado:** apenas `src/components/painel/UploadFotoProduto.tsx`. Não há util/lib a criar — crop, export, validação e transporte já existem. Justificativa: o cropper precisa de um wrapper React próprio (overlay com `Cropper` controlado por `crop`/`zoom`/`croppedAreaPixels` + ações confirmar/cancelar), que não existe em nenhum componente atual e não tem equivalente em lib madura instalada.

### Cenários

**Caminho Feliz:**
1. Lojista clica na área de seleção → abre o seletor de arquivo (`accept` = `TIPOS_IMAGEM_PERMITIDOS.join(",")`).
2. `aoSelecionar`: lê o `File`, reseta `e.target.value = ""`.
3. Gate de UX: `validarImagem({ tipo, tamanho })`; se ok, lê `arquivo.slice(0,12).arrayBuffer()` e `validarMagicBytes(new Uint8Array(...))`. Falha → `toast.error(resultado.erro)` e aborta (nada de cropper).
4. Cria `objectUrl = URL.createObjectURL(arquivo)`, guarda em estado, abre o cropper (`estado = "cropando"`). Reseta `crop={x:0,y:0}`, `zoom=1`, `croppedAreaPixels=null`.
5. `Cropper` com `aspect={4/3}`, `crop`, `zoom`, `onCropChange`, `onZoomChange`, `onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}`.
6. Lojista enquadra (drag + zoom/pinch — `react-easy-crop` já trata pinch no touch) e clica "Confirmar recorte".
7. `confirmarCrop` (`estado = "enviando"`, dentro de `startTransition`): `blob = await exportarCrop({ imageSrc: objectUrl, croppedAreaPixels })`; `fd = new FormData(); fd.append(CAMPO_ARQUIVO, blob, "foto.webp")`; `r = await enviarFotoProduto(fd)`.
8. `r.ok === true`: `setPreview(r.foto_url)`, `onUploadConcluido(r.foto_url)`, `toast.success("Foto enviada.")`, fecha o cropper, **revoga o objectUrl** e zera o estado de crop.
9. `estado = "com-foto"`. UI mostra preview + "Substituir" + "Remover".

**Casos de Borda:**
- **Sem arquivo selecionado** (cancelou o picker): `e.target.files?.[0]` undefined → return silencioso.
- **Tipo/tamanho inválido**: `validarImagem` falha → `toast.error`, cropper não abre.
- **Magic bytes inválidos** (extensão mentida): `validarMagicBytes` falha → `toast.error`.
- **`croppedAreaPixels` ainda null** ao confirmar (clicou rápido antes do 1º `onCropComplete`): botão "Confirmar" `disabled` enquanto `croppedAreaPixels == null`.
- **Recorte degenerado / canvas falha**: `exportarCrop` lança (`"Recorte inválido."`, `"Não foi possível processar a imagem."`) → `catch` → `toast.error("Não foi possível processar a imagem.")`, mantém o cropper aberto p/ nova tentativa, **revoga objectUrl só ao fechar/cancelar**.
- **Action retorna `{ ok:false, erro }`** (não autorizado / loja inativa / falha de Storage / >2MB no servidor): `toast.error("Não foi possível enviar a imagem. Tente novamente.")` — mensagem genérica, **não** exibir `r.erro` cru (evita vazar detalhe; `seguranca.md` §14). Mantém cropper aberto.
- **Falha de rede / promise rejeitada** na action: `try/catch` em volta do `await enviarFotoProduto` → mesmo toast genérico.
- **Cancelar o crop** (botão "Cancelar"): fecha o cropper, revoga objectUrl, volta a `idle` (se não havia foto) ou `com-foto` (se substituindo — preserva o preview anterior).
- **`disabled` (prop)**: desabilita seleção, substituir, remover e os botões do cropper.
- **Substituir**: reabre o picker; o objectUrl do crop anterior já foi revogado no confirmar/cancelar — cada ciclo cria e revoga o seu.
- **Remover**: `setPreview(null)`, `onUploadConcluido("")`, `estado = "idle"`. (Não apaga o arquivo do Storage — GC é follow-up, fora de escopo.)

**Tratamento de Erros:** toda falha de upload/processamento mostra mensagem genérica ao usuário via `toast.error`; detalhe técnico fica no servidor (a action já faz `console.error` e devolve `erro` genérico). O componente não loga nem expõe `r.erro` cru.

### Schema de Banco
N/A — issue puramente de UI client-side. Não toca tabela, migration ou RLS. (Bucket/RLS/coluna são de outras issues; a autoridade de propriedade está em `enviarFotoProduto` + RLS do bucket.)

### Validação (zod)
N/A no componente — não há schema zod aqui. A validação de imagem usa os utils puros `validarImagem`/`validarMagicBytes` (compartilhados client/servidor) como gate de UX; a autoridade é a Server Action `enviarFotoProduto` (revalida tamanho + magic bytes server-side) e, no save do produto, `schemaProduto` (issue 072, fora desta issue).

### Recálculo no Servidor
N/A — sem valor monetário. **Regra cliente ↔ servidor:** a validação client-side é só gate de UX; a autoridade não-bypassável é a Server Action `enviarFotoProduto` (deriva `loja_id` de `buscarLojaDoDono`, revalida `validarImagem` + `validarMagicBytes`, escreve em `{loja_id}/{uuid}.{ext}` sob RLS do bucket). O componente **nunca** sobe direto ao Storage nem monta a URL pública — recebe a `foto_url` já validada da action. Conforme `seguranca.md`: escrita de dado de loja garantida por RLS de INSERT (policy `produtos_insert_propria`) + derivação de `loja_id` na action.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/components/painel/UploadFotoProduto.tsx` (`'use client'`) — único arquivo desta issue.

**NÃO tocar (apenas consumir/importar):**
- `src/components/painel/UploadQrPix.tsx` — molde de referência, não editar.
- `src/lib/utils/exportarCrop.ts`, `src/lib/utils/validarImagem.ts`, `src/lib/actions/upload.ts` — consumir as exports existentes.
- `src/components/ui/button.tsx`, `src/components/ui/label.tsx` — shadcn, não editar à mão.
- `src/components/painel/FormProduto.tsx` e páginas — integração é a issue 077, fora de escopo.

**Props exatas (alinhadas com o consumo da issue 077, linha 14):**
```ts
export type UploadFotoProdutoProps = {
  /** URL atual já salva (preview inicial). */
  urlAtual?: string | null;
  /** Chamado com a foto_url pública após upload OK; "" ao remover. */
  onUploadConcluido: (url: string) => void;
  disabled?: boolean;
};
```
> Sem `lojaId` no transporte — a Server Action re-deriva a loja (`buscarLojaDoDono`). A issue 077 chama: `<UploadFotoProduto urlAtual={fotoUrl} onUploadConcluido={(url) => setFotoUrl(url || null)} disabled={enviando} />`. Assinatura idêntica a `UploadQrPix` exceto pela ausência de `lojaId`.

**Imports:**
```ts
import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2, ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  validarImagem,
  validarMagicBytes,
  TIPOS_IMAGEM_PERMITIDOS,
  TAMANHO_MAXIMO_BYTES,
} from "@/lib/utils/validarImagem";
import { exportarCrop } from "@/lib/utils/exportarCrop";
import { enviarFotoProduto, CAMPO_ARQUIVO } from "@/lib/actions/upload";
```

**Estados:**
```ts
const inputRef = useRef<HTMLInputElement>(null);
const [preview, setPreview] = useState<string | null>(urlAtual ?? null);
const [imagemFonte, setImagemFonte] = useState<string | null>(null); // objectURL do crop em andamento
const [crop, setCrop] = useState({ x: 0, y: 0 });
const [zoom, setZoom] = useState(1);
const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
const [enviando, startEnvio] = useTransition();
// estado derivado: cropando = imagemFonte != null; com-foto = preview != null; idle = ambos null.
```

### Dependências Externas
- `react-easy-crop@^6.0.2` — já instalada (issue 074). Doc: https://github.com/ValentinH/react-easy-crop — `Cropper` default export, props `image`, `crop`, `zoom`, `aspect`, `onCropChange`, `onZoomChange`, `onCropComplete`. Pinch-zoom no touch é nativo.
- `sonner@^2.0.7`, `next` (`next/image`), `lucide-react` — já em uso.

### Ordem de Implementação
Issue **não crítica** (`crítica: NÃO`) — sem TDD red-first obrigatório (`exportarCrop` e a action já têm seus testes; o componente é browser-only/canvas, validado manualmente, como o próprio `exportarCrop.ts` documenta).
1. Esqueleto: `'use client'`, props, imports, estados, ramo idle/com-foto copiado de `UploadQrPix` (sem o transporte supabase).
2. `aoSelecionar` + gate `validarImagem`/`validarMagicBytes` → cria objectUrl → abre cropper.
3. Overlay do `Cropper` (aspect 4/3, zoom/pinch) + `onCropComplete` capturando `croppedAreaPixels` + botões Confirmar/Cancelar.
4. `confirmarCrop`: `exportarCrop` → `FormData(CAMPO_ARQUIVO)` → `enviarFotoProduto` dentro de `startEnvio`; tratar `{ok:false}` e exceções com toast genérico; **revogar objectUrl** ao confirmar/cancelar/sucesso (evita leak — lembrete da auditoria 074).
5. `removerPreview` → `onUploadConcluido("")`.
6. `npm run lint` + typecheck.
