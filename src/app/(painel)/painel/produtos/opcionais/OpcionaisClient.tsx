"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import {
  schemaCategoriaOpcional,
  schemaOpcional,
} from "@/lib/validacoes/opcional";
import {
  criarCategoriaOpcional,
  atualizarCategoriaOpcional,
  removerCategoriaOpcional,
  criarOpcional,
  atualizarOpcional,
  alternarOpcionalAtivo,
  removerOpcional,
  salvarAssociacaoOpcionais,
} from "@/lib/actions/opcional";
import type {
  CategoriaOpcional,
  Opcional,
} from "@/lib/supabase/queries/opcionais";

type CategoriaProduto = { id: string; nome: string };
type Associacao = { categoria_id: string; categoria_opcional_id: string };

export type OpcionaisClientProps = {
  categoriasOpcional: CategoriaOpcional[];
  opcionais: Opcional[];
  categoriasProduto: CategoriaProduto[];
  associacoes: Associacao[];
};

export function OpcionaisClient({
  categoriasOpcional,
  opcionais,
  categoriasProduto,
  associacoes,
}: OpcionaisClientProps) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-4 py-6">
      <BibliotecaOpcionais
        categoriasOpcional={categoriasOpcional}
        opcionais={opcionais}
      />
      <Separator />
      <AssociacaoOpcionais
        categoriasOpcional={categoriasOpcional}
        categoriasProduto={categoriasProduto}
        associacoes={associacoes}
      />
    </main>
  );
}

// ── 088 — biblioteca: categorias de opcional + itens ────────────────────────

