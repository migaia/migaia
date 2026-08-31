import type { ComponentProps } from 'react'

/** Renders the project-owned shadcn input primitive while forwarding native input behavior. */
export function Input({ className = '', type = 'text', ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" type={type} className={`input ${className}`.trim()} {...props} />
}
