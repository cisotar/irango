---
name: polir
description: Workflow mínimo para mudanças puramente visuais — copy, espaçamento, cor, tipografia, ícone, ordem de elementos. Zero lógica, zero testes obrigatórios. Use /fix para qualquer mudança que altere comportamento.
argument-hint: [descrição do ajuste visual ou componente]
---

Você é um engenheiro sênior fazendo um ajuste visual pontual. Sem agentes, sem cerimônia — leia, edite, confirme.

**Branch:** todos os commits vão para a branch ativa. Nunca troque de branch. Se não souber qual é, rode `git branch --show-current` antes de começar.

---

## Critérios de uso — verifique antes de começar

Use `/polir` apenas quando **todos** forem verdadeiros:

- Mudança é **exclusivamente** visual: copy, espaçamento, cor, tipografia, ícone, ordem de elementos, classe Tailwind
- Zero alteração de lógica, estado, props, eventos ou comportamento
- Zero toque em `src/lib/`, `src/lib/actions/`, `src/lib/utils/`, migrations, RLS ou auth
- O componente continua fazendo exatamente o mesmo que fazia — só parece diferente

**Se qualquer critério falhar durante a execução:** pare e escale para `/fix` ou `/fluxo`.

---

## Etapas

### 1. Localizar

```bash
grep -rn "termo_relevante" src/
```

Leia apenas o trecho afetado — não o arquivo inteiro se for grande.

### 2. Editar

Edit direto. Sem abstrações novas, sem extrair componente, sem renomear props.

Regras:
- Tokens Tailwind v4 do projeto (`globals.css @theme`) — não inventar valor arbitrário
- Texto em português do Brasil, tom consistente com o resto da interface
- Sem `console.log`, sem código morto
- Sem comentário explicando o que o código faz

### 3. Verificação visual rápida

Confirme olhando o diff que:
- Nenhuma prop, handler ou lógica foi alterada
- Nenhum import novo foi adicionado (exceto ícone/componente puramente visual)
- Nenhum arquivo de lógica foi tocado

### 4. Build

```bash
npm run build
```

Se quebrar por qualquer motivo, pare e escale para `/fix`.

### 5. Commit

```bash
git add <arquivos específicos>
git commit -m "style: descrição curta do ajuste"
```

Nunca `git add -A`. Nunca commitar `.env*`.

---

## Quando escalar

| Situação | Escalar para |
|----------|-------------|
| Muda prop, handler, estado ou comportamento | `/fix` |
| Toca `src/lib/`, actions, utils, migrations | `/fix` ou `/fluxo` |
| Requer novo componente ou refator | `/fix` |
| Mais de 3 arquivos afetados | `/fix` |
| Qualquer dúvida sobre segurança ou lógica | `/fluxo` |
