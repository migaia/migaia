import type { IDescriptor } from '@migaia/part-contract'

/** Control kinds of the property panel. */
export const Control = {
  text: 'text',
  number: 'number',
  checkbox: 'checkbox',
  select: 'select',
  group: 'group',
  list: 'list'
} as const

/** One control kind. */
export type Control = keyof typeof Control

/** One field of the property panel. */
export type IField = {
  readonly key: string
  readonly control: Control
  readonly options?: readonly string[]
  readonly fields?: readonly IField[]
}

/** JSON Schema subset the panel reads. */
type ISchema = {
  readonly type?: string | readonly string[]
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, ISchema>>
  readonly items?: ISchema
}

/** `editor` hints the panel reads: enum options per prop (`variants`) and field order (`order`). */
type IEditorHints = {
  readonly variants?: Readonly<Record<string, readonly string[]>>
  readonly order?: readonly string[]
}

/** Field of one schema property: enum → select, then by type. */
function schemaField(key: string, schema: ISchema): IField {
  if (Array.isArray(schema.enum))
    return { key, control: Control.select, options: schema.enum.map(String) }
  /** First declared type. */
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  if (type === 'number' || type === 'integer') return { key, control: Control.number }
  if (type === 'boolean') return { key, control: Control.checkbox }
  if (type === 'object')
    return {
      key,
      control: Control.group,
      fields: Object.entries(schema.properties ?? {}).map(([name, child]) =>
        schemaField(name, child)
      )
    }
  if (type === 'array') return { key, control: Control.list }
  return { key, control: Control.text }
}

/** Field of a prop present in the node but not described: by the value's type. */
function valueField(key: string, value: unknown): IField {
  if (typeof value === 'number') return { key, control: Control.number }
  if (typeof value === 'boolean') return { key, control: Control.checkbox }
  return { key, control: Control.text }
}

/**
 * Fields of a part's props panel: `editor` hints first (variants become selects, `order` sorts),
 * then the props JSON Schema (`args`), then props the node already has. Each key appears once.
 */
export function propFields(
  descriptor: IDescriptor | undefined,
  props: Readonly<Record<string, unknown>>
): IField[] {
  /** Fields by key, in first-seen order. */
  const fields = new Map<string, IField>()
  /** Editor hints. */
  const hints = (descriptor?.editor ?? {}) as IEditorHints
  for (const key of hints.order ?? []) fields.set(key, { key, control: Control.text })
  /** Props schema. */
  const schema = descriptor?.args as ISchema | undefined
  for (const [key, child] of Object.entries(schema?.properties ?? {}))
    fields.set(key, schemaField(key, child))
  for (const [key, options] of Object.entries(hints.variants ?? {}))
    fields.set(key, { key, control: Control.select, options })
  for (const [key, value] of Object.entries(props))
    if (!fields.has(key)) fields.set(key, valueField(key, value))
  return [...fields.values()]
}

/** DOM events every part may subscribe to, besides the events its descriptor declares. */
export const DOM_EVENTS = ['click', 'submit', 'change', 'input', 'focus', 'blur'] as const

/** Event names of a part: declared events first, then DOM events, each once. */
export function eventNames(descriptor: IDescriptor | undefined): string[] {
  return [...new Set([...Object.keys(descriptor?.events ?? {}), ...DOM_EVENTS])]
}

/** True for a `$state` binding. */
export function isStateBinding(value: unknown): value is { readonly $state: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $state?: unknown }).$state === 'string'
  )
}
