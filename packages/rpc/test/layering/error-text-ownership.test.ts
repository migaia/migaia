import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Source tree guarded by the package-owned error text contracts. */
const sourceRoot = resolve(import.meta.dirname, '../../src')

/** Enumerates the package source without depending on a generated manifest. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

/** Detects literal error text at constructors, factories, defaults, and message fields. */
function violations(path: string, text: string): string[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const found = new Set<ts.Node>()
  const addLiteral = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      found.add(node)
      return
    }
    // Arguments of a named factory describe data; that factory owns its own text contract.
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) return
    // `typeof value === 'string'` is a type discriminator, not response text.
    if (
      ts.isBinaryExpression(node) &&
      ts.isTypeOfExpression(node.left) &&
      ts.isStringLiteral(node.right) &&
      node.right.text === 'string'
    )
      return
    ts.forEachChild(node, addLiteral)
  }
  /** Text factories may live only in an error-text owner, not at an adapter call site. */
  const isTextOwner = /(?:^|\/)error-text\.ts$/u.test(path)
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ''
      if (/(?:Error|Exception)$/u.test(name) || name === 'tagRpcError') {
        node.arguments?.forEach((argument, index) => {
          if (
            /^(?:DOMException|DomException|domException)$/u.test(name) &&
            index === 1 &&
            ts.isStringLiteral(argument) &&
            argument.text === 'AbortError'
          )
            return
          if (index === 0 || /^(?:DOMException|DomException|domException)$/u.test(name))
            addLiteral(argument)
        })
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'message'
    ) {
      /** These named fields describe wire keys or schema types, not failure text. */
      const nonErrorMessage =
        (path === 'contract/wire-constants.ts' && node.initializer.getText(file) === "'message'") ||
        (path === 'core/internal/contract.ts' && node.initializer.getText(file) === "'string'") ||
        (path === 'core/internal/discovery-attachment.ts' &&
          node.initializer.getText(file) === "'discovery'") ||
        (path === 'core/internal/provider-executor.ts' &&
          ["'message'", "'string'"].includes(node.initializer.getText(file)))
      if (!nonErrorMessage) addLiteral(node.initializer)
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const extendsError = node.heritageClauses?.some(
        (clause) =>
          clause.token === ts.SyntaxKind.ExtendsKeyword &&
          clause.types.some((entry) => /(?:Error|Exception)$/u.test(entry.expression.getText(file)))
      )
      if (extendsError)
        for (const member of node.members) {
          if (!ts.isConstructorDeclaration(member)) continue
          for (const parameter of member.parameters)
            if (parameter.initializer) addLiteral(parameter.initializer)
        }
    }
    if (
      !isTextOwner &&
      ts.isFunctionDeclaration(node) &&
      /(?:Message|Text)$/u.test(node.name?.text ?? '')
    ) {
      for (const statement of node.body?.statements ?? [])
        if (ts.isReturnStatement(statement) && statement.expression)
          addLiteral(statement.expression)
    }
    if (
      !isTextOwner &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /(?:Message|Text)$/u.test(node.name.text) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const body = node.initializer.body
      if (ts.isBlock(body)) {
        for (const statement of body.statements)
          if (ts.isReturnStatement(statement) && statement.expression)
            addLiteral(statement.expression)
      } else addLiteral(body)
    }
    if (
      !isTextOwner &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'onFailure'
    ) {
      for (const argument of node.arguments) addLiteral(argument)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...found].map(
    (node) =>
      `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}:${node.getText(file)}`
  )
}

describe('error text ownership', () => {
  it('[A1] rejects four representative literal forms', () => {
    const fixture = [
      "new Error('x')",
      'tagRpcError(new TypeError(`y ${z}`), c)',
      "class CustomError extends Error { constructor(message = 'm') { super(message) } }",
      "const record = { message: 'n' }"
    ].join('\n')
    expect(violations('fixture.ts', fixture)).toHaveLength(4)
  })

  it('[A1] rejects nested error arguments and local text factory fragments', () => {
    const fixture = [
      "new Error(flag ? 'left' : 'right')",
      'function roleAdmissionMessage() { return `role=${role}` }',
      'const roleAdmissionText = () => `role=${role}`',
      "onFailure('failed')"
    ].join('\n')
    expect(violations('fixture.ts', fixture)).toHaveLength(5)
  })

  it('[A1] keeps all error text in package-owned contracts', () => {
    const found = sourceFiles(sourceRoot).flatMap((path) =>
      violations(relative(sourceRoot, path), readFileSync(path, 'utf8'))
    )
    expect(found).toEqual([])
  })

  it('[A8] resolves abort reasons through one guarded owner', () => {
    const files = sourceFiles(sourceRoot).map(
      (path) => [relative(sourceRoot, path), readFileSync(path, 'utf8')] as const
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
