"use client"

import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

/**
 * Menu (dropdown) — reusa a MESMA primitiva de popup do projeto
 * (`@base-ui/react`, estilo `base-nova`) que `dialog.tsx`/`sheet.tsx`, e NÃO
 * Radix: um único motor de foco/portal/ESC/a11y. Estrutura de composição
 * (Root > Trigger + Portal > Positioner > Popup > Item) espelha a API do
 * Base UI Menu; o consumidor monta o trigger com `render={<Button .../>}`.
 */
function Menu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="menu" {...props} />
}

function MenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />
}

function MenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="menu-portal" {...props} />
}

function MenuPositioner({
  className,
  sideOffset = 6,
  align = "start",
  ...props
}: MenuPrimitive.Positioner.Props) {
  return (
    <MenuPrimitive.Positioner
      data-slot="menu-positioner"
      sideOffset={sideOffset}
      align={align}
      className={cn("z-50", className)}
      {...props}
    />
  )
}

function MenuPopup({ className, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Popup
      data-slot="menu-popup"
      className={cn(
        // Popup ancorado ao trigger; anima escala/opacidade via estados de
        // transição do Base UI (mesmos data-attrs do Dialog/Sheet).
        "min-w-[10rem] overflow-hidden rounded-xl border border-border bg-popover bg-clip-padding p-1 text-sm text-popover-foreground shadow-lg transition duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted data-highlighted:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Menu, MenuTrigger, MenuPortal, MenuPositioner, MenuPopup, MenuItem }
