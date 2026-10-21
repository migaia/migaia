import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSync, Visitor, type Node } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

/** Repository root used for the six cross-package migration targets. */
const repositoryRoot = resolve(new URL('../../../', import.meta.url).pathname)

/** A direct member read is the pattern the shared primitive replaces. */
function isMemberRead(node: Node | null | undefined): boolean {
  return node?.type === 'MemberExpression'
}

/** Detect a try block dedicated to one property read, including the old safeRead guard. */
function hasSingleReadTry(source: string, excludedRead?: string): boolean {
  let found = false
  new Visitor({
    TryStatement(node) {
      const statements = node.block.body
      const read = statements.at(-1)
      const leadingGuard = statements.length === 2 && statements[0]!.type === 'IfStatement'
      if (statements.length === 1 || leadingGuard) {
        if (read?.type === 'ReturnStatement' && isMemberRead(read.argument)) found = true
        if (read?.type === 'VariableDeclaration' && read.declarations.length === 1)
          found ||= isMemberRead(read.declarations[0]?.init)
        if (
          read?.type === 'ExpressionStatement' &&
          (read.expression.type === 'AssignmentExpression' ||
            read.expression.type === 'BinaryExpression' ||
            read.expression.type === 'LogicalExpression')
        )
          found ||=
            isMemberRead(read.expression.right) &&
            source.slice(read.expression.right.start, read.expression.right.end) !== excludedRead
      }
    }
  }).visit(parseSync('candidate.ts', source).program)
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
  it('keeps the shared primitive and the allocation-free then inspection exception', () => {
    const predecessor = `function safeRead(value: unknown, key: PropertyKey) {
      try {
        if (value === null) return undefined
        return (value as Record<PropertyKey, unknown>)[key]
      } catch { return undefined }
    }`
    expect(hasSingleReadTry(predecessor)).toBe(true)

    const targets = [
      'packages/utils/src/function.ts',
      'packages/rpc-core/src/core/internal/safe-value.ts',
      'packages/utils/src/error-chain.ts',
      'packages/reactive/src/runtime/runtime.class.ts',
      'packages/reactive/src/runtime/scheduler.class.ts',
      'packages/resource/src/resource.class.ts'
    ]
    for (const path of targets) {
      const source = readFileSync(resolve(repositoryRoot, path), 'utf8')
      // Abort admission and the explicitly optimized then inspection own these single reads.
      const excludedRead =
        path === 'packages/resource/src/resource.class.ts'
          ? 'signal.aborted'
          : path === 'packages/utils/src/function.ts'
            ? '(value as { then?: unknown }).then'
            : undefined
      expect(hasSingleReadTry(source, excludedRead), path).toBe(false)
      if (path.endsWith('scheduler.class.ts')) {
        expect(source).toContain('probeThenable(')
        expect(source).toContain('tryReadProperty(')
        expect(source).not.toContain('function inspectThenable')
      } else expect(source).toContain('tryReadProperty(')
      if (path.startsWith('packages/rpc-')) expect(source).toContain("from '@migaia/utils/error'")
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
