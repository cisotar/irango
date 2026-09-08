## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado:**
- `src/app/globals.css` (`:root`) — fonte única dos tokens de cor. O ícone reusa exatamente os hex já definidos, sem inventar cor nova:
  - `--cor-primaria: #332616` (marrom espresso) → fundo do ícone **vitrine**
  - `--marrom-cafe: #2e2610` (marrom café / cor da sidebar do painel) → fundo do ícone **painel** (é a cor que o próprio painel usa na sidebar — `design-claude/painel/layout-painel.html` `--irango-sidebar`)
  - `--cor-destaque: #2d3a27` (verde militar) → acento do monograma (a "barra" do CTA)
  - `--branco: #ffffff` → cor do lettering
- `design-claude/landing.html` / `design-claude/foundations/cores.html` — identidade visual canônica. A marca iRango é um **wordmark**: "iRango" em maiúsculas, `font-weight: 900`, `letter-spacing`, branco sobre o marrom. Não há glyph/emoji de marca. Para um ícone quadrado de app, derivamos o **monograma "iR"** desse wordmark (mesma fonte do sistema, mesmo peso, mesmas cores) — não é marca nova, é a redução do wordmark já existente.
- `node_modules/sharp` — **já presente** como dependência transitiva do Next 16 (`require('sharp')` funciona; traz `librsvg 2.61` embutido). Rasteriza SVG→PNG nativamente. **Zero pacote novo a instalar.**

**O que precisa ser criado (e por quê não dá pra reusar):**
- Os 5 PNGs não existem (`public/` está vazio, sem `public/icons/`). Precisam ser gerados.
- Um script gerador `scripts/gerar-icones-pwa.mjs` — não existe util de geração de imagem no projeto; o script é one-shot de build de asset (roda na máquina do dev, não em runtime), versionado junto.

### Abordagem de Geração (sem pacote pesado)

**Decisão: SVG inline → `sharp` (já instalado) → PNG.** Justificativa:
- `sharp` já está em `node_modules` (transitive do Next), com `librsvg`. Não adiciona peso ao bundle nem ao `package.json` — é ferramenta de **dev-time**, o output (PNG) é o que vai pro repo.
- Alternativas descartadas: `canvas`/`node-canvas` (compila binário nativo pesado, dep nova); ImageMagick/`rsvg-convert` (não instalados no ambiente — `which` retornou vazio); `@vercel/og`/satori (overkill, dep nova).
- O SVG é definido **inline como string** no script (não há arquivo `.svg` de marca pra reaproveitar). Um único SVG parametrizado por `(corFundo, corAcento)` gera vitrine e painel — o monograma é o mesmo, só muda o fundo.

