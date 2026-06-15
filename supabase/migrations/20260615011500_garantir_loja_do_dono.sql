-- Issue 065 — reconciliação de user órfão (fase GREEN).
--
-- `public.garantir_loja_do_dono(p_dono_id, p_email, p_versao_termos)` é a FONTE
-- ÚNICA de "como nasce uma loja por auto-cura": cria a loja do dono se ainda não
-- existe, com trial + consentimento decididos 100% server-side, e é IDEMPOTENTE
-- (RN-01) — chamá-la N vezes ou em corrida produz exatamente 1 loja.
--
-- Não confiar no cliente (seguranca.md §10): nenhum valor monetário/assinatura/
-- consentimento vem do payload. `p_dono_id` é o user autenticado (o guard usa o
-- getUser server-side); `assinatura_status`, `assinatura_fim_periodo` e
-- `consentimento_em` são derivados aqui. A versão dos termos é injetada pelo app
-- (constante do servidor), nunca pelo browser.
--
-- SECURITY DEFINER + REVOKE de PUBLIC/anon/authenticated: só service_role executa.
-- A unicidade real é o índice único lojas(dono_id) (migration unique_loja_por_dono);
-- ON CONFLICT torna a 2ª inserção (corrida / duplo-login) um no-op idempotente.

CREATE OR REPLACE FUNCTION public.garantir_loja_do_dono(
  p_dono_id uuid,
  p_email text,
  p_versao_termos text DEFAULT '1.0'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  -- Idempotência: loja já existe → devolve o id, não cria nada.
  SELECT id INTO v_id FROM public.lojas WHERE dono_id = p_dono_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  -- Slug derivado da parte local do email, sanitizado para passar no CHECK
  -- lojas.slug ~ '^[a-z0-9-]+$' ('.' e '_' de 'joao.silva' viram '-').
  v_slug := lower(split_part(p_email, '@', 1));
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '-', 'g');
  -- Colapsa hífens repetidos e apara das pontas; fallback se ficar vazio.
  v_slug := regexp_replace(v_slug, '-+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN
    v_slug := 'loja-' || replace(gen_random_uuid()::text, '-', '');
  END IF;

  -- Garante UNIQUE(slug): se colidir com loja existente, sufixa com hash do dono.
  IF EXISTS (SELECT 1 FROM public.lojas WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(replace(p_dono_id::text, '-', ''), 1, 8);
  END IF;

  INSERT INTO public.lojas (
    dono_id, nome, slug, ativo,
    consentimento_em, consentimento_versao,
    assinatura_status, assinatura_fim_periodo
  )
  VALUES (
    p_dono_id,
    '',                 -- nome nasce vazio (lojista preenche no perfil)
    v_slug,
    false,              -- loja curada nasce INATIVA (seguranca.md §17)
    now(),              -- consentimento decidido no servidor
    p_versao_termos,    -- versão injetada pelo app
    'trial',            -- RN-A6
    now() + interval '14 days'
  )
  ON CONFLICT (dono_id) DO NOTHING
  RETURNING id INTO v_id;

  -- ON CONFLICT no-op (corrida perdeu a inserção) → relê a loja vencedora.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.lojas WHERE dono_id = p_dono_id;
  END IF;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    -- Defesa extra à corrida (23505 em dono_id OU slug): a loja já existe → idempotente.
    SELECT id INTO v_id FROM public.lojas WHERE dono_id = p_dono_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.garantir_loja_do_dono(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garantir_loja_do_dono(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.garantir_loja_do_dono(uuid, text, text) TO service_role;
