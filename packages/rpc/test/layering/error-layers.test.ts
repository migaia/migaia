import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Source root whose error ownership is checked by the layering migration. */
const sourceRoot = join(import.meta.dirname, '../../src')
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
  const path = join(sourceRoot, layer, 'error-code.ts')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const codes = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
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
  return sourceFiles(join(sourceRoot, layer)).flatMap((path) =>
    thrownCodes(readFileSync(path, 'utf8'), path).map((code) => ({
      ...code,
      file: relative(sourceRoot, path)
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
    expect(core.size).toBe(23)
    for (const value of retired) expect([...core.values()]).not.toContain(value)
    const contractThrown = new Set(layerThrows('contract').map(({ key }) => key))
    const coreThrown = new Set(layerThrows('core').map(({ key }) => key))
    /** S11 supplies this registered core code's first real throw site. */
    const pendingCore = new Set(['propertyReadFailed'])
    expect([...contract.keys()].filter((key) => !contractThrown.has(key))).toEqual([])
    expect([...core.keys()].filter((key) => !pendingCore.has(key) && !coreThrown.has(key))).toEqual(
      []
    )
  })
})
