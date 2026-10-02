// /confirmar-email — destino do guard do painel quando o e-mail ainda não foi confirmado.
import Link from "next/link";

export default function ConfirmarEmailPage() {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-xl font-semibold">Confirme seu e-mail</h1>
      <p className="text-sm text-muted-foreground">
        Enviamos um link para você. Abra-o para ativar sua conta.
      </p>
      <Link href="/login" className="inline-block text-sm font-medium text-primaria underline">
        Voltar para o login
      </Link>
    </div>
  );
}
