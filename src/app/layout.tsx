import type { Metadata } from "next";
import { Toaster } from "sonner";
import { RegistrarSW } from "@/components/pwa/RegistrarSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "iRango",
  description: "Marketplace de lojas — peça direto do lojista.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <Toaster position="top-center" richColors />
        <RegistrarSW />
      </body>
    </html>
  );
}
