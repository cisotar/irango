# [305] RED V2: link e URL hostil na mensagem do modal

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** —
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Segurança, matriz V2; RN-M05, RN-M12)

## Objetivo
Suíte vermelha que prova que só `https://` canônico e bem formado atravessa guard, zod (escrita e leitura) e aviso de saída, e que a mensagem nunca emite `<a>`.

## Escopo
- [ ] Criar `tests/seguranca/modal-sazonal/v2-link.test.tsx`.
- [ ] **A15** (protocolo hostil, lista literal da matriz: `javascript:alert(1)`, `JavaScript:alert(1)`, `java\tscript:`, `data:text/html,<script>…`, `vbscript:`, `http://…`, `//golpe.com`, `/painel`, `mailto:`, `tel:`, `" https://…"`, `https:golpe.com`), camadas:
  - `urlLinkExternoSegura(x) === null`;
  - `schemaMensagemModal` reprova trecho com esse `link`;
  - `lerMensagemModal` devolve `null` para documento cru com esse link;
  - `renderToStaticMarkup(<AvisoSaidaLink link={x as LinkExterno} …/>)` (cast) não contém `<a` nem `href`, e mostra "Este link não está disponível.".
- [ ] **A16** (link enganoso): `null` para `https://irango.vercel.app@golpe.com`, `https://192.168.0.1`, `https://0x7f.1`, `https://[::1]`, `https://localhost`, `https://a.localhost`, `https://golpe.com:8443`, `https://intranet`; fronteira do tamanho bruto 2048/2049 e canônico 1000/1001; homógrafo `https://іrango.com` (i cirílico, escrito com escape `і` no teste) é ACEITO e canonizado para `https://xn--…`; o aviso mostra o hostname `xn--…`.
- [ ] **A17**: `renderToStaticMarkup(<MensagemFormatada …/>)` com 1+ links, com e sem `aoEscolherLink`: zero `<a`, zero `href`; com callback o link é `<button type="button"`; sem callback é `<span`.
- [ ] Delegação: teste afirma que `urlLinkExternoSegura` recusa tudo que `urlHttpsSegura` recusa (amostra da suíte `urlHttpsSegura.test.ts`), sem duplicar o predicado.
- [ ] Capturar o `FAIL`.

## Fora de escopo
Tabnabbing/`rel`/`referrerPolicy` e disfarce de link (310, V7). Produção (313).

## Reuso esperado
- `src/lib/utils/urlHttpsSegura.ts` (fonte única do predicado `https://`, `seguranca.md` §15).
- Padrão `renderToStaticMarkup` de `ModulosImpressaoAdmin.test.tsx`.

## Segurança
Nenhum fetch da URL em nenhum caso (sem SSRF). Caracteres invisíveis/homógrafos escritos com escape no arquivo de teste, nunca literais.

## Critério de aceite
- [ ] A15, A16, A17 cobertos em todas as camadas listadas; `FAIL` capturado antes de produção.
- [ ] Nenhum arquivo em `src/` alterado.
