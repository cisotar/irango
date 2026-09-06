# [165] Teto de tamanho em `nome`/`telefone` no `schemaPerfil`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** —
**Origem:** finding BAIXA 4 da auditoria da issue 124.

## Problema

`src/lib/validacoes/loja.ts:26,28`:
- `nome: z.string().trim().min(1)` — sem `.max()`
- `telefone: z.string().optional()` — sem regex nem tamanho

A coluna é `text` cru (`20260614000129_schema_inicial.sql:12-13`), sem CHECK.

Assimetria explícita: `schemaNovaLojaAdmin` usa `.max(60)`. O caminho de CRIAÇÃO
limita; o de ATUALIZAÇÃO não.

Vetor real (lojista autenticado, não o admin): `salvarPerfil` com `nome` de ~1MB
(teto do body de Server Action do Next). Fica armazenado e é serializado em toda
renderização da vitrine e na lista `/admin/assinantes`, que carrega todas as lojas.

Impacto é bloat/degradação, não XSS — não há `dangerouslySetInnerHTML` no repo e
o React escapa tudo.

## 🛑 Por que NÃO foi corrigido na hora

Adicionar `.max(60)` retroativamente TRAVA o save de perfil inteiro de qualquer
loja já cadastrada com nome mais longo. A escolha do teto precisa ser deliberada.

## Escopo

- [ ] Consultar o banco: qual o maior `nome` e `telefone` já gravados?
- [ ] Escolher o teto à luz disso, em paridade com `schemaNovaLojaAdmin` se couber.
- [ ] Aplicar no schema. Avaliar CHECK na coluna também.
- [ ] Teste com valor no limite e acima dele.

## Critério de aceite

- [ ] Nenhuma loja existente fica impedida de salvar o próprio perfil.
- [ ] Payload acima do teto é reprovado no servidor, sem UPDATE.
