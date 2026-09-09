# [180] Falha de geocoding apaga localização da loja + aviso passa despercebido

**crítica:** NÃO (não é vazamento nem valor monetário direto; é perda de dado + UX)
**Mundo:** painel do lojista
**Depende de:** —
**Origem:** achado colateral da verificação runtime da issue 160
(`plan/loop-160-props-action-obrigatorias.md`, Passo 5). Observado em ambiente sem acesso de
rede ao Nominatim: a loja de teste perdeu `latitude`/`longitude` ao salvar o perfil.

## Problema 1 — recálculo desnecessário apaga localização válida

`salvarPerfil` (`src/lib/actions/loja.ts:113-137`) faz um 2º UPDATE **incondicional** que
regeocodifica o endereço a cada save do perfil, mesmo quando o endereço não mudou. Se o serviço
externo (Nominatim) falhar por motivo transitório — rede, timeout, serviço fora do ar — e o
retry único (`:121-124`) também falhar, o código grava `latitude: null, longitude: null`.

Consequência: salvar apenas o **nome** ou a **descrição** da loja, num momento em que o serviço
externo está indisponível, apaga uma localização que já estava correta. A loja some da busca
por proximidade na vitrine e as zonas de entrega por raio ficam inativas até o lojista salvar o
perfil de novo com sucesso.

O comportamento é deliberado (comentário "D3" em `:108-109`: nunca deixar coordenadas órfãs de
um endereço antigo), mas a decisão foi tomada sem separar "endereço mudou" de "endereço igual".

## Problema 2 — o aviso é um toast que some sozinho

`PerfilClient.tsx:224-227` já avisa no caso transitório, via `toast.warning`: *"Não conseguimos
localizar seu endereço agora. Tente salvar novamente em instantes para ativar as zonas por
raio."* O texto está correto, mas o toast desaparece em segundos e o lojista pode nem ver — e a
consequência (loja sem localização, zonas por raio inativas) é séria demais para um aviso
efêmero.

## Escopo

1. **Só regeocodificar quando o endereço mudou de fato.** Comparar os campos de endereço do
   payload com os já gravados na loja; se forem iguais, pular o 2º UPDATE inteiro e preservar
   as coordenadas existentes.
2. **Manter a limpeza das coordenadas apenas quando o endereço mudou** e a geocodificação
   falhou. Não trocar por "preservar as antigas": endereço novo com coordenada velha aponta o
   pino para o lugar errado e calcula taxa de entrega a partir de um ponto que não existe mais
   — pior que ficar sem localização.
3. **Trocar o toast por modal** no caso transitório, pedindo que o lojista tente novamente mais
   tarde. Usar o componente de diálogo já disponível em `components/ui/` (shadcn), conforme
   `references/design-system.md`. O caso "endereço não encontrado" (dado ruim do lojista) pode
   seguir como toast ou virar modal também — decidir junto ao design.

## Critério de aceite

- [ ] Salvar o perfil sem alterar o endereço, com o serviço de geocoding indisponível, não
      altera `latitude`/`longitude`.
- [ ] Alterar o endereço com o serviço indisponível limpa as coordenadas e abre o modal.
- [ ] O modal exige ação do lojista para fechar (não some sozinho).
- [ ] Teste cobrindo os dois caminhos (endereço igual vs. endereço alterado) com o geocoding
      mockado como falha transitória.
