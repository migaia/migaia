import {
  createPartHost,
  defineEffect,
  definePart,
  definePartPlugin,
  defineResource,
  type IPartHost
} from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { bindReactComponent, reactPlugin } from '../src/index.ts'

/** Waits for React commits, microtasks and scheduled reactive effects. */
async function settle(host: IPartHost): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    host.state.runtime.flush()
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

/** One controllable load call. */
type ICall = {
  readonly params: unknown
  readonly signal: { readonly aborted: boolean }
  resolve(value: unknown): void
  reject(error: unknown): void
}

/** Records load calls so the test can settle them. */
class Loads {
  /** Calls in order. */
  readonly calls: ICall[] = []

  /** Load function of the resource. */
  readonly load = (params: unknown, context: { readonly signal: { readonly aborted: boolean } }) =>
    new Promise((resolve, reject) => {
      this.calls.push({ params, signal: context.signal, resolve, reject })
    })

  /** Latest call. */
  last(): ICall {
    return this.calls[this.calls.length - 1] as ICall
  }
}

/** Table component: renders the count of items and its children (the rows). */
function Table(props: {
  readonly source?: { readonly data?: readonly unknown[] }
  readonly children?: ReactNode
  readonly ref?: (element: HTMLElement | null) => void
}): ReactNode {
  return (
    <div data-table="" ref={props.ref}>
      <span data-count="">{props.source?.data?.length ?? 0}</span>
      {props.children}
    </div>
  )
}

/** Box component rendering its children. */
function Box(props: { readonly children?: ReactNode }): ReactNode {
  return <div data-box="">{props.children}</div>
}

/** Cell component forwarding its ref so the renderer marks its address. */
function Cell(props: { readonly ref?: (element: HTMLElement | null) => void }): ReactNode {
  return <span data-cell="" ref={props.ref} />
}

/** Text component used inside status slots. */
function Text(props: { readonly text?: string }): ReactNode {
  return <p data-text={props.text}>{props.text}</p>
}

/** Controlled input that reports its new string through `onValueChange`. */
function ValueInput(props: {
  readonly value?: string
  readonly onValueChange?: (value: string) => void
}): ReactNode {
  return (
    <input
      data-input="component"
      value={props.value ?? ''}
      onChange={(event) => props.onValueChange?.(event.target.value)}
    />
  )
}

/** Uncontrolled native input whose `input` DOM event carries the value. */
function NativeInput(props: { readonly ref?: (element: HTMLElement | null) => void }): ReactNode {
  return <input data-input="native" ref={props.ref} />
}

/** Table part with a resource prop and three status slots. */
const tablePart = definePart({
  id: 'table@1',
  slots: { loading: {}, empty: {}, error: {} },
  behavior: {
    resource: { prop: 'source', slots: { loading: 'loading', empty: 'empty', error: 'error' } }
  }
})
/** Cell part. */
const cellPart = definePart({ id: 'cell@1' })
/** Text part. */
const textPart = definePart({ id: 'text@1' })
/** Box part. */
const boxPart = definePart({ id: 'box@1' })
/** Component-event field part. */
const inputPart = definePart({
  id: 'input@1',
  events: { valueChange: { kind: 'component' } },
  behavior: { field: { value: 'value', change: 'valueChange' } }
})
/** DOM-event field part. */
const nativePart = definePart({
  id: 'native-input@1',
  behavior: { field: { value: 'value', change: 'input', read: 'target-value' } }
})

/** Mounts a root node with the data parts; returns the host, its errors and the unmount. */
async function mount(
  root: unknown,
  resources: readonly ReturnType<typeof defineResource>[],
  effects: readonly ReturnType<typeof defineEffect>[] = []
): Promise<{ readonly host: IPartHost; readonly unmount: () => void }> {
  /** Host under test. */
  const host = await createPartHost({
    plugins: [
      domPlugin,
      reactPlugin,
      definePartPlugin({
        name: 'data',
        parts: [tablePart, cellPart, textPart, boxPart, inputPart, nativePart],
        resources,
        effects,
        implementations: [
          bindReactComponent(tablePart, Table),
          bindReactComponent(cellPart, Cell),
          bindReactComponent(textPart, Text),
          bindReactComponent(boxPart, Box),
          bindReactComponent(inputPart, ValueInput, { events: { valueChange: 'onValueChange' } }),
          bindReactComponent(nativePart, NativeInput)
        ]
      })
    ]
  })
  /** Load result. */
  const loaded = await host.blueprint.load({ id: 'bp', version: 1, root })
  expect(loaded.issues.filter((issue) => issue.severity === 'error')).toEqual([])
  /** Mount container. */
  const container = document.createElement('div')
  document.body.append(container)
  /** Mount handle. */
  const handle = host.mount(container, 'bp')
  return { host, unmount: () => handle.unmount() }
}

