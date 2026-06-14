"use server";

// Server Actions de auth (issue 015): cadastro (signUp + criação automática da
// loja) e login. Padrão de cupom.ts: safeParse ANTES de qualquer I/O →
// try/catch → console.error no servidor → retorno genérico (seguranca.md §14).
//
// Não confiar no cliente (seguranca.md §10): o servidor IGNORA e nunca lê do
// payload `dono_id`, `assinatura_*`, `consentimento_*`. Todos são derivados aqui.
// `.strict()` em schemaCadastro rejeita esses campos injetados.
//
// D9: confirmação de email é config do painel Supabase (seguranca.md §17); a
//     loja nasce com `ativo` no default. Gate de email confirmado, se houver,
//     é no painel/middleware — não aqui.
// D6: rate limit (login ~5/min por IP) é da issue 052 — não vive nesta action.

import { schemaCadastro, schemaLogin } from "@/lib/validacoes/auth";
import { sanitizarSlug } from "@/lib/validacoes/loja";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { contarLojasDoDono, slugExiste, criarLoja } from "@/lib/supabase/queries/lojas";
import { reconciliarAssinatura } from "@/lib/assinatura/reconciliar";

export type ResultadoCadastro = { ok: true } | { ok: false; erro: string };
export type ResultadoLogin = { ok: true } | { ok: false; erro: string };

// D8: versão corrente dos Termos/Privacidade. Constante de configuração (não é
// dado pessoal — permitido em código, seguranca.md §8). Bump quando os termos
// mudarem (futuro: re-consentimento).
const VERSAO_TERMOS = "2026-06-13";

const TRIAL_DIAS = 14; // RN-A6 (modelo-negocio.md §5)
const MAX_TENTATIVAS_SLUG = 50;

/**
 * Resolve um slug livre a partir de uma base, sufixando `-2`, `-3`… até livre.
 * A unicidade real é garantida pelo `UNIQUE(slug)` do banco; aqui é a checagem
 * otimista (corrida residual é tratada no INSERT pela action).
 */
async function resolverSlugUnico(
  svc: ReturnType<typeof createServiceClient>,
  base: string,
): Promise<string> {
  // Fallback se a base sanitizada ficou curta demais (ex.: email só com símbolos).
  const raiz = base.length >= 3 ? base : `loja-${crypto.randomUUID().slice(0, 8)}`;
  for (let n = 1; n <= MAX_TENTATIVAS_SLUG; n++) {
    const candidato = n === 1 ? raiz : `${raiz}-${n}`;
    if (!(await slugExiste(svc, candidato))) return candidato;
  }
  return `loja-${crypto.randomUUID().slice(0, 8)}`;
}

export async function cadastrar(payload: unknown): Promise<ResultadoCadastro> {
  // 1) Valida ANTES de qualquer I/O. Aceite ausente/false ou senha < 8 saem
  //    como erro SEM chamar signUp/criarLoja (.strict rejeita campos injetados).
  const parsed = schemaCadastro.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Verifique os dados e o aceite dos Termos de Uso." };
  }
  const { email, senha } = parsed.data;

  // 2) Cria o usuário no Supabase Auth (seta o cookie de sessão).
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password: senha });
  if (error || !data.user) {
    // Email duplicado cai aqui — mensagem amigável (D5: revelar existência é
    // inevitável no cadastro; mitigado por rate limit da 052).
    return { ok: false, erro: "Este email já está cadastrado." };
  }
  const userId = data.user.id; // AUTORITATIVO: dono_id vem do signUp, nunca do payload.

  // 3) RN-01 + slug + INSERT rodam via service_role (D7): logo após o signUp o
  //    cookie pode não estar síncrono, e as checagens precisam enxergar lojas
  //    inativas/de outros donos.
  try {
    const svc = createServiceClient();

    // RN-01: dono já tem loja → recusa a 2ª (autoritativo; RLS não conta linhas).
    if ((await contarLojasDoDono(svc, userId)) > 0) {
      return { ok: false, erro: "Este email já está cadastrado." };
    }

    const base = sanitizarSlug(email.split("@")[0] ?? "");
    const slug = await resolverSlugUnico(svc, base);

    const agora = new Date().toISOString();
    const fimTrial = new Date(Date.now() + TRIAL_DIAS * 24 * 60 * 60 * 1000).toISOString();

    const loja = await criarLoja(svc, {
      dono_id: userId, // do retorno do signUp
      nome: "", // nasce vazio
      slug,
      // seguranca.md §17: nasce INATIVA até confirmar email + completar perfil.
      // Sem isso, loja órfã de email não confirmado apareceria na vitrine
      // (vitrine_lojas filtra ativo=true) — squatting de slug por email alheio.
      ativo: false,
      consentimento_em: agora, // servidor decide
      consentimento_versao: VERSAO_TERMOS, // servidor decide
      assinatura_status: "trial", // RN-A6 — servidor decide
      assinatura_fim_periodo: fimTrial, // now + 14d
    });

    // Issue 059: comprou na Hotmart ANTES de ter conta → o webhook gravou eventos
    // órfãos (loja_id NULL) com este email. Vincula-os à loja e aplica o estado
    // real. BEST-EFFORT: falha aqui NÃO derruba o cadastro (loja já existe, em
    // trial vigente). `email` é o autenticado (RN-A1) — vínculo não-forjável.
    //
    // GATE (auditoria 059, FIX 2 ALTA): só reconcilia com POSSE do email
    // comprovada (`email_confirmed_at` setado). Sem isso, um atacante cadastra com
    // o email EXATO da vítima e rouba a assinatura órfã dela antes de provar posse.
    // Com "Confirm email" ON no Supabase, `email_confirmed_at` é null aqui → a
    // reconciliação migra para o callback de confirmação (task 066).
    if (data.user.email_confirmed_at) {
      try {
        await reconciliarAssinatura(svc, email, loja.id);
      } catch (e) {
        console.error("[cadastrar] reconciliacao falhou (best-effort)", e);
      }
    }

    return { ok: true };
  } catch (e: unknown) {
    // Corrida de duplo-submit: o índice único lojas(dono_id) / UNIQUE(slug) barra
    // a 2ª. 23505 é tratado como idempotente — a loja já existe, cadastro ok.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") {
      return { ok: true };
    }
    // INSERT falhou por outro motivo → compensação best-effort (D1): apaga o user
    // recém-criado para não deixar órfão ocupando o email.
    // HACK: compensação não-transacional Auth↔Postgres (D1). Evolução: trigger
    // on auth.users. Se o deleteUser também falhar, D2 (auto-cura no retry) cobre.
    try {
      await createServiceClient().auth.admin.deleteUser(userId);
    } catch (compensacao) {
      console.error("[cadastrar] compensacao deleteUser falhou", compensacao);
    }
    console.error("[cadastrar]", e);
    return { ok: false, erro: "Não foi possível concluir o cadastro. Tente novamente." };
  }
}

export async function entrar(payload: unknown): Promise<ResultadoLogin> {
  const parsed = schemaLogin.safeParse(payload);
  if (!parsed.success) {
    // D5: erro genérico — não revela se o email existe nem a política de senha.
    return { ok: false, erro: "Email ou senha incorretos" };
  }
  const { email, senha } = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.user) {
      return { ok: false, erro: "Email ou senha incorretos" };
    }
    return { ok: true };
  } catch (e) {
    console.error("[entrar]", e);
    return { ok: false, erro: "Email ou senha incorretos" };
  }
}
