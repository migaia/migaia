import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { Checkbox } from '../../components/ui/checkbox.tsx'

export const checkboxPart = definePart({
  id: 'checkbox@1',
  behavior: {
    field: {
      value: 'checked',
      change: 'checkedChange',
      read: 'detail'
    }
  },
  events: {
    checkedChange: {
      kind: 'component'
    }
  },
  editor: {
    variants: {},
    defaults: {}
  }
})
export const checkboxBinding = bindReactComponent(checkboxPart, Checkbox, {
  events: { checkedChange: 'onCheckedChange' }
})
