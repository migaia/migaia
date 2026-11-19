import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { Input } from '../../components/ui/input.tsx'

export const inputPart = definePart({
  id: 'input@1',
  behavior: {
    field: {
      value: 'value',
      change: 'change',
      read: 'target-value'
    }
  },
  events: {
    change: {
      kind: 'component'
    }
  },
  editor: {
    variants: {},
    defaults: {}
  }
})
export const inputBinding = bindReactComponent(inputPart, Input, { events: { change: 'onChange' } })
