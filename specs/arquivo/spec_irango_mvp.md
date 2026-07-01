# Spec: iRango MVP

**Versão:** 1.1.0 | **Atualizado:** 2026-06-13

> **v1.1.0 — Adendo:** adicionada a seção **Monetização — Assinatura do SaaS via Hotmart** ao final, com ajustes pontuais ao guard do painel, à vitrine pública e ao modelo de dados de `lojas`. As seções existentes permanecem válidas exceto onde a nova seção declara um ajuste explícito.

---

## Visão Geral

iRango é um marketplace SaaS multitenant no modelo iFood. Lojistas cadastram lojas, configuram catálogo, frete e formas de pagamento. Clientes acessam a vitrine pública de cada loja e fazem pedidos. O SaaS não intermedia pagamentos — cada lojista recebe diretamente via Pix, dinheiro, link ou cartão.

O produto resolve o problema do lojista pequeno que precisa de uma vitrine digital pronta, sem precisar contratar desenvolvedor, sem pagar comissão por pedido e sem a complexidade de integrar gateway de pagamento.

---

## Atores

| Ator | Papel |
|------|-------|
| **iRango (SaaS)** | Oferece a infraestrutura. Cobra mensalidade do lojista. Não participa do fluxo de pagamento. |
| **Lojista** | Dono da loja (restaurante, lanchonete, doceria etc.). Paga mensalidade, configura tudo no painel, recebe pedidos e pagamentos diretamente. |
| **Cliente** | Consumidor final. Acessa a vitrine sem login. Faz pedidos e paga direto ao lojista. |

---

## Stack Tecnológica

- **Framework:** Next.js 15 (App Router) — SSR para SEO da vitrine, Server Actions para mutations seguras
- **Linguagem:** TypeScript — tipos gerados do schema Supabase via CLI (`supabase gen types typescript`)
- **Backend/BDD:** Supabase (Postgres + Auth + RLS + Storage) — custo fixo $25/mês independente de volume
- **Estilização:** Tailwind CSS + shadcn/ui (Radix UI)
- **Forms:** react-hook-form + zod — mesmo schema validado no client (UX) e no servidor (segurança)
- **Toast:** sonner (integrado ao shadcn/ui)
- **Ícones:** lucide-react (integrado ao shadcn/ui)
- **Color picker:** react-colorful (2kb, zero deps)
- **Máscaras de input:** react-imask — CEP, telefone, WhatsApp
- **CEP:** ViaCEP (API pública, zero custo)
- **Hosting:** Vercel
- **Idioma do código de domínio:** português (ex.: `pedidos`, `loja`, `produtos`) — termos técnicos universais mantidos em inglês

---

## Páginas e Rotas

---

### Landing do SaaS — `/`

**Descrição:** Página de apresentação do produto para lojistas potenciais. Explica o que é o iRango, benefícios e call-to-action para cadastro.

**Componentes:**
- HeroLanding: headline, subtítulo, botão "Crie sua loja grátis" → `/cadastro`
- SecaoBeneficios: lista de benefícios do produto
- SecaoCTA: segundo call-to-action no rodapé da página

**Behaviors:**
- [ ] Exibir: renderizar a landing como página estática (SSG)
- [ ] Redirecionar: clicar em "Crie sua loja grátis" leva o usuário para `/cadastro`
- [ ] Redirecionar: usuário já autenticado acessando `/` é redirecionado para `/painel`

**Camada de segurança:** nenhuma — página pública estática.

---

### Cadastro — `/cadastro`

**Descrição:** Lojista cria conta com email/senha ou Google OAuth. Após o cadastro, uma loja é criada automaticamente com slug gerado a partir do email, e o lojista é redirecionado para o painel de configurações.

**Componentes:**
- FormCadastro (reusa shadcn/ui `Form`, `Input`, `Button`): campos email e senha
- BotaoGoogle: OAuth via Supabase Auth Google provider

**Behaviors:**
- [ ] Cadastrar com email/senha: enviar email e senha para `supabase.auth.signUp()`. Validar no client (zod: email válido, senha mínimo 8 caracteres) e no servidor (Server Action com mesmo schema).
- [ ] Cadastrar com Google OAuth: iniciar fluxo `supabase.auth.signInWithOAuth({ provider: 'google' })`. Callback redireciona para `/auth/callback` (padrão `@supabase/ssr`).
- [ ] Criar loja automaticamente: após cadastro bem-sucedido, Server Action executa INSERT em `lojas` com `dono_id = auth.uid()`, `slug` gerado a partir do email (parte antes do `@`, sanitizado para `[a-z0-9-]`), `nome` vazio (lojista configura depois).
- [ ] Redirecionar após cadastro: lojista vai para `/painel/configuracoes/perfil` com toast "Loja criada! Configure seu perfil."
- [ ] Bloquear cadastro duplicado: se email já existe, exibir mensagem "Este email já está cadastrado. Faça login."
- [ ] Redirecionar usuário já autenticado: middleware redireciona para `/painel`.

**Camada de segurança:**
- Client: validação zod (email, senha mínimo 8 chars)
- Servidor (Server Action): mesma validação zod antes de chamar Supabase Auth
- RLS: INSERT em `lojas` com `WITH CHECK (auth.uid() = dono_id)` — lojista só cria a própria loja

---

### Login — `/login`

**Descrição:** Lojista faz login com email/senha ou Google OAuth.

**Componentes:**
- FormLogin (reusa shadcn/ui `Form`, `Input`, `Button`): campos email e senha
- BotaoGoogle: OAuth via Supabase Auth

**Behaviors:**
- [ ] Login com email/senha: chamar `supabase.auth.signInWithPassword()`. Em caso de erro, exibir "Email ou senha incorretos."
- [ ] Login com Google OAuth: iniciar fluxo OAuth. Callback em `/auth/callback`.
- [ ] Redirecionar após login: ir para `/painel`.
- [ ] Redirecionar usuário já autenticado: middleware redireciona para `/painel`.

**Camada de segurança:**
- Sessão via cookies HttpOnly gerenciados por `@supabase/ssr`
- `middleware.ts` refresha token em toda request (padrão oficial Supabase Next.js)

---

### Vitrine Pública — `/loja/[slug]`

**Descrição:** Vitrine da loja visível para clientes sem login. Renderizada via SSR para SEO. Exibe produtos agrupados por categoria, permite montar carrinho, calcular frete, aplicar cupom e finalizar pedido.

**Componentes:**
- HeaderLoja (`components/vitrine/HeaderLoja.tsx`): nome da loja, logo (se houver), BadgeStatus
- BadgeStatus (`components/vitrine/BadgeStatus.tsx`): "Aberto agora" (verde) ou "Fechado" (cinza) com horário de reabertura. Usa `lib/utils/lojaAberta.ts` + `hooks/useLojaAberta.ts`
- CardProduto (`components/vitrine/CardProduto.tsx`): foto, nome, descrição resumida, preço, botão "Adicionar"
- SecaoCatalogo: lista de seções por categoria, cada uma com seus CardProduto
- Carrinho (`components/vitrine/Carrinho.tsx`): drawer ou sidebar com itens, subtotal, campo de cupom, seleção de zona de entrega, resumo de frete, total e botão "Finalizar pedido" → `/loja/[slug]/pedido`
- FormEndereco: campos nome cliente, telefone, CEP (com autocomplete ViaCEP), rua, número, bairro, complemento
- SeletorFormaPagamento: lista as formas de pagamento configuradas pela loja
- BotaoWhatsApp: link `wa.me/[whatsapp]` se loja tiver WhatsApp configurado

