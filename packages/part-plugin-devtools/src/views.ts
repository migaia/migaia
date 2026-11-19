import type { IPartFacets, ITraceEvent, ITraceStep } from '@migaia/part-contract'
import { PanelText, VALUE_LIMIT } from './text.ts'

/** Trace Feature surface the panel reads. */
export type ITraceSurface = {
  steps(address: string): readonly ITraceStep[]
  events(key: string): readonly ITraceEvent[]
  addresses(): readonly string[]
  resolved(address: string): IPartFacets | undefined
  subscribe(listener: (key: string) => void): () => void
}

/** State Feature surface the panel reads. */
export type IStateSurface = { read(path: string): unknown }

/** Configuration groups compared between steps; fixed list of six. */
const GROUPS = ['attrs', 'props', 'aria', 'data', 'style', 'events'] as const

/** JSON text of a value; values JSON cannot encode (cycles, DOM events) show their type name. */
export function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined'
  } catch {
    return `[${Object.prototype.toString.call(value).slice(8, -1)}]`
  }
}

/** JSON of a value cut to VALUE_LIMIT characters. */
export function preview(value: unknown): string {
  /** Full JSON text. */
  const text = jsonText(value)
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT)}…` : text
}

/** Creates an element with text. */
function line(document: Document, tag: string, text: string): HTMLElement {
  /** New element. */
  const element = document.createElement(tag)
  element.textContent = text
  return element
}

/** Changed keys of one step: `group.key: old → new` for every key whose value changed. */
export function changedKeys(step: ITraceStep): string[] {
  /** Change lines. */
  const changes: string[] = []
  for (const group of GROUPS) {
    /** Input and output of the group. */
    const before = (step.input[group] ?? {}) as Readonly<Record<string, unknown>>
    const after = (step.output[group] ?? {}) as Readonly<Record<string, unknown>>
    /** Every key of either side. */
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of keys)
      if (preview(before[key]) !== preview(after[key]))
        changes.push(`${group}.${key}: ${preview(before[key])} → ${preview(after[key])}`)
  }
  return changes
}

/** Enhancement steps of an address, each with its stage, enhancer and changed keys. */
export function stepsView(document: Document, trace: ITraceSurface, address: string): HTMLElement {
  /** List of steps. */
  const list = document.createElement('ol')
  for (const step of trace.steps(address)) {
    /** One step entry. */
    const item = line(
      document,
      'li',
      step.enhancer === undefined ? step.stage : `${step.stage} ${step.enhancer}`
    )
    for (const change of changedKeys(step)) item.append(line(document, 'div', change))
    list.append(item)
  }
  return list
}

/** Binding values (`$state` paths and `$derive` ids) found in the resolved configuration. */
export function bindingsOf(config: IPartFacets | undefined): {
  readonly states: string[]
  readonly derives: string[]
} {
  /** Collected bindings. */
  const found = { states: [] as string[], derives: [] as string[] }
  for (const group of GROUPS)
    for (const value of Object.values(
      (config?.[group] ?? {}) as Readonly<Record<string, unknown>>
    )) {
      if (typeof value !== 'object' || value === null) continue
      /** Binding fields. */
      const binding = value as { readonly $state?: unknown; readonly $derive?: unknown }
      if (typeof binding.$state === 'string') found.states.push(binding.$state)
      if (typeof binding.$derive === 'string') found.derives.push(binding.$derive)
    }
  return found
}

/** Current value of each bound state path; an unreadable path shows `undefined`. */
export function stateView(
  document: Document,
  state: IStateSurface,
  paths: readonly string[]
): HTMLElement {
  /** List of paths. */
  const list = document.createElement('ul')
  for (const path of paths) {
    /** Read value, or undefined when reading fails. */
    let value: unknown
    try {
      value = state.read(path)
    } catch {
      value = undefined
    }
    list.append(line(document, 'li', `${path} = ${preview(value)}`))
  }
  return list
}

/** Each bound derive with the reads of its latest recomputation. */
export function derivesView(
  document: Document,
  trace: ITraceSurface,
  ids: readonly string[]
): HTMLElement {
  /** List of derives. */
  const list = document.createElement('ul')
  for (const id of ids) {
    /** Latest recomputation. */
    const latest = trace.events(`$derive:${id}`).at(-1)
    /** Paths it read. */
    const reads = (
      (latest?.detail as { readonly reads?: readonly string[] } | undefined)?.reads ?? []
    ).join(', ')
    list.append(line(document, 'li', `${id} ← ${reads === '' ? PanelText.none : reads}`))
  }
  return list
}

/** Events of an address, newest first. */
export function eventsView(document: Document, trace: ITraceSurface, address: string): HTMLElement {
  /** List of events. */
  const list = document.createElement('ol')
  /** Events oldest first. */
  const events = trace.events(address)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    /** Event at the index. */
    const event = events[index] as ITraceEvent
    list.append(line(document, 'li', `${event.kind} ${event.name} ${preview(event.detail)}`))
  }
  return list
}
