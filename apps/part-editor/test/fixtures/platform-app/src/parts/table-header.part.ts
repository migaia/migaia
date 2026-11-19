import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { TableHeader } from '../../components/ui/table.tsx'

export const tableHeaderPart = definePart({
  id: 'table-header@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const tableHeaderBinding = bindReactComponent(tableHeaderPart, TableHeader, {})