**Behaviors:**
- [ ] Renderizar via SSR: `page.tsx` busca loja por slug em Server Component. Se slug não existir, chama `notFound()`.
- [ ] Exibir badge de status: calcular se loja está aberta com base em `lojas.horarios` e hora atual do cliente. Lógica em `lib/utils/lojaAberta.ts` (utilitário puro, reutilizável).
- [ ] Listar catálogo agrupado: buscar `categorias` ordenadas por `ordem`, e `produtos` disponíveis por `categoria_id`, ordenados por `ordem`. Produtos sem categoria aparecem em seção "Outros" no final.
- [ ] Adicionar ao carrinho: estado local via `hooks/useCarrinho.ts`. Não requer login. Persistir em `sessionStorage` para sobreviver a refresh.
- [ ] Alterar quantidade no carrinho: incrementar/decrementar por produto. Remover produto ao zerar.
- [ ] Autocomplete de endereço via CEP: ao preencher CEP (8 dígitos), chamar ViaCEP (`https://viacep.com.br/ws/{cep}/json/`) e preencher automaticamente rua, bairro e cidade. Exibir erro se CEP inválido.
- [ ] Calcular frete por bairro: ao informar bairro, buscar zona de entrega do tipo `bairro` que contenha aquele bairro em `bairros_zona`. Exibir taxa. Lógica em `lib/utils/calcularFrete.ts`.
- [ ] Calcular frete grátis: se subtotal >= `taxas_entrega.pedido_minimo_gratis`, exibir "Frete grátis" ao invés da taxa.
- [ ] Aplicar cupom: ao digitar código e clicar "Aplicar", chamar Server Action que valida o cupom (ativo, não expirado, usos disponíveis, pedido mínimo atingido). Retornar desconto calculado. Lógica de desconto em `lib/utils/calcularDesconto.ts`.
- [ ] Calcular total: subtotal - desconto + frete. Lógica em `lib/utils/calcularTotal.ts`.
- [ ] Exibir formas de pagamento: listar `formas_pagamento` da loja. Para Pix, exibir chave configurada.
- [ ] Navegar para checkout: botão "Finalizar pedido" leva para `/loja/[slug]/pedido` passando estado do carrinho via URL params ou `sessionStorage`.

**Camada de segurança:**
- SELECT em `lojas`, `produtos`, `categorias` via RLS pública (só registros com `ativo = true` / `disponivel = true`)
- SELECT em `zonas_entrega`, `taxas_entrega`, `bairros_zona`, `formas_pagamento` via RLS pública
- SELECT em `cupons` via RLS pública (só ativos) — validação de negócio (expiração, usos, mínimo) feita em Server Action, nunca só no client

---

### Checkout — `/loja/[slug]/pedido`

**Descrição:** Tela de confirmação e finalização do pedido. Cliente revisa itens, informa dados pessoais, endereço de entrega, forma de pagamento e envia o pedido.

**Componentes:**
- ResumoCarrinho: lista de itens com nome, quantidade e preço
- FormDadosCliente (reusa react-hook-form + zod): nome (obrigatório), telefone
- FormEnderecoEntrega (reusa react-hook-form + zod + ViaCEP): CEP, rua, número, bairro, complemento
- SeletorZonaEntrega: dropdown das zonas disponíveis para o bairro informado
- SeletorFormaPagamento: rádio com as formas aceitas pela loja
- InstrucoesPagamento: exibe chave Pix, instruções de link ou dinheiro conforme seleção
- ResumoFinanceiro: subtotal, frete, desconto, total
- BotaoFinalizar: "Fazer pedido" — dispara Server Action

**Behaviors:**
- [ ] Validar dados do cliente: nome obrigatório. Telefone opcional. Validação via zod no client e no servidor.
- [ ] Validar endereço: CEP obrigatório. Rua, número e bairro obrigatórios. Autocomplete ViaCEP ao preencher CEP.
- [ ] Confirmar zona de entrega: Server Action recalcula frete no servidor com base no bairro informado — nunca confiar no valor calculado no client.
- [ ] Revalidar cupom no servidor: Server Action verifica novamente se cupom ainda é válido no momento do pedido (pode ter expirado ou esgotado usos entre a vitrine e o checkout).
- [ ] Criar pedido: Server Action faz INSERT em `pedidos` com snapshot de valores (subtotal, desconto, taxa_entrega, total, forma_pagamento, cupom_codigo) e INSERT em `itens_pedido` com snapshot de nome e preço de cada produto (não referência ao produto atual — protege contra edição posterior do lojista).
- [ ] Incrementar usos do cupom: na mesma Server Action, após INSERT do pedido, fazer UPDATE em `cupons SET usos_contagem = usos_contagem + 1` onde o cupom foi usado. Operação atômica dentro da mesma transação.
- [ ] Exibir confirmação: após pedido criado com sucesso, redirecionar para `/loja/[slug]/confirmacao?pedido=[id]` com mensagem de sucesso.
- [ ] Exibir instruções de Pix: se forma de pagamento selecionada for Pix, exibir chave e instrução de transferência (nunca processar pagamento).
- [ ] Tratar loja fechada no envio: Server Action verifica `horarios` da loja. Se fechada, recusar pedido com mensagem "Loja fechada no momento".

**Camada de segurança:**
- INSERT em `pedidos` via política RLS `pedidos_insert_publico` — sem login necessário
- INSERT em `itens_pedido` via política RLS `itens_pedido_insert_publico`
- Cálculo de frete, validação de cupom e `usos_contagem` feitos exclusivamente em Server Action — nunca confiar em valores do client
- UPDATE em `cupons.usos_contagem`: feito via Server Action com `service role` ou dentro de transação segura — nunca exposto ao client

---

### Confirmação de Pedido — `/loja/[slug]/confirmacao`

**Descrição:** Tela exibida ao cliente após finalizar o pedido com sucesso. Exibe número do pedido, resumo e instruções de pagamento.

**Componentes:**
- CardConfirmacao: ícone de sucesso, "Pedido recebido!", número do pedido (id curto)
- ResumoSimples: itens, total, forma de pagamento
- InstrucoesPagamentoFinal: chave Pix ou instruções específicas da forma escolhida
- BotaoVoltar: "Ver mais produtos" → `/loja/[slug]`

**Behaviors:**
- [ ] Exibir confirmação: buscar pedido pelo `id` recebido via query param. Exibir dados do pedido.
- [ ] Limpar carrinho: ao chegar nesta página, limpar `sessionStorage` do carrinho.
- [ ] Tratar pedido não encontrado: se `id` inválido, redirecionar para `/loja/[slug]`.

---

### Dashboard do Lojista — `/painel`

**Descrição:** Página inicial do painel. Exibe métricas rápidas e lista de pedidos recentes por status.

**Componentes:**
- CardMetrica (reusa shadcn/ui `Card`): pedidos hoje, pedidos pendentes, total do dia
- TabelaPedidosRecentes (reusa `components/painel/TabelaPedidos.tsx`): lista os 20 pedidos mais recentes com status, cliente, valor e data

**Behaviors:**
- [ ] Carregar métricas: Server Component busca `pedidos` da loja do lojista autenticado do dia corrente. Conta pendentes, confirmados e calcula total.
- [ ] Listar pedidos recentes: 20 pedidos mais recentes ordenados por `criado_em DESC`.
- [ ] Navegar para pedido: clicar em linha da tabela abre `/painel/pedidos/[id]`.

**Camada de segurança:**
- Acesso ao painel protegido por guard duplo: `middleware.ts` + `app/(painel)/painel/layout.tsx` verificam sessão server-side
- RLS: SELECT em `pedidos` com `auth.uid() = lojas.dono_id` — lojista vê apenas pedidos da própria loja

---

### Gestão de Pedidos — `/painel/pedidos`

**Descrição:** Lista completa de pedidos da loja com filtro por status e detalhamento de cada pedido.

