// Layout do grupo (auth): páginas /login e /cadastro. Área de produto (tokens
// iRango — não tema de loja). Card centralizado, mobile-first.
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-fundo px-4 py-8">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="text-2xl font-bold text-primaria">🥖 iRango</span>
        </div>
        {children}
      </main>
    </div>
  );
}
