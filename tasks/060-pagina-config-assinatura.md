# [060] Página `/painel/configuracoes/assinatura` (status read-only + portal Hotmart)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 016, 023, 050
**Spec:** specs/spec_irango_mvp.md (Adendo — Configurações — Assinatura)

## Objetivo
Tela somente leitura onde o lojista vê o estado atual da assinatura (status, período vigente) e clica para gerenciar o pagamento no portal do assinante Hotmart. Nenhuma mutation no iRango. Também a tela `/painel/assinatura-bloqueada` de reativação.

## Escopo
- [ ] Criar `src/app/(painel)/painel/configuracoes/assinatura/page.tsx` (Server Component)
- [ ] Ler campos de assinatura da loja do lojista autenticado via query de loja (023) — RLS `lojas_leitura_propria`
- [ ] `CardStatusAssinatura` (reusa shadcn/ui `Card` + `Badge`): badge colorido por status (`trial`/`ativa`/`inadimplente`/`cancelada`/`suspensa`), `assinatura_inicio` e `assinatura_fim_periodo` formatados
- [ ] `BotaoGerenciarHotmart` (reusa shadcn/ui `Button`): link externo para o portal do assinante Hotmart (**confirmar URL na doc oficial Hotmart**), abre em nova aba (`target="_blank" rel="noopener"`)
- [ ] Criar `src/app/(painel)/painel/assinatura-bloqueada/page.tsx` — tela de reativação (status + mesmo botão Hotmart), acessível mesmo com assinatura inválida (exceção de rota do guard, issue 016)
- [ ] Nenhuma Server Action que altere `status`/datas (tela read-only — RN-A5)

## Fora de escopo
Guard que bloqueia o painel (016). Webhook que grava o estado (057). Banner de carência no layout (faz parte de 016/050).

## Reuso esperado
- Query de loja (023), `formatarMoeda`/formatação de data existente, shadcn/ui `Card`/`Badge`/`Button`
- Não recriar leitura de loja

## Segurança
- Read-only: ausência de mutation + RLS (UPDATE de assinatura só por `service_role` no webhook) — RN-A5
- Não exibe nem guarda dado de cartão (fica na Hotmart)
- `hotmart_subscriber_code` é identificador, não credencial; pode ser exibido ao próprio dono

## Critério de aceite
- [ ] Lojista vê o status correto e o período vigente da própria loja
- [ ] Botão abre o portal Hotmart em nova aba; nenhuma mutation disparada no iRango
- [ ] `/painel/assinatura-bloqueada` renderiza com assinatura inválida (não é bloqueada pelo guard)
