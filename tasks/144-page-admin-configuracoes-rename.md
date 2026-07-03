# [144] Configurações admin: consolidar rota `.../configuracao` → `.../configuracoes`

**crítica:** NÃO
**Mundo:** painel admin (auth admin)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rota 8)

## Objetivo
Mover a página de configuração admin consolidada de `.../configuracao` para `.../configuracoes` (paridade de URL com o item de nav), sem mudança de lógica.

## Escopo
- [ ] Mover `[lojaId]/configuracao/` → `[lojaId]/configuracoes/` (page + `ConfiguracaoAdminClient` mantidos como estão).
- [ ] Atualizar referências do link antigo (`AbasLoja` / redirects) para o novo caminho, evitando 404 antes do shell (145).

## Fora de escopo
Split em subpáginas (Fora de Escopo v1 do spec). Qualquer mudança de lógica de escrita — actions 091–095 inalteradas. Shell/nav (145).

## Reuso esperado
- `ConfiguracaoAdminClient` (sem mudança) — mesmos `PerfilClient`/`HorariosClient`/`EntregasClient`/`PagamentosClient`/`TemaClient` do painel.

## Segurança
- Nenhum recálculo novo. Actions admin existentes + escopo (inalterado).

## Critério de aceite
- [ ] Configurações respondem em `.../configuracoes`; editar perfil/horários/entregas/pagamentos/tema/logo/publicar continua funcionando.
- [ ] Zero regressão de comportamento (rota apenas movida).
