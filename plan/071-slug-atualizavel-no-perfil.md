## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (NADA novo a criar):**

- `src/lib/validacoes/loja.ts`
  - `sanitizarSlug(nome)` (linha 58) — normalização para auto-sugestão. Invariante documentada: a saída sempre passa no `reSlug` do `schemaPerfil`. **Não recriar normalização no componente.**
  - `schemaPerfil` (linha 16) — `.strict()`, campo `slug: z.string().regex(/^[a-z0-9-]{3,60}$/)`. Para o preview de validade usar `schemaPerfil.shape.slug.safeParse(slug)`. **Não escrever regex paralela no componente.**
- `src/lib/actions/loja.ts`
  - `salvarPerfil` (linha 45) — já importado em `PerfilClient`. Já aceita slug diferente: compara `dados.slug !== loja.slug` (linha 59), checa unicidade via `slugExiste(createServiceClient(), dados.slug, loja.id)` escopado e excluindo a própria loja (linha 60), retorna `{ ok: false, erro: ERRO_SLUG_OCUPADO }` (linha 61), e revalida cache da vitrine antiga e nova (linha 77). **Nada a tocar no backend.**
- `src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx` — único arquivo a modificar.
  - shadcn `Input`, `Label`, `Button`, `Card`, `Separator`; ícone `Copy` (lucide); toast `sonner`; `useState`/`useTransition`/`useRouter` — todos já importados/em uso.
  - `BASE_VITRINE = "https://irango.com.br/loja"` (linha 25) — reusar para o prefixo visível.

**A criar:** nada. **A modificar:** só `PerfilClient.tsx`. Não há componente novo, lib nova ou util novo — tudo já existe.

### Cenários

**Caminho Feliz (slug em modo auto):**
1. Estado inicial: `slug = inicial.slug`, `slugEditadoManualmente = false`.
2. Lojista digita no campo Nome → `onChange` chama `setNome` e, como flag é `false`, `setSlug(sanitizarSlug(novoNome))`.
3. Preview do link e botão Copiar refletem o slug sugerido em tempo real.
4. Clica Salvar → `montarPayload` envia o `slug` atual → `schemaPerfil.safeParse` (gate de UX) → `salvarPerfil` persiste, checa unicidade no servidor, toast de sucesso, `router.refresh()`.

**Caminho Feliz (slug manual):**
1. Lojista digita no campo Slug → `onChange` chama `setSlugEditadoManualmente(true)` e `setSlug(valor)`.
2. A partir daí, mudar o Nome NÃO sobrescreve o slug.
3. Como `slug !== inicial.slug`, aparece o aviso inline do link antigo.

**Casos de Borda:**
- **Slug inválido** (fora de `^[a-z0-9-]{3,60}$`: vazio, < 3 chars, maiúscula, espaço, caractere especial): `schemaPerfil.shape.slug.safeParse(slug).success === false` → mensagem inline abaixo do campo + botão Salvar desabilitado.
- **Nome com acento/símbolos em modo auto:** `sanitizarSlug` já normaliza para slug válido — sem mensagem de erro. Nome só com símbolos (ex.: "!!!") → slug vazio → cai no caso inválido acima (esperado).
- **Slug igual ao inicial:** sem aviso de mudança.
- **Slug ocupado por outra loja:** validação client passa (formato ok), mas `salvarPerfil` retorna `ERRO_SLUG_OCUPADO` → `toast.error(resultado.erro)` (caminho já existente, linha 113-116). Não persiste.
- **Falha de rede no submit:** `salvarPerfil` lança/rejeita → tratamento já existente no `startEnvio`; toast genérico de erro.

**Tratamento de Erros (seguranca.md §14):**
- Mensagens client-side são genéricas e de UX ("Endereço da vitrine inválido", "Confira os dados do perfil"). Detalhe de unicidade/colisão vem do servidor já com texto seguro (`ERRO_SLUG_OCUPADO`). Nenhum stack/detalhe interno é exposto ao usuário.

### Schema de Banco
Não se aplica. Nenhuma tabela, coluna, CHECK, índice, migration ou RLS nova. Coluna `slug` e constraint `UNIQUE`/`CHECK` já existem e já são exercidas por `salvarPerfil`.

