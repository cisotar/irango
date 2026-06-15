## Plano Técnico

### Diagnóstico — o bug real é maior que o descrito

A issue fala em "user órfão raro". A exploração do código revelou um bug **garantido, não raro**:

- `decidirAcessoPainel` (`src/lib/utils/acessoPainel.ts:84-86`) já decide `loja === null → "onboarding"`.
- `PainelLayout` (`src/app/(painel)/painel/layout.tsx:47-48`) e **9 outras páginas/actions** do painel fazem `redirect("/painel/onboarding")`.
- **A rota `/painel/onboarding` NÃO existe.** Qualquer órfão que chega no painel cai em redirect para uma rota inexistente → 404 dentro do layout do painel / loop. Hoje não há nenhuma auto-cura: o destino do órfão é um beco sem saída.

Portanto o escopo correto fecha duas frentes:
1. **Eliminar a janela de criação do órfão** (causa raiz) — trigger atômico `on auth.users`.
2. **Curar o órfão que já existe** (legado + qualquer falha residual) — auto-cura idempotente no guard, substituindo o redirect para a rota fantasma.

### Decisão de arquitetura: trigger SQL **E** auto-cura no guard (não "ou")

A issue pede para escolher entre trigger e lógica na action. A resposta correta é **trigger como garantia primária + auto-cura como rede de segurança**, porque resolvem problemas diferentes:

| Mecanismo | Resolve | Limitação isolada |
|-----------|---------|-------------------|
| Trigger `AFTER INSERT on auth.users` | Janela de órfão **nunca abre** — user + loja na mesma transação do GoTrue. Atômico de verdade (sem compensação não-transacional). | Não cura órfãos **já existentes** (legado da 015). |
| Auto-cura no guard | Cura órfão **já existente** no próximo acesso ao painel. | Sozinha, deixa a janela aberta entre signUp e a 1ª visita ao painel; e duplica lógica se a action continuar criando loja. |

Com o trigger, a criação de loja **sai da Server Action `cadastrar`** (deixa de ser responsabilidade do app) — fim da compensação `deleteUser` não-transacional, que é a origem do órfão (`auth.ts:130-134`). A auto-cura vira rede de segurança que, em regime permanente, quase nunca dispara (só para os órfãos legados e para o caso teórico do trigger falhar).

**Trade-off de duplicação de lógica (consentimento/trial/slug):** a lógica passa a viver **só no trigger SQL** (fonte única). A auto-cura no guard NÃO reimplementa: ela apenas **chama a mesma função SQL** do trigger via RPC (`public.garantir_loja_do_dono()`), de modo que existe **uma só** implementação de "como nasce uma loja". Sem isso, teríamos a regra em TS (action) e em SQL (trigger) — violação de DRY e risco de divergência de trial/consentimento.

### Análise do Codebase

O que já existe e será reusado:
- `src/lib/utils/acessoPainel.ts` — `decidirAcessoPainel` já tem o branch `loja === null → "onboarding"`. **Reusado**; muda-se o destino de "rota fantasma" para "auto-cura then retry".
- `src/app/(painel)/painel/layout.tsx` — guard único do painel. Ponto de enganche da auto-cura (antes de aplicar a decisão).
- `src/lib/supabase/queries/lojas.ts` — `buscarLojaDoDono` (detecção), `criarLoja`, `slugExiste`, `contarLojasDoDono`. A auto-cura **não** chama `criarLoja` diretamente (ver decisão acima); chama a nova RPC. `buscarLojaDoDono` é reusado para detectar e para reler após cura.
- `src/lib/supabase/service.ts` — `createServiceClient()` (server-only) para invocar a RPC de cura fora do contexto de RLS.
- `src/lib/constants/termos.ts` — `VERSAO_TERMOS` ("2026-06-13"). A versão de consentimento passa a ser **parâmetro da RPC** (o app injeta `VERSAO_TERMOS`), mantendo a fonte única em TS e evitando hardcode de versão dentro do SQL.
- `src/lib/validacoes/loja.ts` — `sanitizarSlug`. A lógica de slug do trigger replica a mesma regra `[a-z0-9-]`, sufixo `-2`, `-3`… A regex do banco (`lojas_slug_formato` CHECK) já é a guarda final.
- `supabase/migrations/20260614004500_lojas_protege_billing.sql` — padrão de função `plpgsql` + checagem de `current_user`. O trigger e a função de cura **rodam como definer/postgres**, logo passam pelo gate de billing (escrevem `assinatura_status`, `assinatura_fim_periodo`).
- `supabase/migrations/20260614003500_unique_loja_por_dono.sql` — índice `lojas_dono_unico ON lojas(dono_id)`. **É a trava de race condition** (RN-01) — duas inserções simultâneas → a 2ª pega `23505`, tratada como no-op idempotente.
- `src/lib/assinatura/reconciliar.ts` — `reconciliarAssinatura` (eventos Hotmart órfãos). **Não muda**; continua sendo chamada no fluxo de confirmação de email (task 066), independente desta issue.

