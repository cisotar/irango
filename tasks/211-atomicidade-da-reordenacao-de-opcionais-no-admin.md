# [211] Atomicidade da reordenação de opcionais no hub admin

**crítica:** NÃO
**origem:** auditoria da issue 208, commit `b31e037` (achado BAIXA). Mitigação parcial em `126ce40`.

## Problema

`reordenarOpcionaisDaCategoriaAdmin`
(`src/app/admin/assinantes/actions/admin-opcionais.ts`) grava a ordem com **N `update`
sequenciais, fora de transação**. O caminho do lojista não tem esse problema: ele passa pela
RPC `reordenar_opcionais_da_categoria`, que é um único statement e cai inteira em caso de erro.

O admin não pode reusar essa RPC porque ela é `security invoker` — sob `service_role` a RLS
não vale e o invoker não serve. Daí a escrita à mão.

Falha de rede no 3º de 5 `update` deixa as posições 0,1,2 gravadas e 3,4 com a ordem antiga.
Como não há unique em `(categoria_id, ordem)`, o resultado é `ordem` duplicada dentro do par,
e a vitrine passa a exibir ordem não determinística até alguém reordenar de novo.

## O que já foi mitigado

`126ce40` acrescentou `count: "exact"` e verificação de `count === 1` por iteração, o que fecha
a janela TOCTOU (linha removida entre o SELECT de permutação e o UPDATE afetava 0 linhas sem
erro, e a action devolvia `{ ok: true }` com uma posição faltando).

**Isso não resolve a atomicidade**: a action agora *detecta* a falha e devolve `{ ok: false }`,
mas as posições já gravadas continuam gravadas. O estado parcial permanece.

## Escopo

RPC dedicada ao admin, `security definer`, com `p_loja_id` explícito — e por ser `definer`,
com o checklist das 7 travas refeito do zero (`seguranca.md` §2), porque `definer` significa
que o escopo passa a ser responsabilidade só do corpo da função. Alternativa mais barata a
avaliar: um único `update ... from unnest(...) with ordinality` escrito na própria action, que
é atômico por ser um statement só, sem função nova.

A decisão entre as duas é de arquitetura: **passar pelo `arquitetar` antes de implementar** se
for pela RPC `definer`.

## Fora de escopo

O caminho do lojista, que já é atômico.

## Critério de aceite

- [ ] a escrita da ordem no admin é atômica: erro no meio não deixa posição gravada;
- [ ] teste provando o estado parcial impossível (falha injetada no meio da sequência);
- [ ] se for RPC `definer`, os 7 itens do checklist provados com `arquivo:linha`.
