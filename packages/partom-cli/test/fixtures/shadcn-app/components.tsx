import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'

/** Radix-based dialog that owns its trigger, focus trap and focus restore. */
export function Dialog(props: {
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly title?: string
}): ReactNode {
  return (
    <DialogPrimitive.Root open={props.open === true} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Trigger>Open dialog</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined}>
          <DialogPrimitive.Title>{props.title}</DialogPrimitive.Title>
          <DialogPrimitive.Close>Close</DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Tab names of the fixture tabs. */
const TABS = ['account', 'billing', 'team'] as const

/** APG tabs with automatic activation, roving tab index, Home and End. */
export function Tabs(props: {
  readonly ref?: Ref<HTMLDivElement>
  readonly label?: string
}): ReactNode {
  /** Selected tab index. */
  const [selected, setSelected] = useState(0)
  /** Moves selection and focus for arrow, Home and End keys. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    /** Offsets per key. */
    const next =
      event.key === 'ArrowRight'
        ? (selected + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (selected + TABS.length - 1) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : selected
    if (next === selected) return
    event.preventDefault()
    setSelected(next)
    ;(
      event.currentTarget.querySelectorAll('[role="tab"]')[next] as HTMLElement | undefined
    )?.focus()
  }
  return (
    <div ref={props.ref}>
      <div role="tablist" aria-label={props.label ?? 'Settings'} onKeyDown={onKeyDown}>
        {TABS.map((name, index) => (
          <button
            key={name}
            id={`tab-${name}`}
            role="tab"
            aria-selected={index === selected}
            aria-controls={`panel-${name}`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => setSelected(index)}
          >
            {name}
          </button>
        ))}
      </div>
      {TABS.map((name, index) => (
        <div
          key={name}
          id={`panel-${name}`}
          role="tabpanel"
          aria-labelledby={`tab-${name}`}
          hidden={index !== selected}
        >
          {name}
        </div>
      ))}
    </div>
  )
}
