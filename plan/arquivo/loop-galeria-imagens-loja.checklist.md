# Galeria de imagens: checklist de verificação manual

Para quem testa antes de mesclar o PR #184. Marque `[x]` conforme conferir. Nada aqui foi visto em navegador: os testes automatizados cobrem banco, Server Actions e componentes, não o app rodando.

## Preparação

- Branch `feat/galeria-imagens-loja` na pasta principal, `npm run dev` ligado (roda contra o Supabase cloud; as migrations M1 a M4 já estão lá).
- Entre como dono de **Lanches base** (loja de teste, escrita livre). Evite a Pão do Ciso.
- Tenha à mão: 3 a 5 fotos pequenas, 1 foto de celular grande (4 MB ou mais), 1 imagem pequena (menos de 400 px de lado), 1 arquivo que não é imagem (.pdf ou .gif renomeado para .jpg).
- Abra o DevTools no modo responsivo (celular) para os itens de mobile. Gesto de toque de verdade só em aparelho real.

## A. Página Galeria (`/painel/galeria`)

- [ ] O item **Galeria** aparece na sidebar, logo depois de Produtos, com estado ativo na página.
- [ ] A página mostra as imagens que a Lanches base já tinha (importadas do Storage), com o selo "Em uso" nas que estão em produto ou na logo.
- [ ] O contador mostra "N de 200 imagens".
- [ ] **Enviar imagens** com 3 arquivos de uma vez: aparece o progresso ("Enviando 2 de 3") e as 3 entram na grade.
- [ ] Enviar a foto grande de celular: entra sem erro (o navegador reduz antes de enviar).
- [ ] Enviar o arquivo que não é imagem: erro só nesse arquivo, os outros da fila continuam.
- [ ] A grade carrega rápido (usa miniaturas, não as originais).
- [ ] **Selecionar**: marcar e desmarcar imagens, "Limpar" e "Cancelar" funcionam; a barra mostra "N selecionadas".
- [ ] **Remover** uma imagem que não está em uso: confirmação, toast com o número removido, some da grade.
- [ ] **Remover** imagens em uso (num produto e na logo): a confirmação diz onde estão em uso ("usada em 2 produtos e na logo"). Depois de confirmar, o produto fica sem foto (vitrine mostra o 🍽️) e a logo some (vitrine mostra a letra).
- [ ] Abra a vitrine `/loja/lanches-base` depois da remoção: nenhuma imagem quebrada.
- [ ] Selecione 2 imagens, remova uma delas em outra aba, volte e remova as 2: toast "1 imagem removida. 1 já tinha sido removida." (ou parecido).
- [ ] Selecione uma imagem, remova em outra aba, volte e remova: mensagem de que já tinham sido removidas, a grade recarrega.
- [ ] **Carregar mais** aparece com mais de 40 imagens e traz a próxima página sem repetir nenhuma. (Se a loja tem menos de 41, envie imagens até passar disso, ou deixe para o item do seletor.)

## B. Foto do produto (`/painel/produtos`)

- [ ] No form do produto, o campo de foto oferece **Enviar nova** e **Escolher da galeria**, no estado vazio e em "Substituir".
- [ ] **Escolher da galeria** no desktop: abre janela centralizada com a grade.
- [ ] **Escolher da galeria** no celular (modo responsivo): ocupa a tela inteira, como o modal do produto na vitrine.
- [ ] `Escape` no seletor fecha **só o seletor**; o form do produto continua aberto.
- [ ] Botão "Fechar" e clique no fundo: mesmo comportamento.
- [ ] Tocar numa imagem fecha o seletor e abre o cropper 4:3 com ela.
- [ ] Confirmar o recorte preenche o preview; **Salvar o produto** grava; a vitrine mostra a foto.
- [ ] Escolher a **mesma** imagem em outro produto funciona (reaproveitamento), sem reenviar.
- [ ] **Enviar nova** com arquivo local: ao confirmar o recorte, a original aparece também na `/painel/galeria`.
- [ ] **Enviar nova** e **cancelar** o cropper: nada novo aparece na galeria.
- [ ] Imagem pequena (menos de 800 px de largura): aviso "Esta imagem é pequena e pode ficar borrada…", mas dá para confirmar mesmo assim.
- [ ] Imagem legada (uma das que já existiam, sem miniatura): o recorte funciona **sem erro de canvas** (peça para o `Console` do DevTools ficar aberto; não pode aparecer erro de "tainted canvas" ou "Failed to fetch").
- [ ] Recorte com o service worker ativo: recarregue a página duas vezes antes de testar, para garantir que as imagens já passaram pelo cache.
- [ ] ✕ na foto do produto limpa o campo; ao salvar, a imagem continua na galeria.
- [ ] Original removida em outra aba **depois** de aberto o cropper: ao confirmar, mensagem "Essa imagem foi removida da galeria." e nenhum arquivo novo.
- [ ] Salvar um produto cuja foto foi removida da galeria em outra aba: mensagem "A foto escolhida foi removida da galeria. Escolha outra." (e não um erro genérico).
- [ ] Atalho **Enviar nova imagem** dentro do seletor funciona.

