# [084] Schemas zod do painel — categoria de opcional + opcional + associação

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** 080
**Spec:** specs/spec_opcionais.md

## Objetivo
Criar `lib/validacoes/opcional.ts` com os schemas de escrita do painel: categoria de opcional (nome, ordem), opcional (nome, `preco >= 0`, categoria_opcional_id, ativo, ordem) e associação categoria-de-produto ⋈ categoria-de-opcional.

## Escopo
- [ ] `schemaCategoriaOpcional`: `nome` (min 1), `ordem` (int `>= 0`), `.strict()`
- [ ] `schemaOpcional`: `nome` (min 1), `preco` (`number >= 0`, 2 casas), `categoria_opcional_id` (guid), `ativo` (bool), `ordem` (int), `.strict()`
- [ ] `schemaAssociacaoCategoriaOpcional`: `categoria_id` (guid) + `categoria_opcional_id[]` (guids) para gravar/remover linhas em lote
- [ ] Exportar tipos inferidos para o react-hook-form

## Fora de escopo
- Server Actions de CRUD que consomem os schemas (087 e UI 088/089 dependem deste, mas implementação da action de painel vive nas issues de UI/painel).
- UI dos forms (088/089).

## Reuso esperado
- Padrão de schemas existentes em `lib/validacoes/` (ex.: `produto.ts`, `cupom.ts`) — mesma estrutura e `.strict()`.

## Segurança
- `preco >= 0` (RN-O5 acréscimo, nunca negativo).
- Ownership cross-tenant (RN-O8) NÃO é garantido pelo zod — é revalidado na Server Action (087); o schema só garante formato.

## Critério de aceite
- [ ] (crítica) Teste vermelho/verde:
  - `schemaOpcional` rejeita `preco: -1`;
  - rejeita campo extra (`.strict()`);
  - `schemaCategoriaOpcional` aceita nome + ordem válidos;
  - `schemaAssociacaoCategoriaOpcional` aceita array de guids e rejeita uuid inválido.