/** Text of a status slot, or null when absent. */
function slotText(name: string): string | null {
  return document.querySelector(`[data-text="${name}"]`)?.textContent ?? null
}

describe('resource nodes', () => {
  it('shows status slots, renders rows from data, keeps old rows while refreshing and releases', async () => {
    /** Load control. */
    const loads = new Loads()
    /** Resource under test. */
    const orders = defineResource({ id: 'orders@1', load: loads.load })
    /** Text node for a status slot. */
    const text = (value: string) => ({
      tag: 'text@1',
      id: value,
      facets: { props: { text: value } }
    })
    const { host, unmount } = await mount(
      {
        tag: 'table@1',
        id: 'table',
        facets: {
          props: {
            source: { $resource: 'orders@1', params: { status: { $state: 'page.filter' } } }
          },
          slots: { loading: [text('loading')], empty: [text('empty')], error: [text('error')] }
        },
        template: { rowKey: 'id', node: { tag: 'cell@1', id: 'cell' } }
      },
      [orders]
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(slotText('loading')).toBe('loading')
    /** Element carrying the status attributes. */
    const statusElement = () => document.querySelector('[data-resource-status]')
    expect(statusElement()?.getAttribute('aria-busy')).toBe('true')
    expect(statusElement()?.getAttribute('data-resource-status')).toBe('loading')
    expect(document.querySelector('[data-table]')).toBeNull()
    await settle(host)

    loads.last().resolve([{ id: 'a' }, { id: 'b' }])
    await settle(host)
    expect(document.querySelectorAll('[data-cell]')).toHaveLength(2)
    expect(
      [...document.querySelectorAll('[data-part-address]')]
        .map((element) => element.getAttribute('data-part-address'))
        .filter((address) => address?.includes('@row:'))
    ).toEqual(['table/cell@row:a', 'table/cell@row:b'])
    expect(statusElement()?.hasAttribute('aria-busy')).toBe(false)
    expect([slotText('loading'), slotText('empty'), slotText('error')]).toEqual([null, null, null])

    host.state.write('page.filter', 'closed')
    await settle(host)
    expect(document.querySelectorAll('[data-cell]')).toHaveLength(2)
    expect(statusElement()?.getAttribute('aria-busy')).toBe('true')
    loads.last().resolve([])
    await settle(host)
    expect(slotText('empty')).toBe('empty')

    host.state.write('page.filter', 'broken')
    await settle(host)
    loads.last().reject(new Error('down'))
    await settle(host)
    expect(slotText('error')).toBe('error')

    host.state.write('page.filter', 'slow')
    await settle(host)
    /** Load that never settles. */
    const pending = loads.last()
    unmount()
    await settle(host)
    expect(pending.signal.aborted).toBe(true)
    await host.dispose()
  })
})

describe('field write-back', () => {
  it('writes component and DOM field changes to bound state before the subscription runs', async () => {
    /** State values seen by the effect when it runs. */
    const seen: unknown[] = []
    /** Effect reading the field state. */
    const typed = defineEffect({
      id: 'typed@1',
      run: (_event, ctx) => void seen.push(ctx.state.read('page.form.a'))
    })
    const { host, unmount } = await mount(
      {
        tag: 'box@1',
        id: 'root',
        children: [
          {
            tag: 'input@1',
            id: 'a',
            facets: {
              props: { value: { $state: 'page.form.a' } },
              events: { valueChange: { handler: 'typed@1' } }
            }
          },
          {
            tag: 'native-input@1',
            id: 'b',
            facets: { props: { value: { $state: 'page.form.b' } } }
          },
          { tag: 'input@1', id: 'c', facets: { props: { value: 'fixed' } } }
        ]
      },
      [],
      [typed]
    )
    await settle(host)
    /** Inputs in document order. */
    const inputs = [...document.querySelectorAll('input')]
    await userEvent.type(inputs[0] as HTMLInputElement, 'xy')
    await userEvent.type(inputs[1] as HTMLInputElement, 'xy')
    await userEvent.type(inputs[2] as HTMLInputElement, 'z')
    await settle(host)
    expect(host.state.read('page.form.a')).toBe('xy')
    expect(host.state.read('page.form.b')).toBe('xy')
    expect(seen).toEqual(['x', 'xy'])
    unmount()
    await host.dispose()
  })
})
