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

type ICodeReference = {
  readonly table: string
  readonly key: string
  /** A public Contract source import paired with this exact attach identity's emitted code. */
  readonly contractWireSource?: true
}

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
  /** Only an ordinary public Contract import can prove the cross-layer wire source. */
  const contractSourceBindings = new Set(
    source.statements.flatMap((statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /^@migaia\/rpc-contract(?:\/errors)?$/u.test(statement.moduleSpecifier.text) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
        ? statement.importClause.namedBindings.elements
            .filter(
              (element) => (element.propertyName ?? element.name).text === 'RPC_CONTRACT_SOURCE'
            )
            .map((element) => element.name.text)
        : []
    )
  )
  const references = (node: ts.Node, contractWireSource?: true): void => {
    /** A predicate chooses a reported code; its compared diagnostics are never emitted codes. */
    if (ts.isConditionalExpression(node)) {
      references(node.whenTrue, contractWireSource)
      references(node.whenFalse, contractWireSource)
      return
    }
    /** Equality/range checks return booleans, including classifier tests nested in error arguments. */
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.LessThanToken,
        ts.SyntaxKind.LessThanEqualsToken,
        ts.SyntaxKind.GreaterThanToken,
        ts.SyntaxKind.GreaterThanEqualsToken,
        ts.SyntaxKind.InKeyword,
        ts.SyntaxKind.InstanceOfKeyword
      ].includes(node.operatorToken.kind)
    )
      return
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^(?:RpcContractErrorCode|WebRpcErrorCode|RpcCoreErrorCode|RpcWebErrorCode)$/u.test(
        node.expression.text
      )
    ) {
      found.push({
        table: node.expression.text,
        key: node.name.text,
        ...(contractWireSource ? { contractWireSource } : {})
      })
    }
    ts.forEachChild(node, (child) => references(child, contractWireSource))
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(source)
      const failureResponse =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'failureResponse'
      if (
        /^(?:attachErrorIdentity|createContractError|create(?:Web)?Rpc\w*Error|tag(?:Web)?RpcError|(?:Web)?Rpc\w*Error|failureResponse)$/u.test(
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
        for (const [index, argument] of (node.arguments ?? []).entries()) {
          if (
            callee === 'attachErrorIdentity' &&
            index === 1 &&
            ts.isObjectLiteralExpression(argument)
          ) {
            /** The explicit source and code must belong to this same identity object. */
            const origin = argument.properties.find(
              (property) =>
                ts.isPropertyAssignment(property) && property.name.getText(source) === 'source'
            )
            const paired =
              origin &&
              ts.isPropertyAssignment(origin) &&
              ts.isIdentifier(origin.initializer) &&
              contractSourceBindings.has(origin.initializer.text)
            for (const property of argument.properties) {
              if (
                paired &&
                ts.isPropertyAssignment(property) &&
                property.name.getText(source) === 'code'
              )
                references(property.initializer, true)
              else references(property)
            }
          } else references(argument)
        }
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
      coreThrows.filter(({ table, key, contractWireSource }) =>
        table === 'RpcContractErrorCode'
          ? !contractWireSource || !contract.has(key)
          : contractWireSource ||
            !/^(?:WebRpcErrorCode|RpcCoreErrorCode)$/u.test(table) ||
            !core.has(key)
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
    expect(
      thrownCodes('throw createRpcError(RpcCoreErrorCode.internal, message)', 'fixture.ts')
    ).toEqual([{ table: 'RpcCoreErrorCode', key: 'internal' }])
    expect(
      thrownCodes(
        'throw createRpcError(classifyRpcContractError(error)?.code === RpcContractErrorCode.frameLimitExceeded ? RpcCoreErrorCode.payloadInvalid : RpcCoreErrorCode.internal, message)',
        'fixture.ts'
      )
    ).toEqual([
      { table: 'RpcCoreErrorCode', key: 'payloadInvalid' },
      { table: 'RpcCoreErrorCode', key: 'internal' }
    ])
    expect(
      thrownCodes(
        'import { RPC_CONTRACT_SOURCE } from "@migaia/rpc-contract/errors"; throw attachErrorIdentity(error, { source: RPC_CONTRACT_SOURCE, code: RpcContractErrorCode.frameLimitExceeded })',
        'fixture.ts'
      )
    ).toEqual([
      { table: 'RpcContractErrorCode', key: 'frameLimitExceeded', contractWireSource: true }
    ])
    expect(
      thrownCodes(
        'import { RPC_CONTRACT_SOURCE } from "wrong-package"; throw attachErrorIdentity(error, { source: RPC_CONTRACT_SOURCE, code: RpcContractErrorCode.frameLimitExceeded })',
        'fixture.ts'
      )
    ).toEqual([{ table: 'RpcContractErrorCode', key: 'frameLimitExceeded' }])
    expect(
      thrownCodes(
        'import { RPC_CONTRACT_SOURCE } from "@migaia/rpc-contract"; throw attachErrorIdentity(error, { source: "wrong-source", code: RpcContractErrorCode.frameLimitExceeded })',
        'fixture.ts'
      )
    ).toEqual([{ table: 'RpcContractErrorCode', key: 'frameLimitExceeded' }])
  })

  it('A2 removes every dead core code while retaining a throw site for each declared code', () => {
    const contract = declaredCodes('contract')
    const core = declaredCodes('core')
    expect(core.size).toBe(33)
    /** Contract R5 declares this report code before probe-core installs its observation runtime. */
    expect(core.get('probeFailed')).toBe('PROBE_FAILED')
    expect(core.get('duplicateModuleInstance')).toBe('DUPLICATE_MODULE_INSTANCE')
    for (const value of retired) expect([...core.values()]).not.toContain(value)
    const contractThrown = new Set(layerThrows('contract').map(({ key }) => key))
    const coreThrown = new Set(
      layerThrows('core')
        .filter(({ table }) => /^(?:WebRpcErrorCode|RpcCoreErrorCode)$/u.test(table))
        .map(({ key }) => key)
    )
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
    /** Probe runtime reports through its installed canonical site; no reserved Core code is pending. */
    expect([...core.keys()].filter((key) => !coreThrown.has(key))).toEqual([])
  })
})