O que precisa ser criado:
- A rota `/painel/onboarding` **deixa de ser necessária como tela** — o órfão é curado e segue para `/painel`. (Decisão abaixo em "Onboarding".)

### Respostas às questões da issue

1. **Onde detectar o órfão?** Em **ambos**, com papéis distintos: o **trigger** garante que o órfão não nasça (não é "detecção", é prevenção); a **auto-cura no guard** (`PainelLayout`) detecta e cura o legado. NÃO no callback de login (`auth/callback/route.ts`) — o callback é genérico (OAuth + confirmação) e o guard do painel é o único ponto autoritativo que já roda `buscarLojaDoDono` em toda request do painel. Curar no guard evita duplicar a checagem.

2. **Auto-cura chama `criarLoja`?** Não diretamente. Chama a RPC `public.garantir_loja_do_dono(p_versao_termos text)` (mesma função do trigger) via `service_role`. Fonte única de "como nasce a loja".

3. **Dados da loja (nome/slug):** iguais ao cadastro atual (`auth.ts:81,87-99`): `nome = ''` (nasce vazio, lojista preenche no perfil), `slug` derivado de `email.split('@')[0]` sanitizado, com sufixo numérico até livre; fallback `loja-<8hex>` se a base for curta/colidir. O cadastro original **não guardava** nome/slug em lugar nenhum além da própria loja — então não há "dado perdido a recuperar"; a loja sempre nasceu com nome vazio. A auto-cura reproduz exatamente isso.

4. **Consentimento/trial na auto-cura:** SIM, idênticos ao cadastro — `consentimento_em = now()`, `consentimento_versao = VERSAO_TERMOS`, `assinatura_status = 'trial'`, `assinatura_fim_periodo = now() + 14 dias`. Gravados **server-side** dentro da RPC (nunca do cliente). Nota de produto: o órfão que faz login já provou posse do email (login exige senha); o consentimento foi aceito no cadastro original (signUp só ocorreu com `aceiteTermos=true` validado em `schemaCadastro`). Logo registrar consentimento na cura é fiel ao aceite original.

5. **Race condition (dois logins simultâneos do mesmo órfão):** resolvida no banco pelo índice único `lojas_dono_unico ON lojas(dono_id)`. A RPC faz `INSERT … ON CONFLICT (dono_id) DO NOTHING RETURNING` (ou trata `23505`): a 2ª inserção concorrente é no-op idempotente; ambos os logins terminam com a **mesma** loja. O trigger tem a mesma proteção. Nunca cria loja duplicada (RN-01).

6. **Trigger SQL vs lógica na action:** trigger ganha como **fonte primária** (atomicidade real Auth↔Postgres, elimina a compensação frágil). A action `cadastrar` deixa de criar a loja. A auto-cura cobre o legado chamando a mesma função.

### Cenários

**Caminho Feliz (novo cadastro, regime permanente):**
1. `cadastrar` → `signUp(email, senha)`.
2. GoTrue insere em `auth.users` → **trigger `AFTER INSERT` dispara na mesma transação** → `garantir_loja_do_dono` cria a loja (`ativo=false`, trial 14d, consentimento na versão corrente passada por GUC/param).
3. Não há janela de órfão. A action não chama mais `criarLoja` nem `deleteUser`.
4. Usuário confirma email → callback → `/painel` → guard vê loja existente → segue.

**Caminho de Cura (órfão legado):**
1. Órfão faz login (`entrar`) com sucesso (já tem senha).
2. Redirect `/painel` → `PainelLayout` roda `buscarLojaDoDono` → `null`.
3. Guard chama auto-cura (`garantirLojaDoDono` via `service_role`) **antes** de aplicar a decisão; releitura confirma a loja; decisão recalculada com a loja já presente → segue para `/painel` (ou `confirmar-email` se ainda não confirmou).

