import { parseSync, visitorKeys, type Node, type Program } from 'oxc-parser'

/** One parsed source file with the parent links that oxc's ESTree output does not carry. */
export type ISourceTree = {
  /** Root program node. */
  readonly program: Program
  /** Every node in depth-first source order, the program first. */
  readonly nodes: readonly Node[]
  /** Nearest enclosing node, or `undefined` for the program. */
  readonly parentOf: (node: Node) => Node | undefined
  /** Exact source text covered by one node. */
  readonly textOf: (node: Node) => string
  /** Leading comment text written directly before one node (comments and whitespace only). */
  readonly leadingCommentsOf: (node: Node) => string
}

/** Direct child nodes of one node in source order, following oxc's own `visitorKeys`. */
export function childNodes(node: Node): Node[] {
  return (visitorKeys[node.type] ?? []).flatMap((key) => {
    const value = (node as unknown as Record<string, unknown>)[key]
    return (Array.isArray(value) ? value : [value]).filter(
      (child): child is Node => child !== null && typeof child === 'object' && 'type' in child
    )
  })
}

/**
 * Parses one source file for the source-shape guards in this package and indexes parents. The
 * language comes from the file name; the walk follows oxc's own `visitorKeys`.
 *
 * @param filename Name whose extension selects TypeScript/JavaScript parsing.
 * @param source Source text; node offsets index into it.
 */
export function parseSourceTree(filename: string, source: string): ISourceTree {
  const { program, comments } = parseSync(filename, source)
  /** Node to nearest enclosing node. */
  const parents = new Map<Node, Node>()
  /** Depth-first node order. */
  const nodes: Node[] = []
  /** Visits one node and records it as the parent of each child node. */
  const enter = (node: Node): void => {
    nodes.push(node)
    for (const child of childNodes(node)) {
      parents.set(child, node)
      enter(child)
    }
  }
  enter(program)
  /** Index of the last comment ending at or before `offset` (comments are in source order). */
  const lastCommentBefore = (offset: number): number => {
    let low = 0
    let high = comments.length - 1
    let found = -1
    while (low <= high) {
      const middle = (low + high) >> 1
      if (comments[middle]!.end <= offset) {
        found = middle
        low = middle + 1
      } else high = middle - 1
    }
    return found
  }
  return {
    program,
    nodes,
    parentOf: (node) => parents.get(node),
    textOf: (node) => source.slice(node.start, node.end),
    leadingCommentsOf: (node) => {
      /** Comments directly before the node, collected backwards while only whitespace separates. */
      const leading: string[] = []
      let end = node.start
      for (let index = lastCommentBefore(node.start); index >= 0; index--) {
        const comment = comments[index]!
        if (source.slice(comment.end, end).trim() !== '') break
        leading.unshift(source.slice(comment.start, comment.end))
        end = comment.start
      }
      return leading.join('\n')
    }
  }
}
