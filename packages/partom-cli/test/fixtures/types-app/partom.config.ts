import { definePart, definePartPlugin, defineResource } from '@migaia/part-host'
import { z } from 'zod'

/** Orders resource with typed parameters, result and a create command. */
const orders = defineResource({
  id: 'orders@1',
  params: z.object({ status: z.enum(['open', 'closed']) }),
  result: z.array(z.object({ id: z.string() })),
  load: async () => [],
  commands: {
    create: { args: z.object({ customer: z.string() }), run: async () => undefined }
  }
})

/** Text field whose value prop is a string. */
const field = definePart({
  id: 'field@1',
  props: z.object({ value: z.string().optional() }),
  events: { valueChange: { kind: 'component' } },
  behavior: { field: { value: 'value', change: 'valueChange' } }
})

/** Dialog with an open state and a custom event carrying an id. */
const dialog = definePart({
  id: 'dialog@1',
  events: {
    'app:pick': {
      kind: 'custom',
      detail: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    }
  },
  behavior: { states: { names: ['open'], openState: 'open' } }
})

/** Container and table row parts. */
const box = definePart({ id: 'box@1' })
/** Table cell part. */
const cell = definePart({ id: 'cell@1' })

/** Types fixture project. */
export default {
  plugins: [
    definePartPlugin({ name: 'app', parts: [field, dialog, box, cell], resources: [orders] })
  ],
  blueprints: ['*.blueprint.json']
}
