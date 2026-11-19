import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { TableBody } from '../../components/ui/table.tsx'

export const tableBodyPart = definePart({
  id: 'table-body@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const tableBodyBinding = bindReactComponent(tableBodyPart, TableBody, {})
