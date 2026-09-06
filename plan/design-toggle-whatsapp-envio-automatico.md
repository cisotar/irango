# Design — Toggle "Envio automático da mensagem de WhatsApp"

Spec: `specs/5-whatsapp-envio-automatico-toggle.md`
Issues: `tasks/123-toggle-envio-automatico-painel-lojista.md`, `tasks/124-paridade-toggle-admin-binding-tenant.md`

## Gate de reuso

- **shadcn/ui varridos:** `src/components/ui/` → `badge, button, card, checkbox, dialog, input, label, menu, radio-group, separator, sheet, switch, textarea`. **`switch.tsx` JÁ EXISTE** — nada a instalar, nenhum comando `npx shadcn@latest add switch` necessário.
- **Componentes painel/vitrine:** `src/components/painel/` (UploadLogoLoja, GerenciarCategorias). Padrão Switch+Label já em uso em `ModulosImpressaoAdmin.tsx` (`LinhaModulo`), `PagamentosClient.tsx`, `EntregasClient.tsx`, `GerenciarCategorias.tsx`.
- **Tokens:** `text-muted-foreground`, `text-destructive`, `border-input`, `ring-ring`, `bg-primary` — todos já usados em `PerfilClient.tsx`. Nenhum token novo.
- **Telas:** `PerfilClient.tsx` (lojista) e `PerfilAdminClient.tsx` (admin).

**Decisão: REUSAR.** `Switch` + `Label` existentes, dentro do mesmo padrão de campo do `PerfilClient` (`div.space-y-1` + `Label` + controle + `p.text-xs.text-muted-foreground`).

**Justificativa:** o controle, o token e o padrão de linha rótulo/descrição/switch já existem no projeto; criar variante nova seria a terceira forma de escrever a mesma coisa.

---

## ACHADO ESTRUTURAL — o bloco é escrito UMA vez, não duas

O brief pede "colar nas duas telas". **Não faça isso.** A paridade já está resolvida por composição:

- `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient.tsx` — componente parametrizado por props de action.
- `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/PerfilAdminClient.tsx:59` — wrapper fino que **renderiza o próprio `PerfilClient`**, injetando `salvarPerfilAdmin(lojaId, payload)`.

Ou seja: o JSX entra **só** em `PerfilClient.tsx` e a tela admin herda paridade pixel-a-pixel por construção (é literalmente o mesmo componente). Duplicar o markup no admin criaria divergência garantida na primeira alteração. `specs/paridade-hub-admin-painel.md` fica satisfeito sem esforço.

A rota `/admin/assinantes/[lojaId]/configuracao` (singular) citada no brief é só um `permanentRedirect` 308 (`configuracao/page.tsx`) para `.../configuracoes/perfil`. **Não tocar.**

Arquivos que mudam por causa da UI:

| Arquivo | Mudança |
|---|---|
| `PerfilClient.tsx` | tipo `PerfilInicial` + estado + payload + o bloco JSX |
| `painel/.../configuracoes/perfil/page.tsx:26` | passar `whatsapp_envio_automatico: loja.whatsapp_envio_automatico` no `inicial` |
| `admin/.../configuracoes/perfil/page.tsx:27` | idem, no `inicial` do `PerfilAdminClient` |
| `PerfilAdminClient.tsx` | **nada** — só repassa `inicial` |

---

## Correção técnica importante: o `Switch` é Base UI, não Radix

`src/components/ui/switch.tsx` importa `@base-ui/react/switch` (Base UI 1.6.0), não Radix. A mecânica de associação é diferente e **isso muda a resposta sobre acessibilidade**:

Em `node_modules/@base-ui/react/switch/root/SwitchRoot.js`:

```js
nativeButton = false,                                   // linha 48 — DEFAULT
const hiddenInputId = nativeButton ? undefined : controlId;  // linha 88
id: nativeButton ? controlId : id,                      // linha 116 (id do root)
```

Consequências práticas:

1. O `id` que você passa em `<Switch id="x" />` **vai para o `<input type="checkbox">` visualmente oculto**, não para o elemento raiz (que é um `<span role="switch">` com id auto-gerado pelo Base UI).
2. Portanto `<Label htmlFor="x">` associa a um **input real** — associação HTML nativa, válida, com clique no rótulo alternando o switch. Não há aqui o problema clássico do Radix (`<button>` como alvo de `htmlFor`).
3. O Base UI propaga o nome acessível para o `role="switch"` sozinho, via `useAriaLabelledBy(..., inputRef, !nativeButton, hiddenInputId)` (linha 114). **Não use `aria-label` junto do `Label`** — duplicaria/competiria com o `aria-labelledby`.
4. `aria-describedby` passado em `<Switch>` cai no **elemento raiz** (`role="switch"`), que é o que o leitor de tela anuncia. É o lugar certo para a dica. (Props do usuário entram como `elementProps` no root, e `id` é desestruturado antes, então não há colisão.)