**Componentes:**
- FiltroPorStatus (reusa shadcn/ui `Tabs` ou `Select`): Todos | Pendente | Confirmado | Em preparo | Saiu pra entrega | Entregue | Cancelado
- TabelaPedidos (`components/painel/TabelaPedidos.tsx`): colunas — ID curto, cliente, valor total, status (badge colorido), data
- DrawerPedido ou PaginaPedido: detalhes — itens, endereço, forma de pagamento, observações, histórico de status

**Behaviors:**
- [ ] Listar pedidos: buscar `pedidos` da loja com `itens_pedido` aninhados, ordenados por `criado_em DESC`. Filtrar por status se selecionado.
- [ ] Ver detalhes do pedido: ao clicar, abrir detalhes com todos os itens (usando snapshot de nome e preço de `itens_pedido`), dados do cliente, endereço e forma de pagamento.
- [ ] Atualizar status do pedido: botões de ação contextuais conforme status atual:
  - `pendente` → "Confirmar pedido" ou "Cancelar"
  - `confirmado` → "Iniciar preparo" ou "Cancelar"
  - `em_preparo` → "Saiu pra entrega" ou "Cancelar"
  - `saiu_entrega` → "Marcar como entregue"
  - `entregue` / `cancelado` → sem ação disponível
- [ ] Confirmar mudança de status: Server Action valida transição de status permitida antes de fazer UPDATE. Transições inválidas (ex.: `entregue` → `pendente`) são recusadas.

**Camada de segurança:**
- SELECT e UPDATE em `pedidos` via RLS `pedidos_acesso_lojista`
- Server Action valida transições de status — cliente não pode manipular diretamente
- Transição de status validada no servidor: nunca aceitar salto arbitrário de status vindo do client

---

### Gestão de Produtos — `/painel/produtos`

**Descrição:** Lojista gerencia o catálogo de produtos: adicionar, editar, remover, ativar/desativar e reordenar.

**Componentes:**
- TabelaProdutos (`components/painel/TabelaProdutos.tsx`): foto miniatura, nome, categoria, preço, badge disponível/indisponível, ações (editar, remover, toggle)
- FormProduto (`components/painel/FormProduto.tsx`, reusa react-hook-form + zod via `lib/validacoes/produto.ts`): nome, descrição, preço, categoria (select das categorias da loja), foto (upload para Supabase Storage), disponível (toggle), ordem
- DialogConfirmacaoRemocao (reusa shadcn/ui `AlertDialog`): confirmação antes de deletar

**Behaviors:**
- [ ] Listar produtos: buscar `produtos` da loja com `categoria` aninhada, ordenados por categoria e `ordem`.
- [ ] Criar produto: Server Action faz INSERT em `produtos` com `loja_id` do lojista autenticado. Validar campos obrigatórios (nome, preço >= 0) via zod no client e no servidor.
- [ ] Editar produto: Server Action faz UPDATE em `produtos`. Validação idem ao criar.
- [ ] Upload de foto: enviar imagem para Supabase Storage em bucket `produtos/{loja_id}/{produto_id}`. Salvar URL pública em `produtos.foto_url`. Validar tipo (jpeg/png/webp) e tamanho máximo (2MB) no client e no servidor.
- [ ] Toggle disponível/indisponível: Server Action faz UPDATE em `produtos SET disponivel = NOT disponivel`. Produto indisponível some da vitrine pública (RLS filtra `disponivel = true`).
- [ ] Remover produto: Server Action faz DELETE em `produtos`. Confirmar em `AlertDialog` antes.
- [ ] Reordenar produtos: drag-and-drop (ou botões ↑↓) atualiza campo `ordem` via Server Action. Ordem reflete exibição na vitrine.

**Camada de segurança:**
- Todas as mutations via Server Action com validação zod
- RLS `produtos_escrita_propria`: lojista só grava em produtos da própria loja (verificado via JOIN com `lojas.dono_id = auth.uid()`)
- Upload de Storage: regras de Storage do Supabase restringem escrita ao `loja_id` do lojista autenticado

---

### Gestão de Categorias — `/painel/produtos` (seção integrada ou aba)

**Descrição:** Lojista gerencia categorias que agrupam produtos na vitrine. Pode ser seção lateral ou aba dentro da página de produtos.

**Componentes:**
- ListaCategorias: nome, número de produtos, ordem, ações (editar, remover)
- FormCategoria (reusa shadcn/ui `Dialog` + react-hook-form + zod): campo nome, campo ordem

**Behaviors:**
- [ ] Listar categorias: buscar `categorias` da loja ordenadas por `ordem`.
- [ ] Criar categoria: Server Action INSERT em `categorias` com `loja_id`. Validar nome obrigatório.
- [ ] Editar categoria: Server Action UPDATE em `categorias`.
- [ ] Remover categoria: Server Action DELETE em `categorias`. Produtos da categoria ficam com `categoria_id = NULL` (ON DELETE SET NULL). Exibir aviso antes de confirmar.
- [ ] Reordenar categorias: atualizar `ordem` via Server Action.

**Camada de segurança:**
- RLS `categorias_escrita_propria`: lojista só grava nas próprias categorias

---

### Gestão de Cupons — `/painel/cupons`

**Descrição:** Lojista cria e gerencia cupons de desconto para os clientes.

**Componentes:**
- TabelaCupons: código, tipo (percentual/fixo), valor, pedido mínimo, usos (usado/máximo), validade, status ativo, ações
- FormCupom (`components/painel/FormCupom.tsx`, reusa react-hook-form + zod via `lib/validacoes/cupom.ts`): código (texto único na loja), tipo (select percentual/fixo), valor, pedido mínimo, usos máximos (opcional), data de expiração (opcional), ativo

**Behaviors:**
- [ ] Listar cupons: buscar `cupons` da loja ordenados por `criado_em DESC`.
- [ ] Criar cupom: Server Action INSERT em `cupons`. Validar código único dentro da loja (UNIQUE constraint no banco). Validar valor > 0, percentual entre 1 e 100.
- [ ] Editar cupom: Server Action UPDATE em `cupons`.
- [ ] Ativar/desativar cupom: Server Action UPDATE em `cupons SET ativo = NOT ativo`.
- [ ] Remover cupom: Server Action DELETE em `cupons`.
- [ ] Bloquear código duplicado: se lojista tenta criar cupom com código já existente na loja, retornar erro "Este código já existe".

**Camada de segurança:**
- RLS `cupons_escrita_propria`: lojista só grava nos próprios cupons
- UNIQUE constraint `(loja_id, codigo)` no banco garante unicidade mesmo se RLS falhar

---

### Configurações — Entregas — `/painel/configuracoes/entregas`

**Descrição:** Lojista configura zonas de entrega, bairros atendidos e taxas de frete.

**Componentes:**
- ListaZonas: nome da zona, tipo (bairro/raio km), taxa, frete grátis acima de, lista de bairros, ativo, ações
- FormZona (reusa react-hook-form + zod): nome, tipo (select bairro/raio_km), ativo
- FormTaxaEntrega: taxa (numeric), pedido mínimo pra frete grátis (opcional), raio máximo em km (só se tipo = raio_km)
- FormBairros (só se tipo = bairro): lista de bairros com add/remove inline

**Behaviors:**
- [ ] Listar zonas: buscar `zonas_entrega` com `taxas_entrega` e `bairros_zona` aninhados.
- [ ] Criar zona do tipo bairro: Server Action INSERT em `zonas_entrega` + INSERT em `taxas_entrega` + INSERT em `bairros_zona` para cada bairro informado.
- [ ] Criar zona do tipo raio km: Server Action INSERT em `zonas_entrega` + INSERT em `taxas_entrega` com `raio_max_km`.
- [ ] Editar zona: Server Action UPDATE nas três tabelas conforme o tipo.
- [ ] Adicionar/remover bairros: Server Action faz INSERT/DELETE em `bairros_zona`.
- [ ] Ativar/desativar zona: Server Action UPDATE em `zonas_entrega SET ativo = NOT ativo`. Zona inativa não aparece no cálculo de frete da vitrine.
- [ ] Remover zona: Server Action DELETE em `zonas_entrega` (CASCADE apaga `taxas_entrega` e `bairros_zona`).

