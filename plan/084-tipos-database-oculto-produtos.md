## Plano Técnico

### Análise do Codebase
Arquivo único afetado: `src/lib/database.types.ts` (gerado, editado à mão nesta issue por
`gen types` não ser executável — migration 083 ainda não aplicada no cloud e disco local
apertado; ver contexto da 083).

O que já existe e será reusado (NÃO criar arquivo paralelo):
- `src/lib/database.types.ts` L684-747 — bloco `produtos` com `Row`/`Insert`/`Update`/`Relationships`.
  É o único ponto a tocar.

Varredura de reuso/impacto (confirmações que orientam o patch determinístico):
- **Convenção de ordenação:** as colunas de cada bloco estão em ordem alfabética
  (`atualizado_em, categoria_id, criado_em, descricao, disponivel, foto_url, id, loja_id,
  nome, ordem, preco`). `oculto` entra entre `nome` e `ordem`.
- **Convenção de tipo boolean:** espelhar `disponivel` — `Row: disponivel: boolean`,
  `Insert/Update: disponivel?: boolean`. `oculto` é `NOT NULL DEFAULT false` (migration 083),
  logo obrigatório no Row e opcional no Insert/Update, exatamente como `disponivel`.
- **RPC / view com `setof produtos`:** NENHUMA. A seção `Functions` (L969-1092) só tem setof
  para `lojas` (`loja_por_email_dono`, `loja_por_subscription_id`); `criar_pedido` retorna
  tupla custom `{pedido_id, token_acesso}`. Não há retorno com shape de `produtos` a patchar.
- **`referencedRelation: "produtos"` (L262):** é só um Relationship (FK de `itens_pedido`),
  sem lista de colunas — nada a alterar.
- Conclusão: **exatamente 3 pontos de inserção** — Row, Insert, Update do bloco `produtos`.

### Cenários
Issue de infra/tipos, sem runtime. Não crítica.
- **Caminho feliz:** aplicar as 3 edições → `tsc --noEmit` e `next build` verdes → queries/actions/
  schema Zod que referenciem `oculto` passam a compilar.
- **Casos de borda:**
  - Ordenação: se o executor inserir fora de ordem, o arquivo diverge de um futuro `gen types`
    e gera diff ruidoso. Manter alfabético (entre `nome` e `ordem`).
  - Obrigatoriedade: `oculto` sem `?` no Insert/Update quebraria todo insert/update de produto
    que não passe `oculto` (a coluna tem DEFAULT). Usar `oculto?:` no Insert/Update.
- **Tratamento de erros:** N/A (sem código de runtime).

### Schema de Banco
Não toca schema — a coluna já foi criada pela migration da 083
(`supabase/migrations/20260621099000_produtos_oculto_rls_publica.sql`,
`add column oculto boolean not null default false`). Esta issue só reflete o tipo. Sem RLS nova.

### Validação (zod)
Fora de escopo (issue de tipos). Schema Zod de produto é responsabilidade de outra issue.

### Recálculo no Servidor
N/A — sem valor monetário.

### Edições determinísticas (before → after)

**1) Row (bloco entre `nome: string` L694 e `ordem: number` L695):**
```diff
           nome: string
+          oculto: boolean
           ordem: number
```

**2) Insert (bloco entre `nome: string` L707 e `ordem?: number` L708):**
```diff
           nome: string
+          oculto?: boolean
           ordem?: number
```

**3) Update (bloco entre `nome?: string` L720 e `ordem?: number` L721):**
```diff
           nome?: string
+          oculto?: boolean
           ordem?: number
```

Indentação: 10 espaços (mesma dos irmãos `disponivel`/`ordem`). Nenhuma outra linha muda.

### Arquivos a Criar / Modificar / NÃO tocar
- **Modificar:** `src/lib/database.types.ts` — as 3 inserções acima. Único arquivo.
- **NÃO tocar:** a migration 083 (já commitada/fechada); qualquer query/action/UI/Zod (fora de
  escopo); a seção `Functions` e o Relationship L262 (não têm shape de `produtos` a atualizar).
- **NÃO rodar:** `npx supabase gen types` — migration 083 não aplicada no cloud e Supabase local
  pode não caber no disco (542M livres). Patch é manual e determinístico.

### Dependências Externas
Nenhuma. Sem novo pacote. Depende apenas da migration 083 (já mergeada).

### Ordem de Implementação
Não crítica — sem fase RED. Sequência:
1. Aplicar as 3 edições em `src/lib/database.types.ts`.
2. `npx tsc --noEmit` (deve seguir verde; nenhum erro relacionado a `oculto`).
3. `next build` para validar (ver memória `use-server-export-constraint`: alguns erros só
   aparecem no build). Verde = pronto.
