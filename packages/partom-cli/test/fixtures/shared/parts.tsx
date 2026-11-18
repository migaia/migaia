import { defineEffect, definePart, definePartPlugin } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { useId, useState, type ReactNode, type Ref } from 'react'

/** APG-conforming combobox: ArrowDown opens the listbox, Escape closes it, focus stays on the input. */
export function Combobox(props: {
  readonly ref?: Ref<HTMLInputElement>
  readonly broken?: boolean
}): ReactNode {
  /** Whether the popup is open. */
  const [open, setOpen] = useState(false)
  /** Id of the listbox. */
  const listId = useId()
  return (
    <div>
      <input
        ref={props.ref}
        role="combobox"
        aria-label="Fruit"
        aria-expanded={open}
        aria-controls={listId}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && props.broken !== true) setOpen(true)
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      <ul id={listId} role="listbox" aria-label="Fruits" hidden={!open} />
    </div>
  )
}

/** Overlay panel whose content disappears when closed; it does not restore focus itself. */
export function Overlay(props: {
  readonly ref?: Ref<HTMLDivElement>
  readonly open?: boolean
}): ReactNode {
  return <div ref={props.ref}>{props.open === true ? <button>Inside overlay</button> : null}</div>
}

/** Plain page container. */
export function Page(props: { readonly children?: ReactNode }): ReactNode {
  return <main>{props.children}</main>
}

/** Plain trigger button. */
export function Trigger(props: {
  readonly ref?: Ref<HTMLButtonElement>
  readonly label?: string
}): ReactNode {
  return <button ref={props.ref}>{props.label}</button>
}

/** Part definitions shared by every fixture project. */
export const parts = {
  page: definePart({ id: 'page@1' }),
  trigger: definePart({ id: 'trigger@1', behavior: { semantics: { element: 'button' } } }),
  combobox: definePart({
    id: 'combobox@1',
    behavior: { semantics: { element: 'input', pattern: 'combobox' } }
  }),
  brokenCombobox: definePart({
    id: 'broken-combobox@1',
    behavior: { semantics: { element: 'input', pattern: 'combobox' } }
  }),
  overlay: definePart({
    id: 'overlay@1',
    behavior: { layer: 'overlay', states: { names: ['open'], openState: 'open' } }
  }),
  restoringOverlay: definePart({
    id: 'restoring-overlay@1',
    behavior: {
      layer: 'overlay',
      focus: { restore: true },
      states: { names: ['open'], openState: 'open' }
    }
  })
}

/** Broken combobox: ArrowDown never opens the popup. */
export function BrokenCombobox(props: { readonly ref?: Ref<HTMLInputElement> }): ReactNode {
  return <Combobox ref={props.ref} broken />
}

/** Plugin with every fixture part and its React binding. */
export const fixturePlugin = definePartPlugin({
  name: 'fixtures',
  parts: Object.values(parts),
  implementations: [
    bindReactComponent(parts.page, Page),
    bindReactComponent(parts.trigger, Trigger),
    bindReactComponent(parts.combobox, Combobox),
    bindReactComponent(parts.brokenCombobox, BrokenCombobox),
    bindReactComponent(parts.overlay, Overlay),
    bindReactComponent(parts.restoringOverlay, Overlay)
  ],
  effects: [defineEffect({ id: 'noop@1', run: () => undefined })]
})