**Camada de segurança:**
- RLS `zonas_escrita_propria`: lojista só grava nas próprias zonas
- Server Action valida que `loja_id` passado pertence ao lojista autenticado antes de qualquer INSERT

---

### Configurações — Formas de Pagamento — `/painel/configuracoes/pagamentos`

**Descrição:** Lojista escolhe quais formas de pagamento aceita e configura detalhes de cada uma.

**Componentes:**
- ListaFormasPagamento: cards para Pix, Dinheiro, Link de pagamento, Cartão — cada um com toggle ativo e campos de configuração
- FormPix: campo chave Pix (texto livre) e tipo da chave (CPF/CNPJ/email/telefone/aleatória)
- FormDinheiro: campo "Troco até quanto" (opcional)
- FormLink: campo instrução (ex.: "Enviaremos link após confirmar")
- FormCartao: campo instrução (ex.: "Pagamento na entrega")

**Behaviors:**
- [ ] Listar formas configuradas: buscar `formas_pagamento` da loja.
- [ ] Ativar forma de pagamento: Server Action INSERT em `formas_pagamento` com `tipo` e `config` JSON.
- [ ] Desativar/remover forma: Server Action DELETE em `formas_pagamento`.
- [ ] Atualizar configuração de forma: Server Action UPDATE em `formas_pagamento SET config = $config`.
- [ ] Validar chave Pix: se tipo = telefone, validar formato `55XXXXXXXXXXX`. Se email, validar formato email.

**Camada de segurança:**
- SELECT público em `formas_pagamento` (vitrine precisa exibir) — RLS `pagamentos_leitura_publica`
- Escrita restrita ao lojista dono via RLS
- Chave Pix não é processada pela plataforma — apenas exibida ao cliente

---

### Configurações — Perfil da Loja — `/painel/configuracoes/perfil`

**Descrição:** Lojista edita informações básicas da loja: nome, slug, telefone, WhatsApp e endereço.

**Componentes:**
- FormPerfil (reusa react-hook-form + zod via `lib/validacoes/loja.ts`): nome (obrigatório), slug (obrigatório, `[a-z0-9-]`, único), telefone (máscara react-imask), WhatsApp (máscara react-imask, formato internacional `55XXXXXXXXXXX`)
- FormEndereco: CEP (máscara + autocomplete ViaCEP), rua, número, bairro, cidade, estado, complemento
- PreviewLink: exibe link público da loja `irango.com.br/loja/[slug]` com botão copiar

**Behaviors:**
- [ ] Carregar dados atuais: Server Component busca `lojas` da loja do lojista autenticado.
- [ ] Salvar perfil: Server Action UPDATE em `lojas`. Validar nome não vazio, slug `[a-z0-9-]` com 3–60 caracteres.
- [ ] Validar slug único: antes de salvar, verificar se slug já existe em outra loja. Retornar erro "Este endereço já está em uso" se conflito.
- [ ] Autocomplete de endereço por CEP: idem à vitrine — chamar ViaCEP ao preencher CEP.
- [ ] Formatar WhatsApp: salvar sempre no formato `5511999999999` (sem espaços/hífens).

**Camada de segurança:**
- UPDATE em `lojas` via RLS `lojas_update_proprio`
- UNIQUE constraint em `lojas.slug` garante unicidade no banco
- Slug validado no servidor (regex + unicidade) — client só faz sanitização de UX

---

### Configurações — Horários — `/painel/configuracoes/horarios`

**Descrição:** Lojista define horário de funcionamento por dia da semana.

**Componentes:**
- GradeHorarios: lista de 7 dias (seg–dom) com toggle ativo e campos de hora abre/fecha
- ItemDia (reusa shadcn/ui `Switch`, `Input` tipo time): toggle liga/desliga dia, campos `HH:MM` para abertura e fechamento

**Behaviors:**
- [ ] Carregar horários: ler `lojas.horarios` (JSONB) do lojista autenticado.
- [ ] Salvar horários: Server Action UPDATE em `lojas SET horarios = $horarios`. Validar via zod que todos os dias ativos têm `abre` < `fecha` e ambos no formato `HH:MM`.
- [ ] Desativar dia: toggle coloca `ativo: false` para aquele dia. Vitrine exibe loja como fechada nesse dia.
- [ ] Preview de status: exibir na própria tela se a loja estaria "Aberta agora" com os horários configurados.

**Camada de segurança:**
- UPDATE em `lojas` via RLS `lojas_update_proprio`
- Validação de horários feita no servidor (Server Action com zod) — nunca confiar só no client

---

### Configurações — Tema — `/painel/configuracoes/tema`

**Descrição:** Lojista personaliza as cores da vitrine: primária, fundo e destaque.

**Componentes:**
- FormTema (reusa react-hook-form + zod): três color pickers usando `react-colorful` (2kb, zero deps)
- PreviewVitrine: preview ao vivo da vitrine com as cores selecionadas aplicadas via CSS custom properties

**Behaviors:**
- [ ] Carregar tema atual: ler `lojas.tema` (JSONB `{ primaria, fundo, destaque }`) do lojista autenticado.
- [ ] Preview ao vivo: ao mover o color picker, atualizar preview imediatamente via CSS custom properties — sem salvar ainda.
- [ ] Salvar tema: Server Action UPDATE em `lojas SET tema = $tema`. Validar que os três valores são hexadecimais válidos (`#RRGGBB`).
- [ ] Aplicar tema na vitrine: `HeaderLoja.tsx` e `CardProduto.tsx` consomem as cores via CSS custom properties definidas no `<head>` da vitrine durante SSR.

**Camada de segurança:**
- UPDATE em `lojas` via RLS `lojas_update_proprio`
- Cores validadas no servidor (regex hex) — sem risco de injeção CSS malicioso

---

## Componentes Compartilhados

| Componente | Localização | Usado em |
|------------|-------------|----------|
| `ui/*` | `components/ui/` (shadcn/ui, gerado pelo CLI — não editar) | toda a aplicação |
| `HeaderLoja` | `components/vitrine/HeaderLoja.tsx` | vitrine `/loja/[slug]` |
| `BadgeStatus` | `components/vitrine/BadgeStatus.tsx` | vitrine, dashboard do painel |
| `CardProduto` | `components/vitrine/CardProduto.tsx` | vitrine |
| `Carrinho` | `components/vitrine/Carrinho.tsx` | vitrine |
| `TabelaProdutos` | `components/painel/TabelaProdutos.tsx` | `/painel/produtos` |
| `FormProduto` | `components/painel/FormProduto.tsx` | `/painel/produtos` |
| `FormCupom` | `components/painel/FormCupom.tsx` | `/painel/cupons` |
| `TabelaPedidos` | `components/painel/TabelaPedidos.tsx` | `/painel`, `/painel/pedidos` |

---

## Modelos de Dados

Todos os modelos já estão definidos em `references/schema.md`. Resumo das entidades e campos críticos:

### `lojas`
Entidade principal do tenant. Campos-chave: `id`, `dono_id` (FK para `auth.users`), `slug` (único, rota pública), `nome`, `telefone`, `whatsapp`, `ativo`, `tema` (JSONB), `horarios` (JSONB), campos de endereço.

### `categorias`
Agrupamento de produtos. Campos: `id`, `loja_id`, `nome`, `ordem`.

### `produtos`
Item do catálogo. Campos: `id`, `loja_id`, `categoria_id` (nullable), `nome`, `descricao`, `preco` (numeric 10,2), `disponivel`, `ordem`, `foto_url`.