**Casos de Borda:**
- **Email não confirmado + sem loja:** com o trigger, a loja já existe (criada no signUp); o guard manda para `confirmar-email` (precedência email > loja). Sem trigger (cura), a precedência atual já é email > loja, então o órfão não-confirmado cai em `confirmar-email` e a cura só roda quando ele de fato chegar autenticado e confirmado ao painel — aceitável (loja nasce `ativo=false` de qualquer modo). Decisão: a cura roda no guard **independente** de `email_confirmed_at`, pois `buscarLojaDoDono`/RPC são server-side e a loja nascendo inativa não vaza nada.
- **Dois logins simultâneos:** índice único → 2ª é no-op (ver Q5).
- **Slug colidindo:** sufixo numérico na RPC + CHECK `lojas_slug_formato` + `UNIQUE(slug)` como guarda final; em corrida de slug a RPC repete a busca/retry ou cai no fallback `loja-<8hex>`.
- **RPC/cura falha (rede, banco indisponível):** guard NÃO trava o usuário em loop nem expõe erro técnico. Fail-closed para `/login?erro=sessao` com `console.error` (mesmo padrão do `catch` atual do layout, `seguranca.md` §14). O órfão tenta de novo no próximo acesso (idempotente).
- **Loja inativa:** loja curada nasce `ativo=false` — correto (`seguranca.md` §17). Não aparece na vitrine.
- **Usuário com loja deletada manualmente:** `ON DELETE CASCADE` em `lojas.dono_id` derruba a loja se o user for apagado; o caso inverso (loja apagada, user vivo) é tratado pela cura como órfão normal.

**Tratamento de Erros:** mensagem genérica ao usuário (`/login?erro=sessao`), detalhe (stack, código Postgres) só em `console.error` no servidor (`seguranca.md` §14). Nunca propagar `e.message` do Postgres ao cliente.

### Schema de Banco

Nova migration: `supabase/migrations/2026XXXX_auth_users_cria_loja.sql`.

**Função `public.garantir_loja_do_dono(p_dono_id uuid, p_email text, p_versao_termos text) → uuid`**
- `LANGUAGE plpgsql` `SECURITY DEFINER` `SET search_path = public` (mesmo endurecimento dos helpers existentes).
- Idempotente: se já existe loja do dono, retorna o `id` existente sem inserir.
- Deriva slug de `p_email` (parte local sanitizada `[a-z0-9-]`, sufixo `-n` até livre; fallback `'loja-' || substr(gen_random_uuid()::text,1,8)`).
- INSERT com `dono_id`, `nome=''`, `slug`, `ativo=false`, `consentimento_em=now()`, `consentimento_versao=p_versao_termos`, `assinatura_status='trial'`, `assinatura_fim_periodo=now()+interval '14 days'`.
- `ON CONFLICT (dono_id) DO NOTHING` + reselect → blindagem de race (RN-01).
- Passa pelo gate de billing (`lojas_protege_billing`) por rodar como definer/`postgres`.
- `REVOKE ALL FROM public, anon, authenticated` + `GRANT EXECUTE TO service_role` (e ao owner para o trigger). A auto-cura do guard chama via `service_role`.

**Função e trigger `public.trg_auth_user_cria_loja()` / `on_auth_user_created`**
- `AFTER INSERT ON auth.users FOR EACH ROW`, `SECURITY DEFINER`.
- Lê a versão de termos de uma GUC/constante (`current_setting('app.versao_termos', true)`) com fallback para a versão hardcoded da migration — OU chama `garantir_loja_do_dono(new.id, new.email, <versao>)`. Como o trigger não tem acesso ao `VERSAO_TERMOS` do TS, grava a versão corrente conhecida na data da migration; o app reusa a mesma RPC com `VERSAO_TERMOS` em cura, mantendo paridade. (Decisão registrada: aceitar que a versão do trigger é a do deploy da migration; bump de termos futuro exige nova migration — coerente com "re-consentimento" já previsto em `termos.ts`.)

**RLS:** nenhuma tabela nova. As funções são `SECURITY DEFINER` e contornam RLS por design (escrevem em `lojas`). Não relaxa nenhuma policy existente de `lojas` (continua `auth.uid() = dono_id` para acesso do app autenticado).

**Índices:** reusa `lojas_dono_unico` e `UNIQUE(slug)` existentes — nenhum novo.

### Validação (zod)
Sem novo schema. `schemaCadastro`/`schemaLogin` inalterados. A auto-cura não recebe payload do cliente (deriva tudo de `auth.users`), logo não há entrada a validar — a "validação" é a regex `lojas_slug_formato` + uniques no banco.

### Recálculo no Servidor (valor monetário / autoritativo)
Não há valor monetário. Mas há **dado autoritativo** equivalente: `consentimento_*` e `assinatura_*` são decididos 100% no servidor (RPC/trigger), nunca enviados pelo cliente — mesma postura de `seguranca.md` §10/§17. O cliente jamais influencia trial nem consentimento na cura.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `supabase/migrations/2026XXXX_auth_users_cria_loja.sql` — função `garantir_loja_do_dono`, função+trigger `on_auth_user_created`, grants. Núcleo da solução.
- `src/lib/supabase/queries/lojas.ts` → nova função `garantirLojaDoDono(svcClient): Promise<void>` que faz `rpc('garantir_loja_do_dono', { p_dono_id, p_email, p_versao_termos })`. (Query nunca inline — `architecture.md` §8.) **Ou** uma função em `src/lib/actions`/util server-only que recebe `user` + `svc`. Preferência: query em `queries/lojas.ts` por simetria com o resto.
- Teste RED (fase `tdd`): cobre (a) idempotência da RPC, (b) race de dois `garantir_loja_do_dono` concorrentes → 1 loja, (c) guard cura órfão e retorna `ok`/`confirmar-email`, (d) trial/consentimento gravados server-side. Em pglite (`tests/helpers/pglite.ts`).