**O monograma (SVG):** quadrado `512x512`, cantos arredondados (`rx ~96`, ~18.75% — padrão de ícone de app), fundo = cor do contexto, monograma "iR" branco centralizado em `font-weight: 900` (família do sistema, igual ao wordmark), e a barra-acento em `--cor-destaque` (#2d3a27) como assinatura visual do iRango (o verde do CTA). Renderizar a partir do master 512 e redimensionar (downscale) para 192 e 180 dá nitidez melhor que renderizar cada tamanho do zero.

> Texto em SVG depende da fonte instalada no sistema do dev. Como a marca usa a stack `-apple-system/Segoe UI/Roboto/sans-serif` (genérica), o glyph "iR" pode variar levemente por máquina. Mitigação: usar `font-family="sans-serif"` + `font-weight="900"`; se a fidelidade precisar ser exata e reproduzível, desenhar o "iR" como **paths/`<path>`** no SVG (fora do escopo v1, mas anotado). Para v1 o texto renderizado pelo `librsvg` é aceitável (ícone de fallback genérico).

### Diferenciação visual vitrine vs painel

| Ícone | Fundo (hex / token) | Acento | Significado |
|-------|---------------------|--------|-------------|
| **vitrine** | `#332616` (`--cor-primaria`) | barra `#2d3a27` | marrom espresso = a "loja" pública (header/rodapé da vitrine) |
| **painel** | `#2e2610` (`--marrom-cafe`) | barra `#2d3a27` | marrom café mais escuro = a sidebar do painel (`--irango-sidebar`), sinaliza "área de gestão" |

São cores **adjacentes mas distintas** (#332616 vs #2e2610), exatamente como vitrine e painel já se distinguem no design system — coerente com a identidade, não duas marcas diferentes. Distinção reforçável com um sufixo/marca d'água "·" ou a inicial diferente se necessário, mas a cor de fundo já satisfaz o critério de aceite "os 4 ícones são distintos".

### Caminhos exatos dos arquivos (saída)

Exatamente como referenciado no spec (`/icons/vitrine-{192,512}.png`, `/icons/painel-{192,512}.png`, `apple-touch-icon`):

```
public/icons/vitrine-192.png        192x192  PNG  purpose: any
public/icons/vitrine-512.png        512x512  PNG  purpose: any
public/icons/painel-192.png         192x192  PNG  purpose: any
public/icons/painel-512.png         512x512  PNG  purpose: any
public/icons/apple-touch-icon.png   180x180  PNG  (iOS; usa o monograma vitrine sobre fundo opaco — iOS ignora alpha)
```

> `apple-touch-icon`: iOS aplica máscara/cantos próprios e **descarta transparência**, então o PNG precisa ter fundo opaco (já é o caso — fundo sólido). 180x180 é o tamanho de referência do iPhone moderno; um único arquivo basta para v1 (densidades extras são follow-up, já fora de escopo).

### Cenários

**Caminho feliz:**
1. Dev roda `node scripts/gerar-icones-pwa.mjs`.
2. Script monta o SVG master 512 para cada contexto (vitrine, painel) e renderiza via `sharp(Buffer.from(svg)).png()`.
3. Para cada contexto, grava `-512` (1:1) e `-192` (resize 192). Gera `apple-touch-icon.png` (resize 180 do master vitrine).
4. Os 5 PNGs aparecem em `public/icons/`, com dimensões corretas e abrem como imagem válida.

**Casos de borda:**
- `public/icons/` não existe → script faz `mkdir -p` (`fs.mkdirSync(..., { recursive: true })`) antes de escrever.
- `sharp` não requerível (ambiente sem o transitive) → script falha com mensagem clara ("sharp não encontrado; rode `pnpm install`"); como é dev-time, não afeta runtime.
- Fonte do sistema sem "iR" no peso 900 → `librsvg` cai no fallback sans-serif; aceitável (anotado acima).
- Rodar duas vezes → idempotente, sobrescreve os PNGs (output determinístico).

**Tratamento de erros:** script de dev-time — erro vai pro stdout/stderr com mensagem acionável. Nada de runtime, sem log de servidor envolvido (não há request).

### Schema de Banco
**N/A.** A issue não toca dados. Nenhuma migration, tabela, coluna ou RLS — confirmado pelo spec ("Nenhuma migration nova. Nenhuma tabela nova").

### Validação (zod)
**N/A.** Não há input de usuário nem Server Action. Asset estático.

### Recálculo no Servidor (valor monetário)
**N/A.** Sem valor monetário (preço/frete/desconto/total). `seguranca.md` §10 não se aplica — explicitado no spec.

### Regra cliente ↔ servidor

| Invariante | Camada | Observação |
|-----------|--------|------------|
| Servir os ícones | nenhuma lógica — arquivos estáticos em `/public`, servidos pelo Next como públicos imutáveis | sem RLS, sem auth, sem dado sensível (confirmado: §Segurança da issue e do spec) |

Não há regra de valor nem de permissão nesta issue. Os ícones são **fallback genérico do SaaS** (não pertencem a nenhuma loja), portanto públicos por design — nenhum vetor de isolamento de tenant. O isolamento de tenant do spec vive nas issues 002–003 (route handlers de manifest), fora desta.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `scripts/gerar-icones-pwa.mjs` — gerador one-shot SVG→PNG via `sharp`. Versionado para reprodutibilidade.
- `public/icons/vitrine-192.png`, `vitrine-512.png`, `painel-192.png`, `painel-512.png`, `apple-touch-icon.png` — output do script, commitados no repo (são o artefato consumido pelos manifests).

**Modificar:**
- Nenhum arquivo de código de aplicação. (Opcional: registrar `"icons:gerar": "node scripts/gerar-icones-pwa.mjs"` em `package.json` `scripts` — conveniência, não obrigatório.)

**NÃO tocar:**
- `src/app/globals.css` — apenas **ler** os tokens; não editar.
- `next.config.ts`, manifests, layouts, metadata — são as issues 002–005 (fora de escopo explícito).
- `src/components/ui/` (shadcn) — irrelevante aqui.

### Dependências Externas
- **`sharp` `^0.34`** — já instalado (transitive do Next 16). Doc: https://sharp.pixelplumbing.com/ . **Nada novo no `package.json`.**
- Nenhuma API externa, nenhuma key.

### Ordem de Implementação
Issue **não crítica** (`crítica: NÃO`) — sem TDD red-first. Não há lógica de runtime a testar; a verificação é por inspeção do output (dimensões + "abre como imagem").

1. Confirmar `require('sharp')` resolve no ambiente (`node -e "require('sharp')"`).
2. Escrever `scripts/gerar-icones-pwa.mjs` com o SVG master parametrizado e os 5 writes.
3. Rodar o script; `mkdir -p public/icons` é feito por ele.
4. Verificar dimensões: `sharp(arquivo).metadata()` ou `file public/icons/*.png` — checar 192/512/180 e que abrem.
5. Commitar script + os 5 PNGs.