### `cupons`
Desconto aplicável no checkout. Campos: `id`, `loja_id`, `codigo` (único por loja), `tipo` (percentual/fixo), `valor`, `pedido_minimo`, `usos_maximos` (nullable = ilimitado), `usos_contagem`, `expira_em` (nullable), `ativo`.

### `zonas_entrega`
Área atendida. Campos: `id`, `loja_id`, `nome`, `tipo` (bairro/raio_km), `ativo`.

### `taxas_entrega`
Taxa associada à zona. Campos: `id`, `zona_id`, `taxa`, `pedido_minimo_gratis` (nullable), `raio_max_km` (nullable, só para tipo raio_km).

### `bairros_zona`
Bairros de uma zona do tipo `bairro`. Campos: `id`, `zona_id`, `nome`.

### `formas_pagamento`
Formas aceitas pela loja. Campos: `id`, `loja_id`, `tipo` (pix/dinheiro/link/cartao), `config` (JSONB — varia por tipo).

### `pedidos`
Pedido feito pelo cliente. Campos: `id`, `loja_id`, `nome_cliente`, `telefone_cliente`, `endereco_entrega` (JSONB snapshot), `subtotal`, `desconto`, `taxa_entrega`, `total`, `status`, `forma_pagamento`, `cupom_codigo`, `observacoes`, `criado_em`.

### `itens_pedido`
Linha do pedido com snapshot de nome e preço (imutável após criação). Campos: `id`, `pedido_id`, `produto_id` (nullable, ON DELETE SET NULL), `nome` (snapshot), `preco` (snapshot), `quantidade`.

---

## Regras de Negócio

### RN-01 — Um lojista, uma loja (v1)
- **Regra:** Cada conta `auth.users` tem exatamente uma loja.
- **Camada client:** após cadastro, redirecionar direto para o painel sem tela de seleção.
- **Camada servidor (Server Action):** ao criar loja, verificar `SELECT COUNT(*) FROM lojas WHERE dono_id = auth.uid()`. Se > 0, recusar com erro. Prevenção de múltiplas lojas via lógica na action (RLS não cobre contagem).

### RN-02 — Isolamento de dados por tenant
- **Regra:** Lojista só acessa dados da própria loja.
- **Camada client:** queries sempre filtradas por `loja_id` da sessão.
- **Camada banco (RLS):** todas as tabelas com políticas `lojista_escrita_propria` e `lojista_leitura_propria` verificando `lojas.dono_id = auth.uid()`.

### RN-03 — Vitrine pública sem login
- **Regra:** Cliente não precisa de conta para ver produtos e fazer pedido.
- **Camada banco (RLS):** políticas `_leitura_publica` para `lojas`, `produtos`, `categorias`, `zonas_entrega`, `taxas_entrega`, `bairros_zona`, `formas_pagamento`, `cupons` (ativos).
- **Camada banco (RLS):** `pedidos_insert_publico` e `itens_pedido_insert_publico` com `WITH CHECK (true)`.

### RN-04 — Snapshot de preço e nome no pedido
- **Regra:** Editar ou remover um produto após o pedido não altera pedidos anteriores.
- **Camada servidor (Server Action):** ao criar pedido, INSERT em `itens_pedido` com `nome` e `preco` copiados do produto no momento do pedido, não como FK dependente.
- **Camada banco:** `itens_pedido.produto_id` tem `ON DELETE SET NULL` — produto deletado não quebra histórico.

### RN-05 — Cálculo de frete e cupom no servidor
- **Regra:** Valores de frete e desconto exibidos na vitrine são estimativas; o valor definitivo é recalculado no servidor ao criar o pedido.
- **Camada servidor (Server Action):** `criarPedido` recalcula frete via `calcularFrete` e revalida cupom antes de inserir. Valores do client são descartados.
- **Lib compartilhada:** `lib/utils/calcularFrete.ts` e `lib/utils/calcularDesconto.ts` usados na vitrine (preview) e na Server Action (autoritativa).

### RN-06 — Validade do cupom
- **Regra:** Cupom só é aceito se: `ativo = true`, `expira_em` é NULL ou futura, `usos_contagem < usos_maximos` (ou `usos_maximos` é NULL), subtotal >= `pedido_minimo`.
- **Camada client:** validação ao digitar o código (Server Action de validação parcial para UX).
- **Camada servidor (Server Action `criarPedido`):** revalidação completa antes do INSERT — condição de corrida coberta por transação.
- **Camada banco:** `usos_contagem` incrementado dentro da mesma transação do INSERT do pedido.

### RN-07 — Slug único e sanitizado
- **Regra:** Slug só aceita `[a-z0-9-]`, mínimo 3 e máximo 60 caracteres, único entre todas as lojas.
- **Camada client:** sanitização em tempo real (sugestão gerada a partir do nome da loja).
- **Camada servidor (Server Action):** validação via zod regex + `SELECT` para checar unicidade antes do UPDATE.
- **Camada banco:** `UNIQUE INDEX ON lojas(slug)`.

### RN-08 — Transições de status de pedido
- **Regra:** Status segue máquina de estados: `pendente → confirmado → em_preparo → saiu_entrega → entregue`. Cancelamento é possível de `pendente`, `confirmado` ou `em_preparo`. Saltos e reversões não são permitidos.
- **Camada client:** botões de ação exibidos conforme status atual (nunca mostrar ação inválida).
- **Camada servidor (Server Action):** validar transição permitida antes do UPDATE. Recusar com erro se inválida.

### RN-09 — Loja fechada bloqueia pedido
- **Regra:** Se a loja estiver fora do horário de funcionamento no momento do envio, o pedido é recusado.
- **Camada client:** badge "Fechado" exibido e botão "Finalizar pedido" desabilitado.
- **Camada servidor (Server Action `criarPedido`):** verificar `lojas.horarios` no momento da submissão. Recusar pedido com mensagem "Loja fechada no momento" se fora do horário.
- **Lib compartilhada:** `lib/utils/lojaAberta.ts` — função pura reutilizada no client e na action.

### RN-10 — Segurança da chave de serviço Supabase
- **Regra:** `SUPABASE_SERVICE_ROLE_KEY` nunca é exposta ao client — sempre em variável de ambiente sem prefixo `NEXT_PUBLIC_`.
- **Camada servidor:** usada apenas em Server Actions e route handlers internos.

### RN-11 — Foto de produto
- **Regra:** Upload aceita apenas jpeg, png e webp. Tamanho máximo 2MB.
- **Camada client:** validação de tipo e tamanho antes do upload (UX).
- **Camada servidor:** validação idêntica na Server Action antes de enviar para Supabase Storage.
- **Camada Storage:** políticas de Storage do Supabase restringem escrita ao `loja_id` do usuário autenticado.

---

## Fora do Escopo (Fase 1)

| Feature | Motivo |
|---------|--------|
| Pagamento intermediado pela plataforma | Complexidade regulatória (PCI DSS), risco financeiro, chargeback |
| Notificação push/realtime de pedido novo | Fase 2 — Supabase Realtime |
| Subdomínio por loja (`minha-loja.irango.com.br`) | Fase 2 — configuração DNS wildcard |
| Domínio próprio do lojista | Fase 3 |
| Múltiplas lojas por lojista | Fase 2 — v1 é 1 conta = 1 loja |
| App mobile nativo | Fase 2+ |
| Integração Correios / frete calculado por API | Fase 2 — v1 usa frete fixo por zona |
| Painel super-admin do SaaS (iRango) | Fase 2 |
| Relatórios de vendas | Fase 3 |
| Cobrança automatizada de mensalidade | Pendente decisão de modelo comercial |
| Avaliações e reviews de produtos | Fora de escopo indefinido |
| Chat entre cliente e lojista | Fora de escopo indefinido |

