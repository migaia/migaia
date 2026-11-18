import * as Dialog from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode, Ref } from 'react'

/** Render counts per label, read by the render-isolation test. */
export const renderCounts = new Map<string, number>()

/** Shadcn-style button variants. */
const buttonVariants = cva('inline-flex', {
  variants: {
    variant: { default: 'bg-primary', destructive: 'bg-destructive' },
    size: { default: 'h-9', sm: 'h-8' }
  },
  defaultVariants: { variant: 'default', size: 'default' }
})

/** Shadcn-style button that counts its renders by label. */
export function Button(
  props: VariantProps<typeof buttonVariants> & {
    readonly label?: string
    readonly ref?: Ref<HTMLButtonElement>
    readonly children?: ReactNode
  }
): ReactNode {
  renderCounts.set(String(props.label), (renderCounts.get(String(props.label)) ?? 0) + 1)
  return (
    <button
      ref={props.ref}
      className={buttonVariants({ variant: props.variant, size: props.size })}
    >
      {props.label}
      {props.children}
    </button>
  )
}

/** Minimal combobox reporting value changes through a callback prop. */
export function Combobox(props: {
  readonly onValueChange?: (value: string) => void
  readonly ref?: Ref<HTMLInputElement>
}): ReactNode {
  return (
    <input
      ref={props.ref}
      role="combobox"
      aria-expanded="false"
      aria-label="Fruit"
      onChange={(event) => props.onValueChange?.(event.target.value)}
    />
  )
}

/** Radix dialog that owns its trigger, focus trap, Escape handling and focus restore. */
export function RadixDialog(props: {
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly title?: string
}): ReactNode {
  return (
    <Dialog.Root open={props.open === true} onOpenChange={props.onOpenChange}>
      <Dialog.Trigger>Open radix</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>{props.title}</Dialog.Title>
          <button>OK</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Native dialog element whose modality the host's DOM plugin manages. */
export function NativeDialog(props: {
  readonly ref?: Ref<HTMLDialogElement>
  readonly children?: ReactNode
}): ReactNode {
  return (
    <dialog ref={props.ref}>
      <h2>Native</h2>
      <button>Inside</button>
      {props.children}
    </dialog>
  )
}
