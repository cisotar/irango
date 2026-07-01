# [085] Server Action `alternarOculto` + `schemaProduto`/create/update aceitando `oculto`

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [084]
**Spec:** specs/produto-oculto-vitrine.md

## Objetivo
Criar a Server Action `alternarOculto(id, oculto)` espelhando `alternarDisponibilidade`, e passar a aceitar `oculto` no `schemaProduto` e nos fluxos `criarProduto`/`atualizarProduto` — sempre sob RLS `produtos_escrita_propria` (`dono_id = auth.uid()`).

## Escopo
- [ ] `src/lib/validacoes/produto.ts`: adicionar `oculto: z.boolean()` ao `schemaProduto` (ao lado de `disponivel`).
- [ ] `src/lib/actions/produto.ts`: nova `export async function alternarOculto(id, oculto)` — mesmo contrato de `alternarDisponibilidade` (escopo por `id`, client autenticado, erro genérico sem vazar `e.message`, `revalidatePath`).
- [ ] `criarProduto`/`atualizarProduto`: incluir `oculto` no payload validado gravado (derivar `loja_id`/dono do servidor, nunca do payload — inalterado).
- [ ] `alternarDisponibilidade` permanece escrevendo apenas `disponivel` (RN-6-b): NÃO alterar seu comportamento.

## Fora de escopo
- UI (FormProduto/ProdutosClient) — issues 088 e 089.
- Filtro da query pública (086) e recusa no `criarPedido` (087).

## Reuso esperado
- `src/lib/actions/produto.ts` — `alternarDisponibilidade` como molde exato de `alternarOculto` (mesmo tratamento de erro §14, mesmo `revalidatePath`).
- `schemaProduto` existente — estender, não duplicar.

## Segurança
- Escrita de flag de catálogo por `id` → depende de RLS `produtos_escrita_propria` para isolar por dono; um lojista não pode alternar `oculto` de produto de outra loja.
- Usar o client AUTENTICADO, nunca `service_role`. Erro genérico ao cliente (sem `e.message`).
- Validar via `'use server'`: só funções async exportadas (rodar `next build` antes de fechar — const exportada só quebra no build).

## Critério de aceite
- [ ] Teste RED: `alternarOculto` de produto de OUTRO dono é recusado (RLS); do próprio dono grava `oculto`; `schemaProduto` rejeita payload sem `oculto` / não-boolean.
- [ ] `criarProduto`/`atualizarProduto` persistem `oculto` recebido do form.
- [ ] `alternarDisponibilidade` inalterada (só `disponivel`).
- [ ] `next build` verde (contrato `'use server'`).
