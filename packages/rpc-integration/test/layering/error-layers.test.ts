import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Node, ObjectPropertyKind } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import { childNodes, parseSourceTree } from '../fixtures/source-tree.ts'

/** Source root whose error ownership is checked by the layering migration. */
const sourceRoots = {
  contract: join(import.meta.dirname, '../../../rpc-contract/src'),
  core: join(import.meta.dirname, '../../../rpc-host/src'),
  browser: join(import.meta.dirname, '../../../rpc-plugin-browser/src')
} as const
/** The core codes removed because no supported throw site emits them. */
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
  const path = join(sourceRoots.contract, 'error-code.ts')
  const { program, textOf } = parseSourceTree(path, readFileSync(path, 'utf8'))
  const codes = new Map<string, string>()
  for (const item of program.body) {
    /** `export const` wraps the variable declaration in an export statement. */
    const statement =
      item.type === 'ExportNamedDeclaration' && item.declaration ? item.declaration : item
    if (statement.type !== 'VariableDeclaration') continue
    for (const declaration of statement.declarations) {
      /** Scenario reasons refine a code; only the canonical code table declares top-level codes. */
      if (
        textOf(declaration.id) !== (layer === 'core' ? 'RpcCoreErrorCode' : 'RpcContractErrorCode')
      )
        continue
      if (declaration.init?.type !== 'TSAsExpression') continue
      const table = declaration.init.expression
      if (table.type !== 'ObjectExpression') continue
      for (const property of table.properties) {
        const value = assignedValue(property)
        if (value?.type !== 'Literal' || typeof value.value !== 'string') continue
        codes.set(textOf((property as { key: Node }).key), value.value)
      }
    }
  }
  return codes
}

/** Value of a plain `key: value` object property; spreads, shorthands and methods have none. */
function assignedValue(property: ObjectPropertyKind): Node | undefined {
  return property.type === 'Property' &&
    property.kind === 'init' &&
    !property.method &&
    !property.shorthand
    ? property.value
    : undefined
}

/** Operators whose result is a boolean predicate rather than an emitted code. */
const predicateOperators = new Set([
  '==',
  '===',
  '!=',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'instanceof'
])