**Modificar:**
- `src/app/(painel)/painel/layout.tsx` — antes de `decidirAcessoPainel`, se `user && loja === null`, chamar `garantirLojaDoDono(svc)` e reler `buscarLojaDoDono`. Trocar a confiança na rota fantasma por cura real. Manter fail-closed no `catch`.
- `src/lib/actions/auth.ts` — **remover** a criação de loja da action `cadastrar` (signUp + criarLoja + slug + compensação `deleteUser`). Após o trigger, `cadastrar` só faz `signUp` e trata erro de email duplicado. Remove `resolverSlugUnico`, `contarLojasDoDono`/`criarLoja`/`slugExiste`/`reconciliarAssinatura` deste fluxo (a reconciliação Hotmart migra para o callback de confirmação — já previsto na task 066; confirmar antes de remover). **Atenção:** se a task 066 ainda não moveu a reconciliação, manter a chamada de reconciliação condicionada a `email_confirmed_at` por ora, lendo a loja criada pelo trigger via `buscarLojaDoDono`/service.
- As 9 páginas/actions que fazem `redirect("/painel/onboarding")` — com a cura no guard, o órfão nunca chega a essas páginas sem loja. Mas como defesa em profundidade, manter o redirect; só garantir que `/painel/onboarding` **resolva** (ver Onboarding).

**Onboarding (`/painel/onboarding`):** com a cura, o "onboarding de criação de loja" não é mais necessário. Duas opções:
- (A) Remover `"onboarding"` de `decidirAcessoPainel` (a loja sempre existe após a cura) e fazer os redirects das páginas apontarem para `/painel`. Mais limpo.
- (B) Criar a rota `/painel/onboarding` como um Server Component que apenas dispara a cura e redireciona para `/painel/configuracoes/perfil` (completar nome).
- **Recomendado: (A)** — elimina estado impossível. O "completar perfil" (nome/slug) já é coberto por `/painel/configuracoes/perfil`. Decisão final do agente `executar`/`arquitetar` na implementação.

**NÃO tocar:**
- `components/ui/` (shadcn).
- Policies RLS de `lojas` (continuam `auth.uid()=dono_id`).
- `lojas_protege_billing` (a RPC/trigger já passam por ele como definer).
- `src/lib/assinatura/reconciliar.ts` (lógica Hotmart independente).

### Dependências Externas
Nenhuma nova. Tudo Postgres/Supabase nativo (`@supabase/ssr`, trigger plpgsql, RPC). Docs: trigger `on auth.users` é o padrão oficial Supabase para "handle_new_user" (https://supabase.com/docs/guides/auth/managing-user-data#using-triggers).

### Ordem de Implementação (crítica → começa por RED)
1. **`/tdd` (RED):** escrever os testes falhos da RPC `garantir_loja_do_dono` (idempotência, race → 1 loja, trial/consentimento server-side) e do guard curando órfão, em pglite. Confirmar falha (RPC e função ainda não existem).
2. Migration `garantir_loja_do_dono` + trigger `on_auth_user_created` + grants. Roda os testes da RPC → GREEN.
3. Query `garantirLojaDoDono` em `queries/lojas.ts`.
4. Enganchar auto-cura em `PainelLayout` (+ ajustar `decidirAcessoPainel`/onboarding conforme opção A). Testes do guard → GREEN.
5. Simplificar `cadastrar` (remover criação de loja/compensação; conferir interação com a reconciliação Hotmart da task 066).
6. Regenerar tipos (`supabase gen types`) se a RPC mudar a assinatura tipada.
7. `/verificar`: cadastro novo (loja criada pelo trigger), órfão legado (cura no 1º login), duplo login concorrente (1 loja). Auditoria (`auditar`) por ser fluxo de auth.

**Riscos:**
- Trigger `on auth.users` com `SECURITY DEFINER` é superfície sensível — search_path travado e sem input do cliente mitigam. Falha no trigger faz o `signUp` inteiro falhar (transação) — é o comportamento desejado (sem órfão), mas exige teste do caminho de erro para não derrubar cadastro por bug no slug.
- A migration mexe em `auth` (schema gerenciado pelo Supabase) — exige `migration repair` antes do `db push` (histórico remoto dessincronizado, ver memória de deploy) e `npx supabase` (nunca pnpm).
- Remoção da criação de loja da action precisa coordenar com a task 066 (reconciliação Hotmart) para não quebrar o vínculo de assinatura órfã.
