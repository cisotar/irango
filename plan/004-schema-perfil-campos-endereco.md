## Plano Técnico

### Análise do Codebase
O que já existe e será reusado:
- `src/lib/validacoes/loja.ts` (`schemaPerfil`) — schema isomórfico atual (`nome`, `slug`, `telefone`, `whatsapp`) com `.strict()`. É o alvo da extensão; NÃO criar schema novo.
- `src/lib/validacoes/pedido.ts:39` — regex de CEP **já existente**: `/^\d{5}-?\d{3}$/` (aceita `01310-100` e `01310100`). Hoje é literal inline no `schemaEnderecoEntrega`; será **promovida a constante nomeada compartilhada** (`reCep`) e reusada nos dois lugares — sem duplicar a expressão.
- `src/lib/validacoes/pedido.ts:45` — validação de UF **já existente**: `z.string().length(2)` no `endereco_entrega` do pedido. NÃO há regex de letras-only de UF no projeto. Reusaremos o mesmo nível de rigor ("leve"), elevando para regex `/^[A-Za-z]{2}$/` (2 letras) — alinhado à diretriz "validação leve" da issue, sem checar lista fechada de 27 UFs (fora de escopo).
- `src/components/vitrine/FormEndereco.tsx` — máscara de CEP via `react-imask` (`IMaskInput mask="00000-000"`) e `limparCep`. Confirma que a máscara já tem lib madura — não reimplementar. Fora do escopo (UI é issue 009).
- `src/lib/validacoes/loja.test.ts` — arquivo de teste do schema; padrão `safeParse(x).success`. É onde entram os casos novos.

O que precisa ser criado: nada além de campos no schema existente e casos de teste. Sem arquivos novos, sem libs novas.

### Onde a CEP regex deve morar (decisão de reuso)
Para não duplicar `/^\d{5}-?\d{3}$/` entre `pedido.ts` e `loja.ts`:
- Declarar `reCep`/`reUf` em `loja.ts`. Se possível sem quebrar `pedido.test.ts`, adotar **fonte única**: `pedido.ts` importa `reCep` de `loja.ts`.
- Como `pedido.ts` está fora do escopo declarado, o mínimo seguro é declarar as regex em `loja.ts` referenciando explicitamente o mesmo padrão de `pedido.ts:39/45`. A implementação escolhe a fonte única se os testes de pedido continuarem verdes.

### Shape exato dos 6 campos (zod)
Todos opcionais, `string`, `.trim()`, validação leve. Adicionar ao `z.object({...})` do `schemaPerfil` (antes do `.strict()`):

```ts
const reCep = /^\d{5}-?\d{3}$/;        // mesmo de pedido.ts:39
const reUf = /^[A-Za-z]{2}$/;          // 2 letras (UF); paridade com length(2) de pedido.ts:45

// dentro do z.object:
endereco_cep:    z.string().trim().regex(reCep).optional(),
endereco_rua:    z.string().trim().min(1).optional(),
endereco_numero: z.string().trim().min(1).optional(),
endereco_bairro: z.string().trim().min(1).optional(),
endereco_cidade: z.string().trim().min(1).optional(),
endereco_estado: z.string().trim().regex(reUf).optional(),
```

Notas:
- `.optional()` por design: endereço não é obrigatório no perfil.
- `.trim()` antes da validação (padrão do `nome`).
- `min(1)` rejeita "" explícito, mantendo `undefined` válido.
- **`.strict()` permanece** — `latitude`/`longitude` e qualquer chave extra reprovam `safeParse`. RN-1 (seguranca.md §2/§10).

### Mapeamento form → coluna (do spec)
| Campo (form) | Chave no schema   | Coluna em `lojas`  |
|--------------|-------------------|--------------------|
| CEP          | `endereco_cep`    | `endereco_cep`     |
| Logradouro   | `endereco_rua`    | `endereco_rua`     |
| Número       | `endereco_numero` | `endereco_numero`  |
| Bairro       | `endereco_bairro` | `endereco_bairro`  |
| Cidade       | `endereco_cidade` | `endereco_cidade`  |
| UF           | `endereco_estado` | `endereco_estado`  |
| — (derivado) | (ausente)         | `latitude` (issue 008)  |
| — (derivado) | (ausente)         | `longitude` (issue 008) |