## C. Logo da loja (`/painel/configuracoes/perfil`)

- [ ] O bloco da logo oferece **Enviar nova** e **Escolher da galeria**.
- [ ] Escolher da galeria abre o cropper **redondo 1:1**; confirmar já grava a logo (sem precisar de "Salvar" do perfil).
- [ ] Aviso de imagem pequena abaixo de 400 px.
- [ ] A vitrine mostra a logo nova no cabeçalho.
- [ ] Trocar a logo por outra; remover a logo (✕): a vitrine volta para a letra.
- [ ] O seletor no celular ocupa a tela inteira e o `Escape` não fecha o form do perfil por baixo.

## D. Hub admin (`/admin/assinantes/[lojaId]`)

Entre como admin do SaaS, abra a loja Lanches base pelo hub.

- [ ] Item **Galeria** na sidebar do admin; a página mostra as imagens **da loja aberta**, não de outra.
- [ ] Enviar e remover imagem pela galeria do admin agem na loja-alvo (confira no painel do lojista da Lanches base).
- [ ] O seletor funciona nos produtos e no perfil da loja-alvo.
- [ ] Abra outra loja pelo hub: a galeria mostra só as imagens dela.

## E. Limpeza de recortes (depois do deploy ou no dev contra o cloud)

- [ ] Troque a foto de um produto por outra imagem da galeria e salve. O recorte antigo (que nenhum outro produto usava) sai do Storage em seguida.
- [ ] Um recorte que **outro** produto ainda usa continua no Storage.
- [ ] Excluir um produto não apaga a original da galeria.

Para conferir no Supabase (SQL editor, troque `<loja>` pelo id da Lanches base):

```sql
-- recortes sem uso e pendentes de limpeza
select id, origem_id, caminho, remocao_pendente_em, criado_em
from imagens_loja
where loja_id = '<loja>' and (remocao_pendente_em is not null or origem_id is not null)
order by criado_em desc limit 20;
```

Uma linha com `remocao_pendente_em` preenchida que não some depois de alguns minutos é pendência que a limpeza não conseguiu apagar do Storage. Anote e me avise.

## F. Só em aparelho real

- [ ] Gesto de recorte com o dedo (arrastar e pinça) no produto e na logo.
- [ ] Atalho **Enviar nova imagem** dentro do seletor no iOS Safari (abre a câmera ou a galeria do aparelho).
- [ ] O seletor em tela cheia no celular não deixa a página de trás rolar.

## G. Antes de mesclar

- [ ] Nenhum item acima falhou, ou as falhas viraram correção neste PR.
- [ ] `gh pr checks 184` segue verde depois de qualquer correção.
- [ ] Mover os três arquivos `plan/loop-galeria-imagens-loja*` de volta para `plan/arquivo/` neste PR (regra do projeto). Eles estão em `plan/` só durante o teste.
- [ ] Mesclar. Isso fecha a janela em que salvar foto nova no painel em produção falha (a M4 já está aplicada).
- [ ] Depois do merge: apagar a cópia sem commit de `specs/galeria-imagens-loja.md` na pasta principal e a branch remota `claude/busy-babbage-5c0zr6`.
