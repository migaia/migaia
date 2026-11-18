import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'

/** Shadcn-style button variants. */
const buttonVariants = cva('inline-flex items-center', {
  variants: {
    variant: {
      default: 'bg-primary',
      destructive: 'bg-destructive',
      outline: 'border',
      ghost: 'hover:bg-accent'
    },
    size: { default: 'h-9', sm: 'h-8', lg: 'h-10', icon: 'size-9' }
  },
  defaultVariants: { variant: 'default', size: 'default' }
})

/** Props of the button. */
type IButtonProps = VariantProps<typeof buttonVariants> & {
  readonly children?: ReactNode
  readonly onPress?: () => void
}

/** Shadcn-style button. */
export function Button({ variant, size, children }: IButtonProps): ReactNode {
  return <button className={buttonVariants({ variant, size })}>{children}</button>
}
