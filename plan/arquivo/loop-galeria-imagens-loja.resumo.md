# Galeria de imagens da loja
2026-10-06 · plano detalhado: plan/loop-galeria-imagens-loja.md

**O que você pediu:** construir a galeria de imagens da loja inteira, sozinho, do começo ao PR aberto, aplicando as mudanças no banco de produção.

**O que vai ser feito:** primeiro o registro das imagens no banco, com as regras que impedem uma loja de mexer nas fotos de outra, provadas por testes escritos antes. Esse registro vai para produção cedo, porque o resto depende dele, e já importa todas as fotos que existem hoje. Depois vêm as ações do servidor (enviar, listar, remover, reaproveitar), também com testes escritos antes, e por fim as telas: a página "Galeria" no painel e no admin, o botão "Escolher da galeria" na foto do produto e na logo, e o item no menu.

**Cuidados:**
- Remover uma foto em uso limpa os produtos e a logo que a usavam, recalculado no servidor na hora; a vitrine mostra o desenho padrão em vez de imagem quebrada.
- Uma loja nunca vê, usa nem apaga imagem de outra: isso é travado no banco e conferido de novo antes de apagar qualquer arquivo.
- A última mudança no banco (a regra "foto do produto precisa estar na galeria") entra por último, depois do PR pronto. A partir dela, **até você mesclar o PR e o site publicar, o painel em produção recusa salvar foto nova de produto e de logo.** Você já aceitou essa janela.

**Tempo estimado:** 4h30 a 5h30 · **Versão mais rápida:** sem a revisão de qualidade do código e juntando as duas etapas de tela, cerca de 45 minutos a menos; não aplicada porque a revisão roda junto com a de segurança.

**Precisa de você:** mesclar o PR assim que puder (fecha a janela); testar no celular o seletor em tela cheia, o recorte com o dedo, o envio de várias fotos e a remoção com confirmação.
