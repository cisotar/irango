## Plano Técnico

### Análise do Codebase

O que já existe e será reusado:
- `src/lib/utils/fotoSegura.ts` — `fotoSegura(url?): string | null`. Guard anti-XSS §15
  para `src` de imagem. Predicado: `url && url.startsWith("https://") ? url : null`.
  Será **reescrito para delegar** ao core neutro; assinatura e nome preservados.
- `src/lib/utils/fotoSegura.test.ts` — 14 casos cobrindo a fórmula (https ok, http/
  javascript/data/relativo/maiúsculo/null/undefined/vazio/protocol-relative/ftp/
  espaços/`https://` sem host). Continua válido sem mudança — `fotoSegura` mantém o
  mesmo comportamento observável.
- `src/components/painel/TabelaFaturas.tsx:62-64` — `urlSeguraFatura(url): string | null`,
  fórmula **idêntica** (href de fatura, não `src` de imagem). É a cópia solta a remover.
- Convenção de `src/lib/utils/`: **um conceito público por arquivo + teste colocado**
  (`formatarMoeda.ts`/`.test.ts`, `haversine.ts`/`.test.ts`, etc.). Decisão de
  localização do core segue essa convenção.

Os **6 callsites de imagem** que consomem `fotoSegura` e NÃO mudam (importam pelo nome
foto-específico): `CardProduto.tsx:34`, `ProdutoModal.tsx:78`, `SecaoCatalogo.tsx:89`,
`HeaderLoja.tsx:41`, `EtapaItens.tsx:114`, `ThumbProduto.tsx:15`.

Fora de escopo confirmado: `src/lib/utils/manifest.ts:27` — `startsWith("https://")` como
**boolean guard** dentro de `if`, não retorna URL. Semântica diferente; NÃO tocar.

### Decisão: onde mora o core — arquivo novo `urlHttpsSegura.ts`

**Recomendação: criar `src/lib/utils/urlHttpsSegura.ts` (arquivo próprio), não dentro de
`fotoSegura.ts`.**

Justificativa (coesão vs. nome do arquivo):
- A convenção do diretório é estrita: um conceito público por arquivo, com teste colocado
  de mesmo nome. Exportar `urlHttpsSegura` de dentro de `fotoSegura.ts` cria um segundo
  símbolo público num arquivo cujo nome anuncia "foto" — quem precisa do guard genérico
  de href (TabelaFaturas e futuros) teria de importar de um arquivo foto-específico, o que
  esconde o helper e desalinha nome ⇄ conteúdo.
- Coesão melhora, não piora: `urlHttpsSegura.ts` = a fórmula §15 neutra (a invariante);
  `fotoSegura.ts` = a especialização de domínio "isto é uma foto" que delega. Cada arquivo
  tem uma razão única para mudar.
- Teste do core ganha vida própria em `urlHttpsSegura.test.ts`, sem inflar o de foto.

### Cenários

**Caminho feliz:**
1. Imagem: callsite chama `fotoSegura(url)` → delega a `urlHttpsSegura(url)` → retorna a
   URL se `https://`, senão `null`. Render mostra imagem ou placeholder. (inalterado)
2. Fatura: `TabelaFaturas` chama `urlHttpsSegura(f.fatura_url)` direto → href clicável só
   se `https://`, senão `<span>—</span>`. (inalterado em comportamento)

**Casos de borda** (todos já cobertos pela fórmula única, agora num só lugar):
`http://`, `javascript:`, `data:`, caminho relativo, `//cdn` protocol-relative, `ftp://`,
`HTTPS://` maiúsculo, `null`, `undefined`, `""`, só-espaços, `https://` sem host → todos
`null` exceto `https://` sem host (aceito, comportamento documentado).

**Tratamento de erros:** função pura, sem I/O, sem throw — a "falha" é `null` silencioso
(placeholder/traço no render), por design §15. Sem mensagem ao usuário, sem log.

### Schema de Banco
Não se aplica — refactor de função pura de apresentação. Sem tabela, sem RLS, sem migration.

### Validação (zod)
Não se aplica. Não há form nem Server Action nesta issue; o guard §15 é defesa de
apresentação, não validação de input de domínio.

### Recálculo no Servidor (regra cliente ↔ servidor)
A invariante §15 é **defesa de apresentação** (anti-XSS no render de `src`/`href`), não
regra de valor nem de permissão. `fatura_url`/`foto_url` chegam já escopados:
- `fatura_url` vem de query já filtrada por RLS (`listarFaturasDaLoja`) — autorização
  garantida no servidor a montante; o guard só decide se a string vira `href` clicável.
