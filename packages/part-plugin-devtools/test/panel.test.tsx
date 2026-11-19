import {
  createPartHost,
  defineDerive,
  defineEffect,
  defineEnhancer,
  definePart,
  definePartPlugin,
  type IPartHost
} from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import { bindReactComponent, reactPlugin } from '@migaia/part-plugin-react'
import type { ReactNode, Ref } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { devtoolsPlugin } from '../src/index.ts'
import { devtoolsPlugin as noopPlugin } from '../src/noop.ts'

/** Waits for commits and trace updates. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

/** Button that dispatches `press` on click. */
function Button(props: {
  readonly ref?: Ref<HTMLButtonElement>
  readonly label?: unknown
  readonly onPress?: () => void
}): ReactNode {
  return (
    <button ref={props.ref} type="button" onClick={props.onPress}>
      {String(props.label)}
    </button>
  )
}

/** Text showing a value. */
function Text(props: { readonly ref?: Ref<HTMLSpanElement>; readonly value?: unknown }): ReactNode {
  return <span ref={props.ref}>{String(props.value)}</span>
}

/** Parts, bindings, enhancer, derive and effect of the fixture. */
const button = definePart({ id: 'button@1', events: { press: { kind: 'component' } } })
const text = definePart({ id: 'text@1' })
const page = definePart({ id: 'page@1' })
const app = definePartPlugin({
  name: 'devtools-fixture',
  parts: [page, button, text],
  implementations: [
    bindReactComponent(page, (props: { readonly children?: ReactNode }) => (
      <div>{props.children}</div>
    )),
    bindReactComponent(button, Button, { events: { press: 'onPress' } }),
    bindReactComponent(text, Text)
  ],
  enhancers: [
    defineEnhancer({
      id: 'label@1',
      targets: ['button'],
      transform: (config) => ({ ...config, aria: { ...config.aria, label: 'Save order' } })
    })
  ],
  derives: [
    defineDerive({
      id: 'total@1',
      compute: (state) => Number(state.read('page.a')) + Number(state.read('page.b'))
    })
  ],
  effects: [defineEffect({ id: 'save@1', run: (_event, ctx) => ctx.state.write('page.count', 2) })]
})

/** Mounts the fixture page with the given devtools plugin. */
async function mount(plugin: typeof devtoolsPlugin): Promise<IPartHost> {
  /** Host with every plugin. */
  const host = await createPartHost({ plugins: [domPlugin, reactPlugin, app, plugin] })
  host.state.write('page.count', 1)
  host.state.write('page.a', 1)
  host.state.write('page.b', 2)
  await host.blueprint.load({
    id: 'bp',
    version: 1,
    root: {
      tag: 'page@1',
      id: 'p',
      children: [
        {
          tag: 'button@1',
          id: 'save',
          facets: { props: { label: 'Save' }, events: { press: { handler: 'save@1' } } }
        },
        { tag: 'text@1', id: 'count', facets: { props: { value: { $state: 'page.count' } } } },
        { tag: 'text@1', id: 'sum', facets: { props: { value: { $derive: 'total@1' } } } },
        { tag: 'text@1', id: 'sum2', facets: { props: { value: { $derive: 'total@1' } } } }
      ]
    }
  })
  /** Mount container. */
  const container = document.createElement('div')
  document.body.append(container)
  host.mount(container, 'bp')
  await settle()
  return host
}

/** Shadow root of the open panel. */
function panel(): ShadowRoot {
  return (document.querySelector('[data-part-devtools-panel]') as HTMLElement)
    .shadowRoot as ShadowRoot
}

/** Text of one panel section. */
function section(part: string): string {
  return panel().querySelector(`[data-part="${part}"]`)?.textContent ?? ''
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('devtools panel', () => {
  it('picks a node, shows its steps, events, state and shared derive reads', async () => {
    /** Host under test. */
    const host = await mount(devtoolsPlugin)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyD' })
    )
    await settle()
    expect(panel().querySelector('[data-part="tree"]')?.textContent).toContain('p/sum2')
    ;(panel().querySelector('[data-part="pick"]') as HTMLButtonElement).click()
    ;(document.querySelector('[data-part-address="p/save"]') as HTMLElement).click()
    await settle()
    expect(section('steps')).toContain('authored')
    expect(section('steps')).toContain('enhancer label@1')
    expect(section('steps')).toContain('aria.label: undefined → "Save order"')
    expect(section('steps')).toContain('resolved')
    ;(document.querySelector('[data-part-address="p/save"]') as HTMLElement).click()
    await settle()
    expect(section('events')).toContain('dispatch press')
    expect(section('events')).toContain('effect save@1')
    /** Selects an address through the panel's address list. */
    const fixtureSelect = (address: string): void =>
      void (panel().querySelector(`[data-address="${address}"]`) as HTMLButtonElement).click()
    fixtureSelect('p/count')
    await settle()
    expect(section('state')).toContain('page.count = 2')
    host.state.write('page.count', 5)
    await settle()
    fixtureSelect('p/count')
    expect(section('state')).toContain('page.count = 5')
    host.state.write('page.a', 3)
    await settle()
    fixtureSelect('p/sum')
    expect(section('derives')).toContain('total@1 ← page.a, page.b')
    fixtureSelect('p/sum2')
    expect(section('derives')).toContain('total@1 ← page.a, page.b')
    await host.unUse('part-devtools')
    expect(document.querySelector('[data-part-devtools-panel]')).toBeNull()
    await host.dispose()
  })

  it('production plugin adds no panel and ignores the shortcut', async () => {
    /** Host with the no-op plugin. */
    const host = await mount(noopPlugin)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyD' })
    )
    await settle()
    expect(document.querySelector('[data-part-devtools-panel]')).toBeNull()
    await host.dispose()
  })
})
