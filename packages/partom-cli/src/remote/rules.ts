import type { IIssue } from '@migaia/part-contract'
import { parseSync } from 'oxc-parser'
import { childNodes, isNode, LineIndex, type INode } from '../usage/ast.ts'
import { RemoteRule } from './text.ts'

/**
 * Packages a remote module may import, all provided by the page at run time through the shared
 * runtime global. Fixed compile-time list of four.
 */
export const SHARED_RUNTIME = [
  '@migaia/part-host',
  '@migaia/part-contract',
  'react',
  'react/jsx-runtime'
] as const

/** Shared runtime specifiers as a set for lookups. */
const SHARED = new Set<string>(SHARED_RUNTIME)

/**
 * Globals a remote module may not reference: side effects go through the injected ctx and Features
 * only. Fixed compile-time list.
 */
const FORBIDDEN_GLOBALS = new Set([
  'window',
  'document',
  'globalThis',
  'self',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'eval',
  'Function',
  'process',
  'Bun',
  'Deno',
  'require',
  'module'
])

/** Rule check state: the module name, its line index and the issues found. */
type IRuleState = {
  readonly name: string
  readonly lines: LineIndex
  readonly source: string
  readonly issues: IIssue[]
}

/** Records one issue at a node's position (`<name>:<line>:<column>`). */
function report(state: IRuleState, node: INode, rule: string): void {
  /** One-based line of the node. */
  const line = state.lines.lineOf(node.start)
  /** One-based column of the node. */
  const column = node.start - state.source.lastIndexOf('\n', node.start - 1)
  state.issues.push({
    address: '',
    facet: 'module',
    path: `${state.name}:${line}:${column}`,
    code: rule,
    rule,
    messageKey: rule,
    severity: 'error'
  })
}

/** Checks an import or re-export source against the shared runtime list. */
function checkSource(state: IRuleState, node: INode): void {
  /** Source literal of the declaration. */
  const source = node.source as INode | null | undefined
  if (source !== null && source !== undefined && !SHARED.has(String(source.value)))
    report(state, node, RemoteRule.import)
}

/** True when a top-level expression statement is a call (a definition call), not an assignment. */
function isDefinitionCall(statement: INode): boolean {
  /** Expression of the statement. */
  const expression = statement.expression as INode | undefined
  return expression?.type === 'CallExpression'
}

/** Checks top-level statements for module state. */
function checkTopLevel(state: IRuleState, body: readonly INode[]): void {
  for (const statement of body) {
    if (statement.type === 'VariableDeclaration' && statement.kind !== 'const')
      report(state, statement, RemoteRule.moduleState)
    if (statement.type === 'ExpressionStatement' && !isDefinitionCall(statement))
      report(state, statement, RemoteRule.moduleState)
  }
}

/** True when an identifier node names a binding reference rather than a property key. */
function isReference(node: INode, parent: INode | undefined): boolean {
  if (parent === undefined) return true
  if (parent.type === 'MemberExpression' && parent.property === node && parent.computed !== true)
    return false
  if ((parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key === node)
    return parent.computed === true
  return true
}

/** Walks every node once, applying the import and global rules; an explicit stack, no recursion. */
function walk(state: IRuleState, program: INode): void {
  /** Pending nodes with their parents. */
  const stack: [INode, INode | undefined][] = [[program, undefined]]
  while (stack.length > 0) {
    /** Next node and its parent. */
    const [node, parent] = stack.pop() as [INode, INode | undefined]
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    )
      checkSource(state, node)
    if (node.type === 'ImportExpression') report(state, node, RemoteRule.import)
    if (
      node.type === 'Identifier' &&
      FORBIDDEN_GLOBALS.has(String(node.name)) &&
      isReference(node, parent)
    )
      report(state, node, RemoteRule.global)
    for (const child of childNodes(node)) if (isNode(child)) stack.push([child, node])
  }
}

/**
 * Syntax-level rules of one remote module source: `remote.import` (only the shared runtime, no
 * relative, dynamic or `require` imports), `remote.module-state` (no top-level `let`/`var` or
 * non-call expression statements) and `remote.global` (no host globals). Returns the issues in
 * discovery order; parse errors are reported by the caller.
 */
export function checkRemoteRules(name: string, source: string): IIssue[] {
  /** Parse result. */
  const parsed = parseSync(name, source, { sourceType: 'module' })
  /** Rule state. */
  const state: IRuleState = { name, lines: new LineIndex(source), source, issues: [] }
  /** Program node. */
  const program = parsed.program as unknown as INode
  checkTopLevel(state, program.body as INode[])
  walk(state, program)
  return state.issues
}

/** Parse errors of a source, as messages; empty when it parses. */
export function parseErrors(name: string, source: string): readonly string[] {
  return parseSync(name, source, { sourceType: 'module' }).errors.map((error) => error.message)
}
