## Plano Técnico

> **Achado-chave:** A issue 060 já foi implementada no commit `2761c2a feat(painel): navegação, dashboard, gestão de pedidos e configurações (039-050,060)`. As duas páginas, o componente e o link de navegação existem e estão corretos. O escopo real desta issue passa a ser **verificação + cobertura de teste**, não construção. Abaixo o inventário do que já existe, a auditoria de invariantes e a única lacuna pendente (testes).

### Análise do Codebase

**O que JÁ existe e atende ao escopo (reuso total — nada a criar):**

- `src/app/(painel)/painel/configuracoes/assinatura/page.tsx` — Server Component read-only. Lê `buscarLojaDoDono(supabase)` (client autenticado, RLS) e renderiza `<CardStatusAssinatura>`. Sem mutation. **Já existe e correto.**
- `src/app/(painel)/painel/assinatura-bloqueada/page.tsx` — Server Component read-only de reativação. Mesmo card + cabeçalho "Sua loja está fora do ar". **Já existe e correto.**
- `src/components/painel/StatusAssinatura.tsx` — exporta `CardStatusAssinatura` e `BotaoGerenciarHotmart`. Reusa shadcn `Card`/`Badge`/`Button`/`Separator`, o ícone `ExternalLink` (lucide), e o union `StatusAssinatura` de `lib/utils/assinatura.ts` (NÃO recria a regra). Mapeia rótulo PT e variante de badge por status; trial mostra dias restantes; inadimplente/suspensa mostram aviso de ação. **Já existe e correto.**
- `src/lib/supabase/queries/lojas.ts` → `buscarLojaDoDono` retorna `LojaCompleta` (`select *` na tabela `lojas`), que **inclui** `assinatura_status`, `assinatura_inicio`, `assinatura_fim_periodo`, `hotmart_subscriber_code` (confirmado em `database.types.ts:337-354`). **Nada falta na query — reuso direto, sem alteração.**
- `src/lib/utils/acessoPainel.ts` → `ROTAS_EXCECAO_ASSINATURA` já contém **ambas** as rotas: `/painel/assinatura-bloqueada` e `/painel/configuracoes/assinatura`. O guard (`layout.tsx`) devolve `"ok"` quando a rota casa o prefixo, mesmo com assinatura inválida (anti-loop). **Exceção de rota já implementada.**
- `src/components/painel/NavPainel.tsx:57` — link "Assinatura" → `/painel/configuracoes/assinatura` já no menu de Configurações.
- `src/lib/utils/formatarMoeda.ts` → `formatarMoeda` (Intl BRL) existe; **não é usado nesta tela** (não há valor monetário a exibir — só datas e status). Formatação de data é via `toLocaleDateString("pt-BR")` inline no componente (`formatarData`), padrão coerente com o resto do código.

**Conclusão de reuso:** nenhum arquivo novo de produção é necessário. Tudo que a issue pede já reusa libs maduras (Intl) e shadcn/ui. Não há duplicação a corrigir.

### Cenários

**Caminho feliz:**
1. Lojista autenticado com assinatura válida acessa `/painel/configuracoes/assinatura`.
2. Guard (`layout.tsx`) → `decidirAcessoPainel` → `"ok"`; renderiza o layout do painel.
3. Página chama `buscarLojaDoDono` (RLS escopa ao `dono_id`); recebe a própria loja.
4. `CardStatusAssinatura` exibe badge do status, início e período vigente formatados, e (se houver) o `hotmart_subscriber_code`.
5. Lojista clica "Gerenciar pagamento na Hotmart" → abre `https://consumer.hotmart.com/` em nova aba (`target="_blank" rel="noopener noreferrer"`). Nenhuma mutation no iRango.

**Fluxo de bloqueio:** lojista com assinatura inválida tenta `/painel/produtos` → guard redireciona p/ `/painel/assinatura-bloqueada`. Essa rota está na exceção, então renderiza (não entra em loop). Mostra status + botão Hotmart.

**Casos de borda:**
- **`loja == null`** (sem loja): as páginas fazem `redirect("/painel/onboarding")`. Na prática **inalcançável** — o guard do layout auto-cura o user órfão e redireciona p/ `/painel` antes de qualquer page renderizar. (Ver Risco 1.)
- **Status fora do union** (dado não-confiável do banco): `ehStatusConhecido` retorna `false` → rótulo "Desconhecida", variante `outline`, sem aviso de ação. Fail-safe de apresentação.
- **`assinatura_inicio` / `fimPeriodo` null ou data inválida**: `formatarData` retorna `"—"`. `diasRestantes` retorna `0`.
- **`hotmart_subscriber_code` null**: a linha do código do assinante simplesmente não renderiza.
- **Falha de rede / erro PostgREST**: `buscarLojaDoDono` propaga o `error`; a page lança; o error boundary do painel trata. Sem vazamento de detalhe (seguranca.md §14).

