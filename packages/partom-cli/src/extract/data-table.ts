/**
 * The `data-table@1` part generated for a shadcn `data-table.tsx`: a resource-bound table whose
 * rows are blueprint template instances, rendered with the project's own extracted table parts.
 */

/** Part id of the generated DataTable. */
export const DATA_TABLE_PART = 'data-table@1'

/** True for a file using TanStack's `useReactTable`. */
export function isDataTableFile(source: string, imports: ReadonlySet<string>): boolean {
  return imports.has('@tanstack/react-table') && /\buseReactTable\b/.test(source)
}

/**
 * Text of the DataTable module. `tableImport` is the specifier of the project's shadcn `table.tsx`
 * relative to the module (written as a JSON literal).
 */
export function dataTableModule(tableImport: string): string {
  return `import { definePart, definePartPlugin } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import type { ReactNode, Ref } from 'react'
import { Table, TableBody, TableHead, TableHeader, TableRow } from ${JSON.stringify(tableImport)}

/** One column of the table: the row field and its header text. */
export type IDataTableColumn = { readonly key: string; readonly header: string }

/** Props of the table view; \`children\` are the template row instances. */
export type IDataTableProps = {
  readonly columns?: readonly IDataTableColumn[]
  readonly header?: ReactNode
  readonly children?: ReactNode
  readonly ref?: Ref<HTMLTableElement>
}

/** Header row built from the columns. */
function headerRow(columns: readonly IDataTableColumn[]): ReactNode {
  return (
    <TableRow>
      {columns.map((column) => (
        <TableHead key={column.key}>{column.header}</TableHead>
      ))}
    </TableRow>
  )
}

/** Whether a slot value has content; an empty slot arrives as an empty array. */
function hasContent(value: ReactNode): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)
}

/** Table view: the header slot or the column headers, then the row instances in the body. */
export function DataTableView(props: IDataTableProps): ReactNode {
  return (
    <Table ref={props.ref}>
      <TableHeader>{hasContent(props.header) ? props.header : headerRow(props.columns ?? [])}</TableHeader>
      <TableBody>{props.children}</TableBody>
    </Table>
  )
}

/** Resource-bound DataTable part with loading, empty, error and header slots. */
export const dataTablePart = definePart({
  id: ${JSON.stringify(DATA_TABLE_PART)},
  slots: { loading: {}, empty: {}, error: {}, header: {} },
  behavior: {
    resource: { prop: 'source', slots: { loading: 'loading', empty: 'empty', error: 'error' } }
  }
})

/** Plugin registering the DataTable part and its binding. */
export default definePartPlugin({
  name: 'data-table',
  parts: [dataTablePart],
  implementations: [bindReactComponent(dataTablePart, DataTableView, { slots: { header: 'header' } })]
})
`
}
