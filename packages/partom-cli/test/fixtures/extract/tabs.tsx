import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'

/** Shadcn-style tabs root. */
export function Tabs(props: {
  readonly value?: string
  readonly onValueChange?: (value: string) => void
  readonly children?: ReactNode
}): ReactNode {
  return (
    <TabsPrimitive.Root value={props.value} onValueChange={props.onValueChange}>
      {props.children}
    </TabsPrimitive.Root>
  )
}
