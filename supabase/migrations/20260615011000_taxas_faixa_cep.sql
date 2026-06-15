-- Issue 064 — habilita o tipo de zona `faixa_cep`, que existia no CHECK de
-- zonas_entrega mas era letra morta (sem schema de faixa em taxas_entrega).
--
-- Adiciona o intervalo de CEP (inteiro de 8 dígitos, só dígitos) à taxa da zona.
-- O par é tudo-ou-nada (bairro/raio_km não usa faixa → ambos NULL) e coerente
-- (inicio <= fim, dentro de [0, 99999999]). O CHECK é a última linha de defesa
-- contra faixa invertida/fora de range vinda de painel mal validado.

ALTER TABLE public.taxas_entrega
  ADD COLUMN IF NOT EXISTS cep_inicio integer,
  ADD COLUMN IF NOT EXISTS cep_fim integer;

ALTER TABLE public.taxas_entrega
  ADD CONSTRAINT taxas_faixa_cep_coerente
  CHECK (
    (cep_inicio IS NULL AND cep_fim IS NULL)
    OR (
      cep_inicio IS NOT NULL AND cep_fim IS NOT NULL
      AND cep_inicio BETWEEN 0 AND 99999999
      AND cep_fim BETWEEN 0 AND 99999999
      AND cep_inicio <= cep_fim
    )
  );