**Tratamento de erros:** mensagens ao usuário são genéricas e orientadoras ("Regularize na Hotmart..."); nenhum detalhe técnico exposto. Erros de I/O propagam e são logados server-side, nunca renderizados.

### Schema de Banco
**Nenhuma mudança de schema.** Os campos `assinatura_*` e `hotmart_subscriber_code` já existem na tabela `lojas`.

**RLS (já existente, suficiente — `20260614001000_rls_lojas.sql`):**
- **Leitura:** `lojas_leitura_propria` (`SELECT using auth.uid() = dono_id`) — garante que o lojista só lê a própria loja. ✔
- **Escrita de assinatura:** a tela é read-only e **não dispara nenhuma Server Action**. O UPDATE de `assinatura_*` acontece só pelo webhook Hotmart (057) via `service_role`. RN-A5 satisfeita pela **ausência de mutation** + gate de colunas na action de perfil (que não escreve `assinatura_*`). ✔

### Validação (zod)
**Nenhuma.** Não há input do usuário nesta tela (read-only). Sem form, sem Server Action, sem schema.

### Recálculo no Servidor (valor monetário)
**Não se aplica.** A tela não exibe nem processa valor monetário — apenas status e datas, lidos diretamente do banco sob RLS. Não há subtotal/frete/desconto/total.

### Regra cliente ↔ servidor
| Invariante | Onde é garantida | Status |
|-----------|------------------|--------|
| Lojista só vê a própria assinatura | RLS `lojas_leitura_propria` (SELECT) | ✔ existente |
| Tela não altera status/datas (RN-A5) | Ausência de Server Action + UPDATE de billing só por service_role (webhook 057) | ✔ existente |
| `/painel/assinatura-bloqueada` acessível com assinatura inválida | `ROTAS_EXCECAO_ASSINATURA` em `acessoPainel.ts` | ✔ existente |
| `hotmart_subscriber_code` exibido só ao dono | RLS de leitura própria | ✔ existente |

Não há regra de valor/permissão sem enforcement server-side. Plano completo nesse eixo.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/components/painel/StatusAssinatura.test.tsx` — cobertura do componente (único trabalho pendente). Casos: cada status (rótulo + variante de badge corretos), status desconhecido → "Desconhecida"/`outline`, datas null → "—", trial com `dias > 0` e `dias == 0`, `subscriberCode` null oculta a linha, `BotaoGerenciarHotmart` aponta p/ a URL com `target="_blank"` + `rel` contendo `noopener`.

**NÃO tocar (já corretos):**
- `src/app/(painel)/painel/configuracoes/assinatura/page.tsx`
- `src/app/(painel)/painel/assinatura-bloqueada/page.tsx`
- `src/components/painel/StatusAssinatura.tsx`
- `src/lib/supabase/queries/lojas.ts` (`buscarLojaDoDono` já basta)
- `src/lib/utils/acessoPainel.ts` (exceções já presentes)
- `src/components/painel/NavPainel.tsx` (link já presente)
- `src/components/ui/*` (shadcn — nunca editar à mão)
- migrations de `lojas` / RLS (já suficientes)

**Avaliar (não bloqueia 060 — Risco 1):**
- `redirect("/painel/onboarding")` para rota inexistente — padrão sistêmico em ~10 pages do painel, fora do escopo de 060. Tratar numa issue de saneamento à parte, não aqui.

### Dependências Externas
- **Portal do assinante Hotmart:** `https://consumer.hotmart.com/` (hardcoded em `StatusAssinatura.tsx:12`). É a área do assinante onde o comprador gerencia/cancela a assinatura. **TODO de produto:** confirmar com a doc/conta Hotmart se essa é a URL canônica do portal (vs. um deep-link específico do produto). Não bloqueia — é uma constante trivial de ajustar. Doc: https://help.hotmart.com (Área do Assinante / Minhas Compras).
- `lucide-react` (`ExternalLink`) e shadcn/base-ui — já no `package.json`.

### Ordem de Implementação
Issue **não crítica** (read-only, sem dinheiro/permissão mutável) → **sem TDD red-first**. Como o código de produção já existe e está correto, a ordem é:

1. **Verificar** o comportamento real das duas rotas no app rodando (status válido → `/painel/configuracoes/assinatura`; status inválido → `/painel/assinatura-bloqueada`; botão abre nova aba). → `/verify`.
2. **Cobertura** (`/testar`): criar `StatusAssinatura.test.tsx` cobrindo os cenários acima. Teste vem **depois** do código (não é red-first).
3. (Fora de 060) Confirmar a URL do portal Hotmart com produto.
