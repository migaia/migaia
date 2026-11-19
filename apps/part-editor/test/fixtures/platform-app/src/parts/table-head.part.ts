import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { TableHead } from '../../components/ui/table.tsx'

export const tableHeadPart = definePart({
  id: 'table-head@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const tableHeadBinding = bindReactComponent(tableHeadPart, TableHead, {})
