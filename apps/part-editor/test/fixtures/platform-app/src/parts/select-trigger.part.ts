import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { SelectTrigger } from '../../components/ui/select.tsx'

export const selectTriggerPart = definePart({
  id: 'select-trigger@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const selectTriggerBinding = bindReactComponent(selectTriggerPart, SelectTrigger, {})
