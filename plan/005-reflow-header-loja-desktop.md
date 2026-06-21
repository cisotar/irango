## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (inalterado):**
- `src/components/vitrine/HeaderLoja.tsx` — a banda full-bleed (`<header bg-[var(--cor-primaria)]>`, sem `max-w`) já ocupa 100% da largura; só o **container interno** (`<div className="mx-auto flex max-w-3xl ...">`, linha 49) limita o conteúdo. A mudança é nesse único `className`.
- `src/components/vitrine/BadgeStatus.tsx` — **NÃO tocar**. Cores de sistema, tipografia e ícone permanecem (invariante §15/§63). Renderizado dentro do header sem alteração.
- `HeaderLoja.test.tsx` — **NÃO tocar**. Os testes asseguram `logoSeguro`, fallback de logo, anti-XSS e estrutura (`<h1>`, `wa.me`). Nenhuma asserção depende de `max-w-3xl`, então continuam verdes após a troca de className.
- Escada de largura canônica `max-w-3xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl` — **já definida pelo plano da issue 002** (`plan/002`, sites `page.tsx:101/185` e `VitrineClient.tsx:51`). Esta issue **reusa a mesma escada**, não inventa outra — é o que garante o alinhamento header ↔ catálogo ↔ barra fixa em cada breakpoint.
- Utilities Tailwind v4 padrão (`max-w-*`, `mx-auto`, breakpoints `md`/`lg`/`xl` 768/1024/1280). Zero CSS artesanal, zero lib nova, sem `tailwind.config.ts` (tokens em `globals.css @theme`).

**O que precisa mudar:** apenas a string `max-w-3xl` → escada, em **1 linha de 1 arquivo**. Nada novo a criar.

**Dependência confirmada [002]:** em `page.tsx` os dois `<main>` ainda estão `max-w-3xl` (002 planejada, não implementada). O `HeaderLoja` é **irmão acima** do `<main>` (linhas 94/101 e 177/185), não filho — então a banda colorida permanece full-bleed e só o conteúdo interno precisa da mesma escada para alinhar verticalmente com o catálogo quando 002 alargar os `<main>`. Aplicar a escada idêntica aqui mantém o alinhamento independentemente da ordem em que 002 e 005 forem mergeadas.

### Cenários

**Caminho Feliz:**
1. `< md` (mobile) → conteúdo do header em `max-w-3xl` centralizado — **idêntico ao atual**, mobile inalterado.
2. `md` (≥768px) → conteúdo cresce para `max-w-5xl`, alinhando com o catálogo de 3 colunas abaixo.
3. `lg` (≥1024px) → `max-w-6xl`.
4. `xl` (≥1280px) → `max-w-7xl`, alinhado ao grid de 4 colunas.
Em todos os passos: logo 80px, `<h1>` `text-2xl uppercase`, `BadgeStatus` e link WhatsApp **inalterados** — só o container que os agrupa muda de largura máxima.

**Casos de Borda:**
- Sem logo (`logoSeguro` → null) → fallback de letra segue dentro do container largo, centralizado; sem regressão.
- `logo_url` insegura (http/javascript/data) → fallback; comportamento anti-XSS preservado (§15), não afetado pela mudança de largura.
- Sem WhatsApp → bloco de contato ausente; container apenas mais estreito em altura, sem impacto.
- Nome muito longo → `min-w-0` no bloco de texto já permite truncamento/quebra; container mais largo no desktop dá **mais** espaço, reduzindo quebra (melhora, não regressão).
- Loja inativa / assinatura inválida → o header do gate (`page.tsx:177`) usa o mesmo componente, então recebe a escada automaticamente e não destoa do `<main>` do gate.

**Tratamento de Erros:** nenhum caminho de erro novo. Mudança puramente declarativa de CSS — sem I/O, sem try/catch, sem mensagem ao usuário nem log de servidor (`seguranca.md` §14 não se aplica).

### Schema de Banco
Não se aplica — nenhuma tabela, coluna, migration ou RLS. Reflow 100% de apresentação (spec §145).

### Validação (zod)
Não se aplica — sem input, sem form, sem payload.

### Recálculo no Servidor
Não se aplica — nenhum valor monetário neste componente. `logo_url`/`whatsapp` são exibição. O guard anti-XSS `logoSeguro` (`url.startsWith("https://")`, `seguranca.md` §15) é mantido **sem alteração**.

### Regra cliente ↔ servidor
Nenhuma regra de valor, permissão ou acesso introduzida ou alterada. O único enforcement de segurança presente — `logoSeguro` rejeitando protocolos não-`https://` no client de renderização — permanece intacto. A mudança é em arquivo `'use client'`, mas **somente em className**, sem mover lógica de camada. RLS pública de catálogo não tocada.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar (1 arquivo, 1 linha):**
- `src/components/vitrine/HeaderLoja.tsx` (linha 49): `mx-auto flex max-w-3xl items-center justify-center gap-4` → `mx-auto flex max-w-3xl items-center justify-center gap-4 md:max-w-5xl lg:max-w-6xl xl:max-w-7xl`. Mantém `mx-auto`, `flex`, alinhamentos e `gap-4`. A banda `<header>` (linha 48) **não muda** — permanece full-bleed na cor da loja.

**NÃO tocar:**
- `BadgeStatus.tsx` — invariante §15/§63; cores, tipografia e ícone inalterados.
- `HeaderLoja.test.tsx` — deve continuar verde sem edição (nenhuma asserção depende da largura).
- `components/ui/` (shadcn) — nunca editado à mão.
- `page.tsx` / `VitrineClient.tsx` — escada da issue 002, fora do escopo desta issue.
- Tokens/tipografia/logo (80px)/`text-2xl` — invariante §182/§183 (só reorganizar largura, não redesenhar a banda).

### Dependências Externas
Nenhuma. Só utilities Tailwind v4 já presentes. Docs de referência: Tailwind responsive design (`https://tailwindcss.com/docs/responsive-design`).

### Ordem de Implementação
Issue **não crítica** (sem dinheiro/RLS/auth/cupom/token) — não exige fase RED de `tdd`. A suíte `HeaderLoja.test.tsx` existente é a rede de segurança.
1. Aplicar a escada de largura na linha 49 de `HeaderLoja.tsx`.
2. Rodar `HeaderLoja.test.tsx` → deve continuar verde sem alteração.
3. Verificação visual (`/verificar`) nos breakpoints `< md` / `md` / `lg` / `xl`: mobile idêntico; conteúdo do header alinhado ao container do catálogo em cada largura; banda colorida full-bleed; logo, `<h1>`, `BadgeStatus` e WhatsApp inalterados.
