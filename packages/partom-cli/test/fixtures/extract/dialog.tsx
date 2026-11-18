import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

/** Shadcn-style dialog. */
export function Dialog(props: {
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly children?: ReactNode
}): ReactNode {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      {props.children}
    </DialogPrimitive.Root>
  )
}
