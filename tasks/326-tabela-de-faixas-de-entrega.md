crítica: SIM

## Pedido

> Implementar o item 3 do plano arquivado plan/arquivo/loop-frete-faixas-e-edicao-de-zona.md: refatoração de layout da tela /painel/configuracoes/entregas conforme o mockup já aprovado pelo usuário em mockups/entregas-faixas-km.html (frame de aviso raio vs. CEP/bairro; tabela incremental de faixas de km com seletor de incremento 1 ou 2 km; preço e frete grátis por faixa; switch de ativa; limite de entrega derivado da última faixa ativa; aviso de preço fora de ordem; estado vazio).

Mockup: `mockups/entregas-faixas-km.html` (não editar). Plano de origem: `plan/arquivo/loop-frete-faixas-e-edicao-de-zona.md:39-44,247-251,299-300`.

Itens 1 e 2 do plano de origem já entregues: `3828942 fix(181)` (faixa exclusiva em `calcularFrete.ts:101-174`) e `f30837f fix(182)` (`20260909120000_taxas_entrega_zona_id_unique.sql`). Este loop resolve o item 3 e responde `tasks/325-configuracao-entregas-sem-alternancia-entre-formas.md` com "só raio é oferecido".

Contexto de negócio: nenhuma loja em produção usa `bairro` nem `faixa_cep`. Zonas `raio_km` existem com `raio_max_km` arbitrário e precisam continuar cobrando o mesmo preço depois da migração de tela.

## Decisões (D1–D8)

- **D1** salvar em lote, atômico: RPC nova `public.salvar_faixas_entrega(p_loja_id uuid, p_incremento int, p_faixas jsonb)`, `SECURITY INVOKER`, filtro `loja_id = p_loja_id` explícito no corpo (padrão `references/seguranca.md:433-463`, template `supabase/migrations/20260928131000_rpc_frequencia_produtos.sql`). Uma transação: apaga TODAS as zonas da loja (qualquer tipo; cascata em `taxas_entrega`/`bairros_zona`) e insere as faixas.
- **D2** servidor deriva, cliente não manda: `raio_max_km = posição × incremento`, `nome = "<de>–<até> km"`, `tipo = 'raio_km'`, `cep_* = null`. Payload só tem `incremento` e, por faixa, `taxa` e `pedido_minimo_gratis`; `ativo = true` sempre (C2). Nome derivado elimina colisão com os sentinelas comparados em `EtapaEntrega.tsx:198-205` via `zona_nome` (`frete.ts:231`).
- **D3** `calcularFrete.ts` NÃO muda. Nenhuma tabela muda. Uma migration só com a função.
- **D4** leitura das zonas existentes, função pura `lerFaixas(zonas)` em `src/lib/utils/faixasEntrega.ts`:
  - sem zonas → tabela vazia, incremento 1;
  - todas `raio_km`, com taxa, tetos das ATIVAS todos inteiros → expande em faixas de 1 km (ou de 2 km se todos pares) cujo preço/grátis vem de `calcularFrete` na distância = teto da faixa (reuso, não reimplementar). Zonas inativas não entram na expansão e aparecem no aviso de legado;
  - qualquer outra coisa (teto decimal, `bairro`, `faixa_cep`) → tabela vazia + aviso listando as zonas atuais, que seguem valendo até o Salvar;
  - nada é gravado ao abrir a tela; só o Salvar grava.
- **D5** incremento: trocar com faixas na tela abre AlertDialog "apaga as faixas desta tela; nada muda na vitrine até salvar" e limpa a tabela local. Sem remapeamento de preço.
- **D6** admin recebe a mesma tela sem código de UI próprio: `EntregasAdminClient.tsx:35-48` já reusa `EntregasClient`; só troca o contrato `acoes`.
- **D7** copy do limite e do estado vazio é derivada do estado real: se `taxaForaZona != null`, "acima disso cobra R$ X (fora da área)"; senão o texto do mockup. Reusar `entregaDisponivel` (`modalidadesEntrega.ts:26`).
- **D8** fora de escopo, vira issue em `tasks/` na higiene: remover `FormZona.tsx`, `montarPayloadZona`/helpers de CEP e as Server Actions de zona órfãs (`criarZona`/`atualizarZona`/`alternarZonaAtiva`/`removerZona`/`salvarZona`); aviso no painel para loja sem coordenadas.

