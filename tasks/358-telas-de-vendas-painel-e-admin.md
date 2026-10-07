# [358] Telas de Vendas: `/painel/vendas`, `/admin/assinantes/[lojaId]/vendas`, gráfico, ranking e item de menu

**crítica:** NÃO
**Mundo:** painel + admin (UI)
**Depende de:** [354] (actions do ciclo + schema zod), [357] (montagem, loaders, queries, limites)
**Spec:** specs/relatorio-vendas.md — §1 (item "Vendas" no menu); §2 behaviors "Ver os avisos", "Ver mensagem genérica
quando a carga falha" e a parte de UI dos demais (filtros na URL, abas, edição do ciclo, itens por categoria);
§2.1 (tabela do ranking, seletor próprio, ordenação via URL, aviso de convidados); §3 behaviors "Ver a parte
financeira", "Não ver o ranking nem a rota de clientes", "Ver mensagem genérica"; fecha **RN-V20 (estrutura de
componentes), RN-V22, RN-V23 (UI), RN-V24**

## Objetivo
Montar as duas telas sobre os dados prontos da issue 357: um `RelatorioVendas` compartilhado pelo painel e pelo
admin, o `RankingClientesFieis` só no painel, e o item "Vendas" logo após "Dashboard" no menu dos dois mundos.

## Escopo
- [ ] `src/components/painel/NavPainel.tsx` — item **Vendas** após **Dashboard** em `construirItens` (:119),
      `href = ${base}/vendas`, ícone lucide de gráfico de barras. `rotasAusentes` do admin
      (`src/app/admin/assinantes/[lojaId]/layout.tsx:57`) **não** ganha `"vendas"`; `"clientes"` continua lá.
- [ ] `src/app/(painel)/painel/(bloqueavel)/vendas/page.tsx` — Server Component: `buscarLojaDoDono` → zod dos
      `searchParams` → montagem da 357 com o client da sessão → `RelatorioVendas` + `RankingClientesFieis` ao lado.
- [ ] `src/app/admin/assinantes/[lojaId]/vendas/page.tsx` — `carga-vendas.ts` → `RelatorioVendas` com `basePath` admin
      e `acoes.salvarCiclo = salvarCicloVendasAdmin` fixado em closure com `lojaId`. Não importa
      `RankingClientesFieis`.
- [ ] `src/components/painel/RelatorioVendas.tsx` (compartilhado; default = lojista) com: avisos fixos (RN-V22),
      `FiltrosVendas` (escreve a URL; presets e tipo de entrega em `ToggleGroup`, datas em `Input type="date"`, toggle
      "só concluídos"), `CicloMensal` (intervalo explícito + edição 1..28 com `react-hook-form` + schema da 354),
      `ResumoFaturamento` (bruto, descontos, líquido, frete + "N pedidos com frete a combinar, não somados"),
      `GraficoBarrasVendas` (CSS/SVG, abas Diário/Semanal/Mensal como estado interno), `ItensPorCategoria` (com a nota
      "O desconto é do pedido e não é dividido entre os itens").
- [ ] `src/components/painel/RankingClientesFieis.tsx` (só painel): seletor Semana/Mês/Ano/Desde o início e ordenação
      escritos na URL com parâmetros próprios; tabela nome, nº de pedidos, total gasto, último pedido, até 3 itens; "N
      pedidos de convidados fora do ranking".
- [ ] Estado de erro: "Não foi possível carregar o relatório. Tente de novo." sem detalhe técnico; aviso discreto
      quando o filtro da URL foi trocado pelo padrão.
- [ ] Teste de render (environment node) dos componentes com totais fixos e do item de menu nos dois mundos.

## Fora de escopo
- Qualquer cálculo de valor, limite de período ou ordenação no cliente (tudo vem da 357; o ranking chega já ordenado).
- Export CSV (issue 359).
- Componente shadcn ausente escrito à mão (`tabs`, `select`): só pelo shadcn CLI, se preciso.
- Mexer no Dashboard.

## Reuso esperado
- `CabecalhoPagina` (`components/painel/CabecalhoPagina.tsx`), `Card`/`CardHeader`/`CardContent`,
  `components/ui/toggle-group`, `components/ui/input`, `components/ui/switch`.
- `formatarMoeda` (`lib/utils/formatarMoeda.ts:20`) e `formatarDataHora`/`fusoLoja` para datas.
- Padrão de parametrização painel/admin (`basePath` + `acoes`) e wrappers `*AdminClient` existentes.
- Schema zod do ciclo (354) no `react-hook-form`; nenhum schema novo para o ciclo.
- `references/design-system.md` §5 e §10.2 (cards brancos, contraste).

## Segurança
- Nenhum valor monetário é calculado nem enviado pelo cliente; a tela só exibe números do servidor.
- O admin não renderiza nem carrega o ranking (estrutura, RN-V20); nenhum telefone/e-mail na tabela.
- Mensagem genérica na UI; detalhe só no log do servidor (RN-V23).

## Critério de aceite
- [ ] "Vendas" aparece logo abaixo de "Dashboard" no painel e no hub admin, ativo em `/…/vendas`.
- [ ] `/painel/vendas` responde 200 para lojista com assinatura ok e redireciona para
      `/painel/assinatura-bloqueada` quando bloqueada (herda `(bloqueavel)`).
- [ ] Avisos "Este relatório cobre só as vendas feitas pelo iRango." e "Os valores são nominais: o iRango não
      registra se o pedido foi pago." visíveis nas duas telas.
- [ ] Trocar preset, tipo de entrega ou "só concluídos" muda a URL e os números; trocar a aba do gráfico não muda a URL.
- [ ] Gráfico: cada barra com rótulo de valor em texto + `aria-label`; contraste ≥ 3:1 contra o card;
      `npm ls` sem pacote novo (RN-V24).
- [ ] Ciclo: "Ciclo atual: 05/out a 04/nov" para dia 5 em 07/out/2026; salvar 29 mostra erro de validação; salvar 5
      atualiza o intervalo (painel e admin).
- [ ] Page admin não importa `RankingClientesFieis` (asserção de import no teste) e `"clientes"` segue em
      `rotasAusentes`.
- [ ] Falha simulada da carga → mensagem genérica, sem texto do Postgres.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test` e `npm run build` verdes.
