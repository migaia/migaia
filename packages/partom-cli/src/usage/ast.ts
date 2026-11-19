/** Small ESTree helpers shared by the usage converter. */

/** Generic ESTree node view. */
export type INode = {
  readonly type: string
  readonly start: number
  readonly end: number
  readonly [key: string]: unknown
}

/** True for an ESTree node object. */
export function isNode(value: unknown): value is INode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

/** Removes parentheses and TypeScript-only wrappers around an expression. */
export function unwrap(node: unknown): INode | undefined {
  /** Current node. */
  let current = isNode(node) ? node : undefined
  while (
    current !== undefined &&
    (current.type === 'ParenthesizedExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression')
  )
    current = isNode(current.expression) ? current.expression : undefined
  return current
}

/** Children nodes of a node, in source order (array members flattened). */
export function childNodes(node: INode): INode[] {
  /** Collected children. */
  const children: INode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(value)) for (const item of value) if (isNode(item)) children.push(item)
    if (isNode(value)) children.push(value)
  }
  return children
}

/** Literal value of an expression built only from literals, arrays and plain objects. */
export function literalValue(node: unknown): { readonly ok: boolean; readonly value?: unknown } {
  /** Expression without wrappers. */
  const expression = unwrap(node)
  if (expression === undefined) return { ok: false }
  if (expression.type === 'Literal') return { ok: true, value: expression.value }
  if (expression.type === 'TemplateLiteral' && (expression.expressions as unknown[]).length === 0)
    return {
      ok: true,
      value:
        ((expression.quasis as INode[])[0]?.value as { cooked?: string } | undefined)?.cooked ?? ''
    }
  if (expression.type === 'ArrayExpression') return literalArray(expression)
  if (expression.type === 'ObjectExpression') return literalObject(expression)
  if (expression.type === 'UnaryExpression' && expression.operator === '-') {
    /** Operand value. */
    const operand = literalValue(expression.argument)
    return typeof operand.value === 'number' ? { ok: true, value: -operand.value } : { ok: false }
  }
  return { ok: false }
}

/** Literal value of an array of literals. */
function literalArray(expression: INode): { readonly ok: boolean; readonly value?: unknown } {
  /** Values. */
  const values: unknown[] = []
  for (const element of expression.elements as unknown[]) {
    /** Element value. */
    const item = literalValue(element)
    if (!item.ok) return { ok: false }
    values.push(item.value)
  }
  return { ok: true, value: values }
}

/** Literal value of an object with plain keys and literal values. */
function literalObject(expression: INode): { readonly ok: boolean; readonly value?: unknown } {
  /** Values by key. */
  const value: Record<string, unknown> = {}
  for (const property of expression.properties as INode[]) {
    if (property.type !== 'Property' || property.computed === true) return { ok: false }
    /** Key name. */
    const key = propertyKey(property)
    /** Property value. */
    const item = literalValue(property.value)
    if (key === undefined || !item.ok) return { ok: false }
    value[key] = item.value
  }
  return { ok: true, value }
}

/** Key of a property: identifier name or literal text. */
export function propertyKey(property: INode): string | undefined {
  /** Key node. */
  const key = property.key as INode | undefined
  if (key?.type === 'Identifier') return String(key.name)
  if (key?.type === 'Literal') return String(key.value)
  return undefined
}

/** Line starts of a source text, built once; each lookup is one binary search. */
export class LineIndex {
  /** Offsets where lines start, ascending. */
  readonly #starts: number[] = [0]

  /** Indexes the line starts of a source. */
  constructor(source: string) {
    for (let index = 0; index < source.length; index += 1)
      if (source.charCodeAt(index) === 10) this.#starts.push(index + 1)
  }

  /** One-based line of an offset. */
  lineOf(offset: number): number {
    /** Search bounds over line starts. */
    let low = 0
    /** Upper bound. */
    let high = this.#starts.length - 1
    while (low < high) {
      /** Midpoint, rounded up so the loop always shrinks. */
      const middle = (low + high + 1) >> 1
      if ((this.#starts[middle] as number) <= offset) low = middle
      else high = middle - 1
    }
    return low + 1
  }
}
