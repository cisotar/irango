# [338] Termos e Privacidade: texto da conta de cliente e bump de `VERSAO_TERMOS`

**crítica:** NÃO
**vetor:** —
**Mundo:** vitrine pública
**Depende de:** — (deve mesclar no mesmo PR de 337, pois a versão é a gravada no aceite)
**Spec:** specs/cliente-identidade.md
**Branch:** feat/clientes-identidade

## Objetivo
Atualizar `/termos` e `/privacidade` com os 7 pontos da decisão 22 e subir `VERSAO_TERMOS`.

## Behaviors do spec que esta issue fecha
- "Ler as páginas com o texto novo e a versão nova exibida."
- "`VERSAO_TERMOS` sobe na mesma entrega e é a versão gravada no aceite do cliente." (bump; a gravação é de 337)
- "Lojista que aceitou versão anterior não é obrigado a re-aceitar."

## Escopo
- [ ] `/privacidade`: remover "Não solicitamos CPF nem data de nascimento" (`privacidade/page.tsx:60-61`); declarar
  nascimento com finalidade; dados do cliente com conta; dados do Google (nome, e-mail); exclusão autosserviço
  (`:95-98`) com a ressalva de lojista; retenção (decisão 4); idade mínima 18.
- [ ] `/termos`: conta de cliente, responsabilidade pelas credenciais, idade mínima.
- [ ] Manter o aviso "revisar com jurídico".
- [ ] Bump de `VERSAO_TERMOS` em `src/lib/constants/termos.ts`.

## Fora de escopo
- Texto jurídico final. Re-consentimento de lojista. Nada em `lojas.consentimento_versao`.

## Reuso esperado
- Páginas existentes e `VERSAO_TERMOS` — sem nova constante.

## Segurança
- Nenhum dado real (e-mail/telefone) no texto além do contato de atendimento já existente.

## Critério de aceite
- [ ] Páginas exibem a versão nova; `grep "Não solicitamos CPF nem data de nascimento"` vazio.
- [ ] Nenhum teste existente de lojista depende do valor literal antigo (se depender, usar a constante).
- [ ] `tsc`, lint, suíte e build verdes.
