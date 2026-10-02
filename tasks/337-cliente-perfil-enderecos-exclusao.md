# [337] Perfil, endereços e exclusão de conta do cliente (Server Actions + queries) e recusa L1 no admin

**crítica:** SIM (TDD red-first)
**vetor:** V2 (dados · RLS · PII)
**Mundo:** auth
**Depende de:** 335 (tabelas/RPCs), 336 (`schemas` de perfil/endereço, `sanitizarNext` em `lib/utils`)
**Spec:** specs/cliente-identidade.md
**Branch:** feat/clientes-identidade

## Objetivo
Server Actions e queries que criam/editam o perfil, mantêm até 3 endereços e excluem a conta, sempre com o id
vindo da sessão; e a mensagem específica de `criarLojaAdmin` para conta só-cliente (L1 = A).

## Behaviors do spec que esta issue fecha
- Completar perfil: "Concluir cria o perfil" (`completarPerfilCliente` → `criar_perfil_cliente`); "Sem aceite →
  nenhuma linha"; "< 18 anos → mensagem"; "Sem endereço → recusado"; "Lojista/admin ativando continua `lojista`";
  "Ativar nunca concede `lojista`"; "Ao concluir, ir para `next` sanitizado ou `/minha-conta`".
- Minha conta: "Ver os próprios dados" (query); "Editar nome, telefone, nascimento"; "opt-in de marketing";
  "Tentar mudar `id`… → sem efeito"; "Sair"; exclusão só-cliente; exclusão lojista/admin+cliente (só o perfil).
- Endereços: listar; adicionar; 4º recusado (mensagem); editar próprio/IDOR; marcar padrão; remover com mínimo 1;
  remover padrão promove o mais antigo.
- Admin: "Admin tenta criar loja para conta só-cliente → mensagem específica".
- RN-09, RN-10 (servidor), RN-13.

## Escopo
- [ ] `src/lib/supabase/queries/clientes.ts`: `buscarPerfilCliente`, `listarEnderecosCliente` (client da sessão).
- [ ] `src/lib/actions/cliente.ts`: `completarPerfilCliente` (rate limit `salvarPerfil`, `aceiteTermos` literal
  true, `VERSAO_TERMOS` do servidor, id de `getUser()`), `salvarPerfilCliente`, `salvarEnderecoCliente`
  (criar/editar), `definirEnderecoPadrao`, `removerEnderecoCliente`, `excluirConta` (schema `.strict()` vazio;
  `anonimizar_cliente` → `deleteUser` só se a conta não tem papel `lojista` nem é admin → `signOut`), `sairCliente`.
- [ ] Troca de padrão atômica (RPC ou duas escritas ordenadas, respeitando o índice único parcial).
- [ ] `src/app/admin/assinantes/actions.ts` (`criarLojaAdmin`): consulta papéis via `service_role` e devolve
  "Este e-mail pertence a uma conta de cliente e não pode ser dono de loja."; o trigger continua sendo a barreira.

## Fora de escopo
- Telas (339). Bloqueio de exclusão com pedido em aberto (decisão 16, Marco C). Troca de e-mail/senha logado.

## Reuso esperado
- Schemas de `src/lib/validacoes/cliente.ts` (336); `sanitizarNext` (336); `VERSAO_TERMOS`
  (`src/lib/constants/termos.ts`); `verificarRateLimit` chave `salvarPerfil`; `buscarPapeisDoUsuario`;
  client `service_role` existente; padrão de `src/lib/actions/perfil*`.

## Segurança
- `cliente_id`/`id` sempre de `auth.uid()` via `getUser()`; payload com id é rejeitado/ignorado.
- Exclusão de lojista+cliente nunca chama `deleteUser` nem remove papel (decisão 15, ADR h/I5).
- Erro interno → mensagem genérica; log sem PII.

## RED (B1 camada servidor + B2 P15 — capturar `FAIL`)
`src/lib/actions/cliente.test.ts`:
- [ ] `excluirConta` age só sobre `auth.uid()` da sessão (payload com outro id → rejeitado, nenhuma chamada com ele).
- [ ] `excluirConta` em conta lojista+cliente → chama `anonimizar_cliente`, **não** chama `deleteUser`.
- [ ] `excluirConta` só-cliente → `anonimizar_cliente` antes de `deleteUser`, depois `signOut`.
- [ ] `completarPerfilCliente` sem `aceiteTermos` → rejeitado, RPC não chamada; versão passada à RPC = `VERSAO_TERMOS`
  mesmo com `versao` no payload (rejeitado por `.strict()`); usuário sem e-mail confirmado → recusado.
- [ ] `salvarEnderecoCliente` com `cliente_id` no payload → rejeitado; 4º endereço → "Você pode ter até 3 endereços.".
- [ ] `removerEnderecoCliente` do último → "Mantenha pelo menos um endereço."
- [ ] `criarLojaAdmin` para conta só-cliente → mensagem L1 (caso novo em teste existente, sem alterar asserções).

## Critério de aceite
- [ ] RED com `FAIL` capturado, depois verde; testes de migration de 335 continuam verdes.
- [ ] `tsc`, lint, suíte e build verdes.

## Dúvidas
- `excluirConta` só-cliente vs admin+cliente: admin vem da env `SAAS_ADMIN_USER_ID`, não de `papeis_usuario`. O spec
  diz "admin+cliente remove só o perfil": confirmar que o teste de "só-cliente" checa também a env de admin.
- "Marcar padrão": spec admite RPC ou duas escritas ordenadas; se for RPC, é migration nova (volta a 335 ou anexa
  migration aqui) — decidir no `planejar`.
