"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 0,
  orientation: "horizontal",
})

type ToggleGroupSharedProps = Omit<
  ToggleGroupPrimitive.Props<string>,
  "defaultValue" | "multiple" | "onValueChange" | "value"
> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }

type ToggleGroupSingleProps = ToggleGroupSharedProps & {
  type?: "single"
  value?: string | undefined
  defaultValue?: string | undefined
  onValueChange?: ((value: string) => void) | undefined
}

type ToggleGroupMultipleProps = ToggleGroupSharedProps & {
  type: "multiple"
  value?: readonly string[] | undefined
  defaultValue?: readonly string[] | undefined
  onValueChange?: ((value: string[]) => void) | undefined
}

type ToggleGroupProps = ToggleGroupSingleProps | ToggleGroupMultipleProps

function normalizeSingleValue(value: string | undefined) {
  if (value == null || value === "") {
    return undefined
  }

  return [value]
}

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  orientation = "horizontal",
  children,
  type = "single",
  value,
  defaultValue,
  onValueChange,
  ...props
}: ToggleGroupProps) {
  const multiple = type === "multiple"
  const groupValue =
    type === "multiple"
      ? (value as ToggleGroupMultipleProps["value"])
      : normalizeSingleValue(value as ToggleGroupSingleProps["value"])
  const groupDefaultValue =
    type === "multiple"
      ? (defaultValue as ToggleGroupMultipleProps["defaultValue"])
      : normalizeSingleValue(defaultValue as ToggleGroupSingleProps["defaultValue"])

  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      multiple={multiple}
      value={groupValue}
      defaultValue={groupDefaultValue}
      onValueChange={(nextValue) => {
        if (multiple) {
          ;(onValueChange as ToggleGroupMultipleProps["onValueChange"])?.(nextValue)
          return
        }

        ;(onValueChange as ToggleGroupSingleProps["onValueChange"])?.(nextValue[0] ?? "")
      }}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 first:data-[spacing=0]:group-data-horizontal/toggle-group:rounded-l-lg first:data-[spacing=0]:group-data-vertical/toggle-group:rounded-t-lg last:data-[spacing=0]:group-data-horizontal/toggle-group:rounded-r-lg last:data-[spacing=0]:group-data-vertical/toggle-group:rounded-b-lg data-[variant=outline]:data-[spacing=0]:group-data-horizontal/toggle-group:border-l-0 data-[variant=outline]:data-[spacing=0]:group-data-vertical/toggle-group:border-t-0 first:data-[variant=outline]:data-[spacing=0]:group-data-horizontal/toggle-group:border-l first:data-[variant=outline]:data-[spacing=0]:group-data-vertical/toggle-group:border-t",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
