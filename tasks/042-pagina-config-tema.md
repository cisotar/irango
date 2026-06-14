# [042] Página de tema `/painel/configuracoes/tema`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 019, 023, 030
**Spec:** specs/spec_irango_mvp.md (Tema)

## Objetivo
Três color pickers (primária, fundo, destaque) com preview ao vivo da vitrine e salvamento validado.

## Escopo
- [ ] Criar `src/app/(painel)/painel/configuracoes/tema/page.tsx`
- [ ] FormTema com `react-colorful` (3 cores)
- [ ] PreviewVitrine ao vivo via CSS custom properties (sem salvar)
- [ ] Carregar via `buscarLojaDoDono` (023); salvar via `salvarTema` (030)

## Fora de escopo
Validação hex no servidor (030/019). Aplicação na vitrine real (028/035).

## Reuso esperado
- `schemaTema` (019), `salvarTema` (030), `react-colorful`

## Segurança
- Cores validadas como hex no servidor — sem injeção CSS (spec Tema)

## Critério de aceite
- [ ] Preview muda ao vivo; salvar persiste o tema; cor inválida bloqueada no servidor
