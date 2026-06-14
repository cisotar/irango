# Modelo de Negócio — iRango

**Versão:** 0.2.0 | **Atualizado:** 2026-06-13

> Regras comerciais e relação entre os três atores. Guia pra decisões de produto — o que o SaaS faz e deliberadamente NÃO faz.

---

## Sumário

1. [Três Atores](#1-três-atores)
2. [O que o SaaS oferece](#2-o-que-o-saas-oferece)
3. [O que o SaaS deliberadamente NÃO faz](#3-o-que-o-saas-deliberadamente-não-faz)
4. [Fluxo de Pedido e Pagamento](#4-fluxo-de-pedido-e-pagamento)
5. [Modelo de Cobrança (Lojistas)](#5-modelo-de-cobrança-lojistas)
6. [Custo de Operação](#6-custo-de-operação)
7. [Roadmap Comercial](#7-roadmap-comercial)

---

## 1. Três Atores

| Ator | Quem é | Relação com iRango |
|------|--------|--------------------|
| **iRango (SaaS)** | dono da plataforma | oferece infraestrutura, cobra mensalidade do lojista |
| **Lojista** | dono da loja (restaurante, lanchonete, doceria, etc.) | paga mensalidade, configura loja, recebe pedidos, recebe pagamentos diretamente |
| **Cliente** | consumidor final | não paga nada pro iRango, compra direto do lojista |

---

## 2. O que o SaaS oferece

### Para o lojista

- Vitrine pública com URL própria: `irango.com.br/loja/minha-loja`
- Painel de gestão completo:
  - Catálogo de produtos (adicionar, editar, remover, disponibilidade)
  - Categorias de produtos
  - Cupons de desconto
  - Zonas de entrega e taxas de frete
  - Formas de pagamento aceitas
  - Configurações da loja (nome, slug, telefone, WhatsApp, endereço, horários)
  - Tema visual da vitrine (cores primária, fundo, destaque)
- Gestão de pedidos recebidos

### Para o cliente

- Vitrine pública sem necessidade de cadastro
- Carrinho de compras
- Cálculo de frete automático por bairro ou distância
- Aplicação de cupom de desconto
- Autocomplete de endereço via CEP (ViaCEP)
- Visualização de formas de pagamento aceitas pela loja

---

## 3. O que o SaaS deliberadamente NÃO faz

| O que não faz | Por quê |
|--------------|---------|
| **Não processa pagamentos** | Complexidade regulatória (PCI DSS), risco financeiro, responsabilidade de chargeback — fora do escopo da v1 |
| **Não cobra comissão por pedido** | Modelo mensalidade fixo — mais simples, sem conflito de interesse |
| **Não entrega** | Lojista usa motoboy próprio ou terceirizado |
| **Não intermedia disputa entre lojista e cliente** | Relação direta entre os dois |

### Como o pagamento acontece

O iRango exibe as formas de pagamento que o lojista configurou. O cliente escolhe, finaliza o pedido, e paga diretamente ao lojista:

- **Pix** — lojista exibe a própria chave Pix; cliente transfere diretamente
- **Dinheiro** — cliente paga na entrega
- **Link de pagamento** — lojista gera link (Mercado Pago, PagSeguro próprio) após confirmar pedido
- **Cartão** — lojista tem maquininha; cliente paga na entrega

---

## 4. Fluxo de Pedido e Pagamento

```
Cliente acessa /loja/[slug]
    │
    ├── Navega catálogo
    ├── Adiciona ao carrinho
    ├── Informa endereço (CEP → autocomplete)
    ├── Sistema calcula frete (zona do lojista)
    ├── Aplica cupom (opcional)
    ├── Escolhe forma de pagamento
    └── Finaliza pedido
            │
            ↓
    Pedido salvo no banco (status: pendente)
            │
            ↓
    Lojista vê pedido no painel
            │
            ├── Confirma pedido
            ├── Prepara
            ├── Envia motoboy
            └── Pagamento recebido diretamente (Pix/dinheiro/etc.)
```

O iRango **não participa** da etapa de pagamento. O lojista é responsável por confirmar o recebimento.

---

## 5. Modelo de Cobrança (Lojistas)

> Decisão pendente — a definir antes do primeiro cliente pago.

Sugestões a avaliar:

| Modelo | Prós | Contras |
|--------|------|---------|
| Mensalidade fixa | previsível pro lojista e pro SaaS | não escala com uso |
| Freemium (grátis até X pedidos) | baixa barreira de entrada | risco de abuso |
| Trial 14 dias grátis + plano pago | padrão SaaS, baixo risco | precisa cobrança automatizada |

---

## 6. Custo de Operação

| Item | Custo/mês |
|------|-----------|
| Supabase Pro | $25 |
| Vercel Hobby | $0 |
| Domínio | ~$1 |
| **Total** | **~$26/mês** |

Custo fixo independente de volume de pedidos ou número de clientes. DDoS não gera custo extra (Supabase cobra plano fixo).

---

## 7. Conformidade Legal — Entregáveis Obrigatórios

O iRango coleta dado pessoal de clientes finais (nome, telefone, endereço) e de lojistas (email, telefone). Antes do primeiro cliente real, são **obrigatórios**:

| Entregável | Por quê | Quando |
|-----------|---------|--------|
| **Política de Privacidade** (página pública) | LGPD exige informar o que se coleta, por quê e por quanto tempo | antes do 1º cliente pago |
| **Termos de Uso** | define responsabilidades SaaS ↔ lojista ↔ cliente; deixa claro que o pagamento é direto com o lojista | antes do 1º cliente pago |
| **Canal de exclusão de dados** | cliente/lojista pode pedir remoção (direito LGPD) | antes do 1º cliente pago |
| **Política de retenção** | prazo pra anonimizar/apagar pedidos antigos | definir na Fase 1 |

Detalhes técnicos de LGPD (base legal, minimização, retenção) em `references/seguranca.md` §20.

> ⚠️ O SaaS não processa pagamento, mas **é responsável pelos dados pessoais que armazena**. A isenção de pagamento não isenta de LGPD.

---

## 8. Roadmap Comercial

### Fase 1 — MVP

- Vitrine pública `/loja/[slug]`
- Painel completo de gestão
- Pedidos manuais (lojista gerencia status no painel)
- Pagamento 100% fora da plataforma
- Política de Privacidade + Termos de Uso publicados

### Fase 2

- Subdomínio por loja: `minha-loja.irango.com.br`
- Notificação em tempo real de pedido (Supabase Realtime)
- App mobile PWA instalável

### Fase 3

- Domínio próprio do lojista: `minhaloja.com.br` apontando pro iRango
- Integração opcional com Mercado Pago (lojista conecta própria conta)
- Relatórios de vendas
