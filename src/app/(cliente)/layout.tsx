// Layout do grupo (cliente): telas neutras do iRango (decisão 21), sem tema de
// loja. Mesmo padrão visual de `(auth)/layout.tsx`: card centralizado,
// mobile-first. A marca e o "Voltar para <loja>" ficam em cada tela, porque o
// link depende do `?next=` (layout não recebe searchParams).
export default function ClienteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-fundo px-4 py-8">
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}
