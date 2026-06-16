# [010] Tooltip de margem no campo de raio (`/painel/configuracoes/entregas`)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** —
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Adicionar um tooltip/aviso de copy ao campo `raio_max_km` no painel de entregas, orientando o lojista a calibrar com margem por causa da granularidade irregular de CEP do Nominatim no Brasil.

## Escopo
- [ ] Tooltip/help text no campo de raio: explicar que CEPs brasileiros podem resolver no centroide do bairro/município; sugerir margem (ex.: "para atender 5 km reais, configure 7-8 km").
- [ ] Sem mudança de lógica de zona/taxa — só copy/UI.

## Fora de escopo
- Cálculo de frete por raio (issues 006/007).
- Cache/fallback de geocoding por bairro (v2, fora do escopo).
- Qualquer mudança de schema ou validação de `raio_max_km`.

## Reuso esperado
- Componente de tooltip do shadcn/ui já usado no projeto (se existir); caso contrário, help text simples.
- Copy diretamente do spec §"Risco de negócio: granularidade de CEP".

## Segurança
- Puramente estético/copy — sem valor monetário nem autorização. `crítica: NÃO`.

## Critério de aceite
- [ ] Tooltip/help text visível no campo de raio do formulário de zona `raio_km`.
- [ ] `next build` sem erro.
