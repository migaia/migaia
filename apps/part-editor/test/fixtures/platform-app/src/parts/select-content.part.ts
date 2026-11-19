import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { SelectContent } from '../../components/ui/select.tsx'

export const selectContentPart = definePart({
  id: 'select-content@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const selectContentBinding = bindReactComponent(selectContentPart, SelectContent, {})
