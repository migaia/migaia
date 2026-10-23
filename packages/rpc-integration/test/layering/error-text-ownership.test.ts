import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Node } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import { childNodes, parseSourceTree } from '../fixtures/source-tree.ts'

/** Source tree guarded by the package-owned error text contracts. */
const packageRoots = [
  'rpc-contract',
  'rpc-host',
  'rpc-plugin-process',
  'rpc-plugin-thread',
  'rpc-plugin-browser'
].map((owner) => resolve(import.meta.dirname, '../../..', owner, 'src'))

/** Text-owner labels follow the actual package-owned source after adapter extraction. */
function sourceLabel(root: string, path: string): string {
  return relative(root, path)
}

/** Enumerates the package source without depending on a generated manifest. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

/** Detects literal error text at constructors, factories, defaults, and message fields. */
function violations(path: string, text: string): string[] {
  const { nodes, parentOf, textOf } = parseSourceTree(path, text)
  const found = new Set<Node>()
  const addLiteral = (node: Node): void => {
    if (
      (node.type === 'Literal' && typeof node.value === 'string') ||
      node.type === 'TemplateLiteral'
    ) {
      found.add(node)
      return
    }
    // Arguments of a named factory describe data; that factory owns its own text contract.
    if (node.type === 'CallExpression' || node.type === 'NewExpression') return
    // `typeof value === 'string'` is a type discriminator, not response text.
    if (
      node.type === 'BinaryExpression' &&
      node.left.type === 'UnaryExpression' &&
      node.left.operator === 'typeof' &&
      node.right.type === 'Literal' &&
      node.right.value === 'string'
    )
      return
    for (const child of childNodes(node)) addLiteral(child)
  }
  /** Return expressions written directly in one function body. */
  const returnedExpressions = (body: Node | null | undefined): Node[] =>
    body?.type === 'BlockStatement'
      ? body.body.flatMap((statement) =>
          statement.type === 'ReturnStatement' && statement.argument ? [statement.argument] : []
        )
      : []
  /** Text factories may live only in an error-text owner, not at an adapter call site. */
  const isTextOwner = /(?:^|\/)error-text\.ts$/u.test(path)
  for (const node of nodes) {
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee
      const name =
        callee.type === 'Identifier'
          ? callee.name
          : callee.type === 'MemberExpression' && !callee.computed
            ? textOf(callee.property)
            : ''
      if (/(?:Error|Exception)$/u.test(name) || name === 'tagRpcError') {
        node.arguments.forEach((argument, index) => {
          if (
            /^(?:DOMException|DomException|domException)$/u.test(name) &&
            index === 1 &&
            argument.type === 'Literal' &&
            argument.value === 'AbortError'
          )
            return
          if (index === 0 || /^(?:DOMException|DomException|domException)$/u.test(name))
            addLiteral(argument)
        })
      }
    }
    if (
      node.type === 'Property' &&
      node.kind === 'init' &&
      !node.method &&
      !node.shorthand &&
      !node.computed &&
      ((node.key.type === 'Identifier' && node.key.name === 'message') ||
        (node.key.type === 'Literal' && node.key.value === 'message'))
    ) {
      const object = parentOf(node)
      /** Strip only the canonical constant assertion to find the event object's declaration. */
      const holder = object && parentOf(object)
      const declaration = holder?.type === 'TSAsExpression' ? parentOf(holder) : holder
      /** Text of the assigned value. */
      const value = textOf(node.value)
      /** Declared name of the enclosing object constant, if the object is one. */
      const declared =
        object?.type === 'ObjectExpression' && declaration?.type === 'VariableDeclarator'
          ? textOf(declaration.id)
          : undefined
      /** These named fields describe wire keys or schema types, not failure text. */
      const nonErrorMessage =
        (path === 'contract/wire-constants.ts' && value === "'message'") ||
        ((path === 'threads/constants.ts' || path === 'runtime-adapter/message/constants.ts') &&
          value === "'message'" &&
          declared ===
            (path === 'threads/constants.ts' ? 'ThreadEvent' : 'MessageResourceEvent')) ||
        (path === 'browser/peer-text.ts' &&
          value === "'message'" &&
          declared === 'BrowserPeerEvent') ||
        (path === 'core/internal/contract.ts' && value === "'string'") ||
        (path === 'core/internal/discovery-attachment.ts' && value === "'discovery'") ||
        (path === 'core/internal/provider-executor.ts' && ["'message'", "'string'"].includes(value))
      if (!nonErrorMessage) addLiteral(node.value)
    }
    if (
      (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') &&
      node.superClass &&
      /(?:Error|Exception)$/u.test(textOf(node.superClass))
    )
      for (const member of node.body.body) {
        if (member.type !== 'MethodDefinition' || member.kind !== 'constructor') continue
        for (const parameter of member.value.params) {
          /** Parameter properties wrap the plain parameter. */
          const plain = parameter.type === 'TSParameterProperty' ? parameter.parameter : parameter
          if (plain.type === 'AssignmentPattern') addLiteral(plain.right)
        }
      }
    if (
      !isTextOwner &&
      node.type === 'FunctionDeclaration' &&
      /(?:Message|Text)$/u.test(node.id?.name ?? '')
    )
      for (const expression of returnedExpressions(node.body)) addLiteral(expression)
    if (
      !isTextOwner &&
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      /(?:Message|Text)$/u.test(node.id.name) &&
      (node.init?.type === 'ArrowFunctionExpression' || node.init?.type === 'FunctionExpression')
    ) {
      const body = node.init.body
      if (body?.type === 'BlockStatement')
        for (const expression of returnedExpressions(body)) addLiteral(expression)
      else if (body) addLiteral(body)
    }
    if (
      !isTextOwner &&
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'onFailure'
    )
      for (const argument of node.arguments) addLiteral(argument)
  }
  return [...found].map(
    (node) => `${path}:${text.slice(0, node.start).split('\n').length}:${textOf(node)}`
  )
}

