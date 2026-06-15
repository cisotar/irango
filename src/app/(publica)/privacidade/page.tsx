// Política de Privacidade pública (issue 062). SSG, Server Component, sem auth,
// sem dado sensível — conteúdo PLACEHOLDER baseado em seguranca.md §20.
//
// FOLLOW-UP DE PROCESSO (não esta issue): o exercício dos direitos do titular
// LGPD (exclusão e portabilidade de dados) é, no v1, ATENDIMENTO MANUAL pelo
// canal de contato informado abaixo. A automação de expurgo/anonimização e de
// exportação de dados é follow-up futuro — ver seguranca.md §20 (Retenção /
// Exclusão). Esta página apenas informa o direito e o canal; não automatiza.

import type { Metadata } from "next";

import { FooterPublico } from "@/components/FooterPublico";
import { AvisoJuridicoPlaceholder } from "@/components/AvisoJuridicoPlaceholder";
import { Separator } from "@/components/ui/separator";
import { VERSAO_TERMOS } from "@/lib/constants/termos";

export const metadata: Metadata = {
  title: "Política de Privacidade · iRango",
  description: "Como o iRango coleta, usa e protege dados pessoais.",
};

// Canal de contato para exercício de direitos LGPD. Placeholder — não é dado
// pessoal de uma pessoa física (é um endereço institucional fictício do
// produto). Revisar com jurídico/operação antes de operar comercialmente.
const CANAL_PRIVACIDADE = "privacidade@irango.com.br";

export default function PrivacidadePage() {
  return (
    <div className="flex min-h-screen flex-col bg-fundo text-texto">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="mb-2 text-3xl font-bold text-marrom-cafe">
          Política de Privacidade
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
              1. Base legal
            </h2>
            <p>
              Tratamos dados pessoais para a execução do pedido — execução de
              contrato e legítimo interesse, nos termos da Lei Geral de Proteção
              de Dados (LGPD, Lei nº 13.709/2018).
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              2. Dados coletados (minimização)
            </h2>
            <p>
              Coletamos apenas o necessário para entregar seu pedido: nome,
              telefone e endereço de entrega. Não solicitamos CPF nem data de
              nascimento. Dados de cadastro do lojista (e-mail e telefone)
              também são dados pessoais e seguem as mesmas regras.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              3. Retenção
            </h2>
            <p>
              Dados de pedido são mantidos pelo período necessário ao
              atendimento e às obrigações legais. Pedidos antigos podem ser
              anonimizados após o prazo de retenção definido.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              4. Compartilhamento
            </h2>
            <p>
              Seus dados de pedido são compartilhados com a loja na qual você
              comprou, para que ela possa preparar e entregar o pedido. Não
              vendemos dados pessoais a terceiros.
            </p>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              5. Seus direitos (LGPD)
            </h2>
            <p>
              Você pode solicitar a <strong>exclusão</strong> dos seus dados
              pessoais e a <strong>portabilidade</strong> (exportação) deles. No
              momento, essas solicitações são atendidas manualmente pela nossa
              equipe pelo canal de contato:
            </p>
            <p>
              <a
                href={`mailto:${CANAL_PRIVACIDADE}`}
                className="font-medium text-primaria underline"
              >
                {CANAL_PRIVACIDADE}
              </a>
            </p>
          </section>
        </div>
      </main>

      <FooterPublico />
    </div>
  );
}