Ou seja: **`<Label htmlFor={ID}>` + `<Switch id={ID} aria-describedby={...}>` é a forma correta e suficiente.** É exatamente o padrão já usado em `ModulosImpressaoAdmin.tsx:151-165`.

---

## Decisão pedida: a dica aparece sempre ou só quando desabilitado?

**Recomendação: dois textos, com regras diferentes.**

| Texto | Quando | Por quê |
|---|---|---|
| **Auxiliar** — "Ao confirmar o pedido, o WhatsApp abre sozinho com o resumo. O botão para avisar a loja continua disponível para o cliente." | **sempre** | O lojista precisa entender o que o toggle faz *e* que o botão manual não some (RN-A3). Sem isso, "automático" soa como "substitui o manual" e vira medo de desligar/ligar. |
| **Motivo do bloqueio** — "Cadastre um WhatsApp para ativar o envio automático." | **só quando desabilitado** | Mostrar "cadastre um WhatsApp" para quem já cadastrou é ruído e mina a confiança no resto da tela. |

Ambos entram no `aria-describedby` do `Switch` quando presentes — a string é montada condicionalmente (nunca referencie um id que não está no DOM).

**Por que o motivo precisa ser texto visível, e não só `title`/tooltip:** um controle desabilitado sai da ordem de tabulação, então quem navega por Tab nunca chega nele para ouvir a descrição. O texto visível, associado ao rótulo, é lido em modo de leitura/browse e resolve para leitor de tela e para vidente igualmente. Não há SC do WCAG que exija controle desabilitado focável — o que resolve o problema é a informação estar na página, não no hover.

---

## Estado desabilitado — derive do campo ao vivo, não do SSR

`disabled` deve sair do **estado `whatsapp` do form** (o que está digitado agora), não de `inicial.whatsapp`. Assim o toggle destrava no mesmo instante em que o lojista termina de digitar o número, sem salvar e recarregar. É preview de UX; a autoridade continua sendo o servidor (RN-A2 — `montarLinkWhatsappPedido` devolve `null` sem WhatsApp de qualquer jeito).

---

## Alvo de toque

O `Switch` renderiza 20×36px (`h-5 w-9`) — abaixo dos 44px. Solução já validada no projeto (`ModulosImpressaoAdmin.tsx:149`, `LinhaModulo`): a **linha inteira** recebe `min-h-11` (44px) e o `Label` com `htmlFor` + `cursor-pointer` ocupa a coluna esquerda, virando um alvo grande e clicável. Não aumente o tamanho do `Switch` — quebraria os outros 5 usos.

---

## JSX — pronto para colar em `PerfilClient.tsx`

### 1. Import (junto dos demais `@/components/ui/*`, linha ~14)

```tsx
import { Switch } from "@/components/ui/switch";
```

### 2. Tipo `PerfilInicial` (linha 26)

```tsx
export type PerfilInicial = {
  nome: string;
  slug: string;
  telefone: string | null;
  whatsapp: string | null;
  /** Preferência de disparar o WhatsApp ao confirmar o pedido. `NOT NULL DEFAULT true` no banco. */
  whatsapp_envio_automatico: boolean;
  endereco_cep: string | null;
  // …resto inalterado
};
```

### 3. Estado (junto do `useState` de `whatsapp`, linha ~97)

```tsx
  // Preferência de envio automático (spec 5). Default LIGADO — `?? true` cobre
  // loja carregada por caminho legado sem a coluna. Só UX: a decisão real de
  // emitir o link é do servidor em `criarPedido` (RN-A2).
  const [envioAutomatico, setEnvioAutomatico] = useState(
    inicial.whatsapp_envio_automatico ?? true,
  );
```

### 4. Derivada (perto de `slugValido`, linha ~139)

```tsx
  // Destrava assim que o lojista digita um WhatsApp válido — sem esperar o save.
  const temWhatsapp = apenasDigitos(whatsapp).length >= 10;
```

### 5. `montarPayload` — **atenção: booleano NÃO usa spread condicional**

Os campos de texto usam `...(x ? { x } : {})` porque string vazia = "não informado". Para booleano isso é um bug: `false` seria omitido e o lojista **nunca conseguiria desligar**. Sempre envie o valor:

```tsx
      ...(whatsappDigitos ? { whatsapp: `55${whatsappDigitos}` } : {}),
      whatsapp_envio_automatico: envioAutomatico,   // <- sempre, inclusive false
```

(`schemaPerfil` precisa aceitar o campo como booleano; `montarPatchPerfil` precisa incluí-lo na allowlist — fora do escopo desta entrega de design, ver spec §RN-A1.)

### 6. O bloco — logo abaixo do campo de WhatsApp (após a `div` que fecha na linha 312, antes do campo Telefone)

