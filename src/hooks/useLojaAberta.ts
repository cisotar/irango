"use client";

import { useEffect, useMemo, useState } from "react";

import { lojaAberta } from "@/lib/utils/lojaAberta";

/** Tipo exato dos horários que `lojaAberta` espera (lojas.horarios jsonb). */
type Horarios = Parameters<typeof lojaAberta>[0];

export type UseLojaAbertaReturn = {
  aberta: boolean;
  proximaAbertura: string | null; // "HH:MM" da próxima abertura, ou null se aberta
};

const INTERVALO_MS = 60_000; // reavalia a cada 60s

function avaliar(horarios: Horarios, timezone: string): UseLojaAbertaReturn {
  const resultado = lojaAberta(horarios, new Date(), timezone);
  return {
    aberta: resultado.aberta,
    proximaAbertura: resultado.aberta ? null : resultado.reabreEm ?? null,
  };
}

/**
 * Reflete o status de abertura da loja usando a hora local do client,
 * reavaliando periodicamente. Sem I/O — `horarios`/`timezone` vêm do servidor.
 */
export function useLojaAberta(horarios: Horarios, timezone: string): UseLojaAbertaReturn {
  // `tick` força reavaliação periódica sem setState síncrono em effect: o
  // intervalo só incrementa o contador; o valor é derivado via useMemo.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), INTERVALO_MS);
    return () => clearInterval(id);
  }, []);

  // Recalcula em mudança de props OU a cada tick (avaliar lê new Date()).
  return useMemo(() => avaliar(horarios, timezone), [horarios, timezone, tick]);
}
