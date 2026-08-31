import type { ComponentProps } from 'react'

type ISeparatorProps = ComponentProps<'div'> & {
  readonly decorative?: boolean
}

/** Separates neighboring content groups without adding another visual heading. */
export function Separator({
  className = '',
  decorative = true,
  ...props
}: ISeparatorProps) {
  return (
    <div
      aria-hidden={decorative || undefined}
      className={`separator ${className}`.trim()}
      data-orientation="horizontal"
      data-slot="separator"
      role={decorative ? 'none' : 'separator'}
      {...props}
    />
  )
}
