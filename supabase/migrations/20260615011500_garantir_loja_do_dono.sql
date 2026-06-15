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
  v_slug_base text;
  v_slug text;
  v_hash text;
  v_tentativa int;
  c_max_tentativas constant int := 5;
BEGIN
  -- Idempotência: loja já existe → devolve o id, não cria nada.
  SELECT id INTO v_id FROM public.lojas WHERE dono_id = p_dono_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  -- Slug-base derivado da parte local do email, sanitizado para passar no CHECK
  -- lojas.slug ~ '^[a-z0-9-]+$' ('.' e '_' de 'joao.silva' viram '-').
  v_slug_base := lower(split_part(p_email, '@', 1));
  v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9-]', '-', 'g');
  -- Colapsa hífens repetidos e apara das pontas; fallback se ficar vazio.
  v_slug_base := regexp_replace(v_slug_base, '-+', '-', 'g');
  v_slug_base := trim(both '-' from v_slug_base);
  IF v_slug_base = '' THEN
    v_slug_base := 'loja-' || replace(gen_random_uuid()::text, '-', '');
  END IF;

  -- Sufixo determinístico por dono (primeiros 8 hex do dono_id sem hífens).
  v_hash := substr(replace(p_dono_id::text, '-', ''), 1, 8);

  -- Loop de retry robusto à janela TOCTOU de slug (issue 068). NÃO depende de
  -- PG_EXCEPTION_CONSTRAINT (pode faltar/diferir no pglite): distingue os dois
  -- 23505 por RECONSULTA — se após o unique_violation o dono JÁ tem loja, era
  -- conflito de dono_id (corrida do mesmo dono) → idempotente; senão era conflito
  -- de SLUG (outro dono ocupou o slug na janela) → re-deriva e tenta de novo.
  FOR v_tentativa IN 1..c_max_tentativas LOOP
    -- 1ª tentativa usa o slug-base; nas seguintes, sufixa com hash + contador
    -- (-<hash>, -<hash>-2, -<hash>-3, ...), convergindo para um slug livre.
    IF v_tentativa = 1 THEN
      v_slug := v_slug_base;
    ELSIF v_tentativa = 2 THEN
      v_slug := v_slug_base || '-' || v_hash;
    ELSE
      v_slug := v_slug_base || '-' || v_hash || '-' || (v_tentativa - 1);
    END IF;

    BEGIN
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

      IF v_id IS NOT NULL THEN
        RETURN v_id;  -- sucesso: loja criada
      END IF;

      -- ON CONFLICT (dono_id) no-op: corrida do MESMO dono venceu a inserção
      -- → relê a loja vencedora e retorna (idempotente, RN-01).
      SELECT id INTO v_id FROM public.lojas WHERE dono_id = p_dono_id;
      RETURN v_id;
    EXCEPTION
      WHEN unique_violation THEN
        -- 23505 que NÃO foi capturado pelo ON CONFLICT (dono_id) → conflito de
        -- SLUG (ou de dono_id em outra corrida). Distingue por reconsulta:
        SELECT id INTO v_id FROM public.lojas WHERE dono_id = p_dono_id;
        IF v_id IS NOT NULL THEN
          RETURN v_id;  -- dono já tem loja → era conflito de dono_id → idempotente
        END IF;
        -- Dono ainda sem loja → era conflito de SLUG → re-deriva no próximo loop.
    END;
  END LOOP;

  -- Fallback (praticamente impossível): após N tentativas, usa slug uuid
  -- garantidamente livre para honrar o contrato "nunca NULL".
  v_slug := 'loja-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.lojas (
    dono_id, nome, slug, ativo,
    consentimento_em, consentimento_versao,
    assinatura_status, assinatura_fim_periodo
  )
  VALUES (
    p_dono_id, '', v_slug, false,
    now(), p_versao_termos, 'trial', now() + interval '14 days'
  )
  ON CONFLICT (dono_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.lojas WHERE dono_id = p_dono_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.garantir_loja_do_dono(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garantir_loja_do_dono(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.garantir_loja_do_dono(uuid, text, text) TO service_role;
