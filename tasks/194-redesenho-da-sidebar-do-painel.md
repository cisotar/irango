# [194] Redesenho da sidebar do painel

**crítica:** NÃO
**Mundo:** painel
**Depende de:** —
**Origem:** mockup aprovado do agente `desenhar` — `mockups/sidebar-painel.md`
(contrato canônico) e `mockups/sidebar-painel.html` (preview navegável).
Diretriz adicional do usuário: botão "voltar ao hub admin" na sidebar do hub
`/admin/assinantes/[lojaId]`.

## Problema

`src/components/painel/NavPainel.tsx` (alvo único, exporta `SidebarPainel` e
`TopbarPainel`) acumula 12 atritos documentados em `mockups/sidebar-painel.md`
(F1–F12), incluindo um bug real: "Configurações" é hoje um
`<Link href="/painel/configuracoes">` e não existe `page.tsx` nessa rota (só
nas sub-rotas) — clicar no pai dá **404**.

Dois consumidores: `src/app/(painel)/painel/layout.tsx:83-89` (lojista) e
`src/app/admin/assinantes/[lojaId]/layout.tsx:45-47` (hub admin, loja de
terceiro).

## Decisão de escopo — identidade assimétrica, não paridade

F1 (logo+nome+"Ver vitrine" no topo) e F2 (`BadgeStatus` Aberto/Fechado) vão
**só no shell do lojista**. Ficam de fora do hub admin, por dois motivos já
registrados no código:

- F1 duplicaria a faixa persistente da issue 145
  (`admin/assinantes/[lojaId]/layout.tsx:12-22`), que já mostra nome + status
  + aviso, e nos **dois** breakpoints — a sidebar some por breakpoint.
- F2 exige `horarios`+`timezone`. No lojista é grátis (`buscarLojaDoDono` já
  devolve `LojaCompleta`). No admin exigiria alargar `CabecalhoLojaAdmin`
  (issue 099, "cabeçalho LEVE" de propósito) por um sinal que interessa a
  quem vende, não ao operador do SaaS — que já tem Publicada/Não publicada
  na faixa.

| Atrito | Lojista | Hub admin |
|---|---|---|
| F1 identidade no topo | SIM | NÃO |
| F2 `BadgeStatus` | SIM | NÃO |
| F3 accordion (+ fix do 404) | SIM | SIM |
| F4 alvo de toque 48px | SIM | SIM |
| F5 `focus-visible` | SIM | SIM |
| F6 ativo ≠ hover | SIM | SIM |
| F7 barra sem deslocar rótulo | SIM | SIM |
| F8 `aria-label` nos dois `<nav>` | SIM | SIM |
| F9 contador de pedidos | fora (issue 195) | fora (issue 195) |
| F10 rodapé com e-mail da conta | SIM | SIM |
| F11 modo recolhido | fora (issue 196) | fora (issue 196) |
| F12 topbar mobile com identidade | SIM | SIM |

## Diretriz nova — botão "voltar ao hub admin"

Dois "voltar" coexistem, em níveis diferentes, com nomes acessíveis distintos:

- **Mantém** o da faixa amber (`[lojaId]/layout.tsx:54-60`) → `/admin/assinantes`,
  rótulo "Voltar para assinantes" (trocar de loja).
- **Acrescenta** na sidebar, rodapé, acima do `BotaoLogout`, separado por
  `Separator` → `/admin` (hub raiz real, `src/app/admin/page.tsx`), rótulo
  "Voltar ao hub admin".
- Condicionar por campos **primitivos** novos em `ContextoNav`:
  `voltarHref?: string`, `voltarRotulo?: string`. O layout admin passa
  `voltarHref: "/admin"`. O lojista não passa nada → nada renderiza. **Não**
  inferir de `basePath.startsWith("/admin")` — esconderia regra de roteamento
  num componente de apresentação.

## Escopo (arquivos, e só estes)

- [ ] `src/components/painel/NavPainel.tsx` — accordion real (`AccordionTrigger`
      como `<button>`, resolve o 404 de graça), ícone em todos os subitens,
      `focus-visible`, degrau ativo≠hover, barra sem deslocamento, `aria-label`
      nos dois `<nav>`, rodapé com e-mail + `voltarHref`/`voltarRotulo`.
- [ ] `src/components/painel/NavPainel.test.tsx` — ajustar as 3 asserções que
      quebram por design (`links()` só lê `<a>`; o gatilho de Configurações
      vira `<button>`).
- [ ] `src/app/(painel)/painel/layout.tsx` — passa nome/logo/horarios/timezone
      da loja e e-mail da conta para `SidebarPainel`/`TopbarPainel`.
- [ ] `src/app/admin/assinantes/[lojaId]/layout.tsx` — passa
      `voltarHref: "/admin"`, `voltarRotulo: "Voltar ao hub admin"`.

Guard de tema (§0 do mockup): a sidebar **não** consome `lojas.tema`. Cor de
estado de navegação usa só `--sidebar-*` (tokens de sistema, hoje ociosos).

## Critério de aceite

- [ ] `npx tsc --noEmit && npm run lint && npm test && npm run build` verdes.
- [ ] `grep -n "AccordionTrigger" src/components/painel/NavPainel.tsx` casa.
- [ ] Item "Configurações" não é mais `<Link>` — não dá mais 404.
- [ ] Sidebar do lojista mostra logo/nome/status; sidebar do hub admin não.
- [ ] Hub admin mostra "Voltar ao hub admin" → `/admin`; lojista não mostra nada.
- [ ] Default sem `contexto` (nenhuma prop) continua idêntico ao painel do
      lojista de hoje, byte a byte no que não mudou por este escopo.
