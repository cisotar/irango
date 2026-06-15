# Design System — iRango

**Versão:** 0.1.0 | **Atualizado:** 2026-06-13

> Referência de design e UI. Leia antes de criar qualquer componente ou tela. Garante consistência visual entre os dois mundos do produto: a vitrine pública (cliente final, mobile-first, sem login) e o painel do lojista (gestão, desktop-friendly mas responsivo). Itens marcados como **proposta** ainda não estão fundamentados no spec/architecture e precisam de revisão antes de virarem regra.

---

## Sumário

1. [Princípios](#1-princípios)
2. [Os Dois Mundos](#2-os-dois-mundos)
3. [Stack de UI](#3-stack-de-ui)
4. [Tema por Loja](#4-tema-por-loja)
5. [Acessibilidade (WCAG AA)](#5-acessibilidade-wcag-aa)
6. [Padrões de Interação](#6-padrões-de-interação)
7. [Componentes Compartilhados](#7-componentes-compartilhados)
8. [BadgeStatus — Cores por Status](#8-badgestatus--cores-por-status)
9. [Espaçamento, Raio e Tipografia](#9-espaçamento-raio-e-tipografia)
10. [Convenções de Nomenclatura](#10-convenções-de-nomenclatura)

---

## 1. Princípios

1. **Mobile-first na vitrine.** O cliente final compra pelo celular, em segundos, sem login. A vitrine é desenhada primeiro para telas pequenas; desktop é aprimoramento progressivo.
2. **Reuso antes de criação.** Antes de propor componente, variante ou token novo: verificar shadcn/ui (`components/ui/`), os componentes do projeto (`components/vitrine/`, `components/painel/`) e os tokens em `src/app/globals.css` (`@theme`). Padrão já existente vence padrão novo (architecture.md §8).
3. **Componente shadcn não se edita.** `components/ui/` é gerado pelo CLI do shadcn/ui — alterações são feitas via composição ou props, nunca editando o arquivo gerado (architecture.md §3, §8).
4. **Cor da vitrine é do lojista.** O branding da vitrine vem da config da loja (`lojas.tema`). Não hardcodar cor de marca em componente de vitrine — consumir via CSS custom property.
5. **Preview é estética; valor é do servidor.** Frete, desconto e total exibidos no carrinho/checkout são estimativa de UX. O valor cobrado é sempre o recalculado pela Server Action (architecture.md §6, spec RN-05). A UI deve deixar o caráter de estimativa claro.
6. **Português no domínio.** Nomes de componente e de campo seguem o idioma do código de domínio: português, com exceções técnicas universais em inglês (architecture.md §8).

---

## 2. Os Dois Mundos

| Mundo | Rota | Público | Auth | Diretriz de design |
|-------|------|---------|------|--------------------|
| Vitrine pública | `/loja/[slug]` | cliente final | sem login | mobile-first, decisão rápida, tema da loja, carrinho sempre acessível |
| Painel do lojista | `/painel/*` | dono da loja | obrigatório | desktop-friendly mas responsivo, gestão, tabela densa OK, ação visível |

**Vitrine.** Hierarquia simples: ver produto, adicionar, finalizar. CTA primário ("Adicionar", "Finalizar pedido") dominante. Total e frete óbvios antes de finalizar. O tema visual vem da loja — ver §4.

**Painel.** Densidade de informação é aceitável (tabelas de produtos, cupons, pedidos). No mobile, tabela vira lista de cards, nunca scroll horizontal (**proposta** — ver §9). Ação destrutiva sempre confirma o que será excluído (ver §6).

Componentes nascem dentro do mundo a que pertencem (`components/vitrine/` ou `components/painel/`). O único compartilhado entre mundos hoje é `BadgeStatus` — ver §7.

---

## 3. Stack de UI

Fonte: architecture.md §2 e §7, spec "Stack Tecnológica". Não introduzir lib de UI fora desta lista sem revisão.

| Função | Lib | Observação |
|--------|-----|------------|
| Estilização | **Tailwind CSS v4** | utility-first; tokens CSS-first em `src/app/globals.css` (`@theme`), sem `tailwind.config.ts` |
| Componentes | **shadcn/ui** (Radix UI + Tailwind) | gerados pelo CLI em `components/ui/` — não editar |
| Ícones | **lucide-react** | já usado pelo shadcn — consistência garantida |
| Toast | **sonner** | feedback de sucesso/erro |
| Forms | **react-hook-form** + **zod** | mesmo schema no client e na Server Action |
| Color picker | **react-colorful** | só na tela de tema (`/painel/configuracoes/tema`) |
| Máscaras de input | **react-imask** | CEP, telefone, WhatsApp |

**Regra de origem do componente.** Primeiro tentar um primitivo shadcn (`Button`, `Input`, `Card`, `Dialog`, `AlertDialog`, `Select`, `Tabs`, `Switch`, `Form`, etc.). Só compor um componente de domínio (`components/vitrine/`, `components/painel/`) quando o primitivo não cobre o caso ou quando o padrão aparece em 2+ lugares (architecture.md §8).

---

## 4. Tema por Loja

Cada loja personaliza **três cores** da vitrine, salvas em `lojas.tema` (JSONB) e configuradas em `/painel/configuracoes/tema` (spec "Configurações — Tema"; architecture, modelo de dados `lojas`).

```jsonc
// lojas.tema
{
  "primaria": "#RRGGBB",  // cor de marca: CTA, links, destaque de ação
  "fundo":    "#RRGGBB",  // cor de fundo da vitrine
  "destaque": "#RRGGBB"   // cor de ênfase secundária (badges de marca, realces)
}
```

### Validação (servidor)

Os três valores são validados na Server Action como hexadecimal `#RRGGBB` (regex) antes do UPDATE. Cor inválida é recusada — sem risco de injeção de CSS (spec "Configurações — Tema", camada de segurança).

### Aplicação via CSS custom properties

As cores são injetadas no `<head>` da vitrine durante o **SSR** e expostas como CSS custom properties. `HeaderLoja.tsx` e `CardProduto.tsx` consomem essas variáveis — nunca cor hardcoded (spec behavior "Aplicar tema na vitrine").

Nomenclatura das variáveis (**proposta** — padronizar antes de implementar):

| Variável CSS | Origem (`lojas.tema`) | Uso |
|--------------|-----------------------|-----|
| `--cor-primaria` | `primaria` | CTA, links, realce de ação na vitrine |
| `--cor-fundo` | `fundo` | fundo da vitrine |
| `--cor-destaque` | `destaque` | ênfase secundária (badge de marca, realce) |

Consumo em componente de vitrine (**proposta** de padrão):

```tsx
// CardProduto.tsx — cor de marca vem da loja, nunca hardcoded
<button className="bg-[var(--cor-primaria)] text-white ...">Adicionar</button>
```

### Valores de fallback (**proposta**)

Loja recém-criada tem `nome` vazio e pode não ter tema configurado (spec "Cadastro"). Definir defaults neutros para a vitrine nunca renderizar sem cor:

| Variável | Default proposto | Racional |
|----------|------------------|----------|
| `--cor-primaria` | `#2563eb` | azul neutro, contraste AA sobre branco |
| `--cor-fundo` | `#ffffff` | branco |
| `--cor-destaque` | `#16a34a` | verde neutro |

> Os valores acima são **proposta** — confirmar na revisão. O importante é que exista fallback determinístico aplicado no SSR quando `lojas.tema` estiver ausente ou incompleto.

### Contraste do tema custom — risco conhecido

O lojista escolhe as cores; elas **podem falhar contraste**. Caso clássico: `primaria` clara sobre `fundo` branco em texto/CTA → contraste abaixo de 4.5:1.

- **Não** confiar só na cor escolhida para legibilidade de texto.
- Texto sobre `--cor-primaria` deve usar uma cor de texto de alto contraste fixada pelo componente (ex.: branco), não derivada do tema.
- **Proposta:** na tela de tema, avisar o lojista quando a combinação `primaria`×`fundo` ficar abaixo do mínimo AA (aviso de UX, não bloqueio), e/ou aplicar uma cor de texto automática (preto/branco) conforme a luminância da cor de fundo do botão. Decidir na revisão.

---

## 5. Acessibilidade (WCAG AA)

Critério de aceite de toda tela. Referência: spec (forms com label, validação) e princípios de usabilidade do produto.

- **Alvo de toque ≥ 44×44px** em todo elemento interativo da vitrine mobile (botões "Adicionar", controles de quantidade, "Finalizar pedido").
- **Contraste mínimo 4.5:1** para texto normal, 3:1 para texto grande. Atenção redobrada ao tema custom da loja — ver §4 ("Contraste do tema custom").
- **Foco visível** em todo interativo: `focus-visible:ring-2` (**proposta** de padrão consistente, alinhado ao default do shadcn).
- **Label em todo input.** Forms usam o componente `Form` do shadcn (react-hook-form), que já vincula `<label>` ao campo. Erro de validação com `aria-invalid` + `aria-describedby` apontando para a mensagem.
- **`aria-label` em ícone sem texto** (botões de ação que usam só ícone lucide-react, ex.: remover item, editar).
- **Modal acessível:** usar `Dialog`/`AlertDialog` do shadcn (Radix) — já entregam `role="dialog"`, foco preso e fechamento por ESC. Não recriar modal ad-hoc.
- **Não depender só de cor.** `BadgeStatus` e badges de disponibilidade combinam **cor + texto** (ex.: "Aberto agora", "Indisponível") — ver §8.

---

## 6. Padrões de Interação

Fonte: spec (behaviors e camadas de segurança) e architecture.md §6.

### Forms

- Toda validação usa **react-hook-form + zod**, com o **mesmo schema** no client (UX) e na Server Action (segurança) — schemas em `lib/validacoes/` (architecture.md §6, §8; spec RN-05..RN-11).
- Sanitização de UX no client (ex.: slug) não substitui a validação autoritativa do servidor.

### Feedback

- **Toast (sonner)** para sucesso e erro de mutation (ex.: "Loja criada! Configure seu perfil." no cadastro — spec).
- **Loading no submit:** botão em estado de carregamento durante a Server Action (**proposta** de padrão — desabilitar e indicar progresso para evitar duplo envio).
- **Erro com retry** quando a ação pode ser repetida (ex.: falha de rede ao finalizar pedido) (**proposta**).

### Confirmação destrutiva

- Toda ação destrutiva no painel (remover produto, categoria, cupom, zona) usa **`AlertDialog`** do shadcn, deixando claro **o que** será excluído e seus efeitos (spec: "DialogConfirmacaoRemocao", remoção de categoria avisa que produtos ficam sem categoria).

### Reversibilidade na vitrine

- Remover item do carrinho e alterar quantidade são triviais e imediatos (controles de +/− por produto; remover ao zerar) (spec "Vitrine Pública", behaviors do carrinho).

### Estado de carrinho

- Carrinho é estado local (`hooks/useCarrinho.ts`), persistido em `sessionStorage` para sobreviver a refresh (spec). O carrinho deve estar sempre acessível na vitrine (drawer/sidebar).

### Empty states (**proposta**)

- Loja sem produtos, carrinho vazio, painel sem pedidos: exibir texto + CTA, nunca tela em branco. Confirmar copy na revisão.

### Máscaras

- CEP, telefone e WhatsApp usam **react-imask**. WhatsApp é salvo no formato `5511999999999` (sem espaços/hífens) — a máscara é só apresentação (spec "Perfil da Loja").

---

## 7. Componentes Compartilhados

Tabela autoritativa em architecture.md (§"Componentes Compartilhados") e spec. Resumo:

| Componente | Localização | Mundo | Papel |
|------------|-------------|-------|-------|
| `ui/*` | `components/ui/` | ambos | primitivos shadcn (gerado pelo CLI — não editar) |
| `HeaderLoja` | `components/vitrine/HeaderLoja.tsx` | vitrine | nome, logo, BadgeStatus; consome tema da loja |
| `BadgeStatus` | `components/vitrine/BadgeStatus.tsx` | vitrine **e** painel | status (loja aberta/fechada; status de pedido) |
| `CardProduto` | `components/vitrine/CardProduto.tsx` | vitrine | foto, nome, descrição, preço, "Adicionar"; consome tema |
| `Carrinho` | `components/vitrine/Carrinho.tsx` | vitrine | itens, subtotal, cupom, frete, total, "Finalizar pedido" |
| `TabelaProdutos` | `components/painel/TabelaProdutos.tsx` | painel | catálogo com ações |
| `FormProduto` | `components/painel/FormProduto.tsx` | painel | criar/editar produto |
| `FormCupom` | `components/painel/FormCupom.tsx` | painel | criar/editar cupom |
| `TabelaPedidos` | `components/painel/TabelaPedidos.tsx` | painel | lista de pedidos (dashboard e gestão) |

**`BadgeStatus` é o único componente que cruza os dois mundos.** Ele cobre tanto o status de funcionamento da loja na vitrine ("Aberto agora" / "Fechado") quanto o status de pedido no painel (badge colorido na `TabelaPedidos`). Suas cores **não** vêm do tema da loja — são cores de sistema (ver §8).

---

## 8. BadgeStatus — Cores por Status

`BadgeStatus` comunica **estado do sistema**, não branding. Por isso suas cores são **fixas, independentes do `lojas.tema`** — o status precisa significar a mesma coisa em qualquer loja. Todo badge combina **cor + texto + (opcional) ícone**, nunca cor sozinha (WCAG — §5).

### 8.1 Status de funcionamento da loja (vitrine)

Calculado por `lib/utils/lojaAberta.ts` + `hooks/useLojaAberta.ts` (spec).

| Estado | Texto | Cor (**proposta**) | Racional |
|--------|-------|--------------------|----------|
| Aberta | "Aberto agora" | verde | convenção de disponibilidade |
| Fechada | "Fechado" (+ horário de reabertura) | cinza/neutro | ausência de atividade, não erro |

### 8.2 Status de pedido (painel)

Máquina de estados da spec RN-08: `pendente → confirmado → em_preparo → saiu_entrega → entregue`; cancelamento a partir de `pendente`, `confirmado` ou `em_preparo`.

Mapa semântico de cor (**proposta** — revisar antes de fixar como token):

| Status (`pedidos.status`) | Rótulo exibido | Cor semântica | Racional |
|---------------------------|----------------|---------------|----------|
| `pendente` | Pendente | âmbar / amarelo | requer ação do lojista |
| `confirmado` | Confirmado | azul | aceito, em fila |
| `em_preparo` | Em preparo | índigo / roxo | trabalho em andamento |
| `saiu_entrega` | Saiu pra entrega | ciano / azul-claro | em trânsito |
| `entregue` | Entregue | verde | sucesso, terminal |
| `cancelado` | Cancelado | vermelho/neutro | encerrado sem sucesso |

Diretrizes do mapa:

- **Consistente** em todo o painel (dashboard e `/painel/pedidos`) — uma cor por status, sempre a mesma.
- **Independente do tema da loja.** Estas cores são tokens de sistema, não CSS custom properties do tema.
- **Proposta de implementação:** registrar essas cores como tokens semânticos no `@theme` de `src/app/globals.css` (ex.: `--color-status-pendente`, `--color-status-confirmado`, …) para não espalhar hex pelo componente. Decidir nomes e valores exatos na revisão.
- Verificar contraste AA de cada cor com o texto do badge antes de fixar (§5).

---

## 9. Espaçamento, Raio e Tipografia

> Tudo nesta seção é **proposta**. Os tokens-base do iRango já vivem no `@theme` de `src/app/globals.css`; esta seção alinha a escala antes de fixar valores adicionais.

### Espaçamento (**proposta**)

Usar a escala padrão do Tailwind (múltiplos de 4px / `0.25rem`). Não criar valores fora da escala. Espaçamento de layout consistente entre telas do mesmo mundo.

### Raio (**proposta**)

Raio único e consistente, alinhado ao default do shadcn (`--radius`). Vitrine e painel compartilham o mesmo raio para coerência da marca iRango.

### Tipografia (**proposta**)

Escala tipográfica do Tailwind. Base rem = **19.2 px** (`html { font-size: 120% }` em `globals.css` — escala todos os tamanhos Tailwind uniformemente). Hierarquia clara: na vitrine, nome do produto e preço têm peso/tamanho que dominam a descrição; CTA legível em mobile.

### Responsividade (**proposta**)

- Vitrine funciona a partir de 360px de largura.
- No painel mobile, **tabela vira lista de cards** — sem scroll horizontal. `TabelaProdutos`, `TabelaPedidos` e `TabelaCupons` precisam de variante card-list no mobile.

---

## 10. Convenções de Nomenclatura

Fonte: architecture.md §8 (idioma português no domínio) e §3 (estrutura de pastas).

- **Componentes em PT-BR, PascalCase:** `CardProduto`, `HeaderLoja`, `FormCupom`, `TabelaPedidos`, `BadgeStatus`. Termos técnicos universais permanecem em inglês quando não há tradução natural (architecture.md §8).
- **Localização por mundo:**
  - `components/ui/` — primitivos shadcn, gerados pelo CLI, **não editar**.
  - `components/vitrine/` — exclusivos da loja pública.
  - `components/painel/` — exclusivos do dashboard do lojista.
- **Regra de extração (architecture.md §8):** componente que aparece em 2+ lugares é extraído para `components/`. Antes de criar, verificar se já existe padrão equivalente — reuso vence criação (§1).
- **Validação e lógica não vivem no componente:** schemas zod em `lib/validacoes/`, lógica de negócio (frete, desconto, total, loja aberta) em `lib/utils/`. O componente consome, não duplica (architecture.md §8, DRY).
