/** Monta um link de `/conta/*` preservando o `next` (já sanitizado pelo servidor). */
export function comNext(caminho: string, next: string | undefined): string {
  return next ? `${caminho}?${new URLSearchParams({ next }).toString()}` : caminho;
}
