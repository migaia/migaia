import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { Table } from '../../components/ui/table.tsx'

export const tablePart = definePart({
  id: 'table@1',
  editor: {
    variants: {},
    defaults: {}
  }
})
export const tableBinding = bindReactComponent(tablePart, Table, {})
