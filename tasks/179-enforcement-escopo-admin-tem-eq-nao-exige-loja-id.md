# [179] `enforcement-escopo-admin.test.ts` — `TEM_EQ` aceita qualquer `.eq(`, não exige `loja_id`

**crítica:** NÃO (não explorável hoje — nenhuma escrita admin viva usa o padrão vulnerável; é
fraqueza de guard, não vulnerabilidade)
**Mundo:** admin (`src/app/admin/assinantes/**`)
**Depende de:** —
**Origem:** achado da auditoria do Passo 4b da issue 160
(`plan/loop-160-props-action-obrigatorias.md`), ao validar `alternarZonaAtivaAdmin`.

## Problema

`src/app/admin/assinantes/enforcement-escopo-admin.test.ts:174` define:

```ts
const TEM_EQ = /\.eq\s*\(/;
```

Qualquer `.eq(` no statement satisfaz o guard — não exige que o `.eq(` seja sobre `loja_id`.
Provado por mutação: plantando

```ts
// cross-tenant: escopo só por id, SEM loja_id
const { error } = await svc.from("zonas_entrega").update({ ativo }).eq("id", id);
```

em `alternarZonaAtivaAdmin`, a suíte inteira do admin passa (491 testes, 37 arquivos, 0
falhas) com o buraco cross-tenant plantado.

**Fronteira exata (medida por mutação):**
- O guard PEGA: `update`/`delete`/`insert` sem nenhum `.eq(`.
- O guard NÃO PEGA: `update`/`delete` escopado só por `id` (sem `loja_id`) — exatamente o
  vetor cross-tenant real.

## Por que não é vulnerabilidade hoje

Varredura de todas as escritas `svc.from()` das actions admin não achou nenhuma que escope só
por `id` sem `loja_id` de forma insegura. As duas exceções legítimas encontradas:
- `bairros_zona` por `zona_id` — posse ancorada (já revisada e documentada na allowlist do
  próprio arquivo, linhas ~176-184).
- `admin-modulos-impressao.ts` em `lojas` por `.eq("id")` — `id` **é** a chave de tenant
  nessa tabela.

O risco é de **regressão futura silenciosa**, não de exploração atual.

## Escopo

- Trocar `TEM_EQ` por uma checagem que exija `.eq("loja_id"` (ou `.eq(\`loja_id\`` / variações
  de aspas) no statement, com a mesma allowlist explícita por (arquivo, tabela) já usada para
  os inserts-filho ancorados por posse (`bairros_zona`, `taxas_entrega`) e para `lojas.id`.
- Reprovar a mutação de teste: `update(...).eq("id", id)` sem `loja_id` deve FALHAR o guard.
- Manter GREEN todas as escritas legítimas já mapeadas no arquivo.

## Critério de aceite

- [ ] Guard falha quando um `.eq("id", ...)` sem `.eq("loja_id", ...)` é plantado numa action
      admin fora da allowlist.
- [ ] Suíte inteira do admin continua verde nas escritas reais (nenhum falso positivo).
