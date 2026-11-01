/** Tempo mínimo da recuperação, para não revelar existência pela latência. */
const TEMPO_MINIMO_RECUPERACAO_MS = 1500;

/** Espera até `pisoMs` contados de `inicio` (`Date.now()`); não espera se já passou. */
export async function aguardarPisoDeLatencia(
  inicio: number,
  pisoMs: number = TEMPO_MINIMO_RECUPERACAO_MS,
): Promise<void> {
  const restante = pisoMs - (Date.now() - inicio);
  if (restante > 0) await new Promise((r) => setTimeout(r, restante));
}