describe('error text ownership', () => {
  it('rejects four representative literal forms', () => {
    const fixture = [
      "new Error('x')",
      'tagRpcError(new TypeError(`y ${z}`), c)',
      "class CustomError extends Error { constructor(message = 'm') { super(message) } }",
      "const record = { message: 'n' }"
    ].join('\n')
    expect(violations('fixture.ts', fixture)).toHaveLength(4)
  })

  it('rejects nested error arguments and local text factory fragments', () => {
    const fixture = [
      "new Error(flag ? 'left' : 'right')",
      'function roleAdmissionMessage() { return `role=${role}` }',
      'const roleAdmissionText = () => `role=${role}`',
      "onFailure('failed')"
    ].join('\n')
    expect(violations('fixture.ts', fixture)).toHaveLength(5)
  })

  it('keeps all error text in package-owned contracts', () => {
    const found = packageRoots.flatMap((root) =>
      sourceFiles(root).flatMap((path) =>
        violations(sourceLabel(root, path), readFileSync(path, 'utf8'))
      )
    )
    expect(found).toEqual([])
  })

  it('distinguishes canonical thread events from error messages', () => {
    expect(
      violations('threads/constants.ts', "const ThreadEvent = { message: 'message' } as const")
    ).toEqual([])
    expect(violations('threads/constants.ts', "const error = { message: 'failed' }")).toHaveLength(
      1
    )
    expect(violations('threads/adapter.ts', "const error = { message: 'message' }")).toHaveLength(1)
    expect(violations('threads/constants.ts', "const error = { message: 'message' }")).toHaveLength(
      1
    )
  })

  it('resolves abort reasons through one guarded owner', () => {
    const files = packageRoots.flatMap((root) =>
      sourceFiles(root).map(
        (path) => [sourceLabel(root, path), readFileSync(path, 'utf8')] as const
      )
    )
    expect(
      files.flatMap(([path, text]) =>
        [...text.matchAll(/(?:[sS]ignal|\))\??\.reason\b/gu)].map(
          (match) => `${path}:${match.index}`
        )
      )
    ).toEqual([])
    expect(
      files.filter(([, text]) => text.includes('function resolveAbortReason')).map(([path]) => path)
    ).toEqual(['core/internal/async-control.ts'])
    const asyncControl = files.find(([path]) => path === 'core/internal/async-control.ts')?.[1]
    expect(asyncControl).toContain("from '@migaia/utils/error'")
    expect(files.some(([, text]) => text.includes('tryReadAbortReason'))).toBe(false)
    for (const path of [
      'core/internal/outbound-attachment.ts',
      'core/internal/construction-install.ts',
      'core/internal/stream/owner.ts',
      'core/internal/canonical-chunk-attachment.ts'
    ])
      expect(files.find(([entry]) => entry === path)?.[1]).toMatch(
        /import .*resolveAbortReason.*async-control\.js/u
      )
  })
})
