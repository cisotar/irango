# Spec: Slug Atualizável (perfil da loja)

**Versão:** 0.1.0 | **Atualizado:** 2026-06-15

## Visão Geral

Ao criar conta via Google OAuth, a loja nasce com `slug` derivado da parte local do email (ex.: `tarciso` de `tarciso@gmail.com` — ver `seguranca.md` §17, `garantir_loja_do_dono`). Esse slug raramente reflete o nome real da loja, e a vitrine vive em `irango.com.br/loja/[slug]`.

Esta feature (opção 2 já decidida) torna o **slug editável no painel**: ao preencher o nome da loja em `/painel/configuracoes/perfil`, o slug é **auto-sugerido** a partir do nome via `sanitizarSlug`. O lojista pode aceitar a sugestão ou digitar o próprio slug. Ao salvar, o slug é persistido pela Server Action `salvarPerfil` (que **já** existe e já trata mudança de slug, unicidade e revalidação de cache).

**Mundo:** painel (auth obrigatório). É edição de dado da própria loja — sem dinheiro, sem RLS nova, sem nova permissão.

**Backend já está pronto.** O escopo desta feature é **exclusivamente UI** em um único arquivo: `PerfilClient.tsx`.

## Atores Envolvidos

- **iRango (SaaS):** fornece a UI de perfil e a Server Action que valida/persiste o slug com checagem de unicidade.
- **Lojista:** preenche o nome da loja, ajusta (ou aceita) o slug sugerido, salva. É o único ator desta feature.
- **Cliente:** não participa. (Efeito colateral: o link antigo da vitrine deixa de funcionar — daí o aviso, abaixo.)

## Páginas e Rotas

### Perfil da loja — `/painel/configuracoes/perfil`
**Mundo:** painel (auth obrigatório — guard duplo: `middleware.ts` + layout server-side, ver `architecture.md` §5)
**Descrição:** o lojista vê e edita o nome, WhatsApp, telefone e — com esta feature — o **slug** da loja. O slug deixa de ser campo readonly e passa a ser editável, com prefixo `irango.com.br/loja/` visível, auto-sugestão a partir do nome e aviso inline quando muda.

**Arquivo único de código a modificar:** `src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx`

**Componentes:** (todos já existentes — reuso, sem componente novo)
- `Input` (shadcn/ui) — campo de slug, agora editável (hoje o slug nem tem campo próprio; existe só o campo readonly "Link da sua vitrine").
- `Label` (shadcn/ui) — rótulo do campo slug.
- `Button` + `Copy` (lucide) — botão de copiar link (reuso do já existente).
- Texto inline (`<p className="text-xs ...">`) — aviso de mudança de slug e mensagem de validação em tempo real. **Não usar modal** (decisão de produto: aviso é texto inline, antes de submeter).
- `sanitizarSlug(nome)` de `@/lib/validacoes/loja` — auto-sugestão (reuso, **não recriar**).
- `schemaPerfil` (regex `reSlug = /^[a-z0-9-]{3,60}$/`) de `@/lib/validacoes/loja` — validação client em tempo real (reuso da mesma regex; **não escrever regex paralela**).
- `salvarPerfil` de `@/lib/actions/loja` — persistência (reuso, já trata slug diferente + unicidade + revalidação).

**Behaviors:**
- [x] Editar nome da loja — digita no campo `nome`. Garantido em: cliente (estado local de UX).
- [x] Auto-sugestão de slug — quando `nome` muda **e** o slug ainda está em modo "auto" (nunca editado manualmente), o slug recalcula via `sanitizarSlug(nome)`. Garantido em: cliente (UX, preview de sugestão).
- [x] Editar slug manualmente — digita no campo `slug`; a partir do primeiro toque, a auto-sugestão **para** de seguir o nome (flag `slugEditadoManualmente`). Garantido em: cliente (UX).
- [x] Ver validação do slug em tempo real — enquanto digita, o slug é validado contra `reSlug` (`schemaPerfil`). Se inválido, mensagem inline + botão Salvar desabilitado. Garantido em: cliente (preview); **revalidado na Server Action** (`schemaPerfil.parse` + CHECK no banco — autoritativo).
- [x] Ver aviso de mudança de slug — quando o slug atual difere do slug inicial (`inicial.slug`), exibe inline: "Atenção: o link anterior da vitrine deixará de funcionar." Garantido em: cliente (aviso de UX, antes do submit).
- [x] Copiar link da vitrine — copia `irango.com.br/loja/<slug-atual>` para a área de transferência. Garantido em: cliente (UX). O link reflete o slug **digitado**, ainda não salvo (preview).
- [x] Salvar perfil — submete nome, slug, telefone, whatsapp. **Garantido em: Server Action `salvarPerfil` + RLS.** O servidor revalida `schemaPerfil`, checa unicidade do slug excluindo a própria loja (`slugExiste` via `service_role`), aplica RLS `lojas_update_proprio` (`auth.uid() = dono_id`), e o CHECK `lojas_slug_formato` no banco é a última linha. Em colisão, retorna `ERRO_SLUG_OCUPADO` → toast de erro.
- [x] Ver feedback de slug ocupado — se outra loja já usa o slug, o toast de erro do `salvarPerfil` aparece e o slug **não** é persistido. Garantido em: Server Action (unicidade) + RLS.

