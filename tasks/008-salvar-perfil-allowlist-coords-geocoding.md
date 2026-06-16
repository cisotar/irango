# [008] `salvarPerfil`: allowlist de endereço + geocoding na escrita das coords

**crítica:** SIM (TDD red-first)
**Mundo:** painel (Server Action de escrita)
**Depende de:** 001, 003, 004
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Estender `salvarPerfil` (`lib/actions/loja.ts`): adicionar `endereco_*` à allowlist explícita do patch; após validar e salvar o endereço, geocodificar via Nominatim no servidor e persistir `latitude`/`longitude` (par tudo-ou-nada) — nunca aceitando coords do payload. Retornar sinal de geocoding falho para o cliente avisar (não-bloqueante).

## Escopo
- [ ] Estender a allowlist do patch com `endereco_cep/rua/numero/bairro/cidade/estado` (a partir do dado já validado pelo `schemaPerfil`, issue 004).
- [ ] Após o UPDATE do endereço: chamar `geocodificarEndereco(...)` no servidor.
  - Sucesso → patch separado escreve `latitude` + `longitude` juntos (par).
  - Falha (`null`) → endereço fica salvo **sem coords** (ambos NULL); não bloqueia o salvamento.
- [ ] Tipo de retorno estendido para sinalizar `{ ok: true; geocodificado: boolean }` (ou equivalente) → o cliente mostra toast quando `geocodificado: false`.
- [ ] Coords escritas via client autenticado sob RLS (`lojas_update_proprio`), escopado por `.eq("id", loja.id)` (padrão atual da action).
- [ ] Quando endereço fica incompleto (sem dados suficientes p/ geocodificar), zerar coords para NULL (par) — não deixar coords antigas órfãs de um endereço novo divergente. Avaliar na implementação.

## Fora de escopo
- UI do formulário e o toast em si (issue 009) — aqui só o sinal de retorno.
- Cálculo de frete (issues 006/007).
- Adicionar coords ao `schemaPerfil` (proibido — issue 004 garante a rejeição).

## Reuso esperado
- `geocodificarEndereco.ts` (issue 003) — não chamar Nominatim direto.
- Padrão de allowlist explícita já presente em `salvarPerfil` (RN-A5) — estender a allowlist existente.
- `verificarRateLimit("salvarPerfil", ip)` já no topo da action — mantém.

## Segurança
- RN-1: coords derivadas no servidor; `.strict()` (issue 004) + allowlist explícita rejeitam injeção de `latitude`/`longitude` do cliente. Dupla barreira.
- RN-2: escrita tudo-ou-nada — `(lat,lng)` ambos ou ambos NULL (reforçado pelo CHECK da issue 001).
- §14: falha de geocoding → log genérico; nunca stack trace ao cliente.
- Bug aqui (aceitar coords do payload) → lojista forja localização e vaza/falseia atendimento → crítica.

## Critério de aceite
- [ ] (teste vermelho primeiro) Testes da action com `geocodificarEndereco` mockado:
  - Endereço válido + geocoding ok → coords persistidas (par); retorno `geocodificado: true`.
  - Geocoding `null` → endereço salvo, coords NULL (par); retorno `geocodificado: false`.
  - Payload com `latitude`/`longitude` → rejeitado (não chega ao patch).
  - Dono A não consegue gravar coords da loja do dono B (RLS).
- [ ] `next build` sem erro; `pnpm test` verde.
