import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { Select } from '../../components/ui/select.tsx'

export const selectPart = definePart({
  id: 'select@1',
  behavior: {
    field: {
      value: 'value',
      change: 'valueChange',
      read: 'detail'
    }
  },
  events: {
    valueChange: {
      kind: 'component'
    }
  },
  editor: {
    variants: {},
    defaults: {}
  }
})
export const selectBinding = bindReactComponent(selectPart, Select, {
  events: { valueChange: 'onValueChange' }
})