---
---

# Adendo: Monetização — Assinatura do SaaS via Hotmart

**Versão do adendo:** 0.1.0 | **Atualizado:** 2026-06-13

> Este adendo NÃO substitui nada do spec acima. Ele **acrescenta** a feature de assinatura e **ajusta explicitamente**: (1) o modelo de dados de `lojas`, (2) o guard do painel (`/painel/*`), e (3) o comportamento da vitrine pública quando a assinatura não está ativa. Tudo o mais do spec permanece como está.

---

## Visão Geral

O **lojista** paga uma assinatura para ter direito de usar o painel e manter a vitrine no ar. Isto é a **monetização do próprio SaaS (iRango → lojista)** e é **completamente separada** do fluxo do marketplace (cliente → lojista), que o iRango **não** intermedia e continua sem mudança alguma.

A venda e a cobrança recorrente da assinatura acontecem **inteiramente na Hotmart** (plataforma externa de checkout/cobrança). **O iRango não processa cartão, não cobra e não guarda dado de pagamento.** A Hotmart cobra e **notifica o iRango por webhook**; o iRango apenas **reflete o estado da assinatura** (ativa/inadimplente/cancelada/etc.) e usa esse estado para liberar ou bloquear o acesso.

**Problema que resolve:** fecha a pendência do `modelo-negocio.md` §5 ("Modelo de Cobrança — decisão pendente") e o débito do spec ("Cobrança automatizada de mensalidade — pendente decisão"), terceirizando cobrança/recorrência para a Hotmart sem o iRango virar gateway.

**Não é módulo.** O sistema **não é modularizado**: a assinatura é **estado (colunas) em `lojas`** + **1 webhook (Route Handler)** + **ajuste no guard do painel**. Nenhuma arquitetura nova.

**Onde vive:** painel (leitura do status pelo lojista) + um Route Handler de webhook server-only + ajuste no guard de `/painel/*` e na renderização da vitrine pública.

---

## Atores Envolvidos

| Ator | O que faz nesta feature |
|------|--------------------------|
| **iRango (SaaS)** | Recebe o webhook da Hotmart, **valida a autenticidade**, atualiza o estado de assinatura da loja, libera/bloqueia o painel e controla a visibilidade da vitrine. Não cobra, não guarda cartão. |
| **Lojista** | Compra a assinatura **na Hotmart** (fora do iRango). No iRango apenas **visualiza** o status (somente leitura) e clica em "Gerenciar assinatura" → portal do assinante Hotmart. |
| **Cliente** | Nenhum papel novo. Continua comprando direto do lojista. Só é afetado indiretamente: se a assinatura do lojista não estiver ativa, a vitrine daquela loja aparece indisponível. |
| **Hotmart** | Plataforma externa. Processa checkout, cobra recorrência e **emite webhooks** dos eventos (compra aprovada, recorrência, cancelamento, reembolso, atraso). Fonte da verdade do pagamento. |

---

## Páginas e Rotas

### Webhook Hotmart — `/api/webhooks/hotmart` (Route Handler `POST`)
**Mundo:** server-only (Route Handler, sem auth de sessão — autenticado pelo segredo da Hotmart). **Não é página.**
**Descrição:** Endpoint que a Hotmart chama a cada evento de assinatura/compra. Não renderiza UI. Roda com `service_role` (sem sessão de lojista). É a **única fonte** que escreve o estado autoritativo de assinatura.

**Componentes:** nenhum (Route Handler puro em `src/app/api/webhooks/hotmart/route.ts`).

**Behaviors:**
- [ ] Validar autenticidade do request — **ENFORCEMENT SERVER-SIDE OBRIGATÓRIO.** Conferir o segredo da Hotmart (campo/header `hottok` e/ou assinatura HMAC do header, **confirmar na doc oficial Hotmart** qual mecanismo a versão atual da API usa). Request sem segredo válido → `401`, nada é gravado. Garantido em: Route Handler (servidor). Segredo só em env (`HOTMART_WEBHOOK_TOKEN` / `HOTMART_HOTTOK`), **nunca** com prefixo `NEXT_PUBLIC_`.
- [ ] Garantir idempotência — **ENFORCEMENT SERVER-SIDE OBRIGATÓRIO.** Extrair o identificador único do evento da Hotmart (ex.: `event_id` / `transaction` + `event`, **confirmar na doc oficial Hotmart**). Antes de aplicar efeito, gravar/checar esse id em `webhook_eventos_hotmart`. Se já processado, retornar `200` sem reaplicar. Garantido em: Route Handler + UNIQUE constraint no banco (`webhook_eventos_hotmart.evento_id`).
- [ ] Mapear comprador → loja — **ENFORCEMENT SERVER-SIDE.** Ler o email do comprador do payload (**confirmar na doc oficial Hotmart** o caminho exato, ex.: `data.buyer.email`), normalizar (lowercase/trim) e localizar a `lojas` cujo dono tem esse email em `auth.users`. Se não houver loja, ramo de reconciliação (ver Estados de Borda). Garantido em: Route Handler (servidor).
- [ ] Aplicar evento de compra aprovada / assinatura ativada → `status = 'ativa'`, gravar `hotmart_subscriber_code`, `hotmart_plano`, `assinatura_inicio`, `assinatura_fim_periodo`. **ENFORCEMENT SERVER-SIDE.** Garantido em: Route Handler + RLS (escrita só via service_role; lojista nunca grava status).
- [ ] Aplicar cobrança recorrente aprovada → renovar período: `status = 'ativa'`, estender `assinatura_fim_periodo` para o fim do novo ciclo. **ENFORCEMENT SERVER-SIDE.** Garantido em: Route Handler.
- [ ] Aplicar atraso / inadimplência (cobrança falhou) → `status = 'inadimplente'`. Não bloqueia imediatamente: respeita a **carência** (ver Regras de Negócio RN-A4). **ENFORCEMENT SERVER-SIDE.** Garantido em: Route Handler.
- [ ] Aplicar cancelamento de assinatura → `status = 'cancelada'`, manter acesso **até** `assinatura_fim_periodo` (cliente já pagou o ciclo vigente). **ENFORCEMENT SERVER-SIDE.** Garantido em: Route Handler.
- [ ] Aplicar reembolso / chargeback → `status = 'suspensa'` **imediatamente** (acesso cortado já, sem esperar fim de período). **ENFORCEMENT SERVER-SIDE.** Garantido em: Route Handler.
- [ ] Nunca confiar no corpo sem validar — **ENFORCEMENT SERVER-SIDE OBRIGATÓRIO.** Nenhum efeito de status é aplicado antes de (1) validar a assinatura/token e (2) checar idempotência. Garantido em: Route Handler.
- [ ] Responder rápido e idempotente — retornar `200` em sucesso e em evento duplicado; `401` em segredo inválido; `2xx` em evento desconhecido/ignorado (registrar e não falhar, para a Hotmart não re-tentar em loop). Erro interno real → `5xx` (Hotmart re-tenta; idempotência cobre o reprocesso). Garantido em: Route Handler.
- [ ] Mapear eventos da Hotmart → estados internos — a lista exata de nomes de evento (`PURCHASE_APPROVED`, `PURCHASE_COMPLETE`, `SUBSCRIPTION_CANCELLATION`, `PURCHASE_REFUNDED`, `PURCHASE_CHARGEBACK`, `PURCHASE_DELAYED`, etc.) deve ser **confirmada na doc oficial Hotmart** antes da implementação. Garantido em: Route Handler (mapa server-side).

---

### Configurações — Assinatura — `/painel/configuracoes/assinatura`
**Mundo:** painel (auth obrigatório).
**Descrição:** Tela **somente leitura** onde o lojista vê o estado atual da assinatura. Toda gestão de pagamento (trocar cartão, cancelar, ver faturas) acontece **na Hotmart** — a tela apenas linka para o portal do assinante. O iRango não exibe nem guarda dado de cartão.

