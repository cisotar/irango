# [193] Endereço obrigatório no perfil + gate de publicação da loja

**crítica:** NÃO — regra de negócio + UX. Não toca valor monetário nem RLS. Mas altera o
gate de publicação, que hoje é a única trava de "perfil mínimo para ir ao ar".
**Mundo:** painel do lojista (+ admin, se o gate valer lá também)
**Depende de:** `180-A` (entrega primeiro; esta issue reaproveita o estado que a 180-A
deixa exposto). Não é bloqueio duro.
**Origem:** decisão do usuário durante a execução da 180-A. O `revisar` apontou que, com
o aviso de geocoding virando modal bloqueante, uma loja que **nunca preencheu endereço**
passa a ver o modal em **todo** save do perfil — com uma mensagem factualmente errada.

## Contexto — por que isso apareceu

Na 180-A o aviso de falha de geocoding deixou de ser `toast` e virou modal que exige
ação. A condição de disparo não mudou (`if (!resultado.geocodificado)` em
`PerfilClient.tsx`), mas a consequência sim.

Loja sem endereço nenhum → `montarConsultaGeocoding` devolve `null` → coords ficam
`null` → a Server Action responde `geocodificado: false` **sem `motivo`** → a UI cai no
fallback `?? "nao_encontrado"` e exibe:

> *"Não localizamos seu endereço no mapa — confira rua, número e CEP. Zonas por raio
> ficam inativas até corrigir."*

Para quem acabou de criar a loja e está salvando só nome e WhatsApp, a mensagem é
**errada** (não há o que conferir — o endereço nunca foi digitado) e agora **interrompe
todo save**. É exatamente o caminho de onboarding.

Foram consideradas quatro saídas (terceiro estado sem modal, modal com copy de
onboarding, deixar como está, terceiro estado + banner). O usuário escolheu atacar a
causa em vez do sintoma: **se o endereço é necessário para a loja funcionar, ele deve ser
obrigatório — e a loja não deve ir ao ar sem ele.**

## Escopo

1. **Tornar o endereço obrigatório no perfil da loja.** Definir quais campos compõem o
   mínimo — provavelmente o mesmo mínimo geográfico que `montarConsultaGeocoding` já
   exige (`endereco_cidade` + `endereco_estado`), mas a issue deve decidir se rua/número
   também entram, porque o gate atual do geocoder aceita só cidade+UF e isso produz uma
   coordenada grosseira que é o centro de todas as zonas `raio_km`.
2. **Bloquear a publicação sem endereço.** O gate vive em `src/lib/actions/loja.ts:177-180`
   (`if (publicar && (!loja.nome?.trim() || !loja.whatsapp))`, erro
   `ERRO_PERFIL_INCOMPLETO` = *"Complete nome e WhatsApp antes de publicar a loja."*).
   Somar o endereço à condição e atualizar o texto do erro.
3. **Refletir na UI do perfil:** marcar os campos como obrigatórios e validar no schema
   zod (`src/lib/validacoes/loja.ts`), não só no servidor — o servidor continua sendo a
   autoridade, o cliente ganha o feedback.
4. **Com o endereço garantido, revisar o aviso da 180-A:** o ramo "sem endereço nenhum"
   deixa de existir para loja publicada, e o modal volta a significar só o que deve
   significar (falha do serviço ou endereço não localizável).

## Pontos que a issue precisa resolver antes de implementar

- **Lojas já publicadas sem endereço.** O gate só roda na ação de publicar, então elas
  continuam no ar; o bloqueio só morde se despublicarem e tentarem republicar. Decidir:
  aceitar essa assimetria, ou fazer um backfill/aviso dirigido a essas lojas. Levantar
  quantas existem hoje no cloud antes de decidir.
- **O gate é best-effort e está documentado como tal** (`loja.ts:152-161`, débito 140):
  não há trigger de banco protegendo `ativo`, então o dono poderia publicar via PATCH
  direto na própria linha (RLS `lojas_update_proprio` permite). É auto-dano, sem
  cross-tenant nem dinheiro, e já foi aceito como BAIXA. Esta issue **não** precisa
  fechar o débito 140 — mas deve dizer explicitamente se o deixa aberto.
- **O caminho do admin** (`src/app/admin/assinantes/actions/admin-perfil.ts`) tem o mesmo
  gate? Decidir se o admin pode publicar uma loja incompleta em nome do lojista.
- **Impacto no cadastro de loja nova** (`FormNovaLoja.tsx`): o endereço passa a ser
  exigido já na criação, ou só na publicação? Exigir na criação aumenta o atrito do
  funil; exigir só na publicação mantém o cadastro leve.

## Critério de aceite

- [ ] Publicar loja sem o endereço mínimo é recusado no servidor, com mensagem que diz
      quais campos faltam.
- [ ] O schema zod do perfil exige os mesmos campos, e o form marca-os como obrigatórios.
- [ ] Loja já publicada sem endereço tem comportamento definido e documentado (não
      quebra silenciosamente).
- [ ] Teste do gate de publicação cobrindo: sem endereço → recusa; com endereço mínimo →
      publica; nome/WhatsApp ausentes seguem recusando como antes.
- [ ] O modal de aviso de geocoding não aparece mais para loja publicada por ausência de
      endereço — só por falha do serviço ou endereço não localizável.

## Verificação manual

Sem browser automatizável no ambiente: conferir à mão o form do perfil (campos marcados
como obrigatórios, mensagem de validação) e a tentativa de publicar com endereço vazio.
