import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Source root whose error ownership is checked by the layering migration. */
const sourceRoots = {
  contract: join(import.meta.dirname, '../../../rpc-contract/src'),
  core: join(import.meta.dirname, '../../../rpc-core/src'),
  browser: join(import.meta.dirname, '../../../rpc-browser/src')
} as const
/** Compiler-owned guard uses canonical Core identity and its actual emitted throw-site source map. */
const compilerSource = join(import.meta.dirname, '../../../../scripts/rpc-instance-emit.mjs')
/** The core codes removed by BC1 because no supported throw site emits them. */
const retired = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../fixtures/layering-retired-codes.json'), 'utf8')
  ) as { readonly codes: readonly string[] }
).codes

type ICodeReference = { readonly table: string; readonly key: string }

/** Lists only maintained TypeScript source files under one layer. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

/** Reads declared code values from a layer's single error-code table. */
function declaredCodes(layer: 'contract' | 'core'): Map<string, string> {
  const path = join(sourceRoots[layer], layer, 'error-code.ts')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const codes = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      /** Scenario reasons refine a code; only the canonical code table declares top-level codes. */
      if (
        declaration.name.getText(source) !==
        (layer === 'core' ? 'RpcCoreErrorCode' : 'RpcContractErrorCode')
      )
        continue
      if (!declaration.initializer || !ts.isAsExpression(declaration.initializer)) continue
      const table = declaration.initializer.expression
      if (!ts.isObjectLiteralExpression(table)) continue
      for (const property of table.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer))
          continue
        codes.set(property.name.getText(source), property.initializer.text)
      }
    }
  }
  return codes
}

/** Finds code references only inside the SDD's AST-defined throw sites. */
function thrownCodes(sourceText: string, filename: string): ICodeReference[] {
  const source = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true)
  const found: ICodeReference[] = []
  const references = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^(?:RpcContractErrorCode|WebRpcErrorCode|RpcCoreErrorCode|RpcWebErrorCode)$/u.test(
        node.expression.text
      )
    ) {
      found.push({ table: node.expression.text, key: node.name.text })
    }
    ts.forEachChild(node, references)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(source)
      const failureResponse =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'failureResponse'
      if (
        /^(?:attachErrorIdentity|createContractError|tag(?:Web)?RpcError|(?:Web)?Rpc\w*Error|failureResponse)$/u.test(
          callee
        ) ||
        failureResponse ||
        (callee === 'super' &&
          (() => {
            let parent: ts.Node | undefined = node.parent
            while (parent && !ts.isClassDeclaration(parent)) parent = parent.parent
            return Boolean(parent && parent.name?.text.endsWith('Error'))
          })())
      ) {
        for (const argument of node.arguments ?? []) references(argument)
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const ok = node.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(source) === 'ok' &&
          property.initializer.kind === ts.SyntaxKind.FalseKeyword
      )
      const code = node.properties.find(
        (property) => ts.isPropertyAssignment(property) && property.name.getText(source) === 'code'
      )
      if (ok && code && ts.isPropertyAssignment(code)) references(code.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Aggregates the SDD-defined throw sites while retaining paths for failure reports. */
function layerThrows(
  layer: 'contract' | 'core' | 'browser'
): Array<ICodeReference & { file: string }> {
  return sourceFiles(join(sourceRoots[layer], layer)).flatMap((path) =>
    thrownCodes(readFileSync(path, 'utf8'), path).map((code) => ({
      ...code,
      file: relative(sourceRoots[layer], path)
    }))
  )
}

describe('layered error ownership', () => {
  it('A1 recognizes only actual throw sites and enforces layer ownership', () => {
    const contract = declaredCodes('contract')
    const core = declaredCodes('core')
    const contractThrows = layerThrows('contract')
    const coreThrows = layerThrows('core')
    const browserThrows = layerThrows('browser')
    expect(contractThrows.length).toBeGreaterThan(0)
    expect(coreThrows.length).toBeGreaterThan(0)
    expect(browserThrows.length).toBeGreaterThan(0)
    expect(
      contractThrows.filter(
        ({ table, key }) => table !== 'RpcContractErrorCode' || !contract.has(key)
      )
    ).toEqual([])
    expect(
      coreThrows.filter(
        ({ table, key }) => !/^(?:WebRpcErrorCode|RpcCoreErrorCode)$/u.test(table) || !core.has(key)
      )
    ).toEqual([])
    expect(
      browserThrows.filter(
        ({ table, key }) => !/^(?:WebRpcErrorCode|RpcCoreErrorCode)$/u.test(table) || !core.has(key)
      )
    ).toEqual([])
    expect(
      thrownCodes('new RpcTransportError(msg, RpcWebErrorCode.missing)', 'fixture.ts')
    ).toEqual([{ table: 'RpcWebErrorCode', key: 'missing' }])
    expect(thrownCodes('const event = { code: RpcCoreErrorCode.transport }', 'fixture.ts')).toEqual(
      []
    )
  })

  it('A2 removes every dead core code while retaining a throw site for each declared code', () => {
    const contract = declaredCodes('contract')
    const core = declaredCodes('core')
    expect(core.size).toBe(32)
    expect(core.get('duplicateModuleInstance')).toBe('DUPLICATE_MODULE_INSTANCE')
    for (const value of retired) expect([...core.values()]).not.toContain(value)
    const contractThrown = new Set(layerThrows('contract').map(({ key }) => key))
    const coreThrown = new Set(layerThrows('core').map(({ key }) => key))
    /** The virtual Source is true compiler input; do not waive a declared code merely by name. */
    const compiler = readFileSync(compilerSource, 'utf8')
    expect(compiler).toContain(
      "canonicalLiteral(join(coreSource, 'error-code.ts'), 'ERROR_SOURCE')"
    )
    expect(compiler).toContain("'RpcCoreErrorCode',\n      'duplicateModuleInstance'")
    expect(compiler).toContain("'RpcCoreErrorText',\n      'duplicateModuleInstance'")
    expect(compiler).toContain(
      'const virtualText = bootstrapSource(manifest.name, manifest.version, identity)'
    )
    const guardMap = JSON.parse(
      readFileSync(join(sourceRoots.core, '../dist/internal/module-instance.js.map'), 'utf8')
    ) as {
      sources: string[]
      sourcesContent: string[]
    }
    expect(guardMap.sources).toEqual(['../../src/internal/module-instance.ts'])
    const guard = guardMap.sourcesContent[0]!
    const parsedGuard = ts.createSourceFile(
      'module-instance.ts',
      guard,
      ts.ScriptTarget.Latest,
      true
    )
    const declaration = parsedGuard.statements.find(
      (statement) =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === 'assertRpcModuleInstance'
    )
    expect(declaration && ts.isFunctionDeclaration(declaration)).toBe(true)
    expect(guard).toContain(
      'const error = new Error("Duplicate @migaia/rpc module instance detected")'
    )
    expect(guard).toContain('source: { value: "@migaia/rpc/core", enumerable: true }')
    expect(guard).toContain('code: { value: "DUPLICATE_MODULE_INSTANCE", enumerable: true }')
    expect(guard).toContain('throw error')
    /** Packed duplicate/version copies prove this exact compiler throw executes before acquisition. */
    coreThrown.add('duplicateModuleInstance')
    expect([...contract.keys()].filter((key) => !contractThrown.has(key))).toEqual([])
    expect([...core.keys()].filter((key) => !coreThrown.has(key))).toEqual([])
  })
})