## Respostas do usuário (2026-09-27) — C1–C5

- **C1** aviso de preço fora de ordem: MANTIDO, não bloqueante. O preço deve crescer com o raio; se uma faixa tiver preço menor que o MAIOR preço entre as faixas anteriores, a linha mostra o quadro amarelo do mockup (`entregas-faixas-km.html:321-328`, `role="status"`, `aria-describedby` no input), citando a faixa anterior mais cara, mas o Salvar continua liberado e o servidor aceita o valor. Copy nova (a do mockup descreve a regra antiga de menor preço entre as que atendem e NÃO pode ser usada): "Confira o preço: está menor que o da faixa de `<de–até>` km (R$ X). Quem está a `<de–até desta faixa>` km vai pagar R$ Y." Casos de teste: 4/6/5 → alerta na 3ª citando 1–2 km; 4/6/6 → sem alerta; 4/6/5/5 → alerta na 3ª e na 4ª. Só na tela; RPC e schema não validam ordem de preço.
- **C2** lojista NÃO pode pular faixas. Sem switch de "ativa" por faixa: a coluna "Ativa" do mockup e o switch mobile saem. Toda faixa gravada é `ativo = true`; o payload não tem `ativo`. Para reduzir a área, o lojista remove a última faixa. `calcularFrete` não muda.
- **C3** lixeira só na última faixa.
- **C4** zona antiga "até 7 km R$8": abre como 7 faixas de 1 km a R$8 (preço igual ao de hoje), gravadas só se o lojista salvar. Teto decimal ou bairro/CEP: tabela vazia + aviso com as zonas atuais.
- **C5** `tasks/325` é resolvida por este loop: removida na higiene.

## Risco por fatia

| fatia | superfície | prova |
|---|---|---|
| F1 RPC `salvar_faixas_entrega` | `loja_id`, autorização, valor, atomicidade | `tests/migrations/rpc_salvar_faixas_entrega.test.ts`: (a) dono salva 3 faixas inc 1 → 3 zonas `raio_km` com `raio_max_km` 1/2/3, nomes derivados, taxas gravadas; (b) inc 2 → tetos 2/4/6; (c) dono A com `p_loja_id` de B, lista vazia E lista cheia → exceção, afirmar fragmento da mensagem além do SQLSTATE, zonas de B intactas; (d) `asAnon` → permissão negada; (e) `asService` com loja A → só A muda, B intacta; (f) taxa negativa, taxa 4.555, grátis negativo, inc 3, 31 faixas → exceção e estado ANTERIOR intacto (atomicidade); (g) zonas `bairro`/`faixa_cep` antigas da loja somem com os bairros (cascata); (h) item com chave `raio_max_km`/`nome`/`loja_id`/`ativo` é ignorado — teto vem da posição, toda faixa grava `ativo = true` (C2) |
| F2 zod + actions lojista/admin | valor, `loja_id`, autorização admin | `entrega.test.ts`: `.strict()` recusa `raio_max_km`/`nome`/`loja_id`/`zona_id` extras, `valorFrete` em taxa e grátis, inc ∈ {1,2}, 0..30 faixas. `entrega.faixas.test.ts`: payload inválido não chama `createClient`; loja vem de `buscarLojaDoDono`, `rpc` recebe `p_loja_id = loja.id`; erro do banco → mensagem genérica. `admin-entrega.test.ts`: lojaId inválido recusado antes de `prepararContextoAdmin`; zod antes da elevação; `rpc` com `p_loja_id` do lojaId validado. Gates existentes: `enforcement-escopo-admin.test.ts`, `enforcement-props-action-admin.test.ts` verdes |
| F3 `lerFaixas` (abre zonas antigas) | valor (pré-preenchimento não pode mudar preço) | `faixasEntrega.test.ts`: equivalência — para zonas legadas de tetos inteiros (ex.: 3 km R$5 + 7 km R$8 + 7 km R$9 empate + inativa 10 km R$1), `calcularFrete(legado, d)` === `calcularFrete(faixasExpandidas, d)` para d = 0,01 até teto máx em passos de 0,01 e subtotais abaixo/acima do grátis; teto 2,5 → legado; `bairro` presente → legado; vazio → inc 1 sem faixas |
| F4 tela `TabelaFaixasEntrega` | nenhuma de segurança (servidor rederiva tudo); risco de copy mentir sobre preço | helpers puros em `faixasEntrega.test.ts`: rótulo `de–até`, limite = teto da última faixa, detecção de preço menor que o maior anterior (C1), copy do alerta, texto do limite com e sem `taxaForaZona` (D7). Gesto: checklist do usuário |
| F5 tipos à mão | contrato RPC ↔ TS | após `db push`, `npx supabase gen types typescript > src/lib/database.types.ts` e diff sem alteração real na entrada `salvar_faixas_entrega` |

