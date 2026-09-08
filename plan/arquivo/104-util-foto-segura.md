## Plano Técnico

### Análise do Codebase

**Padrão de util já estabelecido (reusar a forma, não recriar):**
- `src/lib/utils/formatarMoeda.ts` / `haversine.ts` — função PURA de apresentação, doc-comment no topo, **named export**, teste co-localizado `*.test.ts`, importada via alias `@/lib/utils/...`. `fotoSegura` segue exatamente esse molde (pura, determinística, sem I/O).
- `src/lib/utils/formatarMoeda.test.ts` — modelo de teste: `import { describe, expect, it } from "vitest"`, import relativo `./fotoSegura`, runner `vitest run` (script `test` no `package.json`). Sem `vi.mock` — função pura.
- Alias `@/* → ./src/*` confirmado em `tsconfig.json` (paths).

**A invariante já existe (será unificada), em 5 cópias inline divergentes** — `grep -rn` confirmou:
| Arquivo | Símbolo | Assinatura / retorno | Semântica |
|---|---|---|---|
| `src/components/vitrine/CardProduto.tsx:20` | `fotoSegura` | `(url?: string \| null): string \| null` | imagem |
| `src/components/vitrine/SecaoCatalogo.tsx:47` | `fotoSegura` | `(url: string \| null): string \| undefined` | imagem |
| `src/components/vitrine/ProdutoModal.tsx:48` | `fotoSegura` | `(url: string \| null): string \| null` | imagem |
| `src/components/vitrine/HeaderLoja.tsx:19` | `logoSeguro` | `(url?: string): string \| null` | imagem (logo) |
| `src/components/painel/TabelaFaturas.tsx:63` | `urlSeguraFatura` | `(url: string \| null): string \| null` | **link href**, não imagem |

Predicado idêntico em todas: `url && url.startsWith("https://") ? url : <vazio>`.

**Decisão de escopo:** a issue 104 escopa apenas `CardProduto` e `SecaoCatalogo`. As outras 3 cópias **ficam fora desta issue** (não estão no escopo declarado e duas têm nome/semântica distintos — `logoSeguro` para logo, `urlSeguraFatura` para link de fatura). Porém, criar o util único agora abre o caminho para folddá-las depois sem 6ª cópia. Registrar como débito:
- `ProdutoModal.tsx:48` — cópia idêntica de imagem; candidata óbvia a migrar (faz parte da vitrine, mesmo predicado e mesmo retorno `string | null`). **Recomendado migrar junto** se a revisão aceitar pequeno alargamento de escopo; caso contrário, issue de follow-up.
- `HeaderLoja.logoSeguro` e `TabelaFaturas.urlSeguraFatura` — **não tocar nesta issue** (nomes/domínios distintos; `urlSeguraFatura` é href, não `src` de `<img>`). Débito separado.

### Cenários

**Caminho Feliz:**
1. `fotoSegura("https://cdn.x/p.jpg")` → `"https://cdn.x/p.jpg"`.
2. `CardProduto` importa o util, `const foto = fotoSegura(fotoUrl)`; `foto` truthy → renderiza `<Image src={foto}>`; falsy → placeholder gradiente. Comportamento idêntico ao atual.
3. `SecaoCatalogo` importa o util; no ponto de uso (`confirmarAdicao`, prop `fotoUrl?: string | undefined` do carrinho) usa `fotoSegura(produtoSelecionado.fotoUrl) ?? undefined`. Render e payload do carrinho inalterados.

**Casos de Borda (todos → `null`):** `http://...`, `javascript:alert(1)`, `data:text/html,...`, `HTTPS://...` (maiúsculas — `startsWith` é case-sensitive, então **bloqueia**: comportamento atual preservado), `//cdn/x` (protocol-relative), `/caminho/relativo`, `ftp://`, string vazia `""`, `null`, `undefined` (arg omitido), só-espaços `"   "`. Edge sutil: `"https://"` puro (sem host) passa o `startsWith` → retorna a string; isso já é o comportamento atual das 5 cópias, **mantido** (não é regressão; `next/image` lida e o §15 só exige bloquear protocolo perigoso).

