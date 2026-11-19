import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { TableCell } from '../../components/ui/table.tsx'

export const tableCellPart = definePart({
  id: 'table-cell@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const tableCellBinding = bindReactComponent(tableCellPart, TableCell, {})
