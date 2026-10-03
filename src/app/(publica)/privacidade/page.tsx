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
          Versão {VERSAO_TERMOS} · Atualizada em 03/10/2026
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
              Para fazer um pedido, coletamos o necessário para entregá-lo: nome, telefone e endereço de entrega. Dados de cadastro do lojista (e-mail e telefone) também são dados pessoais e seguem as mesmas regras.
            </p>
            <p>
              Se você criar uma conta de cliente, também guardamos: e-mail, data de nascimento (usada para verificar a idade mínima de 18 anos e para o aniversário) e até 3 endereços salvos. Esses dados do perfil só são coletados depois que você confirma o seu e-mail; antes disso, nada do perfil é guardado.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              3. Conta de cliente e idade mínima
            </h2>
            <p>
              A conta de cliente é opcional e destinada a maiores de 18 anos. O aceite destes termos e desta política é registrado ao completar o cadastro, junto com a versão aceita.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              4. Login com Google
            </h2>
            <p>
              Se você entrar com o Google, recebemos apenas o seu nome e o seu e-mail. Os demais dados do perfil (telefone, data de nascimento e endereços) são informados por você ao completar o cadastro.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              5. Marketing
            </h2>
            <p>
              O recebimento de comunicações de marketing é opcional e vem desmarcado por padrão. Você só recebe se marcar a opção, e pode desmarcá-la depois.
            </p>
            <p>
              Ao marcar a opção, você aceita receber promoções das lojas em que compra com a sua conta. Cada loja vê, na sua lista de clientes, se você marcou ou não essa opção.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              6. Retenção
            </h2>
            <p>
              Dados de pedido são mantidos pelo período necessário ao atendimento e às obrigações legais, e pedidos antigos podem ser anonimizados após 5 anos. O perfil de cliente é mantido enquanto a conta existir. Contas inativas por 24 meses têm o perfil removido.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              7. Compartilhamento
            </h2>
            <p>
              Seus dados de pedido são compartilhados com a loja na qual você comprou, para que ela possa preparar e entregar o pedido. Não vendemos dados pessoais a terceiros.
            </p>
            <p>
              Se você fez o pedido logado na sua conta de cliente, a loja onde comprou também mantém uma lista de clientes, na qual vê o seu nome, o seu telefone, o dia e o mês do seu aniversário (sem o ano), se você aceitou receber promoções, a quantidade de pedidos e o histórico dos seus pedidos naquela loja. A loja não vê o seu e-mail, a sua data de nascimento completa nem os endereços salvos na sua conta. Pedidos feitos sem conta (como convidado) não entram nessa lista.
            </p>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-marrom-cafe">
              8. Seus direitos (LGPD)
            </h2>
            <p>
              Você pode solicitar a <strong>exclusão</strong> dos seus dados
              pessoais e a <strong>portabilidade</strong> (exportação) deles. Se
              você tem conta de cliente, pode excluir a conta e os dados do
              perfil sozinho em <strong>/minha-conta</strong>. Para as demais
              solicitações (e para contas de lojista), o atendimento é manual
              pela nossa equipe, pelo canal de contato:
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
