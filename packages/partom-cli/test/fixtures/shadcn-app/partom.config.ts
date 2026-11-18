import { definePart, definePartPlugin } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { Combobox, Page, parts } from '../shared/parts.tsx'
import { Dialog, Tabs } from './components.tsx'

/** Dialog part: managed by the Radix component, opened and closed through its own trigger. */
const dialogPart = definePart({
  id: 'dialog@1',
  behavior: {
    layer: 'top',
    managedBy: 'component',
    states: { names: ['open'], openState: 'open', openChange: 'openChange' }
  },
  events: { openChange: { kind: 'component' } }
})

/** Tabs part claiming the APG tabs pattern on its wrapper element. */
const tabsPart = definePart({ id: 'tabs@1', behavior: { semantics: { pattern: 'tabs' } } })

/** Integration project: combobox, dialog and tabs. */
export default {
  plugins: [
    definePartPlugin({
      name: 'app',
      parts: [parts.page, parts.combobox, dialogPart, tabsPart],
      implementations: [
        bindReactComponent(parts.page, Page),
        bindReactComponent(parts.combobox, Combobox),
        bindReactComponent(dialogPart, Dialog, {
          events: { openChange: 'onOpenChange' },
          element: 'query'
        }),
        bindReactComponent(tabsPart, Tabs)
      ]
    })
  ],
  blueprints: ['*.blueprint.json']
}