```tsx
            {/* Envio automático do WhatsApp ao confirmar o pedido (spec 5).
                Fica colado ao campo de WhatsApp porque só faz sentido com um
                número cadastrado. `disabled` é gate de UX: o servidor já não
                emite o link sem WhatsApp (RN-A2/RN-A3). */}
            <div
              className="group space-y-1"
              data-disabled={!temWhatsapp ? "true" : undefined}
            >
              <div className="flex min-h-11 items-center justify-between gap-3">
                <Label
                  htmlFor="perfil-whatsapp-envio-automatico"
                  className="cursor-pointer"
                >
                  Enviar a mensagem de WhatsApp automaticamente ao confirmar o
                  pedido
                </Label>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {temWhatsapp && envioAutomatico ? "Ligado" : "Desligado"}
                  </span>
                  <Switch
                    id="perfil-whatsapp-envio-automatico"
                    checked={envioAutomatico}
                    disabled={!temWhatsapp}
                    onCheckedChange={(v) => setEnvioAutomatico(v === true)}
                    aria-describedby={
                      temWhatsapp
                        ? "perfil-whatsapp-envio-automatico-ajuda"
                        : "perfil-whatsapp-envio-automatico-ajuda perfil-whatsapp-envio-automatico-motivo"
                    }
                  />
                </div>
              </div>

              <p
                id="perfil-whatsapp-envio-automatico-ajuda"
                className="text-xs text-muted-foreground"
              >
                Ao confirmar o pedido, o WhatsApp abre sozinho com o resumo. O
                botão para avisar a loja continua disponível para o cliente.
              </p>

              {!temWhatsapp && (
                <p
                  id="perfil-whatsapp-envio-automatico-motivo"
                  className="text-xs text-amber-600 dark:text-amber-500"
                >
                  Cadastre um WhatsApp para ativar o envio automático.
                </p>
              )}
            </div>
```

### 7. As duas `page.tsx`

Em ambas, dentro do objeto `inicial`, logo depois de `whatsapp`:

```tsx
        whatsapp: loja.whatsapp,
        whatsapp_envio_automatico: loja.whatsapp_envio_automatico,
```

- `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/page.tsx` (linha 30)
- `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/page.tsx` (linha 31)

Ambos os loaders (`buscarLojaDoDono`, `carregarLojaAdminBase`) já fazem `select("*")` — a coluna vem sozinha. Os fakes de `PerfilAdminClient.test.tsx` / `page.test.tsx` precisam do campo novo.

---

## Justificativa de cada escolha de estilo (nada inventado)

| Escolha | Origem no código |
|---|---|
| `div.space-y-1` como invólucro do campo | `PerfilClient.tsx:290, 301, 314, 327` — todos os campos |
| `<p className="text-xs text-muted-foreground">` para auxiliar | `PerfilClient.tsx:253, 373` |
| `text-amber-600 dark:text-amber-500` para aviso não-bloqueante | `PerfilClient.tsx:360` (aviso de slug) |
| `flex min-h-11 items-center justify-between gap-3` + `Label cursor-pointer` + `span` de estado | `ModulosImpressaoAdmin.tsx:149-166` |
| `onCheckedChange={(v) => setX(v === true)}` | `PagamentosClient.tsx:198`, `EntregasClient.tsx:159` |
| Espaçamento entre campos | herdado do `form className="space-y-4"` (linha 276) — o bloco não adiciona margem própria |

Cor: **nenhuma cor nova**. `text-amber-*` (e não `text-destructive`) porque não é erro do lojista — é pré-requisito ausente; `destructive` sinalizaria falha e assustaria à toa. Este é o painel, então valem os tokens do projeto — o `tema` por loja (`primaria`/`fundo`/`destaque`) **não se aplica aqui**, só na vitrine.

---

## Checklist de aceite (para o `verificar`)

- [ ] Clicar no **texto do rótulo** alterna o switch (prova a associação `htmlFor` ↔ input oculto do Base UI).
- [ ] Tab chega ao switch com anel de foco visível (`focus-visible:ring-3 ring-ring/50`, já no componente); Espaço/Enter alternam.
- [ ] Leitor de tela anuncia: rótulo completo + "switch, marcado/não marcado" + o texto auxiliar; com WhatsApp vazio, anuncia também o motivo.
- [ ] Sem WhatsApp: switch desabilitado (`opacity-50`, `cursor-not-allowed`), motivo visível.
- [ ] Digitar um WhatsApp válido destrava o switch **sem salvar**.
- [ ] Desligar → Salvar → recarregar: continua desligado (prova que `false` não foi comido pelo spread condicional).
- [ ] Em 360px: rótulo quebra em linhas, switch permanece à direita, sem scroll horizontal.
- [ ] `/admin/assinantes/<id>/configuracoes/perfil` mostra o bloco **idêntico** e grava na loja-alvo.
- [ ] Alvo de toque da linha ≥ 44px de altura.

## Fora do escopo desta entrega

Server Action, `schemaPerfil`, `montarPatchPerfil`, `criarPedido.whatsappHref` e a mecânica de `window.open` (RN-A5) — spec §Regras de Negócio, issues 125/126.