/** Finds code references only inside the AST-defined throw sites. */
function thrownCodes(sourceText: string, filename: string): ICodeReference[] {
  const { program, nodes, parentOf, textOf } = parseSourceTree(filename, sourceText)
  const found: ICodeReference[] = []
  /** Local rejection helpers count only when their code parameter reaches a real tagged throw. */
  const rejectionCodeArguments = new Map<string, number>()
  for (const node of nodes) {
    if (node.type !== 'FunctionDeclaration' || !node.id || !node.body) continue
    for (const statement of node.body.body) {
      if (
        statement.type !== 'ThrowStatement' ||
        statement.argument.type !== 'CallExpression' ||
        textOf(statement.argument.callee) !== 'tagRpcError'
      )
        continue
      /** The original tagger's second argument determines the emitted code. */
      const code = statement.argument.arguments[1]
      if (code?.type !== 'Identifier') continue
      /**
       * Resolve the actual forwarded parameter rather than treating arbitrary reject calls as
       * throws.
       */
      const position = node.params.findIndex(
        (parameter) => parameter.type === 'Identifier' && parameter.name === code.name
      )
      if (position !== -1) rejectionCodeArguments.set(node.id.name, position)
    }
  }
  /** Only an ordinary public Contract import can prove the cross-layer wire source. */
  const contractSourceBindings = new Set(
    program.body.flatMap((statement) =>
      statement.type === 'ImportDeclaration' &&
      /^@migaia\/rpc-contract(?:\/errors)?$/u.test(statement.source.value)
        ? statement.specifiers.flatMap((specifier) =>
            specifier.type === 'ImportSpecifier' &&
            textOf(specifier.imported) === 'RPC_CONTRACT_SOURCE'
              ? [specifier.local.name]
              : []
          )
        : []
    )
  )
  /**
   * The Contract error factory always emits the Contract source with its first argument, whether
   * imported publicly or from its own module inside the Contract package.
   */
  const contractFactoryBindings = new Set(
    program.body.flatMap((statement) =>
      statement.type === 'ImportDeclaration' &&
      /^(?:@migaia\/rpc-contract(?:\/errors)?|\.\.?\/(?:[\w-]+\/)*contract-error\.[jt]s)$/u.test(
        statement.source.value
      )
        ? statement.specifiers.flatMap((specifier) =>
            specifier.type === 'ImportSpecifier' &&
            textOf(specifier.imported) === 'createContractError'
              ? [specifier.local.name]
              : []
          )
        : []
    )
  )
  /** Private methods that only return the public Contract factory forward their code parameter. */
  const contractFactoryForwarders = new Map<string, number>()
  for (const node of nodes) {
    if (node.type !== 'MethodDefinition' || node.key.type !== 'PrivateIdentifier') continue
    /** The forwarder body is exactly `return createContractError(code, ...)`. */
    const [statement] = node.value.body?.body ?? []
    if (
      statement?.type !== 'ReturnStatement' ||
      statement.argument?.type !== 'CallExpression' ||
      !contractFactoryBindings.has(textOf(statement.argument.callee))
    )
      continue
    /** The factory's first argument names the forwarded code parameter. */
    const code = statement.argument.arguments[0]
    const position = node.value.params.findIndex(
      (parameter) => parameter.type === 'Identifier' && parameter.name === code?.name
    )
    if (code?.type === 'Identifier' && position !== -1)
      contractFactoryForwarders.set(`this.#${node.key.name}`, position)
  }
  /** Name of a plain object property, or `undefined` when it is not `key: value`. */
  const propertyName = (property: ObjectPropertyKind): string | undefined =>
    assignedValue(property) === undefined ? undefined : textOf((property as { key: Node }).key)
  const references = (node: Node, contractWireSource?: true): void => {
    /** A predicate chooses a reported code; its compared diagnostics are never emitted codes. */
    if (node.type === 'ConditionalExpression') {
      references(node.consequent, contractWireSource)
      references(node.alternate, contractWireSource)
      return
    }
    /** Equality/range checks return booleans, including classifier tests nested in error arguments. */
    if (node.type === 'BinaryExpression' && predicateOperators.has(node.operator)) return
    if (
      node.type === 'MemberExpression' &&
      !node.computed &&
      node.object.type === 'Identifier' &&
      node.property.type === 'Identifier' &&
      /^(?:RpcContractErrorCode|WebRpcErrorCode|RpcCoreErrorCode|RpcWebErrorCode)$/u.test(
        node.object.name
      )
    ) {
      found.push({
        table: node.object.name,
        key: node.property.name,
        ...(contractWireSource ? { contractWireSource } : {})
      })
    }
    for (const child of childNodes(node)) references(child, contractWireSource)
  }
  for (const node of nodes) {
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = textOf(node.callee)
      /** Only verified local forwarding producers expose their caller's emitted code argument. */
      const rejectionCodeArgument = rejectionCodeArguments.get(callee)
      if (rejectionCodeArgument !== undefined) {
        const argument = node.arguments[rejectionCodeArgument]
        if (argument) references(argument)
      }
      /** A verified private forwarder emits the Contract source with its forwarded code. */
      const forwardedCode = contractFactoryForwarders.get(callee)
      if (forwardedCode !== undefined) {
        const argument = node.arguments[forwardedCode]
        if (argument) references(argument, true)
      }
      const failureResponse =
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        textOf(node.callee.property) === 'failureResponse'
      if (
        /^(?:attachErrorIdentity|createContractError|create(?:Web)?Rpc\w*Error|tag(?:Web)?RpcError|(?:Web)?Rpc\w*Error|failureResponse)$/u.test(
          callee
        ) ||
        failureResponse ||
        (callee === 'super' &&
          (() => {
            let parent = parentOf(node)
            while (parent && parent.type !== 'ClassDeclaration') parent = parentOf(parent)
            return Boolean(parent?.type === 'ClassDeclaration' && parent.id?.name.endsWith('Error'))
          })())
      ) {
        for (const [index, argument] of node.arguments.entries()) {
          if (
            callee === 'attachErrorIdentity' &&
            index === 1 &&
            argument.type === 'ObjectExpression'
          ) {
            /** The explicit source and code must belong to this same identity object. */
            const origin = argument.properties.find(
              (property) => propertyName(property) === 'source'
            )
            const originValue = origin && assignedValue(origin)
            const paired =
              originValue?.type === 'Identifier' && contractSourceBindings.has(originValue.name)
            for (const property of argument.properties) {
              if (paired && propertyName(property) === 'code')
                references(assignedValue(property)!, true)
              else references(property)
            }
          } else if (index === 0 && contractFactoryBindings.has(callee)) references(argument, true)
          else references(argument)
        }
      }
    }
    if (node.type === 'ObjectExpression') {
      const ok = node.properties.find((property) => {
        /** `ok: false as const` still names a failure result. */
        const assigned = assignedValue(property)
        const value = assigned?.type === 'TSAsExpression' ? assigned.expression : assigned
        return propertyName(property) === 'ok' && value?.type === 'Literal' && value.value === false
      })
      const code = node.properties.find((property) => propertyName(property) === 'code')
      if (ok && code) references(assignedValue(code)!)
    }
  }
  return found
}

/** Aggregates the defined throw sites while retaining paths for failure reports. */
function layerThrows(
  layer: 'contract' | 'core' | 'browser'
): Array<ICodeReference & { file: string }> {
  /**
   * Host owns its whole source tree plus the Core error factories that live under the Contract
   * package's `errors/`; the Contract layer is every other Contract directory.
   */
  const directories =
    layer === 'browser'
      ? [join(sourceRoots.browser, layer)]
      : layer === 'core'
        ? [sourceRoots.core, join(sourceRoots.contract, 'errors')]
        : readdirSync(sourceRoots.contract, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name !== 'errors')
            .map((entry) => join(sourceRoots.contract, entry.name))
  return directories.flatMap((directory) =>
    sourceFiles(directory).flatMap((path) =>
      thrownCodes(readFileSync(path, 'utf8'), path).map((code) => ({
        ...code,
        file: relative(join(directory, '..'), path)
      }))
    )
  )
}

describe('layered error ownership', () => {
  it('recognizes only actual throw sites and enforces layer ownership', () => {
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

  it('retains a throw site for each declared code', () => {
    const contract = declaredCodes('contract')
    const core = declaredCodes('core')
    expect(core.size).toBe(34)
    /** The contract declares this report code before probe-core installs its observation runtime. */
    expect(core.get('probeFailed')).toBe('PROBE_FAILED')
    /** Host carriers and features emit Contract frame codes through the public Contract factory. */
    const contractThrown = new Set(
      [
        ...layerThrows('contract'),
        ...layerThrows('core').filter(({ contractWireSource }) => contractWireSource)
      ].map(({ key }) => key)
    )
    const coreThrown = new Set(
      layerThrows('core')
        .filter(({ table }) => /^(?:WebRpcErrorCode|RpcCoreErrorCode)$/u.test(table))
        .map(({ key }) => key)
    )
    expect([...contract.keys()].filter((key) => !contractThrown.has(key))).toEqual([])
    /** Probe runtime reports through its installed canonical site; no reserved Core code is pending. */
    expect([...core.keys()].filter((key) => !coreThrown.has(key))).toEqual([])
  })
})
