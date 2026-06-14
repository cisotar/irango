import { resolverAcaoConfirmacao } from './confirmacao'; // RED — arquivo não existe

const PEDIDO_MOCK = { id: 'p-1', token: 'tok-abc', total: 50, loja_id: 'l-1' };

describe('resolverAcaoConfirmacao — invariante anti-vazamento de pedido', () => {
  it('pedido null → redirecionar para a loja', () => {
    const r = resolverAcaoConfirmacao(null, 'minha-loja');
    expect(r.acao).toBe('redirecionar');
    expect(r.destino).toBe('/loja/minha-loja');
  });

  it('pedido existente → mostrar', () => {
    const r = resolverAcaoConfirmacao(PEDIDO_MOCK, 'minha-loja');
    expect(r.acao).toBe('mostrar');
    if (r.acao === 'mostrar') expect(r.pedido).toBe(PEDIDO_MOCK);
  });

  it('ATAQUE: pedido null (token errado) → destino não contém dados do pedido', () => {
    const r = resolverAcaoConfirmacao(null, 'minha-loja');
    expect(JSON.stringify(r)).not.toContain('tok-abc');
    expect(JSON.stringify(r)).not.toContain('p-1');
  });
});
