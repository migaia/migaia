import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ComponentProps } from 'react'

/** Exposes the project-owned shadcn/Radix dialog state boundary. */
export const Dialog = DialogPrimitive.Root

/** Renders dialog content outside the document layout tree. */
export const DialogPortal = DialogPrimitive.Portal

/** Renders the modal glass backdrop and closes the dialog on pointer interaction. */
export function DialogOverlay({
  className = '',
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={`search-overlay ${className}`.trim()} {...props} />
}

/** Renders focus-trapped modal content above the glass backdrop. */
export function DialogContent({
  className = '',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Content className={`search-panel ${className}`.trim()} {...props} />
}

/** Supplies an accessible dialog title while preserving the page's visual hierarchy. */
export const DialogTitle = DialogPrimitive.Title

/** Supplies an accessible dialog description for screen-reader context. */
export const DialogDescription = DialogPrimitive.Description
