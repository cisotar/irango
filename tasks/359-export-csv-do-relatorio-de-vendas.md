> **Fora do escopo do loop relatorio-vendas (decisão 11 do usuário); não implementar neste PR.** Fica em `tasks/`
> como próxima entrega; a spec registra a exclusão em RN-V25.

# [359] Exportar o relatório de vendas em CSV

**crítica:** SIM (TDD red-first)
**Mundo:** painel (+ admin, se a paridade for decidida)
**Depende de:** [357] (montagem do relatório e filtros validados), [358] (tela onde o botão vive)
**Spec:** specs/relatorio-vendas.md — RN-V25 (fora da v1); precisa de spec própria ou de seção nova antes de
implementar

## Objetivo
Permitir ao lojista baixar em CSV os números do período filtrado (linhas diárias e itens por categoria), com os mesmos
filtros e o mesmo escopo de loja da tela.

## Escopo
- [ ] Decidir com o usuário: quais blocos entram (resumo, diário, itens por categoria; ranking com nome de cliente
      entra ou não), se o admin também exporta, separador/locale (vírgula decimal).
- [ ] Route handler ou Server Action que reusa a montagem da 357 com o client da sessão (painel) ou o loader admin;
      nenhuma consulta nova sem faixa de data.
- [ ] Botão "Exportar CSV" no `RelatorioVendas` respeitando os filtros da URL.

## Fora de escopo
- Excel/PDF, envio por e-mail, agendamento.

## Reuso esperado
- Montagem compartilhada e schemas zod da issue 357; loader `carga-vendas.ts` para o admin.
- Lib madura de CSV já no `package.json`, se houver (grep antes); senão serialização mínima com escape testado.

## Segurança
- Escopo de loja idêntico ao da tela (sessão/`auth.uid()` ou `verificarAdminSaaS()` + `lojaId` validado).
- **CSV injection:** célula que começa com `=`, `+`, `-`, `@`, tab ou CR (nome de produto, categoria, cliente) é
  neutralizada.
- Se o ranking entrar: só nome, nunca telefone/e-mail; nunca no admin.
- Rate limit por lojista (molde `verificarRateLimit`).

## Critério de aceite
- [ ] CSV do período bate com os números da tela (mesmos filtros; Σ linhas = totais).
- [ ] Lojista de X não exporta dados de Y; `anon` recebe 401/redirect.
- [ ] Produto chamado `=HYPERLINK(...)` sai neutralizado.
- [ ] Teste vermelho com `FAIL` capturado antes da implementação; depois verde.