**Tratamento de Erros:** função pura, sem throw, sem I/O — não há erro de runtime a tratar. A "falha" é silenciosa por design (URL insegura vira placeholder). Nada vai para log.

### Schema de Banco
Não se aplica — função pura de apresentação, sem dados, sem RLS, sem migration.

### Validação (zod)
Não se aplica — não é validação de input de formulário/Server Action; é um guard de apresentação anti-XSS. zod seria over-engineering para um predicado `startsWith`. (Documentar essa decisão evita a tentação de criar schema.)

### Recálculo no Servidor
Não há valor monetário. **Camada de garantia da invariante anti-XSS:** esta é uma defesa de *apresentação* no cliente (impede `javascript:`/`data:` de virar `src`). O dado `foto_url` vem do banco preenchido por lojista (não confiável, §15). O util roda no client porque os 3 componentes são `'use client'`; isso é aceitável porque o atacante que controla `foto_url` já controlaria o próprio render — o ganho é impedir XSS refletido via protocolo. Não há decisão de valor/permissão aqui, então não há enforcement server-side a exigir. (Mapeamento explícito conforme a regra cliente↔servidor: invariante = sanitização de apresentação, garantida na borda de render.)

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/utils/fotoSegura.test.ts` — **RED primeiro** (issue crítica). Cobre: `https://` válido → retorna URL; `http://`, `javascript:`, `data:`, `//cdn`, `/rel`, `ftp://`, `""`, `"   "`, `null`, `undefined` → `null`; case-sensitivity (`HTTPS://` → `null`). Espelha o estilo de `formatarMoeda.test.ts`.
- `src/lib/utils/fotoSegura.ts` — `export function fotoSegura(url?: string | null): string | null` com doc-comment citando §15. Implementação: `return url && url.startsWith("https://") ? url : null;` (o `&&` já trata `null`/`undefined`/`""`).

**Modificar:**
- `src/components/vitrine/CardProduto.tsx` — remover a função inline (linhas 19-22), adicionar `import { fotoSegura } from "@/lib/utils/fotoSegura";`. Uso em `:38` inalterado (já espera `null`).
- `src/components/vitrine/SecaoCatalogo.tsx` — remover a função inline (linhas 46-49), adicionar o import. No ponto de uso `:93`, trocar `fotoSegura(produtoSelecionado.fotoUrl)` por `fotoSegura(produtoSelecionado.fotoUrl) ?? undefined` (a prop `fotoUrl` do item de carrinho exige `string | undefined`; o `?? undefined` reconcilia `null → undefined` sem mudar render).

**NÃO tocar:**
- `src/components/vitrine/ProdutoModal.tsx`, `src/components/vitrine/HeaderLoja.tsx`, `src/components/painel/TabelaFaturas.tsx` — fora do escopo desta issue (ver Análise do Codebase / débito). Migração futura, não aqui.
- `components/ui/` (shadcn) — não se edita à mão (não envolvido).

### Dependências Externas
Nenhuma. Lib madura não se aplica: é `String.prototype.startsWith` nativo. (URL parsing via `new URL()` foi considerado e descartado — `startsWith("https://")` é mais restritivo e é exatamente o comportamento atual a preservar; trocar para `new URL()` mudaria semântica e seria uma regressão potencial.)

### Ordem de Implementação (crítica → RED primeiro)
1. **RED (`/tdd`):** escrever `src/lib/utils/fotoSegura.test.ts` importando de `./fotoSegura` (ainda inexistente). Rodar `vitest run` e confirmar falha real (módulo não encontrado / asserts falhando). PARAR.
2. **GREEN (`/execute`):** criar `src/lib/utils/fotoSegura.ts`; `vitest run` verde.
3. Refatorar `CardProduto.tsx` (import + remover inline).
4. Refatorar `SecaoCatalogo.tsx` (import + remover inline + `?? undefined` em `:93`).
5. `grep -rn "function fotoSegura" src/components/vitrine` → só ProdutoModal pode restar (fora de escopo); CardProduto/SecaoCatalogo limpos.
6. `next build` (memória: const exportada de Server Action quebra só no build — aqui não há `'use server'`, mas rodar mesmo assim valida tipos do refactor) + `vitest run` completos.
