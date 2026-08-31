import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'
import type { ComponentProps } from 'react'

/** Maps semantic button variants to the project-owned shadcn class contract. */
export const buttonVariants = cva('button', {
  variants: {
    variant: {
      primary: 'button-primary',
      secondary: 'button-secondary',
      quiet: 'button-quiet',
      icon: 'button-icon'
    }
  },
  defaultVariants: {
    variant: 'secondary'
  }
})

/** Props supported by the project-owned shadcn button primitive. */
type IButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

/** Renders a keyboard-accessible button or applies button behavior to a slotted child. */
export function Button({ asChild = false, className, variant, ...props }: IButtonProps) {
  /** Radix Slot preserves link semantics when a navigation action is styled as a button. */
  const Component = asChild ? Slot : 'button'
  return <Component className={clsx(buttonVariants({ variant }), className)} {...props} />
}
