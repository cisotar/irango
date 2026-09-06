# [160] Props de Server Action obrigatórias em componente painel/admin compartilhado

**crítica:** NÃO (não explorável hoje — é prevenção)
**Mundo:** painel
**Depende de:** —
**Origem:** finding BAIXA 2 da auditoria da issue 123.

## Problema

`PerfilClient.tsx` (linhas ~78-79, 87-90) declara as props de Server Action como
OPCIONAIS, com default apontando para a action do LOJISTA:

```ts
onSalvar?: typeof salvarPerfilLojista   // default: salvarPerfilLojista
```

Hoje não é explorável: `PerfilAdminClient` injeta as quatro actions
incondicionalmente. Mas é footgun de manutenção com consequência séria — uma
sub-rota admin futura que esqueça a prop COMPILA sem erro e cai no default do
lojista, gravando na loja do usuário logado em vez da loja-alvo.

O `enforcement-escopo-admin.test.ts` não pega isso: ele descobre módulos por
referência a `createServiceClient`, e `PerfilAdminClient` não tem nenhuma.

## Escopo

- [ ] Tornar `onSalvar` / `onDefinirPublicacao` (e as demais props de action)
      OBRIGATÓRIAS. O default deixa de existir e o esquecimento vira erro de
      compilação.
- [ ] Passar as actions do lojista explicitamente na `page.tsx` do painel.
- [ ] Alternativa mais barata, se a acima for invasiva demais: estender o
      teste-guarda para assertar que todo `*AdminClient.tsx` sob `assinantes/**`
      que renderize um componente do painel injeta todas as props de action.

## Critério de aceite

- [ ] Omitir uma prop de action num client admin quebra o build.
- [ ] Nenhuma mudança de comportamento em runtime.
