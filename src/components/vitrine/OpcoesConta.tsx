"use client";

import Link from "next/link";

import { BotaoGoogle } from "@/app/(auth)/BotaoGoogle";
import { SeparadorOu } from "@/components/cliente/Separador";
import { Button } from "@/components/ui/button";
import { hrefsConta } from "@/components/vitrine/menuCliente";

/**
 * Bloco único de "entrar ou criar conta" do menu da vitrine e do aviso do
 * "Finalizar pedido": o Google em destaque (cria a conta ou entra) e os dois
 * caminhos por e-mail com o mesmo peso. `next` volta o cliente para a loja.
 */
export function OpcoesConta({ next }: { next: string | undefined }) {
  const { entrar, cadastro } = hrefsConta(next);
  return (
    <div className="flex flex-col">
      <BotaoGoogle contexto="cliente" next={next} rotulo="Continuar com Google" />
      <SeparadorOu texto="ou com e-mail" />
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          className="min-h-11"
          nativeButton={false}
          render={<Link href={entrar}>Entrar com e-mail</Link>}
        />
        <Button
          variant="outline"
          className="min-h-11"
          nativeButton={false}
          render={<Link href={cadastro}>Criar conta com e-mail</Link>}
        />
      </div>
    </div>
  );
}