function BibliotecaOpcionais({
  categoriasOpcional,
  opcionais,
}: {
  categoriasOpcional: CategoriaOpcional[];
  opcionais: Opcional[];
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");

  // Sheets de form. null => criar.
  const [catForm, setCatForm] = useState<{
    aberto: boolean;
    cat: CategoriaOpcional | null;
  }>({ aberto: false, cat: null });
  const [opcForm, setOpcForm] = useState<{
    aberto: boolean;
    opc: Opcional | null;
    categoriaOpcionalId: string | null;
  }>({ aberto: false, opc: null, categoriaOpcionalId: null });

  const [catARemover, setCatARemover] = useState<CategoriaOpcional | null>(
    null,
  );
  const [opcARemover, setOpcARemover] = useState<Opcional | null>(null);
  const [removendoCat, startRemoverCat] = useTransition();
  const [removendoOpc, startRemoverOpc] = useTransition();
  const [alternando, startAlternar] = useTransition();

  const buscaNorm = busca.trim().toLowerCase();

  const grupos = useMemo(() => {
    return categoriasOpcional.map((cat) => ({
      cat,
      itens: opcionais
        .filter((o) => o.categoria_opcional_id === cat.id)
        .filter(
          (o) => !buscaNorm || o.nome.toLowerCase().includes(buscaNorm),
        ),
    }));
  }, [categoriasOpcional, opcionais, buscaNorm]);

  function aoSalvar() {
    setCatForm({ aberto: false, cat: null });
    setOpcForm({ aberto: false, opc: null, categoriaOpcionalId: null });
    router.refresh();
  }

  function confirmarRemoverCat() {
    if (!catARemover) return;
    const id = catARemover.id;
    startRemoverCat(async () => {
      const r = await removerCategoriaOpcional(id);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria removida.");
      setCatARemover(null);
      router.refresh();
    });
  }

  function confirmarRemoverOpc() {
    if (!opcARemover) return;
    const id = opcARemover.id;
    startRemoverOpc(async () => {
      const r = await removerOpcional(id);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Opcional removido.");
      setOpcARemover(null);
      router.refresh();
    });
  }

  function alternar(o: Opcional) {
    startAlternar(async () => {
      const r = await alternarOpcionalAtivo(o.id, !o.ativo);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Opcionais
        </h1>
        <Button onClick={() => setCatForm({ aberto: true, cat: null })}>
          <Plus className="size-4" />
          Nova categoria
        </Button>
      </div>

      <div className="mb-4">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar opcional por nome…"
          aria-label="Buscar opcional por nome"
        />
      </div>

      {categoriasOpcional.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma categoria de opcional ainda. Crie a primeira com &ldquo;Nova
            categoria&rdquo;.
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {grupos.map(({ cat, itens }) => (
          <section key={cat.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {cat.nome}
              </h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setOpcForm({
                      aberto: true,
                      opc: null,
                      categoriaOpcionalId: cat.id,
                    })
                  }
                >
                  <Plus className="size-4" />
                  Item
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Editar categoria ${cat.nome}`}
                  onClick={() => setCatForm({ aberto: true, cat })}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover categoria ${cat.nome}`}
                  onClick={() => setCatARemover(cat)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
            <Card>
              <CardContent className="divide-y divide-foreground/10 p-0">
                {itens.length === 0 && (
                  <div className="px-4 py-3 text-sm text-muted-foreground">
                    Nenhum item nesta categoria.
                  </div>
                )}
                {itens.map((o) => (
                  <div key={o.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {o.nome}
                        </span>
                        {!o.ativo && <Badge variant="outline">Inativo</Badge>}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        +{formatarMoeda(o.preco)}
                      </span>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        checked={o.ativo}
                        disabled={alternando}
                        onCheckedChange={() => alternar(o)}
                        aria-label={`${o.ativo ? "Desativar" : "Ativar"} ${o.nome}`}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Editar ${o.nome}`}
                      onClick={() =>
                        setOpcForm({
                          aberto: true,
                          opc: o,
                          categoriaOpcionalId: o.categoria_opcional_id,
                        })
                      }
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remover ${o.nome}`}
                      onClick={() => setOpcARemover(o)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        ))}
      </div>

      {/* Sheet categoria de opcional */}
      <Sheet
        open={catForm.aberto}
        onOpenChange={(aberto) =>
          setCatForm((s) => ({ ...s, aberto }))
        }
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {catForm.cat ? "Editar categoria" : "Nova categoria"}
            </SheetTitle>
            <SheetDescription>
              Agrupe os opcionais (ex.: Laticínios, Charcutaria).
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Separator className="mb-4" />
            <FormCategoriaOpcional
              key={catForm.cat?.id ?? "nova"}
              inicial={catForm.cat}
              onSucesso={aoSalvar}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Sheet opcional (item) */}
      <Sheet
        open={opcForm.aberto}
        onOpenChange={(aberto) =>
          setOpcForm((s) => ({ ...s, aberto }))
        }
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {opcForm.opc ? "Editar opcional" : "Novo opcional"}
            </SheetTitle>
            <SheetDescription>
              Item adicional pago, escolhido pelo cliente no produto.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Separator className="mb-4" />
            <FormOpcional
              key={opcForm.opc?.id ?? `novo-${opcForm.categoriaOpcionalId}`}
              inicial={opcForm.opc}
              categoriasOpcional={categoriasOpcional}
              categoriaOpcionalIdPadrao={opcForm.categoriaOpcionalId}
              onSucesso={aoSalvar}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmação remover categoria */}
      <DialogConfirmarRemocao
        aberto={catARemover !== null}
        titulo="Remover categoria"
        descricao={
          catARemover
            ? `Remover "${catARemover.nome}" e todos os seus opcionais? Esta ação não pode ser desfeita.`
            : ""
        }
        carregando={removendoCat}
        onConfirmar={confirmarRemoverCat}
        onFechar={() => setCatARemover(null)}
      />

      {/* Confirmação remover opcional */}
      <DialogConfirmarRemocao
        aberto={opcARemover !== null}
        titulo="Remover opcional"
        descricao={
          opcARemover
            ? `Remover "${opcARemover.nome}"? Pedidos anteriores não são afetados.`
            : ""
        }
        carregando={removendoOpc}
        onConfirmar={confirmarRemoverOpc}
        onFechar={() => setOpcARemover(null)}
      />
    </section>
  );
}

function FormCategoriaOpcional({
  inicial,
  onSucesso,
}: {
  inicial: CategoriaOpcional | null;
  onSucesso: () => void;
}) {
  const ehEdicao = inicial != null;
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [ordem, setOrdem] = useState(String(inicial?.ordem ?? 0));
  const [enviando, startEnvio] = useTransition();

  function salvar() {
    const payload = { nome: nome.trim(), ordem: Number(ordem) || 0 };
    const parsed = schemaCategoriaOpcional.safeParse(payload);
    if (!parsed.success) {
      toast.error("Confira os dados da categoria.");
      return;
    }
    startEnvio(async () => {
      const r =
        ehEdicao && inicial
          ? await atualizarCategoriaOpcional(inicial.id, parsed.data)
          : await criarCategoriaOpcional(parsed.data);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria salva!");
      onSucesso();
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="cat-opc-nome">Nome</Label>
        <Input
          id="cat-opc-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Laticínios"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cat-opc-ordem">Ordem</Label>
        <Input
          id="cat-opc-ordem"
          value={ordem}
          onChange={(e) => setOrdem(e.target.value)}
          inputMode="numeric"
          placeholder="0"
        />
      </div>
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Criar categoria"}
      </Button>
    </form>
  );
}

function FormOpcional({
  inicial,
  categoriasOpcional,
  categoriaOpcionalIdPadrao,
  onSucesso,
}: {
  inicial: Opcional | null;
  categoriasOpcional: CategoriaOpcional[];
  categoriaOpcionalIdPadrao: string | null;
  onSucesso: () => void;
}) {
  const ehEdicao = inicial != null;
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [preco, setPreco] = useState(
    inicial?.preco != null ? String(inicial.preco) : "",
  );
  const [categoriaOpcionalId, setCategoriaOpcionalId] = useState(
    inicial?.categoria_opcional_id ?? categoriaOpcionalIdPadrao ?? "",
  );
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [ordem, setOrdem] = useState(String(inicial?.ordem ?? 0));
  const [enviando, startEnvio] = useTransition();

  function salvar() {
    // Aceita vírgula decimal (UX pt-BR).
    const precoNumero = Number(preco.replace(",", "."));
    const payload = {
      nome: nome.trim(),
      preco: precoNumero,
      categoria_opcional_id: categoriaOpcionalId,
      ativo,
      ordem: Number(ordem) || 0,
    };
    const parsed = schemaOpcional.safeParse(payload);
    if (!parsed.success) {
      toast.error("Confira os dados do opcional.");
      return;
    }
    startEnvio(async () => {
      const r =
        ehEdicao && inicial
          ? await atualizarOpcional(inicial.id, parsed.data)
          : await criarOpcional(parsed.data);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Opcional salvo!");
      onSucesso();
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="opc-nome">Nome</Label>
        <Input
          id="opc-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Brie extra"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="opc-preco">Acréscimo (R$)</Label>
        <Input
          id="opc-preco"
          value={preco}
          onChange={(e) => setPreco(e.target.value)}
          placeholder="0,00"
          inputMode="decimal"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="opc-categoria">Categoria de opcional</Label>
        <select
          id="opc-categoria"
          value={categoriaOpcionalId}
          onChange={(e) => setCategoriaOpcionalId(e.target.value)}
          className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          required
        >
          <option value="">Selecione…</option>
          {categoriasOpcional.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="opc-ordem">Ordem</Label>
        <Input
          id="opc-ordem"
          value={ordem}
          onChange={(e) => setOrdem(e.target.value)}
          inputMode="numeric"
          placeholder="0"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Switch checked={ativo} onCheckedChange={(v) => setAtivo(v === true)} />
        <span className="text-foreground">Ativo na vitrine</span>
      </label>
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Criar opcional"}
      </Button>
    </form>
  );
}

// ── 089 — associação categoria de produto ⋈ categorias de opcional ──────────

function AssociacaoOpcionais({
  categoriasOpcional,
  categoriasProduto,
  associacoes,
}: {
  categoriasOpcional: CategoriaOpcional[];
  categoriasProduto: CategoriaProduto[];
  associacoes: Associacao[];
}) {
  const router = useRouter();

  // Conjunto atual por categoria de produto → set de categoria_opcional_id.
  const inicialPorProduto = useMemo(() => {
    const mapa = new Map<string, Set<string>>();
    for (const a of associacoes) {
      const set = mapa.get(a.categoria_id) ?? new Set<string>();
      set.add(a.categoria_opcional_id);
      mapa.set(a.categoria_id, set);
    }
    return mapa;
  }, [associacoes]);

  return (
    <section>
      <h2 className="mb-1 font-heading text-lg font-semibold text-foreground">
        Opcionais por categoria de produto
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Escolha quais categorias de opcional aparecem para os produtos de cada
        categoria. Quem não tiver nenhuma marcada fica &ldquo;sem
        opcionais&rdquo;.
      </p>

      {categoriasProduto.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Crie categorias de produto primeiro para associar opcionais.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {categoriasProduto.map((catProd) => (
          <CartaoAssociacao
            key={catProd.id}
            categoriaProduto={catProd}
            categoriasOpcional={categoriasOpcional}
            selecionadosIniciais={inicialPorProduto.get(catProd.id) ?? new Set()}
            onSalvo={() => router.refresh()}
          />
        ))}
      </div>
    </section>
  );
}

function CartaoAssociacao({
  categoriaProduto,
  categoriasOpcional,
  selecionadosIniciais,
  onSalvo,
}: {
  categoriaProduto: CategoriaProduto;
  categoriasOpcional: CategoriaOpcional[];
  selecionadosIniciais: Set<string>;
  onSalvo: () => void;
}) {
  const [selecionados, setSelecionados] =
    useState<Set<string>>(selecionadosIniciais);
  const [salvando, startSalvar] = useTransition();

  function alternar(catOpcId: string, marcado: boolean) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (marcado) {
        proximo.add(catOpcId);
      } else {
        proximo.delete(catOpcId);
      }
      return proximo;
    });
  }

  function salvar() {
    startSalvar(async () => {
      const r = await salvarAssociacaoOpcionais({
        categoria_id: categoriaProduto.id,
        categoria_opcional_id: Array.from(selecionados),
      });
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Associação salva!");
      onSalvo();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-medium text-foreground">
          {categoriaProduto.nome}
        </h3>
        {categoriasOpcional.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Crie categorias de opcional para poder associá-las.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {categoriasOpcional.map((catOpc) => (
              <label
                key={catOpc.id}
                className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
              >
                <Checkbox
                  checked={selecionados.has(catOpc.id)}
                  onCheckedChange={(v) => alternar(catOpc.id, v === true)}
                />
                <span className="truncate">{catOpc.nome}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={salvando || categoriasOpcional.length === 0}
            onClick={salvar}
          >
            {salvando && <Loader2 className="mr-2 size-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── auxiliar — diálogo de confirmação de remoção ────────────────────────────

function DialogConfirmarRemocao({
  aberto,
  titulo,
  descricao,
  carregando,
  onConfirmar,
  onFechar,
}: {
  aberto: boolean;
  titulo: string;
  descricao: string;
  carregando: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  return (
    <AlertDialog.Root
      open={aberto}
      onOpenChange={(estaAberto) => {
        if (!estaAberto) onFechar();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover p-5 text-popover-foreground shadow-lg transition-all data-ending-style:opacity-0 data-starting-style:opacity-0">
          <AlertDialog.Title className="font-heading text-base font-medium text-foreground">
            {titulo}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
            {descricao}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close
              render={<Button variant="outline" disabled={carregando} />}
            >
              Cancelar
            </AlertDialog.Close>
            <Button
              variant="destructive"
              disabled={carregando}
              onClick={onConfirmar}
            >
              {carregando && <Loader2 className="mr-2 size-4 animate-spin" />}
              Remover
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
