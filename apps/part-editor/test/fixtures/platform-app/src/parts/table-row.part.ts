import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { TableRow } from '../../components/ui/table.tsx'

export const tableRowPart = definePart({
  id: 'table-row@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const tableRowBinding = bindReactComponent(tableRowPart, TableRow, {})
