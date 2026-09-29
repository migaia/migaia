import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Repository root used for the six cross-package migration targets. */
const repositoryRoot = resolve(new URL('../../../', import.meta.url).pathname)

/** A direct member read is the pattern the shared primitive replaces. */
function isMemberRead(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
  )
}

/** Detect a try block dedicated to one property read, including the old safeRead guard. */
function hasSingleReadTry(source: string, excludedRead?: string): boolean {
  const file = ts.createSourceFile('candidate.ts', source, ts.ScriptTarget.Latest, true)
  let found = false
  const visit = (node: ts.Node): void => {
    if (ts.isTryStatement(node)) {
      const statements = node.tryBlock.statements
      const read = statements.at(-1)
      const leadingGuard = statements.length === 2 && ts.isIfStatement(statements[0]!)
      if (statements.length === 1 || leadingGuard) {
        if (read && ts.isReturnStatement(read) && isMemberRead(read.expression)) found = true
        if (read && ts.isVariableStatement(read) && read.declarationList.declarations.length === 1)
          found ||= isMemberRead(read.declarationList.declarations[0]?.initializer)
        if (read && ts.isExpressionStatement(read) && ts.isBinaryExpression(read.expression))
          found ||=
            isMemberRead(read.expression.right) &&
            read.expression.right.getText(file) !== excludedRead
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** Enumerate source files without depending on a shell or ignored documentation. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
  })
}

describe('guarded property read convergence', () => {
  it('removes the dedicated try blocks and keeps one implementation', () => {
    const predecessor = `function safeRead(value: unknown, key: PropertyKey) {
      try {
        if (value === null) return undefined
        return (value as Record<PropertyKey, unknown>)[key]
      } catch { return undefined }
    }`
    expect(hasSingleReadTry(predecessor)).toBe(true)

    const targets = [
      'packages/utils/src/function.ts',
      'packages/rpc/src/core/internal/safe-value.ts',
      'packages/rpc/src/contract/error.ts',
      'packages/reactive/src/runtime/runtime.class.ts',
      'packages/reactive/src/runtime/scheduler.class.ts',
      'packages/resource/src/resource.class.ts'
    ]
    for (const path of targets) {
      const source = readFileSync(resolve(repositoryRoot, path), 'utf8')
      // The multi-operation abort subscription policy owns this inline read (§2.2).
      const excludedRead =
        path === 'packages/resource/src/resource.class.ts' ? 'signal.aborted' : undefined
      expect(hasSingleReadTry(source, excludedRead), path).toBe(false)
      if (path.endsWith('scheduler.class.ts')) {
        expect(source).toContain('probeThenable(')
        expect(source).toContain('tryReadProperty(')
        expect(source).not.toContain('function inspectThenable')
      } else expect(source).toContain('tryReadProperty(')
      if (path.startsWith('packages/rpc/')) expect(source).toContain("from '@migaia/utils/error'")
      if (path === 'packages/utils/src/function.ts') expect(source).toContain("from './error.js'")
    }

    const declarations = readdirSync(resolve(repositoryRoot, 'packages'), {
      withFileTypes: true
    }).flatMap((entry) => {
      if (!entry.isDirectory()) return []
      const sourceRoot = resolve(repositoryRoot, 'packages', entry.name, 'src')
      if (!existsSync(sourceRoot)) return []
      return sourceFiles(sourceRoot).filter((path) =>
        /function tryReadProperty\b/.test(readFileSync(path, 'utf8'))
      )
    })
    expect(declarations).toEqual([resolve(repositoryRoot, 'packages/utils/src/error.ts')])
  })
})
