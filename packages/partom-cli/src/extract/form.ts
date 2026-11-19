/**
 * Substitute parts for a shadcn `form.tsx`. Its components read react-hook-form context and cannot
 * render outside `<Form>`, so extraction writes five context-free components instead. They pass ids
 * through their own React context, like the original, and reuse the original class text.
 */

/** Components the substitute module provides, with their part ids. Five fixed entries. */
export const FORM_SUBSTITUTES = {
  FormItem: 'form-item@1',
  FormLabel: 'form-label@1',
  FormControl: 'form-control@1',
  FormDescription: 'form-description@1',
  FormMessage: 'form-message@1'
} as const

/** Name of one substitute component. */
export type IFormSubstitute = keyof typeof FORM_SUBSTITUTES

/** True for a file importing react-hook-form's `Controller` or `useFormContext`. */
export function isFormFile(source: string, imports: ReadonlySet<string>): boolean {
  return imports.has('react-hook-form') && /\b(Controller|useFormContext)\b/.test(source)
}

/** First string literal passed to `cn(` in a component's source, or the empty string. */
export function classOf(source: string | undefined): string {
  /** Match of the first `cn("…"` argument. */
  const match = source === undefined ? null : /\bcn\(\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(source)
  return match?.[2] ?? ''
}

/** Text of the substitute module; class texts are written as JSON literals. */
export function formModule(classes: Readonly<Record<IFormSubstitute, string>>): string {
  return `import { definePart, definePartPlugin } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { createContext, useContext, useId, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'

/** Class texts copied from the original form.tsx. */
const CLASSES = ${JSON.stringify(classes)}

/** Ids shared by one form item: the control, its description and its message. */
type IItemIds = { readonly control: string; readonly description: string; readonly message: string }

/** Context carrying the ids of the enclosing form item. */
const ItemContext = createContext<IItemIds | undefined>(undefined)

/** Common props of the substitutes. */
type IProps = { readonly children?: ReactNode; readonly ref?: Ref<HTMLElement> }

/** Form item: a div that owns the ids of its control, description and message. */
export function FormItem(props: IProps): ReactNode {
  /** Base id of the item. */
  const id = useId()
  return (
    <ItemContext.Provider value={{ control: \`\${id}-control\`, description: \`\${id}-description\`, message: \`\${id}-message\` }}>
      <div className={CLASSES.FormItem} ref={props.ref as Ref<HTMLDivElement>}>{props.children}</div>
    </ItemContext.Provider>
  )
}

/** Label pointing at the item's control. */
export function FormLabel(props: IProps & { readonly text?: string }): ReactNode {
  /** Ids of the item. */
  const ids = useContext(ItemContext)
  return (
    <label className={CLASSES.FormLabel} htmlFor={ids?.control} ref={props.ref as Ref<HTMLLabelElement>}>
      {props.text}
      {props.children}
    </label>
  )
}

/** Attributes the control wrapper writes; three fixed names. */
const LINKED = ['id', 'aria-describedby', 'aria-invalid'] as const

/** Puts back the attribute values a control had before \`linkControl\` wrote its own. */
function restoreControl(control: HTMLElement, previous: readonly (string | null)[]): void {
  LINKED.forEach((name, index) => {
    /** Value before the link. */
    const value = previous[index] ?? null
    if (value === null) control.removeAttribute(name)
    else control.setAttribute(name, value)
  })
}

/**
 * Writes the item ids onto the first focusable element below a wrapper; returns the undo, which
 * restores the attributes the control had before.
 */
function linkControl(wrapper: HTMLElement | null, ids: IItemIds | undefined, invalid: boolean): () => void {
  /** First focusable descendant. */
  const control = wrapper?.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]')
  if (control === null || control === undefined || ids === undefined) return () => undefined
  /** Values before this link. */
  const previous = LINKED.map((name) => control.getAttribute(name))
  control.id = ids.control
  control.setAttribute('aria-describedby', \`\${ids.description} \${ids.message}\`)
  if (invalid) control.setAttribute('aria-invalid', 'true')
  else control.removeAttribute('aria-invalid')
  return () => restoreControl(control, previous)
}

/** Control wrapper: gives the first focusable descendant the item's ids after commit. */
export function FormControl(props: IProps & { readonly invalid?: boolean }): ReactNode {
  /** Ids of the item. */
  const ids = useContext(ItemContext)
  /** Wrapper element. */
  const wrapper = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => linkControl(wrapper.current, ids, props.invalid === true))
  return <div ref={wrapper} style={{ display: 'contents' }}>{props.children}</div>
}

/** Description text of the item. */
export function FormDescription(props: IProps): ReactNode {
  /** Ids of the item. */
  const ids = useContext(ItemContext)
  return <p id={ids?.description} className={CLASSES.FormDescription}>{props.children}</p>
}

/** Validation message of the item; renders nothing without a message. */
export function FormMessage(props: IProps & { readonly message?: string }): ReactNode {
  /** Ids of the item. */
  const ids = useContext(ItemContext)
  if (props.message === undefined || props.message === '') return null
  return <p id={ids?.message} className={CLASSES.FormMessage}>{props.message}</p>
}

/** Part definitions of the substitutes. */
export const formItemPart = definePart({ id: 'form-item@1' })
/** Label part. */
export const formLabelPart = definePart({ id: 'form-label@1' })
/** Control wrapper part. */
export const formControlPart = definePart({ id: 'form-control@1' })
/** Description part. */
export const formDescriptionPart = definePart({ id: 'form-description@1' })
/** Message part. */
export const formMessagePart = definePart({ id: 'form-message@1' })

/** Plugin registering the substitutes and their React bindings. */
export default definePartPlugin({
  name: 'form-substitutes',
  parts: [formItemPart, formLabelPart, formControlPart, formDescriptionPart, formMessagePart],
  implementations: [
    bindReactComponent(formItemPart, FormItem),
    bindReactComponent(formLabelPart, FormLabel),
    bindReactComponent(formControlPart, FormControl),
    bindReactComponent(formDescriptionPart, FormDescription),
    bindReactComponent(formMessagePart, FormMessage)
  ]
})
`
}
