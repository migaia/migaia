import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { SelectItem } from '../../components/ui/select.tsx'

export const selectItemPart = definePart({
  id: 'select-item@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const selectItemBinding = bindReactComponent(selectItemPart, SelectItem, {})