## Caminho do mockup

`mockups/entregas-faixas-km.html` (referência de estrutura e copy; preservado intacto).

## Iteração 2 — retorno do checklist do usuário (2026-09-27)

Checklist: itens 1, 7 e 9 ok; 8 fica para produção. As decisões abaixo **substituem** C2, C3 e C5.

- **C2' faixa desligável, sem buraco.** Cada linha tem switch "Ativa", colado à direita. Desligar a faixa `i`
  desliga `i` e todas as abaixo, com modal "ATENÇÃO, esta faixa e todas as faixas abaixo serão desligadas."
  Ligar uma faixa desligada `i` liga da primeira desligada até `i`, com modal de confirmação
  (ex.: 2–3, 3–4, 4–5 desligadas; ligar 4–5 liga as três). Invariante: as faixas ativas formam um
  prefixo — nenhuma ativa depois de uma desligada. O payload volta a ter `ativo` por faixa; zod e RPC
  recusam faixa ativa depois de desligada. Limite de entrega = teto da última faixa ATIVA.
- **C3' lixeira em todas as linhas**, colada à direita. Lixeira na faixa `i` apaga `i` e todas as abaixo,
  com modal "ATENÇÃO, esta faixa e todas as faixas abaixo serão deletadas."
- **C5' issue 325 NÃO é resolvida.** CEP e bairro voltam depois (débito registrado na 325); faixas de km
  é a forma sugerida. A 325 fica em `tasks/`.
- **C6 salvamento automático, sem botão Salvar.** Grava ao sair do campo de preço ou de frete grátis, ao
  ligar/desligar um switch, ao adicionar e ao remover faixa. Nunca grava valor pela metade: faixa com
  preço vazio ou inválido não dispara gravação e mostra o erro na linha. Estado visível
  "Salvando…"/"Salvo". A confirmação de substituir zonas antigas (D4) aparece na primeira gravação.
- **C7 máscara de moeda** nos campos de preço e frete grátis: duas casas decimais automáticas, vírgula
  decimal (reusar o `IMaskInput` com `mask={Number}` de `src/components/painel/RegistrarFreteCombinado.tsx`).
- **C8 visual:** colunas ocupam a largura do card com espaçamento generoso; o switch de frete grátis tem
  rótulo visível "Frete grátis" junto dele; o switch "Ativa" e a lixeira ficam à direita.
- **C1 (ajuste):** o alerta de preço compara só faixas ativas.
- **D4 (ajuste):** zonas já gravadas no formato da RPC (nome derivado, tetos contíguos do incremento)
  abrem com o `ativo` de cada zona, inclusive o final desligado. O caminho de legado não muda.
