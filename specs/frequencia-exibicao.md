# Spec: Frequência de exibição por item e por categoria

**Versão:** 0.1.0 | **Atualizado:** 2026-09-27
**Plano:** `plan/loop-frequencia-exibicao.md` · **Issues:** 320, 321, 322, 323

## Visão geral

Substitui o cardápio sazonal. Cada **produto** e cada **categoria** ganham uma
**frequência de exibição** própria, feita de três eixos combináveis (AND):

- **dias da semana** (0 = domingo … 6 = sábado);
- **faixa de horário** (`hora_inicio` inclusivo, `hora_fim` exclusivo, `inicio < fim`,
  sem virar a meia-noite — mesma regra do cardápio);
- **período de datas** (`date`, inclusivo nas duas pontas).

Eixo NULL = sem restrição; todos os eixos NULL = **permanente**. Produto e categoria
novos nascem permanentes. A avaliação é no **fuso da loja** (`lojas.timezone`).

A categoria ganha também **ocultar/mostrar** (`categorias.oculta`).

O cardápio sazonal vira **função morta**: sai da vitrine, do pedido, da revisão do
carrinho e da navegação do painel/admin. Tabelas (`cardapios`, `cardapio_produtos`),
coluna `produtos.visibilidade` e código de cardápio **permanecem** (não apagar).

**Mundos:** painel/admin (escrita da frequência, auth obrigatório) e vitrine pública
(efeito, sem auth). A comprabilidade é **autoritativa no servidor** (seguranca.md §10).

## Regras de negócio

- **RN-1 · interseção.** O produto está disponível quando está dentro da frequência
  do produto **E** dentro da frequência da sua categoria. Ex.: categoria seg–sex +
  produto só sábado ⇒ nunca disponível. O painel **avisa** quando a interseção é vazia.
- **RN-2 · categoria.** Categoria **oculta** some da vitrine (com seus produtos).
  Categoria **fora da frequência** aparece, com **todos** os produtos indisponíveis —
  exceto quando o período dela já terminou (RN-7).
- **RN-3 · produto fora da frequência** aparece **indisponível** na própria categoria
  (motivo `fora_da_janela`, o mesmo de hoje) e o servidor **recusa** na compra
  (`criarPedido` → `ERRO_FORA_DA_JANELA`, antes da RPC). Produto de categoria
  oculta é recusado com `ERRO_GENERICO`.
- **RN-7 · período encerrado some.** Depois de `periodo_fim` (no fuso da loja), o
  produto some da vitrine; a categoria também some, com seus produtos. Antes de
  `periodo_inicio`, aparece indisponível (RN-2/RN-3). Ex.: período 01/12–31/12, visto
  em 15/01 ⇒ ausente da vitrine; o servidor recusa na compra.
- **RN-8 · nenhum dia marcado = nunca.** `dias_semana` vazio é gravável e significa
  "nunca disponível": o item continua visível e sempre indisponível (a categoria,
  com todos os itens indisponíveis). Decidido pelo usuário em 2026-09-27.
- **RN-4 · migração.** Todo produto `visibilidade='cardapio'` volta a `'menu'`
  (permanente). Nada é convertido para frequência. `cardapio_produtos` fica intacto.
- **RN-5 · escrita escopada.** Toda escrita (unitária, grade, seleção múltipla,
  ocultar/frequência de categoria) é escopada pela loja do lojista (RLS) ou pela
  `lojaId` do contexto admin (service_role + `prepararContextoAdmin`). Id de outra
  loja no lote ⇒ zero linhas alteradas.
- **RN-6 · grade atômica.** A grade produto × dia salva tudo ou nada.

## Behaviors

### Banco (I1 · issue 320)
- [ ] Colunas de frequência em `produtos` e `categorias`, com CHECKs de coerência
      (dia 0..6, hora em par e `inicio < fim`, `periodo_fim >= periodo_inicio`).
- [ ] `categorias.oculta boolean not null default false`.
- [ ] `vitrine_produtos` não expõe produto de categoria oculta; colunas de frequência
      no fim da view; `security_barrier` mantido.
- [ ] Migração de dados: 0 produtos `visibilidade='cardapio'`; `cardapio_produtos` intacto.

### Regra de compra (I2 · issue 321)
- [ ] Avaliador puro produto ∩ categoria, no fuso da loja.
- [ ] `criarPedido` recusa produto fora da frequência (produto ou categoria) e de
      categoria oculta, sem chamar a RPC.
- [ ] `revisarCarrinho` e `itensBloqueados` marcam `fora_da_janela` nos mesmos casos.
- [ ] Servidor deixa de ler `cardapios` em pedido/revisão.

### Escrita (I3 · issue 322)
- [ ] Lojista e admin: definir frequência de um produto, aplicar a mesma frequência
      a vários produtos (seleção), salvar grade produto × dia (atômico), ocultar/mostrar
      categoria e definir frequência de categoria.
- [ ] Payload inválido recusado pelo zod antes do banco.

### Vitrine + painel (I4 · issue 323)
- [ ] Vitrine sem seção de cardápio; categoria oculta omitida; categoria fora da
      frequência com todos os itens indisponíveis; produto fora da frequência
      indisponível com rótulo.
- [ ] Painel/admin: editor de frequência (produto e categoria), grade, seleção
      múltipla, ocultar categoria, aviso RN-1.
- [ ] "Cardápios" sai da navegação do painel e do admin; eixo `cardapios` sai do
      editor do modal sazonal (dados das junções ficam).

## Fora do escopo

- Apagar tabelas, colunas ou código de cardápio (fica como função morta).
- Converter vínculos de cardápio existentes em frequência.
- Frequência que atravessa a meia-noite; dia do mês.
