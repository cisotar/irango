// Termos de Uso públicos (issue 062). SSG, Server Component, sem auth, sem dado
// sensível — conteúdo PLACEHOLDER. Revisar com jurídico antes de operar
// comercialmente (seguranca.md §20). A versão exibida bate com a constante
// gravada em `consentimento_versao` no aceite do cadastro (issue 015).

import type { Metadata } from "next";

import { FooterPublico } from "@/components/FooterPublico";
import { AvisoJuridicoPlaceholder } from "@/components/AvisoJuridicoPlaceholder";
import { Separator } from "@/components/ui/separator";
import { VERSAO_TERMOS } from "@/lib/constants/termos";

export const metadata: Metadata = {
  title: "Termos de Uso · iRango",
  description: "Condições de uso da plataforma iRango.",
};

export default function TermosPage() {
  return (
    <div className="flex min-h-screen flex-col bg-fundo text-texto">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="mb-2 text-3xl font-bold text-marrom-cafe">
          Termos de Uso
        </h1>
        <p className="mb-6 text-sm text-texto-muted">
          Versão {VERSAO_TERMOS} · Atualizada em 14/06/2026
        </p>

        <div className="mb-8">
          <AvisoJuridicoPlaceholder />
        </div>

        <div className="flex flex-col gap-6 text-sm leading-relaxed text-texto">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              1. Aceitação dos termos
            </h2>
            <p>
              Ao criar uma conta ou utilizar o iRango, você concorda com estes
              Termos de Uso e com a nossa Política de Privacidade. Se não
              concordar, não utilize a plataforma.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              2. A plataforma
            </h2>
            <p>
              O iRango fornece a lojistas uma vitrine on-line para receber
              pedidos. O iRango não é o vendedor dos produtos: a relação de
              compra e venda ocorre diretamente entre o cliente final e a loja.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              3. Responsabilidades do lojista
            </h2>
            <p>
              O lojista é responsável pelas informações da sua loja, pelos
              produtos anunciados, pelos preços e pela entrega dos pedidos, bem
              como pelo cumprimento da legislação aplicável ao seu negócio.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              4. Conta e segurança
            </h2>
            <p>
              Você é responsável por manter a confidencialidade das suas
              credenciais de acesso e por toda atividade realizada na sua conta.
            </p>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              5. Alterações
            </h2>
            <p>
              Podemos atualizar estes Termos periodicamente. A versão vigente é
              sempre a indicada no topo desta página.
            </p>
          </section>
        </div>
      </main>

      <FooterPublico />
    </div>
  );
}