**Componentes:** (reuso de shadcn/ui)
- `CardStatusAssinatura` (reusa shadcn/ui `Card` + `Badge`): badge colorido por status (`trial` / `ativa` / `inadimplente` / `cancelada` / `suspensa`), data de início e fim do período vigente.
- `AvisoCarencia` (reusa shadcn/ui `Alert`): exibido quando `inadimplente` ou `cancelada`, informando até quando o acesso continua e o que fazer.
- `BotaoGerenciarHotmart` (reusa shadcn/ui `Button`): link externo para o portal do assinante Hotmart (URL do portal — **confirmar na doc oficial Hotmart**), abre em nova aba.

**Behaviors:**
- [ ] Exibir status atual — Server Component lê os campos de assinatura de `lojas` da loja do lojista autenticado. Garantido em: Server Component + RLS (`lojas_leitura_propria`, lojista só lê a própria).
- [ ] Exibir período vigente — mostrar `assinatura_inicio` e `assinatura_fim_periodo` formatados. Garantido em: cliente (UX de exibição); o valor é autoritativo do servidor (gravado só pelo webhook).
- [ ] Linkar para gestão na Hotmart — botão abre o portal do assinante. Nenhuma mutation no iRango. Garantido em: cliente (UX).
- [ ] Não permitir editar status pelo painel — a tela é read-only; não existe Server Action que o lojista chame para mudar `status`/datas. Garantido em: ausência de mutation + RLS (UPDATE de status só por service_role no webhook).

---

### Ajuste — Guard do Painel `/painel/*` (ajuste do guard já previsto)
**Mundo:** painel (auth obrigatório).
**Descrição:** Ajusta o guard duplo já existente (`middleware.ts` + `app/(painel)/painel/layout.tsx`, ver `architecture.md` §5 e seção "Dashboard do Lojista" acima). Além de checar sessão e `email_confirmed_at` (`seguranca.md` §17), o guard agora **também** consulta o estado da assinatura da loja e decide o acesso.

**Behaviors:**
- [ ] Permitir acesso com assinatura `ativa` ou `trial` válido — **ENFORCEMENT SERVER-SIDE.** Garantido em: guard server-side (`layout.tsx`) + RLS.
- [ ] Permitir acesso em `inadimplente`/`cancelada` **dentro da carência** (`now() <= assinatura_fim_periodo`), exibindo banner de aviso. **ENFORCEMENT SERVER-SIDE.** Garantido em: guard server-side.
- [ ] Bloquear painel quando assinatura inválida — `suspensa` (imediato), ou `inadimplente`/`cancelada` **além** de `assinatura_fim_periodo`, ou `trial` expirado → redirecionar para `/painel/assinatura-bloqueada` (tela de reativação com link Hotmart). **ENFORCEMENT SERVER-SIDE OBRIGATÓRIO** — nunca confiar em flag do client. Garantido em: guard server-side (`layout.tsx`).
- [ ] Não bloquear a tela de assinatura — `/painel/configuracoes/assinatura` e `/painel/assinatura-bloqueada` permanecem acessíveis mesmo com assinatura inválida, para o lojista poder reativar. Garantido em: guard server-side (exceção de rota).
- [ ] Exibir banner de carência — em `inadimplente`/`cancelada` dentro da carência, mostrar banner persistente "Sua assinatura está pendente. Regularize na Hotmart até [data]." Garantido em: cliente (UX); a decisão de bloqueio em si é server-side.

---

### Ajuste — Vitrine Pública `/loja/[slug]` quando assinatura inválida
**Mundo:** vitrine pública (sem auth).
**Descrição:** Ajusta o comportamento da vitrine (seção "Vitrine Pública" acima) para o caso de a loja ter assinatura **suspensa/expirada**. A loja não deve aceitar pedidos nem aparecer normalmente se o lojista não está pagando.

**Behaviors:**
- [ ] Ocultar/marcar loja indisponível quando assinatura inválida — **ENFORCEMENT SERVER-SIDE.** Se a assinatura está `suspensa` ou fora da carência, a vitrine renderiza estado "Loja temporariamente indisponível" (sem catálogo, sem botão de pedido) ou `notFound()`. Decisão preferencial: marcar indisponível (preserva o slug/SEO básico) em vez de 404. Garantido em: Server Component (`page.tsx`) + RLS.
- [ ] Recusar criação de pedido se assinatura inválida — **ENFORCEMENT SERVER-SIDE OBRIGATÓRIO.** A Server Action `criarPedido` (seção Checkout acima) passa a checar, além de loja aberta (RN-09), se a assinatura permite operar. Se não, recusa com "Loja indisponível no momento". Garantido em: Server Action `criarPedido`.

---

## Modelos de Dados

### Decisão: colunas em `lojas` + tabela mínima de idempotência

**Recomendação (justificada):** como o sistema **não é modular** e a regra do projeto é "1 conta = 1 loja" (RN-01), o estado de assinatura vive como **colunas em `lojas`**, não em tabela `assinaturas` separada. Justificativa:
- `lojas` já é a entidade-tenant 1:1 com o dono (`dono_id` → `auth.users`). Uma tabela `assinaturas` 1:1 só adicionaria um JOIN sem ganho.
- O guard do painel já carrega a `lojas` do lojista; ter o status na mesma linha evita query extra.
- Histórico de eventos NÃO precisa de tabela rica na v1 — só de **idempotência**. Para isso, uma tabela enxuta `webhook_eventos_hotmart` registra os eventos já processados (id único + payload bruto para auditoria), sem modelar "histórico de assinatura" de produto.

> Se no futuro houver múltiplas lojas por conta (Fase 2 do roadmap), reavaliar mover assinatura para a **conta/usuário** (não para a loja). Marcado em "Fora do Escopo".

### Migration nova — colunas em `lojas`

```sql
-- migration: adiciona estado de assinatura à loja (autoritativo do servidor)
ALTER TABLE lojas
  ADD COLUMN assinatura_status text NOT NULL DEFAULT 'trial'
    CHECK (assinatura_status IN ('trial','ativa','inadimplente','cancelada','suspensa')),
  ADD COLUMN hotmart_subscriber_code text,        -- identificador do assinante na Hotmart
  ADD COLUMN hotmart_plano text,                  -- plano/oferta contratada
  ADD COLUMN assinatura_inicio timestamptz,       -- início do período vigente
  ADD COLUMN assinatura_fim_periodo timestamptz,  -- fim do período vigente (carência usa isto)
  ADD COLUMN assinatura_atualizada_em timestamptz;-- quando o webhook tocou o estado

CREATE INDEX ON lojas(assinatura_status);
CREATE INDEX ON lojas(hotmart_subscriber_code);
```

**Autoritativo do servidor:** **todos** os campos `assinatura_*` e `hotmart_*` são gravados **exclusivamente** pelo Route Handler do webhook rodando com `service_role`. O lojista **nunca** os escreve. A UI do painel é read-only sobre eles.

### Tabela nova — `webhook_eventos_hotmart` (idempotência + auditoria)

```sql
CREATE TABLE webhook_eventos_hotmart (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id    text NOT NULL,         -- id único do evento na Hotmart (confirmar campo na doc)
  evento_tipo  text,                  -- ex.: PURCHASE_APPROVED (confirmar nomes na doc)
  loja_id      uuid REFERENCES lojas(id) ON DELETE SET NULL,  -- null se ainda não reconciliado
  email_comprador text,               -- normalizado; usado na reconciliação pendente
  payload      jsonb NOT NULL,        -- corpo bruto recebido, para auditoria
  processado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evento_id)                  -- garante idempotência no banco
);
```

