## Plano Técnico

### Análise do Codebase
O que já existe e será reusado:
- `src/lib/auth/admin.ts` — `obterAdminUserId(): string` já encapsula a **única** leitura de `process.env.SAAS_ADMIN_USER_ID` e a valida (fail-closed: lança se ausente/vazia). O novo helper reusa essa função como fonte da env — não reintroduz o literal `SAAS_ADMIN_USER_ID` fora deste módulo. `import "server-only"` já está no topo do arquivo, então o helper herda a garantia server-only sem linha nova.
- `verificarAdminSaaS()` — já demonstra o padrão `try { obterAdminUserId() } catch { ... }` (linhas 26-31). O helper segue o mesmo padrão, mudando só o efeito do catch (retornar `false` em vez de lançar).
- `src/lib/auth/admin.test.ts` — padrão de teste a seguir: `vi.stubEnv("SAAS_ADMIN_USER_ID", ...)` em `beforeEach`, `vi.unstubAllEnvs()` em `afterEach`, constantes `ADMIN_UID`/`LOJISTA_UID`. Como `ehAdminSaaS` é síncrono e não toca Supabase, os novos testes **não** precisam do mock de `createClient` (o mock já existente no arquivo não interfere).

Nada novo além da função. Sem lib nova, sem dependência externa, sem tabela → sem RLS, sem migration.

### Decisão de mecanismo (reuso da leitura da env)
Escolhido: **`try/catch` sobre `obterAdminUserId()`**, não extração de um leitor tolerante separado.
Justificativa: `obterAdminUserId()` já é o ponto único de leitura/validação da env. Envolvê-lo em `try/catch` reusa leitura + validação sem duplicar o literal nem criar uma segunda função de leitura para manter em sincronia. A distinção fail-closed (guards) vs. fail-safe (login) fica localizada no consumidor, exatamente como `verificarAdminSaaS()` já faz. Extrair um helper interno tolerante só se justificaria se houvesse ≥2 consumidores fail-safe — hoje há um.

### Assinatura exata
```ts
/**
 * Comparação server-only e SÍNCRONA de um user.id já autoritativo contra
 * SAAS_ADMIN_USER_ID. Ao contrário de verificarAdminSaaS()/obterAdminUserId()
 * (fail-CLOSED), este helper é fail-SAFE: env ausente/vazia → false (não lança),
 * para uso no callback OAuth (148) onde o login NUNCA pode quebrar por config
 * faltando. Não faz getUser(): o userId deve vir de uma sessão já verificada.
 */
export function ehAdminSaaS(userId: string): boolean {
  if (!userId) return false;
  try {
    return userId === obterAdminUserId();
  } catch {
    return false; // env ausente/vazia: login segue como não-admin.
  }
}
```
O guard `if (!userId) return false` cobre string vazia antes de tocar a env (também evita que dois vazios "casem" caso a leitura mudasse). `obterAdminUserId()` nunca retorna vazio (lança antes), então a igualdade só é `true` com ambos os lados não vazios.

### Cenários
**Caminho Feliz:** callback recebe `user.id` autoritativo → `ehAdminSaaS(user.id)` compara com a env → `true`/`false` decide o redirect, sempre sem lançar.
**Casos de Borda:**
- `userId === SAAS_ADMIN_USER_ID` (ambos não vazios) → `true`.
- `userId` diferente (lojista) → `false`.
- `userId === ""` → `false` (guard, sem tocar env).
- env ausente (`undefined`) → `false` (catch), sem lançar.
- env vazia (`""`) → `false` (catch, pois `obterAdminUserId` lança em `!id`), sem lançar.
**Tratamento de Erros:** o único erro possível (env não configurada) é engolido no catch e vira `false`. O `console.error` de diagnóstico já é emitido dentro de `obterAdminUserId()` no servidor — nenhum detalhe vaza ao cliente (helper é server-only). Não há mensagem de usuário: quem decide UX é o callback (148).

### Regra cliente ↔ servidor
| Invariante | Camada |
|-----------|--------|
| Identidade do admin do SaaS (RN-13) | Server-only: `import "server-only"` no módulo; env sem `NEXT_PUBLIC_`; `userId` vem de sessão HttpOnly verificada pelo chamador. Este helper **não** eleva privilégio nem é a linha de defesa dos guards — só roteia o redirect. O enforcement fail-closed de `/admin/*` permanece em `verificarAdminSaaS()`, intacto. |

Não há valor monetário, cupom, nem escrita — nenhuma regra de valor/permissão de escrita envolvida.

### Arquivos a Criar / Modificar / NÃO tocar
- **Modificar** `src/lib/auth/admin.ts` — adicionar `ehAdminSaaS`. Motivo: reusar `obterAdminUserId` e o `import "server-only"` do mesmo módulo.
- **Modificar** `src/lib/auth/admin.test.ts` — adicionar `describe("ehAdminSaaS", ...)` (fase RED). Motivo: mesmo módulo sob teste, reusa constantes e setup de env.
- **NÃO tocar** `verificarAdminSaaS()` e `obterAdminUserId()` — comportamento fail-closed dos guards não pode regredir.
- Sem migration, sem RLS, sem componente, sem dependência externa.

### Casos de teste esperados (fase RED)
```
describe("ehAdminSaaS")
  it("true quando userId === SAAS_ADMIN_USER_ID")           → expect(ehAdminSaaS(ADMIN_UID)).toBe(true)
  it("false quando userId !== SAAS_ADMIN_USER_ID")          → expect(ehAdminSaaS(LOJISTA_UID)).toBe(false)
  it("false para userId vazio")                             → expect(ehAdminSaaS("")).toBe(false)
  it("false sem lançar quando env vazia")                   → stubEnv("SAAS_ADMIN_USER_ID",""); expect(() => ehAdminSaaS(ADMIN_UID)).not.toThrow(); toBe(false)
  it("false sem lançar quando env ausente")                 → vi.unstubAllEnvs() (ou stub undefined); toBe(false), not.toThrow()
```
Todos falham hoje (função inexistente) → RED legítimo.

### Ordem de Implementação (crítica → RED antes de GREEN)
1. **RED** (`/tdd`): adicionar o bloco `describe("ehAdminSaaS")` em `admin.test.ts`; rodar `vitest` e confirmar vermelho (função não existe / import quebra).
2. **GREEN** (`/execute`): adicionar `ehAdminSaaS` em `admin.ts`; rodar vitest até verde.
3. Rodar `next build` (mandato "use server"/build — embora aqui não seja Server Action, garante que o export síncrono não quebra o módulo server-only).
4. Confirmar que os testes de `verificarAdminSaaS` continuam verdes (não-regressão do fail-closed).
