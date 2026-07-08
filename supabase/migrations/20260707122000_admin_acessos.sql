-- ─────────────────────────────────────────────────────────────────────────────
-- [146] admin_acessos — trilha de auditoria das ações admin (service_role)
--
-- Registra quem/quando/o quê das ações admin sobre lojas de assinantes
-- (billing: toggle de módulo pago; PII cross-tenant: leitura/edição de loja
-- alheia). RLS habilitada SEM policy: deny-all para anon/authenticated; só
-- service_role (BYPASSRLS) acessa. Padrão copiado de webhook_eventos_hotmart
-- (schema_inicial:166-189).
--
-- SEM FK em loja_id (decisão deliberada, revisão de auditoria da issue 146):
-- um audit log deve sobreviver ao ciclo de vida do sujeito auditado. Com FK +
-- `on delete cascade`, o hard-delete de loja (issue 084, excluirLojaPermanente
-- — DELETE único que depende de cascade) apagaria junto a própria evidência da
-- ação de maior privilégio (a exclusão), quebrando rastreabilidade forense/
-- billing. Sem FK, a coluna permanece not null e íntegra na prática: o único
-- writer (issue 147, registrarAcessoAdmin) sempre recebe um lojaId já validado
-- por validarLojaIdAdmin/verificarAdminSaaS antes de logar — órfãos só surgem
-- depois de uma loja ser apagada, que é exatamente o caso que a trilha precisa
-- preservar. Integridade referencial vive na aplicação, não no banco, aqui.
create table if not exists public.admin_acessos (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,       -- id do dono do SaaS (sem FK: sem semântica de cascade)
  loja_id       uuid not null,       -- loja-alvo; SEM FK (ver nota acima — sobrevive ao hard-delete)
  acao          text not null,       -- ex: 'criar_loja', 'salvar_tema', 'alternar_modulo'
  entidade_id   uuid,                -- id da entidade tocada, quando houver
  metadados     jsonb,               -- payload contextual (ex: { modulo, ativo, coluna })
  criado_em     timestamptz not null default now()
);

alter table public.admin_acessos enable row level security; -- deny-all (sem policy — igual a webhook_eventos_hotmart)

create index if not exists admin_acessos_loja_id_criado_em_idx
  on public.admin_acessos (loja_id, criado_em desc); -- consulta futura por loja, mais recentes primeiro

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--   drop table if exists public.admin_acessos;
-- ─────────────────────────────────────────────────────────────────────────────
