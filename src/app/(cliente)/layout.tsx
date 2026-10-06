// Layout do grupo (cliente): fundo neutro do iRango (decisão 21), sem tema de
// loja. A largura é de cada área: `/conta/*` é card centralizado e estreito
// (`conta/layout.tsx`); `/minha-conta/*` usa a tela toda com navegação lateral
// (`ShellConta`). A marca e o "Voltar para <loja>" ficam em cada tela, porque o
// link depende do `?next=` (layout não recebe searchParams).
export default function ClienteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-dvh bg-fundo">{children}</div>;
}
