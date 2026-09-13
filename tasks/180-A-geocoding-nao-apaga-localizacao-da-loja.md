# [180-A] Falha de geocoding apaga a localização da loja + aviso passa despercebido

**crítica:** NÃO — não toca valor monetário, permissão nem schema. É perda de dado + UX.
**Mundo:** painel do lojista
**Depende de:** —
**Irmã:** `180-B` (mesmo modo de falha, no caminho do cliente). 180-A NÃO depende de
180-B e entrega primeiro. A 180-B é que reusa a classificação de motivo consolidada aqui.
**Origem:** achado colateral da verificação runtime da issue 160
(`plan/loop-160-props-action-obrigatorias.md`, Passo 5). Observado em ambiente sem acesso
de rede ao geocoder: a loja de teste perdeu `latitude`/`longitude` ao salvar o perfil.

> **Provedor:** a redação original falava em Nominatim. A issue 190 trocou para o Google
> Geocoding (`plan/tecnico-geocoding-google.md`). "Serviço de geocoding" abaixo = Google.

## Problema 1 — recálculo desnecessário apaga localização válida

`salvarPerfil` (`src/lib/actions/loja.ts:106-137`) faz um 2º UPDATE **incondicional** que
regeocodifica o endereço a cada save do perfil, mesmo quando o endereço não mudou. Se o
serviço externo falhar por motivo transitório e o retry único (`:120-124`) também falhar,
o código grava `latitude: null, longitude: null`.

Consequência: salvar apenas o **nome** ou a **descrição** da loja, num momento em que o
serviço externo está indisponível, apaga uma localização que já estava correta. A loja
some da busca por proximidade na vitrine e as zonas de entrega por raio ficam inativas
até o lojista salvar o perfil de novo com sucesso.

O comportamento é deliberado (comentário "D3" em `:106-112`: nunca deixar coordenadas
órfãs de um endereço antigo), mas a decisão foi tomada sem separar "endereço mudou" de
"endereço igual".

`src/app/admin/assinantes/actions/admin-perfil.ts:104` repete o mesmo padrão e tem o
mesmo defeito — a correção vale para os dois callers.

## Problema 2 — o aviso é um toast que some sozinho

`PerfilClient.tsx:220-233` já distingue os dois motivos e mostra textos diferentes via
`toast.warning`. Os textos estão corretos, mas o toast desaparece em segundos e o lojista
pode nem ver — e a consequência (loja sem localização, zonas por raio inativas) é séria
demais para um aviso efêmero.

## Escopo

1. **Só regeocodificar quando o endereço mudou de fato.** Comparar os campos de endereço
   do payload com os já gravados na loja; se forem iguais, pular o 2º UPDATE inteiro e
   preservar as coordenadas existentes. Vale para `salvarPerfil` e para `admin-perfil.ts`.
   **Reuso obrigatório:** a lista de campos de endereço já é fonte única em
   `montarConsultaGeocoding` (`src/lib/actions/patches-loja.ts:62`) — derivar a comparação
   dela, não reimplementar a lista. Duas listas divergem no primeiro campo novo.
2. **Manter a limpeza das coordenadas apenas quando o endereço mudou** e a geocodificação
   falhou. Não trocar por "preservar as antigas": endereço novo com coordenada velha
   aponta o pino para o lugar errado e calcula taxa de entrega a partir de um ponto que
   não existe mais — pior que ficar sem localização.
3. **Trocar o toast por modal nos DOIS motivos** (`transitorio` e `nao_encontrado`).
   Decisão do usuário: loja sem coordenada é séria o bastante em qualquer causa — some da
   busca por proximidade e as zonas por raio ficam inativas. Os dois textos atuais já
   estão corretos e são **mantidos na íntegra**; muda só o veículo. Usar o diálogo do
   shadcn já em `components/ui/`, conforme `references/design-system.md`.

## Critério de aceite

- [ ] Salvar o perfil sem alterar o endereço, com o serviço de geocoding indisponível,
      não altera `latitude`/`longitude`.
- [ ] Mesma garantia no caminho do admin (`admin-perfil.ts`).
- [ ] Alterar o endereço com o serviço indisponível limpa as coordenadas e abre o modal.
- [ ] O modal aparece nos dois motivos e exige ação do lojista para fechar.
- [ ] Teste cobrindo endereço igual × endereço alterado, com o geocoding mockado como
      falha transitória.
- [ ] A comparação "endereço mudou" deriva de `montarConsultaGeocoding`, sem segunda
      lista de campos.

## Verificação manual

Sem browser automatizável no ambiente (sem Playwright, sem MCP de browser): confirmar à
mão que o modal aparece e exige ação nos dois motivos, no painel do lojista.
