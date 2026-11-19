import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { SelectValue } from '../../components/ui/select.tsx'

export const selectValuePart = definePart({
  id: 'select-value@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const selectValueBinding = bindReactComponent(selectValuePart, SelectValue, {})
