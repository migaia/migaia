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
  return new SourceTree(filename, source)
}

/** Owns one parser result and its parent/comment indexes for the source-shape guards. */
class SourceTree implements ISourceTree {
  /** Exact source text remains paired with the parser offsets that index it. */
  readonly #source: string
  /** Comments stay in parser source order for logarithmic predecessor lookup. */
  readonly #comments: ReturnType<typeof parseSync>['comments']
  /** Parent identity is indexed once during the depth-first walk. */
  readonly #parents = new Map<Node, Node>()
  /** Root parser identity is exposed unchanged to the guards. */
  readonly program: Program
  /** Original depth-first order is collected once and retained by this parsed tree. */
  readonly nodes: Node[] = []

  /** Parses one file, retaining the original node identities and exact source offsets. */
  constructor(filename: string, source: string) {
    const { program, comments } = parseSync(filename, source)
    this.program = program
    this.#comments = comments
    this.#source = source
    this.#enter(program)
  }

  /** Visits each child once and records its nearest enclosing node. */
  #enter(node: Node): void {
    this.nodes.push(node)
    for (const child of childNodes(node)) {
      this.#parents.set(child, node)
      this.#enter(child)
    }
  }

  /** Finds the last comment ending before one source offset without scanning earlier comments. */
  #lastCommentBefore(offset: number): number {
    let low = 0
    let high = this.#comments.length - 1
    let found = -1
    while (low <= high) {
      const middle = (low + high) >> 1
      if (this.#comments[middle]!.end <= offset) {
        found = middle
        low = middle + 1
      } else high = middle - 1
    }
    return found
  }

  /** Reads the original parent node without exposing the mutable index. */
  parentOf = (node: Node): Node | undefined => this.#parents.get(node)

  /** Reads exact source text rather than regenerating an equivalent AST spelling. */
  textOf = (node: Node): string => this.#source.slice(node.start, node.end)

  /** Collects adjacent comments backwards, then reverses once to preserve source order in O(n). */
  leadingCommentsOf = (node: Node): string => {
    const leading: string[] = []
    let end = node.start
    for (let index = this.#lastCommentBefore(node.start); index >= 0; index--) {
      const comment = this.#comments[index]!
      if (this.#source.slice(comment.end, end).trim() !== '') break
      leading.push(this.#source.slice(comment.start, comment.end))
      end = comment.start
    }
    return leading.reverse().join('\n')
  }
}
