## Plano Técnico

### Análise do Codebase
O que já existe e será reusado:
- `next.config.ts` — único arquivo de config (não há `.js`/`.mjs`). Define `nextConfig: NextConfig` com `async headers()` (securityHeaders + CSP report-only, §11 seguranca.md) e exporta via `withSentryConfig(nextConfig, {...})`. **A mudança apenas adiciona a chave `experimental` ao objeto `nextConfig`; nada de novo arquivo, nada de nova lib.**
- Não há reuso em `lib/` aplicável — config de framework é declarativa, não há util/query/validação envolvida. A regra de tamanho real (2MB + magic bytes) já vive na Server Action (issue 075) e no bucket (issue 073); este teto é só rede.

### Versão e sintaxe correta (Next 16.2.9)
Verificado em `node_modules/next/dist/server/config-shared.d.ts`:
- Linha 653: `serverActions?: { bodySizeLimit?: SizeLimit; allowedOrigins?: string[] }` está dentro da interface `experimental`.
- Linha 1474: o `Pick<...experimental...>` lista `'serverActions'` — confirma que, nesta versão, a chave é **`experimental.serverActions.bodySizeLimit`** (não top-level).
- `SizeLimit` aceita string como `'2mb'`.
- Conclusão: a forma do issue está correta — `experimental: { serverActions: { bodySizeLimit: '2mb' } }`. **Não usar a forma top-level `serverActions`** (não existe nesta versão).

### Cenários
**Caminho Feliz:**
1. Cliente envia foto <2MB (pós crop/redução, tipicamente <500KB) na Server Action `enviarFotoProduto`.
2. O body passa pelo teto do Next (2MB) sem rejeição prematura.
3. A validação autoritativa (tamanho + magic bytes) roda na Server Action (075).

**Casos de Borda:**
- Payload >2MB (cliente adulterado / crop falhou): o Next rejeita na borda com erro de body size — esperado e desejável (defesa-em-profundidade). A mensagem de erro do usuário continua sob nosso controle no fluxo normal porque payloads legítimos ficam muito abaixo do teto.
- Config inválida / chave errada: `npm run build`/dev emitiria warning. Mitigado por usar a chave verificada nos tipos.
- Sentry sem `SENTRY_AUTH_TOKEN` (dev): inalterado — `withSentryConfig` continua envolvendo o `nextConfig` já estendido; `sourcemaps.disable`/`silent` preservados.

**Tratamento de Erros:** não há código de runtime novo; nenhum erro a logar. A rejeição por body size é tratada pelo Next; a mensagem ao usuário vem do fluxo da Server Action (075), não desta issue.

### Schema de Banco
Não toca dados. Sem tabela, sem RLS, sem migration.

### Validação (zod)
Não aplicável. Config declarativa de framework — sem input de usuário a validar aqui. A validação zod do upload vive em `src/lib/validacoes/storage.ts` (issues 073/075), fora do escopo.

### Recálculo no Servidor
Não há valor monetário. O teto de 2MB é controle de rede (defesa-em-profundidade), não autoridade de negócio. A autoridade sobre o arquivo (tamanho exato, tipo via magic bytes, escopo de loja) permanece na Server Action (075) e nas políticas do bucket (073).

### Camada de garantia (cliente ↔ servidor)
| Invariante | Onde é garantida |
|-----------|------------------|
| Teto bruto de body de Server Action | `next.config.ts` (esta issue) — borda do Next, servidor |
| Tamanho real ≤ 2MB + tipo (magic bytes) | Server Action `enviarFotoProduto` (issue 075) — autoritativo |
| Limite de objeto/MIME no Storage | Políticas do bucket (issue 073) |
Sem regra de valor/permissão nesta issue, logo sem RLS/recálculo. Enforcement server-side da invariante de tamanho real está coberto fora desta issue (075/073), e este teto é a camada adicional de rede.

### Arquivos a Criar / Modificar / NÃO tocar
- **Modificar:** `next.config.ts` — adicionar a chave `experimental.serverActions.bodySizeLimit` ao objeto `nextConfig`. Único arquivo tocado.
- **NÃO tocar:** `securityHeaders`, `cspReportOnly`, `async headers()`, o bloco `withSentryConfig(...)` e suas opções (`sourcemaps`, `silent`, `telemetry`, `widenClientFileUpload`). A edição é puramente aditiva.
- **NÃO criar:** nenhum arquivo novo. Não há `.js`/`.mjs` concorrente para criar.

### Diff exato a aplicar
Inserir a chave `experimental` no objeto `nextConfig`. Substituir:

```ts
const nextConfig: NextConfig = {
  async headers() {
```
por:
```ts
const nextConfig: NextConfig = {
  // Teto bruto de body de Server Actions (rede/defesa-em-profundidade).
  // Alinha com o limite de 2MB da Server Action de upload (issue 075);
  // a validação autoritativa (tamanho + magic bytes) continua na action/bucket.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
```
O restante do arquivo permanece idêntico.

### Dependências Externas
Nenhuma nova. Usa apenas a config nativa do `next@16.2.9` já instalado.
Doc: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions (campo `bodySizeLimit`).

### Ordem de Implementação
Issue **não-crítica** (sem dinheiro, RLS, cupom, token de pedido ou autorização) — sem fase RED obrigatória.
1. Aplicar o diff aditivo em `next.config.ts`.
2. Rodar `npm run build` (ou `npm run dev`) e confirmar que sobe sem warning de config inválida e que `headers`/CSP/Sentry seguem intactos.
3. (Opcional) `curl`/teste manual de payload >2MB para observar a rejeição na borda — não obrigatório.
