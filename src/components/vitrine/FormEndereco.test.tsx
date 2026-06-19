// RED (TDD red-first) — issue 001. `montarEnderecoCompleto` e a prop
// `enderecoInicial` do FormEndereco ainda NÃO existem. Estes testes provam o
// invariante RN-1-A/B/C: o que o cliente VÊ (inputs) e o que o estado GUARDA
// (estado.endereco) são a MESMA verdade. Form vazio ⇒ null; endereço persistido
// ⇒ o form reflete e emite o MESMO endereço; sem fantasma pós-hidratação.
//
// Ambiente: vitest environment=node — sem jsdom. Estratégia: renderToStaticMarkup
// (react-dom/server) p/ asserções sobre o HTML, idêntica a HeaderLoja.test.tsx;
// + teste unitário da função pura montarEnderecoCompleto.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FormEndereco,
  montarEnderecoCompleto,
  type EnderecoEntrega,
} from "@/components/vitrine/FormEndereco";

const ENDERECO: EnderecoEntrega = {
  cep: "01310-100",
  rua: "Av. Paulista",
  numero: "1000",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  uf: "SP",
};

describe("montarEnderecoCompleto (issue 001)", () => {
  it("todos os obrigatórios preenchidos → retorna o endereço (trim aplicado, cep cru)", () => {
    expect(
      montarEnderecoCompleto({
        cep: "01310-100",
        rua: " Av. Paulista ",
        numero: " 1000 ",
        complemento: "",
        bairro: " Bela Vista ",
        cidade: " São Paulo ",
        uf: " SP ",
      }),
    ).toEqual({
      cep: "01310-100",
      rua: "Av. Paulista",
      numero: "1000",
      complemento: undefined,
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "SP",
    });
  });

  it("qualquer obrigatório vazio → null (form incompleto ⇒ estado null, RN-1-B)", () => {
    expect(
      montarEnderecoCompleto({
        cep: "01310-100",
        rua: "Av. Paulista",
        numero: "",
        complemento: "",
        bairro: "Bela Vista",
        cidade: "São Paulo",
        uf: "SP",
      }),
    ).toBeNull();
  });

  it("tudo vazio → null", () => {
    expect(
      montarEnderecoCompleto({
        cep: "",
        rua: "",
        numero: "",
        complemento: "",
        bairro: "",
        cidade: "",
        uf: "",
      }),
    ).toBeNull();
  });

  it("complemento preenchido → incluído (trim)", () => {
    const r = montarEnderecoCompleto({
      cep: "01310-100",
      rua: "Av. Paulista",
      numero: "1000",
      complemento: " Apto 5 ",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "SP",
    });
    expect(r?.complemento).toBe("Apto 5");
  });
});

describe("FormEndereco — hidratação a partir de enderecoInicial (issue 001)", () => {
  it("com enderecoInicial → inputs renderizam os valores persistidos (form reflete o estado)", () => {
    const html = renderToStaticMarkup(
      <FormEndereco enderecoInicial={ENDERECO} onEnderecoChange={() => {}} />,
    );
    // Campos de texto VISÍVEIS (Input shadcn) renderizam value no HTML estático.
    // UF não tem input próprio (vem só do ViaCEP p/ o estado), por isso não é
    // asserido aqui; sua hidratação no estado é coberta por montarEnderecoCompleto.
    expect(html).toContain('value="Av. Paulista"');
    expect(html).toContain('value="Bela Vista"');
    expect(html).toContain('value="São Paulo"');
    expect(html).toContain('value="1000"');
  });

  it("sem enderecoInicial → inputs vazios (nenhum valor fantasma)", () => {
    const html = renderToStaticMarkup(
      <FormEndereco onEnderecoChange={() => {}} />,
    );
    expect(html).not.toContain('value="Av. Paulista"');
    expect(html).not.toContain('value="Bela Vista"');
  });
});
