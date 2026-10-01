import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  deserializeRpcError,
  fromJsonRpcError,
  normalizeRpcSerializedError,
  RpcWireErrorField,
  RpcWireErrorLimit,
  serializeRpcError
} from '@migaia/rpc/contract'

/** Minimal language-neutral node used by generated size boundaries. */
type IGeneratedNode = {
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: IGeneratedNode
  errors?: IGeneratedNode[]
  data?: unknown
}

type ICase = {
  id: string
  wire?: unknown
  generate?: { shape: string; size: number; leaf?: unknown }
  violation?: string
  pointer?: string
}

/** Native error graph described without JavaScript prototypes in the shared vector file. */
type ILogicalError = {
  name?: string
  message: string
  stack: string
  cause?: { ref: 'root' }
  errors?: unknown[]
  truncated?: true
}

/** Compact large-input cases and their expected budget outcomes. */
type IGeneratedCase = {
  shape: string
  size: number
  textBytes?: number
  expectedBytes?: number
  expectedChildren?: number
  expectedStackBytes?: number
}

/** One language-neutral thrown-value or foreign JSON-RPC mapping case. */
type IMappingCase = {
  id: string
  input?: unknown
  expected?: unknown
  generate?: IGeneratedCase
}

/** Vector and schema directory owned by the contract package. */
const schemaRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../schema')
/** Executable cross-language wire-error examples. */
const vectors = JSON.parse(readFileSync(join(schemaRoot, 'vectors/error-chain.json'), 'utf8')) as {
  version: number
  valid: ICase[]
  invalid: ICase[]
  unknownFields: Array<{
    wire: unknown
    reject: { violation: string; pointer: string }
    ignoreReports: unknown[]
    ignoreExpected: unknown
  }>
  truncation: IMappingCase[]
  jsonrpc: IMappingCase[]
}

/** Build one canonical node without relying on a native Error constructor. */
function node(message = ''): IGeneratedNode {
  return { source: 's', code: 'C', name: 'Error', message, stack: 'x' }
}

/** Expand the compact generator grammar documented alongside the vectors. */
function expand(item: ICase): unknown {
  if (!item.generate) return item.wire
  const { shape, size, leaf } = item.generate
  const root = node()
  if (shape === 'message') {
    root.message = 'x'.repeat(size)
    return root
  }
  if (shape === 'chain' || shape === 'errorsChain') {
    let current = root
    for (let index = 1; index < size; index += 1) {
      const child = node()
      if (shape === 'chain') current.cause = child
      else current.errors = [child]
      current = child
    }
    return root
  }
  if (shape === 'wide') {
    root.errors = Array.from({ length: size - 1 }, () => node())
    return root
  }
  if (shape === 'dataDepth') {
    let data = leaf
    for (let index = 1; index < size; index += 1) data = [data]
    root.data = data
    return root
  }
  if (shape === 'totalBytes') {
    root.errors = Array.from({ length: 16 }, (_, index) =>
      node('x'.repeat(index < 15 ? 65_536 : size - 8 - 15 * (65_536 + 8) - 8))
    )
    return root
  }
  expect.fail(`unknown vector generator: ${shape}`)
}

/** Construct one native input from the fixture's language-neutral logical error shape. */
function logicalInput(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  if ('absent' in value) return undefined
  if (!('logicalError' in value)) return value
  const source = value.logicalError as ILogicalError
  const error = new Error(source.message)
  Object.defineProperty(error, 'name', { value: source.name ?? 'Error', configurable: true })
  Object.defineProperty(error, 'stack', { value: source.stack, configurable: true })
  if (source.cause?.ref === 'root')
    Object.defineProperty(error, 'cause', { value: error, configurable: true })
  if (source.errors !== undefined)
    Object.defineProperty(error, 'errors', { value: source.errors, configurable: true })
  if (source.truncated === true)
    Object.defineProperty(error, 'truncated', { value: true, configurable: true })
  return error
}