### Validação (zod)
Schema único reusado, sem duplicação:
- **Preview em tempo real (UX):** `schemaPerfil.shape.slug.safeParse(slug).success` controla a mensagem inline e o `disabled` do botão Salvar.
- **Gate no submit (UX):** `schemaPerfil.safeParse(payload)` (já existe na função `salvar`).
- **Verdade (servidor):** `schemaPerfil.parse` + checagem de unicidade via service_role + `UNIQUE`/`CHECK` no banco, tudo dentro de `salvarPerfil`. O cliente nunca decide validade nem unicidade.

### Recálculo no Servidor
Não há valor monetário nesta issue. A única "decisão autoritativa" é validade de formato + unicidade do slug, ambas garantidas server-side em `salvarPerfil` (já existente). Cliente envia `{ nome, slug, telefone?, whatsapp? }`; servidor revalida formato e unicidade do zero.

### Regra cliente ↔ servidor
| Invariante | Onde é garantida |
|-----------|------------------|
| Formato do slug | `schemaPerfil.parse` na Server Action (`salvarPerfil`) + CHECK no banco. Client é só UX. |
| Unicidade do slug | `slugExiste(service_role, slug, exceto=loja.id)` em `salvarPerfil` + constraint `UNIQUE`. Nunca decidida no client. |
| Escrita do slug da própria loja | `salvarPerfil` opera sobre a loja do dono autenticado (`buscarLojaDoDono`) + RLS de UPDATE por `dono_id` (já existentes). |
Nenhuma invariante de permissão/valor depende exclusivamente do cliente.

### Arquivos a Criar / Modificar / NÃO tocar
- **Modificar (único):** `src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx`
  - `const [slug] = useState(inicial.slug)` → `const [slug, setSlug] = useState(inicial.slug)`.
  - Novo estado `const [slugEditadoManualmente, setSlugEditadoManualmente] = useState(false)`.
  - `onChange` do Nome: além de `setNome`, se `!slugEditadoManualmente` → `setSlug(sanitizarSlug(novoValor))`.
  - Novo campo Slug editável: `Label` + prefixo `https://irango.com.br/loja/` como adorno textual à esquerda + `Input` (não `readOnly`); `onChange` → `setSlugEditadoManualmente(true)` + `setSlug(e.target.value)`.
  - Importar `sanitizarSlug` de `@/lib/validacoes/loja` (somar ao import já existente de `schemaPerfil`).
  - Validade do slug: `const slugValido = schemaPerfil.shape.slug.safeParse(slug).success`. Mensagem inline (`<p className="text-xs text-destructive">`) quando `!slugValido`.
  - Aviso de mudança: `<p className="text-xs text-amber-...">` quando `slug !== inicial.slug` — "Atenção: o link anterior da vitrine deixará de funcionar."
  - `montarPayload`: trocar `slug` fixo por `slug.trim()` (estado editado).
  - `urlVitrine` já usa `slug` → passa a refletir o preview automaticamente.
  - Botão Salvar: `disabled={enviando || !slugValido}`.
  - Remover/ajustar o campo readonly atual "Link da sua vitrine" e a frase "O endereço da vitrine não pode ser alterado aqui." (substituída pelo campo editável). Manter o botão Copiar apontando para `urlVitrine`.
- **NÃO tocar:** `src/lib/validacoes/loja.ts`, `src/lib/actions/loja.ts`, `src/lib/supabase/queries/lojas.ts`, qualquer migration/RLS, `components/ui/*` (shadcn — não editar à mão).

### Dependências Externas
Nenhuma nova. Todos os pacotes (`zod`, `lucide-react`, `sonner`, shadcn) já no projeto.

### Ordem de Implementação
Issue **não crítica** (sem dinheiro/RLS/auth/token). TDD red-first não é obrigatório.
1. Trocar `slug` para estado editável + adicionar flag `slugEditadoManualmente`.
2. Auto-sugestão no `onChange` do Nome.
3. Substituir o campo readonly pelo campo Slug editável com prefixo e Copiar.
4. Validação em tempo real (`schemaPerfil.shape.slug`) + `disabled` do Salvar.
5. Aviso inline de mudança de slug.
6. Ajustar `montarPayload` para usar o slug editado.
7. `npm run lint` + typecheck; conferir que só `PerfilClient.tsx` mudou.
