// Telas `/conta/*` (entrar, cadastro, recuperar, completar): card centralizado,
// mobile-first, mesmo padrão visual de `(auth)/layout.tsx`.
export default function ContaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}