/** Expand the compact budget cases into an input and an independently specified result. */
function generatedTruncation(item: IGeneratedCase): { input: unknown; expected: unknown } {
  const basic = (message: string, stack: string): IGeneratedNode => ({
    source: 'unknown',
    code: 'UNKNOWN',
    name: 'Error',
    message,
    stack
  })
  if (item.shape === 'longStack') {
    const input = new Error('m')
    Object.defineProperty(input, 'stack', { value: 'x'.repeat(item.size) })
    return {
      input,
      expected: { ...basic('m', 'x'.repeat(item.expectedBytes!)), truncated: true }
    }
  }
  if (item.shape === 'oversizedData') {
    const input = new Error('m') as Error & { data?: string }
    Object.defineProperty(input, 'stack', { value: 'Error: m' })
    input.data = 'x'.repeat(item.size)
    return { input, expected: { ...basic('m', 'Error: m'), truncated: true } }
  }
  if (item.shape === 'greedySiblings') {
    const input = new Error('m') as Error & { errors?: Error[] }
    Object.defineProperty(input, 'stack', { value: 'Error: m' })
    const text = 'x'.repeat(item.textBytes!)
    input.errors = Array.from({ length: item.size }, () => {
      const child = new Error(text)
      Object.defineProperty(child, 'stack', { value: text })
      return child
    })
    return {
      input,
      expected: {
        ...basic('m', 'Error: m'),
        errors: Array.from({ length: item.expectedChildren! }, () => basic(text, text)),
        truncated: true
      }
    }
  }
  return expect.fail(`unknown truncation generator: ${item.shape}`)
}

/** Expand a large foreign message without storing its 65 KiB text literally. */
function generatedJsonRpc(item: IGeneratedCase): { input: unknown; expected: unknown } {
  if (item.shape !== 'foreignLongMessage')
    return expect.fail(`unknown JSON-RPC generator: ${item.shape}`)
  const message = 'x'.repeat(item.size)
  return {
    input: { code: -1, message },
    expected: {
      source: 'jsonrpc-2.0',
      code: '-1',
      name: 'Error',
      message,
      stack: `Error: ${'x'.repeat(item.expectedStackBytes! - 7)}`,
      truncated: true
    }
  }
}

describe('wire-error language-neutral vectors', () => {
  it('keeps schema fields and five wire limits aligned with the implementation', () => {
    const schema = JSON.parse(readFileSync(join(schemaRoot, 'wire-error.schema.json'), 'utf8')) as {
      properties: Record<string, unknown>
      required: string[]
      'x-migaia-limits': Record<string, number>
    }
    expect(vectors.version).toBe(2)
    expect(Object.keys(schema.properties)).toEqual([...RpcWireErrorField])
    expect(schema.required).toEqual(RpcWireErrorField.slice(0, 5))
    expect(schema['x-migaia-limits']).toEqual(RpcWireErrorLimit)
  })

  it.each(vectors.valid)('accepts valid vector $id', (item) => {
    const wire = expand(item)
    expect(normalizeRpcSerializedError(wire)).toEqual(wire)
  })

  it.each(vectors.valid)('relays valid vector $id without changing its wire shape', (item) => {
    const wire = expand(item)
    const reports: unknown[] = []
    expect(
      serializeRpcError(deserializeRpcError(wire), {
        report: (failure) => {
          reports.push(failure)
        }
      })
    ).toEqual(wire)
    expect(reports).toEqual([])
  })

  it.each(vectors.invalid)('rejects invalid vector $id at its first pointer', (item) => {
    const wire = expand(item)
    expect(() => normalizeRpcSerializedError(wire)).toThrow(TypeError)
    expect(() => normalizeRpcSerializedError(wire)).toThrow(
      expect.objectContaining({
        code: 'INVALID_WIRE_ERROR',
        violation: item.violation,
        pointer: item.pointer
      })
    )
  })

  it('sorts ignored unknown keys and reports their containing node pointer', () => {
    for (const item of vectors.unknownFields) {
      expect(() => normalizeRpcSerializedError(item.wire)).toThrow(
        expect.objectContaining(item.reject)
      )
      const reports: unknown[] = []
      const result = normalizeRpcSerializedError(item.wire, {
        unknownFields: 'ignore',
        onUnknownField: (pointer, field) => {
          reports.push({ pointer, field })
        }
      })
      expect(result).toEqual(item.ignoreExpected)
      expect(reports).toEqual(item.ignoreReports)
    }
  })

  it('maps logical thrown values with bounded truncation', () => {
    for (const item of vectors.truncation) {
      const { input, expected } = item.generate
        ? generatedTruncation(item.generate)
        : { input: logicalInput(item.input), expected: item.expected }
      const reports: unknown[] = []
      expect(
        serializeRpcError(input, {
          report: (failure) => {
            reports.push(failure)
          }
        })
      ).toEqual(expected)
      expect(reports).toEqual([])
    }
  })

  it('maps foreign JSON-RPC values into the same wire schema', () => {
    for (const item of vectors.jsonrpc) {
      const { input, expected } = item.generate
        ? generatedJsonRpc(item.generate)
        : { input: item.input, expected: item.expected }
      expect(fromJsonRpcError(input)).toEqual(expected)
    }
  })
})