Chaves do schema = nomes de coluna → mapeamento 1:1, sem tradução na Server Action.

### Validação (zod)
Schema único `schemaPerfil` em `src/lib/validacoes/loja.ts`, reusado no form (issue 009, UX) e na Server Action `salvarPerfil` (issue 008, segurança). Esta issue entrega só a extensão do contrato.

### Regra cliente ↔ servidor
| Invariante | Camada que garante (nesta issue) |
|-----------|----------------------------------|
| `latitude`/`longitude` nunca aceitos do cliente | `schemaPerfil.strict()` — payload com essas chaves reprova `safeParse` (RN-1). Allowlist na Server Action (issue 008) é a 2ª barreira. |
| CEP/UF malformados | `regex(reCep)` / `regex(reUf)` no schema — roda no servidor na `salvarPerfil` (issue 008). |
| Escrita de `endereco_*` por dono | RLS `lojas_update_proprio` (`auth.uid()=dono_id`), já existente — não muda nesta issue. |

Issue puramente de contrato de validação; não toca banco, RLS nem Server Action. Enforcement de valor/coords vive na issue 008.

### Casos de teste (RED primeiro — issue crítica)
Em `src/lib/validacoes/loja.test.ts`, novo `describe("schemaPerfil — endereço (6 campos opcionais + strict rejeita coords)")`:

Passam (6 válidos):
1. payload base + os 6 campos válidos (`endereco_cep: "01310-100"`, `endereco_rua: "Av Paulista"`, `endereco_numero: "1000"`, `endereco_bairro: "Bela Vista"`, `endereco_cidade: "São Paulo"`, `endereco_estado: "SP"`) → `success === true`.
2. CEP sem hífen (`"01310100"`) → passa.
3. payload SEM nenhum campo de endereço (todos opcionais) → passa.
4. UF minúscula (`"sp"`) → passa.
5. cada campo individualmente presente, demais ausentes → passa.

Reprovam:
6. `latitude: -23.5` no payload → reprova (`.strict()`).
7. `longitude: -46.6` no payload → reprova.
8. `latitude` + `longitude` juntos → reprova.
9. CEP malformado (`"123"`, `"0131-100"`, `"01310-10a"`) → reprova.
10. UF malformada (`"S"`, `"SPP"`, `"S1"`, `"12"`) → reprova.
11. `endereco_rua: ""` → reprova (`min(1)`).
12. `endereco_cidade: "   "` (só espaços) → reprova após trim.

### Arquivos a Criar / Modificar / NÃO tocar
**Modificar:**
- `src/lib/validacoes/loja.ts` — adicionar `reCep`, `reUf` e os 6 campos opcionais ao `schemaPerfil`. Manter `.strict()`.
- `src/lib/validacoes/loja.test.ts` — adicionar o `describe` de endereço (RED primeiro).

**Avaliar (só se fonte única de regex não quebrar testes):**
- `src/lib/validacoes/pedido.ts` — importar `reCep` de `loja.ts` em vez do literal inline (linha 39).

**NÃO tocar:**
- `src/components/vitrine/FormEndereco.tsx` — UI, issue 009.
- `src/lib/actions/loja.ts` (`salvarPerfil`) — allowlist + geocoding, issue 008.
- `supabase/migrations/` — colunas `endereco_*` já existem; coords é issue 008.
- `components/ui/` (shadcn) — não se edita à mão.

### Dependências Externas
Nenhuma. `zod` já no `package.json`. Sem lib nova.

### Ordem de Implementação
Issue **crítica** → RED antes de GREEN:
1. **RED (`/tdd`)** — escrever o `describe` de endereço em `loja.test.ts`; rodar `pnpm test` e confirmar falha real (os casos de "passam" com os 6 campos falham porque os campos novos ainda não existem). Confirmar o vermelho.
2. **GREEN (`/execute`)** — adicionar `reCep`, `reUf` e os 6 campos opcionais ao `schemaPerfil`; manter `.strict()`. `pnpm test` verde.
3. (Opcional) fonte única da `reCep` em `pedido.ts` se os testes de pedido continuarem verdes.