- `foto_url` é dado de catálogo público.
Logo não há valor monetário a recalcular nem invariante de permissão deslocada para o
cliente. `TabelaFaturas` é Server Component read-only; o guard roda no servidor no render.
Sem enforcement de valor/permissão pendente — nada a justificar além disto.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/utils/urlHttpsSegura.ts` — core neutro, fonte única da fórmula §15:
  `export function urlHttpsSegura(url?: string | null): string | null {
     return url && url.startsWith("https://") ? url : null;
   }`
  Comentário de cabeçalho documenta a invariante §15 e que é genérico (src OU href).
- `src/lib/utils/urlHttpsSegura.test.ts` — replica a bateria de bordas (https, http,
  javascript, data, relativo, protocol-relative, ftp, maiúsculo, null, undefined, vazio,
  só-espaços, `https://` sem host). Pode mover a maior parte dos casos de `fotoSegura.test.ts`.

**Modificar:**
- `src/lib/utils/fotoSegura.ts` — corpo passa a `return urlHttpsSegura(url);` + import.
  Mantém nome, assinatura e o comentário de domínio (por que foto = não confiável).
- `src/lib/utils/fotoSegura.test.ts` — mantém pelo menos 1–2 casos de *integração*
  (delega corretamente: aceita `https://`, rejeita `javascript:`) para travar o contrato
  de delegação. As bordas exaustivas migram para `urlHttpsSegura.test.ts` (evita duplicar
  a mesma matriz em dois arquivos).
- `src/components/painel/TabelaFaturas.tsx` — remove `urlSeguraFatura` (linhas 60-64),
  importa `urlHttpsSegura`, `LinkSegundaVia` chama `urlHttpsSegura(url)`.

**NÃO tocar:**
- `src/lib/utils/manifest.ts` — boolean guard, semântica diferente (fora de escopo).
- Os 6 callsites de imagem (`CardProduto`, `ProdutoModal`, `SecaoCatalogo`, `HeaderLoja`,
  `EtapaItens`, `ThumbProduto`) — continuam usando `fotoSegura` pelo nome de domínio.
- `components/ui/` (shadcn) — não aplicável aqui.

### Diff conceitual

```
+ src/lib/utils/urlHttpsSegura.ts
+   export function urlHttpsSegura(url?: string | null): string | null {
+     return url && url.startsWith("https://") ? url : null;
+   }

  src/lib/utils/fotoSegura.ts
+   import { urlHttpsSegura } from "./urlHttpsSegura";
    export function fotoSegura(url?: string | null): string | null {
-     return url && url.startsWith("https://") ? url : null;
+     return urlHttpsSegura(url);
    }

  src/components/painel/TabelaFaturas.tsx
+   import { urlHttpsSegura } from "@/lib/utils/urlHttpsSegura";
-   function urlSeguraFatura(url: string | null): string | null {
-     return url && url.startsWith("https://") ? url : null;
-   }
    function LinkSegundaVia({ url }) {
-     const href = urlSeguraFatura(url);
+     const href = urlHttpsSegura(url);
```

### Dependências Externas
Nenhuma. Refactor interno; sem novo pacote, sem API.

### O que testar
1. `urlHttpsSegura.test.ts` (novo) — matriz completa de bordas §15. Cobertura do helper.
2. `fotoSegura.test.ts` — continua **verde**; mantém casos de delegação (comportamento
   observável inalterado). Confirmar com `vitest run src/lib/utils/fotoSegura.test.ts`.
3. Suíte completa `vitest run` verde.
4. `npx next build` — garante que o novo import resolve (e que TabelaFaturas, Server
   Component, compila sem o helper local).
5. `grep -rn 'startsWith("https://")' src/` deve retornar só `manifest.ts:27` (boolean
   guard) e o comentário de teste — nenhuma cópia solta da **fórmula que retorna URL**.

### Ordem de Implementação
Issue **não crítica** (qualidade/DRY; o anti-XSS §15 já está garantido). Sem RED
obrigatório — implementar e rodar testes depois.
1. Criar `urlHttpsSegura.ts` (o core).
2. Criar `urlHttpsSegura.test.ts` (migrar a matriz de bordas).
3. `fotoSegura.ts` delega; enxugar `fotoSegura.test.ts` para casos de delegação.
4. `TabelaFaturas.tsx` importa core e remove `urlSeguraFatura`.
5. `vitest run` + `npx next build` + grep de verificação.
