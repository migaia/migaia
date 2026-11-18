import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import type { ReactNode } from 'react'

/** Shadcn-style combobox built from a popover and a command list. */
export function Combobox(props: {
  readonly value?: string
  readonly onValueChange?: (value: string) => void
}): ReactNode {
  return (
    <Popover.Root>
      <Popover.Trigger>{props.value}</Popover.Trigger>
      <Popover.Content>
        <Command />
      </Popover.Content>
    </Popover.Root>
  )
}
