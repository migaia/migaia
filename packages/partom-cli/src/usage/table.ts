/**
 * DataTable usage: the page's column array becomes the node's `props.columns` and a row template of
 * `table-row@1` with one `table-cell@1` per column showing the row field. Rows come from the
 * resource the node is bound to later; `data` is never converted.
 */
import type { IPartNode } from '@migaia/part-contract'
import { kebab } from '../import/names.ts'
import { propertyKey, unwrap, type INode } from './ast.ts'
import type { PageScope } from './scope.ts'
import { UsageReason } from './text.ts'

/** Row part of the template, from the project's extracted shadcn table. */
export const TABLE_ROW_PART = 'table-row@1'
/** Cell part of the template. */
export const TABLE_CELL_PART = 'table-cell@1'
/** Row field used when the page does not say how rows are keyed. */
const DEFAULT_ROW_KEY = 'id'

/** One column read from the page. */
type IColumn = { readonly key: string; readonly header: string | undefined; readonly cell: boolean }

/** What the table conversion produced for one DataTable element. */
export type ITableUsage = {
  readonly columns: readonly { readonly key: string; readonly header: string }[]
  readonly template: { readonly rowKey: string; readonly node: IPartNode }
  readonly reasons: readonly string[]
}

/** String value of a property's literal, or undefined. */
function stringOf(node: unknown): string | undefined {
  /** Expression without wrappers. */
  const value = unwrap(node)
  return value?.type === 'Literal' && typeof value.value === 'string' ? value.value : undefined
}

/** One column object: `accessorKey`, a string `header` and whether it has a `cell` renderer. */
function readColumn(element: INode): IColumn | undefined {
  /** Fields of the column. */
  let key: string | undefined
  /** Header text, when it is a string literal. */
  let header: string | undefined
  /** Whether the column renders cells itself. */
  let cell = false
  for (const property of element.properties as INode[]) {
    if (property.type !== 'Property') continue
    /** Property name. */
    const name = propertyKey(property)
    if (name === 'accessorKey') key = stringOf(property.value)
    if (name === 'header') header = stringOf(property.value)
    if (name === 'cell') cell = true
  }
  return key === undefined ? undefined : { key, header, cell }
}

/** Columns of the module-level array literal an attribute names, or undefined. */
function columnsOf(expression: INode | undefined, scope: PageScope): IColumn[] | undefined {
  if (expression?.type !== 'Identifier') return undefined
  /** Declaration of the named binding. */
  const declaration = scope.moduleNodes.get(String(expression.name))
  if (declaration?.type !== 'VariableDeclaration') return undefined
  /** Declarator of the name. */
  const declarator = (declaration.declarations as INode[]).find(
    (item) =>
      (item.id as INode).type === 'Identifier' && (item.id as INode).name === expression.name
  )
  /** Array literal initialiser. */
  const array = unwrap(declarator?.init)
  if (array?.type !== 'ArrayExpression') return undefined
  /** Columns read. */
  const columns: IColumn[] = []
  for (const element of array.elements as (INode | null)[]) {
    /** Column of the element. */
    const column = element?.type === 'ObjectExpression' ? readColumn(element) : undefined
    if (column !== undefined) columns.push(column)
  }
  return columns
}

/** Row field of `getRowId={(row) => row.<field>}`, or undefined. */
function rowKeyOf(expression: INode | undefined): string | undefined {
  if (expression?.type !== 'ArrowFunctionExpression') return undefined
  /** Returned expression. */
  const body = unwrap(expression.body)
  /** Row parameter. */
  const param = (expression.params as INode[])[0]
  if (body?.type !== 'MemberExpression' || body.computed === true || param?.type !== 'Identifier')
    return undefined
  /** Object of the member access. */
  const object = unwrap(body.object)
  return object?.type === 'Identifier' && object.name === param.name
    ? String((body.property as INode).name)
    : undefined
}

/**
 * Converts the attributes of a DataTable element. `attributes` maps attribute names to their
 * expressions; `data` only produces a bind-resource item.
 */
export function convertTable(
  attributes: ReadonlyMap<string, INode | undefined>,
  scope: PageScope
): ITableUsage {
  /** Reasons for the report. */
  const reasons: string[] = []
  /** Columns of the page, when readable. */
  const columns = columnsOf(attributes.get('columns'), scope)
  if (columns === undefined) reasons.push(UsageReason.columnsUnresolved)
  /** Cells of the row template, one per column. */
  const cells: IPartNode[] = []
  /** Columns with plain headers. */
  const plain: { key: string; header: string }[] = []
  for (const column of columns ?? []) {
    cells.push({
      tag: TABLE_CELL_PART,
      id: `cell-${kebab(column.key)}`,
      facets: { props: { children: { $row: column.key } } }
    })
    if (column.cell) reasons.push(UsageReason.cellDropped)
    else if (column.header !== undefined) plain.push({ key: column.key, header: column.header })
  }
  /** Row key from `getRowId`. */
  const declared = rowKeyOf(unwrap(attributes.get('getRowId')))
  if (declared === undefined) reasons.push(UsageReason.rowKeyGuessed)
  if (attributes.has('data')) reasons.push(UsageReason.bindResource)
  return {
    columns: plain,
    template: {
      rowKey: declared ?? DEFAULT_ROW_KEY,
      node: { tag: TABLE_ROW_PART, id: 'row', children: cells }
    },
    reasons
  }
}
