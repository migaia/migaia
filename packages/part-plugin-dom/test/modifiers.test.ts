import { afterEach, describe, expect, it } from 'vitest'
import {
  defineEffect,
  defineModifier,
  definePart,
  definePartPlugin,
  type IModifierInstance
} from '@migaia/part-host'
import type { IEventSubscription } from '@migaia/part-contract'
import { createDomHarness, element, type IDomHarness } from './fixtures.ts'

/** Shared record of modifier calls, in order. */
const record: string[] = []

/** Recording step: appends its name, then continues; disposal is recorded too. */
class RecordStep implements IModifierInstance {
  /** Name written to the record. */
  readonly #name: string

  /** Captures the name. */
  constructor(name: string) {
    this.#name = name
  }

  /** Records the call and the element, then continues. */
  handle(_event: unknown, next: () => void, element: unknown): void {
    record.push(this.#name)
    elements.push(element)
    next()
  }

  /** Records disposal. */
  dispose(): void {
    record.push(`dispose:${this.#name}`)
  }
}

/** Elements the recording steps received. */
const elements: unknown[] = []

/** Step that continues twice after a macrotask. */
class LateStep implements IModifierInstance {
  /** Continues twice later. */
  handle(_event: unknown, next: () => void): void {
    setTimeout(() => {
      next()
      next()
    }, 5)
  }
}

/** Step that throws. */
class ThrowStep implements IModifierInstance {
  /** Always throws. */
  handle(): void {
    throw new Error('step failed')
  }
}

/** Test modifiers. */
const testModifiers = [
  defineModifier({
    id: 'log@1',
    eventKinds: ['dom'],
    placement: false,
    create: () => new RecordStep('log')
  }),
  defineModifier({
    id: 'mark@1',
    eventKinds: ['dom'],
    placement: false,
    create: () => new RecordStep('mark')
  }),
  defineModifier({
    id: 'late@1',
    eventKinds: ['dom'],
    placement: false,
    create: () => new LateStep()
  }),
  defineModifier({
    id: 'boom@1',
    eventKinds: ['dom'],
    placement: false,
    create: () => new ThrowStep()
  })
]

/** Effect runs: key and detail. */
const runs: { readonly name: string; readonly detail: unknown; readonly address: string }[] = []

/** Subscription keys the blueprint declares, so host dispatch finds them. */
const KEYS = [
  'click',
  'pointerdown',
  'keydown',
  'click.native',
  'click.once.stop',
  'keydown.enter',
  'keydown.enter.once',
  'keydown.ctrl.exact',
  'click.debounce',
  'pointerdown.longpress',
  'pointerdown.swipe',
  'pointerdown.drag'
]

/** Harness with the DOM plugin, the test modifiers, an effect and a loaded blueprint. */
async function harness(errors: unknown[]): Promise<IDomHarness> {
  /** Events record with every key. */
  const events: Record<string, IEventSubscription> = {}
  for (const key of KEYS) events[key] = { handler: 'run@1' }
  /** Created harness. */
  const created = await createDomHarness({
    plugins: [
      definePartPlugin({
        name: 'test',
        parts: [
          definePart({ id: 'box@1', events: { click: { kind: 'component' } } }),
          definePart({ id: 'row@1' })
        ],
        modifiers: testModifiers as never,
        effects: [
          defineEffect({
            id: 'run@1',
            run: (event) =>
              void runs.push({ name: event.key, detail: event.detail, address: event.address })
          })
        ]
      })
    ],
    onError: (error) => errors.push(error)
  })
  await created.host.blueprint.load({
    id: 'bp',
    version: 1,
    root: {
      tag: 'box@1',
      id: 'b',
      facets: { events },
      template: {
        rowKey: 'id',
        node: { tag: 'row@1', id: 'row', facets: { events: { click: { handler: 'run@1' } } } }
      }
    }
  })
  return created
}

/** Waits for queued dispatches and timers. */
function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

afterEach(() => {
  record.length = 0
  elements.length = 0
  runs.length = 0
  document.body.replaceChildren()
})

describe('modifier chain', () => {
  it('runs in array order, disposes in reverse and stops after removal', async () => {
    const errors: unknown[] = []
    const { host, dom } = await harness(errors)
    const button = element<HTMLButtonElement>('button', document.body)
    const remove = dom.events.subscribe('b', button, 'click', {
      handler: 'run@1',
      modifiers: ['mark@1', 'log@1', 'prevent@1']
    })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.dispatchEvent(click)
    await settle()
    expect(record).toEqual(['mark', 'log'])
    expect(click.defaultPrevented).toBe(true)
    expect(runs).toHaveLength(1)
    remove()
    expect(record).toEqual(['mark', 'log', 'dispose:log', 'dispose:mark'])
    button.dispatchEvent(new MouseEvent('click'))
    await settle()
    expect(runs).toHaveLength(1)
    expect(errors).toEqual([])
    await host.dispose()
  })

  it('distinguishes array order from a fixed order', async () => {
    const { host, dom } = await harness([])
    const parent = element<HTMLDivElement>('div', document.body)
    const child = element<HTMLSpanElement>('span', parent)
    const selfFirst = dom.events.subscribe('b', parent, 'click', {
      handler: 'run@1',
      modifiers: ['self@1', 'prevent@1']
    })
    const first = new MouseEvent('click', { bubbles: true, cancelable: true })
    child.dispatchEvent(first)
    selfFirst()
    dom.events.subscribe('b', parent, 'click', {
      handler: 'run@1',
      modifiers: ['prevent@1', 'self@1']
    })
    const second = new MouseEvent('click', { bubbles: true, cancelable: true })
    child.dispatchEvent(second)
    await settle()
    expect(first.defaultPrevented).toBe(false)
    expect(second.defaultPrevented).toBe(true)
    expect(runs).toEqual([])
    await host.dispose()
  })

  it('lets a late next through once, and not after removal', async () => {
    const { host, dom } = await harness([])
    const button = element<HTMLButtonElement>('button', document.body)
    const remove = dom.events.subscribe('b', button, 'click', {
      handler: 'run@1',
      modifiers: ['late@1']
    })
    button.dispatchEvent(new MouseEvent('click'))
    await settle(20)
    expect(runs).toHaveLength(1)
    button.dispatchEvent(new MouseEvent('click'))
    remove()
    await settle(20)
    expect(runs).toHaveLength(1)
    await host.dispose()
  })

  it('reports unavailable, failing and delegated placement modifiers', async () => {
    const errors: unknown[] = []
    const { host, dom } = await harness(errors)
    const button = element<HTMLButtonElement>('button', document.body)
    dom.events.subscribe('b', button, 'click', { handler: 'run@1', modifiers: ['ghost@1'] })
    expect(errors[0]).toMatchObject({
      code: 'MODIFIER_UNAVAILABLE',
      address: 'b',
      event: 'click',
      modifier: 'ghost@1'
    })
    dom.events.subscribe('b', button, 'click', { handler: 'run@1', modifiers: ['boom@1'] })
    button.dispatchEvent(new MouseEvent('click'))
    button.dispatchEvent(new MouseEvent('click'))
    await settle()
    expect(runs).toEqual([])
    expect(errors.slice(1)).toMatchObject([
      { code: 'MODIFIER_FAILED', modifier: 'boom@1', cause: { message: 'step failed' } },
      { code: 'MODIFIER_FAILED', modifier: 'boom@1' }
    ])
    dom.events.delegate('b/row', button, 'click', { handler: 'run@1', modifiers: ['outside@1'] })
    expect(errors.at(-1)).toMatchObject({
      code: 'MODIFIER_PLACEMENT_DELEGATED',
      modifier: 'outside@1'
    })
    await host.dispose()
  })

  it('gives a delegated chain the row instance element', async () => {
    const { host, dom } = await harness([])
    const list = element<HTMLUListElement>('ul', document.body)
    const rows = ['1', '2'].map((key) =>
      element<HTMLLIElement>('li', list, { 'data-part-address': `b/row@row:${key}` })
    )
    const inner = element<HTMLSpanElement>('span', rows[1] as HTMLElement)
    dom.events.delegate('b/row', list, 'click', { handler: 'run@1', modifiers: ['log@1'] })
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(elements).toEqual([rows[1]])
    expect(runs.map((run) => run.address)).toEqual(['b/row@row:2'])
    await host.dispose()
  })
})

describe('once and delegated rows', () => {
  it('keeps a once subscription until an event passes the chain, then disposes it', async () => {
    const { host, dom } = await harness([])
    const box = element<HTMLDivElement>('div', document.body)
    dom.events.subscribe('b', box, 'keydown.enter.once', { handler: 'run@1' })
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    const button = element<HTMLButtonElement>('button', document.body)
    dom.events.subscribe('b', button, 'click', {
      handler: 'run@1',
      modifiers: ['log@1'],
      once: true
    })
    button.dispatchEvent(new MouseEvent('click'))
    button.dispatchEvent(new MouseEvent('click'))
    await settle()
    expect(runs.map((run) => run.name)).toEqual(['keydown.enter.once', 'click'])
    expect(record).toEqual(['log', 'dispose:log'])
    await host.dispose()
  })

  it('gives each row its own stateful modifier instance', async () => {
    const { host, dom } = await harness([])
    const list = element<HTMLUListElement>('ul', document.body)
    const rows = ['1', '2'].map((key) =>
      element<HTMLLIElement>('li', list, { 'data-part-address': `b/row@row:${key}` })
    )
    dom.events.delegate('b/row', list, 'click', {
      handler: 'run@1',
      modifiers: [{ id: 'debounce@1', args: { ms: 10 } }]
    })
    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(30)
    expect(runs.map((run) => run.address).sort()).toEqual(['b/row@row:1', 'b/row@row:2'])
    await host.dispose()
  })
})

describe('built-in modifiers and shorthand keys', () => {
  it('handles shorthand options, keys, system keys and native component events', async () => {
    const { host, dom } = await harness([])
    const box = element<HTMLDivElement>('div', document.body)
    const inner = element<HTMLButtonElement>('button', box)
    const declaration = { kind: 'component' } as const
    dom.events.subscribe('b', box, 'click', { handler: 'run@1' }, declaration)
    dom.events.subscribe('b', box, 'click.native', { handler: 'run@1' }, declaration)
    let bubbled = 0
    document.body.addEventListener('click', () => (bubbled += 1))
    dom.events.subscribe('b', inner, 'click.once.stop', { handler: 'run@1' })
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    dom.events.subscribe('b', box, 'keydown.enter', { handler: 'run@1' })
    dom.events.subscribe('b', box, 'keydown.ctrl.exact', { handler: 'run@1' })
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, shiftKey: true }))
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))
    await settle()
    expect(runs.map((run) => run.name)).toEqual([
      'click.once.stop',
      'click.native',
      'keydown.enter',
      'keydown.ctrl.exact'
    ])
    expect(bubbled).toBe(1)
    await host.dispose()
  })

  it('debounces and recognizes long press, swipe and drag', async () => {
    const { host, dom } = await harness([])
    const pad = element<HTMLDivElement>('div', document.body)
    dom.events.subscribe('b', pad, 'click', {
      handler: 'run@1',
      modifiers: [{ id: 'debounce@1', args: { ms: 10 } }]
    })
    pad.dispatchEvent(new MouseEvent('click'))
    pad.dispatchEvent(new MouseEvent('click'))
    await settle(30)
    expect(runs).toHaveLength(1)
    runs.length = 0

    const press = element<HTMLDivElement>('div', document.body)
    dom.events.subscribe('b', press, 'pointerdown', {
      handler: 'run@1',
      modifiers: [{ id: 'longpress@1', args: { ms: 10 } }]
    })
    press.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5 }))
    await settle(30)
    press.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5 }))
    document.dispatchEvent(new PointerEvent('pointerup'))
    await settle(30)
    expect(runs).toMatchObject([{ name: 'pointerdown', detail: { x: 5, y: 5, duration: 10 } }])
    runs.length = 0

    const swipe = element<HTMLDivElement>('div', document.body)
    dom.events.subscribe('b', swipe, 'pointerdown', {
      handler: 'run@1',
      modifiers: [{ id: 'swipe@1', args: { direction: 'left' } }]
    })
    swipe.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 0 }))
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 40, clientY: 5 }))
    swipe.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }))
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 60, clientY: 0 }))
    await settle()
    expect(runs).toMatchObject([{ detail: { direction: 'left', dx: -60, dy: 5 } }])
    runs.length = 0

    const handle = element<HTMLDivElement>('div', document.body)
    dom.events.subscribe('b', handle, 'pointerdown.drag', { handler: 'run@1' })
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 0 }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 0 }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 4 }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 25, clientY: 4 }))
    await settle()
    expect(runs.map((run) => (run.detail as { phase: string; dx: number }).phase)).toEqual([
      'start',
      'move',
      'end'
    ])
    expect(runs.at(-1)?.detail).toMatchObject({ phase: 'end', dx: 25 })
    await host.dispose()
  })
})