---

## Modelos de Dados

Nenhuma migration nova. Nenhuma tabela nova. Nenhuma coluna nova.

A feature escreve em `lojas.slug` (`text UNIQUE NOT NULL`, ver `schema.md` §2) — coluna já existente. Garantias de banco já vigentes:
- `UNIQUE` em `lojas(slug)` + índice único `lojas(slug)` (`schema.md` §3).
- `CONSTRAINT lojas_slug_formato CHECK (slug ~ '^[a-z0-9-]+$')` — defesa em profundidade no banco.
- RLS `lojas_update_proprio` com `WITH CHECK (auth.uid() = dono_id)` (`seguranca.md` §2) — só o dono edita a própria loja; não dá para trocar slug de outra loja.

> **Nota:** a regex do banco (`^[a-z0-9-]+$`) é mais permissiva que a do app (`^[a-z0-9-]{3,60}$`). A do app é o gate de comprimento — o banco garante apenas o alfabeto. Ambas já existem; esta feature não as altera.

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| Slug inicial deriva do email no signup | Já garantido server-side em `garantir_loja_do_dono` (`seguranca.md` §17) — fora do escopo desta feature. |
| Ao preencher o nome pela primeira vez, o slug auto-atualiza (modo "auto") | Cliente (UX/preview). |
| Se o lojista editar o slug manualmente, a auto-sugestão para de seguir o nome | Cliente (flag de estado `slugEditadoManualmente`). |
| Slug deve casar `^[a-z0-9-]{3,60}$` | Cliente (preview, desabilita Salvar) **+ Server Action** (`schemaPerfil`, autoritativo) **+ CHECK no banco** (`lojas_slug_formato`). |
| Slug deve ser único entre lojas | **Server Action** (`slugExiste` excluindo a própria loja) **+ UNIQUE no banco**. Nunca no cliente. |
| Mudar o slug quebra o link antigo da vitrine | Cliente exibe aviso inline antes do submit. O efeito real (revalidação do path antigo + novo) já está em `salvarPerfil` → `revalidarVitrine(dados.slug, loja.slug)`. |
| Lojista só edita a própria loja | **RLS** `lojas_update_proprio` (`auth.uid() = dono_id`). |

## Segurança (obrigatório)

- **Dado sensível?** O slug não é PII nem segredo — é identificador público da vitrine. Nome/WhatsApp/telefone (PII do lojista) já são tratados pelo fluxo existente; esta feature não muda como entram/saem.
- **Valor monetário?** Não. Sem recálculo de dinheiro envolvido — nenhum vetor de subpagamento.
- **Tabela nova / RLS nova?** Não. Reusa `lojas` e as policies existentes (`lojas_update_proprio` com `WITH CHECK`).
- **API externa com key?** Não.
- **Confiar no cliente?** Não. A validação client-side do slug (regex em tempo real, botão desabilitado) é **somente UX**. A verdade é o `schemaPerfil.parse` na Server Action + checagem de unicidade via `service_role` (escopada por slug, excluindo a própria loja) + `UNIQUE`/`CHECK` no banco. O cliente nunca decide que um slug é válido/único — só estima para feedback imediato.
- **Auto-promoção via campo extra?** Já fechado: `schemaPerfil` é `.strict()` (rejeita `dono_id`, `assinatura_*`, `ativo` etc. antes de qualquer I/O) e o trigger `lojas_protege_billing_trg` é o gate de coluna no banco (`seguranca.md` §2). Esta feature não envia campos novos.

## Fora do Escopo (v1)

- **Redirecionamento 301 do slug antigo → novo.** O link antigo simplesmente deixa de funcionar (`notFound()`), conforme o aviso. Histórico de slugs / redirect permanente é fase 2 (relacionado a "domínio próprio por loja", `modelo-negocio.md` §8 fase 3).
- **Histórico de slugs anteriores** (tabela de aliases). Não há tabela nova nesta feature.
- **Alterar a Server Action `salvarPerfil`, `sanitizarSlug`, `schemaPerfil` ou qualquer migration/RLS.** Tudo isso já existe e funciona — esta feature **não** os toca.
- **Subdomínio / domínio próprio** (`minha-loja.irango.com.br`, `minhaloja.com.br`) — fase 2/3 (`modelo-negocio.md` §8).
- **Validação de unicidade em tempo real enquanto digita** (debounce + check no servidor). v1 só valida formato no cliente; unicidade é checada no submit. Check assíncrono é melhoria futura, não bloqueante.
