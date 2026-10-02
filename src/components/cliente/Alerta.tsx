/** Alerta de erro (`role="alert"`) — padrão visual do `LoginForm`. */
export function AlertaErro({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      ⚠ {children}
    </div>
  );
}

/** Aviso neutro (`role="status"`): não sugere sucesso nem existência de conta. */
export function AvisoNeutro({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-texto">
      {children}
    </div>
  );
}
