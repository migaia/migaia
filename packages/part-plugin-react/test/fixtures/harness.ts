import {
  createPartHost,
  defineEffect,
  definePart,
  definePartPlugin,
  type IPartHost
} from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import { bindReactComponent, reactPlugin } from '../../src/index.ts'
import { Button, Combobox, Item, List, NativeDialog, RadixDialog } from './components.tsx'

/** Values received by the recording effect. */
export const received: {
  readonly address: string
  readonly name: string
  readonly detail: unknown
}[] = []

/** Part definitions of the fixtures. */
export const parts = {
  page: definePart({ id: 'page@1' }),
  button: definePart({ id: 'button@1' }),
  combobox: definePart({ id: 'combobox@1', events: { valueChange: { kind: 'component' } } }),
  radix: definePart({
    id: 'radix-dialog@1',
    behavior: {
      managedBy: 'component',
      states: { names: ['open'], openState: 'open', openChange: 'openChange' }
    },
    events: { openChange: { kind: 'component' } }
  }),
  native: definePart({
    id: 'native-dialog@1',
    behavior: {
      layer: 'top',
      focus: { restore: true },
      states: { names: ['open'], openState: 'open' }
    }
  }),
  disclosure: definePart({
    id: 'disclosure@1',
    behavior: { states: { names: ['expanded'] }, aria: { expanded: { fromState: 'expanded' } } }
  }),
  list: definePart({ id: 'list@1' }),
  item: definePart({ id: 'item@1', styleHooks: { '--part-item-accent': 'color' } }),
  unbound: definePart({ id: 'unbound@1' })
}

/** Fixture plugin: parts, React bindings and effects. */
export const fixturePlugin = definePartPlugin({
  name: 'fixtures',
  parts: Object.values(parts),
  implementations: [
    bindReactComponent(parts.page, PageRoot),
    bindReactComponent(parts.button, Button),
    bindReactComponent(parts.combobox, Combobox, { events: { valueChange: 'onValueChange' } }),
    bindReactComponent(parts.radix, RadixDialog, {
      events: { openChange: 'onOpenChange' },
      element: 'query'
    }),
    bindReactComponent(parts.native, NativeDialog),
    bindReactComponent(parts.disclosure, Button),
    bindReactComponent(parts.list, List),
    bindReactComponent(parts.item, Item)
  ],
  effects: [
    defineEffect({ id: 'record@1', run: (event) => void received.push(event) }),
    defineEffect({
      id: 'open-native@1',
      run: (_event, context) => context.state.write('page.native', true)
    })
  ]
})

/** Page root component: a plain container for child parts. */
function PageRoot(props: {
  readonly children?: import('react').ReactNode
}): import('react').ReactNode {
  return props.children ?? null
}

/** Creates a host with DOM, React and fixture plugins, loads a blueprint and mounts it. */
export async function mountBlueprint(
  root: unknown,
  errors: unknown[] = []
): Promise<{ readonly host: IPartHost; readonly container: HTMLElement }> {
  /** Host with every plugin. */
  const host = await createPartHost({
    plugins: [domPlugin, reactPlugin, fixturePlugin],
    onError: (error) => errors.push(error)
  })
  /** Load result. */
  const loaded = await host.blueprint.load({ id: 'bp', version: 1, root })
  if (loaded.tree === undefined) throw new Error(JSON.stringify(loaded.issues))
  /** Mount container. */
  const container = document.createElement('div')
  document.body.append(container)
  host.mount(container, 'bp')
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { host, container }
}
