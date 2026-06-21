# [081] Página `/painel/configuracoes/assinatura` + componentes

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [078]
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Montar a central de assinatura do lojista: status atual, seleção/troca de plano, forma de pagamento mascarada, histórico de faturas e aviso de estado bloqueado. Todo valor exibido vem do servidor — a UI não calcula preço nem total.

## Escopo
- [ ] Server Component `page.tsx` que lê `lojas.assinatura_*` + `planos` (ativos) + `pagamentos_assinatura` (escopados por RLS) server-side e passa para os componentes.
- [ ] Componentes em `src/components/painel/`:
  - `CartaoStatusAssinatura` (`Card`+`Badge`): status, fim de período, plano, valor (valor do servidor).
  - `SeletorPlano` (`RadioGroup`+`Card`): planos do banco, preço não editável.
  - `BotaoAssinar`/`BotaoTrocarPlano`: dispara Server Action (078).
  - `FormaPagamentoAssinatura`: método mascarado ("cartão final 1234"/"Pix") + botão que leva ao checkout do provider.
  - `TabelaFaturas` (`Table`): histórico de `pagamentos_assinatura` (valor do servidor) + link 2ª via.
  - `AvisoEstadoBloqueado` (`Alert`): quando `suspensa`/`inadimplente`, CTA de regularização.

## Fora de escopo
Lógica de cobrança (já em 078). Cálculo de valor no cliente (proibido). Edição de planos.

## Reuso esperado
- `formatarMoeda` (`src/lib/utils/formatarMoeda.ts`) — não reformatar à mão.
- shadcn/ui (`Card`, `Badge`, `Table`, `RadioGroup`, `Alert`, `Button`).
- `sonner` toast.
- Server Actions de 078.

## Segurança
- Valores exibidos são autoritativos do servidor (lidos do banco, alimentado por webhook). A UI nunca recalcula nem aceita valor do cliente. Método de pagamento sempre mascarado (§Segurança). Como não há lógica de valor própria aqui, não é crítica — a autoridade está nas issues 070/072/077/078.

## Critério de aceite
- [ ] Página exibe status/plano/valor corretos lidos do servidor; faturas listadas via RLS (lojista vê só as próprias).
- [ ] Botões disparam as Server Actions corretas; `suspensa`/`inadimplente` mostram `AvisoEstadoBloqueado`.
- [ ] Nenhum cálculo de preço/total no cliente; método de pagamento mascarado.
- [ ] Responsivo no mobile (mundo painel).