> **RLS obrigatória antes de produção** (`seguranca.md` §2): tabela contém PII (email de comprador) e dado comercial. **Nenhuma política de leitura/escrita pública ou de lojista.** Acesso **só via `service_role`** (que ignora RLS). Habilitar RLS sem nenhuma policy permissiva = ninguém com anon/auth key lê ou escreve.

```sql
ALTER TABLE webhook_eventos_hotmart ENABLE ROW LEVEL SECURITY;
-- nenhuma policy criada de propósito → anon e lojista não acessam; só service_role (bypassa RLS)
```

### Tabelas afetadas
- `lojas` — colunas novas (acima). RLS existente (`lojas_*`) já cobre **leitura própria** do status pelo lojista. **Adicionar restrição:** as policies de UPDATE do lojista (`lojas_update_proprio`) **não devem** permitir alterar colunas `assinatura_*`/`hotmart_*`. Como Postgres RLS não filtra por coluna, isto é garantido na **Server Action de salvar perfil** (que só faz UPDATE das colunas de perfil) + ausência de qualquer Server Action que escreva os campos de assinatura. Ver Regras de Negócio RN-A5.

---

## Regras de Negócio

### RN-A1 — Estado de assinatura é autoritativo só do webhook
- **Regra:** `assinatura_status` e datas só mudam por evento Hotmart validado. Nenhum caminho de client/painel altera.
- **Camada:** Route Handler (webhook) com `service_role` — escrita; RLS impede escrita por lojista; nenhuma Server Action de lojista toca esses campos.

### RN-A2 — Validação de autenticidade antes de qualquer efeito
- **Regra:** request de webhook sem token/assinatura válida não produz efeito.
- **Camada:** Route Handler (servidor). Segredo em env server-only. **Confirmar mecanismo (hottok vs HMAC) na doc oficial Hotmart.**

### RN-A3 — Idempotência
- **Regra:** o mesmo evento reenviado não duplica efeito (Hotmart re-tenta em falha de rede).
- **Camada:** Route Handler + `UNIQUE (evento_id)` no banco. Evento já visto → no-op + `200`.

### RN-A4 — Mapa de evento → estado e carência
- **Regra:**
  - compra aprovada / assinatura ativa → `ativa` (define `assinatura_inicio`, `assinatura_fim_periodo`).
  - recorrência aprovada → `ativa`, estende `assinatura_fim_periodo`.
  - atraso/inadimplência → `inadimplente`; acesso mantido **durante carência** (até `assinatura_fim_periodo`; carência padrão = fim do período já pago).
  - cancelamento → `cancelada`; acesso mantido até `assinatura_fim_periodo`.
  - reembolso/chargeback → `suspensa`; acesso **cortado imediatamente**.
- **Camada:** Route Handler (mapa server-side); guard do painel e vitrine leem `status` + `assinatura_fim_periodo` para decidir acesso. **Nomes de evento: confirmar na doc oficial Hotmart.**

### RN-A5 — Lojista não escreve assinatura
- **Regra:** nenhuma operação iniciada pelo lojista altera `assinatura_*`/`hotmart_*`.
- **Camada:** Server Action de perfil faz UPDATE apenas das colunas de perfil (lista explícita); RLS de `lojas` não tem policy que conceda escrita desses campos a `authenticated` por outro caminho. Defesa em profundidade: nenhuma Server Action recebe esses campos do client.

### RN-A6 — Trial
- **Regra:** loja recém-criada nasce `trial` (default da coluna) com `assinatura_fim_periodo` = `now() + N dias` (N a definir, ex.: 14, alinhado ao `modelo-negocio.md` §5). Durante trial válido o painel funciona normalmente. Trial expirado sem compra → tratado como bloqueio (igual a `inadimplente` fora da carência).
- **Camada:** definição de `assinatura_fim_periodo` no momento da criação da loja (Server Action de cadastro, ajuste da seção "Cadastro" acima); guard server-side decide expiração.

### RN-A7 — Gate da vitrine e do checkout
- **Regra:** loja com assinatura `suspensa` ou fora da carência não exibe catálogo nem aceita pedido.
- **Camada:** Server Component da vitrine (render indisponível) + Server Action `criarPedido` (recusa). Server-side obrigatório.

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** PII do comprador (email Hotmart) chega no webhook e é gravada em `webhook_eventos_hotmart` (RLS fechada, só `service_role`) e usada para mapear a loja. Nenhum dado de cartão entra no iRango (fica na Hotmart). O `hotmart_subscriber_code` é identificador, não credencial.
- **Valor monetário?** A assinatura é cobrada **na Hotmart** — o iRango **não** calcula nem processa valor. **Não há recálculo de valor monetário no iRango para assinatura** (diferente do checkout do marketplace, que recalcula — `seguranca.md` §10). O equivalente ao "recálculo no servidor" aqui é: **o estado de pagamento é decidido só pelo evento validado da Hotmart, nunca pelo client.**
- **Tabela nova → RLS necessária:** `webhook_eventos_hotmart` com RLS habilitada e **sem policy permissiva** (só `service_role` acessa). `lojas` ganha colunas, cobertas pelas policies existentes para leitura própria; escrita de assinatura restrita ao webhook.
- **API externa com key → só servidor:** o segredo do webhook Hotmart (`HOTMART_WEBHOOK_TOKEN` / `HOTMART_HOTTOK`) e qualquer credencial de API Hotmart vivem **só** em env server-side, **sem** `NEXT_PUBLIC_` (`seguranca.md` §7 e §9). O Route Handler roda no servidor. URL do portal do assinante é pública (link), não é secret.
- **Idempotência e replay:** sem idempotência, um replay malicioso/acidental do webhook poderia reativar uma assinatura suspensa — coberto por `UNIQUE (evento_id)` + checagem antes do efeito.
- **Enforcement de acesso:** bloqueio de painel/vitrine é **sempre server-side** (guard em `layout.tsx`, vitrine em `page.tsx`, recusa em `criarPedido`) — nunca flag de client.
- **Rate limiting:** o endpoint `/api/webhooks/hotmart` é público por natureza (Hotmart chama sem sessão). Considerar rate limit por IP/origem além da validação de token (`seguranca.md` §12) — confirmar faixas de IP da Hotmart na doc, se publicadas.

---

## Pontos a confirmar na doc oficial Hotmart (não inventar)

- Mecanismo exato de autenticidade do webhook: `hottok` (campo/header) vs assinatura HMAC de header — e qual a versão atual da API.
- Caminho do email do comprador no payload (ex.: `data.buyer.email`).
- Campo de id único do evento para idempotência (`event_id` / `transaction` + `event`).
- Nomes canônicos dos eventos (compra aprovada, recorrência, cancelamento, reembolso, chargeback, atraso).
- URL do portal do assinante para o botão "Gerenciar assinatura".
- Faixas de IP de origem da Hotmart (se publicadas) para rate limit/allowlist.

---

## Fora do Escopo (v1 deste adendo)

| Item | Motivo |
|------|--------|
| Tela de **planos/preços** dentro do iRango | Checkout é na Hotmart; iRango só linka. |
| Cobrança/recorrência feita pelo iRango | Terceirizada à Hotmart por design (sem virar gateway). |
| Histórico rico de faturas/assinatura no painel | Fica na Hotmart; v1 só mostra status atual. |
| Múltiplas lojas por conta com assinatura por conta | Fase 2 do `modelo-negocio.md` — então reavaliar mover assinatura para a conta. |
| Painel super-admin do SaaS para gerir assinaturas manualmente | Fase 2 (já fora de escopo no spec base). |
| Dunning/emails de cobrança próprios | Hotmart cuida da comunicação de cobrança. |
| Proração, upgrade/downgrade de plano no iRango | Gerido na Hotmart. |
